# Director Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Director page's always-on 3-column grid with a four-tab workbench (Script / Breakdown / Shotlist / Generate) that includes a formatted, editable screenplay Script view.

**Architecture:** A layout reorganization, not a logic rewrite. `director-tab.tsx` keeps all state and handlers; it renders a toolbar with mode tabs (driven by `show.mode`), toolbar drawers for Setup and Look bible, a persistent structure rail on Shotlist/Generate, and one mounted tab component at a time. The old `director-source-panel`, `director-board`, and `director-inspector` decompose into per-tab components. The only new logic is a pure `parseScreenplay()` function for the formatted view.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`@/` path alias → `src/`), existing `director-tab.css` theme tokens, Electron (`window.electronAPI`).

## Global Constraints

- Test runner: `npx vitest run <path>` — tests live under `tests/`, import source via `@/…`.
- Do NOT change breakdown/shotlist/generate/rewrite/look-bible LLM logic, `extractScriptText`, the upload path, or the video adapters.
- Do NOT migrate `DirectorShow` state. The Script tab reuses the existing `'source'` `DirectorMode` id.
- The active tab is derived from `show.mode`; setting `show.mode` switches tabs. `DirectorMode = 'source' | 'breakdown' | 'shotlist' | 'generate'` (unchanged).
- Reuse existing helpers: `selectedClip`, `selectedScene`, `setClipVariant`, `setHeroTake`, `updateDirectorClip`, `keepPendingRewrite`, `discardPendingRewrite` from `@/lib/director/director-state`; `findMatchingElement`, `itemsMissingElements` from `@/lib/director/breakdown`.
- Match existing style conventions: BEM-ish `director-tab__*` classes in `src/styles/director-tab.css`, theme CSS vars (`--bg-*`, `--text-*`, `--accent*`, `--radius-sm`).
- Commit after every task.

---

### Task 1: Screenplay parser (`parseScreenplay`)

The only new logic. Pure, unit-tested first (TDD).

**Files:**
- Create: `src/lib/director/script-format.ts`
- Test: `tests/lib/director/script-format.test.ts`

**Interfaces:**
- Consumes: nothing (pure string in).
- Produces:
  ```ts
  export type ScriptLineType =
    | 'scene-heading' | 'transition' | 'character'
    | 'parenthetical' | 'dialogue' | 'action';
  export interface ScriptLine { type: ScriptLineType; text: string; sceneIndex?: number }
  export function parseScreenplay(source: string): ScriptLine[];
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/script-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseScreenplay } from '@/lib/director/script-format';

describe('parseScreenplay', () => {
  it('detects scene headings and increments sceneIndex', () => {
    const lines = parseScreenplay('INT. ROOFTOP — NIGHT\n\nEXT. ALLEY — DAY');
    const headings = lines.filter((l) => l.type === 'scene-heading');
    expect(headings).toHaveLength(2);
    expect(headings[0].sceneIndex).toBe(0);
    expect(headings[1].sceneIndex).toBe(1);
  });

  it('classifies a character cue and the dialogue block after it', () => {
    const lines = parseScreenplay('MAYA\nThey are already inside.\n\nRain falls.');
    expect(lines[0]).toMatchObject({ type: 'character', text: 'MAYA' });
    expect(lines[1]).toMatchObject({ type: 'dialogue', text: 'They are already inside.' });
    expect(lines[3]).toMatchObject({ type: 'action', text: 'Rain falls.' });
  });

  it('classifies parentheticals inside a dialogue block', () => {
    const lines = parseScreenplay('DANE\n(quietly)\nWhere is the case?');
    expect(lines[1]).toMatchObject({ type: 'parenthetical', text: '(quietly)' });
    expect(lines[2]).toMatchObject({ type: 'dialogue' });
  });

  it('classifies transitions', () => {
    const lines = parseScreenplay('She runs.\n\nCUT TO:');
    expect(lines.at(-1)).toMatchObject({ type: 'transition', text: 'CUT TO:' });
  });

  it('treats a long all-caps line as action, not a character cue', () => {
    const long = 'THIS IS A VERY LONG ALL CAPS SENTENCE THAT IS CLEARLY NOT A NAME';
    const lines = parseScreenplay(long);
    expect(lines[0].type).toBe('action');
  });

  it('falls back to action for plain prose', () => {
    const lines = parseScreenplay('Just a plain idea about two thieves.');
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('action');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/script-format.test.ts`
Expected: FAIL — cannot resolve `@/lib/director/script-format`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/script-format.ts`:

```ts
export type ScriptLineType =
  | 'scene-heading'
  | 'transition'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'action';

export interface ScriptLine {
  type: ScriptLineType;
  text: string;
  /** 0-based scene number; set on scene-heading lines. */
  sceneIndex?: number;
}

const SCENE_HEADING = /^\s*(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\s.]/i;
const TRANSITION = /(TO:|^FADE (IN|OUT)|^DISSOLVE|^SMASH CUT|^MATCH CUT)/;

function isAllCaps(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

function isCharacterCue(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 30) return false;
  if (SCENE_HEADING.test(t)) return false;
  return isAllCaps(t) && !t.endsWith(':');
}

export function parseScreenplay(source: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  let sceneIndex = -1;
  let inDialogue = false;
  const rawLines = source.replace(/^﻿/, '').split('\n');

  for (const raw of rawLines) {
    const t = raw.trim();

    if (t === '') {
      out.push({ type: 'action', text: '' });
      inDialogue = false;
      continue;
    }
    if (SCENE_HEADING.test(t)) {
      sceneIndex += 1;
      out.push({ type: 'scene-heading', text: t, sceneIndex });
      inDialogue = false;
      continue;
    }
    if (isAllCaps(t) && TRANSITION.test(t)) {
      out.push({ type: 'transition', text: t });
      inDialogue = false;
      continue;
    }
    if (isCharacterCue(t)) {
      out.push({ type: 'character', text: t });
      inDialogue = true;
      continue;
    }
    if (inDialogue && /^\(.*\)$/.test(t)) {
      out.push({ type: 'parenthetical', text: t });
      continue;
    }
    if (inDialogue) {
      out.push({ type: 'dialogue', text: t });
      continue;
    }
    out.push({ type: 'action', text: t });
  }

  return out;
}
```

Note on the empty-line test: `parseScreenplay('MAYA\nThey are already inside.\n\nRain falls.')` yields indices `[character, dialogue, action(''), action('Rain falls.')]`, so `lines[3]` is `Rain falls.` as asserted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/script-format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/script-format.ts tests/lib/director/script-format.test.ts
git commit -m "feat(director): pure screenplay parser for formatted script view"
```

---

### Task 2: CSS for tabs, drawers, rail, script formatting

Add the new layout/style classes up front so every later task can use them. Additive to `director-tab.css`; do not remove existing classes yet (old panels still mounted until Task 8).

**Files:**
- Modify: `src/styles/director-tab.css` (append new classes)

**Interfaces:**
- Produces CSS classes consumed by Tasks 3–8:
  `director-tab__stagetabs`, `director-tab__stab`, `director-tab__stab--active`, `director-tab__stab-badge`, `director-tab__stab-dot`, `director-tab__drawer`, `director-tab__drawer--open`, `director-tab__workbench`, `director-tab__rail`, `director-tab__stage`, `director-tab__scene`, `director-tab__scene-head`, `director-tab__scene--active`, `director-tab__rail-clip`, `director-tab__rail-clip--active`, `director-tab__cards`, `director-tab__card`, `director-tab__card-kind`, `director-tab__badge`, `director-tab__badge--linked`, `director-tab__badge--missing`, `director-tab__board`, `director-tab__clipcard`, `director-tab__clipcard--active`, `director-tab__editor`, `director-tab__fmt`, `director-tab__fmt-scene`, `director-tab__fmt-cue`, `director-tab__fmt-dialogue`, `director-tab__fmt-paren`, `director-tab__fmt-transition`, `director-tab__fmt-action`.

- [ ] **Step 1: Append the new classes**

Append to `src/styles/director-tab.css`:

```css
/* ── Redesign: stage tabs ───────────────────────────── */
.director-tab__stagetabs { display:flex; gap:4px; background:var(--bg-input); padding:4px; border-radius:12px; }
.director-tab__stab { display:flex; align-items:center; gap:7px; padding:6px 15px; border:none; border-radius:9px; background:transparent; color:var(--text-secondary); font-size:12.5px; font-weight:600; cursor:pointer; }
.director-tab__stab:hover { color:var(--text-primary); }
.director-tab__stab--active { background:var(--accent); color:var(--bg-base); }
.director-tab__stab-badge { background:var(--border-medium); color:var(--text-secondary); border-radius:8px; font-size:10px; padding:0 6px; font-weight:700; }
.director-tab__stab--active .director-tab__stab-badge { background:rgba(255,255,255,.25); color:var(--bg-base); }
.director-tab__stab-dot { width:6px; height:6px; border-radius:50%; background:var(--success); }

/* ── Redesign: toolbar drawers ──────────────────────── */
.director-tab__drawer { max-height:0; overflow:hidden; transition:max-height .2s ease; background:var(--bg-raised); border-bottom:1px solid var(--border-subtle); }
.director-tab__drawer--open { max-height:480px; }
.director-tab__drawer-inner { display:flex; flex-wrap:wrap; gap:16px; padding:14px 16px; align-items:flex-end; }

/* ── Redesign: workbench (rail + stage) ─────────────── */
.director-tab__workbench { display:grid; grid-template-columns:240px minmax(0,1fr); min-height:0; flex:1; }
.director-tab__workbench--norail { grid-template-columns:minmax(0,1fr); }
.director-tab__rail { min-height:0; overflow:auto; padding:12px; border-right:1px solid var(--border-subtle); display:flex; flex-direction:column; gap:8px; background:var(--bg-raised); }
.director-tab__stage { min-height:0; overflow:auto; padding:16px 20px; display:flex; flex-direction:column; gap:14px; }

/* ── Redesign: structure rail tree ──────────────────── */
.director-tab__scene { border:1px solid var(--border-subtle); border-radius:var(--radius-sm); background:var(--bg-base); overflow:hidden; }
.director-tab__scene-head { width:100%; text-align:left; padding:8px 10px; display:flex; justify-content:space-between; align-items:center; background:transparent; border:none; color:inherit; cursor:pointer; }
.director-tab__scene-head:hover { background:var(--bg-elevated); }
.director-tab__scene--active > .director-tab__scene-head { background:var(--accent-dim); }
.director-tab__rail-clip { width:100%; text-align:left; padding:6px 10px 6px 20px; font-size:12px; color:var(--text-secondary); border:none; border-top:1px solid var(--border-subtle); background:transparent; cursor:pointer; display:flex; justify-content:space-between; }
.director-tab__rail-clip:hover { background:var(--bg-elevated); color:var(--text-primary); }
.director-tab__rail-clip--active { background:var(--accent-dim); color:var(--accent); }

/* ── Redesign: breakdown cards ──────────────────────── */
.director-tab__cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
.director-tab__card { border:1px solid var(--border-subtle); border-radius:9px; background:var(--bg-raised); padding:12px; }
.director-tab__card-kind { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); font-weight:700; }
.director-tab__badge { display:inline-block; font-size:10px; padding:2px 7px; border-radius:8px; font-weight:600; margin-top:8px; }
.director-tab__badge--linked { background:var(--accent-dim); color:var(--success); }
.director-tab__badge--missing { background:var(--bg-elevated); color:var(--error); }

/* ── Redesign: shotlist board ───────────────────────── */
.director-tab__board { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:12px; }
.director-tab__clipcard { text-align:left; border:1px solid var(--border-subtle); border-radius:9px; background:var(--bg-raised); overflow:hidden; cursor:pointer; color:inherit; padding:0; }
.director-tab__clipcard--active { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
.director-tab__clipcard-body { padding:9px 11px; }

/* ── Redesign: script editor + formatted view ───────── */
.director-tab__editor { width:100%; flex:1; min-height:320px; background:var(--bg-input); border:1px solid var(--border-medium); border-radius:var(--radius-sm); padding:16px 18px; color:var(--text-primary); font-family:'Space Mono',monospace; font-size:12.5px; line-height:1.7; resize:none; white-space:pre-wrap; }
.director-tab__fmt { flex:1; min-height:320px; overflow:auto; background:var(--bg-input); border:1px solid var(--border-medium); border-radius:var(--radius-sm); padding:20px 48px; }
.director-tab__fmt-scene { color:var(--accent); font-weight:700; margin-top:16px; }
.director-tab__fmt-cue { text-align:center; color:var(--text-primary); font-weight:600; margin-top:12px; }
.director-tab__fmt-dialogue { max-width:340px; margin:0 auto; color:var(--text-primary); }
.director-tab__fmt-paren { max-width:280px; margin:0 auto; color:var(--text-secondary); font-style:italic; }
.director-tab__fmt-transition { text-align:right; color:var(--text-secondary); font-weight:600; margin-top:12px; }
.director-tab__fmt-action { color:var(--text-primary); margin-top:4px; }
```

- [ ] **Step 2: Verify the app still builds**

Run: `npx tsc --noEmit -p tsconfig.json` (CSS-only change; confirm no TS breakage).
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/director-tab.css
git commit -m "style(director): add tab/drawer/rail/script-format classes"
```

---

### Task 3: Structure rail component

Extract the scenes→clips tree from the Board into a standalone rail used by Shotlist and Generate tabs.

**Files:**
- Create: `src/components/director/director-structure-rail.tsx`

**Interfaces:**
- Consumes: `selectedScene`, `selectedClip` from `@/lib/director/director-state`; `DirectorShow` from `@/types/director`.
- Produces:
  ```ts
  interface DirectorStructureRailProps {
    show: DirectorShow;
    onSelectScene: (sceneId: string) => void;
    onSelectClip: (sceneId: string, clipId: string) => void;
  }
  export function DirectorStructureRail(props: DirectorStructureRailProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/director-structure-rail.tsx`:

```tsx
import type { DirectorShow } from '@/types/director';
import { selectedClip, selectedScene } from '@/lib/director/director-state';

interface DirectorStructureRailProps {
  show: DirectorShow;
  onSelectScene: (sceneId: string) => void;
  onSelectClip: (sceneId: string, clipId: string) => void;
}

export function DirectorStructureRail({ show, onSelectScene, onSelectClip }: DirectorStructureRailProps) {
  const activeScene = selectedScene(show);
  const activeClip = selectedClip(show);

  if (show.scenes.length === 0) {
    return (
      <aside className="director-tab__rail">
        <span className="director-tab__label">Structure</span>
        <p className="director-tab__empty">Approve a breakdown, then run a shotlist to fill this rail.</p>
      </aside>
    );
  }

  return (
    <aside className="director-tab__rail">
      <span className="director-tab__label">Structure</span>
      {show.scenes.map((scene) => {
        const clips = show.clips.filter((clip) => clip.sceneId === scene.id);
        return (
          <div key={scene.id} className={`director-tab__scene${scene.id === activeScene?.id ? ' director-tab__scene--active' : ''}`}>
            <button type="button" className="director-tab__scene-head" onClick={() => onSelectScene(scene.id)}>
              <span className="director-tab__item-title">{scene.label}</span>
              <span className="director-tab__meta">{clips.length} clips</span>
            </button>
            {clips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                className={`director-tab__rail-clip${clip.id === activeClip?.id ? ' director-tab__rail-clip--active' : ''}`}
                onClick={() => onSelectClip(scene.id, clip.id)}
              >
                <span>{clip.id} — {clip.title}</span>
                <span className="director-tab__meta">{clip.seconds}s · {clip.beats.length}</span>
              </button>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/director-structure-rail.tsx
git commit -m "feat(director): extract structure rail component"
```

---

### Task 4: Script tab component

Full-width editable textarea + formatted screenplay view using `parseScreenplay` from Task 1.

**Files:**
- Create: `src/components/director/director-script-tab.tsx`

**Interfaces:**
- Consumes: `parseScreenplay`, `ScriptLine` from `@/lib/director/script-format`; `extractScriptText`, `SCRIPT_ACCEPT` from `@/lib/director/look-bible`; `DirectorShow` from `@/types/director`.
- Produces:
  ```ts
  interface DirectorScriptTabProps {
    show: DirectorShow;
    onChange: (show: DirectorShow) => void;
    onBreakdown: () => void;
  }
  export function DirectorScriptTab(props: DirectorScriptTabProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/director-script-tab.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { extractScriptText, SCRIPT_ACCEPT } from '@/lib/director/look-bible';
import { parseScreenplay, type ScriptLine } from '@/lib/director/script-format';

interface DirectorScriptTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onBreakdown: () => void;
}

const CLASS: Record<ScriptLine['type'], string> = {
  'scene-heading': 'director-tab__fmt-scene',
  transition: 'director-tab__fmt-transition',
  character: 'director-tab__fmt-cue',
  parenthetical: 'director-tab__fmt-paren',
  dialogue: 'director-tab__fmt-dialogue',
  action: 'director-tab__fmt-action',
};

export function DirectorScriptTab({ show, onChange, onBreakdown }: DirectorScriptTabProps) {
  const [formatted, setFormatted] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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

  const words = show.sourceText.trim() ? show.sourceText.trim().split(/\s+/).length : 0;
  const lines = formatted ? parseScreenplay(show.sourceText) : [];

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row" style={{ alignItems: 'center' }}>
        <span className="director-tab__label" style={{ margin: 0 }}>Script</span>
        {show.sourceFileName && <span className="director-tab__meta">{show.sourceFileName}</span>}
        <input
          ref={fileRef}
          type="file"
          accept={SCRIPT_ACCEPT}
          className="director-tab__file-input"
          onChange={(event) => void loadScript(event.target.files?.[0])}
        />
        <div className="director-tab__row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="director-tab__btn" onClick={() => fileRef.current?.click()}>Upload</button>
          <button type="button" className="director-tab__btn" onClick={() => setFormatted((value) => !value)} disabled={!show.sourceText.trim()}>
            {formatted ? 'Edit view' : 'Formatted view'}
          </button>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onBreakdown} disabled={!show.sourceText.trim()}>
            Run breakdown →
          </button>
        </div>
      </div>
      {scriptError && <p className="director-tab__warn">{scriptError}</p>}

      {formatted ? (
        <div className="director-tab__fmt">
          {lines.map((line, index) => (
            <div key={index} className={CLASS[line.type]}>{line.text || ' '}</div>
          ))}
        </div>
      ) : (
        <textarea
          className="director-tab__editor"
          value={show.sourceText}
          spellCheck={false}
          placeholder="Paste a script, treatment, or short idea — or upload .txt, .md, .fountain, .fdx."
          onChange={(event) => onChange({ ...show, sourceText: event.target.value })}
        />
      )}

      <span className="director-tab__meta">{words} words · source of truth for breakdown &amp; shotlist</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/director-script-tab.tsx
git commit -m "feat(director): script tab with editable + formatted screenplay view"
```

---

### Task 5: Breakdown tab + Setup/Look drawers

Card grid for breakdown, plus the render-settings drawer and Look-bible drawer content (Look bible reuses the existing panel).

**Files:**
- Create: `src/components/director/director-breakdown-tab.tsx`
- Create: `src/components/director/director-setup-drawer.tsx`

**Interfaces:**
- Consumes: `findMatchingElement`, `itemsMissingElements` from `@/lib/director/breakdown`; `listDirectorAdapters` from `@/lib/director/video-adapter`; `CLIP_LENGTHS` from `@/types/director`; `Element` from `@/types/elements`.
- Produces:
  ```ts
  interface DirectorBreakdownTabProps {
    show: DirectorShow; elements: Element[];
    onApprove: () => void; onCreateMissing: () => void; onOpenElements: () => void;
  }
  export function DirectorBreakdownTab(props: DirectorBreakdownTabProps): JSX.Element;

  interface DirectorSetupDrawerProps { show: DirectorShow; onChange: (show: DirectorShow) => void; }
  export function DirectorSetupDrawer(props: DirectorSetupDrawerProps): JSX.Element;
  ```

- [ ] **Step 1: Create the breakdown tab**

Create `src/components/director/director-breakdown-tab.tsx`:

```tsx
import type { Element } from '@/types/elements';
import type { DirectorShow } from '@/types/director';
import { findMatchingElement, itemsMissingElements } from '@/lib/director/breakdown';

interface DirectorBreakdownTabProps {
  show: DirectorShow;
  elements: Element[];
  onApprove: () => void;
  onCreateMissing: () => void;
  onOpenElements: () => void;
}

export function DirectorBreakdownTab({ show, elements, onApprove, onCreateMissing, onOpenElements }: DirectorBreakdownTabProps) {
  const missing = itemsMissingElements(show.breakdown, elements);

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row" style={{ alignItems: 'center' }}>
        <span className="director-tab__label" style={{ margin: 0 }}>Breakdown</span>
        <div className="director-tab__row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onApprove} disabled={show.breakdown.length === 0 || show.breakdownApproved}>
            {show.breakdownApproved ? 'Approved' : 'Approve breakdown →'}
          </button>
          <button type="button" className="director-tab__btn" onClick={onCreateMissing} disabled={missing.length === 0}>
            Create missing ({missing.length})
          </button>
          <button type="button" className="director-tab__btn" onClick={onOpenElements}>Generate refs</button>
        </div>
      </div>

      {show.breakdown.length === 0 ? (
        <p className="director-tab__empty">Run a breakdown from the Script tab to list characters, locations, props, and vehicles.</p>
      ) : (
        <div className="director-tab__cards">
          {show.breakdown.map((item) => {
            const linked = item.elementId || findMatchingElement(elements, item)?.id;
            return (
              <div key={item.id} className="director-tab__card">
                <span className="director-tab__card-kind">{item.kind}</span>
                <div className="director-tab__item-title">{item.tag} · {item.name}</div>
                {item.blurb && <span className="director-tab__meta">{item.blurb}</span>}
                <div>
                  <span className={`director-tab__badge ${linked ? 'director-tab__badge--linked' : 'director-tab__badge--missing'}`}>
                    {linked ? '● linked' : '○ missing'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the setup drawer**

Create `src/components/director/director-setup-drawer.tsx`:

```tsx
import type { DirectorShow } from '@/types/director';
import { CLIP_LENGTHS } from '@/types/director';
import { listDirectorAdapters } from '@/lib/director/video-adapter';

interface DirectorSetupDrawerProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
}

export function DirectorSetupDrawer({ show, onChange }: DirectorSetupDrawerProps) {
  const adapters = listDirectorAdapters();
  return (
    <div className="director-tab__drawer-inner">
      <div>
        <label className="director-tab__label" htmlFor="director-length">Clip length</label>
        <select id="director-length" value={show.clipLengthSec} onChange={(event) => onChange({ ...show, clipLengthSec: Number(event.target.value) as typeof show.clipLengthSec })}>
          {CLIP_LENGTHS.map((value) => <option key={value} value={value}>{value}s</option>)}
        </select>
      </div>
      <div>
        <label className="director-tab__label" htmlFor="director-adapter">Adapter</label>
        <select id="director-adapter" value={show.adapterId} onChange={(event) => onChange({ ...show, adapterId: event.target.value })}>
          {adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.label}</option>)}
        </select>
      </div>
      <div>
        <label className="director-tab__label" htmlFor="director-aspect">Aspect</label>
        <select id="director-aspect" value={show.aspectRatio} onChange={(event) => onChange({ ...show, aspectRatio: event.target.value })}>
          {['16:9', '9:16', '1:1', '21:9', '4:3'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div>
        <label className="director-tab__label" htmlFor="director-res">Resolution</label>
        <select id="director-res" value={show.resolution} onChange={(event) => onChange({ ...show, resolution: event.target.value })}>
          {['480p', '720p', '1080p'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={show.generateAudio} onChange={(event) => onChange({ ...show, generateAudio: event.target.checked })} style={{ width: 'auto' }} />
        Generate audio
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Verify both compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/director/director-breakdown-tab.tsx src/components/director/director-setup-drawer.tsx
git commit -m "feat(director): breakdown card tab and setup drawer"
```

---

### Task 6: Shotlist tab component

Rail-paired stage: shotlist buttons + scene event fields + clip board.

**Files:**
- Create: `src/components/director/director-shotlist-tab.tsx`

**Interfaces:**
- Consumes: `selectedScene` from `@/lib/director/director-state`; `DirectorShow`, `DirectorClip` from `@/types/director`.
- Produces:
  ```ts
  interface DirectorShotlistTabProps {
    show: DirectorShow;
    onChange: (show: DirectorShow) => void;
    onShotlist: (sceneOnly: boolean) => void;
    onSelectClip: (sceneId: string, clipId: string) => void;
  }
  export function DirectorShotlistTab(props: DirectorShotlistTabProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/director-shotlist-tab.tsx`:

```tsx
import type { DirectorShow } from '@/types/director';
import { selectedScene } from '@/lib/director/director-state';

interface DirectorShotlistTabProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
  onShotlist: (sceneOnly: boolean) => void;
  onSelectClip: (sceneId: string, clipId: string) => void;
}

export function DirectorShotlistTab({ show, onChange, onShotlist, onSelectClip }: DirectorShotlistTabProps) {
  const scene = selectedScene(show);
  const sceneClips = show.clips.filter((clip) => clip.sceneId === scene?.id);

  return (
    <div className="director-tab__stage">
      <div className="director-tab__row">
        <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onShotlist(false)} disabled={!show.sourceText.trim() || !show.breakdownApproved}>
          Shotlist show
        </button>
        <button type="button" className="director-tab__btn" onClick={() => onShotlist(true)} disabled={!show.selectedSceneId || !show.breakdownApproved}>
          Shotlist scene
        </button>
      </div>

      {show.scenes.length === 0 ? (
        <p className="director-tab__empty">Approve a breakdown, then run a shotlist to fill this board.</p>
      ) : (
        <>
          {scene && (
            <div className="director-tab__fields">
              <div>
                <label className="director-tab__label" htmlFor="director-scene-event">Scene event</label>
                <input
                  id="director-scene-event"
                  value={scene.event ?? ''}
                  placeholder="The one event every character here takes part in or mirrors"
                  onChange={(event) => onChange({ ...show, scenes: show.scenes.map((entry) => entry.id === scene.id ? { ...entry, event: event.target.value } : entry) })}
                />
              </div>
              <div>
                <input
                  value={scene.physicalAction ?? ''}
                  placeholder="Physical action — the surface activity it plays through"
                  onChange={(event) => onChange({ ...show, scenes: show.scenes.map((entry) => entry.id === scene.id ? { ...entry, physicalAction: event.target.value } : entry) })}
                />
              </div>
            </div>
          )}

          <div>
            <span className="director-tab__label">{scene?.label ?? 'Clips'}</span>
            <div className="director-tab__board">
              {sceneClips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className={`director-tab__clipcard${clip.id === show.selectedClipId ? ' director-tab__clipcard--active' : ''}`}
                  onClick={() => onSelectClip(clip.sceneId, clip.id)}
                >
                  <div className="director-tab__clipcard-body">
                    <div className="director-tab__item-title">{clip.id} — {clip.title}</div>
                    <span className="director-tab__meta">
                      {clip.seconds}s · {clip.beats.length} shots
                      {clip.altOf ? ' · alt' : ''}
                      {clip.queued ? ' · queued' : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/director-shotlist-tab.tsx
git commit -m "feat(director): shotlist tab with clip board"
```

---

### Task 7: Generate tab component

Absorbs the Board's viewer/variants/takes and the entire Inspector for the selected clip. This is the largest tab; it reuses `DirectorClipCraft` and the compile helpers unchanged.

**Files:**
- Create: `src/components/director/director-generate-tab.tsx`

**Interfaces:**
- Consumes: `selectedClip`, `selectedScene`, `updateDirectorClip`, `setClipVariant`, `setHeroTake` from `@/lib/director/director-state`; `takesForVariant`, `runtimeSeconds` from `@/lib/director/generate`; `variantKey` from `@/lib/director/slate`; `applyBeatDurations`, `compileClipBody`, `retimeClipToSeconds`, `validateClipTimings`, `voicesFromBreakdown` from `@/lib/director/prompt-compiler`; `isolatedPrompt` from `@/lib/director/isolate-prompt`; `getDirectorAdapter` from `@/lib/director/video-adapter`; `DirectorClipCraft` from `./director-clip-craft`; `Asset` from `@/types/project`.
- Produces:
  ```ts
  interface DirectorGenerateTabProps {
    show: DirectorShow; assets: Asset[]; preflight: string; warnings: string[];
    selectedBeatN: number; onSelectBeat: (n: number) => void;
    onChange: (show: DirectorShow) => void;
    onGenerate: (scope: 'active' | 'queued' | 'scene') => void;
    onRewrite: (notes: string) => void; onKeepRewrite: () => void; onDiscardRewrite: () => void;
  }
  export function DirectorGenerateTab(props: DirectorGenerateTabProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/director-generate-tab.tsx`. Move the `activeBody` helper (currently in `director-inspector.tsx`) here and assemble viewer + variants + prompt + generate + takes + timings + notes:

```tsx
import type { Asset } from '@/types/project';
import type { DirectorClip, DirectorShow, IsolateVariant } from '@/types/director';
import {
  selectedClip, selectedScene, setClipVariant, setHeroTake, updateDirectorClip,
} from '@/lib/director/director-state';
import { runtimeSeconds, takesForVariant } from '@/lib/director/generate';
import { variantKey } from '@/lib/director/slate';
import {
  applyBeatDurations, compileClipBody, retimeClipToSeconds, validateClipTimings, voicesFromBreakdown,
} from '@/lib/director/prompt-compiler';
import { isolatedPrompt } from '@/lib/director/isolate-prompt';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { DirectorClipCraft } from './director-clip-craft';

interface DirectorGenerateTabProps {
  show: DirectorShow;
  assets: Asset[];
  preflight: string;
  warnings: string[];
  selectedBeatN: number;
  onSelectBeat: (n: number) => void;
  onChange: (show: DirectorShow) => void;
  onGenerate: (scope: 'active' | 'queued' | 'scene') => void;
  onRewrite: (notes: string) => void;
  onKeepRewrite: () => void;
  onDiscardRewrite: () => void;
}

function activeBody(show: DirectorShow, clip: DirectorClip): string {
  const options = { voices: voicesFromBreakdown(show.breakdown) };
  const variant = clip.activeVariant;
  if (variant.kind === 'isolated') {
    return clip.bodyEdits[variantKey(variant)]
      || isolatedPrompt(clip, variant.beatN, variant.mode, { aspectRatio: show.aspectRatio, voices: options.voices })
      || compileClipBody(clip, options);
  }
  return clip.bodyEdits.full || compileClipBody(clip, options);
}

export function DirectorGenerateTab(props: DirectorGenerateTabProps) {
  const { show, assets, preflight, warnings, selectedBeatN, onSelectBeat, onChange, onGenerate, onRewrite, onKeepRewrite, onDiscardRewrite } = props;
  const clip = selectedClip(show);
  const adapter = getDirectorAdapter(show.adapterId);

  const patchClip = (updater: (current: DirectorClip) => DirectorClip) => {
    if (!clip) return;
    onChange(updateDirectorClip(show, clip.id, updater));
  };

  if (!clip) {
    return <div className="director-tab__stage"><p className="director-tab__empty">Select a clip in the rail to preview and generate takes.</p></div>;
  }

  const key = variantKey(clip.activeVariant);
  const takes = takesForVariant(clip, key);
  const selectedTake = takes.find((take) => take.id === show.selectedTakeId) ?? takes[takes.length - 1];
  const asset = assets.find((entry) => entry.id === selectedTake?.assetId);
  const timingError = validateClipTimings(clip);
  const compiled = adapter.buildRequest({ show, clip, variant: clip.activeVariant }).prompt;
  const beatN = clip.beats.some((beat) => beat.n === selectedBeatN) ? selectedBeatN : clip.beats[0]?.n ?? 1;

  const setVariant = (variant: IsolateVariant) => onChange({ ...setClipVariant(show, clip.id, variant), selectedClipId: clip.id });

  return (
    <div className="director-tab__stage">
      <span className="director-tab__label" style={{ margin: 0 }}>{clip.id} — {clip.title}</span>

      <div className="director-tab__viewer">
        {asset?.url ? <video src={asset.url} controls /> : (
          <span className="director-tab__empty">
            {selectedTake?.status === 'running' || selectedTake?.status === 'queued'
              ? `T${String(selectedTake.number).padStart(2, '0')} generating…`
              : 'No take yet for this variant'}
          </span>
        )}
      </div>

      <div className="director-tab__row">
        <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'full' })}>Full</button>
        <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'isolated', beatN, mode: 'held' })} disabled={!clip.beats.some((beat) => beat.n === beatN)}>Hold to {clip.seconds}s</button>
        <button type="button" className="director-tab__btn" onClick={() => setVariant({ kind: 'isolated', beatN, mode: 'native' })} disabled={!clip.beats.some((beat) => beat.n === beatN)}>Native length</button>
      </div>

      <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12 }}>
        <input type="checkbox" checked={Boolean(clip.queued)} style={{ width: 'auto' }}
          onChange={(event) => onChange({ ...show, clips: show.clips.map((entry) => entry.id === clip.id ? { ...entry, queued: event.target.checked } : entry) })} />
        Queue for Generate all
      </label>

      <div className="director-tab__fields">
        <div>
          <label className="director-tab__label" htmlFor="director-title">Title</label>
          <input id="director-title" value={clip.title} onChange={(event) => patchClip((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-seconds">Seconds</label>
          <input id="director-seconds" type="number" min={1} value={clip.seconds} onChange={(event) => patchClip((current) => retimeClipToSeconds(current, Number(event.target.value) || current.seconds))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-subject">Subject</label>
          <textarea id="director-subject" value={clip.subject} onChange={(event) => patchClip((current) => ({ ...current, subject: event.target.value }))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-location">Location</label>
          <textarea id="director-location" value={clip.location} onChange={(event) => patchClip((current) => ({ ...current, location: event.target.value }))} />
        </div>
        <DirectorClipCraft clip={clip} sceneLabel={selectedScene(show)?.label ?? 'scene'} aspectRatio={show.aspectRatio} onPatch={patchClip} />
        <div>
          <label className="director-tab__label" htmlFor="director-style">Style</label>
          <textarea id="director-style" value={clip.style} onChange={(event) => patchClip((current) => ({ ...current, style: event.target.value }))} />
        </div>
        <div>
          <label className="director-tab__label" htmlFor="director-constraints">Constraints</label>
          <textarea id="director-constraints" value={clip.constraints} onChange={(event) => patchClip((current) => ({ ...current, constraints: event.target.value }))} />
        </div>
        {timingError && <p className="director-tab__warn">{timingError}</p>}

        <div>
          <span className="director-tab__label">Shots</span>
          <div className="director-tab__list">
            {clip.beats.map((beat) => (
              <button key={beat.n} type="button" className={`director-tab__beat${beat.n === beatN ? ' director-tab__beat--active' : ''}`} onClick={() => onSelectBeat(beat.n)}>
                <span className="director-tab__item-title">SHOT {beat.n} ({beat.from}–{beat.to})</span>
                <span className="director-tab__meta">{beat.cam || beat.text}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="director-tab__label">Shot timings</span>
          <div className="director-tab__list">
            {clip.beats.map((beat) => (
              <div key={beat.n} className="director-tab__row" style={{ alignItems: 'center' }}>
                <span className="director-tab__meta" style={{ minWidth: 42 }}>S{beat.n}</span>
                <input type="number" min={1} value={beat.dur} onChange={(event) => patchClip((current) => applyBeatDurations({ ...current, beats: current.beats.map((entry) => entry.n === beat.n ? { ...entry, dur: Math.max(1, Number(event.target.value) || entry.dur) } : entry) }))} />
                <input value={beat.text} onChange={(event) => patchClip((current) => ({ ...current, beats: current.beats.map((entry) => entry.n === beat.n ? { ...entry, text: event.target.value } : entry) }))} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="director-tab__label" htmlFor="director-body">Active variant body</label>
          <textarea id="director-body" className="director-tab__prompt" value={activeBody(show, clip)}
            onChange={(event) => patchClip((current) => ({ ...current, bodyEdits: { ...current.bodyEdits, [variantKey(current.activeVariant)]: event.target.value } }))} />
          <button type="button" className="director-tab__btn" onClick={() => patchClip((current) => { const next = { ...current.bodyEdits }; delete next[variantKey(current.activeVariant)]; return { ...current, bodyEdits: next }; })}>Reset compiled</button>
        </div>

        <div>
          <span className="director-tab__label">Compiled prompt</span>
          <textarea className="director-tab__prompt" readOnly value={compiled} />
        </div>

        <p className="director-tab__meta">{preflight} · runtime {runtimeSeconds(show.clips)}s</p>
        {warnings.map((warning) => <p key={warning} className="director-tab__warn">{warning}</p>)}

        <div className="director-tab__row">
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onGenerate('active')} disabled={Boolean(timingError)}>Generate variant</button>
          <button type="button" className="director-tab__btn" onClick={() => onGenerate('queued')}>Generate queued</button>
          <button type="button" className="director-tab__btn" onClick={() => onGenerate('scene')}>Generate scene</button>
        </div>

        <div>
          <span className="director-tab__label">Takes</span>
          <div className="director-tab__takes">
            {takes.length === 0 && <span className="director-tab__empty">None yet</span>}
            {takes.map((take) => (
              <button key={take.id} type="button" title={take.status}
                className={`director-tab__take${take.id === selectedTake?.id ? ' director-tab__take--active' : ''}${take.hero ? ' director-tab__take--hero' : ''}`}
                onClick={() => onChange({ ...show, selectedTakeId: take.id })}
                onDoubleClick={() => onChange(setHeroTake(show, clip.id, take.id))}>
                T{String(take.number).padStart(2, '0')}{take.hero ? ' ★' : ''}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="director-tab__label" htmlFor="director-notes">Director notes</label>
          <textarea id="director-notes" placeholder="What to keep or change on the next rewrite of this variant."
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onRewrite((event.currentTarget as HTMLTextAreaElement).value); } }} />
          <div className="director-tab__row">
            <button type="button" className="director-tab__btn" onClick={() => { const field = document.getElementById('director-notes') as HTMLTextAreaElement | null; onRewrite(field?.value ?? ''); }}>Rewrite</button>
            <button type="button" className="director-tab__btn" onClick={onKeepRewrite} disabled={!clip.pendingRewrite}>Keep</button>
            <button type="button" className="director-tab__btn" onClick={onDiscardRewrite} disabled={!clip.pendingRewrite}>Discard</button>
          </div>
          {clip.pendingRewrite && <p className="director-tab__ok">Rewrite ready — Keep to store, Discard to revert.</p>}
        </div>
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
git add src/components/director/director-generate-tab.tsx
git commit -m "feat(director): generate tab (viewer, variants, prompt, takes, notes)"
```

---

### Task 8: Rewire `director-tab.tsx` to the workbench; retire old panels

Replace the 3-column layout with the toolbar + drawers + active tab + rail. Keep all existing handlers. Delete the three old panel files.

**Files:**
- Modify: `src/components/director/director-tab.tsx` (render section + imports)
- Delete: `src/components/director/director-source-panel.tsx`
- Delete: `src/components/director/director-board.tsx`
- Delete: `src/components/director/director-inspector.tsx`

**Interfaces:**
- Consumes all tab components from Tasks 3–7 and `DirectorLookBiblePanel` (unchanged).

- [ ] **Step 1: Replace imports in `director-tab.tsx`**

Remove the imports of `DirectorSourcePanel`, `DirectorBoard`, `DirectorInspector`. Add:

```tsx
import { useState } from 'react';
import { DirectorStructureRail } from './director-structure-rail';
import { DirectorScriptTab } from './director-script-tab';
import { DirectorBreakdownTab } from './director-breakdown-tab';
import { DirectorShotlistTab } from './director-shotlist-tab';
import { DirectorGenerateTab } from './director-generate-tab';
import { DirectorSetupDrawer } from './director-setup-drawer';
import { DirectorLookBiblePanel } from './director-look-bible';
```

(`useState` is already imported at the top — merge, don't duplicate.)

- [ ] **Step 2: Add drawer + selection state and tab metadata**

Inside `DirectorTab`, after the existing `useState` hooks, add:

```tsx
const [openDrawer, setOpenDrawer] = useState<'setup' | 'look' | null>(null);

const TABS: { id: DirectorMode; label: string }[] = [
  { id: 'source', label: 'Script' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'shotlist', label: 'Shotlist' },
  { id: 'generate', label: 'Generate' },
];

const selectScene = (sceneId: string) => {
  const first = show.clips.find((row) => row.sceneId === sceneId);
  setShow({ ...show, selectedSceneId: sceneId, selectedClipId: first?.id ?? show.selectedClipId });
};
const selectClip = (sceneId: string, clipId: string) => {
  setShow({ ...show, selectedSceneId: sceneId, selectedClipId: clipId });
  const target = show.clips.find((row) => row.id === clipId);
  setSelectedBeatN(target?.beats[0]?.n ?? 1);
};
const nonAltClipCount = show.clips.filter((clip) => !clip.altOf).length;
const withRail = show.mode === 'shotlist' || show.mode === 'generate';
```

- [ ] **Step 3: Replace the `return (...)` block**

Replace everything from `return (` to the closing `);` of the component with:

```tsx
return (
  <div className="director-tab">
    <div className="director-tab__toolbar">
      <div className="director-tab__stagetabs">
        {TABS.map((tab) => (
          <button key={tab.id} type="button"
            className={`director-tab__stab${show.mode === tab.id ? ' director-tab__stab--active' : ''}`}
            onClick={() => setShow({ ...show, mode: tab.id })}>
            {tab.label}
            {tab.id === 'source' && show.sourceText.trim() && <span className="director-tab__stab-dot" />}
            {tab.id === 'breakdown' && show.breakdown.length > 0 && <span className="director-tab__stab-badge">{show.breakdown.length}</span>}
            {tab.id === 'shotlist' && nonAltClipCount > 0 && <span className="director-tab__stab-badge">{nonAltClipCount}</span>}
          </button>
        ))}
      </div>
      {show.jobStatus && <span className="director-tab__status">{show.jobStatus.message}</span>}
      <div className="director-tab__row" style={{ marginLeft: 'auto', alignItems: 'center' }}>
        <button type="button" className="director-tab__btn" onClick={() => setOpenDrawer((d) => d === 'setup' ? null : 'setup')}>⚙ Setup</button>
        <button type="button" className="director-tab__btn" onClick={() => setOpenDrawer((d) => d === 'look' ? null : 'look')}>🎨 Look bible</button>
        <DirectorLlmPicker
          provider={parseDirectorLlmProvider(show.llmProvider)}
          providers={cliProviders}
          onChange={(llmProvider) => setShow({ ...show, llmProvider })}
        />
      </div>
    </div>

    <div className={`director-tab__drawer${openDrawer === 'setup' ? ' director-tab__drawer--open' : ''}`}>
      <DirectorSetupDrawer show={show} onChange={setShow} />
    </div>
    <div className={`director-tab__drawer${openDrawer === 'look' ? ' director-tab__drawer--open' : ''}`}>
      <div className="director-tab__drawer-inner" style={{ maxWidth: 420 }}>
        <DirectorLookBiblePanel
          show={show}
          writing={directorJobIsRunning(show, 'look-bible')}
          error={show.jobStatus?.type === 'look-bible' && show.jobStatus.error ? show.jobStatus.message : ''}
          onChange={setShow}
          onWrite={() => void runLookBible()}
          onCancel={cancelLookBible}
        />
      </div>
    </div>

    <div className={`director-tab__workbench${withRail ? '' : ' director-tab__workbench--norail'}`}>
      {withRail && <DirectorStructureRail show={show} onSelectScene={selectScene} onSelectClip={selectClip} />}
      {show.mode === 'source' && (
        <DirectorScriptTab show={show} onChange={setShow} onBreakdown={() => void runBreakdown()} />
      )}
      {show.mode === 'breakdown' && (
        <DirectorBreakdownTab show={show} elements={state.elements} onApprove={approveBreakdown} onCreateMissing={createMissing} onOpenElements={() => dispatch({ type: 'SET_TAB', tab: 'elements' })} />
      )}
      {show.mode === 'shotlist' && (
        <DirectorShotlistTab show={show} onChange={setShow} onShotlist={(sceneOnly) => void runShotlist(sceneOnly)} onSelectClip={selectClip} />
      )}
      {show.mode === 'generate' && (
        <DirectorGenerateTab
          show={show} assets={state.assets} preflight={preflight} warnings={warnings}
          selectedBeatN={selectedBeatN} onSelectBeat={setSelectedBeatN}
          onChange={setShow}
          onGenerate={(scope) => void runGenerate(scope)}
          onRewrite={(notes) => void runRewrite(notes)}
          onKeepRewrite={() => { const current = selectedClip(show); if (current) setShow(keepPendingRewrite(show, current.id)); }}
          onDiscardRewrite={() => { const current = selectedClip(show); if (current) setShow(discardPendingRewrite(show, current.id)); }}
        />
      )}
    </div>
  </div>
);
```

- [ ] **Step 4: Remove now-unused code**

Delete the old `MODES` constant and the now-unused `clip` local (`const clip = selectedClip(show);`) if TypeScript flags it as unused. Keep `selectedBeatN` state, all callbacks, and both `useEffect` blocks.

- [ ] **Step 5: Delete the retired panel files**

```bash
git rm src/components/director/director-source-panel.tsx src/components/director/director-board.tsx src/components/director/director-inspector.tsx
```

- [ ] **Step 6: Verify the whole project compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. Fix any unused-import warnings by removing the offending imports.

- [ ] **Step 7: Run the full director test suite**

Run: `npx vitest run tests/lib/director/`
Expected: PASS (existing tests + the new `script-format` tests; no logic changed).

- [ ] **Step 8: Commit**

```bash
git add src/components/director/director-tab.tsx
git commit -m "feat(director): four-tab workbench layout; retire old panels"
```

---

### Task 9: Manual verification in the app

No new code — drive the redesigned page end-to-end.

- [ ] **Step 1: Build and launch**

Run the app (existing dev command, e.g. `npm run dev` or the Electron start script) and open the Director tab.

- [ ] **Step 2: Walk the flow**

Verify each:
- Script tab: paste text → the done-dot appears on the tab; **Upload** a `.txt`/`.fountain` loads it; **Formatted view** renders scene headings/cues/dialogue; **Edit view** round-trips text unchanged.
- **Run breakdown →** switches to the Breakdown tab and shows cards with linked/missing badges; **Approve** switches to Shotlist.
- Shotlist tab shows the rail + clip board; **Shotlist show** fills clips; clicking a clip card selects it and stays on Shotlist.
- Generate tab shows rail + viewer + variants + prompt + generate + takes + notes; clicking a different clip in the rail updates the stage **without leaving** the Generate tab.
- **⚙ Setup** and **🎨 Look bible** toolbar buttons open/close their drawers; edits persist.

- [ ] **Step 3: Commit any fixes**

If manual testing surfaces a fix, commit it with a descriptive message. Otherwise, no commit.

---

## Self-Review Notes

- **Spec coverage:** four-tab workbench (Tasks 3–8), rail persistent on Shotlist/Generate only + full-width Script/Breakdown (Task 8 `withRail`), click-clip-stays-on-tab (Task 8 `selectClip`), Setup/Look drawers + toolbar LLM picker (Tasks 5, 8), Script editor + formatted view (Task 4), pure parser + tests (Task 1), tab affordances (Task 8), decomposition + retiring old panels (Tasks 3–8), no state migration / `'source'` id reuse (Task 8). Covered.
- **Type consistency:** `DirectorMode` values (`'source' | 'breakdown' | 'shotlist' | 'generate'`) used identically in `TABS` and tab-switch guards; handler names (`runBreakdown`, `approveBreakdown`, `createMissing`, `runShotlist`, `runGenerate`, `runRewrite`, `keepPendingRewrite`, `discardPendingRewrite`, `runLookBible`, `cancelLookBible`) match `director-tab.tsx`; `parseScreenplay`/`ScriptLine` consistent between Task 1 and Task 4.
- **No placeholders:** every code step is complete.
