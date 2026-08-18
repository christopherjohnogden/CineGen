# Director Script Editor, Chat Assistant & Per-Scene Breakdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Director Script tab with a unified auto-formatting screenplay editor (left assets panel + right CLI chat assistant that applies inline-diff edits), and the Breakdown tab with a per-scene production view (scene navigator + highlighted scene script + tabbed scene assets), backed by a typed screenplay document model.

**Architecture:** Pure logic modules first (screenplay document model, scene segmentation, scene-asset detection, assistant contract) — all unit-tested. Then React components consume them. `DirectorShow.sourceText` stays the source of truth (a string); the editor parses it to a typed `Screenplay` and serializes back, so there is NO state migration. The CLI chat reuses existing `invokeCliCopilotChat`/`subscribeCliCopilotStream`.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`@/` → `src/`), existing `director-tab.css` theme tokens, Electron (`window.electronAPI.llm.*`).

## Global Constraints

- Test runner: `npx vitest run <path>`; tests under `tests/`, source imported via `@/…`.
- Full-project typecheck gate: `npx tsc --noEmit -p tsconfig.json` must stay clean.
- NO `DirectorShow` migration. New `DirectorShow` fields are OPTIONAL: `sceneAssetOverrides?`, `sceneAssetSuggestions?`. `DirectorBreakdownItem` gains OPTIONAL `timeOfDay?: string`, `intExt?: string`. `sourceText` stays the script source of truth.
- Element type union & cycle order (verbatim): `'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition'`.
- Asset colors (verbatim): character `#9db4ff`, location `#8fe0a8`, prop `#e0a88f`.
- NO Cmd/Ctrl+number shortcuts in the editor (browser/OS collision). Type control = Tab / Shift+Tab + clickable bottom legend only.
- Highlight matching MUST be tokenize-once (non-overlapping, longest-term-first) — never sequential regex-replace on HTML (it nests). Unit-test the overlap cases.
- Reuse: `generateId`, `timestamp` from `@/lib/utils/ids`; `parseScreenplay`/`ScriptLineType` classification rules from `@/lib/director/script-format`; `invokeCliCopilotChat`/`subscribeCliCopilotStream`/`cancelCliCopilotChat` from `@/lib/llm/cli-copilot-client`; `CliLlmProviderId` from `@/lib/llm/claude-code-session`; `BreakdownKind`/`DirectorBreakdownItem`/`DirectorShow` from `@/types/director`; `Element`/`ElementImage` from `@/types/elements`.
- Commit after every task. Match existing `director-tab__*` BEM-ish CSS conventions and theme vars.

---

### Task 1: Screenplay document model (`screenplay.ts`)

**Files:**
- Create: `src/lib/director/screenplay.ts`
- Test: `tests/lib/director/screenplay.test.ts`

**Interfaces:**
- Consumes: `generateId` from `@/lib/utils/ids`.
- Produces:
  ```ts
  export type ScreenplayElementType = 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';
  export interface ScreenplayElement { id: string; type: ScreenplayElementType; text: string }
  export interface Screenplay { elements: ScreenplayElement[] }
  export const ELEMENT_CYCLE: ScreenplayElementType[];
  export function parseToScreenplay(source: string): Screenplay;
  export function serializeScreenplay(doc: Screenplay): string;
  export function nextElementType(t: ScreenplayElementType, reverse?: boolean): ScreenplayElementType;
  export function typeAfterEnter(t: ScreenplayElementType): ScreenplayElementType;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/screenplay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseToScreenplay, serializeScreenplay, nextElementType, typeAfterEnter, ELEMENT_CYCLE,
} from '@/lib/director/screenplay';

describe('parseToScreenplay', () => {
  it('classifies element types and assigns ids', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nA desk.\nMAYA\nHello.");
    expect(doc.elements.map((e) => e.type)).toEqual(['scene', 'action', 'character', 'dialogue']);
    expect(doc.elements.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
  });

  it('classifies parentheticals and transitions', () => {
    const doc = parseToScreenplay("DANE\n(quietly)\nRun.\n\nCUT TO:");
    const types = doc.elements.map((e) => e.type);
    expect(types).toContain('parenthetical');
    expect(types.at(-1)).toBe('transition');
  });
});

describe('serializeScreenplay round-trips', () => {
  it('preserves text content through parse → serialize', () => {
    const src = "INT. OFFICE - DAY\nA desk.\nMAYA\nHello.";
    const round = serializeScreenplay(parseToScreenplay(src));
    // same visible lines, trimmed
    expect(round.split('\n').map((l) => l.trim()).filter(Boolean))
      .toEqual(src.split('\n').map((l) => l.trim()).filter(Boolean));
  });
});

describe('nextElementType', () => {
  it('cycles forward and backward through the union order', () => {
    expect(ELEMENT_CYCLE).toEqual(['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition']);
    expect(nextElementType('scene')).toBe('action');
    expect(nextElementType('transition')).toBe('scene');
    expect(nextElementType('scene', true)).toBe('transition');
  });
});

describe('typeAfterEnter', () => {
  it('character → dialogue, dialogue → dialogue, scene → action, action → action', () => {
    expect(typeAfterEnter('character')).toBe('dialogue');
    expect(typeAfterEnter('dialogue')).toBe('dialogue');
    expect(typeAfterEnter('scene')).toBe('action');
    expect(typeAfterEnter('action')).toBe('action');
    expect(typeAfterEnter('parenthetical')).toBe('dialogue');
    expect(typeAfterEnter('transition')).toBe('scene');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/screenplay.test.ts`
Expected: FAIL — cannot resolve `@/lib/director/screenplay`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/screenplay.ts`:

```ts
import { generateId } from '@/lib/utils/ids';

export type ScreenplayElementType =
  | 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';

export interface ScreenplayElement { id: string; type: ScreenplayElementType; text: string }
export interface Screenplay { elements: ScreenplayElement[] }

export const ELEMENT_CYCLE: ScreenplayElementType[] =
  ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];

const SCENE_HEADING = /^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\s.]/i;
const TRANSITION = /(TO:|^FADE (IN|OUT)|^DISSOLVE|^SMASH CUT|^MATCH CUT)/;

function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}
function isCharacterCue(t: string): boolean {
  if (t.length === 0 || t.length > 30) return false;
  if (SCENE_HEADING.test(t)) return false;
  return isAllCaps(t) && !t.endsWith(':');
}

export function parseToScreenplay(source: string): Screenplay {
  const elements: ScreenplayElement[] = [];
  let inDialogue = false;
  for (const raw of source.replace(/^﻿/, '').split('\n')) {
    const t = raw.trim();
    if (t === '') { inDialogue = false; continue; }
    let type: ScreenplayElementType;
    if (SCENE_HEADING.test(t)) { type = 'scene'; inDialogue = false; }
    else if (isAllCaps(t) && TRANSITION.test(t)) { type = 'transition'; inDialogue = false; }
    else if (isCharacterCue(t)) { type = 'character'; inDialogue = true; }
    else if (inDialogue && /^\(.*\)$/.test(t)) { type = 'parenthetical'; }
    else if (inDialogue) { type = 'dialogue'; }
    else { type = 'action'; }
    elements.push({ id: generateId(), type, text: t });
  }
  return { elements };
}

export function serializeScreenplay(doc: Screenplay): string {
  // blank line before scene headings and character cues for readability; text is source of truth
  const out: string[] = [];
  doc.elements.forEach((el, i) => {
    if (i > 0 && (el.type === 'scene' || el.type === 'character' || el.type === 'transition')) out.push('');
    out.push(el.text);
  });
  return out.join('\n');
}

export function nextElementType(t: ScreenplayElementType, reverse = false): ScreenplayElementType {
  const i = ELEMENT_CYCLE.indexOf(t);
  const n = ELEMENT_CYCLE.length;
  return ELEMENT_CYCLE[(i + (reverse ? -1 : 1) + n) % n];
}

export function typeAfterEnter(t: ScreenplayElementType): ScreenplayElementType {
  switch (t) {
    case 'character': return 'dialogue';
    case 'parenthetical': return 'dialogue';
    case 'dialogue': return 'dialogue';
    case 'scene': return 'action';
    case 'transition': return 'scene';
    default: return 'action';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/screenplay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/screenplay.ts tests/lib/director/screenplay.test.ts
git commit -m "feat(director): typed screenplay document model + parse/serialize/transitions"
```

---

### Task 2: Scene segmentation (`scene-split.ts`)

**Files:**
- Create: `src/lib/director/scene-split.ts`
- Test: `tests/lib/director/scene-split.test.ts`

**Interfaces:**
- Consumes: `Screenplay`, `ScreenplayElement` from `@/lib/director/screenplay`.
- Produces:
  ```ts
  export interface ScriptScene { index: number; heading: string; intExt?: string; timeOfDay?: string; elements: ScreenplayElement[] }
  export function parseHeading(heading: string): { intExt?: string; timeOfDay?: string; place: string };
  export function splitScenes(doc: Screenplay): ScriptScene[];
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/scene-split.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseHeading, splitScenes } from '@/lib/director/scene-split';
import { parseToScreenplay } from '@/lib/director/screenplay';

describe('parseHeading', () => {
  it('extracts INT/EXT, time-of-day and place', () => {
    expect(parseHeading("INT. DR. JORDAN'S OFFICE - DAY"))
      .toMatchObject({ intExt: 'INT', timeOfDay: 'DAY', place: "DR. JORDAN'S OFFICE" });
    expect(parseHeading('EXT. ALLEY - NIGHT')).toMatchObject({ intExt: 'EXT', timeOfDay: 'NIGHT' });
  });
  it('handles CONTINUOUS and missing time', () => {
    expect(parseHeading('INT. FOREST - CONTINUOUS').timeOfDay).toBe('CONTINUOUS');
    expect(parseHeading('INT. VOID').timeOfDay).toBeUndefined();
  });
});

describe('splitScenes', () => {
  it('splits on scene headings and carries heading metadata', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nA desk.\nEXT. ALLEY - NIGHT\nRain.");
    const scenes = splitScenes(doc);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ index: 0, intExt: 'INT', timeOfDay: 'DAY' });
    expect(scenes[1]).toMatchObject({ index: 1, intExt: 'EXT', timeOfDay: 'NIGHT' });
    expect(scenes[0].elements.map((e) => e.text)).toEqual(['INT. OFFICE - DAY', 'A desk.']);
  });
  it('puts pre-heading elements into an implicit scene 0', () => {
    const doc = parseToScreenplay('A cold open with no heading.');
    const scenes = splitScenes(doc);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/scene-split.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/scene-split.ts`:

```ts
import type { Screenplay, ScreenplayElement } from '@/lib/director/screenplay';

export interface ScriptScene {
  index: number;
  heading: string;
  intExt?: string;
  timeOfDay?: string;
  elements: ScreenplayElement[];
}

const TIME_WORDS = /\b(DAY|NIGHT|DUSK|DAWN|MORNING|AFTERNOON|EVENING|CONTINUOUS|LATER|MOMENTS LATER|SAME)\b/i;

export function parseHeading(heading: string): { intExt?: string; timeOfDay?: string; place: string } {
  const intExtMatch = heading.match(/^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)\b/i);
  const intExt = intExtMatch ? intExtMatch[1].toUpperCase().replace(/\.$/, '') : undefined;
  // time-of-day: last ' - XXX' segment or a recognized time word
  let timeOfDay: string | undefined;
  const dash = heading.split(/\s[-—–]\s/);
  if (dash.length > 1) {
    const tail = dash[dash.length - 1].trim();
    if (TIME_WORDS.test(tail)) timeOfDay = tail.toUpperCase();
  }
  if (!timeOfDay) {
    const w = heading.match(TIME_WORDS);
    if (w) timeOfDay = w[1].toUpperCase();
  }
  // place: strip int/ext prefix and trailing time segment
  let place = heading.replace(/^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)\.?\s*/i, '');
  if (dash.length > 1 && timeOfDay) place = dash.slice(0, -1).join(' - ').replace(/^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)\.?\s*/i, '');
  place = place.trim();
  return { intExt, timeOfDay, place };
}

export function splitScenes(doc: Screenplay): ScriptScene[] {
  const scenes: ScriptScene[] = [];
  let current: ScriptScene | null = null;
  for (const el of doc.elements) {
    if (el.type === 'scene') {
      const meta = parseHeading(el.text);
      current = { index: scenes.length, heading: el.text, intExt: meta.intExt, timeOfDay: meta.timeOfDay, elements: [el] };
      scenes.push(current);
    } else {
      if (!current) { current = { index: 0, heading: '', elements: [] }; scenes.push(current); }
      current.elements.push(el);
    }
  }
  return scenes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/scene-split.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/scene-split.ts tests/lib/director/scene-split.test.ts
git commit -m "feat(director): scene segmentation + heading INT/EXT & time-of-day parsing"
```

---

### Task 3: Scene-asset detection & highlight tokenizer (`scene-assets.ts`)

**Files:**
- Create: `src/lib/director/scene-assets.ts`
- Test: `tests/lib/director/scene-assets.test.ts`

**Interfaces:**
- Consumes: `ScriptScene` from `@/lib/director/scene-split`; `BreakdownKind`, `DirectorBreakdownItem`, `DirectorShow` from `@/types/director`.
- Produces:
  ```ts
  export interface SceneAssetHit { kind: BreakdownKind; name: string; item?: DirectorBreakdownItem }
  export interface HighlightRun { text: string; kind?: BreakdownKind }
  export function detectSceneAssets(scene: ScriptScene, breakdown: DirectorBreakdownItem[]): SceneAssetHit[];
  export function highlightRuns(text: string, breakdown: DirectorBreakdownItem[]): HighlightRun[];
  export function resolveSceneAssets(show: DirectorShow, sceneIndex: number, breakdown: DirectorBreakdownItem[], scene: ScriptScene): Array<{ item: DirectorBreakdownItem; source: 'auto' | 'ai' | 'manual' }>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/scene-assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectSceneAssets, highlightRuns, resolveSceneAssets } from '@/lib/director/scene-assets';
import type { DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';

const bd = (over: Partial<DirectorBreakdownItem>): DirectorBreakdownItem => ({
  id: over.id ?? over.name!, kind: 'prop', name: 'x', tag: '@x', description: '', ...over,
});
const BREAKDOWN: DirectorBreakdownItem[] = [
  bd({ name: 'Dr. Jordan', tag: '@Dr-Jordan', kind: 'character' }),
  bd({ name: 'Chesterfield Sofa', tag: '@Chesterfield-Sofa', kind: 'prop' }),
  bd({ name: 'Sofa', tag: '@Sofa', kind: 'prop' }),
];

describe('highlightRuns', () => {
  it('produces non-overlapping, longest-first typed runs (no nesting)', () => {
    const runs = highlightRuns('DR. JORDAN sits on the Chesterfield Sofa.', BREAKDOWN);
    const marked = runs.filter((r) => r.kind);
    expect(marked.map((r) => r.text)).toEqual(['DR. JORDAN', 'Chesterfield Sofa']);
    expect(marked[0].kind).toBe('character');
    expect(marked[1].kind).toBe('prop');
    // reconstruct original text exactly
    expect(runs.map((r) => r.text).join('')).toBe('DR. JORDAN sits on the Chesterfield Sofa.');
  });
});

describe('detectSceneAssets', () => {
  it('finds breakdown items present in the scene text', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nDr. Jordan sits on the Chesterfield Sofa.");
    const scene = splitScenes(doc)[0];
    const names = detectSceneAssets(scene, BREAKDOWN).map((h) => h.name);
    expect(names).toContain('Dr. Jordan');
    expect(names).toContain('Chesterfield Sofa');
  });
});

describe('resolveSceneAssets merges auto + ai + manual', () => {
  it('adds AI suggestions and manual adds, drops manual removes', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nDr. Jordan enters.");
    const scene = splitScenes(doc)[0];
    const show = {
      sceneAssetSuggestions: { 0: ['@Chesterfield-Sofa'] },
      sceneAssetOverrides: { 0: { added: ['@Sofa'], removed: ['@Dr-Jordan'] } },
    } as unknown as DirectorShow;
    const resolved = resolveSceneAssets(show, 0, BREAKDOWN, scene);
    const tags = resolved.map((r) => r.item.tag);
    expect(tags).toContain('@Chesterfield-Sofa'); // ai
    expect(tags).toContain('@Sofa');              // manual add
    expect(tags).not.toContain('@Dr-Jordan');     // manual remove wins
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/scene-assets.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/scene-assets.ts`:

```ts
import type { ScriptScene } from '@/lib/director/scene-split';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';

export interface SceneAssetHit { kind: BreakdownKind; name: string; item?: DirectorBreakdownItem }
export interface HighlightRun { text: string; kind?: BreakdownKind }

function sceneText(scene: ScriptScene): string {
  return scene.elements.map((e) => e.text).join('\n');
}
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

interface Span { start: number; end: number; kind: BreakdownKind }

// non-overlapping matches across the text, longest breakdown name first
function findSpans(text: string, breakdown: DirectorBreakdownItem[]): Span[] {
  const terms = [...breakdown].sort((a, b) => b.name.length - a.name.length);
  const spans: Span[] = [];
  for (const item of terms) {
    const re = new RegExp('\\b(' + escapeRe(item.name) + ')\\b', 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index, end = start + m[0].length;
      if (spans.some((sp) => start < sp.end && end > sp.start)) continue;
      spans.push({ start, end, kind: item.kind });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function highlightRuns(text: string, breakdown: DirectorBreakdownItem[]): HighlightRun[] {
  const spans = findSpans(text, breakdown);
  const runs: HighlightRun[] = [];
  let pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) runs.push({ text: text.slice(pos, sp.start) });
    runs.push({ text: text.slice(sp.start, sp.end), kind: sp.kind });
    pos = sp.end;
  }
  if (pos < text.length) runs.push({ text: text.slice(pos) });
  return runs;
}

export function detectSceneAssets(scene: ScriptScene, breakdown: DirectorBreakdownItem[]): SceneAssetHit[] {
  const text = sceneText(scene);
  const seen = new Set<string>();
  const hits: SceneAssetHit[] = [];
  for (const item of [...breakdown].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp('\\b' + escapeRe(item.name) + '\\b', 'i');
    if (re.test(text) && !seen.has(item.tag)) {
      seen.add(item.tag);
      hits.push({ kind: item.kind, name: item.name, item });
    }
  }
  return hits;
}

export function resolveSceneAssets(
  show: DirectorShow,
  sceneIndex: number,
  breakdown: DirectorBreakdownItem[],
  scene: ScriptScene,
): Array<{ item: DirectorBreakdownItem; source: 'auto' | 'ai' | 'manual' }> {
  const byTag = new Map(breakdown.map((b) => [b.tag, b]));
  const source = new Map<string, 'auto' | 'ai' | 'manual'>();
  for (const hit of detectSceneAssets(scene, breakdown)) if (hit.item) source.set(hit.item.tag, 'auto');
  for (const tag of show.sceneAssetSuggestions?.[sceneIndex] ?? []) if (!source.has(tag)) source.set(tag, 'ai');
  const ov = show.sceneAssetOverrides?.[sceneIndex];
  if (ov) {
    for (const tag of ov.added) source.set(tag, 'manual');
    for (const tag of ov.removed) source.delete(tag);
  }
  const out: Array<{ item: DirectorBreakdownItem; source: 'auto' | 'ai' | 'manual' }> = [];
  for (const [tag, src] of source) { const item = byTag.get(tag); if (item) out.push({ item, source: src }); }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/scene-assets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/scene-assets.ts tests/lib/director/scene-assets.test.ts
git commit -m "feat(director): scene-asset detection, highlight tokenizer, merge resolver"
```

---

### Task 4: Data-model fields + breakdown prompt extraction quality

**Files:**
- Modify: `src/types/director.ts` (add optional fields)
- Modify: `src/lib/director/llm-jobs.ts` (`BREAKDOWN_SYSTEM_PROMPT`)
- Test: `tests/lib/director/breakdown-extraction.test.ts`

**Interfaces:**
- Produces: `DirectorShow.sceneAssetOverrides?`, `DirectorShow.sceneAssetSuggestions?`; `DirectorBreakdownItem.timeOfDay?`, `DirectorBreakdownItem.intExt?`.

- [ ] **Step 1: Add the optional fields to `src/types/director.ts`**

In `DirectorBreakdownItem`, after `elementId?: string;` add:
```ts
  /** Locations only. Time of day parsed from / recorded on the scene heading. */
  timeOfDay?: string;
  /** Locations only. INT / EXT. */
  intExt?: string;
```
In `DirectorShow`, after `llmProvider: ...;` add:
```ts
  /** Per-scene manual asset overrides (asset tags). sceneIndex -> added/removed. */
  sceneAssetOverrides?: Record<number, { added: string[]; removed: string[] }>;
  /** Background-LLM per-scene asset suggestions (asset tags). sceneIndex -> tags. */
  sceneAssetSuggestions?: Record<number, string[]>;
```

- [ ] **Step 2: Strengthen `BREAKDOWN_SYSTEM_PROMPT` in `src/lib/director/llm-jobs.ts`**

Find the `Write actingProfile and voice for characters only;` line in `BREAKDOWN_SYSTEM_PROMPT` and insert BEFORE it:
```
For every location, record the time of day and INT/EXT from its scene heading in the description (e.g. "INT, DAY").
Extract set dressing and furniture as props — sofas, armchairs, tables, shelves, lamps, curtains, rugs — not only objects a character handles. A furnished room implies its furniture as props.
```

- [ ] **Step 3: Write a test asserting the prompt covers the new requirements**

Create `tests/lib/director/breakdown-extraction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BREAKDOWN_SYSTEM_PROMPT } from '@/lib/director/llm-jobs';

describe('breakdown prompt extraction requirements', () => {
  it('requires time-of-day / INT-EXT on locations', () => {
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/time of day/i);
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/INT\/EXT/i);
  });
  it('requires set dressing / furniture as props', () => {
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/set dressing/i);
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/furniture/i);
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/director/breakdown-extraction.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/director.ts src/lib/director/llm-jobs.ts tests/lib/director/breakdown-extraction.test.ts
git commit -m "feat(director): scene-asset model fields + time-of-day/set-dressing extraction"
```

---

### Task 5: Script assistant contract (`script-assistant.ts`)

**Files:**
- Create: `src/lib/director/script-assistant.ts`
- Test: `tests/lib/director/script-assistant.test.ts`

**Interfaces:**
- Consumes: `Screenplay`, `ScreenplayElement`, `ScreenplayElementType` from `@/lib/director/screenplay`.
- Produces:
  ```ts
  export interface AssistantEdit { op: 'replace' | 'insert-after' | 'delete'; targetElementId?: string; elements?: ScreenplayElement[] }
  export interface AssistantResponse { reply: string; edits?: AssistantEdit[] }
  export const SCRIPT_ASSISTANT_SYSTEM_PROMPT: string;
  export function buildAssistantMessage(doc: Screenplay, userText: string, selection?: { elementId?: string; sceneIndex?: number }): string;
  export function parseAssistantResponse(raw: string): AssistantResponse;
  export function applyAssistantEdits(doc: Screenplay, edits: AssistantEdit[]): Screenplay;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/script-assistant.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAssistantResponse, applyAssistantEdits, buildAssistantMessage } from '@/lib/director/script-assistant';
import { parseToScreenplay } from '@/lib/director/screenplay';

describe('parseAssistantResponse', () => {
  it('parses a JSON reply with edits', () => {
    const raw = JSON.stringify({ reply: 'Softened it.', edits: [{ op: 'replace', targetElementId: 'e1', elements: [{ id: 'e1', type: 'dialogue', text: 'New line.' }] }] });
    const res = parseAssistantResponse(raw);
    expect(res.reply).toBe('Softened it.');
    expect(res.edits).toHaveLength(1);
    expect(res.edits![0].op).toBe('replace');
  });
  it('falls back to a plain reply on malformed JSON', () => {
    const res = parseAssistantResponse('just some prose, no json here');
    expect(res.reply).toContain('just some prose');
    expect(res.edits).toBeUndefined();
  });
  it('extracts a fenced json block if present', () => {
    const res = parseAssistantResponse('Sure!\n```json\n{"reply":"ok","edits":[]}\n```');
    expect(res.reply).toBe('ok');
  });
});

describe('applyAssistantEdits', () => {
  const doc = parseToScreenplay('INT. OFFICE - DAY\nOld action.');
  it('replaces the target element', () => {
    const target = doc.elements[1].id;
    const next = applyAssistantEdits(doc, [{ op: 'replace', targetElementId: target, elements: [{ id: 'x', type: 'action', text: 'New action.' }] }]);
    expect(next.elements[1].text).toBe('New action.');
  });
  it('inserts after the target', () => {
    const target = doc.elements[0].id;
    const next = applyAssistantEdits(doc, [{ op: 'insert-after', targetElementId: target, elements: [{ id: 'y', type: 'action', text: 'Inserted.' }] }]);
    expect(next.elements[1].text).toBe('Inserted.');
  });
  it('deletes the target', () => {
    const target = doc.elements[1].id;
    const next = applyAssistantEdits(doc, [{ op: 'delete', targetElementId: target }]);
    expect(next.elements).toHaveLength(1);
  });
});

describe('buildAssistantMessage', () => {
  it('includes script text and the selection when provided', () => {
    const msg = buildAssistantMessage(doc, 'punch this up', { elementId: doc.elements[1].id });
    expect(msg).toMatch(/Old action\./);
    expect(msg).toMatch(new RegExp(doc.elements[1].id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/script-assistant.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/script-assistant.ts`:

```ts
import type { Screenplay, ScreenplayElement } from '@/lib/director/screenplay';

export interface AssistantEdit {
  op: 'replace' | 'insert-after' | 'delete';
  targetElementId?: string;
  elements?: ScreenplayElement[];
}
export interface AssistantResponse { reply: string; edits?: AssistantEdit[] }

export const SCRIPT_ASSISTANT_SYSTEM_PROMPT = `You are a screenwriting assistant embedded in a script editor.
You can answer questions about the script AND propose edits to it.
The script is given as a list of elements, each with an id, a type (scene|action|character|parenthetical|dialogue|transition) and text.
When the user asks you to change the script, return edits that reference element ids.
Return ONLY JSON with this shape:
{
  "reply": "one short sentence describing what you did or answering the question",
  "edits": [
    { "op": "replace", "targetElementId": "<id>", "elements": [ { "id": "<id>", "type": "dialogue", "text": "..." } ] },
    { "op": "insert-after", "targetElementId": "<id>", "elements": [ { "id": "new1", "type": "action", "text": "..." } ] },
    { "op": "delete", "targetElementId": "<id>" }
  ]
}
Omit "edits" entirely for a pure question/answer. Never invent element ids for replace/delete — use ids from the script. Keep replacements screenplay-formatted.`;

export function buildAssistantMessage(
  doc: Screenplay,
  userText: string,
  selection?: { elementId?: string; sceneIndex?: number },
): string {
  const script = doc.elements.map((e) => `[${e.id}] (${e.type}) ${e.text}`).join('\n');
  const sel = selection?.elementId ? `\nSELECTED ELEMENT: ${selection.elementId}` : '';
  const scene = selection?.sceneIndex != null ? `\nSELECTED SCENE INDEX: ${selection.sceneIndex}` : '';
  return `SCRIPT:\n${script}${sel}${scene}\n\nUSER:\n${userText}`;
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const brace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (brace >= 0 && lastBrace > brace) return raw.slice(brace, lastBrace + 1);
  return null;
}

export function parseAssistantResponse(raw: string): AssistantResponse {
  const json = extractJson(raw);
  if (json) {
    try {
      const obj = JSON.parse(json) as Partial<AssistantResponse>;
      if (obj && typeof obj.reply === 'string') {
        const edits = Array.isArray(obj.edits) ? obj.edits.filter((e): e is AssistantEdit =>
          !!e && (e.op === 'replace' || e.op === 'insert-after' || e.op === 'delete')) : undefined;
        return { reply: obj.reply, edits: edits && edits.length ? edits : undefined };
      }
    } catch { /* fall through to plain reply */ }
  }
  return { reply: raw.trim() };
}

export function applyAssistantEdits(doc: Screenplay, edits: AssistantEdit[]): Screenplay {
  let elements = [...doc.elements];
  for (const edit of edits) {
    const i = edit.targetElementId ? elements.findIndex((e) => e.id === edit.targetElementId) : -1;
    if (edit.op === 'replace' && i >= 0 && edit.elements) {
      elements = [...elements.slice(0, i), ...edit.elements, ...elements.slice(i + 1)];
    } else if (edit.op === 'insert-after' && i >= 0 && edit.elements) {
      elements = [...elements.slice(0, i + 1), ...edit.elements, ...elements.slice(i + 1)];
    } else if (edit.op === 'delete' && i >= 0) {
      elements = [...elements.slice(0, i), ...elements.slice(i + 1)];
    }
  }
  return { elements };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/script-assistant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/script-assistant.ts tests/lib/director/script-assistant.test.ts
git commit -m "feat(director): script-assistant contract (prompt, message, parse, apply edits)"
```

---

### Task 6: CSS for editor, panels, chat, breakdown

**Files:**
- Modify: `src/styles/director-tab.css` (append)

**Interfaces:**
- Produces CSS classes consumed by Tasks 7–12. Full list in Step 1.

- [ ] **Step 1: Append the new classes**

Append to `src/styles/director-tab.css`:

```css
/* ── Script editor: 3-column shell + collapsible panels ─────────── */
.dse-shell { flex:1; display:grid; grid-template-columns:var(--dse-l,270px) minmax(0,1fr) var(--dse-r,340px); min-height:0; transition:grid-template-columns .18s ease; }
.dse-shell[data-left="closed"] { --dse-l:0px; }
.dse-shell[data-right="closed"] { --dse-r:0px; }
.dse-panel { position:relative; min-width:0; overflow:auto; background:var(--bg-raised); display:flex; flex-direction:column; }
.dse-panel--left { border-right:1px solid var(--border-subtle); }
.dse-panel--right { border-left:1px solid var(--border-subtle); }
.dse-shell[data-left="closed"] .dse-panel--left { overflow:hidden; border-right:none; }
.dse-shell[data-right="closed"] .dse-panel--right { overflow:hidden; border-left:none; }
.dse-notch { position:absolute; top:50%; transform:translateY(-50%); width:16px; height:52px; background:var(--bg-elevated); border:1px solid var(--border-medium); color:var(--text-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:5; padding:0; font-size:11px; }
.dse-notch:hover { color:var(--accent); border-color:var(--accent); }
.dse-notch--left { right:-1px; border-radius:6px 0 0 6px; border-right:none; }
.dse-notch--right { left:-1px; border-radius:0 6px 6px 0; border-left:none; }
.dse-reopen { position:absolute; top:50%; transform:translateY(-50%); width:16px; height:52px; background:var(--bg-raised); border:1px solid var(--border-medium); color:var(--text-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:6; font-size:11px; }
.dse-reopen:hover { color:var(--accent); border-color:var(--accent); }
.dse-reopen--left { left:0; border-radius:0 6px 6px 0; border-left:none; }
.dse-reopen--right { right:0; border-radius:6px 0 0 6px; border-right:none; }

/* ── Screenplay paper + elements ────────────────────────────────── */
.dse-paperwrap { overflow:auto; padding:24px 0; display:flex; justify-content:center; position:relative; }
.dse-paper { width:620px; max-width:100%; background:#f4f1ea; color:#16130d; border-radius:4px; box-shadow:0 8px 40px rgba(0,0,0,.5); padding:48px 60px 56px 82px; font-family:'Courier New',Courier,monospace; font-size:14.5px; line-height:1.5; min-height:820px; }
.dse-el { white-space:pre-wrap; outline:none; }
.dse-el--scene { font-weight:700; text-transform:uppercase; margin:22px 0 10px; color:#3a2f10; }
.dse-el--scene:first-child { margin-top:0; }
.dse-el--action { margin:0 0 11px; }
.dse-el--character { margin:12px 0 0; padding-left:200px; text-transform:uppercase; }
.dse-el--parenthetical { margin:0; padding-left:150px; }
.dse-el--dialogue { margin:0 0 4px; padding-left:96px; padding-right:96px; }
.dse-el--transition { margin:12px 0; text-align:right; text-transform:uppercase; }
.dse-el--sel { background:rgba(79,123,255,.14); border-radius:2px; }
.dse-el--diffdel { background:rgba(160,58,58,.18); border-left:3px solid #a03a3a; text-decoration:line-through; opacity:.8; padding-left:6px; }
.dse-el--diffadd { background:rgba(47,125,79,.2); border-left:3px solid #2f7d4f; padding-left:6px; }
.dse-diffbar { display:flex; gap:6px; align-items:center; margin:6px 0 14px; padding-left:6px; }

/* ── Bottom type legend ─────────────────────────────────────────── */
.dse-legend { display:flex; justify-content:center; align-items:stretch; gap:0; background:var(--bg-raised); border-top:1px solid var(--border-subtle); flex-shrink:0; overflow-x:auto; }
.dse-leg { display:flex; align-items:center; gap:8px; padding:9px 15px; border-right:1px solid var(--border-subtle); white-space:nowrap; cursor:pointer; background:transparent; border-top:none; border-bottom:none; border-left:none; color:var(--text-secondary); min-height:36px; flex-shrink:0; }
.dse-leg:last-child { border-right:none; }
.dse-leg:hover { background:var(--bg-elevated); }
.dse-leg--on { background:var(--bg-elevated); color:var(--accent); }
.dse-leg .sw { width:11px; height:11px; border-radius:3px; }
.dse-leg .nm { font-size:12px; font-weight:600; }

/* ── Chat assistant ─────────────────────────────────────────────── */
.dch-head { padding:10px 14px; border-bottom:1px solid var(--border-subtle); display:flex; align-items:center; gap:8px; }
.dch-msgs { flex:1; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
.dch-m { max-width:92%; font-size:12.5px; line-height:1.5; border-radius:10px; padding:9px 11px; }
.dch-m--user { align-self:flex-end; background:var(--accent); color:var(--bg-base); }
.dch-m--ai { align-self:flex-start; background:var(--bg-elevated); color:var(--text-primary); border:1px solid var(--border-subtle); }
.dch-composer { border-top:1px solid var(--border-subtle); padding:10px; display:flex; flex-direction:column; gap:8px; }
.dch-sel { font-size:10px; color:#9db4ff; background:var(--accent-dim); border:1px solid var(--border-medium); border-radius:6px; padding:3px 8px; align-self:flex-start; }

/* ── Assets panels (script left + breakdown right share these) ──── */
.dast-tabs { display:flex; gap:2px; padding:8px 8px 0; position:sticky; top:0; background:var(--bg-raised); border-bottom:1px solid var(--border-subtle); overflow-x:auto; }
.dast-tab { flex-shrink:0; padding:7px 11px; border:none; background:transparent; color:var(--text-secondary); font-size:12px; font-weight:600; border-bottom:2px solid transparent; cursor:pointer; white-space:nowrap; min-height:34px; display:flex; align-items:center; gap:6px; }
.dast-tab--on { color:var(--accent); border-bottom-color:var(--accent); }
.dast-tab .cnt { font-size:10px; background:var(--bg-elevated); border:1px solid var(--border-medium); border-radius:8px; padding:0 6px; font-weight:700; }
.dast-tab--on .cnt { background:var(--accent); color:var(--bg-base); border-color:var(--accent); }
.dast-pip { width:7px; height:7px; border-radius:50%; }
.dast-pip--character { background:#9db4ff; } .dast-pip--location { background:#8fe0a8; } .dast-pip--prop { background:#e0a88f; }

/* ── Breakdown 3-zone + scene nav + asset cards ─────────────────── */
.dbk-shell { flex:1; display:grid; grid-template-columns:230px 1fr 380px; min-height:0; }
.dbk-nav { border-right:1px solid var(--border-subtle); background:var(--bg-raised); overflow:auto; padding:12px; }
.dbk-navitem { padding:9px 11px; border-radius:8px; cursor:pointer; border:1px solid transparent; margin-bottom:6px; }
.dbk-navitem:hover { background:var(--bg-elevated); }
.dbk-navitem--on { background:var(--accent-dim); border-color:var(--accent); }
.dbk-navnum { font-family:'Courier New',monospace; font-size:11px; color:var(--accent); font-weight:700; }
.dbk-navttl { font-size:12px; color:var(--text-primary); margin-top:3px; line-height:1.3; }
.dbk-navmeta { font-size:10px; color:var(--text-tertiary); margin-top:4px; display:flex; gap:8px; }
.dbk-scenecol { overflow:auto; padding:20px 0; display:flex; justify-content:center; }
.dbk-assets { border-left:1px solid var(--border-subtle); background:var(--bg-raised); overflow:auto; display:flex; flex-direction:column; }
.dbk-mark { border-radius:2px; padding:0 1px; cursor:pointer; }
.dbk-mark--character { background:rgba(157,180,255,.3); box-shadow:inset 0 -2px 0 rgba(157,180,255,.7); }
.dbk-mark--location { background:rgba(143,224,168,.28); box-shadow:inset 0 -2px 0 rgba(143,224,168,.7); }
.dbk-mark--prop { background:rgba(224,168,143,.28); box-shadow:inset 0 -2px 0 rgba(224,168,143,.7); }
.dbk-mark:hover { filter:brightness(1.25); }
.dbk-card { background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:8px; padding:9px 10px; margin-bottom:7px; }
.dbk-card--flash { animation:dbkflash 1.1s ease; }
@keyframes dbkflash { 0%,100% { box-shadow:0 0 0 0 rgba(79,123,255,0); } 20% { box-shadow:0 0 0 2px var(--accent); } }
.dbk-icn { width:44px; height:44px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:700; flex-shrink:0; overflow:hidden; position:relative; }
.dbk-icn img { width:100%; height:100%; object-fit:cover; display:block; }
.dbk-icn--character { background:#2a3550; color:#9db4ff; } .dbk-icn--location { background:#2a4030; color:#8fe0a8; } .dbk-icn--prop { background:#402a2a; color:#e0a88f; }
.dbk-tod { background:#3a3320; color:#e0c060; border-radius:4px; padding:0 5px; margin-left:4px; font-weight:700; font-size:10px; }
.dbk-status { margin-left:auto; font-size:10px; font-weight:600; padding:2px 7px; border-radius:8px; }
.dbk-status--linked { background:var(--accent-dim); color:var(--success); } .dbk-status--missing { background:var(--bg-raised); color:var(--error); } .dbk-status--ai { background:#2a2540; color:#c8a0e0; }
```

- [ ] **Step 2: Verify typecheck (CSS-only regression guard)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/director-tab.css
git commit -m "style(director): editor/panels/chat/breakdown classes"
```

---

### Task 7: Collapsible panel primitive (`collapsible-panel.tsx`)

**Files:**
- Create: `src/components/director/collapsible-panel.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface CollapsiblePanelProps { side: 'left' | 'right'; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }
  export function CollapsiblePanel(props: CollapsiblePanelProps): JSX.Element;
  ```
  Renders a `.dse-panel` with a `.dse-notch` (to collapse); the parent renders the `.dse-reopen` tab and drives the `data-left`/`data-right` attr on `.dse-shell`.

- [ ] **Step 1: Create the component**

Create `src/components/director/collapsible-panel.tsx`:

```tsx
import type { ReactNode } from 'react';

interface CollapsiblePanelProps {
  side: 'left' | 'right';
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsiblePanel({ side, open, onToggle, children }: CollapsiblePanelProps) {
  return (
    <aside className={`dse-panel dse-panel--${side}`} aria-hidden={!open}>
      <button
        type="button"
        className={`dse-notch dse-notch--${side}`}
        title="Collapse panel"
        onClick={() => onToggle(false)}
      >
        {side === 'left' ? '‹' : '›'}
      </button>
      {children}
    </aside>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/collapsible-panel.tsx
git commit -m "feat(director): collapsible panel primitive with notch handle"
```

---

### Task 8: Screenplay editor (`screenplay-editor.tsx`)

**Files:**
- Create: `src/components/director/screenplay-editor.tsx`

**Interfaces:**
- Consumes: `Screenplay`, `ScreenplayElement`, `ScreenplayElementType`, `nextElementType`, `typeAfterEnter`, `ELEMENT_CYCLE` from `@/lib/director/screenplay`; `generateId` from `@/lib/utils/ids`; `AssistantEdit` from `@/lib/director/script-assistant`.
- Produces:
  ```ts
  interface ScreenplayEditorProps {
    doc: Screenplay;
    selectedId?: string;
    pendingEdits?: AssistantEdit[];              // render inline diff when present
    onChange: (doc: Screenplay) => void;
    onSelect: (elementId: string) => void;
    onAcceptEdits: () => void;
    onDeclineEdits: () => void;
  }
  export function ScreenplayEditor(props: ScreenplayEditorProps): JSX.Element;
  export const ELEMENT_TYPES: { id: ScreenplayElementType; name: string; color: string }[];
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/screenplay-editor.tsx`. Line-based editable model (one editable `div` per element; the `Screenplay` stays authoritative). Tab/Shift+Tab change the focused element's type; Enter splits into a new element via `typeAfterEnter`; edits update the element text on input:

```tsx
import { useCallback } from 'react';
import type { Screenplay, ScreenplayElement, ScreenplayElementType } from '@/lib/director/screenplay';
import { nextElementType, typeAfterEnter } from '@/lib/director/screenplay';
import { generateId } from '@/lib/utils/ids';
import type { AssistantEdit } from '@/lib/director/script-assistant';

export const ELEMENT_TYPES: { id: ScreenplayElementType; name: string; color: string }[] = [
  { id: 'scene', name: 'Scene Heading', color: '#c9a24a' },
  { id: 'action', name: 'Action', color: '#8a8a96' },
  { id: 'character', name: 'Character', color: '#9db4ff' },
  { id: 'dialogue', name: 'Dialogue', color: '#e8e8ee' },
  { id: 'parenthetical', name: 'Parenthetical', color: '#c8a0e0' },
  { id: 'transition', name: 'Transition', color: '#8fe0a8' },
];

interface ScreenplayEditorProps {
  doc: Screenplay;
  selectedId?: string;
  pendingEdits?: AssistantEdit[];
  onChange: (doc: Screenplay) => void;
  onSelect: (elementId: string) => void;
  onAcceptEdits: () => void;
  onDeclineEdits: () => void;
}

export function ScreenplayEditor({ doc, selectedId, pendingEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits }: ScreenplayEditorProps) {
  const patch = useCallback((elements: ScreenplayElement[]) => onChange({ elements }), [onChange]);

  const setText = (id: string, text: string) => {
    patch(doc.elements.map((e) => (e.id === id ? { ...e, text } : e)));
  };
  const setType = (id: string, type: ScreenplayElementType) => {
    patch(doc.elements.map((e) => (e.id === id ? { ...e, type } : e)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, el: ScreenplayElement) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      setType(el.id, nextElementType(el.type, e.shiftKey));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const i = doc.elements.findIndex((x) => x.id === el.id);
      const created: ScreenplayElement = { id: generateId(), type: typeAfterEnter(el.type), text: '' };
      patch([...doc.elements.slice(0, i + 1), created, ...doc.elements.slice(i + 1)]);
      onSelect(created.id);
    }
  };

  // when a diff is pending, mark which element ids are being replaced/deleted
  const diffTargets = new Set((pendingEdits ?? []).map((ed) => ed.targetElementId).filter(Boolean) as string[]);

  return (
    <div className="dse-paperwrap">
      <div className="dse-paper">
        {doc.elements.map((el) => {
          const isDiff = diffTargets.has(el.id);
          return (
            <div key={el.id}>
              <div
                data-el-id={el.id}
                className={`dse-el dse-el--${el.type}${el.id === selectedId ? ' dse-el--sel' : ''}${isDiff ? ' dse-el--diffdel' : ''}`}
                contentEditable={!pendingEdits}
                suppressContentEditableWarning
                spellCheck={false}
                onFocus={() => onSelect(el.id)}
                onKeyDown={(e) => onKeyDown(e, el)}
                onBlur={(e) => {
                  const text = e.currentTarget.textContent ?? '';
                  const finalText = el.type === 'character' ? text.toUpperCase() : text;
                  if (finalText !== el.text) setText(el.id, finalText);
                }}
              >
                {el.text}
              </div>
              {isDiff && pendingEdits && renderDiffAdds(pendingEdits, el.id)}
            </div>
          );
        })}
        {pendingEdits && pendingEdits.length > 0 && (
          <div className="dse-diffbar">
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept</button>
            <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline</button>
            <span className="director-tab__meta">assistant edit · {pendingEdits.length} change{pendingEdits.length === 1 ? '' : 's'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function renderDiffAdds(edits: AssistantEdit[], targetId: string) {
  const add = edits.find((e) => e.targetElementId === targetId && (e.op === 'replace' || e.op === 'insert-after'));
  if (!add?.elements) return null;
  return add.elements.map((n) => (
    <div key={n.id} className={`dse-el dse-el--${n.type} dse-el--diffadd`}>{n.text}</div>
  ));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/screenplay-editor.tsx
git commit -m "feat(director): screenplay editor (Tab/Enter engine + inline diff render)"
```

---

### Task 9: Script assets panel (`director-script-assets.tsx`)

**Files:**
- Create: `src/components/director/director-script-assets.tsx`

**Interfaces:**
- Consumes: `Screenplay` from `@/lib/director/screenplay`; `splitScenes`, `ScriptScene` from `@/lib/director/scene-split`; `DirectorBreakdownItem` from `@/types/director`.
- Produces:
  ```ts
  interface DirectorScriptAssetsProps { doc: Screenplay; breakdown: DirectorBreakdownItem[]; onJumpToScene: (sceneIndex: number) => void }
  export function DirectorScriptAssets(props: DirectorScriptAssetsProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/director-script-assets.tsx`:

```tsx
import { useState } from 'react';
import type { Screenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import type { DirectorBreakdownItem } from '@/types/director';

interface DirectorScriptAssetsProps {
  doc: Screenplay;
  breakdown: DirectorBreakdownItem[];
  onJumpToScene: (sceneIndex: number) => void;
}

type Tab = 'scenes' | 'character' | 'location' | 'prop';

export function DirectorScriptAssets({ doc, breakdown, onJumpToScene }: DirectorScriptAssetsProps) {
  const [tab, setTab] = useState<Tab>('scenes');
  const scenes = splitScenes(doc);
  const byKind = (k: 'character' | 'location' | 'prop') => breakdown.filter((b) => b.kind === k);

  return (
    <>
      <div className="dast-tabs">
        <button type="button" className={`dast-tab${tab === 'scenes' ? ' dast-tab--on' : ''}`} onClick={() => setTab('scenes')}>Scenes<span className="cnt">{scenes.length}</span></button>
        <button type="button" className={`dast-tab${tab === 'character' ? ' dast-tab--on' : ''}`} onClick={() => setTab('character')}><span className="dast-pip dast-pip--character" />Cast<span className="cnt">{byKind('character').length}</span></button>
        <button type="button" className={`dast-tab${tab === 'location' ? ' dast-tab--on' : ''}`} onClick={() => setTab('location')}><span className="dast-pip dast-pip--location" />Loc<span className="cnt">{byKind('location').length}</span></button>
        <button type="button" className={`dast-tab${tab === 'prop' ? ' dast-tab--on' : ''}`} onClick={() => setTab('prop')}><span className="dast-pip dast-pip--prop" />Props<span className="cnt">{byKind('prop').length}</span></button>
      </div>
      <div style={{ padding: 12 }}>
        {tab === 'scenes' ? (
          scenes.length === 0 ? <p className="director-tab__empty">No scenes yet.</p> :
          scenes.map((s) => (
            <button key={s.index} type="button" className="dbk-navitem" style={{ width: '100%', textAlign: 'left' }} onClick={() => onJumpToScene(s.index)}>
              <div className="dbk-navnum">SC{s.index + 1}</div>
              <div className="dbk-navttl">{s.heading || '(untitled scene)'}</div>
            </button>
          ))
        ) : (
          byKind(tab).length === 0 ? <p className="director-tab__empty">None yet.</p> :
          byKind(tab).map((b) => (
            <div key={b.id} className="director-tab__item" style={{ marginBottom: 6 }}>
              <span className="director-tab__item-title">{b.name}</span>
              <span className="director-tab__meta">{b.tag}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/director-script-assets.tsx
git commit -m "feat(director): script left assets panel (scenes/cast/loc/props)"
```

---

### Task 10: Script chat assistant (`director-script-chat.tsx`)

**Files:**
- Create: `src/components/director/director-script-chat.tsx`

**Interfaces:**
- Consumes: `invokeCliCopilotChat`, `cancelCliCopilotChat` from `@/lib/llm/cli-copilot-client`; `SCRIPT_ASSISTANT_SYSTEM_PROMPT`, `buildAssistantMessage`, `parseAssistantResponse`, `AssistantResponse` from `@/lib/director/script-assistant`; `Screenplay` from `@/lib/director/screenplay`; `CliLlmProviderId` from `@/lib/llm/claude-code-session`.
- Produces:
  ```ts
  interface DirectorScriptChatProps {
    doc: Screenplay; provider: CliLlmProviderId; selectedId?: string; selectedText?: string;
    onProposeEdits: (res: AssistantResponse) => void;
  }
  export function DirectorScriptChat(props: DirectorScriptChatProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/director-script-chat.tsx`:

```tsx
import { useState } from 'react';
import type { CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import type { Screenplay } from '@/lib/director/screenplay';
import {
  SCRIPT_ASSISTANT_SYSTEM_PROMPT, buildAssistantMessage, parseAssistantResponse, type AssistantResponse,
} from '@/lib/director/script-assistant';

interface DirectorScriptChatProps {
  doc: Screenplay;
  provider: CliLlmProviderId;
  selectedId?: string;
  selectedText?: string;
  onProposeEdits: (res: AssistantResponse) => void;
}

interface ChatMsg { role: 'user' | 'ai'; text: string }

export function DirectorScriptChat({ doc, provider, selectedId, selectedText, onProposeEdits }: DirectorScriptChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const message = buildAssistantMessage(doc, text, selectedId ? { elementId: selectedId } : undefined);
      const result = await invokeCliCopilotChat(provider, {
        systemPrompt: SCRIPT_ASSISTANT_SYSTEM_PROMPT,
        userMessage: message,
        purpose: 'copilot',
      });
      const res = parseAssistantResponse(result.message);
      setMessages((m) => [...m, { role: 'ai', text: res.reply + (res.edits ? `\n(proposed ${res.edits.length} edit${res.edits.length === 1 ? '' : 's'})` : '') }]);
      if (res.edits?.length) onProposeEdits(res);
    } catch (err) {
      setMessages((m) => [...m, { role: 'ai', text: err instanceof Error ? err.message : 'Assistant failed.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dch-head"><span>🤖</span><span style={{ fontSize: 12, fontWeight: 700 }}>Script Assistant</span></div>
      <div className="dch-msgs">
        {messages.length === 0 && <p className="director-tab__empty">Ask about your script, or tell me what to change.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`dch-m dch-m--${m.role === 'user' ? 'user' : 'ai'}`}>{m.text}</div>
        ))}
      </div>
      <div className="dch-composer">
        {selectedId && <span className="dch-sel">◉ Selected: {(selectedText ?? '').slice(0, 42) || 'element'}</span>}
        <textarea
          value={draft}
          placeholder="Ask about your script, or tell me what to write / change…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        />
        <div className="director-tab__row">
          <span className="director-tab__meta" style={{ marginRight: 'auto' }}>Edits appear as an inline diff in the script.</span>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => void send()} disabled={busy}>{busy ? '…' : 'Send'}</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/director-script-chat.tsx
git commit -m "feat(director): script chat assistant (CLI-backed, proposes edits)"
```

---

### Task 11: Assemble the Script tab (`director-script-tab.tsx`)

**Files:**
- Rewrite: `src/components/director/director-script-tab.tsx`

**Interfaces:**
- Consumes Tasks 1, 5, 7, 8, 9, 10 + `parseDirectorLlmProvider` from `@/lib/director/cli-provider`.
- Keeps the existing prop shape `{ show; onChange; onBreakdown }` so `director-tab.tsx` needs no change.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/director/director-script-tab.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { parseToScreenplay, serializeScreenplay, type Screenplay } from '@/lib/director/screenplay';
import { applyAssistantEdits, type AssistantEdit, type AssistantResponse } from '@/lib/director/script-assistant';
import { parseDirectorLlmProvider } from '@/lib/director/cli-provider';
import { CollapsiblePanel } from './collapsible-panel';
import { ScreenplayEditor, ELEMENT_TYPES } from './screenplay-editor';
import { DirectorScriptAssets } from './director-script-assets';
import { DirectorScriptChat } from './director-script-chat';

interface DirectorScriptTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onBreakdown: () => void;
}

export function DirectorScriptTab({ show, onChange, onBreakdown }: DirectorScriptTabProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pending, setPending] = useState<AssistantEdit[] | undefined>();
  const [scriptError, setScriptError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doc = useMemo<Screenplay>(() => parseToScreenplay(show.sourceText), [show.sourceText]);

  const setDoc = (next: Screenplay) => onChange({ ...show, sourceText: serializeScreenplay(next) });

  const loadScript = async (file: File | undefined) => {
    if (!file) return;
    setScriptError('');
    try {
      const raw = await file.text();
      const text = extractScriptText(file.name, raw);
      if (!text.trim()) throw new Error('That file did not contain readable script text.');
      onChange({ ...show, sourceText: text, sourceFileName: file.name });
    } catch (error) {
      setScriptError(error instanceof Error ? error.message : 'Could not read that script.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const selectedText = doc.elements.find((e) => e.id === selectedId)?.text;
  const currentType = doc.elements.find((e) => e.id === selectedId)?.type;

  const acceptEdits = () => { if (pending) { setDoc(applyAssistantEdits(doc, pending)); setPending(undefined); } };
  const declineEdits = () => setPending(undefined);

  // scroll the editor to the Nth scene heading (spec: Scenes navigator scrolls the editor)
  const jumpToScene = (sceneIndex: number) => {
    const headings = doc.elements.filter((e) => e.type === 'scene');
    const target = headings[sceneIndex];
    if (!target) return;
    const node = document.querySelector(`[data-el-id="${target.id}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSelectedId(target.id);
  };

  return (
    <div className="director-tab" style={{ height: '100%' }}>
      <div className="director-tab__toolbar">
        <span className="director-tab__label" style={{ margin: 0 }}>Script</span>
        {show.sourceFileName && <span className="director-tab__meta">{show.sourceFileName}</span>}
        <input ref={fileRef} type="file" accept={SCRIPT_ACCEPT} className="director-tab__file-input" onChange={(e) => void loadScript(e.target.files?.[0])} />
        <div className="director-tab__row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="director-tab__btn" onClick={() => fileRef.current?.click()}>⬆ Upload</button>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onBreakdown} disabled={!show.sourceText.trim()}>Run breakdown →</button>
        </div>
      </div>
      {scriptError && <p className="director-tab__warn" style={{ padding: '0 16px' }}>{scriptError}</p>}

      <div className="dse-shell" data-left={leftOpen ? 'open' : 'closed'} data-right={rightOpen ? 'open' : 'closed'}>
        {!leftOpen && <button type="button" className="dse-reopen dse-reopen--left" onClick={() => setLeftOpen(true)} title="Show panel">›</button>}
        {!rightOpen && <button type="button" className="dse-reopen dse-reopen--right" onClick={() => setRightOpen(true)} title="Show assistant">‹</button>}

        {leftOpen && (
          <CollapsiblePanel side="left" open={leftOpen} onToggle={setLeftOpen}>
            <DirectorScriptAssets doc={doc} breakdown={show.breakdown} onJumpToScene={jumpToScene} />
          </CollapsiblePanel>
        )}

        <ScreenplayEditor
          doc={doc}
          selectedId={selectedId}
          pendingEdits={pending}
          onChange={setDoc}
          onSelect={setSelectedId}
          onAcceptEdits={acceptEdits}
          onDeclineEdits={declineEdits}
        />

        {rightOpen && (
          <CollapsiblePanel side="right" open={rightOpen} onToggle={setRightOpen}>
            <DirectorScriptChat
              doc={doc}
              provider={parseDirectorLlmProvider(show.llmProvider)}
              selectedId={selectedId}
              selectedText={selectedText}
              onProposeEdits={(res: AssistantResponse) => setPending(res.edits)}
            />
          </CollapsiblePanel>
        )}
      </div>

      <div className="dse-legend">
        {ELEMENT_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dse-leg${currentType === t.id ? ' dse-leg--on' : ''}`}
            onClick={() => { if (selectedId) setDoc({ elements: doc.elements.map((e) => (e.id === selectedId ? { ...e, type: t.id } : e)) }); }}
          >
            <span className="sw" style={{ background: t.color }} /><span className="nm">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles + full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. Fix unused-import issues if any.

- [ ] **Step 3: Run the director test suite (no logic regressions)**

Run: `npx vitest run tests/lib/director/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/director/director-script-tab.tsx
git commit -m "feat(director): assemble Script tab (editor + collapsible assets + chat + legend)"
```

---

### Task 12: Scene script view (`scene-script-view.tsx`)

**Files:**
- Create: `src/components/director/scene-script-view.tsx`

**Interfaces:**
- Consumes: `ScriptScene` from `@/lib/director/scene-split`; `highlightRuns` from `@/lib/director/scene-assets`; `DirectorBreakdownItem`, `BreakdownKind` from `@/types/director`.
- Produces:
  ```ts
  interface SceneScriptViewProps { scene: ScriptScene; breakdown: DirectorBreakdownItem[]; onAssetClick: (kind: BreakdownKind, name: string) => void }
  export function SceneScriptView(props: SceneScriptViewProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/scene-script-view.tsx`:

```tsx
import type { ScriptScene } from '@/lib/director/scene-split';
import { highlightRuns } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem } from '@/types/director';

interface SceneScriptViewProps {
  scene: ScriptScene;
  breakdown: DirectorBreakdownItem[];
  onAssetClick: (kind: BreakdownKind, name: string) => void;
}

export function SceneScriptView({ scene, breakdown, onAssetClick }: SceneScriptViewProps) {
  return (
    <div className="dbk-scenecol">
      <div className="dse-paper">
        {scene.elements.map((el) => (
          <div key={el.id} className={`dse-el dse-el--${el.type}`}>
            {highlightRuns(el.text, breakdown).map((run, i) =>
              run.kind ? (
                <mark
                  key={i}
                  className={`dbk-mark dbk-mark--${run.kind}`}
                  title={`Jump to ${run.text}`}
                  onClick={() => onAssetClick(run.kind as BreakdownKind, run.text)}
                >{run.text}</mark>
              ) : (
                <span key={i}>{run.text}</span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/scene-script-view.tsx
git commit -m "feat(director): scene script view with colored click-through highlights"
```

---

### Task 13: Scene assets panel (`scene-assets-panel.tsx`)

**Files:**
- Create: `src/components/director/scene-assets-panel.tsx`

**Interfaces:**
- Consumes: `resolveSceneAssets` from `@/lib/director/scene-assets`; `ScriptScene` from `@/lib/director/scene-split`; `DirectorShow`, `DirectorBreakdownItem`, `BreakdownKind` from `@/types/director`; `Element` from `@/types/elements`; `findMatchingElement` from `@/lib/director/breakdown`.
- Produces:
  ```ts
  interface SceneAssetsPanelProps {
    show: DirectorShow; scene: ScriptScene; sceneIndex: number; elements: Element[];
    activeKind: 'all' | BreakdownKind; focusName?: string;
    onSetKind: (k: 'all' | BreakdownKind) => void;
    onRemove: (tag: string) => void; onGenerateRef: (item: DirectorBreakdownItem) => void;
  }
  export function SceneAssetsPanel(props: SceneAssetsPanelProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/scene-assets-panel.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { ScriptScene } from '@/lib/director/scene-split';
import { resolveSceneAssets } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import { findMatchingElement } from '@/lib/director/breakdown';

interface SceneAssetsPanelProps {
  show: DirectorShow;
  scene: ScriptScene;
  sceneIndex: number;
  elements: Element[];
  activeKind: 'all' | BreakdownKind;
  focusName?: string;
  onSetKind: (k: 'all' | BreakdownKind) => void;
  onRemove: (tag: string) => void;
  onGenerateRef: (item: DirectorBreakdownItem) => void;
}

const KIND_LABEL: Record<BreakdownKind, string> = { character: 'Characters', location: 'Locations', prop: 'Props', vehicle: 'Vehicles' };

export function SceneAssetsPanel({ show, scene, sceneIndex, elements, activeKind, focusName, onSetKind, onRemove, onGenerateRef }: SceneAssetsPanelProps) {
  const resolved = resolveSceneAssets(show, sceneIndex, show.breakdown, scene);
  const counts = { character: 0, location: 0, prop: 0, vehicle: 0 } as Record<BreakdownKind, number>;
  resolved.forEach((r) => { counts[r.item.kind] += 1; });
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusName && flashRef.current) {
      flashRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashRef.current.classList.remove('dbk-card--flash');
      void flashRef.current.offsetWidth;
      flashRef.current.classList.add('dbk-card--flash');
    }
  }, [focusName]);

  const kinds: BreakdownKind[] = activeKind === 'all' ? ['character', 'location', 'prop', 'vehicle'] : [activeKind];
  const refImage = (item: DirectorBreakdownItem): string | undefined => {
    const el = elements.find((e) => e.id === item.elementId) ?? findMatchingElement(elements, item);
    return el?.images?.[0]?.url;
  };

  return (
    <>
      <div className="dast-tabs">
        <button type="button" className={`dast-tab${activeKind === 'all' ? ' dast-tab--on' : ''}`} onClick={() => onSetKind('all')}>All<span className="cnt">{resolved.length}</span></button>
        {(['character', 'location', 'prop'] as BreakdownKind[]).map((k) => (
          <button key={k} type="button" className={`dast-tab${activeKind === k ? ' dast-tab--on' : ''}`} onClick={() => onSetKind(k)}>
            <span className={`dast-pip dast-pip--${k}`} />{KIND_LABEL[k]}<span className="cnt">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: 12 }}>
        {kinds.map((kind) => {
          const items = resolved.filter((r) => r.item.kind === kind);
          if (activeKind === 'all' && items.length === 0) return null;
          return (
            <div key={kind} style={{ marginBottom: 10 }}>
              <span className="director-tab__label">{KIND_LABEL[kind]} ({items.length})</span>
              {items.length === 0 && <p className="director-tab__empty">None in this scene.</p>}
              {items.map(({ item, source }) => {
                const img = refImage(item);
                const linked = item.elementId || findMatchingElement(elements, item)?.id;
                const status = source === 'ai' ? 'ai' : linked ? 'linked' : 'missing';
                return (
                  <div
                    key={item.tag}
                    className="dbk-card"
                    ref={focusName && item.name === focusName ? flashRef : undefined}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div className={`dbk-icn dbk-icn--${kind}`}>
                        {img ? <img src={img} alt={item.name} /> : (kind === 'character' ? item.name[0] : '▢')}
                      </div>
                      <div>
                        <div className="director-tab__item-title">{item.name}</div>
                        <div className="director-tab__meta">{item.tag}{kind === 'location' && (item.intExt || item.timeOfDay || scene.timeOfDay) ? <span className="dbk-tod">{(item.intExt || scene.intExt || '') + ' · ' + (item.timeOfDay || scene.timeOfDay || '')}</span> : null}</div>
                      </div>
                      <span className={`dbk-status dbk-status--${status}`}>{status === 'ai' ? '● AI-added' : status === 'linked' ? '● linked' : '○ missing'}</span>
                      <button type="button" className="director-tab__btn" style={{ padding: '2px 7px', marginLeft: 6 }} title="Remove from scene" onClick={() => onRemove(item.tag)}>✕</button>
                    </div>
                    {item.blurb && <p className="director-tab__meta" style={{ marginTop: 7 }}>{item.blurb}</p>}
                    <div className="director-tab__row" style={{ marginTop: 8 }}>
                      <button type="button" className="director-tab__btn" onClick={() => onGenerateRef(item)}>{img ? 'Generate ref' : '+ Add ref'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/scene-assets-panel.tsx
git commit -m "feat(director): per-scene assets panel (tabs, ref thumbnails, tod badge, actions)"
```

---

### Task 14: Assemble the Breakdown tab (`director-breakdown-tab.tsx`)

**Files:**
- Rewrite: `src/components/director/director-breakdown-tab.tsx`

**Interfaces:**
- Consumes Tasks 1, 2, 12, 13. Keeps the existing prop shape `{ show; elements; onApprove; onCreateMissing; onOpenElements }`; adds `onChange` (already available as `setShow` in `director-tab.tsx`) — update the one call site.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/director/director-breakdown-tab.tsx`:

```tsx
import { useState } from 'react';
import type { Element } from '@/types/elements';
import type { BreakdownKind, DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import { SceneScriptView } from './scene-script-view';
import { SceneAssetsPanel } from './scene-assets-panel';

interface DirectorBreakdownTabProps {
  show: DirectorShow;
  elements: Element[];
  onChange: (show: DirectorShow) => void;
  onApprove: () => void;
  onCreateMissing: () => void;
  onOpenElements: () => void;
}

export function DirectorBreakdownTab({ show, elements, onChange, onApprove, onCreateMissing, onOpenElements }: DirectorBreakdownTabProps) {
  const scenes = splitScenes(parseToScreenplay(show.sourceText));
  const [sceneIndex, setSceneIndex] = useState(0);
  const [activeKind, setActiveKind] = useState<'all' | BreakdownKind>('all');
  const [focusName, setFocusName] = useState<string | undefined>();
  const scene = scenes[sceneIndex] ?? scenes[0];

  if (!scene) {
    return <div className="director-tab__stage"><p className="director-tab__empty">Run a breakdown from the Script tab to populate scenes.</p></div>;
  }

  const removeFromScene = (tag: string) => {
    const ov = show.sceneAssetOverrides?.[sceneIndex] ?? { added: [], removed: [] };
    const next = { added: ov.added.filter((t) => t !== tag), removed: [...new Set([...ov.removed, tag])] };
    onChange({ ...show, sceneAssetOverrides: { ...show.sceneAssetOverrides, [sceneIndex]: next } });
  };

  const onAssetClick = (kind: BreakdownKind, name: string) => {
    if (activeKind !== 'all' && activeKind !== kind) setActiveKind(kind);
    setFocusName(undefined);
    // set on next tick so the effect re-fires even if the name repeats
    requestAnimationFrame(() => setFocusName(name));
  };

  return (
    <div className="dbk-shell">
      <aside className="dbk-nav">
        <div className="director-tab__row" style={{ marginBottom: 10 }}>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onApprove} disabled={show.breakdown.length === 0 || show.breakdownApproved}>{show.breakdownApproved ? 'Approved' : 'Approve →'}</button>
        </div>
        <span className="director-tab__label">Scenes</span>
        {scenes.map((s) => (
          <div key={s.index} className={`dbk-navitem${s.index === sceneIndex ? ' dbk-navitem--on' : ''}`} onClick={() => { setSceneIndex(s.index); setActiveKind('all'); }}>
            <div className="dbk-navnum">SC{s.index + 1}</div>
            <div className="dbk-navttl">{s.heading || '(untitled scene)'}</div>
          </div>
        ))}
        <div className="director-tab__row" style={{ marginTop: 10 }}>
          <button type="button" className="director-tab__btn" onClick={onCreateMissing}>Create missing</button>
          <button type="button" className="director-tab__btn" onClick={onOpenElements}>Generate refs</button>
        </div>
      </aside>

      <SceneScriptView scene={scene} breakdown={show.breakdown} onAssetClick={onAssetClick} />

      <aside className="dbk-assets">
        <SceneAssetsPanel
          show={show}
          scene={scene}
          sceneIndex={sceneIndex}
          elements={elements}
          activeKind={activeKind}
          focusName={focusName}
          onSetKind={setActiveKind}
          onRemove={removeFromScene}
          onGenerateRef={() => onOpenElements()}
        />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Update the call site in `director-tab.tsx`**

In `src/components/director/director-tab.tsx`, find the `<DirectorBreakdownTab ... />` render and add the `onChange={setShow}` prop:
```tsx
<DirectorBreakdownTab show={show} elements={state.elements} onChange={setShow} onApprove={approveBreakdown} onCreateMissing={createMissing} onOpenElements={() => dispatch({ type: 'SET_TAB', tab: 'elements' })} />
```

- [ ] **Step 3: Verify full typecheck + director tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.
Run: `npx vitest run tests/lib/director/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/director/director-breakdown-tab.tsx src/components/director/director-tab.tsx
git commit -m "feat(director): assemble per-scene Breakdown tab (nav + scene script + assets)"
```

---

### Task 15: Full-suite verification + manual drive

- [ ] **Step 1: Full typecheck and director suite**

Run: `npx tsc --noEmit -p tsconfig.json` → clean.
Run: `npx vitest run tests/lib/director/` → all pass (screenplay, scene-split, scene-assets, script-assistant, breakdown-extraction, plus prior director tests).

- [ ] **Step 2: Manual drive (no new code)**

Launch the app; on the Director → Script tab: type in the paper, Tab/Shift+Tab cycles the focused element's type, Enter after a character makes a dialogue line, the bottom legend highlights the current type and clicking a chip sets it, both side panels collapse/expand via notches. Ask the chat assistant to rewrite a line → an inline diff appears with Accept/Decline; Accept updates the script.
On the Breakdown tab: scenes list on the left, selected scene's script shows colored highlights, clicking a highlight switches the asset tab and flashes the card, asset tabs filter (All/Characters/Locations/Props) and scroll horizontally, location cards show INT/EXT · time-of-day, cards show ref thumbnails when the linked Element has an image.

- [ ] **Step 3: Commit any fixes**

If manual testing surfaces a fix, commit it. Otherwise no commit.

---

## Self-Review Notes

- **Spec coverage:** document model (T1), scene split + heading parse (T2), scene-asset detect + tokenizer + merge resolver (T3), model fields + extraction-quality prompt (T4), assistant contract (T5), CSS (T6), collapsible primitive (T7), editor engine + inline diff (T8), left assets panel (T9), chat assistant (T10), Script tab assembly incl. bottom legend + collapse + upload (T11), scene script view w/ click-through (T12), per-scene assets panel w/ tabs + ref thumbnails + tod badge + actions (T13), Breakdown assembly incl. scene nav + manual remove override (T14), verification (T15). Covered.
- **Type consistency:** `ScreenplayElementType` union & order identical across T1/T8/T11; `Screenplay`/`ScreenplayElement` shared; `AssistantEdit`/`AssistantResponse` consistent T5/T8/T10/T11; `resolveSceneAssets`/`highlightRuns`/`detectSceneAssets` signatures consistent T3/T12/T13; `DirectorShow` new fields used exactly as declared in T4.
- **No placeholders:** every code step is complete; no TBD/TODO.
- **Scene navigator scroll:** T11's `jumpToScene` scrolls the editor to the Nth scene heading via its `data-el-id` (added to the editor element in T8) and selects it — satisfies the spec's "click to scroll the editor to that scene."
