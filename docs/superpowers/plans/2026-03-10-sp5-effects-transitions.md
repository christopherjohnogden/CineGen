# SP5: Effects & Transitions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clip-level properties (speed, opacity, volume, flip), linear keyframes, cross-dissolve/fade transitions, a right-side properties panel, and integrate effects into the playback engine.

**Architecture:** Extend Clip with new fields (defaulted for migration safety). Pure operation functions for keyframes/transitions. New UI components: ClipPropertiesPanel (right panel), TransitionOverlay (timeline), KeyframeTrack (timeline). PlaybackEngine gets per-clip GainNodes and opacity application.

**Tech Stack:** React, TypeScript, Web Audio API (GainNode chaining), CSS Grid layout, Vitest for tests.

---

## Chunk 1: Data Model & Operations

### Task 1: Extend Clip Type & Defaults

**Files:**
- Modify: `src/types/timeline.ts`
- Modify: `src/lib/editor/timeline-migration.ts`
- Modify: `src/lib/editor/timeline-operations.ts` (addClipToTrack, createDefaultTimeline)
- Modify: `src/components/edit/clip-card.tsx` (replace inline duration formula with clipEffectiveDuration)
- Modify: `src/components/edit/timeline-editor.tsx` (replace inline duration formulas with clipEffectiveDuration)
- Modify: `tests/lib/editor/timeline-operations.test.ts` (update makeClip and makeTimeline helpers)

- [ ] **Step 1: Add Keyframe and Transition types and extend Clip in timeline.ts**

Add after the existing `Clip` interface:

```typescript
export interface Keyframe {
  time: number;       // relative to clip's visible window (0 = first visible frame)
  property: 'opacity' | 'volume';
  value: number;
}

export interface Transition {
  id: string;
  type: 'dissolve' | 'fadeToBlack' | 'fadeFromBlack';
  duration: number;
  clipAId: string;
  clipBId?: string;   // undefined for fades (single-clip)
}
```

Extend the `Clip` interface with:
```typescript
speed: number;          // 0.25–4, default 1
opacity: number;        // 0–1, default 1
volume: number;         // 0–1, default 1
flipH: boolean;
flipV: boolean;
keyframes: Keyframe[];
```

Extend the `Timeline` interface with:
```typescript
transitions: Transition[];
```

Extend `EditorLayout` with:
```typescript
rightPanelWidth: number;
```

Update `DEFAULT_EDITOR_LAYOUT` to add `rightPanelWidth: 280`.

- [ ] **Step 2: Update clipEffectiveDuration for speed**

`clipEffectiveDuration` currently returns `clip.duration - clip.trimStart - clip.trimEnd`. With speed, the effective duration on the timeline changes: `(clip.duration - clip.trimStart - clip.trimEnd) / clip.speed`. Update both `clipEffectiveDuration` and its callers to account for this. The function should become:

```typescript
export function clipEffectiveDuration(clip: Clip): number {
  return (clip.duration - clip.trimStart - clip.trimEnd) / clip.speed;
}
```

Note: `trimStart`, `trimEnd`, and `duration` remain in source time. The division by speed converts source duration to timeline duration. Most call sites already use `clipEffectiveDuration()` and `clipEndTime()` so they automatically get the speed-adjusted value. However, some files inline the old formula — those must be fixed in Step 2b.

- [ ] **Step 2b: Replace all inline effective-duration formulas with clipEffectiveDuration()**

Several files manually compute `clip.duration - clip.trimStart - clip.trimEnd` instead of calling `clipEffectiveDuration()`. After the formula changes to include speed, these inline calculations will be wrong for any clip with speed != 1. Fix all of them:

**`src/components/edit/clip-card.tsx` (line ~71):**
```typescript
// BEFORE:
const effectiveDuration = clip.duration - clip.trimStart - clip.trimEnd;
// AFTER:
import { clipEffectiveDuration } from '@/types/timeline';
const effectiveDuration = clipEffectiveDuration(clip);
```

**`src/components/edit/timeline-editor.tsx` — multiple locations:**
Search for `clip.duration - clip.trimStart - clip.trimEnd` (or `clip.duration.*clip.trimStart`) and replace each with `clipEffectiveDuration(clip)`. Known locations include:
- `snapMoveTime` callback (~line 127)
- Move handler (~line 214)
- Marquee selection hit test (~line 417)
- Slip badge rendering (~line 519)
- Any other inline formulas found via grep

Add `import { clipEffectiveDuration } from '@/types/timeline'` if not already imported.

Run: `grep -rn "\.duration.*\.trimStart\|\.duration.*\.trimEnd" src/ --include="*.ts" --include="*.tsx"` to find any remaining instances.

- [ ] **Step 2c: Update test helpers with new Clip and Timeline fields**

In `tests/lib/editor/timeline-operations.test.ts`, update `makeClip` to include defaults for the new fields:
```typescript
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
    speed: 1,
    opacity: 1,
    volume: 1,
    flipH: false,
    flipV: false,
    keyframes: [],
    ...overrides,
  };
}
```

Update `makeTimeline` to include `transitions`:
```typescript
function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    id: 'tl-1',
    name: 'Timeline 1',
    tracks: [
      { id: 'v1', name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'a1', name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
    clips: [],
    duration: 0,
    transitions: [],
    ...overrides,
  };
}
```

This MUST be done before writing any new tests, as TypeScript will reject `makeClip()` and `makeTimeline()` calls without the new required fields.

- [ ] **Step 3: Update addClipToTrack to set defaults for new fields**

In `timeline-operations.ts`, update the `addClipToTrack` function's clip creation to include:
```typescript
speed: 1,
opacity: 1,
volume: 1,
flipH: false,
flipV: false,
keyframes: [],
```

- [ ] **Step 4: Update createDefaultTimeline to include `transitions: []`**

Add `transitions: []` to all Timeline creation sites:
- `createDefaultTimeline` in `timeline-operations.ts`
- The default timeline creation in `timeline-migration.ts` (both the no-sequence default and the migration result)

- [ ] **Step 5: Update splitClip and duplicateClip to carry new fields**

`splitClip` uses spread (`...clip`) so new fields propagate automatically. Same for `duplicateClip`. However, `splitClip` must handle keyframes: when splitting, each half keeps only the keyframes within its visible time range. Add keyframe filtering:

**Important:** `rel` (from `splitTime - clip.startTime`) is in timeline time. Keyframe `time` values are in clip-visible-window time. When speed != 1, these differ. The keyframe split threshold is: `const kfSplitTime = rel * clip.speed;` (converting timeline delta to source/clip time).

For the first half (trimEnd increased): filter `clip.keyframes` to keep only `kf.time < kfSplitTime`.

For the second half (trimStart increased, new startTime): filter keyframes to keep `kf.time >= kfSplitTime`, then offset each by `-kfSplitTime` so they're relative to the new clip's visible start.

- [ ] **Step 6: Update migration to default new Clip fields**

In `timeline-migration.ts`, the clips mapping (line ~83-94) creates clips from the old format. Add the new default fields:
```typescript
speed: 1,
opacity: 1,
volume: 1,
flipH: false,
flipV: false,
keyframes: [],
```

And add `transitions: []` to the Timeline object created at line ~96-102.

- [ ] **Step 7: Update use-editor-layout.ts for rightPanelWidth clamping**

Add clamping in `setLayout`: `next.rightPanelWidth = Math.max(200, Math.min(500, next.rightPanelWidth));`

- [ ] **Step 8: Commit**

```bash
git add src/types/timeline.ts src/lib/editor/timeline-migration.ts src/lib/editor/timeline-operations.ts src/components/edit/use-editor-layout.ts src/components/edit/clip-card.tsx src/components/edit/timeline-editor.tsx tests/lib/editor/timeline-operations.test.ts
git commit -m "feat(editor): extend Clip with speed/opacity/volume/flip/keyframes, add Transition type"
```

---

### Task 2: Keyframe & Transition Operations + Tests

**Files:**
- Modify: `src/lib/editor/timeline-operations.ts`
- Modify: `tests/lib/editor/timeline-operations.test.ts`

- [ ] **Step 1: Write failing tests for interpolateProperty**

```typescript
describe('interpolateProperty', () => {
  it('returns static clip value when no keyframes exist', () => {
    const clip = makeClip({ opacity: 0.5, keyframes: [] });
    expect(interpolateProperty(clip, 'opacity', 2)).toBe(0.5);
  });

  it('returns single keyframe value at any time', () => {
    const clip = makeClip({ opacity: 0.5, keyframes: [{ time: 1, property: 'opacity', value: 0.8 }] });
    expect(interpolateProperty(clip, 'opacity', 0)).toBe(0.8);
    expect(interpolateProperty(clip, 'opacity', 5)).toBe(0.8);
  });

  it('linearly interpolates between two keyframes', () => {
    const clip = makeClip({
      opacity: 1,
      keyframes: [
        { time: 0, property: 'opacity', value: 0 },
        { time: 4, property: 'opacity', value: 1 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 2)).toBeCloseTo(0.5);
  });

  it('holds first keyframe value before it', () => {
    const clip = makeClip({
      opacity: 1,
      keyframes: [
        { time: 2, property: 'opacity', value: 0.3 },
        { time: 4, property: 'opacity', value: 0.7 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 0)).toBeCloseTo(0.3);
  });

  it('holds last keyframe value after it', () => {
    const clip = makeClip({
      opacity: 1,
      keyframes: [
        { time: 0, property: 'opacity', value: 0.3 },
        { time: 2, property: 'opacity', value: 0.7 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 5)).toBeCloseTo(0.7);
  });

  it('only considers keyframes for the requested property', () => {
    const clip = makeClip({
      opacity: 1,
      volume: 0.5,
      keyframes: [
        { time: 0, property: 'volume', value: 0 },
        { time: 4, property: 'volume', value: 1 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 2)).toBe(1); // static, no opacity keyframes
    expect(interpolateProperty(clip, 'volume', 2)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: FAIL — `interpolateProperty` is not exported.

- [ ] **Step 3: Implement interpolateProperty**

```typescript
export function interpolateProperty(
  clip: Clip,
  property: 'opacity' | 'volume',
  clipTime: number,
): number {
  const kfs = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.time - b.time);

  if (kfs.length === 0) return clip[property];
  if (kfs.length === 1) return kfs[0].value;
  if (clipTime <= kfs[0].time) return kfs[0].value;
  if (clipTime >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < kfs.length - 1; i++) {
    if (clipTime >= kfs[i].time && clipTime <= kfs[i + 1].time) {
      const t = (clipTime - kfs[i].time) / (kfs[i + 1].time - kfs[i].time);
      return kfs[i].value + t * (kfs[i + 1].value - kfs[i].value);
    }
  }
  return kfs[kfs.length - 1].value;
}
```

- [ ] **Step 4: Run tests, verify interpolateProperty passes**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: All interpolateProperty tests PASS.

- [ ] **Step 5: Write failing tests for keyframe operations**

```typescript
describe('addKeyframe', () => {
  it('adds a keyframe to the specified clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ keyframes: [] })] });
    const kf: Keyframe = { time: 1, property: 'opacity', value: 0.5 };
    const result = addKeyframe(tl, 'clip-1', kf);
    expect(result.clips[0].keyframes).toHaveLength(1);
    expect(result.clips[0].keyframes[0]).toEqual(kf);
  });

  it('sorts keyframes by time after adding', () => {
    const tl = makeTimeline({
      clips: [makeClip({ keyframes: [{ time: 3, property: 'opacity', value: 1 }] })],
    });
    const result = addKeyframe(tl, 'clip-1', { time: 1, property: 'opacity', value: 0 });
    expect(result.clips[0].keyframes[0].time).toBe(1);
    expect(result.clips[0].keyframes[1].time).toBe(3);
  });
});

describe('removeKeyframe', () => {
  it('removes keyframe at given index', () => {
    const tl = makeTimeline({
      clips: [makeClip({ keyframes: [
        { time: 0, property: 'opacity', value: 0 },
        { time: 2, property: 'opacity', value: 1 },
      ] })],
    });
    const result = removeKeyframe(tl, 'clip-1', 0);
    expect(result.clips[0].keyframes).toHaveLength(1);
    expect(result.clips[0].keyframes[0].time).toBe(2);
  });
});

describe('moveKeyframe', () => {
  it('moves a keyframe to a new time and re-sorts', () => {
    const tl = makeTimeline({
      clips: [makeClip({ keyframes: [
        { time: 0, property: 'opacity', value: 0 },
        { time: 2, property: 'opacity', value: 1 },
      ] })],
    });
    const result = moveKeyframe(tl, 'clip-1', 0, 3);
    expect(result.clips[0].keyframes[0].time).toBe(2);
    expect(result.clips[0].keyframes[1].time).toBe(3);
  });
});
```

- [ ] **Step 6: Run tests, verify they fail**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 7: Implement keyframe operations**

```typescript
export function addKeyframe(timeline: Timeline, clipId: string, keyframe: Keyframe): Timeline {
  return {
    ...timeline,
    clips: timeline.clips.map((c) =>
      c.id === clipId
        ? { ...c, keyframes: [...c.keyframes, keyframe].sort((a, b) => a.time - b.time) }
        : c,
    ),
  };
}

export function removeKeyframe(timeline: Timeline, clipId: string, keyframeIndex: number): Timeline {
  return {
    ...timeline,
    clips: timeline.clips.map((c) =>
      c.id === clipId
        ? { ...c, keyframes: c.keyframes.filter((_, i) => i !== keyframeIndex) }
        : c,
    ),
  };
}

export function moveKeyframe(
  timeline: Timeline,
  clipId: string,
  keyframeIndex: number,
  newTime: number,
): Timeline {
  return {
    ...timeline,
    clips: timeline.clips.map((c) => {
      if (c.id !== clipId) return c;
      const kfs = c.keyframes.map((kf, i) =>
        i === keyframeIndex ? { ...kf, time: Math.max(0, newTime) } : kf,
      );
      return { ...c, keyframes: kfs.sort((a, b) => a.time - b.time) };
    }),
  };
}
```

- [ ] **Step 8: Run tests, verify keyframe operations pass**

- [ ] **Step 9: Write failing tests for transition operations**

```typescript
describe('addTransition', () => {
  it('adds a fade transition to a clip', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', startTime: 0, duration: 10, trimEnd: 2 })],
      transitions: [],
    });
    const result = addTransition(tl, {
      id: 'tr1', type: 'fadeFromBlack', duration: 1, clipAId: 'c1',
    });
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].id).toBe('tr1');
  });

  it('clamps dissolve duration to available handle material and shifts clipB', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10, trimEnd: 1 }),
        makeClip({ id: 'c2', trackId: 'v1', startTime: 10, duration: 10, trimStart: 0.5 }),
      ],
      transitions: [],
    });
    // Dissolve needs handle from both clips. clipA has 1s trimEnd (outgoing handle).
    // clipB has 0.5s trimStart (incoming handle). Available = min(1, 0.5) = 0.5.
    // Request 2s dissolve → clamped to 0.5.
    const result = addTransition(tl, {
      id: 'tr1', type: 'dissolve', duration: 2, clipAId: 'c1', clipBId: 'c2',
    });
    expect(result.transitions[0].duration).toBeCloseTo(0.5);
    // clipB should be shifted left by the clamped duration to create overlap
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBeCloseTo(9.5);
  });

  it('no-ops dissolve when no handle material exists', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10, trimEnd: 0 }),
        makeClip({ id: 'c2', trackId: 'v1', startTime: 10, duration: 10, trimStart: 0 }),
      ],
      transitions: [],
    });
    const result = addTransition(tl, {
      id: 'tr1', type: 'dissolve', duration: 1, clipAId: 'c1', clipBId: 'c2',
    });
    expect(result.transitions).toHaveLength(0);
  });
});

describe('removeTransition', () => {
  it('removes a transition by id', () => {
    const tl = makeTimeline({
      clips: [makeClip()],
      transitions: [{ id: 'tr1', type: 'fadeFromBlack', duration: 1, clipAId: 'clip-1' }],
    });
    const result = removeTransition(tl, 'tr1');
    expect(result.transitions).toHaveLength(0);
  });
});

describe('updateTransition', () => {
  it('updates transition properties', () => {
    const tl = makeTimeline({
      clips: [makeClip()],
      transitions: [{ id: 'tr1', type: 'fadeFromBlack', duration: 1, clipAId: 'clip-1' }],
    });
    const result = updateTransition(tl, 'tr1', { duration: 2 });
    expect(result.transitions[0].duration).toBe(2);
  });
});
```

- [ ] **Step 10: Run tests, verify they fail**

- [ ] **Step 11: Implement transition operations**

```typescript
export function addTransition(timeline: Timeline, transition: Transition): Timeline {
  if (transition.type === 'dissolve' && transition.clipBId) {
    const clipA = timeline.clips.find((c) => c.id === transition.clipAId);
    const clipB = timeline.clips.find((c) => c.id === transition.clipBId);
    if (!clipA || !clipB) return timeline;

    // Available handle: outgoing material from A (trimEnd), incoming material from B (trimStart)
    const available = Math.min(clipA.trimEnd, clipB.trimStart);
    if (available <= 0) return timeline;

    const clampedDuration = Math.min(transition.duration, available);
    // Shift clipB left by the transition duration so the clips overlap
    return withDuration({
      ...timeline,
      clips: timeline.clips.map((c) =>
        c.id === transition.clipBId
          ? { ...c, startTime: c.startTime - clampedDuration }
          : c,
      ),
      transitions: [...timeline.transitions, { ...transition, duration: clampedDuration }],
    });
  }

  // Fade transitions have no handle requirement
  return {
    ...timeline,
    transitions: [...timeline.transitions, transition],
  };
}

export function removeTransition(timeline: Timeline, transitionId: string): Timeline {
  return {
    ...timeline,
    transitions: timeline.transitions.filter((t) => t.id !== transitionId),
  };
}

export function updateTransition(
  timeline: Timeline,
  transitionId: string,
  updates: Partial<Pick<Transition, 'type' | 'duration'>>,
): Timeline {
  return {
    ...timeline,
    transitions: timeline.transitions.map((t) =>
      t.id === transitionId ? { ...t, ...updates } : t,
    ),
  };
}
```

- [ ] **Step 12: Run tests, verify all pass**

Run: `npx vitest run tests/lib/editor/timeline-operations.test.ts`
Expected: All tests PASS.

- [ ] **Step 13: Write test for updateClipProperties helper**

```typescript
describe('updateClipProperties', () => {
  it('updates speed on a clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ speed: 1 })] });
    const result = updateClipProperties(tl, 'clip-1', { speed: 2 });
    expect(result.clips[0].speed).toBe(2);
  });

  it('clamps speed to 0.25–4 range', () => {
    const tl = makeTimeline({ clips: [makeClip({ speed: 1 })] });
    expect(updateClipProperties(tl, 'clip-1', { speed: 0.1 }).clips[0].speed).toBe(0.25);
    expect(updateClipProperties(tl, 'clip-1', { speed: 10 }).clips[0].speed).toBe(4);
  });

  it('clamps opacity to 0–1', () => {
    const tl = makeTimeline({ clips: [makeClip({ opacity: 1 })] });
    expect(updateClipProperties(tl, 'clip-1', { opacity: -0.5 }).clips[0].opacity).toBe(0);
    expect(updateClipProperties(tl, 'clip-1', { opacity: 1.5 }).clips[0].opacity).toBe(1);
  });

  it('toggles flipH', () => {
    const tl = makeTimeline({ clips: [makeClip({ flipH: false })] });
    const result = updateClipProperties(tl, 'clip-1', { flipH: true });
    expect(result.clips[0].flipH).toBe(true);
  });

  it('recalculates timeline duration when speed changes', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 0, duration: 10, speed: 1 })] });
    const result = updateClipProperties(tl, 'clip-1', { speed: 2 });
    // effectiveDuration = 10/2 = 5, so timeline duration = 5
    expect(result.duration).toBe(5);
  });
});
```

- [ ] **Step 14: Implement updateClipProperties**

```typescript
export function updateClipProperties(
  timeline: Timeline,
  clipId: string,
  updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>,
): Timeline {
  return withDuration({
    ...timeline,
    clips: timeline.clips.map((c) => {
      if (c.id !== clipId) return c;
      const merged = { ...c, ...updates };
      // Clamp values
      merged.speed = Math.max(0.25, Math.min(4, merged.speed));
      merged.opacity = Math.max(0, Math.min(1, merged.opacity));
      merged.volume = Math.max(0, Math.min(1, merged.volume));
      return merged;
    }),
  });
}
```

- [ ] **Step 15: Run all tests, verify pass**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 16: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors). Note: There may be type errors in existing code that references `Clip` without the new fields. If so, update `makeClip` in the test file to include new field defaults, and update any component code that creates Clip objects inline.

- [ ] **Step 17: Commit**

```bash
git add src/lib/editor/timeline-operations.ts tests/lib/editor/timeline-operations.test.ts
git commit -m "feat(editor): add keyframe/transition operations with interpolation"
```

---

## Chunk 2: UI Components

### Task 3: Clip Properties Panel

**Files:**
- Create: `src/components/edit/clip-properties-panel.tsx`
- Modify: `src/styles/edit-tab.css` (add panel styles)

- [ ] **Step 1: Create clip-properties-panel.tsx**

The panel receives the selected clip, its asset, and dispatch callbacks. Sections:

```typescript
import { useCallback } from 'react';
import type { Clip } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { clipEffectiveDuration } from '@/types/timeline';

interface ClipPropertiesPanelProps {
  clip: Clip | null;
  asset: Asset | null;
  onUpdateClip: (clipId: string, updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => void;
  onAddKeyframe: (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => void;
  onRemoveKeyframe: (clipId: string, index: number) => void;
  onClose: () => void;
}
```

Panel structure:
- Header with clip name and close button
- **Transform** section: Two toggle buttons for flipH/flipV
- **Speed** section: Range input (0.25–4, step 0.25) + display label showing current value
- **Opacity** section: Range input (0–1, step 0.01) + display label
- **Volume** section (shown only for audio clips): Range input (0–1, step 0.01) + display label
- **Keyframes** section: List existing keyframes with time, property, value. "Add Keyframe" button that adds a keyframe at `clipEffectiveDuration / 2` for the selected property.

Each slider fires `onUpdateClip(clip.id, { [property]: value })` on change.

When `clip` is null, render nothing (panel collapses).

- [ ] **Step 2: Add CSS for the properties panel**

Append to `src/styles/edit-tab.css`:

```css
/* Clip Properties Panel */
.clip-properties-panel {
  display: flex;
  flex-direction: column;
  background: #0f0f20;
  border-left: 1px solid rgba(255,255,255,0.08);
  overflow-y: auto;
  padding: 0;
}
.clip-properties-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
.clip-properties-panel__title {
  font-size: 12px;
  font-weight: 600;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clip-properties-panel__close {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.clip-properties-panel__close:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
}
.clip-properties-panel__section {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.clip-properties-panel__section-title {
  font-size: 10px;
  text-transform: uppercase;
  color: #666;
  margin-bottom: 6px;
  letter-spacing: 0.5px;
}
.clip-properties-panel__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.clip-properties-panel__label {
  font-size: 11px;
  color: #aaa;
  min-width: 50px;
}
.clip-properties-panel__slider {
  flex: 1;
  height: 4px;
  accent-color: #c83232;
  cursor: pointer;
}
.clip-properties-panel__value {
  font-size: 11px;
  color: #888;
  min-width: 35px;
  text-align: right;
  font-family: monospace;
}
.clip-properties-panel__toggle-row {
  display: flex;
  gap: 4px;
}
.clip-properties-panel__toggle-btn {
  padding: 4px 10px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 3px;
  background: transparent;
  color: #888;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.clip-properties-panel__toggle-btn--active {
  background: rgba(200,50,50,0.3);
  color: #e88;
  border-color: #c83232;
}
.clip-properties-panel__kf-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.clip-properties-panel__kf-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #aaa;
  padding: 2px 4px;
  border-radius: 2px;
}
.clip-properties-panel__kf-item:hover {
  background: rgba(255,255,255,0.05);
}
.clip-properties-panel__kf-remove {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  margin-left: auto;
}
.clip-properties-panel__kf-remove:hover {
  color: #e88;
}
.clip-properties-panel__add-kf {
  padding: 4px 8px;
  border: 1px dashed rgba(255,255,255,0.2);
  border-radius: 3px;
  background: transparent;
  color: #888;
  font-size: 10px;
  cursor: pointer;
  margin-top: 4px;
}
.clip-properties-panel__add-kf:hover {
  border-color: rgba(255,255,255,0.4);
  color: #ccc;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/edit/clip-properties-panel.tsx src/styles/edit-tab.css
git commit -m "feat(editor): add clip properties panel component"
```

---

### Task 4: Integrate Right Panel into Edit Tab Layout

**Files:**
- Modify: `src/components/edit/edit-tab.tsx`
- Modify: `src/styles/edit-tab.css`

- [ ] **Step 1: Import ClipPropertiesPanel and add state**

In `edit-tab.tsx`:
- Import `ClipPropertiesPanel`
- Import `updateClipProperties`, `addKeyframe`, `removeKeyframe` from `timeline-operations`
- Import `Keyframe` type from `timeline`

- [ ] **Step 2: Add right panel callbacks**

```typescript
const selectedClip = useMemo(() => {
  if (selectedClipIds.size !== 1) return null;
  const clipId = [...selectedClipIds][0];
  return timeline.clips.find((c) => c.id === clipId) ?? null;
}, [selectedClipIds, timeline.clips]);

const selectedClipAsset = useMemo(() => {
  if (!selectedClip) return null;
  return state.assets.find((a) => a.id === selectedClip.assetId) ?? null;
}, [selectedClip, state.assets]);

const handleUpdateClipProps = useCallback(
  (clipId: string, updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => {
    const updated = updateClipProperties(timeline, clipId, updates);
    dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
  },
  [dispatch, timeline],
);

const handleAddKeyframe = useCallback(
  (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => {
    const kf: Keyframe = { time, property, value };
    const updated = addKeyframe(timeline, clipId, kf);
    dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
  },
  [dispatch, timeline],
);

const handleRemoveKeyframe = useCallback(
  (clipId: string, index: number) => {
    const updated = removeKeyframe(timeline, clipId, index);
    dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
  },
  [dispatch, timeline],
);

const handleRightPanelResize = useCallback((delta: number) => {
  setLayout({ rightPanelWidth: layout.rightPanelWidth - delta }); // subtract because dragging left makes panel wider
}, [layout.rightPanelWidth, setLayout]);

const handleCloseRightPanel = useCallback(() => {
  setSelectedClipIds(new Set());
}, []);
```

- [ ] **Step 3: Add right panel to JSX**

After the `</div>` closing `edit-tab__center`, add:

```tsx
{selectedClip && (
  <ResizeHandle
    direction="horizontal"
    onResize={handleRightPanelResize}
    className="edit-tab__right-resize"
  />
)}
{selectedClip && (
  <ClipPropertiesPanel
    clip={selectedClip}
    asset={selectedClipAsset}
    onUpdateClip={handleUpdateClipProps}
    onAddKeyframe={handleAddKeyframe}
    onRemoveKeyframe={handleRemoveKeyframe}
    onClose={handleCloseRightPanel}
  />
)}
```

- [ ] **Step 4: Update CSS grid for right panel**

Update `.edit-tab[data-panel-mode="full"]` to conditionally handle right panel. Use a CSS custom property approach:

```css
.edit-tab[data-panel-mode="full"] {
  grid-template-columns: var(--left-panel-width, 240px) 3px 1fr;
}
.edit-tab[data-panel-mode="full"][data-right-panel="true"] {
  grid-template-columns: var(--left-panel-width, 240px) 3px 1fr 3px var(--right-panel-width, 280px);
}
.edit-tab[data-panel-mode="compact"][data-right-panel="true"] {
  grid-template-columns: 1fr 3px var(--right-panel-width, 280px);
}
```

In the JSX, add `data-right-panel={selectedClip ? 'true' : undefined}` and CSS variables to the root div:

```tsx
<div
  className="edit-tab"
  data-panel-mode={layout.leftPanelMode}
  data-right-panel={selectedClip ? 'true' : undefined}
  style={{
    '--left-panel-width': `${layout.leftPanelWidth}px`,
    '--right-panel-width': `${layout.rightPanelWidth}px`,
  } as React.CSSProperties}
>
```

- [ ] **Step 5: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/edit/edit-tab.tsx src/styles/edit-tab.css
git commit -m "feat(editor): integrate clip properties panel with right panel layout"
```

---

### Task 5: Transition Overlay Component

**Files:**
- Create: `src/components/edit/transition-overlay.tsx`
- Modify: `src/styles/edit-tab.css` (transition overlay styles — same file as properties panel for consistency)
- Modify: `src/components/edit/timeline-editor.tsx` (render overlays)

- [ ] **Step 1: Create transition-overlay.tsx**

```typescript
import type { Transition, Clip } from '@/types/timeline';
import { clipEndTime } from '@/types/timeline';

interface TransitionOverlayProps {
  transition: Transition;
  clipA: Clip;
  clipB?: Clip;
  pxPerSecond: number;
  onRemove: (transitionId: string) => void;
}
```

The component:
- Positions itself absolutely within the track row, spanning the transition duration at the junction between clipA and clipB.
- For dissolve: centers on the cut point between clipA end and clipB start. Width = `transition.duration * pxPerSecond`. Left = `(clipEndTime(clipA) - transition.duration / 2) * pxPerSecond`.
- For fadeFromBlack: starts at `clipA.startTime * pxPerSecond`.
- For fadeToBlack: ends at `clipEndTime(clipA) * pxPerSecond`.
- Shows a gradient visual (dark → transparent for fadeFromBlack, transparent → dark for fadeToBlack, crossfade icon for dissolve).
- Double-click to cycle type (only when both clips exist — dissolve ↔ fade). For single-clip fades, toggle between fadeToBlack ↔ fadeFromBlack.
- Shows a small "×" button to remove on hover.

- [ ] **Step 2: Add CSS for transition overlays**

```css
/* Transition Overlay */
.transition-overlay {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  border-radius: 2px;
  min-width: 8px;
  transition: opacity 0.15s;
}
.transition-overlay--dissolve {
  background: linear-gradient(90deg, rgba(200,50,50,0.3), rgba(52,152,219,0.3));
}
.transition-overlay--fadeToBlack {
  background: linear-gradient(90deg, transparent, rgba(0,0,0,0.6));
}
.transition-overlay--fadeFromBlack {
  background: linear-gradient(90deg, rgba(0,0,0,0.6), transparent);
}
.transition-overlay__icon {
  font-size: 10px;
  color: rgba(255,255,255,0.7);
  pointer-events: none;
}
.transition-overlay__remove {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: #e88;
  cursor: pointer;
  font-size: 10px;
  display: none;
  align-items: center;
  justify-content: center;
}
.transition-overlay:hover .transition-overlay__remove {
  display: flex;
}
```

- [ ] **Step 3: Wire transition rendering into timeline-editor.tsx**

In `timeline-editor.tsx`, inside each TrackRow rendering, after the clips, map over `timeline.transitions` to render `<TransitionOverlay>` for transitions whose clipAId or clipBId belongs to that track.

Pass `onRemove` callback that dispatches `removeTransition`.

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/transition-overlay.tsx src/styles/edit-tab.css src/components/edit/timeline-editor.tsx
git commit -m "feat(editor): add transition overlay component"
```

---

### Task 6: Keyframe Track Component

**Files:**
- Create: `src/components/edit/keyframe-track.tsx`
- Modify: `src/styles/edit-tab.css` (keyframe track styles — same file for consistency)
- Modify: `src/components/edit/clip-card.tsx` (render keyframe track below clip)

- [ ] **Step 1: Create keyframe-track.tsx**

```typescript
import { useCallback } from 'react';
import type { Clip, Keyframe } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';

interface KeyframeTrackProps {
  clip: Clip;
  pxPerSecond: number;
  onAddKeyframe: (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => void;
  onMoveKeyframe: (clipId: string, index: number, newTime: number) => void;
  onRemoveKeyframe: (clipId: string, index: number) => void;
}
```

The component:
- Renders a thin row (12px height) below the clip content area.
- Background: slightly darker than the clip body.
- For each keyframe in `clip.keyframes`, render a diamond marker at `(kf.time / clipEffectiveDuration(clip)) * 100%` horizontal position.
- Color-coded: opacity keyframes = yellow diamonds, volume keyframes = green diamonds.
- Click on empty space adds a new keyframe at that time position with the clip's current property value.
- Drag a diamond to move its time (horizontal only).
- Select a diamond + Delete key removes it.

- [ ] **Step 2: Add CSS**

```css
/* Keyframe Track */
.keyframe-track {
  position: relative;
  height: 12px;
  background: rgba(0,0,0,0.3);
  border-top: 1px solid rgba(255,255,255,0.05);
  cursor: crosshair;
}
.keyframe-track__marker {
  position: absolute;
  width: 8px;
  height: 8px;
  top: 2px;
  transform: translateX(-4px) rotate(45deg);
  cursor: grab;
  transition: box-shadow 0.15s;
}
.keyframe-track__marker--opacity {
  background: #f1c40f;
}
.keyframe-track__marker--volume {
  background: #2ecc71;
}
.keyframe-track__marker:hover {
  box-shadow: 0 0 4px rgba(255,255,255,0.4);
}
.keyframe-track__marker--selected {
  box-shadow: 0 0 0 2px #fff;
}
```

- [ ] **Step 3: Render KeyframeTrack inside ClipCard when clip has keyframes or is selected**

In `clip-card.tsx`, conditionally render `<KeyframeTrack>` at the bottom of the clip if the clip has keyframes or if the clip is selected (so users can add keyframes to a selected clip).

Pass through the keyframe callbacks from `ClipCard`'s props. Add `onAddKeyframe`, `onMoveKeyframe`, `onRemoveKeyframe` to `ClipCard`'s props interface.

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/keyframe-track.tsx src/styles/edit-tab.css src/components/edit/clip-card.tsx
git commit -m "feat(editor): add keyframe track with diamond markers"
```

---

## Chunk 3: Playback Integration

### Task 7: Playback Engine Effects Integration

**Files:**
- Modify: `src/lib/editor/playback-engine.ts`
- Modify: `src/types/timeline.ts` (import Keyframe if needed)

- [ ] **Step 1: Add per-clip GainNode support**

Currently the audio graph is: `MediaElementSource → trackGain → masterGain`. Change to: `MediaElementSource → clipGain → trackGain → masterGain`.

In the `audioSources` Map, extend the stored value to include a `clipGain: GainNode`:

```typescript
private audioSources = new Map<
  string,
  { el: HTMLAudioElement; source: MediaElementAudioSourceNode; clipGain: GainNode }
>();
```

In `syncAudio()`, when creating a new source (note: this code runs inside the guard `if (!this.audioContext || !this.masterGain) return` so `masterGain` is guaranteed non-null):
```typescript
const clipGain = this.audioContext.createGain();
clipGain.gain.value = entry.clip.volume ?? 1;
source.connect(clipGain);
const trackGain = this.trackGains.get(entry.clip.trackId);
if (trackGain) clipGain.connect(trackGain);
else clipGain.connect(this.masterGain!); // safe: outer guard ensures masterGain is non-null
src = { el, source, clipGain };
```

In `syncAudio()` during playback, apply both clip speed and keyframed volume:

**Speed:** Update `playbackRate` and `sourceTime` to account for clip speed (same fix as syncVideo):
```typescript
// Replace: src.el.playbackRate = this._speed;
src.el.playbackRate = this._speed * (entry.clip.speed ?? 1);

// Replace sourceTime calculation:
const sourceTime = entry.clip.trimStart + (this._currentTime - entry.clip.startTime) * (entry.clip.speed ?? 1);
```

**Volume keyframes:** Update the clipGain value based on keyframe interpolation:
```typescript
import { interpolateProperty } from './timeline-operations';

const clipTime = this._currentTime - entry.clip.startTime;
const kfVolume = interpolateProperty(entry.clip, 'volume', clipTime);
src.clipGain.gain.value = kfVolume;
```

- [ ] **Step 2: Apply clip speed to video playback**

In `syncVideo()`, when setting playback rate, multiply by clip speed:
```typescript
if (this._isPlaying) {
  el.playbackRate = this._speed * (activeVisual.clip.speed ?? 1);
  // ...
}
```

Also need to adjust the source time calculation for speed. The source time for a speed-adjusted clip:
```typescript
const sourceTime =
  activeVisual.clip.trimStart +
  (this._currentTime - activeVisual.clip.startTime) * activeVisual.clip.speed;
```

This is because when playing at 2x speed, each second of timeline time covers 2 seconds of source time.

- [ ] **Step 3: Apply opacity from clip properties and keyframes**

In `syncVideo()`, when the active video is found, set its opacity based on the clip's keyframed opacity:

```typescript
import { interpolateProperty } from './timeline-operations';

const clipTime = this._currentTime - activeVisual.clip.startTime;
const opacity = interpolateProperty(activeVisual.clip, 'opacity', clipTime);
el.style.opacity = String(opacity);
```

- [ ] **Step 4: Apply flip transforms**

In `syncVideo()`, apply CSS transforms for flipH/flipV:
```typescript
const scaleX = activeVisual.clip.flipH ? -1 : 1;
const scaleY = activeVisual.clip.flipV ? -1 : 1;
el.style.transform = `scale(${scaleX}, ${scaleY})`;
```

- [ ] **Step 5: Handle transitions in playback**

**Dissolve model:** When `addTransition` creates a dissolve, it shifts clipB's `startTime` left by `transition.duration` so the clips overlap on the timeline. The overlap region is where the crossfade happens. This means `getActiveClips()` will naturally return both clips during the overlap period.

**Update `addTransition` (in timeline-operations.ts)** to reposition clips for dissolves:
```typescript
// After validation and clamping...
const clampedDuration = Math.min(transition.duration, available);
// Shift clipB left so the clips overlap by the transition duration
return {
  ...timeline,
  clips: timeline.clips.map((c) =>
    c.id === transition.clipBId
      ? { ...c, startTime: c.startTime - clampedDuration }
      : c,
  ),
  transitions: [...timeline.transitions, { ...transition, duration: clampedDuration }],
};
```

**In `syncVideo()`**, modify the active visual logic to handle dissolves:

1. Find all active video clips (not just the first one).
2. Check if any dissolve transition applies between active clips.
3. If so, render both videos with complementary opacity based on crossfade progress.

```typescript
// Check for active dissolve transition
for (const t of (this.timeline.transitions ?? [])) {
  if (t.type !== 'dissolve' || !t.clipBId) continue;
  const clipA = this.timeline.clips.find((c) => c.id === t.clipAId);
  const clipB = this.timeline.clips.find((c) => c.id === t.clipBId);
  if (!clipA || !clipB) continue;

  // The overlap region is [clipB.startTime, clipEndTime(clipA)]
  const overlapStart = clipB.startTime;
  const overlapEnd = clipEndTime(clipA);
  if (this._currentTime >= overlapStart && this._currentTime < overlapEnd) {
    const progress = (this._currentTime - overlapStart) / t.duration;
    // clipA fades out, clipB fades in
    // Both videos should be visible with complementary opacity
    const videoA = this.getVideoForClip(clipA);
    const videoB = this.getVideoForClip(clipB);
    if (videoA) videoA.style.opacity = String(1 - progress);
    if (videoB) videoB.style.opacity = String(progress);
  }
}
```

Add a helper `getVideoForClip(clip: Clip)` that finds the video element by looking up the clip's asset URL in the video pool.

**For fade transitions:** In `syncVideo()`, check if a fadeToBlack or fadeFromBlack transition applies to the current clip. If so, multiply the clip's opacity by a fade factor:
- fadeFromBlack: at clip start, opacity ramps from 0 to 1 over `transition.duration`
- fadeToBlack: at clip end, opacity ramps from 1 to 0 over `transition.duration`

- [ ] **Step 6: Update cleanup in destroy()**

Update `destroy()` to disconnect clipGain nodes:
```typescript
for (const src of this.audioSources.values()) {
  src.el.pause();
  src.el.src = '';
  src.source.disconnect();
  src.clipGain.disconnect();
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/editor/playback-engine.ts
git commit -m "feat(editor): integrate effects into playback engine (speed, opacity, volume keyframes, transitions)"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors).

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Verify no regressions in existing operations**

Check that all existing timeline operation tests still pass, especially `clipEffectiveDuration` and `clipEndTime` based tests. If any test expects the old formula without speed, update the test's makeClip to include `speed: 1` (which gives the same result as before).

- [ ] **Step 4: Grep for any missed references**

Check for any code that directly accesses `clip.duration - clip.trimStart - clip.trimEnd` without going through `clipEffectiveDuration()`:
```bash
grep -rn "clip\.duration.*clip\.trimStart" src/ --include="*.ts" --include="*.tsx"
```

If any manual calculations exist, replace them with `clipEffectiveDuration()` calls.

---

## Notes

### Deferred Items
- **Drag-to-resize transitions** — Transition duration adjustment via drag handles on the overlay. For now, transitions are created with a fixed duration and can be updated via the properties panel or programmatic call.
- **Keyframe curves** — Only linear interpolation is implemented. Bezier/ease curves are a future enhancement.
- **Transition preview in viewer** — Dissolve transitions render in the video pool during playback, but there's no scrub preview. Adding dual-video scrub preview is deferred.

### Behavioral Changes
- **clipEffectiveDuration now divides by speed** — This means all existing code that calls `clipEffectiveDuration()` automatically accounts for speed. Clips at 2x speed take half the timeline space. This is the standard NLE behavior.
- **Per-clip GainNode** — Audio routing changes from `source → trackGain` to `source → clipGain → trackGain`. The clipGain node handles keyframed volume while trackGain handles the track fader.

### Migration Safety
- All new Clip fields have sensible defaults (speed=1, opacity=1, volume=1, flipH/V=false, keyframes=[]).
- `timeline-migration.ts` explicitly sets these defaults when migrating old data.
- The `use-editor-layout.ts` spread merge pattern (`{ ...DEFAULT, ...saved }`) automatically provides `rightPanelWidth: 280` for existing users.
- `Timeline.transitions` defaults to `[]`.
