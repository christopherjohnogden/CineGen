# Layer Decompose Node — Design Spec

**Date:** 2026-03-15
**Status:** Approved

---

## Overview

A "Layer Decompose" node in the Create tab that takes a flat raster image and decomposes it into separate, editable RGBA layers using SAM 3 for segmentation, PaddleOCR for text detection, and configurable inpainting (Qwen Image Edit or LaMa) for background reconstruction. The node displays results as a gallery of layers, with the selected layer passed to the output port.

---

## Node Definition

### Identity

- **nodeType:** `layer-decompose`
- **name:** `Layer Decompose`
- **category:** `image-edit`
- **provider:** `local`
- **outputType:** `image`
- **responseMapping:** `{ path: 'output_path' }`

### Inputs

| id | portType | label | required | fieldType | notes |
|----|----------|-------|----------|-----------|-------|
| `image_url` | image | Image | yes | port | The image to decompose |
| `prompts` | text | Prompts | no | textarea | Comma-separated SAM 3 text prompts (e.g., "person, logo, mountain"). If empty, SAM 3 auto-segments. Also accepts port connection for dynamic prompts. |

### Config Params (on-node)

| id | label | fieldType | default | options |
|----|-------|-----------|---------|---------|
| `inpainter` | Inpainter | select | `qwen-edit-local` | `qwen-edit-local` (Qwen Edit Local), `qwen-edit-cloud` (Qwen Edit Cloud / fal.ai), `qwen-edit-runpod` (Qwen Edit RunPod), `lama` (LaMa Fast) |
| `reconstruct_bg` | Reconstruct Background | toggle | `true` | — |
| `seed` | Seed | number | `42` | — |

### Output

Single output port. Outputs the `local-media://` URL of the **currently selected layer** in the gallery.

### Inspector Panel

- **Export format:** dropdown — `PNGs`, `PSD`, `Both` (default: `Both`)
- **Export button:** saves all layers to a user-chosen directory

---

## Python Pipeline

### Location

`~/Desktop/Coding/layer-decompose/` — separate repo, same pattern as `~/Desktop/Coding/ltx/` and `~/Desktop/Coding/qwen-edit/`.

### Script

`cinegen_infer.py` — single entry point, same JSON-line stdout protocol as LTX and Qwen Edit.

### CLI Arguments

| arg | type | required | default | description |
|-----|------|----------|---------|-------------|
| `--image_path` | str | yes | — | Path to input image |
| `--prompts` | str | no | `""` | Comma-separated segmentation prompts |
| `--inpainter` | str | no | `none` | `lama` or `none` (Qwen inpainting handled by Electron, not Python) |
| `--seed` | int | no | `42` | Seed for reproducibility |
| `--output_dir` | str | no | system temp | Directory for output layers |

Note: The Python script only handles LaMa inpainting in-process. Qwen Edit inpainting (local, cloud, RunPod) is handled by the Electron IPC handler after the Python script completes. See the "Two-Phase Execution" section below.

### Pipeline Steps (Precision Mode)

The Python script handles steps 1-4 (and optionally step 5 for LaMa only):

```
Input Image
  │
  ├─→ 1. PaddleOCR  →  text regions + bounding boxes + extracted text
  │
  ├─→ 2. SAM 3 (auto or text-prompted)  →  element masks
  │       (text regions from step 1 passed as exclude_masks)
  │
  ├─→ 3. Mask Composition  →  deduplicate, assign z-order, merge overlaps
  │
  ├─→ 4. Layer Extraction  →  cut each element from original as RGBA
  │
  ├─→ 5a. LaMa Inpainting (if --inpainter lama)
  │        Runs in-process via simple-lama
  │        Input: original image + combined foreground mask
  │        Output: clean background RGBA layer
  │
  └─→ 6. Output  →  save all layers + combined_mask.png to output_dir
```

### Progress Messages

```json
{"type": "progress", "stage": "ocr", "message": "Detecting text regions…"}
{"type": "progress", "stage": "segmentation", "message": "Segmenting elements (SAM 3)…"}
{"type": "progress", "stage": "masks", "message": "Compositing masks…"}
{"type": "progress", "stage": "extraction", "message": "Extracting layers…"}
{"type": "progress", "stage": "inpainting", "message": "Reconstructing background (LaMa)…"}
{"type": "progress", "stage": "saving", "message": "Saving 6 layers…"}
```

### Done Message

```json
{
  "type": "done",
  "output_path": "/tmp/layer-decompose-1234/00_background.png",
  "combined_mask_path": "/tmp/layer-decompose-1234/combined_mask.png",
  "needs_inpainting": true,
  "layers": [
    {
      "path": "/tmp/layer-decompose-1234/00_background.png",
      "name": "Background",
      "type": "background",
      "z_order": 0
    },
    {
      "path": "/tmp/layer-decompose-1234/01_text_sunday_sermon.png",
      "name": "Text: SUNDAY SERMON",
      "type": "text",
      "z_order": 1,
      "metadata": {
        "text": "SUNDAY SERMON",
        "confidence": 0.97,
        "bbox": [[100, 50], [500, 50], [500, 120], [100, 120]]
      }
    },
    {
      "path": "/tmp/layer-decompose-1234/02_photo_person.png",
      "name": "Photo 1",
      "type": "photograph",
      "z_order": 2,
      "metadata": {"confidence": 0.94}
    }
  ]
}
```

- `output_path` points to the background layer (either LaMa-inpainted or raw with holes)
- `combined_mask_path` is the merged foreground mask — used by the Electron IPC handler for Qwen Edit inpainting
- `needs_inpainting` is `true` when the Python script did not handle inpainting (i.e., Qwen was selected). `false` when LaMa already ran or `reconstruct_bg` is off.
- `layers` is the full array for the gallery UI

### Output Directory Structure

```
/tmp/layer-decompose-<timestamp>/
├── 00_background.png          # raw or LaMa-inpainted background
├── 01_text_sunday_sermon.png
├── 02_text_join_us.png
├── 03_photo_person.png
├── 04_logo_church.png
├── combined_mask.png           # merged foreground mask (for Qwen inpainting)
├── metadata.json
```

---

## Two-Phase Execution

Background inpainting is split into two phases to keep provider routing in TypeScript where it already exists.

### Phase 1: Python Script (segmentation + extraction)

The Python script runs SAM 3, PaddleOCR, mask composition, and layer extraction. If `--inpainter lama` is passed, it also runs LaMa inpainting in-process. Otherwise it outputs the raw background (with holes) and the `combined_mask.png` for the next phase.

### Phase 2: Electron IPC Handler (Qwen inpainting)

When `needs_inpainting` is `true` in the done message, the IPC handler runs the inpainting step using the selected provider:

| Inpainter option | Provider | How it runs |
|-----------------|----------|-------------|
| `qwen-edit-local` | local | Spawns `~/Desktop/Coding/qwen-edit/.venv/bin/python cinegen_infer.py` with the masked image + inpainting prompt |
| `qwen-edit-cloud` | fal | Calls `window.electronAPI.workflow.run()` with model `fal-ai/qwen-image-edit-2511`, passing the masked image URL + prompt |
| `qwen-edit-runpod` | runpod | Calls `window.electronAPI.workflow.run()` with the Qwen RunPod endpoint, passing the masked image + prompt |
| `lama` | (in Python) | Already handled in Phase 1 — `needs_inpainting` is `false` |

**IPC handler flow for Qwen inpainting:**

1. Python script completes → `done` message with `needs_inpainting: true` and `combined_mask_path`
2. IPC handler reads the original image and combined mask
3. Creates a masked version (foreground regions painted neutral)
4. Routes to the selected Qwen provider:
   - **Local:** spawns qwen-edit subprocess, reads output path from stdout JSON
   - **Cloud (fal.ai):** uploads masked image, calls fal API, downloads result to temp file
   - **RunPod:** uploads masked image, calls RunPod endpoint, downloads result to temp file
5. Saves the inpainted result as the new `00_background.png` in the output directory
6. Updates the layers array with the new background path
7. Forwards the final `done` message with the complete layers array to the renderer

The inpainting prompt used for all Qwen providers: `"reconstruct the background behind the removed elements, maintain the style and context of the surrounding image"`

---

## Electron Integration

### IPC Handler (`electron/ipc/local-models.ts`)

New branch for `params.nodeType === 'layer-decompose'`:

- Resolves `image_url` via `resolveImageUrl` helper
- Determines inpainter mode from `inputs.inpainter`:
  - If `lama`: passes `--inpainter lama` to Python script (handled in-process)
  - If any `qwen-edit-*` variant: passes `--inpainter none` to Python script (Phase 2 handles it)
  - If `reconstruct_bg` is off: passes `--inpainter none` (no inpainting at all)
- Passes args: `--image_path`, `--prompts`, `--inpainter`, `--seed`
- On `done` message: checks `needs_inpainting` flag
  - If `true`: runs Phase 2 Qwen inpainting (see Two-Phase Execution above), then forwards final layers
  - If `false`: forwards layers directly
- Forwards `layers` array from the `done` message (not just `output_path`)

### IPC Stdout Parser Changes (`electron/ipc/local-models.ts`)

The existing JSON parse types the message as `{ type, stage?, message?, output_path?, error? }`. This type assertion must be extended to include `layers?`:

```typescript
const msg = JSON.parse(trimmed) as {
  type: string;
  stage?: string;
  message?: string;
  output_path?: string;
  error?: string;
  layers?: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
};
```

The `done` handler must forward `layers` alongside `output_path`:

```typescript
} else if (msg.type === 'done') {
  job.status = 'done';
  job.outputPath = msg.output_path;
  sendProgress(jobId, { type: 'done', output_path: msg.output_path, ...(msg.layers && { layers: msg.layers }) });
}
```

### Type Definitions (`electron.d.ts`)

The `onProgress` callback data type must be extended to include the optional `layers` field:

```typescript
data: {
  jobId: string;
  type: 'status' | 'progress' | 'done' | 'error';
  stage?: string;
  message?: string;
  output_path?: string;
  error?: string;
  layers?: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
}
```

### Execution Pipeline (`src/lib/workflows/execute.ts`)

In the `provider === 'local'` branch, the `done` handler (line ~405) currently does:

```typescript
result = { output_path: data.output_path };
```

Change to also capture layers:

```typescript
result = { output_path: data.output_path, ...(data.layers && { layers: data.layers }) };
```

Then in the result-handling block (after line ~434), after computing the primary `url`, check for layers and convert paths:

```typescript
if ((result as any).layers) {
  const layers: LayerInfo[] = (result as any).layers.map((l: any) => ({
    url: l.path.startsWith('/') ? `local-media://file${l.path}` : l.path,
    name: l.name,
    type: l.type,
    z_order: l.z_order,
    metadata: l.metadata,
  }));
  dispatch.setNodeResult(nodeId, { status: 'complete', url, layers, selectedLayerIndex: 0 });
} else {
  dispatch.setNodeResult(nodeId, { status: 'complete', url });
}
```

This uses the existing `setNodeResult` method — no new dispatch method needed. The `layers` and `selectedLayerIndex` fields are added to the result type.

### Node Data Type (`src/types/workflow.ts`)

Add `LayerInfo` interface and extend the node result type:

```typescript
interface LayerInfo {
  url: string;           // local-media:// URL
  name: string;          // display name
  type: string;          // "background", "text", "photograph", etc.
  z_order: number;
  metadata?: Record<string, unknown>;
}
```

Add to the node result type: `layers?: LayerInfo[]` and `selectedLayerIndex?: number`.

### Layer Selection & Downstream Propagation

When the user clicks a layer thumbnail, the node updates `data.result.selectedLayerIndex` and `data.result.url` via `updateNodeData`. This updates the output URL that downstream nodes read.

**Downstream re-execution is NOT automatic.** Changing the selected layer updates the node's output URL in ReactFlow state, but downstream nodes keep their previous results. The user must re-run downstream nodes manually (click Run on them) to pick up the new layer. This matches the existing behavior — changing a prompt on an upstream node does not auto-re-run downstream nodes either. The output URL is always "live" for the next execution.

### Model Node UI (`src/components/create/nodes/model-node.tsx`)

When `data.result?.layers` exists on a node, render a **layer gallery** within the preview section (above the main preview image, below the node header):

1. **Thumbnail strip** — horizontal row of small thumbnails (one per layer), scrollable if many layers. Each thumbnail is ~48x48px with 4px gap.
2. **Selection** — clicking a thumbnail:
   - Highlights it (border accent color)
   - Updates `data.result.url` to the selected layer's URL (via `updateNodeData`)
   - Updates `data.result.selectedLayerIndex`
   - The main preview area re-renders to show the selected layer full-size
3. **Layer labels** — each thumbnail shows the layer name below it (truncated to ~8 chars)
4. **Default selection** — index 0 (first layer) is selected by default

Total node height grows ~60px to accommodate the thumbnail strip.

### Progress Bar Percentage Mapping

The progress bar maps stage names to approximate percentages:

| Stage | Percentage |
|-------|-----------|
| `ocr` | 10% |
| `segmentation` | 40% |
| `masks` | 50% |
| `extraction` | 60% |
| `inpainting` | 80% |
| `saving` | 95% |

---

## Setup & Dependencies

### `~/Desktop/Coding/layer-decompose/setup.sh`

```
python3 -m venv .venv
pip install torch torchvision
pip install transformers          # SAM 3 via HuggingFace
pip install paddlepaddle paddleocr  # OCR
pip install simple-lama           # lightweight inpainting fallback
pip install pillow numpy opencv-python  # mask operations
pip install psd-tools             # PSD export
```

SAM 3 weights auto-download on first run (~750MB via HuggingFace). PaddleOCR and LaMa also auto-download their weights. No manual model download step needed.

**Qwen Edit** is not part of this venv at all. Qwen inpainting (local, cloud, or RunPod) is handled entirely by the Electron IPC handler after the Python script completes. The Python script only handles LaMa inpainting in-process.

### Disk Usage

- SAM 3 weights: ~750MB
- PaddleOCR: ~15MB
- LaMa: ~27MB
- Venv + deps: ~1.5GB
- **Total: ~2-3GB** (vs 57GB for Qwen Edit)

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `~/Desktop/Coding/layer-decompose/setup.sh` | **Create** — venv + deps |
| `~/Desktop/Coding/layer-decompose/cinegen_infer.py` | **Create** — pipeline script |
| `src/lib/fal/models.ts` | **Modify** — add `layer-decompose` to `LOCAL_MODEL_REGISTRY` |
| `electron/ipc/local-models.ts` | **Modify** — add layer-decompose routing, extend stdout parser type to include `layers`/`needs_inpainting`/`combined_mask_path`, implement Phase 2 Qwen inpainting (local/cloud/runpod), forward layers in `done` message |
| `electron/ipc/workflows.ts` | **Modify** — expose inpainting helper that the layer-decompose handler can call for cloud/RunPod Qwen Edit (reuses existing `generateWithFal` / `generateWithRunpod` functions) |
| `electron.d.ts` | **Modify** — extend `onProgress` data type to include optional `layers` field |
| `src/lib/workflows/execute.ts` | **Modify** — capture `layers` from done event, convert paths to `local-media://` URLs, pass to `setNodeResult` |
| `src/components/create/nodes/model-node.tsx` | **Modify** — add layer gallery UI (thumbnail strip + selection) |
| `src/types/workflow.ts` | **Modify** — add `LayerInfo` interface, add `layers` + `selectedLayerIndex` to node result type |
| `src/styles/globals.css` | **Modify** — gallery thumbnail strip CSS |

---

## Constraints & Edge Cases

- **No text detected:** PaddleOCR returns empty — pipeline continues with SAM 3 segmentation only.
- **No elements detected:** SAM 3 returns empty — node outputs the original image as a single "Background" layer.
- **Qwen Edit Local not installed:** If user selects `qwen-edit-local` but `~/Desktop/Coding/qwen-edit/.venv` doesn't exist, fall back to LaMa with a progress message: "Qwen Edit Local not found, using LaMa."
- **Cloud/RunPod API keys missing:** If user selects `qwen-edit-cloud` or `qwen-edit-runpod` but the corresponding API key is not configured in settings, fall back to LaMa with a progress message.
- **Cloud/RunPod inpainting needs image upload:** For cloud and RunPod Qwen inpainting, the masked image must be uploaded to a URL the API can access. The IPC handler uses the existing upload mechanism (same as element uploads) to get a temporary URL.
- **Very large images:** SAM 3 handles up to ~4K. If input is larger, auto-downscale before segmentation, then upscale masks back to original resolution for extraction.
- **Overlapping segments:** Mask composition step deduplicates — if SAM 3 produces overlapping masks, the higher-confidence mask takes priority in the overlap zone.
- **Memory:** SAM 3 (~3GB) + PaddleOCR (<1GB) + LaMa (<1GB) fits comfortably in 128GB. If Qwen Edit is selected for inpainting, it runs as a separate process (loads its own ~40GB).
- **PSD export:** Available via inspector panel only. Uses `psd-tools` to assemble layers with names, groups, and z-order. Not part of the default node output — it's an explicit export action.
- **`reconstruct_bg` CLI flag:** The IPC handler conditionally appends `--reconstruct_bg` as a presence flag (not `--reconstruct_bg true`). When the toggle is off, the flag is omitted entirely.
- **Temp directory cleanup:** Layer output directories in `/tmp/layer-decompose-*/` are cleaned up when the Electron app closes (registered in the `app.on('before-quit')` handler). During a session, previous decomposition outputs persist so the user can switch between layers without re-running.
- **Inspector panel:** Scoped as future work for Phase 2. The core node ships with the gallery UI and standard output port. PSD export and format selection will be added when the inspector panel infrastructure is built out.
