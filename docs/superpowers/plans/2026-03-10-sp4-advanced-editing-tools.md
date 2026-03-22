# SP4: Advanced Editing Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `useTimelineDrag` hook into timeline-editor.tsx so all 7 editing tools (select, trackForward, blade, ripple, roll, slip, slide) work end-to-end with visual feedback and keyboard modifiers.

**Architecture:** Replace ~200 lines of inline pointer handlers in timeline-editor.tsx with the existing `useTimelineDrag` hook. Add visual feedback callbacks to the hook. Add `splitAllTracks()` to timeline-operations.ts. Add tool-specific cursor CSS and visual overlays.

**Tech Stack:** React 18, TypeScript, Vitest

**Deferred to SP5:** Slip filmstrip visual in ClipCard (requires filmstrip/thumbnail infrastructure from SP5), beat grid snap (requires ruler tick data plumbing).

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/lib/editor/timeline-operations.ts` | Pure timeline operations | Modify: add `splitAllTracks()` |
| `tests/lib/editor/timeline-operations.test.ts` | Operation unit tests | Modify: add tests for `splitAllTracks` |
| `src/components/edit/use-timeline-drag.ts` | Unified drag handler hook | Modify: add visual feedback callbacks, Ctrl+blade, Shift→ripple |
| `src/components/edit/timeline-editor.tsx` | Timeline track area UI | Modify: replace inline roll/blade handlers with hook, add overlay state + JSX rendering |
| `src/components/edit/track-row.tsx` | Track row component | Modify: pass `activeTool` and `onClipMouseDown` to ClipCard |
| `src/components/edit/clip-card.tsx` | Clip card component | Modify: delegate advanced tool events to hook |
| `src/components/edit/edit-tab.tsx` | Main edit tab | Modify: add keyboard shortcuts for ripple/roll |
| `src/styles/globals.css` | Global styles | Modify: add tool cursor classes + visual overlay styles |

**Important:** `handleMoveClip` and `handleTrimClip` in `timeline-editor.tsx` are **kept** — ClipCard still uses them for basic select/move/trim. Only roll edit and blade inline handlers are removed and replaced by the hook.

---

## Chunk 1: Core Operations & Hook Wiring

### Task 1: Add `splitAllTracks` operation

**Files:**
- Modify: `src/lib/editor/timeline-operations.ts:93-121`
- Test: `tests/lib/editor/timeline-operations.test.ts`

- [ ] **Step 1: Write the failing test for `splitAllTracks`**

Add to the end of `tests/lib/editor/timeline-operations.test.ts`:

```typescript
describe('splitAllTracks', () => {
  it('splits clips on all unlocked tracks at the given time', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10 }),
        makeClip({ id: 'c2', trackId: 'a1', startTime: 2, duration: 8 }),
      ],
    });
    const result = splitAllTracks(tl, 5);
    // c1 should be split at t=5 (two clips on v1)
    const v1Clips = result.clips.filter((c) => c.trackId === 'v1');
    expect(v1Clips).toHaveLength(2);
    expect(v1Clips[0].trimEnd).toBe(5); // first half: 0-5
    expect(v1Clips[1].startTime).toBe(5); // second half: 5-10
    // c2 should be split at t=5 (two clips on a1)
    const a1Clips = result.clips.filter((c) => c.trackId === 'a1');
    expect(a1Clips).toHaveLength(2);
  });

  it('skips locked tracks', () => {
    const tl = makeTimeline({
      tracks: [
        { id: 'v1', name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: true, visible: true, volume: 1 },
        { id: 'a1', name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      ],
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10 }),
        makeClip({ id: 'c2', trackId: 'a1', startTime: 0, duration: 10 }),
      ],
    });
    const result = splitAllTracks(tl, 5);
    // v1 is locked — clip unchanged
    expect(result.clips.filter((c) => c.trackId === 'v1')).toHaveLength(1);
    // a1 is unlocked — clip split
    expect(result.clips.filter((c) => c.trackId === 'a1')).toHaveLength(2);
  });

  it('does nothing if no clips overlap the split time', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 3 })],
    });
    const result = splitAllTracks(tl, 5);
    expect(result.clips).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: FAIL — `splitAllTracks` is not exported.

- [ ] **Step 3: Implement `splitAllTracks`**

Add to `src/lib/editor/timeline-operations.ts` after the `splitClip` function (after line 121):

```typescript
export function splitAllTracks(timeline: Timeline, splitTime: number): Timeline {
  const lockedTrackIds = new Set(
    timeline.tracks.filter((t) => t.locked).map((t) => t.id),
  );
  let result = timeline;
  for (const clip of timeline.clips) {
    if (lockedTrackIds.has(clip.trackId)) continue;
    const effDur = clipEffectiveDuration(clip);
    const rel = splitTime - clip.startTime;
    if (rel > 0 && rel < effDur) {
      result = splitClip(result, clip.id, splitTime);
    }
  }
  return result;
}
```

- [ ] **Step 4: Add the import to the test file**

In `tests/lib/editor/timeline-operations.test.ts`, add `splitAllTracks` to the import on line 2-22.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: All tests PASS (59 existing + 3 new = 62 tests).

- [ ] **Step 6: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean — no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/editor/timeline-operations.ts tests/lib/editor/timeline-operations.test.ts
git commit -m "feat(editor): add splitAllTracks operation for Ctrl+blade"
```

---

### Task 2: Add visual feedback callbacks and keyboard modifiers to `useTimelineDrag`

**Files:**
- Modify: `src/components/edit/use-timeline-drag.ts`

This task extends the hook with:
1. Visual feedback callback props for ripple, slip, slide, trackForward
2. Shift key → force ripple trim regardless of active tool
3. Ctrl+blade → `splitAllTracks` instead of single-clip split
4. Snap to playhead position

- [ ] **Step 1: Update the `UseTimelineDragOptions` interface**

Replace the entire `UseTimelineDragOptions` interface (lines 25-34) with:

```typescript
interface UseTimelineDragOptions {
  tool: ToolType;
  timeline: Timeline;
  pxPerSecond: number;
  snapEnabled: boolean;
  currentTime: number;
  onUpdate: (timeline: Timeline) => void;
  onSelect: (ids: Set<string>) => void;
  onTrimPreview?: (clipId: string, sourceTime: number) => void;
  onTrimPreviewEnd?: () => void;
  onRipplePreview?: (clipId: string, affectedClipIds: string[], delta: number) => void;
  onRipplePreviewEnd?: () => void;
  onSlipPreview?: (clipId: string, sourceOffset: number) => void;
  onSlipPreviewEnd?: () => void;
  onSlidePreview?: (clipId: string, leftDelta: number, rightDelta: number) => void;
  onSlidePreviewEnd?: () => void;
  onTrackForwardHighlight?: (clipIds: string[]) => void;
  onTrackForwardHighlightEnd?: () => void;
}
```

- [ ] **Step 2: Update the hook signature to destructure new props**

Update the function signature (line 36-44) to destructure all new props:

```typescript
export function useTimelineDrag({
  tool,
  timeline,
  pxPerSecond,
  snapEnabled,
  currentTime,
  onUpdate,
  onSelect,
  onTrimPreview,
  onTrimPreviewEnd,
  onRipplePreview,
  onRipplePreviewEnd,
  onSlipPreview,
  onSlipPreviewEnd,
  onSlidePreview,
  onSlidePreviewEnd,
  onTrackForwardHighlight,
  onTrackForwardHighlightEnd,
}: UseTimelineDragOptions) {
```

- [ ] **Step 3: Add Shift→ripple override in handleMouseMove**

In `handleMouseMove` (inside `handleClipMouseDown`), replace the `switch (tool)` block (lines 85-122) with logic that checks for Shift key override:

```typescript
        // Shift key forces ripple trim regardless of active tool
        const effectiveTool = me.shiftKey && (edge === 'left' || edge === 'right') ? 'ripple' : tool;

        switch (effectiveTool) {
          case 'select':
          case 'trackForward':
            if (edge === 'body') {
              updated = moveClip(timeline, clip.id, clip.trackId, dragRef.current.startTime + deltaSec);
            } else {
              const newTrimStart = edge === 'left' ? clip.trimStart + deltaSec : clip.trimStart;
              const newTrimEnd = edge === 'right' ? clip.trimEnd - deltaSec : clip.trimEnd;
              const newStartTime = edge === 'left' ? clip.startTime + deltaSec : clip.startTime;
              updated = trimClip(timeline, clip.id, newTrimStart, newTrimEnd, newStartTime);
            }
            break;
          case 'ripple': {
            const rippleEdge = edge === 'body' ? 'right' : edge;
            updated = rippleTrim(timeline, clip.id, rippleEdge, deltaSec);
            // Visual feedback: find affected downstream clips
            if (onRipplePreview) {
              const trackClips = clipsOnTrack(updated, clip.trackId);
              const idx = trackClips.findIndex((c) => c.id === clip.id);
              const affectedIds = trackClips.slice(idx + 1).map((c) => c.id);
              onRipplePreview(clip.id, affectedIds, deltaSec);
            }
            break;
          }
          case 'roll': {
            const trackClips = clipsOnTrack(timeline, clip.trackId);
            const idx = trackClips.findIndex((c) => c.id === clip.id);
            if (edge === 'right' && idx < trackClips.length - 1) {
              updated = rollTrim(timeline, clip.id, trackClips[idx + 1].id, deltaSec);
            } else if (edge === 'left' && idx > 0) {
              updated = rollTrim(timeline, trackClips[idx - 1].id, clip.id, -deltaSec);
            } else {
              updated = timeline;
            }
            break;
          }
          case 'slip':
            updated = slipClip(timeline, clip.id, deltaSec);
            onSlipPreview?.(clip.id, clip.trimStart + deltaSec);
            break;
          case 'slide': {
            updated = slideClip(timeline, clip.id, deltaSec);
            // Compute neighbor deltas for visual feedback
            const trackClips = clipsOnTrack(timeline, clip.trackId);
            const sIdx = trackClips.findIndex((c) => c.id === clip.id);
            const leftN = sIdx > 0 ? trackClips[sIdx - 1] : null;
            const rightN = sIdx < trackClips.length - 1 ? trackClips[sIdx + 1] : null;
            if (leftN && rightN) {
              const updLeft = updated.clips.find((c) => c.id === leftN.id);
              const updRight = updated.clips.find((c) => c.id === rightN.id);
              onSlidePreview?.(
                clip.id,
                (updLeft?.trimEnd ?? leftN.trimEnd) - leftN.trimEnd,
                (updRight?.trimStart ?? rightN.trimStart) - rightN.trimStart,
              );
            }
            break;
          }
          default:
            updated = timeline;
        }
```

- [ ] **Step 4: Add cleanup calls in handleMouseUp**

In `handleMouseUp` (lines 127-134), add cleanup for all preview callbacks:

```typescript
      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onTrimPreviewEnd?.();
        onRipplePreviewEnd?.();
        onSlipPreviewEnd?.();
        onSlidePreviewEnd?.();
        onTrackForwardHighlightEnd?.();
      };
```

- [ ] **Step 5: Add trackForward highlight on mousedown**

In the `handleClipMouseDown` function, update the trackForward branch (lines 57-60) to call highlight:

```typescript
      if (tool === 'trackForward') {
        const ids = trackSelectForward(timeline, clip.id);
        onSelect(ids);
        onTrackForwardHighlight?.([...ids]);
      } else if (tool === 'blade') {
```

- [ ] **Step 6: Update `handleBladeClick` to support Ctrl+splitAllTracks**

Add the `splitAllTracks` import at the top of the file (line 8, add to the import):

```typescript
import {
  moveClip,
  trimClip,
  splitClip,
  splitAllTracks,
  rippleTrim,
  rollTrim,
  slipClip,
  slideClip,
  trackSelectForward,
  clipsOnTrack,
} from '@/lib/editor/timeline-operations';
```

Replace `handleBladeClick` (lines 143-158) with:

```typescript
  const handleBladeClick = useCallback(
    (trackId: string, time: number, ctrlKey: boolean) => {
      if (tool !== 'blade') return;

      if (ctrlKey) {
        // Ctrl+blade: split all unlocked tracks at this time
        onUpdate(splitAllTracks(timeline, time));
        return;
      }

      const track = timeline.tracks.find((t) => t.id === trackId);
      if (track?.locked) return;

      const clip = timeline.clips.find(
        (c) => c.trackId === trackId && c.startTime <= time && clipEndTime(c) > time,
      );
      if (clip) {
        onUpdate(splitClip(timeline, clip.id, time));
      }
    },
    [tool, timeline, onUpdate],
  );
```

- [ ] **Step 7: Update dependency array**

Update the `useCallback` dependency array for `handleClipMouseDown` (line 140) to include the new callbacks:

```typescript
    [tool, timeline, pxPerSecond, snapEnabled, currentTime, onUpdate, onSelect, onTrimPreview, onTrimPreviewEnd, onRipplePreview, onRipplePreviewEnd, onSlipPreview, onSlipPreviewEnd, onSlidePreview, onSlidePreviewEnd, onTrackForwardHighlight, onTrackForwardHighlightEnd],
```

- [ ] **Step 8: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (may show errors in timeline-editor.tsx since it hasn't been updated yet — that's OK, we fix it in Task 3).

- [ ] **Step 9: Commit**

```bash
git add src/components/edit/use-timeline-drag.ts
git commit -m "feat(editor): add visual feedback callbacks and keyboard modifiers to useTimelineDrag"
```

---

### Task 3: Wire `useTimelineDrag` into `timeline-editor.tsx` and replace inline handlers

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

This is the biggest task. It replaces:
1. The inline `handleBladeClick` (lines 459-481) → hook's `handleBladeClick`
2. The inline roll edit detection + drag (lines 73-82, 343-349, 369-376, 527-541, 737-766) → hook handles roll via tool selection
3. The inline `handleTrimClip` (lines 206-223) and `handleMoveClip` (lines 163-195) → hook's unified drag
4. Adds visual feedback state (ripple overlay, slip/slide indicators)

- [ ] **Step 1: Add `useTimelineDrag` import and hook call**

At the top of `timeline-editor.tsx`, add to imports (after line 15):

```typescript
import { useTimelineDrag } from './use-timeline-drag';
```

- [ ] **Step 2: Add visual feedback state**

After the `moveSnapX` state (line 106), add overlay state variables:

```typescript
  // Visual feedback state for advanced tools
  const [ripplePreview, setRipplePreview] = useState<{ clipId: string; affectedIds: string[]; delta: number } | null>(null);
  const [slipPreview, setSlipPreview] = useState<{ clipId: string; sourceOffset: number } | null>(null);
  const [slidePreview, setSlidePreview] = useState<{ clipId: string; leftDelta: number; rightDelta: number } | null>(null);
  const [trackForwardHighlight, setTrackForwardHighlight] = useState<string[] | null>(null);
```

- [ ] **Step 3: Call `useTimelineDrag` hook**

After the visual feedback state, add:

```typescript
  const { handleClipMouseDown, handleBladeClick: hookBladeClick } = useTimelineDrag({
    tool: activeTool,
    timeline,
    pxPerSecond,
    snapEnabled,
    currentTime,
    onUpdate: setTimeline,
    onSelect: onSelectClips,
    onTrimPreview,
    onTrimPreviewEnd,
    onRipplePreview: (clipId, affectedIds, delta) => setRipplePreview({ clipId, affectedIds, delta }),
    onRipplePreviewEnd: () => setRipplePreview(null),
    onSlipPreview: (clipId, sourceOffset) => setSlipPreview({ clipId, sourceOffset }),
    onSlipPreviewEnd: () => setSlipPreview(null),
    onSlidePreview: (clipId, leftDelta, rightDelta) => setSlidePreview({ clipId, leftDelta, rightDelta }),
    onSlidePreviewEnd: () => setSlidePreview(null),
    onTrackForwardHighlight: (ids) => setTrackForwardHighlight(ids),
    onTrackForwardHighlightEnd: () => setTrackForwardHighlight(null),
  });
```

- [ ] **Step 4: Remove ONLY roll edit and blade inline handlers (keep move/trim handlers)**

**KEEP these** — ClipCard still uses them for basic select/move/trim:
- `handleMoveClip` (lines 163-195) — KEEP
- `handleTrimClip` (lines 206-223) — KEEP
- `moveRafRef`/`pendingMoveRef` (lines 160-161) — KEEP
- `trimRafRef`/`pendingTrimRef` (lines 206-207) — KEEP

**REMOVE these** — replaced by the hook:
1. **Roll edit state** (lines 73-82): Remove `rollEditPoint`, `rollDragRef`, `pendingRollRef`, `rollRafRef` state/refs and the `ROLL_THRESHOLD_PX` constant (line 74).
2. **`handleRollEdit`** (lines 527-541): Remove.
3. **`detectRollEditPoint`** (lines 484-524): Remove.
4. **Old `handleBladeClick`** (lines 459-481): Replace with a wrapper that calls the hook:

```typescript
  const handleBladeClickWrapper = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'blade') return;
      const tracksEl = tracksRef.current;
      if (!tracksEl) return;
      const rect = tracksEl.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const time = Math.max(0, x / pxPerSecond);

      // Find which track was clicked
      const trackEls = tracksEl.querySelectorAll('[data-track-id]');
      let targetTrackId = '';
      for (const el of trackEls) {
        const tRect = el.getBoundingClientRect();
        if (e.clientY >= tRect.top && e.clientY <= tRect.bottom) {
          targetTrackId = el.getAttribute('data-track-id') ?? '';
          break;
        }
      }
      if (targetTrackId) {
        hookBladeClick(targetTrackId, time, e.ctrlKey || e.metaKey);
      }
    },
    [activeTool, pxPerSecond, hookBladeClick],
  );
```

9. **Roll edit in `handleTrackAreaPointerMove`** (lines 342-349): Remove the roll drag block. The hook manages this.
10. **Roll edit in `handleTrackAreaPointerUp`** (lines 369-376): Remove the roll drag cleanup block.

- [ ] **Step 5: Update `handleBladeMove` to remove roll detection**

Replace `handleBladeMove` (lines 543-557) with a simpler version:

```typescript
  const handleBladeMove = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'blade') { setBladeX(null); return; }
      const tracksEl = tracksRef.current;
      if (!tracksEl) return;
      const rect = tracksEl.getBoundingClientRect();
      setBladeX(e.clientX - rect.left);
    },
    [activeTool],
  );
```

- [ ] **Step 6: Update TrackRow props to use hook handlers**

Replace the TrackRow rendering (lines 767-793). The key change: instead of passing `onTrimClip`, `onMoveClip`, `onMoveSnap`, and `snapMoveTime` as separate callbacks, pass `onClipMouseDown` from the hook. TrackRow and ClipCard need to delegate pointer events to the hook.

However, this would require refactoring TrackRow/ClipCard interfaces significantly. **Pragmatic approach:** Keep ClipCard's existing pointer handling for select+trim+move (it already works well), and route the advanced tools through the hook. The hook's `handleClipMouseDown` should only be called for advanced tools (ripple, roll, slip, slide, trackForward).

Add to the TrackRow props: `activeTool` and `onClipMouseDown`:

In the TrackRow rendering (around line 767):
```typescript
            <TrackRow
              key={track.id}
              track={track}
              clips={timeline.clips.filter((c) => c.trackId === track.id)}
              assets={assets}
              pixelsPerSecond={pxPerSecond}
              snapTime={snapTime}
              selectedClipIds={selectedClipIds}
              onSelectClip={handleSelectClip}
              onTrimClip={handleTrimClip}
              onTrimPreview={onTrimPreview ?? (() => {})}
              onTrimPreviewEnd={onTrimPreviewEnd ?? (() => {})}
              onRemoveClip={handleRemoveClip}
              onDropAsset={handleDropAsset}
              onMoveClip={handleMoveClip}
              onRenameTrack={handleRenameTrack}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
              onSetTrackColor={handleSetTrackColor}
              onDeleteEmptyTracks={handleDeleteEmptyTracks}
              onMoveSnap={handleMoveSnap}
              snapMoveTime={snapMoveTime}
              trackHeight={trackHeight}
              hasEmptyTracks={hasEmptyTracks}
              onClickGenerate={handleClickGenerateMusic}
              activeTool={activeTool}
              onClipMouseDown={handleClipMouseDown}
            />
```

- [ ] **Step 7: Remove old roll edit visual overlays**

Remove the roll edit overlay JSX (lines 737-765) — the roll edit detection and rendering. The hook + visual feedback overlays (Task 5) replace this.

- [ ] **Step 8: Remove old imports that are no longer used**

From the imports at the top of `timeline-editor.tsx` (lines 7-15), remove only:
- `rollTrim` (now in hook)
- `splitClip` (now in hook)

**Keep**: `removeClip`, `trimClip`, `moveClip`, `snapToHalfSecond`, `addClipToTrack` — still used by the kept handlers.

- [ ] **Step 9: Clean up RAF effect**

Update the `useEffect` cleanup (lines 198-203) to remove only the `rollRafRef` reference (keep `moveRafRef`):

```typescript
  useEffect(() => {
    return () => {
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);
```

- [ ] **Step 10: Use `handleBladeClickWrapper` in JSX**

In the JSX, replace `onClick={handleBladeClick}` (line 729) with `onClick={handleBladeClickWrapper}`.

- [ ] **Step 11: Run TypeScript check and tests**

Run: `npx tsc --noEmit`
Expected: May have errors if TrackRow/ClipCard don't accept new props yet.

Run: `npx vitest run`
Expected: All existing tests pass (operations tests are independent of components).

- [ ] **Step 12: Commit**

```bash
git add src/components/edit/timeline-editor.tsx
git commit -m "feat(editor): wire useTimelineDrag hook, remove inline roll/blade handlers"
```

---

### Task 4: Update `TrackRow` and `ClipCard` to delegate to hook for advanced tools

**Files:**
- Modify: `src/components/edit/track-row.tsx`
- Modify: `src/components/edit/clip-card.tsx`

- [ ] **Step 1: Add `activeTool` and `onClipMouseDown` props to TrackRow**

In `track-row.tsx`, update `TrackRowProps` interface (line 19-43) to add:

```typescript
  activeTool?: ToolType;
  onClipMouseDown?: (e: React.MouseEvent, clip: Clip, edge: 'left' | 'right' | 'body') => void;
```

Add import for `ToolType`:
```typescript
import type { Track, Clip, ToolType } from '@/types/timeline';
```

Add to destructured props in the component function:
```typescript
  activeTool,
  onClipMouseDown,
```

- [ ] **Step 2: Pass `activeTool` and `onClipMouseDown` to ClipCard**

In TrackRow's ClipCard rendering (around line 210), add:

```typescript
            <ClipCard
              key={clip.id}
              clip={clip}
              asset={assetMap.get(clip.assetId)}
              pixelsPerSecond={pixelsPerSecond}
              snapTime={snapTime}
              selected={selectedClipIds.has(clip.id)}
              trackColor={trackColor}
              onSelect={onSelectClip}
              onTrim={onTrimClip}
              onTrimPreview={onTrimPreview}
              onTrimPreviewEnd={onTrimPreviewEnd}
              onRemove={onRemoveClip}
              onMove={handleMoveClipPointer}
              onMoveSnap={onMoveSnap}
              snapMoveTime={snapMoveTime}
              trackHeight={trackHeight}
              onClickGenerate={onClickGenerate}
              activeTool={activeTool}
              onAdvancedMouseDown={onClipMouseDown}
            />
```

- [ ] **Step 3: Update ClipCard to delegate pointer events for advanced tools**

In `clip-card.tsx`, add props to `ClipCardProps` interface:

```typescript
  activeTool?: ToolType;
  onAdvancedMouseDown?: (e: React.MouseEvent, clip: Clip, edge: 'left' | 'right' | 'body') => void;
```

Add imports:
```typescript
import type { Clip, ToolType } from '@/types/timeline';
```

Add to destructured props:
```typescript
  activeTool,
  onAdvancedMouseDown,
```

- [ ] **Step 4: Modify ClipCard `handleMoveDown` to route advanced tools to hook**

Replace `handleMoveDown` (lines 108-130) with:

```typescript
  const handleMoveDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).classList.contains('clip-card__trim-handle')) return;
      onSelect?.(clip.id, e.shiftKey || e.metaKey);

      // Advanced tools: delegate to hook's handleClipMouseDown
      if (activeTool && ['ripple', 'roll', 'slip', 'slide', 'trackForward'].includes(activeTool)) {
        if (onAdvancedMouseDown) {
          onAdvancedMouseDown(e as unknown as React.MouseEvent, clip, 'body');
        }
        return;
      }

      if (!onMove) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (e.altKey && onDuplicate) {
        actionRef.current = {
          kind: 'duplicate',
          startX: e.clientX,
          initStartTime: clip.startTime,
        };
      } else {
        actionRef.current = {
          kind: 'move',
          startX: e.clientX,
          initStartTime: clip.startTime,
        };
      }
    },
    [clip, onSelect, onMove, onDuplicate, activeTool, onAdvancedMouseDown],
  );
```

- [ ] **Step 5: Modify ClipCard trim handles to route advanced tools**

Replace `handleTrimDown` (lines 91-106) with:

```typescript
  const handleTrimDown = useCallback(
    (side: 'left' | 'right') => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();

      // Advanced tools or Shift key: delegate to hook
      if ((activeTool && ['ripple', 'roll', 'slip', 'slide'].includes(activeTool)) || e.shiftKey) {
        if (onAdvancedMouseDown) {
          onAdvancedMouseDown(e as unknown as React.MouseEvent, clip, side);
        }
        return;
      }

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      actionRef.current = {
        kind: 'trim',
        side,
        startX: e.clientX,
        initTrimStart: clip.trimStart,
        initTrimEnd: clip.trimEnd,
        initStartTime: clip.startTime,
      };
    },
    [clip, activeTool, onAdvancedMouseDown],
  );
```

- [ ] **Step 6: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/edit/track-row.tsx src/components/edit/clip-card.tsx
git commit -m "feat(editor): route advanced tool events from ClipCard to useTimelineDrag hook"
```

---

### Task 5: Render visual feedback overlays in timeline-editor.tsx

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`
- Modify: `src/styles/globals.css`

This task consumes the state variables from Task 3 Step 2 (`ripplePreview`, `slipPreview`, `slidePreview`, `trackForwardHighlight`) and renders visible overlays in the JSX.

- [ ] **Step 1: Add CSS for visual feedback overlays**

Add to `src/styles/globals.css` after the existing blade-line styles:

```css
/* Tool visual feedback overlays */
.timeline-editor__ripple-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #f59e0b;
  z-index: 12;
  pointer-events: none;
  opacity: 0.9;
}
.timeline-editor__ripple-indicator::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 2px;
  transform: translateY(-50%);
  border: 5px solid transparent;
  border-left: 6px solid #f59e0b;
}
.timeline-editor__ripple-indicator--negative::after {
  left: auto;
  right: 2px;
  border-left: none;
  border-right: 6px solid #f59e0b;
}
.clip-card--ripple-affected {
  outline: 2px dashed #f59e0b;
  outline-offset: -2px;
  opacity: 0.8;
}
.clip-card--track-forward-highlight {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: -2px;
}
.timeline-editor__slip-badge,
.timeline-editor__slide-badge {
  position: absolute;
  top: -20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.85);
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 15;
}
```

- [ ] **Step 2: Add overlay JSX for ripple preview**

In `timeline-editor.tsx`, inside the tracks div (after the blade line, around where the old roll edit overlays were), add:

```typescript
          {/* Ripple preview: show affected clip outlines */}
          {ripplePreview && ripplePreview.affectedIds.length > 0 && (() => {
            const clip = timeline.clips.find((c) => c.id === ripplePreview.clipId);
            if (!clip) return null;
            const effDur = clip.duration - clip.trimStart - clip.trimEnd;
            const indicatorTime = ripplePreview.delta > 0
              ? clip.startTime + effDur // right edge extending
              : clip.startTime; // left edge trimming
            const indicatorLeft = indicatorTime * pxPerSecond + LABEL_WIDTH;
            return (
              <>
                <div
                  className={`timeline-editor__ripple-indicator${ripplePreview.delta < 0 ? ' timeline-editor__ripple-indicator--negative' : ''}`}
                  style={{ left: indicatorLeft }}
                />
              </>
            );
          })()}
```

- [ ] **Step 3: Pass highlight state to ClipCard via TrackRow**

Add `rippleAffectedIds` and `trackForwardHighlightIds` props to TrackRow:

In `track-row.tsx` interface, add:
```typescript
  rippleAffectedIds?: Set<string>;
  trackForwardHighlightIds?: Set<string>;
```

Destructure in component:
```typescript
  rippleAffectedIds,
  trackForwardHighlightIds,
```

Pass to ClipCard:
```typescript
              highlighted={trackForwardHighlightIds?.has(clip.id) || false}
              rippleAffected={rippleAffectedIds?.has(clip.id) || false}
```

In `clip-card.tsx` interface, add:
```typescript
  highlighted?: boolean;
  rippleAffected?: boolean;
```

Destructure and use in className:
```typescript
  highlighted,
  rippleAffected,
```

Update the root div className:
```typescript
      className={`clip-card ${typeClass} ${selected ? 'clip-card--selected' : ''}${highlighted ? ' clip-card--track-forward-highlight' : ''}${rippleAffected ? ' clip-card--ripple-affected' : ''}${isPendingMusic ? ' clip-card--pending-music' : ''}${isGenerating ? ' clip-card--generating' : ''}${isError ? ' clip-card--error' : ''}`}
```

- [ ] **Step 4: Wire highlight state from timeline-editor to TrackRow**

In `timeline-editor.tsx`, compute Sets from state for efficient lookup:

```typescript
  const rippleAffectedSet = useMemo(
    () => new Set(ripplePreview?.affectedIds ?? []),
    [ripplePreview?.affectedIds],
  );
  const trackForwardHighlightSet = useMemo(
    () => new Set(trackForwardHighlight ?? []),
    [trackForwardHighlight],
  );
```

Pass to TrackRow:
```typescript
              rippleAffectedIds={rippleAffectedSet}
              trackForwardHighlightIds={trackForwardHighlightSet}
```

- [ ] **Step 5: Add slip/slide badge overlays on active clip**

In `timeline-editor.tsx`, add overlays for slip and slide using the clip's position:

```typescript
          {/* Slip preview badge showing source offset */}
          {slipPreview && (() => {
            const clip = timeline.clips.find((c) => c.id === slipPreview.clipId);
            if (!clip) return null;
            const effDur = clip.duration - clip.trimStart - clip.trimEnd;
            const clipCenterX = (clip.startTime + effDur / 2) * pxPerSecond + LABEL_WIDTH;
            const trackIdx = timeline.tracks.findIndex((t) => t.id === clip.trackId);
            if (trackIdx < 0) return null;
            return (
              <div
                className="timeline-editor__slip-badge"
                style={{ left: clipCenterX, top: trackIdx * trackHeight }}
              >
                Slip: {slipPreview.sourceOffset >= 0 ? '+' : ''}{slipPreview.sourceOffset.toFixed(2)}s
              </div>
            );
          })()}
          {/* Slide preview badge showing neighbor trim deltas */}
          {slidePreview && (() => {
            const clip = timeline.clips.find((c) => c.id === slidePreview.clipId);
            if (!clip) return null;
            const effDur = clip.duration - clip.trimStart - clip.trimEnd;
            const clipCenterX = (clip.startTime + effDur / 2) * pxPerSecond + LABEL_WIDTH;
            const trackIdx = timeline.tracks.findIndex((t) => t.id === clip.trackId);
            if (trackIdx < 0) return null;
            return (
              <div
                className="timeline-editor__slide-badge"
                style={{ left: clipCenterX, top: trackIdx * trackHeight }}
              >
                L: {slidePreview.leftDelta >= 0 ? '+' : ''}{slidePreview.leftDelta.toFixed(2)}s | R: {slidePreview.rightDelta >= 0 ? '+' : ''}{slidePreview.rightDelta.toFixed(2)}s
              </div>
            );
          })()}
```

- [ ] **Step 6: Suppress unused state if needed**

If `slipPreview` or `slidePreview` still trigger "assigned but never read" warnings after Step 5, they won't — they're consumed in JSX. Verify with:

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/edit/timeline-editor.tsx src/components/edit/track-row.tsx src/components/edit/clip-card.tsx src/styles/globals.css
git commit -m "feat(editor): render visual feedback overlays for ripple, slip, slide, and track-forward tools"
```

---

### Task 6: Add tool cursor CSS and keyboard shortcuts

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/components/edit/edit-tab.tsx` (keyboard shortcuts for ripple/roll)

- [ ] **Step 1: Add tool cursor classes to globals.css**

Add after the existing blade cursor styles (after line 2895):

```css
/* Advanced tool cursors */
.timeline-editor__tracks--ripple { cursor: col-resize; }
.timeline-editor__tracks--ripple .clip-card { cursor: col-resize; }
.timeline-editor__tracks--roll { cursor: col-resize; }
.timeline-editor__tracks--roll .clip-card { cursor: col-resize; }
.timeline-editor__tracks--slip { cursor: grab; }
.timeline-editor__tracks--slip .clip-card { cursor: grab; }
.timeline-editor__tracks--slide { cursor: ew-resize; }
.timeline-editor__tracks--slide .clip-card { cursor: ew-resize; }
.timeline-editor__tracks--trackForward { cursor: e-resize; }
.timeline-editor__tracks--trackForward .clip-card { cursor: e-resize; }
```

- [ ] **Step 2: Add CSS classes to timeline-editor tracks div**

In `timeline-editor.tsx`, update the tracks `className` (line 723) to include tool-specific classes:

```typescript
          className={`timeline-editor__tracks${activeTool === 'blade' ? ' timeline-editor__tracks--blade' : activeTool !== 'select' ? ` timeline-editor__tracks--${activeTool}` : ''}`}
```

- [ ] **Step 3: Add keyboard shortcuts for ripple (R) and roll (N)**

In `edit-tab.tsx`, in the keyboard shortcut `useEffect` (lines 125-154), add after the slide shortcut (line 149):

```typescript
      } else if (e.key === 'r' || e.key === 'R') {
        setActiveTool('ripple');
      } else if (e.key === 'n' || e.key === 'N') {
        setActiveTool('roll');
      }
```

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/components/edit/timeline-editor.tsx src/components/edit/edit-tab.tsx
git commit -m "feat(editor): add tool cursors and keyboard shortcuts for all editing tools"
```

---

### Task 7: Snap to playhead position

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

- [ ] **Step 1: Add `currentTimeRef` and update `snapMoveTime` to include playhead**

In `timeline-editor.tsx`, first add a ref for `currentTime` (next to `pxPerSecondRef` around line 94):

```typescript
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
```

Then update the `snapMoveTime` callback (lines 113-133) to snap to the playhead via the ref — keeping the dependency array empty `[]` to avoid breaking memoization of TrackRow/ClipCard:

```typescript
  const snapMoveTime = useCallback((time: number, movingClipId: string): { time: number; snapped: boolean } => {
    const tl = timelineRef.current;
    const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecondRef.current;
    let closest = time;
    let minDist = thresholdSec;
    let didSnap = false;

    // Snap to playhead (uses ref to avoid recreating this callback on every frame)
    const playheadDist = Math.abs(time - currentTimeRef.current);
    if (playheadDist < minDist) {
      minDist = playheadDist;
      closest = currentTimeRef.current;
      didSnap = true;
    }

    // Snap to other clip edges
    for (const clip of tl.clips) {
      if (clip.id === movingClipId) continue;
      const effDur = clip.duration - clip.trimStart - clip.trimEnd;
      const edges = [clip.startTime, clip.startTime + effDur];
      for (const edge of edges) {
        const dist = Math.abs(time - edge);
        if (dist < minDist) {
          minDist = dist;
          closest = edge;
          didSnap = true;
        }
      }
    }
    return { time: closest, snapped: didSnap };
  }, []);
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/timeline-editor.tsx
git commit -m "feat(editor): add playhead snap target for clip moves"
```

---

### Task 8: Final verification and cleanup

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (62 total — 59 existing + 3 new splitAllTracks tests).

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean — no errors.

- [ ] **Step 3: Verify no lint issues**

Run: `npx next lint --quiet`
Expected: Clean or pre-existing warnings only.

- [ ] **Step 4: Review for dead code**

Check that these are removed/unused:
- Old `rollEditPoint` state and related refs
- Old `handleRollEdit` function
- Old `detectRollEditPoint` function
- Old inline `handleBladeClick` (replaced by wrapper)
- `pendingRollRef`, `rollRafRef`, `rollDragRef`

- [ ] **Step 5: Commit final cleanup if needed**

```bash
git add -A
git commit -m "chore(editor): SP4 final cleanup"
```

---

## Notes

**Deliberately deferred:**
- **Beat grid snap** (snap to ruler tick marks): Requires passing ruler tick data from `TimeRuler` component down to `snapMoveTime`. Low value-add since half-second grid snap already exists. Deferred.
- **Slip filmstrip visual**: The spec calls for filmstrip thumbnails shifting inside ClipCard during slip. This depends on the filmstrip/thumbnail infrastructure that ClipCard already has, but making it shift during drag requires per-frame re-rendering of the filmstrip offset. Deferred to SP5 where the clip properties panel will need similar per-clip visual state.
- **Blade split preview line on clip**: The existing blade line cursor at the mouse position is sufficient. A per-clip split preview line would duplicate this visual. Deferred.

**Behavioral change from current system:**
- The auto-detect roll edit on hover (yellow line appearing when cursor is near cut points between adjacent clips) is **removed**. Users now must select the "roll" tool explicitly (keyboard shortcut: N) to perform roll edits. This simplifies the code significantly and aligns with how all other tools work (explicit selection).
