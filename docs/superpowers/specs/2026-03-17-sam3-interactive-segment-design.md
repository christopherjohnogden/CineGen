# SAM 3 Interactive Segmentation Node — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Overview

An interactive segmentation node in the Create tab that uses SAM 3 (local, patched for MPS) to segment objects from images. The node opens a full-screen modal where users can click, draw boxes, or type text prompts to select elements. Segmentation happens instantly on each interaction. Post-processing controls (edge blur, feather, alpha threshold) refine the mask edges. Output is either a single RGBA cutout or multiple layers via the gallery.

---

## Node Definition

### Identity

- **nodeType:** `sam3-segment`
- **name:** `SAM 3 Segment`
- **category:** `image-edit`
- **provider:** `local`
- **outputType:** `image`
- **responseMapping:** `{ path: 'output_path' }`

### Inputs

| id | portType | label | required | fieldType |
|----|----------|-------|----------|-----------|
| `image_url` | image | Image | yes | port |

### Config Params (on-node)

None — all interaction happens in the modal.

### Output

Single output port. When "Accept Selected" is used, outputs one RGBA cutout. When "Accept All" is used, outputs layers via the gallery (same as Layer Decompose).

---

## Python Server

### Location

`~/Desktop/Coding/Sam3/cinegen_server.py` — a FastAPI server added to the existing SAM 3 repo.

### Server Lifecycle

The server is **not** always running. Electron manages its lifecycle:

- **START:** User clicks "Segment" button on the node. Electron spawns the FastAPI process and waits for `/health` to return OK.
- **KEEP ALIVE:** While the modal is open, plus 2 minutes after the modal closes (idle timeout).
- **STOP:** Idle timeout (2 minutes of no requests) OR the node is deleted from the canvas. Electron kills the process.

This keeps SAM 3's ~3GB memory footprint loaded only when actively needed.

### Startup

```bash
~/Desktop/Coding/Sam3/.venv/bin/python ~/Desktop/Coding/Sam3/cinegen_server.py --port <dynamic>
```

Electron picks a random available port and passes it. The server binds to `127.0.0.1` only.

**CORS:** The server must include `CORSMiddleware` allowing all origins, since Electron's renderer makes `fetch()` requests from an `app://` or `file://` origin to `http://127.0.0.1:<port>`:
```python
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```

### Endpoints

#### `GET /health`

Returns `{ "status": "ok", "model_loaded": true }`. Used by Electron to confirm server is ready.

#### `POST /set-image`

Loads an image for segmentation. Must be called before `/segment`.

**Input:**
```json
{ "image_path": "/path/to/image.jpg" }
```
or
```json
{ "image_url": "https://..." }
```

**Output:**
```json
{ "ok": true, "width": 1920, "height": 1080 }
```

The server downloads HTTP URLs to a temp file, loads the image into SAM 3 via `processor.set_image()`, and holds the state in memory.

#### `POST /segment`

Runs segmentation with the given prompt. Each call returns updated masks. The server maintains a `state` dict (initialized by `/set-image`) that is mutated by each prompt call.

**Important:** Text and geometric prompts have different behaviors in SAM 3:
- **Text prompts** (`set_text_prompt`) **replace** the previous text — only one text prompt active at a time
- **Geometric prompts** (`add_geometric_prompt`) **accumulate** — each box/click adds to the existing set
- Text + geometric prompts work together: text provides semantic context, boxes refine spatial selection

**Input (text prompt):**
```json
{ "type": "text", "prompt": "person" }
```
Calls `processor.set_text_prompt(prompt, state)`. Replaces any previous text prompt.

**Input (box prompt):**
```json
{ "type": "box", "box": [0.3, 0.2, 0.4, 0.5], "label": true }
```
Calls `processor.add_geometric_prompt(box, label, state)`. Accumulates with previous boxes. Box format: `[center_x, center_y, width, height]` normalized 0-1. Label `true` = positive (include), `false` = negative (exclude).

**Input (reset):**
```json
{ "type": "reset" }
```
Calls `processor.reset_all_prompts(state)`. Clears all prompts and masks but keeps the image loaded.

**Input (confidence):**
```json
{ "type": "confidence", "threshold": 0.6 }
```
Calls `processor.set_confidence_threshold(threshold, state)`. This re-runs inference — it can change which masks are returned, not just filter existing ones.

**Output:**
```json
{
  "masks": ["data:image/png;base64,...", "data:image/png;base64,..."],
  "boxes": [[x1, y1, x2, y2], ...],
  "scores": [0.94, 0.87, ...]
}
```

Masks are base64-encoded PNG data URIs at the original image resolution. Boxes are in **pixel coordinates** (not normalized) in `[x0, y0, x1, y1]` format — converted by SAM 3's `box_cxcywh_to_xyxy` and scaled to image dimensions.

**Multi-segment model:** SAM 3 returns multiple candidate masks from a single prompt session (typically 1-5). Each mask is a separate detected object/region. The sidebar "Segments" list shows these — clicking one selects it for the overlay. The "+" button resets prompts and starts a new segmentation pass to find additional objects, appending the results to the existing segments list. The frontend maintains a list of finalized segments (each with its own mask) separate from SAM 3's current active state.

#### `POST /postprocess`

Applies post-processing to a specific mask and returns the updated version.

**Input:**
```json
{
  "mask_index": 0,
  "blur": 2,
  "feather": 4,
  "threshold": 0.5
}
```

**Output:**
```json
{ "mask": "data:image/png;base64,..." }
```

#### `POST /extract`

Extracts RGBA cutout layers from the original image using the current masks + post-processing settings. Called when user clicks "Accept".

**Input:**
```json
{
  "mask_indices": [0, 1],
  "blur": 2,
  "feather": 4,
  "threshold": 0.5
}
```

`mask_indices` is which segments to extract. For "Accept Selected" this is `[selectedIndex]`. For "Accept All" this is all indices.

**Output:**
```json
{
  "layers": [
    { "path": "/tmp/sam3-segment-123/00_background.png", "name": "Background", "type": "background", "z_order": 0 },
    { "path": "/tmp/sam3-segment-123/01_person.png", "name": "Person", "type": "element", "z_order": 1 }
  ]
}
```

---

## Segmentation Modal (`sam3-modal.tsx`)

### Layout

Full-screen modal with **canvas + sidebar** layout:

**Left: Image Canvas**
- Tool bar at top: Text | Click | Box mode buttons, Undo, Clear
- Text prompt input bar (visible when Text mode active)
- Large image canvas with mouse interaction
- View toggle at bottom: Original+Mask | Cutout Only | Side by Side

**Right: Sidebar**
- **Segments list** — each detected segment with color swatch, label, confidence score. Clicking selects it. "+" button to add a new segment.
- **Post-Processing** — sliders for Edge Blur, Feather, Alpha Threshold, Confidence
- **Layer preview** — small thumbnail gallery of current segments
- **Action buttons** — Cancel | Accept Selected | Accept All

### Interaction Modes

#### Text Mode
- Text input field is visible at top of canvas
- User types a description (e.g., "person", "logo")
- On Enter/submit, sends `POST /segment { prompt }` to server
- Mask overlay appears instantly on canvas

#### Click Mode
- Cursor becomes a crosshair
- Click on the image sends the click coordinates as a point prompt
- The point is converted to a bounding box: `[click_x / width, click_y / height, 0.01, 0.01]` (tiny box centered on click)
- Or use SAM 3's `add_geometric_prompt` with the point as a small box
- Mask overlay updates instantly

#### Box Mode
- User clicks and drags to draw a bounding box
- On mouseup, the box coordinates are normalized to 0-1 and sent as `POST /segment { box, label: true }`
- Mask overlay updates instantly

### Mask Overlay

- Semi-transparent colored tint over the segmented region
- Each segment gets a distinct color (gold, blue, green, pink, etc.)
- The currently selected segment has a brighter/more opaque tint
- Non-selected segments have a dimmer tint

### View Modes

- **Original + Mask** (default): Source image with colored tint overlay on segments
- **Cutout Only**: Shows just the selected segment's RGBA cutout on a checkerboard transparency background
- **Side by Side**: Original on left, cutout on right

### Accept Flow

**Accept Selected:**
1. Sends `POST /extract { mask_indices: [selectedIndex], blur, feather, threshold }`
2. Server saves one RGBA cutout to temp dir
3. Modal closes
4. Node result is set to the single cutout URL
5. Output port passes this URL to downstream nodes

**Accept All:**
1. Sends `POST /extract { mask_indices: [all], blur, feather, threshold }`
2. Server saves background + all cutouts to temp dir
3. Modal closes
4. Node result is set with `layers` array (layer gallery appears on node)
5. Gallery works same as Layer Decompose — click thumbnails to select output

---

## Electron IPC (`electron/ipc/sam3-server.ts`)

### Server Manager

A dedicated module that manages the SAM 3 server process lifecycle:

```typescript
class Sam3ServerManager {
  private proc: ChildProcess | null;
  private port: number;
  private idleTimer: NodeJS.Timeout | null;

  async start(): Promise<number>;    // Returns port
  async stop(): Promise<void>;       // Kill process
  async ensureRunning(): Promise<number>;  // Start if needed, return port
  isRunning(): boolean;
  resetIdleTimer(): void;            // Reset 2-min countdown
}
```

### IPC Handlers

```typescript
ipcMain.handle('sam3:start', async () => { port = await manager.ensureRunning(); return { port }; });
ipcMain.handle('sam3:stop', async () => { await manager.stop(); });
ipcMain.handle('sam3:port', () => { return { port: manager.port, running: manager.isRunning() }; });
```

The renderer-side modal calls the SAM 3 FastAPI server directly via `fetch('http://localhost:<port>/segment', ...)` — no need to proxy through IPC for the actual segmentation calls since it's localhost HTTP.

### Preload API

```typescript
window.electronAPI.sam3 = {
  start: () => Promise<{ port: number }>;
  stop: () => Promise<void>;
  getPort: () => Promise<{ port: number; running: boolean }>;
};
```

---

## Model Registry Entry

```typescript
'sam3-segment': {
  id: 'sam3-segment',
  nodeType: 'sam3-segment',
  name: 'SAM 3 Segment',
  category: 'image-edit',
  description: 'Interactive segmentation — click, draw, or describe to select elements',
  outputType: 'image',
  provider: 'local',
  responseMapping: { path: 'output_path' },
  inputs: [
    { id: 'image_url', portType: 'image', label: 'Image', required: true, falParam: 'image_url', fieldType: 'port' },
  ],
}
```

No config params on the node — everything is controlled in the modal.

---

## Model Node Changes (`model-node.tsx`)

When `nodeType === 'sam3-segment'`:
- Instead of "Run Model" button, show **"Segment"** button
- Clicking "Segment" triggers `sam3:start` IPC, waits for server ready, then opens the modal
- If the node already has results (layers or single image), show the preview/gallery as usual
- The "Segment" button is always available to re-open the modal and re-segment

---

## Post-Processing Details

All post-processing is done server-side in Python using OpenCV/numpy:

### Edge Blur
```python
blurred_mask = cv2.GaussianBlur(mask, (blur*2+1, blur*2+1), 0)
```

### Feather
```python
# Erode then blur to create gradual alpha falloff at edges
kernel = np.ones((feather*2+1, feather*2+1), np.uint8)
eroded = cv2.erode(mask, kernel)
feathered = cv2.GaussianBlur(eroded, (feather*2+1, feather*2+1), 0)
# Blend: use original mask for interior, feathered for edges
result = np.where(eroded > 0, mask, feathered)
```

### Alpha Threshold
```python
binary_mask = (mask_logits > threshold).astype(np.uint8) * 255
```

### Confidence Threshold
**Separate from post-processing** — this calls `processor.set_confidence_threshold(value, state)` which re-runs SAM 3 inference. It can change which masks are returned, not just filter existing ones. In the UI, changing the confidence slider sends `POST /segment { type: "confidence", threshold }` and receives updated masks.

### Processing Order
Alpha threshold is applied first (to raw logits), then edge blur, then feather.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `~/Desktop/Coding/Sam3/cinegen_server.py` | **Create** — FastAPI server with /set-image, /segment, /postprocess, /extract, /health |
| `src/components/create/sam3-modal.tsx` | **Create** — Full segmentation modal with canvas, toolbar, sidebar |
| `electron/ipc/sam3-server.ts` | **Create** — Server lifecycle manager (spawn/kill/health check) |
| `src/lib/fal/models.ts` | **Modify** — Add `sam3-segment` to `LOCAL_MODEL_REGISTRY` |
| `src/components/create/nodes/model-node.tsx` | **Modify** — Add "Segment" button for `sam3-segment` nodes, open modal |
| `electron/preload.ts` | **Modify** — Expose `sam3.start()`, `sam3.stop()`, `sam3.getPort()` |
| `electron.d.ts` | **Modify** — Type defs for `sam3` IPC methods |
| `src/lib/workflows/execute.ts` | **Modify** — Skip sam3-segment during workflow execution, use pre-existing modal result |
| `src/styles/globals.css` | **Modify** — Modal layout CSS, canvas styles, overlay styles |

---

## Constraints & Edge Cases

- **Server not starting:** If the SAM 3 venv or model weights are missing, show a clear error in the modal: "SAM 3 not installed. Run setup at ~/Desktop/Coding/Sam3".
- **Large images:** SAM 3 internally resizes to 1008x1008 for inference. The canvas displays at whatever size fits the modal. Masks are returned at original resolution.
- **Multiple nodes:** Only one SAM 3 server instance runs at a time. If two sam3-segment nodes exist, they share the same server. The idle timer resets on any request.
- **Memory:** ~3GB for SAM 3 on MPS. Only loaded when the server starts, freed when it stops. No conflict with other local models since they're separate processes.
- **Click precision:** The canvas must track mouse coordinates relative to the image, accounting for CSS scaling. Canvas coordinates are normalized to 0-1 before sending to the server.
- **Undo:** The **server** maintains a prompt stack internally (list of all prompts received). `POST /segment { type: "undo" }` pops the last prompt and replays the remaining ones in a single forward pass. This avoids the frontend needing to track and replay N prompts with N round trips. The server's undo endpoint resets state, replays prompts, and returns updated masks.
- **HuggingFace auth:** SAM 3 model weights require HF authentication. If weights are missing, the server fails to start with a clear error message.
- **execute.ts integration:** The `sam3-segment` node is **interactive-only** — it does not participate in automated workflow execution. In `execute.ts`, if `nodeType === 'sam3-segment'`, skip execution and use any pre-existing result from the modal. If the node has no result yet, set an error: "Open the Segment modal to create a selection."
- **Temp file cleanup:** Output PNGs from `/extract` go to `/tmp/sam3-segment-*/`. Cleaned up when the Electron app closes (same pattern as layer-decompose temp dirs).
- **CSP:** Electron's Content Security Policy must allow `connect-src http://127.0.0.1:*` for the renderer to fetch from the SAM 3 server.
