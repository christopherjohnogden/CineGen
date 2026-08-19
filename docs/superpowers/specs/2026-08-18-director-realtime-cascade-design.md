# Director Real-Time Cascade (Script → Breakdown → Shotlist) — Design

**Status:** Approved (pending spec review)
**Branch:** `director-page-redesign`
**Date:** 2026-08-18

## Goal

When the user changes the script or beat sheet, the Breakdown and Shotlist
update automatically and incrementally — re-running only for the scenes/beats
that actually changed — so the three tabs stay in sync in near real time
without a manual "Run breakdown" / "Shotlist" click.

## User-facing behavior

- **Upload / create a script or beat sheet** → the whole thing is "dirty" →
  after a short idle pause the app auto-runs breakdown, then shotlist, for
  every scene.
- **Edit one scene/beat** → only that scene/beat is re-broken-down and
  re-shotlisted; every other scene and any manual edits elsewhere are
  preserved.
- **Delete a scene/beat** → its breakdown items (that belong only to it) and
  its clips are pruned.
- **No approval gate** in the auto path: breakdown flows straight into
  shotlist. The result is reversible (re-run / undo), so mistakes are cheap.
- **Auto-sync toggle** in the toolbar, default ON. Off = edits mark scenes
  "stale" but nothing runs until toggled back on (or a manual run).
- **Cancel & restart:** editing while a cascade is running aborts the
  in-flight job and re-arms from the newest text after the next idle pause.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Trigger | Auto after ~2.5s idle pause (debounced) |
| Update scope | Only the changed scene/beat |
| Approval gate | Dropped for the auto path; reversible instead |
| Control | Auto-sync toggle, default ON |
| In-flight edits | Cancel in-flight job & restart |

## Architecture & data flow

The authoritative source is `show.sourceText` (+ `sourceElements` for a
screenplay, `beatSheet` for beats; both already serialize into `sourceText`).
A cascade **diff engine** turns source changes into a per-scene dirty set; an
**orchestrator hook** debounces and drives the existing LLM jobs for only the
dirty scenes.

```
source change → recompute sceneHashes → diff vs lastSyncedHashes
  → dirty set (changed + removed)
  → debounce ~2.5s (if autoSync)
  → runBreakdown(changed scope)  → mergeBreakdownItems into rest
  → runShotlist({ sceneIds: changed })  → mergeShotlist into rest
  → pruneRemovedScenes(removed)
  → lastSyncedHashes = current
```

Removed scenes are pruned locally (no LLM). Reordering a scene without editing
its text does **not** re-run its LLM jobs (hash unchanged) — only its position
in existing scene arrays updates.

**Index-keyed overrides must be remapped.** `sceneAssetOverrides` and
`sceneAssetSuggestions` are keyed by scene *index*, which shifts when a scene is
inserted or removed. The cascade computes an old-index → new-index map from the
scene-key diff and rewrites both maps so a user's manual per-scene asset
adds/removes stay attached to the right scene after a structural edit. This
remap runs whenever the set or order of scene keys changes, even if no LLM job
fires.

## Components

### `src/lib/director/cascade.ts` (new, pure — no React, no LLM)

Testable diff engine.

```ts
/** One stable content hash per scene. Screenplay: scene heading + body text.
 *  Beats: the beat's fields. Key is a stable scene identity (heading/beat n),
 *  NOT array index, so reordering doesn't read as an edit. */
export function sceneHashes(show: DirectorShow): Map<string, string>;

export interface SceneDiff { changed: string[]; removed: string[]; }
/** changed = keys whose hash differs or are new; removed = keys gone from next. */
export function diffScenes(prev: Map<string, string>, next: Map<string, string>): SceneDiff;

/** Drop clips whose scene is gone (clips are scene-owned via clip.sceneId) and
 *  breakdown items no longer referenced by ANY surviving scene. Because
 *  breakdown items are global (no scene ownership field), "still referenced" is
 *  recomputed against the surviving scenes' text via the existing
 *  detectSceneAssets matcher. An item manually added via sceneAssetOverrides is
 *  kept as long as any surviving scene's override still lists it. Pure. */
export function pruneRemovedScenes(show: DirectorShow, next: DirectorShow): DirectorShow;

/** Map dirty scene keys → the DirectorScene ids the LLM jobs take as scope. */
export function scenesForKeys(show: DirectorShow, keys: string[]): DirectorScene[];
```

Scene key derivation:
- **Screenplay:** split via existing `splitScenes(parseToScreenplay(sourceText))`;
  key = normalized scene heading + `#index-within-duplicate-heading` to keep
  duplicate headings distinct; hash = FNV-1a of heading + joined element text.
- **Beats:** key = `beat:${n}`; hash = FNV-1a of `action|location|shot|mood`.

### `src/components/director/use-director-cascade.ts` (new hook)

Orchestrator. Owns the debounce timer and the in-flight `AbortController`.

```ts
export function useDirectorCascade(args: {
  show: DirectorShow;
  autoSync: boolean;
  runBreakdown: (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
  runShotlist:  (scope: { sceneIds: string[] } | 'all', signal: AbortSignal) => Promise<void>;
  onSyncStateChange: (next: NonNullable<DirectorShow['syncState']>) => void;
}): { dirty: string[]; running: boolean };
```

Behavior:
- `useEffect` on a cheap signature of the source (`sourceText` length + a fast
  hash) recomputes `sceneHashes`, diffs vs `show.syncState.hashes`, stores
  `dirty`.
- If `autoSync` and `dirty.length`, arm a 2500ms timer. A new change clears the
  timer and aborts any in-flight controller (cancel & restart).
- On fire: create a fresh `AbortController`; await `runBreakdown(scope, signal)`;
  if not aborted and it succeeded, await `runShotlist(scope, signal)`; then
  `pruneRemovedScenes`; then commit `syncState.hashes = current`, clear dirty.
- If breakdown throws (non-abort) → stop, leave scenes dirty, surface error via
  existing `jobStatus`. Abort → silent.

### `DirectorTab` wiring

- Add `sceneScope?: { sceneIds: string[] } | 'all'` + `signal?: AbortSignal` to
  `runBreakdown` (shotlist already has scene-only; extend it to accept an
  explicit `sceneIds` list and a signal).
- Thread the `AbortSignal` into `runDirectorJsonJob` (it already takes a
  `requestId`; add optional `signal` that rejects the promise on abort).
- Mount `useDirectorCascade`; render the toggle + indicators.

## Data model additions (`src/types/director.ts`)

```ts
interface DirectorShow {
  // ...
  /** Auto-run breakdown+shotlist after edits. Absent = true (on by default). */
  autoSync?: boolean;
  /** What the cascade has already synced, so it survives reload. */
  syncState?: {
    hashes: Record<string, string>;
    dirty: string[];
    lastRunAt?: number;
  };
}
```

Persisted automatically — `director` is stored as an opaque JSON blob in both
`electron/db/project-db.ts` and `site/lib/server/project-store.ts`.

## UI

- **Auto-sync toggle** in `DirectorTab` toolbar (right cluster), default ON.
  Off state shows a "Sync now" button when scenes are dirty.
- **Per-scene status dot** in the breakdown scene nav (`.dbk-navitem`) and the
  structure rail: syncing (pulsing amber) / synced (green) / stale (grey),
  driven by `dirty` + `running`.
- Existing single `jobStatus` line narrates the active step
  ("Breaking down scene 2…" → "Shotlisting scene 2…").

## Error handling

- Breakdown failure → no shotlist; keep prior data; scene stays dirty; error in
  `jobStatus`.
- Abort (cancel & restart) → silent, no error surfaced.
- Shotlist failure → keep breakdown; scene stays dirty for shotlist retry.
- Auto-sync OFF → never runs; dirty set still tracked and shown as stale.

## Testing

Pure engine (`cascade.ts`) unit tests:
- `sceneHashes`: stable across a no-op re-serialize; changes when a scene's text
  changes; distinct keys for duplicate headings.
- `diffScenes`: detects add / change / remove; a pure **reorder** yields empty
  changed set.
- `pruneRemovedScenes`: drops clips whose scene is gone; drops items no
  surviving scene references; keeps an item still referenced by a surviving
  scene; keeps an item a surviving scene's override still lists.
- `scenesForKeys`: maps keys back to the right `DirectorScene` ids.
- index remap: inserting/removing a scene rewrites `sceneAssetOverrides` /
  `sceneAssetSuggestions` so each stays attached to its original scene.

Hook timing/abort — integration test with fake timers:
- Rapid edits collapse to one run (debounce).
- Edit mid-run aborts and restarts.
- `autoSync=false` never fires the timer.

## Non-goals (YAGNI)

- No diffing *within* a scene to re-run sub-parts — scene is the atom.
- No multi-job parallelism — one cascade at a time (matches single `jobStatus`).
- No server-side cascade — all client-orchestrated, same as today's manual runs.
