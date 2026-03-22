# SP2: Create Tab Migration + Legacy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all references to `@/types/editor` and `@/lib/editor/timeline`, making the new flat-clip `Timeline` model the single source of truth.

**Architecture:** Simple import swaps for 3 files, full rewrite of `create-timeline.tsx` to use `Timeline` + `timeline-operations.ts` directly instead of old `Sequence` model with compat bridges, then delete old files.

**Tech Stack:** TypeScript, React, Vitest

---

## Chunk 1: Migration + Cleanup

### Task 1: Swap imports in preview-player.tsx

**Files:**
- Modify: `src/components/edit/preview-player.tsx:5`

- [ ] **Step 1: Change the import**

Change line 5 from:
```typescript
import type { Clip } from '@/types/editor';
```
to:
```typescript
import type { Clip } from '@/types/timeline';
```

No other changes needed — the `Clip` interface is structurally identical (same 8 fields: id, assetId, trackId, startTime, duration, trimStart, trimEnd, name). The `AudioEntry` export and all `clip.startTime`, `clip.trimStart` usages remain valid.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to preview-player.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/preview-player.tsx
git commit -m "refactor: migrate preview-player.tsx to @/types/timeline"
```

---

### Task 2: Swap imports in music-generation-popup.tsx

**Files:**
- Modify: `src/components/edit/music-generation-popup.tsx:5`

- [ ] **Step 1: Change the import**

Change line 5 from:
```typescript
import type { Clip } from '@/types/editor';
```
to:
```typescript
import type { Clip } from '@/types/timeline';
```

No other changes needed — the component uses `clip.startTime`, `clip.duration`, `clip.trimStart`, `clip.trimEnd` which all exist on the new `Clip` type identically.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to music-generation-popup.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/music-generation-popup.tsx
git commit -m "refactor: migrate music-generation-popup.tsx to @/types/timeline"
```

---

### Task 3: Swap imports in timeline-preview.tsx

**Files:**
- Modify: `src/components/create/timeline-preview.tsx:5`

- [ ] **Step 1: Change the import**

Change line 5 from:
```typescript
import type { Clip } from '@/types/editor';
```
to:
```typescript
import type { Clip } from '@/types/timeline';
```

No other changes needed — the component uses `clip.startTime` and `clip.trimStart` which exist identically.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to timeline-preview.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/create/timeline-preview.tsx
git commit -m "refactor: migrate timeline-preview.tsx to @/types/timeline"
```

---

### Task 4: Rewrite create-timeline.tsx

**Files:**
- Modify: `src/components/create/create-timeline.tsx`

This is the big migration. The file currently:
1. Imports from `@/types/editor` (Sequence, Track as OldTrack, Clip as OldClip)
2. Imports operations from `@/lib/editor/timeline` (trimClip, removeClip, moveClip, splitClip, duplicateClip, snapToHalfSecond, calculateSequenceDuration)
3. Has `timelineToSequence()` and `sequenceToTimeline()` compat bridges
4. Works with `sequence.tracks[0]` (single-track assumption)
5. Dispatches via `setSequence()` which converts Sequence → Timeline before dispatch

After rewrite:
1. Import from `@/types/timeline` (Timeline, Clip)
2. Import operations from `@/lib/editor/timeline-operations`
3. Delete compat bridges entirely
4. Work directly with `timeline.clips` filtered to V1 track
5. Dispatch via `SET_TIMELINE` directly

- [ ] **Step 1: Replace imports**

Remove:
```typescript
import {
  trimClip,
  removeClip,
  moveClip,
  splitClip,
  duplicateClip,
  snapToHalfSecond,
  calculateSequenceDuration,
} from '@/lib/editor/timeline';
import type { Sequence, Track as OldTrack, Clip as OldClip } from '@/types/editor';
import type { Timeline } from '@/types/timeline';
```

Replace with:
```typescript
import type { Clip, Timeline } from '@/types/timeline';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';
import {
  trimClip,
  removeClip,
  moveClip,
  splitClip,
  duplicateClip,
  snapToHalfSecond,
  calculateTimelineDuration,
  clipsOnTrack,
} from '@/lib/editor/timeline-operations';
```

- [ ] **Step 2: Delete compat bridge functions**

Delete the entire `timelineToSequence()` function (lines 32–48) and `sequenceToTimeline()` function (lines 50–61).

- [ ] **Step 3: Rewrite component body**

Replace the component's internal logic. Key changes:

**Remove `sequence` useMemo and `setSequence` callback:**
```typescript
// DELETE these:
const sequence = useMemo(() => timelineToSequence(timeline), [timeline]);
const setSequence = useCallback(
  (seq: Sequence) => {
    const tl = timelineRef.current;
    dispatch({ type: 'SET_TIMELINE', timelineId: tl.id, timeline: sequenceToTimeline(seq, tl) });
  },
  [dispatch],
);
```

**Add direct timeline dispatch:**
```typescript
const setTimeline = useCallback(
  (tl: Timeline) => {
    dispatch({ type: 'SET_TIMELINE', timelineId: tl.id, timeline: tl });
  },
  [dispatch],
);
```

**Replace `track` and `clipCount` derivation:**
```typescript
// OLD:
const track = sequence.tracks[0];
const clipCount = track?.clips.length ?? 0;

// NEW:
const v1Track = timeline.tracks.find((t) => t.kind === 'video');
const v1TrackId = v1Track?.id;
const trackClips = useMemo(
  () => (v1TrackId ? clipsOnTrack(timeline, v1TrackId) : []),
  [timeline, v1TrackId],
);
const clipCount = trackClips.length;
```

**Replace `sequenceDuration`:**
```typescript
// OLD:
const sequenceDuration = useMemo(
  () => Math.max(calculateSequenceDuration(sequence), 1),
  [sequence],
);

// NEW:
const sequenceDuration = useMemo(
  () => Math.max(calculateTimelineDuration(timeline), 1),
  [timeline],
);
```

**Replace `totalWidth` calculation:**
```typescript
// OLD: Math.max(sequence.duration, minSeconds)
// NEW:
const totalWidth = Math.max(timeline.duration, minSeconds) * pxPerSecond;
```

**Replace all operation callbacks to use timeline directly:**

```typescript
const handleTrimClip = useCallback(
  (clipId: string, trimStart: number, trimEnd: number, startTime?: number) => {
    setTimeline(trimClip(timeline, clipId, trimStart, trimEnd, startTime));
  },
  [timeline, setTimeline],
);

const handleRemoveClip = useCallback(
  (clipId: string) => setTimeline(removeClip(timeline, clipId)),
  [timeline, setTimeline],
);

const handleMoveClip = useCallback(
  (clipId: string, newStartTime: number) => {
    if (!v1TrackId) return;
    setTimeline(moveClip(timeline, clipId, v1TrackId, newStartTime));
  },
  [v1TrackId, timeline, setTimeline],
);

const handleDuplicateClip = useCallback(
  (clipId: string, newStartTime: number) => {
    const result = duplicateClip(timeline, clipId, newStartTime);
    setTimeline(result.timeline);
    if (result.newClipId) setSelectedClipId(result.newClipId);
  },
  [timeline, setTimeline],
);
```

**Replace blade cut:**
```typescript
const handleBladeCutAt = useCallback((time: number) => {
  if (!v1TrackId) return;
  const clip = trackClips.find(
    (c) => time > c.startTime && time < c.startTime + clipEffectiveDuration(c),
  );
  if (clip) {
    setTimeline(splitClip(timeline, clip.id, time));
  }
}, [v1TrackId, trackClips, timeline, setTimeline]);
```

**Replace `activeClip`:**
```typescript
const activeClip = useMemo(() => {
  return trackClips.find(
    (c) => currentTime >= c.startTime && currentTime < clipEndTime(c),
  ) ?? null;
}, [trackClips, currentTime]);
```

**Replace `rulerTicks` — change `sequence.duration` → `timeline.duration`:**
```typescript
// In rulerTicks useMemo:
const totalSeconds = Math.ceil(Math.max(timeline.duration, minSeconds));
// In dependency array: change [sequence.duration, ...] → [timeline.duration, ...]
```

**Replace JSX clip rendering:**
```typescript
// OLD:
{track.clips.map((clip) => (
  <ClipCard key={clip.id} clip={clip} ...

// NEW:
{trackClips.map((clip) => (
  <ClipCard key={clip.id} clip={clip} ...
```

**Replace ghost rendering (find source clip):**
```typescript
// OLD:
const srcClip = track.clips.find((c) => c.id === ghost.clipId);

// NEW:
const srcClip = trackClips.find((c) => c.id === ghost.clipId);
```

**Also replace ghost effective duration calculation:**
```typescript
// OLD:
const eff = srcClip.duration - srcClip.trimStart - srcClip.trimEnd;

// NEW:
const eff = clipEffectiveDuration(srcClip);
```

**Replace `timelineRef` usage:**
```typescript
// OLD:
const timelineRef = useRef(timeline);
timelineRef.current = timeline;

// KEEP this — it's needed for the setTimeline closure.
// But remove any reference to timelineRef in setSequence (deleted).
```

Actually `timelineRef` was only used by `setSequence` to access the current timeline for the conversion. Since `setTimeline` takes the full `Timeline` object, we don't need `timelineRef` at all. Delete it.

**Replace `open && track &&` guard in JSX:**
```typescript
// OLD: {open && track && (
// NEW: {open && v1Track && (
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors. Every reference to old types and operations should be gone from this file.

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All 70 existing passing tests still pass. (The 1 failing test in old `timeline.test.ts` will be deleted in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add src/components/create/create-timeline.tsx
git commit -m "refactor: rewrite create-timeline.tsx to use Timeline + timeline-operations directly"
```

---

### Task 5: Verify no remaining imports of old types

**Files:** None (verification only)

- [ ] **Step 1: Search for old imports**

Run: `grep -r "@/types/editor" src/ --include="*.ts" --include="*.tsx"`
Expected: Zero results. If any files still import from `@/types/editor`, fix them before proceeding.

Run: `grep -r "@/lib/editor/timeline'" src/ --include="*.ts" --include="*.tsx"`
(Note the trailing single quote to match the exact module path, not `timeline-operations` or `timeline-migration`)
Expected: Zero results.

---

### Task 6: Delete old files

**Files:**
- Delete: `src/types/editor.ts`
- Delete: `src/lib/editor/timeline.ts`
- Delete: `tests/lib/editor/timeline.test.ts`

- [ ] **Step 1: Delete the files**

```bash
rm src/types/editor.ts
rm src/lib/editor/timeline.ts
rm tests/lib/editor/timeline.test.ts
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors. No file should reference these deleted modules.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (should now be 70/70 — the old failing test is deleted). The new `timeline-operations.test.ts` (52 tests) + `timeline-migration.test.ts` (3 tests) + other tests should all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete legacy editor.ts, timeline.ts, and old tests"
```
