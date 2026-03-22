# Extend Tool — Design Spec
**Date:** 2026-03-14
**Status:** Approved

---

## Overview

The Extend tool is a new timeline tool that lets users drag the start or end edge of a clip outward into empty space to generate a seamlessly connected AI video extension. It follows the same placeholder → modal → generating → placed clip pattern as the Fill Gap tool.

---

## Interaction Model

### Activation
- Tool icon: `src/assets/extend.svg` (must exist; same import pattern as `fill gap.svg`)
- Tool group: `generate` (alongside Fill Gap)
- Keyboard shortcut: `E`
- Added to `ToolType` union as `'extend'`
- **Shortcut wiring:** The `E` key case must be added to the global `keydown` handler in `edit-tab.tsx` (lines ~414-430, the same handler that dispatches `V`, `B`, `R`, `G`, etc. via `setActiveTool`). Note: `timeline-editor.tsx` has its own `keydown` handler but it only handles `Delete`/`Backspace` — tool shortcuts live in `edit-tab.tsx`.

### Edge Detection
When the extend tool is active, the timeline detects when the mouse is within **8px** of the start or end edge of any clip on a **video track**. A directional cursor is shown (`w-resize` for start edge, `e-resize` for end edge).

**Skip `pendingExtend` placeholders:** Edge detection must check `asset?.metadata?.pendingExtend` — if the clip under the cursor is itself a pending-extend placeholder, no drag is initiated.

### Drag Behavior
- **Start edge drag (leftward):** User mousedowns on the start edge of a clip and drags left. A ghost zone expands leftward showing the extension duration.
  - Placement: `placeholderStartTime = sourceClip.startTime - draggedDuration`
  - `placeholderStartTime` must be clamped to ≥ 0.
- **End edge drag (rightward):** User mousedowns on the end edge of a clip and drags right. A ghost zone expands rightward showing the extension duration.
  - Placement: `placeholderStartTime = sourceClip.startTime + clipEffectiveDuration(sourceClip)`
- **Maximum duration:** 10 seconds (hard cap — drag stops at 10s).
- **Blocked if occupied:** Before starting a drag, check if any existing clip on the same track overlaps the potential zone. If occupied, show `not-allowed` cursor, do not start drag.
- **Minimum duration:** 0.1s — releasing below this threshold cancels with no effect.

### Reference Frame Semantics
The reference frame anchors the generated clip at the cut point for a seamless connection:

| Drag direction | Reference frame extracted from source clip | Passed to model as |
|---|---|---|
| Left from start edge | First frame of source clip (`trimStart`) | **End frame** of generated clip (clip flows *into* source's start) |
| Right from end edge | Last frame of source clip (`trimStart + clipEffectiveDuration`) | **Start frame** of generated clip (clip flows *out of* source's end) |

### Placeholder Placement
On mouse-up (if duration ≥ 0.1s and space is empty):
- A placeholder clip + asset is created (same pattern as fill-gap's `handleAcceptFillGap`)
- Asset metadata flags:
  ```ts
  pendingExtend: true
  extendDirection: 'before' | 'after'
  extendSourceClipId: string   // id of the source clip at drag time
  generating: boolean          // initially false
  ```
- The placeholder renders a **"Generate Extension"** button overlay (label distinct from fill-gap's "Generate AI Fill")
- Clicking "Generate Extension" opens `ExtendModal`
- After placing the placeholder the active tool switches back to `'select'` (same behavior as fill-gap)

---

## ExtendModal

### Props interface
```ts
interface ExtendModalProps {
  clip: Clip;                   // the pending-extend placeholder clip
  asset: Asset;                 // the placeholder's asset (contains metadata)
  sourceClip: Clip;             // the original clip being extended (resolved by extendSourceClipId)
  sourceAsset: Asset;           // the source clip's asset (for frame extraction)
  onStartGeneration: (
    clipId: string,
    generationPromise: Promise<{ url: string; durationSec: number }>,
    label: string,
  ) => void;
  onClose: () => void;
}
```

**Source clip resolution:** `timeline-editor.tsx` resolves `extendSourceClipId` to the actual `Clip` and `Asset` before opening the modal. If the source clip cannot be found (deleted), show an inline error instead of opening the modal and revert the placeholder to non-generating state.

### Layout (mirrors FillGapModal)
1. **Header:** Extend icon, "Extend" title, duration display
2. **Reference frame viewer:** Single frame preview with label:
   - Direction `'after'` → label "End frame" (last frame of source)
   - Direction `'before'` → label "Start frame" (first frame of source)
3. **Model dropdown:** All video models that support a reference image (see model list below). Default: `kie-kling3`.
4. **Prompt textarea:** Free-text prompt; placeholder "Describe what the extension should show..."
5. **Controls:** Cancel / Generate buttons; Cmd+Enter shortcut
6. **Progress bar:** Shown during extracting → uploading → generating phases with phase labels
7. **Error display**

### Supported Models & Duration Options

| Display name | modelId | Valid durations (s) | Reference param — drag right (after) | Reference param — drag left (before) |
|---|---|---|---|---|
| Kling 3.0 | `kie-kling3` | 3, 5, 8, 10, 15 | `image_urls: [frameUrl]` (first frame) | **Not recommended for `'before'`** — use `kling-3-image` instead (see note below) |
| Kling 3 (fal) | `kling-3-image` | 3, 5, 8, 10, 15 | `start_image_url: frameUrl` | `end_image_url: frameUrl` |
| Kling First & Last | `kling-first-last` | 5, 10 | `image_url: frameUrl` | `tail_image_url: frameUrl` |
| Wan 2.2 | `wan-2-2` | Fixed 5s (always pass `num_frames: 81`) | `image_url: frameUrl` | `image_url: frameUrl` |
| Wan 2.6 Flash | `kie-wan` | 5, 10, 15 | `image_urls: [frameUrl]` | `image_urls: [frameUrl]` |
| Seedance 2 | `kie-seedance2` | 4, 5, 8, 12, 15 | `urls: [frameUrl]` | `urls: [frameUrl]` |
| Runway Gen-4 | `kie-runway` | 5, 10 | `imageUrl: frameUrl` | `imageUrl: frameUrl` |
| Sora 2 | `sora-2` | 2–20 (any integer) | `image_url: frameUrl` | `image_url: frameUrl` |
| LTX 2 | `ltx-2-video` | 6, 8, 10 | `image_url: frameUrl` | `image_url: frameUrl` |

**Snap logic:** Extract `snapDuration(sec, validDurations[])` into a shared utility (or inline per model in `extend-modal.tsx`). Snap to smallest option ≥ requested seconds; cap at largest option. For Sora 2 (integer range), use `Math.min(20, Math.max(2, Math.round(sec)))`.

**For models with only a start-frame param (Wan, Seedance, Runway, Sora, LTX):** Always pass the reference frame as the start image. When drag direction is `'before'`, the prompt should be written by the user to describe the backward-extending content — the model will use the reference as its start frame regardless.

**Note — `kie-kling3` and `'before'` direction:**
The kie.ai Kling 3.0 API takes `image_urls[0]` as first frame and `image_urls[1]` as last frame. There is no clean way to pass only a last-frame reference via this API. For `'before'` direction, the dropdown should default to `kling-3-image` (fal), which has an explicit `end_image_url` param. `kie-kling3` remains selectable for `'before'` but will only pass the reference as `image_urls[0]` (first frame) — the prompt must compensate. This is a known limitation and does not need to be solved in this iteration.

**For models with only a start-frame param (Wan, Seedance, Runway, Sora, LTX, and `kie-kling3` in `'before'` mode):** Always pass the reference frame as the single image input regardless of direction.

### Generation Flow
1. Extract reference frame from `sourceAsset` at the correct time:
   - `'after'`: `seekTime = sourceClip.trimStart + clipEffectiveDuration(sourceClip)` (last frame)
   - `'before'`: `seekTime = sourceClip.trimStart` (first frame)
2. Upload frame blob via `window.electronAPI.elements.upload`
3. Build model inputs per the table above (model-specific param names + direction)
4. Call `window.electronAPI.workflow.run({ modelId, inputs, ... })`
5. Hand off promise via `onStartGeneration(placeholderClip.id, promise, label)`
6. Modal closes; placeholder shows generating animation
7. On resolve: `timeline-editor.tsx` replaces placeholder with real clip asset (same pattern as `handleFillGapStartGeneration`)

---

## Placeholder & Generating States

### Visual states in `clip-card.tsx`
Add `isPendingExtend` check alongside existing `isPendingFillGap`:
```ts
const isPendingExtend = !!asset?.metadata?.pendingExtend;
const isGenerating = !!asset?.metadata?.generating;
```
- `isPendingExtend && !isGenerating`: renders **"Generate Extension"** button overlay (same CSS class as fill-gap pending — `clip-card--pending-music` or equivalent)
- `isPendingExtend && isGenerating`: renders shimmer/pulse animation (same as fill-gap generating state)

---

## `handleAcceptExtend` in `timeline-editor.tsx`

When user releases drag with valid duration:
1. Create placeholder asset with `metadata.pendingExtend = true`, `extendDirection`, `extendSourceClipId`, `generating = false`
2. Create placeholder clip at computed `startTime` and `effectiveDuration = draggedDuration`
3. Dispatch both to project state (same as `handleAcceptFillGap`)
4. Set `activeTool` back to `'select'`

## `handleExtendStartGeneration` in `timeline-editor.tsx`

Same pattern as `handleFillGapStartGeneration`:
1. Set `asset.metadata.generating = true` on the placeholder
2. Await the generation promise
3. On success: create real asset from returned URL, replace placeholder clip with real clip
4. On failure: set `asset.metadata.generating = false`, keep placeholder for retry

---

## Files to Create / Modify

| File | Change |
|---|---|
| `src/types/timeline.ts` | Add `'extend'` to `ToolType` union |
| `src/components/edit/tool-sidebar.tsx` | Add extend tool: `extend.svg` icon, shortcut `E`, group `generate` |
| `src/components/edit/extend-modal.tsx` | New file — ExtendModal component |
| `src/components/edit/edit-tab.tsx` | Add `e`/`E` case to the `keydown` shortcut handler (alongside existing `g`/`G` → fillGap) |
| `src/components/edit/timeline-editor.tsx` | (1) Edge detection; (2) drag state + ghost preview; (3) blocked-if-occupied check; (4) `handleAcceptExtend`; (5) `handleExtendStartGeneration`; (6) render ExtendModal when `pendingExtend && !generating` placeholder is clicked |
| `src/components/edit/clip-card.tsx` | Add `isPendingExtend` check; render "Generate Extension" button + generating shimmer |
| `src/styles/globals.css` | `.em__*` modal CSS (mirrors `.fgm__*`); ghost zone CSS for drag preview |

---

## Constraints & Edge Cases

- **Video tracks only:** No effect on audio tracks. Edge detection ignores audio-track clips.
- **Empty space only:** Blocked if occupied. No ripple/push.
- **Hard 10s cap:** Drag stops at 10s.
- **No nested extends:** `pendingExtend` placeholder clips are skipped by edge detection.
- **Source clip deleted before Generate:** If `extendSourceClipId` doesn't resolve at modal-open time, show error inline, do not open modal, revert placeholder to non-generating.
- **Cancellation:** Closing modal or Escape removes the placeholder clip+asset from state (same as fill-gap cancel).
- **On generation failure:** `generating = false` is restored; placeholder stays for retry.
- **`extend.svg` asset:** Must exist at `src/assets/extend.svg`. If missing, build fails. The SVG should be a 24×24 icon suggesting outward extension (arrows pointing outward from a clip edge).
- **In-progress cancellation:** `ExtendModal` must follow the same `AbortController` / `abortRef` pattern as `FillGapModal` — store a ref to the controller, abort on Escape / backdrop click / Cancel button. The generation promise itself is not abortable (it's in-flight with the API) but frame extraction and upload steps should respect the abort signal.
