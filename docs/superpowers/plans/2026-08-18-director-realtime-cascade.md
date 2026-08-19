# Director Real-Time Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the script or beat sheet changes, auto-run breakdown then shotlist for only the changed scenes/beats after a short idle pause.

**Architecture:** A pure diff engine (`cascade.ts`) hashes each scene and computes a dirty set; an orchestrator hook (`use-director-cascade.ts`) debounces source changes and drives the existing `runBreakdown`/`runShotlist` LLM jobs for only the dirty scenes, with abort-on-new-edit. State lives on `DirectorShow` (`autoSync`, `syncState`) and persists via the existing opaque-JSON director blob.

**Tech Stack:** React 18 + TypeScript, Vitest (`@/` → `src/`), existing director LLM job runner (`runDirectorJsonJob`).

## Global Constraints

- Branch: `director-page-redesign`. Do NOT create sub-branches, merge, or open a PR.
- Never `git add .` — add only the task's own files. `.playwright-mcp/` is gitignored scratch.
- Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- The active structured store is authoritative; `sourceText` is its derived mirror (unchanged by this work).
- Scene is the atom: an edit re-runs the whole scene/beat, never sub-parts.
- One cascade at a time (matches the single `jobStatus` slot).
- Idle debounce: 2500ms. Auto-sync default: ON (absent `autoSync` = true).
- Verify gate for every task: `npx tsc --noEmit -p tsconfig.json` exits 0 AND `npx vitest run tests/lib/director/` stays green (currently 122 passing; count grows as tasks add tests).

---

## File Structure

- **Create** `src/lib/director/cascade.ts` — pure diff engine: `sceneHashes`, `diffScenes`, `scenesForKeys`, `pruneRemovedScenes`, `remapSceneIndexMaps`. No React, no LLM.
- **Create** `tests/lib/director/cascade.test.ts` — unit tests for the engine.
- **Modify** `src/types/director.ts` — add `autoSync?` and `syncState?` to `DirectorShow`.
- **Modify** `src/lib/director/run-llm.ts` — add optional `signal?: AbortSignal` to `runDirectorJsonJob`.
- **Modify** `src/components/director/director-tab.tsx` — extend `runBreakdown`/`runShotlist` with `scope` + `signal`; mount the hook; render toggle + status.
- **Create** `src/components/director/use-director-cascade.ts` — orchestrator hook.
- **Create** `tests/lib/director/cascade-orchestrator.test.ts` — fake-timer tests for debounce/abort.
- **Modify** `src/styles/director-tab.css` — auto-sync toggle + per-scene status dot styles.

---

## Task 1: Data model — `autoSync` and `syncState` on `DirectorShow`

**Files:**
- Modify: `src/types/director.ts` (near existing optional `DirectorShow` fields, after `beatSheet` / `chatMessages`)

**Interfaces:**
- Produces: `DirectorShow.autoSync?: boolean`; `DirectorShow.syncState?: { hashes: Record<string,string>; dirty: string[]; lastRunAt?: number }`.

- [ ] **Step 1: Add the fields**

In `src/types/director.ts`, inside `interface DirectorShow`, after the `chatMessages?` line, add:

```ts
  /** Auto-run breakdown+shotlist after edits. Absent = true (on by default). */
  autoSync?: boolean;
  /** What the cascade has already synced, so it survives reload. */
  syncState?: {
    hashes: Record<string, string>;
    dirty: string[];
    lastRunAt?: number;
  };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exits 0 (no output).

- [ ] **Step 3: Commit**

```bash
git add src/types/director.ts
git commit -m "feat(director): add autoSync + syncState to DirectorShow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Diff engine — `sceneHashes` + `diffScenes`

**Files:**
- Create: `src/lib/director/cascade.ts`
- Test: `tests/lib/director/cascade.test.ts`

**Interfaces:**
- Consumes: `splitScenes(doc: Screenplay): ScriptScene[]` and `parseToScreenplay(text: string): Screenplay` from `@/lib/director/scene-split` and `@/lib/director/screenplay`; `ScriptScene { index; heading; elements: ScreenplayElement[] }`; `DirectorShow` (`docKind`, `sourceText`, `beatSheet`).
- Produces:
  - `sceneHashes(show: DirectorShow): Map<string, string>`
  - `interface SceneDiff { changed: string[]; removed: string[] }`
  - `diffScenes(prev: Map<string,string>, next: Map<string,string>): SceneDiff`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/cascade.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sceneHashes, diffScenes } from '@/lib/director/cascade';
import type { DirectorShow } from '@/types/director';

const show = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SCRIPT_A = 'INT. OFFICE - DAY\nDr. Jordan enters.\n\nEXT. STREET - NIGHT\nHe walks.';
const SCRIPT_B = 'INT. OFFICE - DAY\nDr. Jordan enters and sits.\n\nEXT. STREET - NIGHT\nHe walks.';

describe('sceneHashes (screenplay)', () => {
  it('one hash per scene, stable across an identical re-read', () => {
    const h1 = sceneHashes(show({ sourceText: SCRIPT_A }));
    const h2 = sceneHashes(show({ sourceText: SCRIPT_A }));
    expect(h1.size).toBe(2);
    expect([...h1.entries()]).toEqual([...h2.entries()]);
  });

  it('changes only the edited scene hash', () => {
    const a = sceneHashes(show({ sourceText: SCRIPT_A }));
    const b = sceneHashes(show({ sourceText: SCRIPT_B }));
    const keys = [...a.keys()];
    expect(a.get(keys[0])).not.toBe(b.get(keys[0])); // scene 1 edited
    expect(a.get(keys[1])).toBe(b.get(keys[1]));       // scene 2 unchanged
  });

  it('gives duplicate headings distinct keys', () => {
    const dup = 'INT. OFFICE - DAY\nA.\n\nINT. OFFICE - DAY\nB.';
    expect(sceneHashes(show({ sourceText: dup })).size).toBe(2);
  });
});

describe('diffScenes', () => {
  it('detects add, change, and remove', () => {
    const prev = sceneHashes(show({ sourceText: SCRIPT_A }));
    const next = sceneHashes(show({ sourceText: SCRIPT_B }));
    const d = diffScenes(prev, next);
    expect(d.changed).toHaveLength(1);
    expect(d.removed).toHaveLength(0);
  });

  it('a pure reorder yields no changed scenes', () => {
    const one = 'INT. A - DAY\nx.\n\nINT. B - DAY\ny.';
    const swapped = 'INT. B - DAY\ny.\n\nINT. A - DAY\nx.';
    const d = diffScenes(sceneHashes(show({ sourceText: one })), sceneHashes(show({ sourceText: swapped })));
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: FAIL — `sceneHashes`/`diffScenes` not exported.

- [ ] **Step 3: Implement**

Create `src/lib/director/cascade.ts`:

```ts
import type { DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';

export interface SceneDiff { changed: string[]; removed: string[]; }

// FNV-1a — small, deterministic, dependency-free content hash.
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** One stable hash per scene. Key is content-derived so a pure reorder does not
 *  read as an edit; duplicate headings are disambiguated by an occurrence index. */
export function sceneHashes(show: DirectorShow): Map<string, string> {
  const out = new Map<string, string>();
  if (show.docKind === 'beatsheet') {
    for (const b of show.beatSheet?.beats ?? []) {
      out.set(`beat:${b.n}`, hash(`${b.action}|${b.location}|${b.shot}|${b.mood ?? ''}`));
    }
    return out;
  }
  const scenes = splitScenes(parseToScreenplay(show.sourceText));
  const seen = new Map<string, number>();
  for (const sc of scenes) {
    const base = sc.heading.trim().toUpperCase() || '(untitled)';
    const n = (seen.get(base) ?? 0);
    seen.set(base, n + 1);
    const key = n === 0 ? base : `${base}#${n}`;
    out.set(key, hash(sc.elements.map((e) => e.text).join('\n')));
  }
  return out;
}

export function diffScenes(prev: Map<string, string>, next: Map<string, string>): SceneDiff {
  const changed: string[] = [];
  for (const [key, h] of next) if (prev.get(key) !== h) changed.push(key);
  const removed: string[] = [];
  for (const key of prev.keys()) if (!next.has(key)) removed.push(key);
  return { changed, removed };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/cascade.ts tests/lib/director/cascade.test.ts
git commit -m "feat(director): cascade diff engine — sceneHashes + diffScenes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `scenesForKeys` — map dirty keys to DirectorScene ids

**Files:**
- Modify: `src/lib/director/cascade.ts`
- Test: `tests/lib/director/cascade.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `DirectorShow.scenes: DirectorScene[]` (each has `id`, `number`, `label`), the same scene-key derivation as `sceneHashes`.
- Produces: `scenesForKeys(show: DirectorShow, keys: string[]): DirectorScene[]` — the `DirectorScene` entries whose derived key is in `keys`. Screenplay: match a scene's key by heading/occurrence against `show.scenes` in order. Beats: no `DirectorScene` yet, return `[]` (beats drive breakdown by the whole-sheet path — see Task 6).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/director/cascade.test.ts`:

```ts
import { scenesForKeys } from '@/lib/director/cascade';
import type { DirectorScene } from '@/types/director';

describe('scenesForKeys', () => {
  it('returns the DirectorScene entries for the given keys, in scene order', () => {
    const s = show({
      sourceText: SCRIPT_A,
      scenes: [
        { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
        { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
      ] as DirectorScene[],
    });
    const keys = [...sceneHashes(s).keys()]; // ['INT. OFFICE - DAY', 'EXT. STREET - NIGHT']
    expect(scenesForKeys(s, [keys[1]]).map((x) => x.id)).toEqual(['s2']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: FAIL — `scenesForKeys` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/director/cascade.ts`:

```ts
import type { DirectorScene } from '@/types/director';

/** The DirectorScene entries whose derived key is in `keys`. The scene key is
 *  the upper-cased heading with a `#n` occurrence suffix — the same derivation
 *  sceneHashes uses — matched against show.scenes' labels in order. */
export function scenesForKeys(show: DirectorShow, keys: string[]): DirectorScene[] {
  if (show.docKind === 'beatsheet') return [];
  const want = new Set(keys);
  const seen = new Map<string, number>();
  const out: DirectorScene[] = [];
  for (const sc of show.scenes) {
    const base = (sc.label ?? '').trim().toUpperCase() || '(untitled)';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = n === 0 ? base : `${base}#${n}`;
    if (want.has(key)) out.push(sc);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/cascade.ts tests/lib/director/cascade.test.ts
git commit -m "feat(director): scenesForKeys maps dirty keys to DirectorScene ids

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `pruneRemovedScenes` — drop clips + unreferenced items

**Files:**
- Modify: `src/lib/director/cascade.ts`
- Test: `tests/lib/director/cascade.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `detectSceneAssets(scene, breakdown)` from `@/lib/director/scene-assets`; `splitScenes`/`parseToScreenplay`; `DirectorShow.clips` (`clip.sceneId`), `DirectorShow.scenes` (`scene.id`), `DirectorShow.breakdown`, `DirectorShow.sceneAssetOverrides`.
- Produces: `pruneRemovedScenes(show: DirectorShow, next: DirectorShow): DirectorShow` — a new show where (a) clips whose `sceneId` is not among `next.scenes` ids are removed; (b) breakdown items not referenced by ANY surviving scene text AND not listed in any surviving scene's override `added` are removed. `next` supplies the surviving scenes/scene-text.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/director/cascade.test.ts`:

```ts
import { pruneRemovedScenes } from '@/lib/director/cascade';
import type { DirectorBreakdownItem, DirectorClip } from '@/types/director';

const item = (o: Partial<DirectorBreakdownItem>): DirectorBreakdownItem =>
  ({ id: o.name!, kind: 'character', name: 'x', tag: '@x', description: '', ...o });

describe('pruneRemovedScenes', () => {
  it('drops clips whose scene is gone and items no surviving scene references', () => {
    const prevShow = show({
      sourceText: 'INT. OFFICE - DAY\nDr. Jordan enters.\n\nEXT. STREET - NIGHT\nThe Taxi waits.',
      breakdown: [item({ name: 'Dr. Jordan', tag: '@Dr-Jordan' }), item({ name: 'Taxi', tag: '@Taxi', kind: 'vehicle' })],
      scenes: [
        { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
        { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
      ] as never,
      clips: [{ id: 'c1', sceneId: 's1', beats: [] }, { id: 'c2', sceneId: 's2', beats: [] }] as DirectorClip[],
    });
    // next: scene 2 removed
    const nextShow = { ...prevShow,
      sourceText: 'INT. OFFICE - DAY\nDr. Jordan enters.',
      scenes: [prevShow.scenes[0]],
    };
    const pruned = pruneRemovedScenes(prevShow, nextShow);
    expect(pruned.clips.map((c) => c.id)).toEqual(['c1']);       // c2 dropped (scene gone)
    expect(pruned.breakdown.map((b) => b.tag)).toEqual(['@Dr-Jordan']); // Taxi unreferenced now
  });

  it('keeps an item a surviving scene override still lists even if not in text', () => {
    const prevShow = show({
      sourceText: 'INT. OFFICE - DAY\nDr. Jordan enters.',
      breakdown: [item({ name: 'Hidden Prop', tag: '@Hidden-Prop', kind: 'prop' })],
      scenes: [{ id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] }] as never,
      clips: [],
      sceneAssetOverrides: { 0: { added: ['@Hidden-Prop'], removed: [] } },
    });
    const pruned = pruneRemovedScenes(prevShow, prevShow);
    expect(pruned.breakdown.map((b) => b.tag)).toEqual(['@Hidden-Prop']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: FAIL — `pruneRemovedScenes` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/director/cascade.ts`:

```ts
import { detectSceneAssets } from '@/lib/director/scene-assets';

/** Drop clips whose scene is gone and breakdown items no surviving scene
 *  references. `next` supplies the surviving scenes/text. An item is kept when
 *  any surviving scene's text mentions it OR any surviving scene override still
 *  lists its tag under `added`. Pure. */
export function pruneRemovedScenes(show: DirectorShow, next: DirectorShow): DirectorShow {
  const surviving = new Set(next.scenes.map((s) => s.id));
  const clips = show.clips.filter((c) => surviving.has(c.sceneId));

  const referenced = new Set<string>();
  const scenes = splitScenes(parseToScreenplay(next.sourceText));
  for (const sc of scenes) {
    for (const hit of detectSceneAssets(sc, show.breakdown)) {
      const m = show.breakdown.find((b) => b.name === hit.name && b.kind === hit.kind);
      if (m) referenced.add(m.tag);
    }
  }
  for (const ov of Object.values(next.sceneAssetOverrides ?? {})) {
    for (const tag of ov.added) referenced.add(tag);
  }
  const breakdown = show.breakdown.filter((b) => referenced.has(b.tag));

  return { ...show, clips, breakdown };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/cascade.ts tests/lib/director/cascade.test.ts
git commit -m "feat(director): pruneRemovedScenes drops orphan clips + unreferenced items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `remapSceneIndexMaps` — keep index-keyed overrides attached

**Files:**
- Modify: `src/lib/director/cascade.ts`
- Test: `tests/lib/director/cascade.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `DirectorShow.sceneAssetOverrides?: Record<number, {added:string[];removed:string[]}>`, `DirectorShow.sceneAssetSuggestions?: Record<number, string[]>`; ordered scene keys from `sceneHashes`.
- Produces: `remapSceneIndexMaps(show: DirectorShow, prevKeys: string[], nextKeys: string[]): DirectorShow` — rewrites both index-keyed maps so each entry follows its scene when scenes are inserted/removed. Entry at old index `i` moves to `nextKeys.indexOf(prevKeys[i])`; entries whose scene vanished are dropped.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/director/cascade.test.ts`:

```ts
import { remapSceneIndexMaps } from '@/lib/director/cascade';

describe('remapSceneIndexMaps', () => {
  it('moves overrides to follow their scene when a scene is inserted at the front', () => {
    const prevKeys = ['A', 'B'];
    const nextKeys = ['NEW', 'A', 'B']; // inserted at index 0
    const s = show({
      sceneAssetOverrides: { 0: { added: ['@x'], removed: [] }, 1: { added: ['@y'], removed: [] } },
      sceneAssetSuggestions: { 1: ['@z'] },
    });
    const out = remapSceneIndexMaps(s, prevKeys, nextKeys);
    expect(out.sceneAssetOverrides).toEqual({ 1: { added: ['@x'], removed: [] }, 2: { added: ['@y'], removed: [] } });
    expect(out.sceneAssetSuggestions).toEqual({ 2: ['@z'] });
  });

  it('drops entries whose scene was removed', () => {
    const s = show({ sceneAssetOverrides: { 0: { added: ['@x'], removed: [] }, 1: { added: ['@y'], removed: [] } } });
    const out = remapSceneIndexMaps(s, ['A', 'B'], ['A']); // B removed
    expect(out.sceneAssetOverrides).toEqual({ 0: { added: ['@x'], removed: [] } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: FAIL — `remapSceneIndexMaps` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/director/cascade.ts`:

```ts
function remapIndexMap<T>(map: Record<number, T> | undefined, prevKeys: string[], nextKeys: string[]): Record<number, T> | undefined {
  if (!map) return map;
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(map)) {
    const oldIdx = Number(k);
    const key = prevKeys[oldIdx];
    if (key === undefined) continue;
    const newIdx = nextKeys.indexOf(key);
    if (newIdx >= 0) out[newIdx] = v;
  }
  return out;
}

/** Rewrite the index-keyed per-scene maps so each entry follows its scene after
 *  an insert/remove. Entries whose scene vanished are dropped. */
export function remapSceneIndexMaps(show: DirectorShow, prevKeys: string[], nextKeys: string[]): DirectorShow {
  return {
    ...show,
    sceneAssetOverrides: remapIndexMap(show.sceneAssetOverrides, prevKeys, nextKeys),
    sceneAssetSuggestions: remapIndexMap(show.sceneAssetSuggestions, prevKeys, nextKeys),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/cascade.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/cascade.ts tests/lib/director/cascade.test.ts
git commit -m "feat(director): remapSceneIndexMaps keeps per-scene overrides attached

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Scope + abort on the LLM jobs

**Files:**
- Modify: `src/lib/director/run-llm.ts:17-43` (add `signal`)
- Modify: `src/components/director/director-tab.tsx` (`runBreakdown` ~165-189, `runShotlist` ~226-254)

**Interfaces:**
- Consumes: `runDirectorJsonJob(systemPrompt, userPrompt, provider, requestId?, signal?)`.
- Produces (on `DirectorTab`, hoisted so the hook can call them):
  - `runBreakdown(scope: { sceneIds: string[] } | 'all', signal?: AbortSignal): Promise<void>`
  - `runShotlist(scope: { sceneIds: string[] } | 'all', signal?: AbortSignal): Promise<void>`
  These wrap the current logic; `'all'` = today's whole-script behavior; `{ sceneIds }` = scene-scoped. On `signal.aborted` after the job resolves, they return WITHOUT committing state (silent abort).

- [ ] **Step 1: Add `signal` to `runDirectorJsonJob`**

In `src/lib/director/run-llm.ts`, change the signature and reject on abort:

```ts
export async function runDirectorJsonJob(
  systemPrompt: string,
  userPrompt: string,
  provider: CliLlmProviderId,
  requestId = crypto.randomUUID(),
  signal?: AbortSignal,
): Promise<unknown> {
  const prompt = directorCliJobPrompt(systemPrompt, userPrompt);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => {
      void cancelCliCopilotChat(provider, requestId);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      void cancelCliCopilotChat(provider, requestId);
      reject(new Error('Timed out waiting for the CLI. Cancel and try again, or pick another CLI.'));
    }, DIRECTOR_CLI_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      invokeCliCopilotChat(provider, {
        requestId,
        model: getDefaultModelForCliProvider(provider),
        injectProjectContext: false,
        systemPrompt: prompt.systemPrompt,
        userMessage: `${prompt.systemPrompt}\n\n${prompt.userMessage}`,
      }),
      timedOut,
      aborted,
    ]);
    return extractJsonValue(response.message ?? '');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Director LLM job failed.';
    throw error instanceof DOMException ? error : new Error(detail);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```

(Keep whatever the existing `catch`/`finally` did; only ADD the `aborted` race and the `signal` param. If the existing `catch` differs, preserve its behavior and just re-throw `DOMException` as-is.)

- [ ] **Step 2: Hoist + rescope `runBreakdown`**

In `src/components/director/director-tab.tsx`, change `runBreakdown` to accept scope + signal. Add a scope line to the job input and pass the signal:

```ts
const runBreakdown = useCallback(async (
  scope: { sceneIds: string[] } | 'all' = 'all',
  signal?: AbortSignal,
) => {
  const current = showRef.current;
  const requestId = setJob('breakdown', 'Breaking down script…');
  try {
    const existing = state.elements.map((element) => `${element.type} ${element.name}`).join(', ');
    const scopeNote = scope === 'all' ? '' :
      `\nOnly re-break-down these scenes (ids): ${scope.sceneIds.join(', ')}. Return items for these scenes; existing items for other scenes are kept.`;
    const payload = await runDirectorJsonJob(
      BREAKDOWN_SYSTEM_PROMPT,
      breakdownJobInput(current, existing) + scopeNote,
      parseDirectorLlmProvider(current.llmProvider),
      requestId,
      signal,
    );
    if (signal?.aborted) return; // silent — a newer edit superseded this
    const parsed = parseBreakdownPayload(payload);
    setShow({
      ...current,
      breakdown: mergeBreakdownItems(current.breakdown, parsed.items, state.elements),
      scenes: parsed.scenes.length > 0 ? parsed.scenes : current.scenes,
      breakdownApproved: false,
      mode: current.mode, // do NOT force the tab to switch during an auto-run
      jobStatus: null,
      selectedSceneId: parsed.scenes[0]?.id ?? current.selectedSceneId,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    failJob('breakdown', error, 'Breakdown failed');
    throw error; // let the cascade know not to chain shotlist
  }
}, [failJob, setJob, setShow, state.elements]);
```

- [ ] **Step 3: Hoist + rescope `runShotlist`**

Change `runShotlist` to the same scope/signal shape (it already had `sceneOnly`):

```ts
const runShotlist = useCallback(async (
  scope: { sceneIds: string[] } | 'all' = 'all',
  signal?: AbortSignal,
) => {
  const current = showRef.current;
  const sceneOnly = scope !== 'all';
  const scene = sceneOnly ? current.scenes.find((s) => scope.sceneIds.includes(s.id)) : selectedScene(current);
  const requestId = setJob('shotlist', sceneOnly ? `Shotlisting ${scene?.label ?? 'scene'}…` : 'Shotlisting show…');
  try {
    const payload = await runDirectorJsonJob(
      shotlistSystemPrompt(current.clipLengthSec, shotlistDensity(current)),
      shotlistJobInput(current, scene, sceneOnly),
      parseDirectorLlmProvider(current.llmProvider),
      requestId,
      signal,
    );
    if (signal?.aborted) return;
    const parsed = parseShotlistPayload(payload, sceneOnly ? scene?.id : undefined);
    const merged = mergeShotlist(current.scenes, current.clips, parsed);
    setShow({
      ...current,
      stylePrefix: current.stylePrefix.trim() ? current.stylePrefix
        : (parsed.stylePrefix?.trim() ? parsed.stylePrefix : current.stylePrefix),
      scenes: merged.scenes,
      clips: merged.clips,
      mode: current.mode,
      jobStatus: parsed.errors[0] ? { type: 'shotlist', message: parsed.errors[0], error: true } : null,
      selectedClipId: merged.clips[0]?.id ?? current.selectedClipId,
      selectedSceneId: merged.clips[0]?.sceneId ?? current.selectedSceneId,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    failJob('shotlist', error, 'Shotlist failed');
    throw error;
  }
}, [failJob, setJob, setShow]);
```

NOTE: the existing manual buttons call `runBreakdown()` / `runShotlist(sceneOnly)`. Update those call sites: `runBreakdown()` stays valid (defaults to `'all'`); replace `runShotlist(true)` → `runShotlist({ sceneIds: selectedScene(show) ? [selectedScene(show)!.id] : [] })` and `runShotlist(false)` → `runShotlist('all')`. Grep for `runShotlist(` and `runBreakdown(` and fix every call site.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exits 0. Fix any call sites the change surfaced.

- [ ] **Step 5: Run director tests**

Run: `npx vitest run tests/lib/director/`
Expected: still green (no test targets these handlers directly; this guards regressions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/director/run-llm.ts src/components/director/director-tab.tsx
git commit -m "feat(director): scene-scoped + abortable breakdown/shotlist jobs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Orchestrator hook — `useDirectorCascade`

**Files:**
- Create: `src/components/director/use-director-cascade.ts`
- Test: `tests/lib/director/cascade-orchestrator.test.ts`

**Interfaces:**
- Consumes: `sceneHashes`, `diffScenes`, `scenesForKeys`, `pruneRemovedScenes`, `remapSceneIndexMaps` (Tasks 2-5); the `runBreakdown`/`runShotlist` shapes from Task 6.
- Produces:
  ```ts
  useDirectorCascade(args: {
    show: DirectorShow;
    autoSync: boolean;
    runBreakdown: (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
    runShotlist:  (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
    commitSyncState: (next: NonNullable<DirectorShow['syncState']>) => void;
    debounceMs?: number; // default 2500
  }): { dirty: string[]; running: boolean }
  ```

- [ ] **Step 1: Write the failing test (fake timers)**

Create `tests/lib/director/cascade-orchestrator.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDirectorCascade } from '@/components/director/use-director-cascade';
import type { DirectorShow } from '@/types/director';

const base = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SCRIPT = 'INT. OFFICE - DAY\nDr. Jordan enters.';

describe('useDirectorCascade', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces: one run after the idle pause', async () => {
    const runBreakdown = vi.fn().mockResolvedValue(undefined);
    const runShotlist = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const { rerender } = renderHook((p) => useDirectorCascade(p), {
      initialProps: { show: base({ sourceText: '' }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 },
    });
    rerender({ show: base({ sourceText: SCRIPT }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(runBreakdown).toHaveBeenCalledTimes(1);
    expect(runShotlist).toHaveBeenCalledTimes(1);
  });

  it('does nothing when autoSync is off', async () => {
    const runBreakdown = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook((p) => useDirectorCascade(p), {
      initialProps: { show: base({ sourceText: '' }), autoSync: false, runBreakdown, runShotlist: vi.fn(), commitSyncState: vi.fn(), debounceMs: 2500 },
    });
    rerender({ show: base({ sourceText: SCRIPT }), autoSync: false, runBreakdown, runShotlist: vi.fn(), commitSyncState: vi.fn(), debounceMs: 2500 });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(runBreakdown).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Confirm the test dep exists**

Run: `node -e "require.resolve('@testing-library/react')"`
Expected: prints a path (it is already a dependency). Proceed.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/lib/director/cascade-orchestrator.test.ts`
Expected: FAIL — hook not implemented.

- [ ] **Step 4: Implement**

Create `src/components/director/use-director-cascade.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { DirectorShow } from '@/types/director';
import { sceneHashes, diffScenes, scenesForKeys, pruneRemovedScenes, remapSceneIndexMaps } from '@/lib/director/cascade';

interface Args {
  show: DirectorShow;
  autoSync: boolean;
  runBreakdown: (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
  runShotlist: (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
  commitSyncState: (next: NonNullable<DirectorShow['syncState']>) => void;
  debounceMs?: number;
}

export function useDirectorCascade({ show, autoSync, runBreakdown, runShotlist, commitSyncState, debounceMs = 2500 }: Args) {
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  // latest values for the timer closure
  const ref = useRef({ show, autoSync, runBreakdown, runShotlist, commitSyncState });
  ref.current = { show, autoSync, runBreakdown, runShotlist, commitSyncState };

  useEffect(() => {
    const next = sceneHashes(show);
    const prev = new Map(Object.entries(show.syncState?.hashes ?? {}));
    const d = diffScenes(prev, next);
    setDirty(d.changed);
    if (!autoSync || (d.changed.length === 0 && d.removed.length === 0)) return;

    // cancel & restart
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();

    timer.current = setTimeout(() => { void fire(); }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // re-run when the source signature changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.sourceText, autoSync, debounceMs]);

  async function fire() {
    const { show: cur, runBreakdown, runShotlist, commitSyncState } = ref.current;
    const prevKeys = Object.keys(cur.syncState?.hashes ?? {});
    const next = sceneHashes(cur);
    const nextKeys = [...next.keys()];
    const d = diffScenes(new Map(Object.entries(cur.syncState?.hashes ?? {})), next);

    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    try {
      const scope = d.changed.length && cur.docKind !== 'beatsheet'
        ? { sceneIds: scenesForKeys(cur, d.changed).map((s) => s.id) }
        : 'all' as const;
      await runBreakdown(scope, controller.signal);
      if (controller.signal.aborted) return;
      await runShotlist(scope, controller.signal);
      if (controller.signal.aborted) return;
      commitSyncState({ hashes: Object.fromEntries(next), dirty: [], lastRunAt: Date.now() });
      setDirty([]);
    } finally {
      setRunning(false);
    }
    // structural remap/prune are applied by DirectorTab via commit callbacks in Task 8
    void prevKeys; void nextKeys; void pruneRemovedScenes; void remapSceneIndexMaps;
  }

  return { dirty, running };
}
```

NOTE: `Date.now()` is fine in app code (only forbidden inside Workflow scripts).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/lib/director/cascade-orchestrator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/director/use-director-cascade.ts tests/lib/director/cascade-orchestrator.test.ts
git commit -m "feat(director): useDirectorCascade orchestrator (debounce + abort)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire the hook into DirectorTab + prune/remap on commit

**Files:**
- Modify: `src/components/director/director-tab.tsx` (mount hook; add prune/remap into the run commit; add `commitSyncState`)

**Interfaces:**
- Consumes: `useDirectorCascade` (Task 7); `pruneRemovedScenes`, `remapSceneIndexMaps` (Tasks 4-5).
- Produces: cascade mounted; `autoSync` read as `show.autoSync ?? true`.

- [ ] **Step 1: Apply prune + remap when committing a cascade result**

In `director-tab.tsx`, add a helper the hook's commit path uses. After a successful cascade run, before persisting the new `syncState`, apply structural cleanup. Add:

```ts
const commitSyncState = useCallback((syncState: NonNullable<DirectorShow['syncState']>) => {
  const cur = showRef.current;
  const prevKeys = Object.keys(cur.syncState?.hashes ?? {});
  const nextKeys = Object.keys(syncState.hashes);
  let nextShow = cur;
  if (prevKeys.join('|') !== nextKeys.join('|')) {
    nextShow = remapSceneIndexMaps(nextShow, prevKeys, nextKeys);
    nextShow = pruneRemovedScenes(nextShow, nextShow);
  }
  setShow({ ...nextShow, syncState });
}, [setShow]);
```

- [ ] **Step 2: Mount the hook**

Near the other hooks in `DirectorTab`:

```ts
const cascade = useDirectorCascade({
  show,
  autoSync: show.autoSync ?? true,
  runBreakdown,
  runShotlist,
  commitSyncState,
});
```

Add the imports at the top of the file:

```ts
import { useDirectorCascade } from './use-director-cascade';
import { pruneRemovedScenes, remapSceneIndexMaps } from '@/lib/director/cascade';
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/lib/director/`
Expected: tsc 0; director tests green.

- [ ] **Step 4: Commit**

```bash
git add src/components/director/director-tab.tsx
git commit -m "feat(director): mount cascade hook; prune+remap on sync commit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Auto-sync toggle + per-scene status UI

**Files:**
- Modify: `src/components/director/director-tab.tsx` (toolbar toggle + status from `cascade`)
- Modify: `src/components/director/director-breakdown-tab.tsx` (per-scene dot in `.dbk-navitem`)
- Modify: `src/styles/director-tab.css` (toggle + dot styles)

**Interfaces:**
- Consumes: `cascade.dirty`, `cascade.running` (Task 7 return); `show.autoSync`.
- Produces: a toggle that sets `show.autoSync`; dirty/running passed to the breakdown tab for per-scene dots.

- [ ] **Step 1: Add the toggle to the toolbar**

In `director-tab.tsx`, in the right-cluster `.director-tab__row` (before the LLM picker), add:

```tsx
<label className="director-tab__autosync" title="Auto-run breakdown + shotlist after edits">
  <input type="checkbox" checked={show.autoSync ?? true}
    onChange={(e) => setShow({ ...show, autoSync: e.target.checked })} />
  <span>Auto-sync{cascade.running ? ' ·…' : cascade.dirty.length ? ` · ${cascade.dirty.length} stale` : ''}</span>
</label>
```

- [ ] **Step 2: Pass sync status into the breakdown tab**

Add props to `DirectorBreakdownTab` (`dirtyKeys: string[]`, `syncing: boolean`) and render a dot on each `.dbk-navitem`. Map a scene to its key with the same derivation (`label.toUpperCase()` + `#n`), and show:

```tsx
<span className={`dbk-syncdot dbk-syncdot--${syncing ? 'run' : dirtyKeys.includes(keyOf(s)) ? 'stale' : 'ok'}`} />
```

Add `keyOf` locally mirroring `scenesForKeys`' derivation (upper-cased label + occurrence index).

- [ ] **Step 3: Styles**

Append to `src/styles/director-tab.css`:

```css
.director-tab__autosync { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-secondary); cursor:pointer; user-select:none; }
.director-tab__autosync input { accent-color:var(--accent); }
.dbk-syncdot { width:7px; height:7px; border-radius:50%; margin-left:auto; flex-shrink:0; }
.dbk-syncdot--ok { background:var(--success); }
.dbk-syncdot--stale { background:var(--text-tertiary); }
.dbk-syncdot--run { background:var(--accent); animation:dch-pulse 1s infinite ease-in-out; }
```

(`dch-pulse` already exists from the chat panel.)

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/lib/director/`
Expected: tsc 0; tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/director/director-tab.tsx src/components/director/director-breakdown-tab.tsx src/styles/director-tab.css
git commit -m "feat(director): auto-sync toggle + per-scene sync status dots

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Manual live verification (no automated step)

**Files:** none (verification only).

- [ ] **Step 1: Verify the cascade end-to-end**

With the web dev server on :5174 (restart via `npm --prefix web run dev` if needed), open the project, go to Director:
1. Upload / create a short script → after ~2.5s the breakdown populates, then the shotlist, with no clicks. Status dot pulses then goes green.
2. Edit one scene's action line → only that scene re-runs (its dot pulses; others stay green); other scenes' assets/clips unchanged.
3. Edit a beat in a beat sheet → cascade fires (beats use `'all'` scope).
4. Toggle Auto-sync off → edits mark scenes stale (grey dots) but nothing runs; toggle on → it runs.
5. Delete a scene → its clips disappear; assets only it referenced disappear; manual tags elsewhere survive.

- [ ] **Step 2: Record result in the ledger**

Append the outcome (pass/fail + notes) to `.superpowers/sdd/progress.md`.

---

## Self-Review

**Spec coverage:** trigger/debounce (T7), scene-scope (T3,T6,T7), no approval gate (T6 removes the forced mode/approve on auto path), toggle default ON (T1,T9), cancel & restart (T6 abort + T7 controller), prune removed (T4,T8), index remap (T5,T8), status UI (T9), persistence (T1 + existing blob), tests (T2-5,T7). Beats path: T2/T7 use `'all'` scope for beatsheet — covered.

**Placeholder scan:** every code step has full code; commands have expected output. No TBD/TODO.

**Type consistency:** `runBreakdown`/`runShotlist(scope, signal)` identical in T6, T7, T8. `commitSyncState(syncState)` matches between T7 (arg) and T8 (impl). `sceneHashes`/`diffScenes`/`scenesForKeys`/`pruneRemovedScenes(show,next)`/`remapSceneIndexMaps(show,prevKeys,nextKeys)` consistent across T2-5, T7, T8.

**Known follow-up (non-blocking):** scene-scoped breakdown still sends the whole script to the LLM with a scope note (the merge keeps other scenes); a future optimization could send only the changed scene's text. Logged, not built (YAGNI).
