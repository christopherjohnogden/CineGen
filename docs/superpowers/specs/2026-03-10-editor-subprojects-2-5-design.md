# Editor Overhaul Sub-Projects 2–5 Design

> **Prerequisite:** Sub-Project 1 (Editor Layout + Timeline Core) is complete.
> Each sub-project gets its own plan → implementation cycle.
> Build order: SP2 → SP3 → SP4 → SP5 (each depends on the previous).

---

## Sub-Project 2: Create Tab Migration + Legacy Cleanup

**Goal:** Eliminate all references to `@/types/editor` and `@/lib/editor/timeline`, making the new flat-clip `Timeline` model the single source of truth.

### Files to Migrate

| File | Change |
|------|--------|
| `src/components/edit/preview-player.tsx` | Swap `import type { Clip } from '@/types/editor'` → `'@/types/timeline'` |
| `src/components/edit/music-generation-popup.tsx` | Same import swap |
| `src/components/create/timeline-preview.tsx` | Same import swap, verify Clip usage |
| `src/components/create/create-timeline.tsx` | Full rewrite: replace `Sequence` model + compat bridges with `Timeline` + `timeline-operations.ts` |

### Files to Delete

- `src/types/editor.ts` — Old `Clip`, `Track`, `Sequence` types
- `src/lib/editor/timeline.ts` — Old operations library (241 lines)
- `tests/lib/editor/timeline.test.ts` — Old tests (has pre-existing failure)

### Design Notes

- `preview-player.tsx` and `music-generation-popup.tsx` are simple import swaps — the `Clip` interfaces are structurally identical between old and new types (same fields: id, assetId, trackId, startTime, duration, trimStart, trimEnd, name). After swapping, audit call sites in `edit-tab.tsx` that pass `clip` props to ensure they pass new `Timeline` `Clip` objects (not old `Sequence`-nested clips).
- `create-timeline.tsx` (627 lines) is the big migration. Currently uses old `Sequence` model with `timelineToSequence()`/`sequenceToTimeline()` compat bridges and assumes a single track (`sequence.tracks[0]`). After rewrite: operate on the first video track (V1) of the `Timeline`. Use `clipsOnTrack(timeline, v1TrackId)` to get clips for the single-track Create tab view. All operations use `timeline-operations.ts` functions directly. Must preserve exact Create tab behavior.
- `timeline-preview.tsx` just needs the Clip import updated.
- After all imports are cleared, delete the old type/operation files.
- Verify `timeline-operations.test.ts` (52 tests) covers everything the old `timeline.test.ts` did.

---

## Sub-Project 3: Playback Engine

**Goal:** Replace scattered playback code with a unified engine using Web Audio API for audio mixing and the existing video pool pattern for video.

### Architecture

#### PlaybackEngine Class

**File:** `src/lib/editor/playback-engine.ts`

A plain TypeScript class (not a React component) that owns all playback state. EditTab instantiates via ref.

**Transport:**
- `play()`, `pause()`, `seek(time)`, `toggleLoop()`, `setSpeed(rate)`
- Speed range: 0.25x–4x
- Loop between in/out points or full timeline

**Master Clock:**
- RAF-driven with `currentTime` tracking
- Respects `playbackRate` for speed changes
- Stops at timeline end (or loops)

**Video Pool:**
- Migrates `Map<url, HTMLVideoElement>` pattern from `preview-player.tsx`
- Pre-creates video elements for all timeline video URLs
- Syncs active video to clock position
- Pre-seeks next clip while current plays
- Uses `requestVideoFrameCallback` for frame-accurate promotion

**Audio Mixer (Web Audio API):**
```
AudioContext
  └── masterGain (GainNode) → destination
       ├── trackGain[A1] (GainNode)
       │    └── MediaElementAudioSourceNode (per clip)
       ├── trackGain[A2] (GainNode)
       │    └── MediaElementAudioSourceNode (per clip)
       └── ...
```
- One `GainNode` per audio track, feeding a master `GainNode`
- Each audio clip uses `MediaElementAudioSourceNode` connected through its track's gain
- Per-track volume (0–1) and mute/solo
- Master volume control

**Event Callbacks:**
- `onTimeUpdate(time: number)` — every RAF frame
- `onPlay()`, `onPause()`, `onSeek(time: number)`
- `onClipChange(activeClips: Array<{ clip: Clip; asset: Asset }>)` — when active clips change (same shape as EditTab's current `activeClips`)

#### usePlaybackEngine Hook

**File:** `src/components/edit/use-playback-engine.ts`

React wrapper that:
- Creates/destroys engine on mount/unmount
- Syncs timeline changes (clips, tracks, mute/solo state)
- Exposes transport controls + `currentTime` state
- Handles AudioContext resume: engine creates `AudioContext` in `suspended` state. The hook attaches a one-time click listener to the transport play button that calls `audioContext.resume()`. Before resume, video plays without audio (no error). After first gesture, audio works normally.

#### Track Volume

Add `volume: number` to `Track` type in `src/types/timeline.ts`. Default 1, range 0–1. `TrackHeader` gets a volume slider wired through workspace dispatch.

### Refactoring

- **`timeline-viewer.tsx`** — Simplify to rendering the engine's active video. Remove its own pool logic.
- **`preview-player.tsx`** — Create a separate `PlaybackEngine` instance for the Create tab (not shared with Edit tab — tabs are never active simultaneously, and shared state would add coupling for no benefit). Remove duplicated pool logic, delegate to engine.
- **`source-viewer.tsx`** — Unchanged (independent clip-level preview).
- **`edit-tab.tsx`** — Remove RAF playback loop, `activeClips` calculation, `audioEntries` collection. All moves into engine.

### Not Included

Per-clip volume keyframes (SP5). This is track-level mixing only.

---

## Sub-Project 4: Advanced Editing Tools

**Goal:** Wire `useTimelineDrag` hook and `timeline-operations.ts` into the timeline UI so all 7 tools work end-to-end.

### Current State

- `timeline-editor.tsx` has ~200 lines of inline pointer handlers implementing select, move, blade, and roll.
- `use-timeline-drag.ts` exists with all 7 tool behaviors but is **not connected**.
- `timeline-operations.ts` has `rippleTrim`, `rollTrim`, `slipClip`, `slideClip`, `trackSelectForward` fully implemented and tested.

### Approach

#### Replace Inline Handlers

Remove inline pointer handling from `timeline-editor.tsx`. Wire `useTimelineDrag`'s `handleClipMouseDown` and `handleBladeClick` instead. All tool behavior flows through one unified code path.

#### Visual Feedback Per Tool

| Tool | Visual |
|------|--------|
| **Ripple trim** | Cursor changes to ripple icon. Ghost overlay shows downstream clips shifting. |
| **Roll trim** | Yellow highlight on cut point between adjacent clips (partially exists). |
| **Slip** | Filmstrip thumbnail shifts inside clip card while position stays fixed. Source in/out timecodes shown. |
| **Slide** | Clip ghost moves while neighbor trim values change. Neighbor trim delta shown. |
| **Track Select Forward** | All clips from click point rightward highlight on hover. Drag moves as group. |
| **Blade** | Vertical line cursor (exists). Add split preview line on clip showing cut point. |

#### Snap Improvements

Current snap only targets clip edges. Add:
- Snap to playhead position
- Snap to time ruler marks (beat grid)

#### Keyboard Modifiers

- **Shift** during trim → ripple trim regardless of active tool
- **Alt** during move → duplicate (already exists)
- **Ctrl** during blade → split all tracks at playhead (detected in `handleBladeClick` via `e.ctrlKey` / `e.metaKey`, calls `splitAllTracks()`)

#### Visual Feedback Callbacks

`useTimelineDrag` gets these new callback props for UI feedback during drag:

```typescript
onRipplePreview?: (clipId: string, affectedClipIds: string[], delta: number) => void
onRipplePreviewEnd?: () => void
onSlipPreview?: (clipId: string, sourceOffset: number) => void
onSlipPreviewEnd?: () => void
onSlidePreview?: (clipId: string, leftNeighborDelta: number, rightNeighborDelta: number) => void
onSlidePreviewEnd?: () => void
onTrackForwardHighlight?: (clipIds: string[]) => void
onTrackForwardHighlightEnd?: () => void
```

These are called during drag to drive visual overlays. `timeline-editor.tsx` passes them down and manages overlay state.

#### Ripple Trim Clarification

Left-edge ripple: trims the clip's left edge inward (increases `trimStart`). The clip itself shrinks — downstream clips do NOT shift. Right-edge ripple: trims the clip's right edge (increases `trimEnd`) and shifts all downstream clips on the same track leftward by the trim delta. The ghost overlay showing "downstream clips shifting" only applies to right-edge ripple.

#### Files Touched

- `timeline-editor.tsx` — Major refactor of pointer handlers
- `use-timeline-drag.ts` — Add visual feedback callbacks (signatures above)
- `clip-card.tsx` — Add slip visual (shifting filmstrip)
- `timeline-operations.ts` — Add `splitAllTracks()` helper
- New: `src/styles/edit-tools.css` for tool-specific cursor/visual styles

---

## Sub-Project 5: Effects & Transitions

**Goal:** Add clip properties panel, cross-dissolve/fade transitions, and linear keyframes for animatable properties.

### Data Model Changes

**Add to `Clip` in `src/types/timeline.ts`:**
```typescript
speed: number          // 0.25–4, default 1
opacity: number        // 0–1, default 1
volume: number         // 0–1, default 1 (audio clips)
flipH: boolean         // horizontal flip
flipV: boolean         // vertical flip
keyframes: Keyframe[]  // animated properties
```

**New `Keyframe` type:**
```typescript
interface Keyframe {
  time: number       // relative to clip's visible window (0 = first visible frame, i.e. trimStart in source time)
  property: 'opacity' | 'volume'
  value: number
}
```

Linear interpolation between keyframes. No keyframes = static value from clip property. `time` is in seconds from the clip's visible start (not the source file start). So `time: 0` = beginning of what the viewer sees, `time: effectiveDuration` = end of visible clip.

**Note:** `speed` is intentionally excluded from keyframeable properties. Variable-speed keyframes require integrating over a speed curve to map timeline time → source time, which is a non-trivial clock problem. Clip speed is a static property only (constant for the clip's duration). This keeps the playback engine simple: just set `video.playbackRate = clip.speed`.

**New `Transition` type:**
```typescript
interface Transition {
  id: string
  type: 'dissolve' | 'fadeToBlack' | 'fadeFromBlack'
  duration: number
  clipAId: string
  clipBId?: string   // undefined for fades (single-clip)
}
```

Stored in `Timeline.transitions: Transition[]`. Dissolve requires two adjacent clips on the same track with overlapping handles (trimmed material to use during blend). `addTransition()` validates: if clips lack sufficient trimmed material for the requested duration, it clamps the duration to the available handle length. If no handle material exists at all, it returns the timeline unchanged (no-op). Fades apply to a single clip edge and have no handle requirement.

### New Components

#### Clip Properties Panel

**File:** `src/components/edit/clip-properties-panel.tsx`

Right-side collapsible panel. Shows when clip(s) selected. Sections:
- **Transform:** Flip H/V toggle buttons
- **Speed:** Slider (0.25–4x) + numeric input
- **Opacity:** Slider (0–1)
- **Volume:** Slider (0–1), audio clips only
- **Keyframes:** List of keyframes per property. Add keyframe button.

#### Transition Overlay

**File:** `src/components/edit/transition-overlay.tsx`

Rendered on the timeline between adjacent clips:
- Shows transition icon and duration
- Drag edges to adjust duration
- Double-click to change type (dissolve ↔ fade)
- Visual: gradient bar between clips

#### Keyframe Track

**File:** `src/components/edit/keyframe-track.tsx`

Thin row below each clip in the timeline:
- Diamond markers for keyframes
- Click to add, drag to move, Delete key to remove
- Color-coded by property

### Layout Change

Add right panel to CSS Grid in `edit-tab.tsx`:
- New `rightPanelWidth` in `EditorLayout` interface in `src/types/timeline.ts` (default 280px). Also update `DEFAULT_EDITOR_LAYOUT` in the same file.
- Resize handle between timeline area and properties panel
- Panel collapses (width 0) when no clip selected
- Persisted to localStorage with other layout state via `use-editor-layout.ts`

### Volume Interaction: Clip vs Track

SP3 adds `volume: number` to `Track` (track-level fader). SP5 adds `volume: number` to `Clip` (clip-level). During playback, the effective volume for an audio clip is: `clip.volume * track.volume * master.volume`. In the Web Audio graph, the clip's keyframed volume modulates a per-clip `GainNode` that feeds into the track's `GainNode`. Graph: `MediaElementSource → clipGain (clip.volume, keyframed) → trackGain (track.volume) → masterGain`.

### Playback Integration

The PlaybackEngine (SP3) applies effects in its render loop:
- **Opacity:** Set `globalAlpha` on canvas or video element opacity
- **Volume:** Keyframed volume modulates the track GainNode
- **Speed:** Set `video.playbackRate = clip.speed` (constant per clip, not keyframed). Clock adjusts effective duration: `effectiveDuration / clip.speed`.
- **Dissolve:** Render two overlapping videos with complementary opacity values during transition region
- **Fade to/from black:** Animate clip opacity from/to 0 at clip boundaries

### New Operations

Pure functions in `timeline-operations.ts`:
- `addKeyframe(timeline, clipId, keyframe)` → Timeline
- `removeKeyframe(timeline, clipId, keyframeIndex)` → Timeline
- `moveKeyframe(timeline, clipId, keyframeIndex, newTime)` → Timeline
- `addTransition(timeline, transition)` → Timeline
- `removeTransition(timeline, transitionId)` → Timeline
- `updateTransition(timeline, transitionId, updates)` → Timeline
- `interpolateProperty(clip, property, clipTime)` → number (resolves keyframed value at `clipTime` seconds from visible clip start)

---

## Dependency Graph

```
SP2 (Legacy Cleanup)
 └── SP3 (Playback Engine) — needs clean types
      └── SP4 (Advanced Tools) — needs playback for testing edits
           └── SP5 (Effects & Transitions) — needs tools + playback stable
```

## Summary

| Sub-Project | Scope | Key Deliverables |
|-------------|-------|-----------------|
| SP2 | Small | Clean imports, delete old files, rewrite create-timeline.tsx |
| SP3 | Large | PlaybackEngine class, Web Audio mixer, usePlaybackEngine hook, track volume |
| SP4 | Medium | Wire useTimelineDrag, visual feedback, snap improvements, keyboard modifiers |
| SP5 | Large | Clip properties, keyframes, transitions, right panel, playback effects |
