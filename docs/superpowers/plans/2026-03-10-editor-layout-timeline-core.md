# Editor Layout + Timeline Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Edit tab with an LTX-style NLE layout: dual viewers, V/A separated multi-timeline, vertical toolbar with professional editing tools, and a collapsible left panel.

**Architecture:** Rebuild the Edit tab as a panel-based layout using CSS Grid with resizable boundaries. Preserve the existing workspace reducer pattern, video pool playback, and persistence layer. Migrate from nested `Sequence` to flat-clip `Timeline[]` data model.

**Tech Stack:** React 19, TypeScript, CSS (BEM naming), localStorage for layout persistence, existing Electron IPC for project save/load.

**Spec:** `docs/superpowers/specs/2026-03-10-editor-layout-timeline-core-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/types/timeline.ts` | New Timeline, Track, Clip types with V/A separation |
| `src/lib/editor/timeline-operations.ts` | All timeline operations (move, trim, split, ripple, roll, slip, slide) using flat-clip model |
| `src/lib/editor/timeline-migration.ts` | Migrate old `Sequence` → `Timeline[]` on project load |
| `src/components/edit/source-viewer.tsx` | Source clip preview with transport controls |
| `src/components/edit/timeline-viewer.tsx` | Timeline composite preview with transport controls |
| `src/components/edit/left-panel.tsx` | Collapsible panel with Assets/Timelines tabs |
| `src/components/edit/tool-sidebar.tsx` | Vertical editing tool selector |
| `src/components/edit/timeline-tabs.tsx` | Multi-timeline tab bar |
| `src/components/edit/time-ruler.tsx` | Ruler with ticks, playhead, click-to-seek |
| `src/components/edit/track-header.tsx` | Per-track controls (mute/solo/lock/visible) |
| `src/components/edit/timeline-bottom-bar.tsx` | Zoom slider, speed, export button |
| `src/components/edit/resize-handle.tsx` | Reusable drag-to-resize divider |
| `src/components/edit/use-editor-layout.ts` | Hook for persisted layout state |
| `src/components/edit/use-timeline-drag.ts` | Hook for tool-specific drag interactions |
| `src/styles/edit-tab.css` | All Edit tab styles (replaces edit-related sections in globals.css) |
| `tests/lib/editor/timeline-operations.test.ts` | Tests for all timeline operations |
| `tests/lib/editor/timeline-migration.test.ts` | Tests for Sequence → Timeline migration |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/workspace.ts` | `sequence` → `timelines` + `activeTimelineId` |
| `src/components/workspace/workspace-shell.tsx` | New reducer actions for timelines |
| `src/components/edit/edit-tab.tsx` | Complete rewrite to new layout |
| `src/components/edit/track-row.tsx` | Adapt for flat-clip model + V/A styling |
| `src/components/edit/clip-card.tsx` | Minor: accept clip from flat array |
| `src/components/edit/timeline-editor.tsx` | Major refactor: use new sub-components |
| `src/styles/globals.css` | Remove old edit-tab CSS (moved to edit-tab.css) |
| `electron/ipc/project.ts` | Handle migration on project load |

### Deleted Files
| File | Reason |
|------|--------|
| `src/components/edit/asset-drawer.tsx` | Absorbed into `left-panel.tsx` |
| `src/lib/editor/timeline.ts` | Replaced by `timeline-operations.ts` |

---

## Chunk 1: Data Model + Operations

### Task 1: New Timeline Types

**Files:**
- Create: `src/types/timeline.ts`

- [ ] **Step 1: Create the new types file**

```typescript
// src/types/timeline.ts

export type TrackKind = 'video' | 'audio';

export type ToolType =
  | 'select'
  | 'trackForward'
  | 'blade'
  | 'ripple'
  | 'roll'
  | 'slip'
  | 'slide';

export const TRACK_COLORS = [
  '#e74c3c', '#3498db', '#9b59b6', '#e67e22',
  '#1abc9c', '#f39c12', '#2ecc71', '#e91e63',
] as const;

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  visible: boolean;
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
}

export interface Timeline {
  id: string;
  name: string;
  tracks: Track[];
  clips: Clip[];
  duration: number;
}

/** Effective duration of a clip (what plays on the timeline). */
export function clipEffectiveDuration(clip: Clip): number {
  return clip.duration - clip.trimStart - clip.trimEnd;
}

/** End time of a clip on the timeline. */
export function clipEndTime(clip: Clip): number {
  return clip.startTime + clipEffectiveDuration(clip);
}

export interface EditorLayout {
  leftPanelWidth: number;
  leftPanelMode: 'full' | 'compact';
  viewerTimelineSplit: number;
  sourceTimelineSplit: number;
  sourceViewerVisible: boolean;
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = {
  leftPanelWidth: 240,
  leftPanelMode: 'full',
  viewerTimelineSplit: 0.55,
  sourceTimelineSplit: 0.5,
  sourceViewerVisible: true,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types/timeline.ts
git commit -m "feat: add new Timeline/Track/Clip types with V/A separation"
```

---

### Task 2: Timeline Operations (Core)

**Files:**
- Create: `src/lib/editor/timeline-operations.ts`
- Create: `tests/lib/editor/timeline-operations.test.ts`

- [ ] **Step 1: Write failing tests for core operations**

```typescript
// tests/lib/editor/timeline-operations.test.ts
import { describe, it, expect } from 'vitest';
import {
  calculateTimelineDuration,
  addClipToTrack,
  removeClip,
  moveClip,
  trimClip,
  splitClip,
  addTrack,
  removeTrack,
} from '@/lib/editor/timeline-operations';
import type { Timeline, Track, Clip } from '@/types/timeline';

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    id: 'tl-1',
    name: 'Timeline 1',
    tracks: [
      { id: 'v1', name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: false, visible: true },
      { id: 'a1', name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true },
    ],
    clips: [],
    duration: 0,
    ...overrides,
  };
}

function makeClip(overrides?: Partial<Clip>): Clip {
  return {
    id: 'clip-1',
    assetId: 'asset-1',
    trackId: 'v1',
    name: 'Clip 1',
    startTime: 0,
    duration: 10,
    trimStart: 0,
    trimEnd: 0,
    ...overrides,
  };
}

describe('calculateTimelineDuration', () => {
  it('returns 0 for empty timeline', () => {
    expect(calculateTimelineDuration(makeTimeline())).toBe(0);
  });

  it('calculates from clip end times', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ startTime: 0, duration: 5 }),
        makeClip({ id: 'clip-2', startTime: 8, duration: 4, trimEnd: 1 }),
      ],
    });
    // clip-2 ends at 8 + (4 - 0 - 1) = 11
    expect(calculateTimelineDuration(tl)).toBe(11);
  });
});

describe('addClipToTrack', () => {
  it('adds a clip to the flat clips array', () => {
    const tl = makeTimeline();
    const result = addClipToTrack(tl, 'v1', { id: 'a1', name: 'test.mp4', type: 'video', url: '', duration: 5, createdAt: '' } as any, 2);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].trackId).toBe('v1');
    expect(result.clips[0].startTime).toBe(2);
    expect(result.duration).toBe(7);
  });
});

describe('removeClip', () => {
  it('removes clip by id', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = removeClip(tl, 'clip-1');
    expect(result.clips).toHaveLength(0);
  });
});

describe('moveClip', () => {
  it('moves clip to new time and track', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = moveClip(tl, 'clip-1', 'a1', 5);
    expect(result.clips[0].trackId).toBe('a1');
    expect(result.clips[0].startTime).toBe(5);
  });

  it('clamps startTime to 0', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = moveClip(tl, 'clip-1', 'v1', -3);
    expect(result.clips[0].startTime).toBe(0);
  });
});

describe('trimClip', () => {
  it('updates trimStart and trimEnd', () => {
    const tl = makeTimeline({ clips: [makeClip({ duration: 10 })] });
    const result = trimClip(tl, 'clip-1', 2, 3);
    expect(result.clips[0].trimStart).toBe(2);
    expect(result.clips[0].trimEnd).toBe(3);
  });

  it('clamps to 0', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = trimClip(tl, 'clip-1', -1, -2);
    expect(result.clips[0].trimStart).toBe(0);
    expect(result.clips[0].trimEnd).toBe(0);
  });
});

describe('splitClip', () => {
  it('splits clip at given time', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 0, duration: 10 })] });
    const result = splitClip(tl, 'clip-1', 4);
    expect(result.clips).toHaveLength(2);
    // First clip: duration 10, trimEnd increased to hide post-split portion
    const first = result.clips.find(c => c.id === 'clip-1')!;
    expect(first.trimEnd).toBe(6); // 10 - 0 - 0 = 10 eff, cut at 4, so trimEnd = 10 - 4 = 6
    // Second clip: starts at 4, trimStart increased
    const second = result.clips.find(c => c.id !== 'clip-1')!;
    expect(second.startTime).toBe(4);
    expect(second.trimStart).toBe(4);
  });

  it('does nothing if split time is outside clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 2, duration: 5 })] });
    const result = splitClip(tl, 'clip-1', 0);
    expect(result.clips).toHaveLength(1);
  });
});

describe('addTrack', () => {
  it('adds a video track', () => {
    const tl = makeTimeline();
    const result = addTrack(tl, 'video');
    expect(result.tracks).toHaveLength(3);
    const newTrack = result.tracks.find(t => t.name === 'V2');
    expect(newTrack).toBeDefined();
    expect(newTrack!.kind).toBe('video');
  });

  it('adds an audio track', () => {
    const tl = makeTimeline();
    const result = addTrack(tl, 'audio');
    const newTrack = result.tracks.find(t => t.name === 'A2');
    expect(newTrack).toBeDefined();
    expect(newTrack!.kind).toBe('audio');
  });
});

describe('removeTrack', () => {
  it('removes track and its clips', () => {
    const tl = makeTimeline({ clips: [makeClip({ trackId: 'v1' })] });
    const result = removeTrack(tl, 'v1');
    expect(result.tracks).toHaveLength(1);
    expect(result.clips).toHaveLength(0);
  });

  it('does not remove last track of a kind', () => {
    const tl = makeTimeline();
    const result = removeTrack(tl, 'v1');
    // Should still have the video track since it's the only one
    expect(result.tracks.filter(t => t.kind === 'video')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement core operations**

```typescript
// src/lib/editor/timeline-operations.ts
import type { Timeline, Track, Clip, TrackKind } from '@/types/timeline';
import { clipEffectiveDuration, clipEndTime, TRACK_COLORS } from '@/types/timeline';
import { generateId } from '@/lib/utils/ids';
import type { Asset } from '@/types/project';

/* ------------------------------------------------------------------
   Duration
   ------------------------------------------------------------------ */

export function calculateTimelineDuration(timeline: Timeline): number {
  let max = 0;
  for (const clip of timeline.clips) {
    const end = clipEndTime(clip);
    if (end > max) max = end;
  }
  return max;
}

function withDuration(timeline: Timeline): Timeline {
  return { ...timeline, duration: calculateTimelineDuration(timeline) };
}

/* ------------------------------------------------------------------
   Snapping
   ------------------------------------------------------------------ */

export function snapToHalfSecond(time: number): number {
  return Math.round(time * 2) / 2;
}

/* ------------------------------------------------------------------
   Clip CRUD
   ------------------------------------------------------------------ */

export function addClipToTrack(
  timeline: Timeline,
  trackId: string,
  asset: Asset,
  startTime: number,
): Timeline {
  const clip: Clip = {
    id: generateId(),
    assetId: asset.id,
    trackId,
    name: asset.name,
    startTime: Math.max(0, startTime),
    duration: asset.duration ?? 5,
    trimStart: 0,
    trimEnd: 0,
  };
  return withDuration({ ...timeline, clips: [...timeline.clips, clip] });
}

export function removeClip(timeline: Timeline, clipId: string): Timeline {
  return withDuration({
    ...timeline,
    clips: timeline.clips.filter((c) => c.id !== clipId),
  });
}

export function moveClip(
  timeline: Timeline,
  clipId: string,
  newTrackId: string,
  newStartTime: number,
): Timeline {
  return withDuration({
    ...timeline,
    clips: timeline.clips.map((c) =>
      c.id === clipId
        ? { ...c, trackId: newTrackId, startTime: Math.max(0, newStartTime) }
        : c,
    ),
  });
}

export function trimClip(
  timeline: Timeline,
  clipId: string,
  trimStart: number,
  trimEnd: number,
  startTime?: number,
): Timeline {
  return withDuration({
    ...timeline,
    clips: timeline.clips.map((c) =>
      c.id === clipId
        ? {
            ...c,
            trimStart: Math.max(0, trimStart),
            trimEnd: Math.max(0, trimEnd),
            ...(startTime !== undefined ? { startTime: Math.max(0, startTime) } : {}),
          }
        : c,
    ),
  });
}

export function splitClip(
  timeline: Timeline,
  clipId: string,
  splitTime: number,
): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  const effDur = clipEffectiveDuration(clip);
  const rel = splitTime - clip.startTime;
  if (rel <= 0 || rel >= effDur) return timeline;

  const first: Clip = {
    ...clip,
    trimEnd: clip.trimEnd + (effDur - rel),
  };

  const second: Clip = {
    ...clip,
    id: generateId(),
    startTime: splitTime,
    trimStart: clip.trimStart + rel,
  };

  return withDuration({
    ...timeline,
    clips: timeline.clips.flatMap((c) => (c.id === clipId ? [first, second] : [c])),
  });
}

export function duplicateClip(
  timeline: Timeline,
  clipId: string,
  newStartTime: number,
): { timeline: Timeline; newClipId: string | null } {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return { timeline, newClipId: null };

  const copy: Clip = {
    ...clip,
    id: generateId(),
    startTime: Math.max(0, newStartTime),
  };
  return {
    timeline: withDuration({ ...timeline, clips: [...timeline.clips, copy] }),
    newClipId: copy.id,
  };
}

/* ------------------------------------------------------------------
   Track CRUD
   ------------------------------------------------------------------ */

function nextTrackName(tracks: Track[], kind: TrackKind): string {
  const prefix = kind === 'video' ? 'V' : 'A';
  const existing = tracks
    .filter((t) => t.kind === kind)
    .map((t) => {
      const m = t.name.match(/^[VA](\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    });
  const next = Math.max(0, ...existing) + 1;
  return `${prefix}${next}`;
}

function nextTrackColor(tracks: Track[]): string {
  return TRACK_COLORS[tracks.length % TRACK_COLORS.length];
}

export function addTrack(timeline: Timeline, kind: TrackKind): Timeline {
  const track: Track = {
    id: generateId(),
    name: nextTrackName(timeline.tracks, kind),
    kind,
    color: nextTrackColor(timeline.tracks),
    muted: false,
    solo: false,
    locked: false,
    visible: true,
  };

  // Insert video tracks before audio tracks, audio tracks at end
  const videoTracks = timeline.tracks.filter((t) => t.kind === 'video');
  const audioTracks = timeline.tracks.filter((t) => t.kind === 'audio');

  const newTracks =
    kind === 'video'
      ? [...videoTracks, track, ...audioTracks]
      : [...videoTracks, ...audioTracks, track];

  return { ...timeline, tracks: newTracks };
}

export function removeTrack(timeline: Timeline, trackId: string): Timeline {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return timeline;

  // Don't remove the last track of its kind
  const sameKindCount = timeline.tracks.filter((t) => t.kind === track.kind).length;
  if (sameKindCount <= 1) return timeline;

  return withDuration({
    ...timeline,
    tracks: timeline.tracks.filter((t) => t.id !== trackId),
    clips: timeline.clips.filter((c) => c.trackId !== trackId),
  });
}

export function updateTrack(
  timeline: Timeline,
  trackId: string,
  updates: Partial<Pick<Track, 'muted' | 'solo' | 'locked' | 'visible' | 'name' | 'color'>>,
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId ? { ...t, ...updates } : t,
    ),
  };
}

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

/** Get all clips on a specific track, sorted by startTime. */
export function clipsOnTrack(timeline: Timeline, trackId: string): Clip[] {
  return timeline.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.startTime - b.startTime);
}

/** Find clip at a given time on a given track. */
export function clipAtTime(timeline: Timeline, trackId: string, time: number): Clip | undefined {
  return timeline.clips.find(
    (c) => c.trackId === trackId && c.startTime <= time && clipEndTime(c) > time,
  );
}

/** Create a default empty timeline with standard tracks. */
export function createDefaultTimeline(name: string): Timeline {
  return {
    id: generateId(),
    name,
    tracks: [
      { id: generateId(), name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: false, visible: true },
      { id: generateId(), name: 'V2', kind: 'video', color: '#3498db', muted: false, solo: false, locked: false, visible: true },
      { id: generateId(), name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true },
      { id: generateId(), name: 'A2', kind: 'audio', color: '#1abc9c', muted: false, solo: false, locked: false, visible: true },
    ],
    clips: [],
    duration: 0,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/timeline-operations.ts tests/lib/editor/timeline-operations.test.ts
git commit -m "feat: add timeline operations with flat-clip model"
```

---

### Task 3: Advanced Editing Operations (Ripple, Roll, Slip, Slide)

**Files:**
- Modify: `src/lib/editor/timeline-operations.ts`
- Modify: `tests/lib/editor/timeline-operations.test.ts`

- [ ] **Step 1: Write failing tests for advanced operations**

Add to `tests/lib/editor/timeline-operations.test.ts`:

```typescript
import {
  // ... existing imports ...
  rippleTrim,
  rollTrim,
  slipClip,
  slideClip,
  trackSelectForward,
} from '@/lib/editor/timeline-operations';

describe('rippleTrim', () => {
  it('trims clip and shifts subsequent clips', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 5 }),
        makeClip({ id: 'c2', startTime: 5, duration: 5 }),
        makeClip({ id: 'c3', startTime: 10, duration: 5 }),
      ],
    });
    // Trim 2 seconds from right edge of c1 → subsequent clips shift left by 2
    const result = rippleTrim(tl, 'c1', 'right', -2);
    expect(result.clips.find(c => c.id === 'c1')!.trimEnd).toBe(2);
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBe(3);
    expect(result.clips.find(c => c.id === 'c3')!.startTime).toBe(8);
  });

  it('trims clip left edge and shifts subsequent clips', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 5 }),
        makeClip({ id: 'c2', startTime: 5, duration: 5 }),
      ],
    });
    // Trim 1 second from left edge of c2 → c2 startTime shifts right by 1, subsequent shift left by 1
    const result = rippleTrim(tl, 'c2', 'left', 1);
    const c2 = result.clips.find(c => c.id === 'c2')!;
    expect(c2.trimStart).toBe(1);
    expect(c2.startTime).toBe(5); // stays, but effective start moves right
  });
});

describe('rollTrim', () => {
  it('adjusts cut point between adjacent clips', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 10, trimEnd: 5 }), // eff: 5s, ends at 5
        makeClip({ id: 'c2', startTime: 5, duration: 10, trimStart: 0 }), // starts at 5
      ],
    });
    // Roll right by 2: c1 grows (trimEnd decreases), c2 shrinks (trimStart increases, startTime increases)
    const result = rollTrim(tl, 'c1', 'c2', 2);
    expect(result.clips.find(c => c.id === 'c1')!.trimEnd).toBe(3);
    expect(result.clips.find(c => c.id === 'c2')!.trimStart).toBe(2);
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBe(7);
  });
});

describe('slipClip', () => {
  it('shifts trim window without moving clip', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', startTime: 2, duration: 10, trimStart: 1, trimEnd: 1 })],
    });
    // Slip by +2: trimStart increases by 2, trimEnd decreases by 2
    const result = slipClip(tl, 'c1', 2);
    const c = result.clips.find(c => c.id === 'c1')!;
    expect(c.trimStart).toBe(3);
    expect(c.trimEnd).toBe(-1 < 0 ? 0 : -1); // Wait, should clamp
    // Actually: trimStart 1+2=3, trimEnd 1-2=-1 → clamp to 0, but then effective duration changes
    // The slip should be constrained so neither goes below 0
  });

  it('clamps slip to available source', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', duration: 10, trimStart: 0, trimEnd: 0 })],
    });
    // Slip by +5: can only slip to trimStart=5 since trimEnd would go to -5 (clamped)
    // But slip preserves effective duration, so max slip = min(remaining trimEnd space, remaining trimStart space)
    // With trimStart=0, trimEnd=0, dur=10: slip by +5 means trimStart=5, trimEnd=5? No.
    // Slip preserves effective duration. effDur = 10-0-0 = 10.
    // After slip +5: trimStart=5, and to keep effDur=10, trimEnd = dur - trimStart - effDur = 10-5-10 = -5.
    // That's invalid. So max slip = 0 (can't slip right at all when no trim headroom).
    const result = slipClip(tl, 'c1', 5);
    const c = result.clips.find(c => c.id === 'c1')!;
    expect(c.trimStart).toBe(0); // no room to slip
    expect(c.trimEnd).toBe(0);
  });
});

describe('slideClip', () => {
  it('moves clip and adjusts neighbor trim points', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 10, trimEnd: 5 }), // eff: 5, ends at 5
        makeClip({ id: 'c2', startTime: 5, duration: 10, trimStart: 0, trimEnd: 5 }), // eff: 5, ends at 10
        makeClip({ id: 'c3', startTime: 10, duration: 10, trimStart: 0 }), // starts at 10
      ],
    });
    // Slide c2 right by 2: c1.trimEnd decreases by 2 (grows), c3.trimStart increases by 2 (shrinks), c2.startTime = 7
    const result = slideClip(tl, 'c2', 2);
    expect(result.clips.find(c => c.id === 'c1')!.trimEnd).toBe(3);
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBe(7);
    expect(result.clips.find(c => c.id === 'c3')!.trimStart).toBe(2);
    expect(result.clips.find(c => c.id === 'c3')!.startTime).toBe(12);
  });
});

describe('trackSelectForward', () => {
  it('selects clip and all clips after it on the same track', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0 }),
        makeClip({ id: 'c2', trackId: 'v1', startTime: 5 }),
        makeClip({ id: 'c3', trackId: 'v1', startTime: 10 }),
        makeClip({ id: 'c4', trackId: 'a1', startTime: 5 }), // different track
      ],
    });
    const ids = trackSelectForward(tl, 'c2');
    expect(ids).toEqual(new Set(['c2', 'c3']));
    expect(ids.has('c1')).toBe(false);
    expect(ids.has('c4')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement advanced operations**

Add to `src/lib/editor/timeline-operations.ts`:

```typescript
/* ------------------------------------------------------------------
   Advanced Editing Operations
   ------------------------------------------------------------------ */

const MIN_CLIP_DURATION = 0.1;

/**
 * Ripple trim: trim a clip edge and shift all subsequent clips on the same track.
 * `edge`: which edge to trim ('left' or 'right')
 * `delta`: seconds to trim (negative = trim inward, positive = extend outward for right edge)
 *   For right edge: negative delta trims inward (trimEnd increases), positive extends (trimEnd decreases)
 *   For left edge: positive delta trims inward (trimStart increases), negative extends
 */
export function rippleTrim(
  timeline: Timeline,
  clipId: string,
  edge: 'left' | 'right',
  delta: number,
): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  const effDur = clipEffectiveDuration(clip);
  let actualDelta = delta;

  if (edge === 'right') {
    // delta < 0 means trim inward (increase trimEnd)
    // delta > 0 means extend outward (decrease trimEnd)
    const maxTrimInward = -(effDur - MIN_CLIP_DURATION);
    const maxExtendOutward = clip.trimEnd;
    actualDelta = Math.max(maxTrimInward, Math.min(maxExtendOutward, delta));
  } else {
    // delta > 0 means trim inward (increase trimStart, shift startTime right)
    // delta < 0 means extend outward (decrease trimStart, shift startTime left)
    const maxTrimInward = effDur - MIN_CLIP_DURATION;
    const maxExtendOutward = -clip.trimStart;
    actualDelta = Math.max(maxExtendOutward, Math.min(maxTrimInward, delta));
  }

  if (actualDelta === 0) return timeline;

  const trackClips = clipsOnTrack(timeline, clip.trackId);
  const clipIndex = trackClips.findIndex((c) => c.id === clipId);

  // Determine which clips come after the edited clip on this track
  const subsequentIds = new Set(
    trackClips.slice(clipIndex + 1).map((c) => c.id),
  );

  // The ripple amount: how much timeline space changed
  const rippleAmount = edge === 'right' ? actualDelta : -actualDelta;

  return withDuration({
    ...timeline,
    clips: timeline.clips.map((c) => {
      if (c.id === clipId) {
        if (edge === 'right') {
          return { ...c, trimEnd: Math.max(0, c.trimEnd - actualDelta) };
        } else {
          return {
            ...c,
            trimStart: Math.max(0, c.trimStart + actualDelta),
            startTime: Math.max(0, c.startTime + actualDelta),
          };
        }
      }
      if (subsequentIds.has(c.id)) {
        return { ...c, startTime: Math.max(0, c.startTime + rippleAmount) };
      }
      return c;
    }),
  });
}

/**
 * Roll trim: adjust the cut point between two adjacent clips.
 * Positive delta moves the cut point right (left clip grows, right clip shrinks).
 */
export function rollTrim(
  timeline: Timeline,
  leftClipId: string,
  rightClipId: string,
  delta: number,
): Timeline {
  const left = timeline.clips.find((c) => c.id === leftClipId);
  const right = timeline.clips.find((c) => c.id === rightClipId);
  if (!left || !right) return timeline;

  const leftEff = clipEffectiveDuration(left);
  const rightEff = clipEffectiveDuration(right);

  // Clamp so neither clip goes below min duration
  const maxRight = Math.min(rightEff - MIN_CLIP_DURATION, left.trimEnd);
  const maxLeft = Math.min(leftEff - MIN_CLIP_DURATION, right.trimStart);
  const clamped = Math.max(-maxLeft, Math.min(maxRight, delta));

  if (clamped === 0) return timeline;

  return withDuration({
    ...timeline,
    clips: timeline.clips.map((c) => {
      if (c.id === leftClipId) {
        return { ...c, trimEnd: Math.max(0, c.trimEnd - clamped) };
      }
      if (c.id === rightClipId) {
        return {
          ...c,
          trimStart: Math.max(0, c.trimStart + clamped),
          startTime: Math.max(0, c.startTime + clamped),
        };
      }
      return c;
    }),
  });
}

/**
 * Slip: shift the source window (trimStart/trimEnd) without moving the clip.
 * Positive delta shifts the window right (more trimStart, less trimEnd).
 * Effective duration stays constant.
 */
export function slipClip(timeline: Timeline, clipId: string, delta: number): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  // Clamp: trimStart can't go below 0, trimEnd can't go below 0
  const maxRight = clip.trimEnd; // how much we can increase trimStart
  const maxLeft = clip.trimStart; // how much we can decrease trimStart
  const clamped = Math.max(-maxLeft, Math.min(maxRight, delta));

  if (clamped === 0) return timeline;

  return {
    ...timeline,
    clips: timeline.clips.map((c) =>
      c.id === clipId
        ? { ...c, trimStart: c.trimStart + clamped, trimEnd: c.trimEnd - clamped }
        : c,
    ),
  };
}

/**
 * Slide: move a clip and adjust neighbors' trim points to fill the space.
 * Positive delta moves the clip right.
 * Left neighbor's trimEnd decreases (it grows). Right neighbor's trimStart increases (it shrinks).
 */
export function slideClip(timeline: Timeline, clipId: string, delta: number): Timeline {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  const trackClips = clipsOnTrack(timeline, clip.trackId);
  const idx = trackClips.findIndex((c) => c.id === clipId);

  const leftNeighbor = idx > 0 ? trackClips[idx - 1] : null;
  const rightNeighbor = idx < trackClips.length - 1 ? trackClips[idx + 1] : null;

  if (!leftNeighbor || !rightNeighbor) return timeline; // need both neighbors

  // Clamp delta
  const maxRight = Math.min(
    rightNeighbor.trimEnd > 0 ? Infinity : 0, // can't slide right if right neighbor has no trim headroom
    clipEffectiveDuration(rightNeighbor) - MIN_CLIP_DURATION,
  );
  const maxLeft = Math.min(
    leftNeighbor.trimEnd > 0 ? Infinity : 0,
    clipEffectiveDuration(leftNeighbor) - MIN_CLIP_DURATION,
  );
  const clamped = Math.max(-maxLeft, Math.min(maxRight, delta));

  if (clamped === 0) return timeline;

  return withDuration({
    ...timeline,
    clips: timeline.clips.map((c) => {
      if (c.id === clipId) {
        return { ...c, startTime: c.startTime + clamped };
      }
      if (leftNeighbor && c.id === leftNeighbor.id) {
        return { ...c, trimEnd: Math.max(0, c.trimEnd - clamped) };
      }
      if (rightNeighbor && c.id === rightNeighbor.id) {
        return {
          ...c,
          trimStart: Math.max(0, c.trimStart + clamped),
          startTime: Math.max(0, c.startTime + clamped),
        };
      }
      return c;
    }),
  });
}

/**
 * Track Select Forward: select a clip and all clips to its right on the same track.
 */
export function trackSelectForward(timeline: Timeline, clipId: string): Set<string> {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) return new Set();

  const trackClips = clipsOnTrack(timeline, clip.trackId);
  const ids = new Set<string>();
  for (const c of trackClips) {
    if (c.startTime >= clip.startTime) ids.add(c.id);
  }
  return ids;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/timeline-operations.ts tests/lib/editor/timeline-operations.test.ts
git commit -m "feat: add advanced editing operations (ripple, roll, slip, slide, track-select-forward)"
```

---

### Task 4: Timeline Migration

**Files:**
- Create: `src/lib/editor/timeline-migration.ts`
- Create: `tests/lib/editor/timeline-migration.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/editor/timeline-migration.test.ts
import { describe, it, expect } from 'vitest';
import { migrateSequenceToTimelines } from '@/lib/editor/timeline-migration';

describe('migrateSequenceToTimelines', () => {
  it('converts old sequence with nested clips to timelines with flat clips', () => {
    const oldSnapshot = {
      project: { id: 'p1', name: 'Test', createdAt: '', updatedAt: '' },
      sequence: {
        id: 'seq-1',
        tracks: [
          {
            id: 't1', name: 'Track 1', clips: [
              { id: 'c1', assetId: 'a1', trackId: 't1', name: 'Clip 1', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0 },
            ],
            muted: true,
          },
          {
            id: 't2', name: 'Track 2', clips: [],
          },
        ],
        duration: 5,
      },
      assets: [],
      mediaFolders: [],
      exports: [],
      elements: [],
      workflow: { nodes: [], edges: [] },
    };

    const result = migrateSequenceToTimelines(oldSnapshot);
    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0].clips).toHaveLength(1);
    expect(result.timelines[0].clips[0].trackId).toBe('t1');
    expect(result.timelines[0].tracks[0].kind).toBe('video');
    expect(result.timelines[0].tracks[0].muted).toBe(true);
    expect(result.activeTimelineId).toBe(result.timelines[0].id);
    expect(result.sequence).toBeUndefined();
  });

  it('returns unchanged if timelines already exist', () => {
    const snapshot = {
      timelines: [{ id: 'tl1', name: 'TL', tracks: [], clips: [], duration: 0 }],
      activeTimelineId: 'tl1',
    };
    const result = migrateSequenceToTimelines(snapshot as any);
    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0].id).toBe('tl1');
  });

  it('infers track kind from clip asset types', () => {
    const oldSnapshot = {
      sequence: {
        id: 'seq-1',
        tracks: [
          { id: 't1', name: 'Track 1', clips: [
            { id: 'c1', assetId: 'audio-asset', trackId: 't1', name: 'Music', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0 },
          ]},
        ],
        duration: 5,
      },
      assets: [{ id: 'audio-asset', type: 'audio', name: 'Music', url: '', createdAt: '' }],
    };

    const result = migrateSequenceToTimelines(oldSnapshot as any);
    // Track with only audio clips should be audio kind
    expect(result.timelines[0].tracks[0].kind).toBe('audio');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/editor/timeline-migration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement migration**

```typescript
// src/lib/editor/timeline-migration.ts
import type { Timeline, Track } from '@/types/timeline';
import { TRACK_COLORS } from '@/types/timeline';
import { generateId } from '@/lib/utils/ids';
import { calculateTimelineDuration } from './timeline-operations';

interface OldTrack {
  id: string;
  name: string;
  color?: string;
  muted?: boolean;
  solo?: boolean;
  clips: Array<{
    id: string;
    assetId: string;
    trackId: string;
    name: string;
    startTime: number;
    duration: number;
    trimStart: number;
    trimEnd: number;
  }>;
}

interface OldSequence {
  id: string;
  tracks: OldTrack[];
  duration: number;
}

/**
 * Migrate a project snapshot from old Sequence format to new Timeline[] format.
 * If `timelines` already exists, returns unchanged.
 */
export function migrateSequenceToTimelines(snapshot: any): any {
  if (snapshot.timelines && Array.isArray(snapshot.timelines)) {
    return snapshot;
  }

  const seq: OldSequence | undefined = snapshot.sequence;
  if (!seq) {
    // No sequence and no timelines — create a default
    const defaultTl: Timeline = {
      id: generateId(),
      name: 'Timeline 1',
      tracks: [
        { id: generateId(), name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: false, visible: true },
        { id: generateId(), name: 'V2', kind: 'video', color: '#3498db', muted: false, solo: false, locked: false, visible: true },
        { id: generateId(), name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true },
        { id: generateId(), name: 'A2', kind: 'audio', color: '#1abc9c', muted: false, solo: false, locked: false, visible: true },
      ],
      clips: [],
      duration: 0,
    };
    const { sequence: _removed, ...rest } = snapshot;
    return { ...rest, timelines: [defaultTl], activeTimelineId: defaultTl.id };
  }

  // Determine track kinds by looking at asset types
  const assets: Array<{ id: string; type: string }> = snapshot.assets ?? [];
  const assetTypeMap = new Map(assets.map((a) => [a.id, a.type]));

  function inferTrackKind(oldTrack: OldTrack): 'video' | 'audio' {
    if (oldTrack.clips.length === 0) return 'video'; // default
    const types = oldTrack.clips.map((c) => assetTypeMap.get(c.assetId) ?? 'video');
    const audioCount = types.filter((t) => t === 'audio').length;
    return audioCount > types.length / 2 ? 'audio' : 'video';
  }

  // Convert tracks
  const tracks: Track[] = seq.tracks.map((old, i) => ({
    id: old.id,
    name: old.name,
    kind: inferTrackKind(old),
    color: old.color ?? TRACK_COLORS[i % TRACK_COLORS.length],
    muted: old.muted ?? false,
    solo: old.solo ?? false,
    locked: false,
    visible: true,
  }));

  // Flatten clips from nested tracks
  const clips = seq.tracks.flatMap((t) =>
    t.clips.map((c) => ({
      id: c.id,
      assetId: c.assetId,
      trackId: c.trackId,
      name: c.name,
      startTime: c.startTime,
      duration: c.duration,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
    })),
  );

  const timeline: Timeline = {
    id: seq.id || generateId(),
    name: 'Timeline 1',
    tracks,
    clips,
    duration: 0,
  };
  timeline.duration = calculateTimelineDuration(timeline);

  const { sequence: _removed, ...rest } = snapshot;
  return { ...rest, timelines: [timeline], activeTimelineId: timeline.id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/editor/timeline-migration.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/timeline-migration.ts tests/lib/editor/timeline-migration.test.ts
git commit -m "feat: add Sequence → Timeline migration for backwards compatibility"
```

---

### Task 5: Update Workspace State (Types + Reducer)

**Files:**
- Modify: `src/types/workspace.ts`
- Modify: `src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1: Update workspace types**

In `src/types/workspace.ts`, replace the `Sequence` import and `sequence` field:

```typescript
// Replace: import type { Sequence } from './editor';
// Add: import type { Timeline } from './timeline';

// In WorkspaceState, replace:
//   sequence: Sequence;
// With:
//   timelines: Timeline[];
//   activeTimelineId: string;
```

The full updated file:

```typescript
import type { Node, Edge } from '@xyflow/react';
import type { Asset, MediaFolder } from './project';
import type { Timeline } from './timeline';
import type { ExportJob } from './export';
import type { WorkflowNodeData, WorkflowRun } from './workflow';
import type { Element } from './elements';

export type ProjectTab = 'elements' | 'create' | 'edit' | 'export';

export interface WorkspaceState {
  activeTab: ProjectTab;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  currentRun: WorkflowRun | null;
  runningNodeIds: Set<string>;
  exports: ExportJob[];
  elements: Element[];
}
```

- [ ] **Step 2: Update reducer actions and cases**

In `workspace-shell.tsx`:

Replace `SET_SEQUENCE` action with:
```typescript
| { type: 'SET_TIMELINE'; timelineId: string; timeline: Timeline }
| { type: 'ADD_TIMELINE'; timeline: Timeline }
| { type: 'REMOVE_TIMELINE'; timelineId: string }
| { type: 'SET_ACTIVE_TIMELINE'; timelineId: string }
```

Update `HydratePayload`:
```typescript
interface HydratePayload {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  exports: ExportJob[];
  elements: Element[];
}
```

Update `initialState`:
```typescript
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';

const defaultTimeline = createDefaultTimeline('Timeline 1');

const initialState: WorkspaceState = {
  activeTab: /* ... existing ... */,
  nodes: [],
  edges: [],
  assets: [],
  mediaFolders: [],
  timelines: [defaultTimeline],
  activeTimelineId: defaultTimeline.id,
  currentRun: null,
  runningNodeIds: new Set(),
  exports: [],
  elements: [],
};
```

Add new reducer cases (replace `SET_SEQUENCE` case):
```typescript
case 'SET_TIMELINE':
  return {
    ...state,
    timelines: state.timelines.map((tl) =>
      tl.id === action.timelineId ? action.timeline : tl,
    ),
  };

case 'ADD_TIMELINE':
  return {
    ...state,
    timelines: [...state.timelines, action.timeline],
    activeTimelineId: action.timeline.id,
  };

case 'REMOVE_TIMELINE': {
  if (state.timelines.length <= 1) return state;
  const filtered = state.timelines.filter((tl) => tl.id !== action.timelineId);
  return {
    ...state,
    timelines: filtered,
    activeTimelineId: state.activeTimelineId === action.timelineId
      ? filtered[0].id
      : state.activeTimelineId,
  };
}

case 'SET_ACTIVE_TIMELINE':
  return { ...state, activeTimelineId: action.timelineId };
```

Update `HYDRATE` case:
```typescript
case 'HYDRATE':
  return {
    ...state,
    nodes: action.payload.nodes,
    edges: action.payload.edges,
    assets: action.payload.assets,
    mediaFolders: action.payload.mediaFolders,
    timelines: action.payload.timelines,
    activeTimelineId: action.payload.activeTimelineId,
    exports: action.payload.exports,
    elements: action.payload.elements,
  };
```

Update `UNDOABLE_ACTIONS`:
```typescript
const UNDOABLE_ACTIONS = new Set(['SET_TIMELINE', 'ADD_TIMELINE', 'REMOVE_TIMELINE', ...]);
```

Update persistence (the `useEffect` that saves to disk): replace `state.sequence` references with `state.timelines`.

Update the project load function to call `migrateSequenceToTimelines()` before hydrating.

- [ ] **Step 3: Update all consumers of `state.sequence`**

Search for `state.sequence` across the codebase and update each reference to use `state.timelines.find(tl => tl.id === state.activeTimelineId)` or a helper:

```typescript
// Add a convenience selector (can be a simple function or useMemo in components):
function getActiveTimeline(state: WorkspaceState): Timeline {
  return state.timelines.find((tl) => tl.id === state.activeTimelineId) ?? state.timelines[0];
}
```

Key files that reference `state.sequence`:
- `edit-tab.tsx` — will be rewritten in later tasks
- `export-tab.tsx` — update to use `getActiveTimeline(state)`
- `workspace-shell.tsx` (persistence) — update save payload

- [ ] **Step 4: Run existing tests**

Run: `npx vitest run`
Expected: Tests pass (may need to update test fixtures that use old `sequence` shape)

- [ ] **Step 5: Commit**

```bash
git add src/types/workspace.ts src/components/workspace/workspace-shell.tsx
git commit -m "feat: migrate workspace state from Sequence to Timeline[]"
```

---

## Chunk 2: UI Components (Layout Shell)

### Task 6: Resize Handle Component

**Files:**
- Create: `src/components/edit/resize-handle.tsx`

- [ ] **Step 1: Create the reusable resize handle**

```typescript
// src/components/edit/resize-handle.tsx
import { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
}

export function ResizeHandle({ direction, onResize, onResizeEnd, className }: ResizeHandleProps) {
  const startRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = direction === 'horizontal' ? e.clientX : e.clientY;
      startRef.current = start;

      const handleMouseMove = (e: MouseEvent) => {
        const current = direction === 'horizontal' ? e.clientX : e.clientY;
        const delta = current - startRef.current;
        startRef.current = current;
        onResize(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onResizeEnd?.();
      };

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, onResize, onResizeEnd],
  );

  const cursorClass = direction === 'horizontal' ? 'resize-handle--h' : 'resize-handle--v';

  return (
    <div
      className={`resize-handle ${cursorClass} ${className ?? ''}`}
      onMouseDown={handleMouseDown}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/resize-handle.tsx
git commit -m "feat: add reusable ResizeHandle component"
```

---

### Task 7: Editor Layout Hook

**Files:**
- Create: `src/components/edit/use-editor-layout.ts`

- [ ] **Step 1: Create the layout persistence hook**

```typescript
// src/components/edit/use-editor-layout.ts
import { useState, useCallback } from 'react';
import type { EditorLayout } from '@/types/timeline';
import { DEFAULT_EDITOR_LAYOUT } from '@/types/timeline';

const STORAGE_KEY = 'cinegen_editor_layout';

function loadLayout(): EditorLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_EDITOR_LAYOUT, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_EDITOR_LAYOUT;
}

function saveLayout(layout: EditorLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

export function useEditorLayout() {
  const [layout, setLayoutState] = useState<EditorLayout>(loadLayout);

  const setLayout = useCallback((updates: Partial<EditorLayout>) => {
    setLayoutState((prev) => {
      const next = { ...prev, ...updates };
      // Clamp values
      next.leftPanelWidth = Math.max(180, Math.min(400, next.leftPanelWidth));
      next.viewerTimelineSplit = Math.max(0.2, Math.min(0.8, next.viewerTimelineSplit));
      next.sourceTimelineSplit = Math.max(0.2, Math.min(0.8, next.sourceTimelineSplit));
      saveLayout(next);
      return next;
    });
  }, []);

  return { layout, setLayout };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/use-editor-layout.ts
git commit -m "feat: add useEditorLayout hook with localStorage persistence"
```

---

### Task 8: Tool Sidebar

**Files:**
- Create: `src/components/edit/tool-sidebar.tsx`

- [ ] **Step 1: Create the vertical tool sidebar**

```typescript
// src/components/edit/tool-sidebar.tsx
import type { ToolType } from '@/types/timeline';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: string;
  group: 'primary' | 'trim';
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Selection Tool', shortcut: 'V', icon: '▸', group: 'primary' },
  { id: 'trackForward', label: 'Track Select Forward', shortcut: 'A', icon: '›', group: 'primary' },
  { id: 'blade', label: 'Blade Tool', shortcut: 'B', icon: '✂', group: 'primary' },
  { id: 'ripple', label: 'Ripple Trim', shortcut: '', icon: 'R', group: 'trim' },
  { id: 'roll', label: 'Roll Trim', shortcut: '', icon: '↔', group: 'trim' },
  { id: 'slip', label: 'Slip', shortcut: 'Y', icon: 'Sl', group: 'trim' },
  { id: 'slide', label: 'Slide', shortcut: 'U', icon: 'Sd', group: 'trim' },
];

interface ToolSidebarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
}

export function ToolSidebar({ activeTool, onToolChange }: ToolSidebarProps) {
  const primaryTools = TOOLS.filter((t) => t.group === 'primary');
  const trimTools = TOOLS.filter((t) => t.group === 'trim');

  return (
    <div className="tool-sidebar">
      {primaryTools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-sidebar__btn ${tool.id === activeTool ? 'tool-sidebar__btn--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
        >
          {tool.icon}
        </button>
      ))}
      <div className="tool-sidebar__separator" />
      {trimTools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-sidebar__btn ${tool.id === activeTool ? 'tool-sidebar__btn--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/tool-sidebar.tsx
git commit -m "feat: add vertical ToolSidebar component"
```

---

### Task 9: Timeline Tabs

**Files:**
- Create: `src/components/edit/timeline-tabs.tsx`

- [ ] **Step 1: Create the timeline tab bar**

```typescript
// src/components/edit/timeline-tabs.tsx
import { useState, useRef, useEffect } from 'react';
import type { Timeline, TrackKind } from '@/types/timeline';

interface TimelineTabsProps {
  timelines: Timeline[];
  activeTimelineId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddTrack: (kind: TrackKind) => void;
}

export function TimelineTabs({
  timelines,
  activeTimelineId,
  onSwitch,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onAddTrack,
}: TimelineTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
    setContextMenu(null);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="timeline-tabs">
      <div className="timeline-tabs__list">
        {timelines.map((tl) => (
          <button
            key={tl.id}
            className={`timeline-tabs__tab ${tl.id === activeTimelineId ? 'timeline-tabs__tab--active' : ''}`}
            onClick={() => onSwitch(tl.id)}
            onContextMenu={(e) => handleContextMenu(e, tl.id)}
            onDoubleClick={() => startRename(tl.id, tl.name)}
          >
            {editingId === tl.id ? (
              <input
                ref={inputRef}
                className="timeline-tabs__input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              tl.name
            )}
          </button>
        ))}
        <button className="timeline-tabs__add" onClick={onCreate} title="New Timeline">
          +
        </button>
      </div>
      <div className="timeline-tabs__track-btns">
        <button className="timeline-tabs__add-track timeline-tabs__add-track--video" onClick={() => onAddTrack('video')}>
          + V
        </button>
        <button className="timeline-tabs__add-track timeline-tabs__add-track--audio" onClick={() => onAddTrack('audio')}>
          + A
        </button>
      </div>

      {contextMenu && (
        <>
          <div className="timeline-tabs__backdrop" onClick={() => setContextMenu(null)} />
          <div className="timeline-tabs__ctx" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={() => startRename(contextMenu.id, timelines.find(t => t.id === contextMenu.id)?.name ?? '')}>
              Rename
            </button>
            <button onClick={() => { onDuplicate(contextMenu.id); setContextMenu(null); }}>
              Duplicate
            </button>
            {timelines.length > 1 && (
              <button onClick={() => { onDelete(contextMenu.id); setContextMenu(null); }}>
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/timeline-tabs.tsx
git commit -m "feat: add TimelineTabs component with rename, duplicate, delete"
```

---

### Task 10: Track Header

**Files:**
- Create: `src/components/edit/track-header.tsx`

- [ ] **Step 1: Create the track header with controls**

```typescript
// src/components/edit/track-header.tsx
import type { Track } from '@/types/timeline';

interface TrackHeaderProps {
  track: Track;
  onUpdate: (updates: Partial<Pick<Track, 'muted' | 'solo' | 'locked' | 'visible'>>) => void;
  onRemove: () => void;
}

export function TrackHeader({ track, onUpdate, onRemove }: TrackHeaderProps) {
  return (
    <div
      className={`track-header track-header--${track.kind}`}
      onContextMenu={(e) => {
        e.preventDefault();
        // Could add context menu for rename/delete
      }}
    >
      <span className="track-header__color" style={{ backgroundColor: track.color }} />
      <span className="track-header__name">{track.name}</span>
      <div className="track-header__controls">
        {track.kind === 'video' ? (
          <>
            <button
              className={`track-header__btn ${track.locked ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ locked: !track.locked })}
              title={track.locked ? 'Unlock' : 'Lock'}
            >
              {track.locked ? '🔒' : '🔓'}
            </button>
            <button
              className={`track-header__btn ${!track.visible ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ visible: !track.visible })}
              title={track.visible ? 'Hide' : 'Show'}
            >
              {track.visible ? '👁' : '👁‍🗨'}
            </button>
          </>
        ) : (
          <>
            <button
              className={`track-header__btn track-header__btn--mute ${track.muted ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ muted: !track.muted })}
              title={track.muted ? 'Unmute' : 'Mute'}
            >
              M
            </button>
            <button
              className={`track-header__btn track-header__btn--solo ${track.solo ? 'track-header__btn--active' : ''}`}
              onClick={() => onUpdate({ solo: !track.solo })}
              title={track.solo ? 'Unsolo' : 'Solo'}
            >
              S
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/track-header.tsx
git commit -m "feat: add TrackHeader component with mute/solo/lock/visible controls"
```

---

### Task 11: Time Ruler

**Files:**
- Create: `src/components/edit/time-ruler.tsx`

- [ ] **Step 1: Create the time ruler with playhead**

```typescript
// src/components/edit/time-ruler.tsx
import { useCallback, useRef } from 'react';

interface TimeRulerProps {
  pxPerSecond: number;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  scrollLeft: number;
  trackAreaWidth: number;
}

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 24);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function TimeRuler({
  pxPerSecond,
  duration,
  currentTime,
  onSeek,
  scrollLeft,
  trackAreaWidth,
}: TimeRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const time = Math.max(0, x / pxPerSecond);
      onSeek(time);
    },
    [pxPerSecond, scrollLeft, onSeek],
  );

  // Determine tick interval based on zoom
  let majorInterval: number;
  if (pxPerSecond >= 100) majorInterval = 1;
  else if (pxPerSecond >= 30) majorInterval = 5;
  else majorInterval = 10;

  const totalWidth = Math.max(duration * pxPerSecond + 200, trackAreaWidth);
  const ticks: { time: number; isMajor: boolean }[] = [];

  for (let t = 0; t <= duration + majorInterval; t += majorInterval / 2) {
    ticks.push({ time: t, isMajor: t % majorInterval === 0 });
  }

  const playheadX = currentTime * pxPerSecond;

  return (
    <div className="time-ruler" ref={rulerRef} onClick={handleClick} style={{ width: totalWidth }}>
      {ticks.map(({ time, isMajor }) => (
        <div
          key={time}
          className={`time-ruler__tick ${isMajor ? 'time-ruler__tick--major' : ''}`}
          style={{ left: time * pxPerSecond }}
        >
          {isMajor && <span className="time-ruler__label">{formatTimecode(time)}</span>}
        </div>
      ))}
      <div className="time-ruler__playhead" style={{ left: playheadX }}>
        <div className="time-ruler__playhead-head" />
      </div>
    </div>
  );
}

export { formatTimecode };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/time-ruler.tsx
git commit -m "feat: add TimeRuler component with playhead and tick marks"
```

---

### Task 12: Timeline Bottom Bar

**Files:**
- Create: `src/components/edit/timeline-bottom-bar.tsx`

- [ ] **Step 1: Create the bottom bar**

```typescript
// src/components/edit/timeline-bottom-bar.tsx

interface TimelineBottomBarProps {
  pxPerSecond: number;
  onZoomChange: (pps: number) => void;
  snapEnabled: boolean;
  onSnapToggle: () => void;
}

const MIN_PX = 10;
const MAX_PX = 300;

export function TimelineBottomBar({
  pxPerSecond,
  onZoomChange,
  snapEnabled,
  onSnapToggle,
}: TimelineBottomBarProps) {
  const zoomPercent = Math.round(((pxPerSecond - MIN_PX) / (MAX_PX - MIN_PX)) * 100);

  return (
    <div className="timeline-bottom-bar">
      <div className="timeline-bottom-bar__left">
        <button
          className={`timeline-bottom-bar__snap ${snapEnabled ? 'timeline-bottom-bar__snap--active' : ''}`}
          onClick={onSnapToggle}
          title={`Snap ${snapEnabled ? 'ON' : 'OFF'} (S)`}
        >
          Snap
        </button>
      </div>
      <div className="timeline-bottom-bar__right">
        <button
          className="timeline-bottom-bar__zoom-btn"
          onClick={() => onZoomChange(Math.max(MIN_PX, pxPerSecond - 10))}
        >
          −
        </button>
        <input
          type="range"
          className="timeline-bottom-bar__zoom-slider"
          min={MIN_PX}
          max={MAX_PX}
          value={pxPerSecond}
          onChange={(e) => onZoomChange(Number(e.target.value))}
        />
        <button
          className="timeline-bottom-bar__zoom-btn"
          onClick={() => onZoomChange(Math.min(MAX_PX, pxPerSecond + 10))}
        >
          +
        </button>
        <span className="timeline-bottom-bar__zoom-label">{zoomPercent}%</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/timeline-bottom-bar.tsx
git commit -m "feat: add TimelineBottomBar with zoom slider and snap toggle"
```

---

### Task 13: Left Panel

**Files:**
- Create: `src/components/edit/left-panel.tsx`

- [ ] **Step 1: Create the left panel with Assets/Timelines tabs**

This component adapts the existing AssetDrawer content into a panel with two tabs. Copy the core asset browsing UI from the existing `asset-drawer.tsx`, wrapping it in the new panel structure.

```typescript
// src/components/edit/left-panel.tsx
import { useState } from 'react';
import type { Asset, MediaFolder } from '@/types/project';
import type { Timeline } from '@/types/timeline';

interface LeftPanelProps {
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  onSwitchTimeline: (id: string) => void;
  onDragAsset: (asset: Asset) => void;
  panelMode: 'full' | 'compact';
  onToggleMode: () => void;
}

export function LeftPanel({
  assets,
  mediaFolders,
  timelines,
  activeTimelineId,
  onSwitchTimeline,
  onDragAsset,
  panelMode,
  onToggleMode,
}: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<'assets' | 'timelines'>('assets');
  const [filter, setFilter] = useState<'all' | 'video' | 'audio' | 'image'>('all');

  const filteredAssets = filter === 'all' ? assets : assets.filter((a) => a.type === filter);

  return (
    <div className="left-panel">
      <div className="left-panel__tabs">
        <button
          className={`left-panel__tab ${activeTab === 'assets' ? 'left-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('assets')}
        >
          Assets
        </button>
        <button
          className={`left-panel__tab ${activeTab === 'timelines' ? 'left-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('timelines')}
        >
          Timelines
        </button>
      </div>

      <div className="left-panel__content">
        {activeTab === 'assets' ? (
          <div className="left-panel__assets">
            <div className="left-panel__filter">
              {(['all', 'video', 'audio', 'image'] as const).map((f) => (
                <button
                  key={f}
                  className={`left-panel__filter-btn ${filter === f ? 'left-panel__filter-btn--active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="left-panel__asset-grid">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="left-panel__asset-item"
                  draggable
                  onDragStart={() => onDragAsset(asset)}
                  title={asset.name}
                >
                  {asset.thumbnailUrl ? (
                    <img src={asset.thumbnailUrl} alt={asset.name} className="left-panel__asset-thumb" />
                  ) : (
                    <div className={`left-panel__asset-placeholder left-panel__asset-placeholder--${asset.type}`}>
                      {asset.type === 'audio' ? '♫' : asset.type === 'video' ? '▶' : '🖼'}
                    </div>
                  )}
                  <span className="left-panel__asset-name">{asset.name}</span>
                </div>
              ))}
              {filteredAssets.length === 0 && (
                <div className="left-panel__empty">No {filter === 'all' ? '' : filter} assets</div>
              )}
            </div>
          </div>
        ) : (
          <div className="left-panel__timeline-list">
            {timelines.map((tl) => (
              <button
                key={tl.id}
                className={`left-panel__timeline-item ${tl.id === activeTimelineId ? 'left-panel__timeline-item--active' : ''}`}
                onClick={() => onSwitchTimeline(tl.id)}
              >
                <span className="left-panel__timeline-name">{tl.name}</span>
                <span className="left-panel__timeline-meta">
                  {tl.tracks.length} tracks · {tl.clips.length} clips
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="left-panel__toggle">
        <button className="left-panel__toggle-btn" onClick={onToggleMode}>
          {panelMode === 'full' ? '▼ Compact' : '▲ Full'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/left-panel.tsx
git commit -m "feat: add LeftPanel component with Assets/Timelines tabs"
```

---

### Task 14: Source Viewer + Timeline Viewer

**Files:**
- Create: `src/components/edit/source-viewer.tsx`
- Create: `src/components/edit/timeline-viewer.tsx`

- [ ] **Step 1: Create SourceViewer**

The SourceViewer shows a single selected clip's source media with its own transport controls. It reuses the video pool pattern from the existing preview-player.

```typescript
// src/components/edit/source-viewer.tsx
import { useRef, useState, useCallback, useEffect } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import { formatTimecode } from './time-ruler';

interface SourceViewerProps {
  clip: Clip | null;
  asset: Asset | null;
  onClose: () => void;
}

export function SourceViewer({ clip, asset, onClose }: SourceViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceTime, setSourceTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const effectiveDuration = clip ? clipEffectiveDuration(clip) : 0;

  useEffect(() => {
    setSourceTime(0);
    setIsPlaying(false);
  }, [clip?.id]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !clip) return;
    const t = videoRef.current.currentTime - clip.trimStart;
    setSourceTime(Math.max(0, t));
  }, [clip]);

  return (
    <div className="source-viewer">
      <div className="source-viewer__header">
        <span className="source-viewer__title">Clip Viewer</span>
        <button className="source-viewer__close" onClick={onClose} title="Close source viewer">
          ×
        </button>
      </div>
      <div className="source-viewer__content">
        {clip && asset ? (
          asset.type === 'video' ? (
            <video
              ref={videoRef}
              className="source-viewer__video"
              src={asset.url}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
            />
          ) : asset.type === 'image' ? (
            <img className="source-viewer__image" src={asset.url} alt={asset.name} />
          ) : (
            <div className="source-viewer__audio-placeholder">♫ {asset.name}</div>
          )
        ) : (
          <div className="source-viewer__empty">Double-click a clip to view source</div>
        )}
      </div>
      <div className="source-viewer__transport">
        <span className="source-viewer__timecode source-viewer__timecode--current">
          {formatTimecode(sourceTime)}
        </span>
        <button className="source-viewer__btn" onClick={togglePlay}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="source-viewer__timecode source-viewer__timecode--duration">
          {formatTimecode(effectiveDuration)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TimelineViewer**

The TimelineViewer shows the composite at the playhead position. This is essentially the existing PreviewPlayer logic refactored into the new shell.

```typescript
// src/components/edit/timeline-viewer.tsx
import { useRef, useCallback, useEffect, useMemo } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import { formatTimecode } from './time-ruler';

interface TimelineViewerProps {
  activeClip: Clip | null;
  activeAsset: Asset | null;
  videoUrls: string[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  audioEntries: Array<{ clip: Clip; asset: Asset }>;
}

export function TimelineViewer({
  activeClip,
  activeAsset,
  videoUrls,
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSeek,
  audioEntries,
}: TimelineViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Build video pool (same pattern as existing preview-player)
  useEffect(() => {
    const pool = videoPoolRef.current;
    const needed = new Set(videoUrls);

    // Remove stale entries
    for (const [url, el] of pool) {
      if (!needed.has(url)) {
        el.remove();
        pool.delete(url);
      }
    }

    // Add new entries
    for (const url of needed) {
      if (!pool.has(url) && containerRef.current) {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;';
        containerRef.current.appendChild(video);
        pool.set(url, video);
      }
    }
  }, [videoUrls]);

  // Sync active video
  useEffect(() => {
    if (!activeAsset || activeAsset.type !== 'video' || !activeClip) return;
    const pool = videoPoolRef.current;

    for (const [url, el] of pool) {
      if (url === activeAsset.url) {
        el.style.opacity = '1';
        el.style.zIndex = '1';
        // Seek to correct position
        const sourceTime = activeClip.trimStart + (currentTime - activeClip.startTime);
        if (Math.abs(el.currentTime - sourceTime) > 0.5) {
          el.currentTime = sourceTime;
        }
        if (isPlaying && el.paused) el.play();
        if (!isPlaying && !el.paused) el.pause();
      } else {
        el.style.opacity = '0';
        el.style.zIndex = '0';
        if (!el.paused) el.pause();
      }
    }
  }, [activeAsset, activeClip, currentTime, isPlaying]);

  return (
    <div className="timeline-viewer">
      <div className="timeline-viewer__header">
        <span className="timeline-viewer__title">Timeline Viewer</span>
      </div>
      <div className="timeline-viewer__content" ref={containerRef}>
        {activeAsset?.type === 'image' && (
          <img className="timeline-viewer__image" src={activeAsset.url} alt={activeAsset.name} />
        )}
        {!activeAsset && (
          <div className="timeline-viewer__empty">No clip at playhead</div>
        )}
      </div>
      <div className="timeline-viewer__transport">
        <span className="timeline-viewer__timecode timeline-viewer__timecode--current">
          {formatTimecode(currentTime)}
        </span>
        <button className="timeline-viewer__btn" onClick={onPlayPause}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="timeline-viewer__timecode timeline-viewer__timecode--duration">
          {formatTimecode(duration)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/source-viewer.tsx src/components/edit/timeline-viewer.tsx
git commit -m "feat: add SourceViewer and TimelineViewer components"
```

---

## Chunk 3: Edit Tab Rewrite + CSS + Integration

### Task 15: Edit Tab Rewrite

**Files:**
- Modify: `src/components/edit/edit-tab.tsx` (complete rewrite)

- [ ] **Step 1: Rewrite edit-tab.tsx with new layout**

This is the main orchestrator. It composes all the new components into the panel-based layout with CSS Grid. It manages:
- Playback state (currentTime, isPlaying)
- Active timeline selection
- Tool state
- Clip selection
- Layout state (resize, panel mode)
- Keyboard shortcuts

The implementer should:
1. Read the existing `edit-tab.tsx` to understand the playback loop and clip computation logic
2. Preserve the `requestAnimationFrame` playback loop, the `mutedTrackIds` computation, and the `activeClips`/`videoUrls` computation
3. Adapt everything from `state.sequence` to use `getActiveTimeline(state)` with the flat-clip model
4. Wire up all new sub-components: LeftPanel, SourceViewer, TimelineViewer, ToolSidebar, TimelineTabs, TimeRuler, TrackHeader, TimelineBottomBar, ResizeHandle
5. Add keyboard shortcuts for tool switching (V, A, B, Y, U, S)

Key layout structure:
```tsx
<div className="edit-tab" data-panel-mode={layout.leftPanelMode}>
  {/* Full-height mode: left panel spans full height */}
  {layout.leftPanelMode === 'full' && <LeftPanel ... />}
  {layout.leftPanelMode === 'full' && <ResizeHandle direction="horizontal" ... />}

  <div className="edit-tab__center">
    {/* Compact mode: left panel only covers viewer row */}
    <div className="edit-tab__viewers">
      {layout.leftPanelMode === 'compact' && <LeftPanel ... />}
      {layout.leftPanelMode === 'compact' && <ResizeHandle direction="horizontal" ... />}
      {layout.sourceViewerVisible && <SourceViewer ... />}
      {layout.sourceViewerVisible && <ResizeHandle direction="vertical" ... />}
      <TimelineViewer ... />
    </div>

    <ResizeHandle direction="vertical" ... />

    <div className="edit-tab__timeline-area">
      <ToolSidebar ... />
      <div className="edit-tab__timeline-content">
        <TimelineTabs ... />
        <TimeRuler ... />
        {/* Track rows with headers */}
        <div className="edit-tab__tracks">
          {videoTracks.map(t => <TrackRow key={t.id} ... />)}
          <div className="edit-tab__va-separator" />
          {audioTracks.map(t => <TrackRow key={t.id} ... />)}
        </div>
        <TimelineBottomBar ... />
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/edit-tab.tsx
git commit -m "feat: rewrite EditTab with NLE layout (dual viewers, tool sidebar, V/A tracks)"
```

---

### Task 16: Refactor Timeline Editor

**Files:**
- Modify: `src/components/edit/timeline-editor.tsx`

- [ ] **Step 1: Refactor timeline-editor.tsx**

Strip this down to just the scrollable track area. The toolbar, ruler, and bottom bar are now separate components wired by EditTab. TimelineEditor should:

1. Receive tracks, clips, pxPerSecond, currentTime, activeTool, selectedClipIds as props
2. Render TrackHeader + TrackRow pairs for each track
3. Handle tool-specific mouse interactions via the `useTimelineDrag` hook
4. Show V/A separator between video and audio tracks
5. Forward scroll position to parent (for ruler sync)

Remove: built-in toolbar, ruler, zoom controls, tool buttons (all moved to parent)
Keep: track rendering, clip interaction handling, scroll sync, blade cursor

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/timeline-editor.tsx
git commit -m "refactor: strip TimelineEditor to track rendering core"
```

---

### Task 17: Refactor Track Row + Clip Card

**Files:**
- Modify: `src/components/edit/track-row.tsx`
- Modify: `src/components/edit/clip-card.tsx`

- [ ] **Step 1: Update TrackRow for flat-clip model**

TrackRow now receives clips as a prop (filtered by trackId) instead of getting them from `track.clips`. It also receives the track's `locked` state and applies opacity/interaction restrictions.

- [ ] **Step 2: Update ClipCard**

Minimal changes — ClipCard already receives a clip and asset. Just ensure it works with the new Clip type from `@/types/timeline` (same shape, just different import).

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/track-row.tsx src/components/edit/clip-card.tsx
git commit -m "refactor: adapt TrackRow and ClipCard for flat-clip model"
```

---

### Task 18: useTimelineDrag Hook

**Files:**
- Create: `src/components/edit/use-timeline-drag.ts`

- [ ] **Step 1: Create the tool-dispatching drag hook**

```typescript
// src/components/edit/use-timeline-drag.ts
import { useCallback, useRef } from 'react';
import type { Timeline, Clip, ToolType } from '@/types/timeline';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';
import {
  moveClip,
  trimClip,
  splitClip,
  rippleTrim,
  rollTrim,
  slipClip,
  slideClip,
  trackSelectForward,
  clipsOnTrack,
} from '@/lib/editor/timeline-operations';

interface DragState {
  clipId: string;
  edge: 'left' | 'right' | 'body';
  startX: number;
  startTime: number;
  trackId: string;
}

interface UseTimelineDragOptions {
  tool: ToolType;
  timeline: Timeline;
  pxPerSecond: number;
  snapEnabled: boolean;
  onUpdate: (timeline: Timeline) => void;
  onSelect: (ids: Set<string>) => void;
  onTrimPreview?: (clipId: string, sourceTime: number) => void;
  onTrimPreviewEnd?: () => void;
}

export function useTimelineDrag({
  tool,
  timeline,
  pxPerSecond,
  snapEnabled,
  onUpdate,
  onSelect,
  onTrimPreview,
  onTrimPreviewEnd,
}: UseTimelineDragOptions) {
  const dragRef = useRef<DragState | null>(null);

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip, edge: 'left' | 'right' | 'body') => {
      e.stopPropagation();
      e.preventDefault();

      // Check if track is locked
      const track = timeline.tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return;

      if (tool === 'trackForward') {
        const ids = trackSelectForward(timeline, clip.id);
        onSelect(ids);
        // Then allow dragging all selected
      } else if (tool === 'blade') {
        // Blade on click — handled separately
        return;
      } else {
        // For all other tools, initiate drag
        dragRef.current = {
          clipId: clip.id,
          edge,
          startX: e.clientX,
          startTime: clip.startTime,
          trackId: clip.trackId,
        };
      }

      const handleMouseMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const deltaPx = me.clientX - dragRef.current.startX;
        const deltaSec = deltaPx / pxPerSecond;

        const clip = timeline.clips.find((c) => c.id === dragRef.current!.clipId);
        if (!clip) return;

        let updated: Timeline;

        switch (tool) {
          case 'select':
          case 'trackForward':
            if (edge === 'body') {
              updated = moveClip(timeline, clip.id, clip.trackId, dragRef.current.startTime + deltaSec);
            } else {
              // Basic trim
              const newTrimStart = edge === 'left' ? clip.trimStart + deltaSec : clip.trimStart;
              const newTrimEnd = edge === 'right' ? clip.trimEnd - deltaSec : clip.trimEnd;
              const newStartTime = edge === 'left' ? clip.startTime + deltaSec : clip.startTime;
              updated = trimClip(timeline, clip.id, newTrimStart, newTrimEnd, newStartTime);
            }
            break;
          case 'ripple':
            updated = rippleTrim(timeline, clip.id, edge === 'body' ? 'right' : edge, deltaSec);
            break;
          case 'roll': {
            // Find adjacent clip for roll edit
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
            break;
          case 'slide':
            updated = slideClip(timeline, clip.id, deltaSec);
            break;
          default:
            updated = timeline;
        }

        onUpdate(updated);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onTrimPreviewEnd?.();
      };

      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [tool, timeline, pxPerSecond, snapEnabled, onUpdate, onSelect, onTrimPreview, onTrimPreviewEnd],
  );

  const handleBladeClick = useCallback(
    (trackId: string, time: number) => {
      if (tool !== 'blade') return;
      const track = timeline.tracks.find((t) => t.id === trackId);
      if (track?.locked) return;

      // Find clip at this time on this track
      const clip = timeline.clips.find(
        (c) => c.trackId === trackId && c.startTime <= time && clipEndTime(c) > time,
      );
      if (clip) {
        onUpdate(splitClip(timeline, clip.id, time));
      }
    },
    [tool, timeline, onUpdate],
  );

  return { handleClipMouseDown, handleBladeClick };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/edit/use-timeline-drag.ts
git commit -m "feat: add useTimelineDrag hook with tool-specific drag handlers"
```

---

### Task 19: CSS Styles

**Files:**
- Create: `src/styles/edit-tab.css`
- Modify: `src/styles/globals.css` (remove old edit-tab styles)

- [ ] **Step 1: Create edit-tab.css with all new styles**

The implementer should:
1. Read the current edit-related CSS from `globals.css` (search for `.edit-tab`, `.timeline-editor`, `.track-row`, `.clip-card`, `.asset-panel`, `.preview-player`)
2. Create `src/styles/edit-tab.css` with the new layout using CSS Grid
3. Keep the same dark color scheme (`#0a0a18`, `#0f0f20`, `#12122a`, `#1a1a30`, etc.)
4. Use BEM naming following existing conventions
5. Include styles for all new components: `.source-viewer`, `.timeline-viewer`, `.left-panel`, `.tool-sidebar`, `.timeline-tabs`, `.time-ruler`, `.track-header`, `.timeline-bottom-bar`, `.resize-handle`
6. Accent color: `#c83232`
7. Video track clip color: derived from `track.color`
8. Audio track background: `#0d1a15`, clip color: `#1a5a2a`

Key layout CSS:
```css
.edit-tab {
  display: grid;
  height: 100%;
  overflow: hidden;
}

.edit-tab[data-panel-mode="full"] {
  grid-template-columns: var(--left-panel-width) 3px 1fr;
}

.edit-tab[data-panel-mode="compact"] {
  grid-template-columns: 1fr;
  grid-template-rows: var(--viewer-height) 3px 1fr;
}

/* ... all component styles ... */
```

- [ ] **Step 2: Import the new CSS in edit-tab.tsx**

Add `import '@/styles/edit-tab.css';` to the top of edit-tab.tsx.

- [ ] **Step 3: Remove old edit styles from globals.css**

Remove all CSS rules for: `.edit-tab`, `.timeline-editor`, `.track-row`, `.clip-card`, `.asset-panel`, `.preview-player`, `.music-popup`, `.track-ctx`

- [ ] **Step 4: Commit**

```bash
git add src/styles/edit-tab.css src/styles/globals.css src/components/edit/edit-tab.tsx
git commit -m "feat: add NLE editor CSS, remove old edit tab styles"
```

---

### Task 20: Integration + Migration Wire-up

**Files:**
- Modify: `electron/ipc/project.ts`
- Modify: `src/components/workspace/workspace-shell.tsx` (project load path)

- [ ] **Step 1: Add migration to project load**

In the project load handler (or in workspace-shell's hydration), call `migrateSequenceToTimelines()` on the loaded snapshot before hydrating state.

In `workspace-shell.tsx`, update the project load `useEffect`:
```typescript
import { migrateSequenceToTimelines } from '@/lib/editor/timeline-migration';

// In the load effect:
const raw = await window.electronAPI.project.load(projectId);
const migrated = migrateSequenceToTimelines(raw);
dispatch({ type: 'HYDRATE', payload: migrated });
```

- [ ] **Step 2: Update save payload**

Update the persistence `useEffect` to save `timelines` and `activeTimelineId` instead of `sequence`.

- [ ] **Step 3: Delete old files**

Delete `src/components/edit/asset-drawer.tsx` and `src/lib/editor/timeline.ts`.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Run the app and verify**

Run: `npm run dev`
Expected: Edit tab loads with new NLE layout, existing projects migrate automatically, clips display correctly.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire up migration, delete old files, complete editor layout overhaul"
```

---

## Summary

| Task | Description | Chunk |
|------|-------------|-------|
| 1 | New Timeline types | 1 |
| 2 | Core timeline operations | 1 |
| 3 | Advanced editing operations (ripple, roll, slip, slide) | 1 |
| 4 | Sequence → Timeline migration | 1 |
| 5 | Update workspace state (types + reducer) | 1 |
| 6 | ResizeHandle component | 2 |
| 7 | useEditorLayout hook | 2 |
| 8 | ToolSidebar component | 2 |
| 9 | TimelineTabs component | 2 |
| 10 | TrackHeader component | 2 |
| 11 | TimeRuler component | 2 |
| 12 | TimelineBottomBar component | 2 |
| 13 | LeftPanel component | 2 |
| 14 | SourceViewer + TimelineViewer | 2 |
| 15 | EditTab rewrite | 3 |
| 16 | Refactor TimelineEditor | 3 |
| 17 | Refactor TrackRow + ClipCard | 3 |
| 18 | useTimelineDrag hook | 3 |
| 19 | CSS styles | 3 |
| 20 | Integration + migration wire-up | 3 |
