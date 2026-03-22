# SAM 3 Interactive Segmentation Node Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive SAM 3 segmentation node that opens a full-screen modal with click/box/text prompts, instant mask preview, post-processing controls, and multi-layer output.

**Architecture:** A FastAPI server (`cinegen_server.py`) in the SAM 3 repo loads the model on demand and serves segmentation requests via HTTP. Electron manages the server lifecycle (spawn/kill/health). The React modal (`sam3-modal.tsx`) renders an interactive canvas with tool modes, sidebar controls, and mask overlays. Results flow to the node's layer gallery.

**Tech Stack:** Python (FastAPI, uvicorn, SAM 3, OpenCV, numpy, PIL), TypeScript/React (Electron IPC, canvas mouse events, CSS modal)

**Spec:** `docs/superpowers/specs/2026-03-17-sam3-interactive-segment-design.md`

---

## Chunk 1: Python FastAPI Server

### Task 1: Create the FastAPI server

**Files:**
- Create: `~/Desktop/Coding/Sam3/cinegen_server.py`

- [ ] **Step 1: Write cinegen_server.py**

```python
#!/usr/bin/env python3
"""CineGen SAM 3 segmentation server — FastAPI + uvicorn."""

import argparse
import base64
import io
import os
import sys
import tempfile
import time
import threading

import cv2
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel
from typing import Optional, List

# ── SAM 3 imports ───────────────────────────────────────────
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

# ── App setup ───────────────────────────────────────────────
app = FastAPI(title="CineGen SAM 3 Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Global state ────────────────────────────────────────────
processor: Sam3Processor | None = None
state: dict | None = None
original_image: Image.Image | None = None
prompt_stack: list[dict] = []   # For undo support
idle_timer: threading.Timer | None = None
IDLE_TIMEOUT = 120  # seconds

def reset_idle_timer():
    global idle_timer
    if idle_timer:
        idle_timer.cancel()
    idle_timer = threading.Timer(IDLE_TIMEOUT, lambda: os._exit(0))
    idle_timer.daemon = True
    idle_timer.start()

# ── Models ──────────────────────────────────────────────────

class SetImageRequest(BaseModel):
    image_path: Optional[str] = None
    image_url: Optional[str] = None

class SegmentRequest(BaseModel):
    type: str  # "text", "box", "reset", "confidence", "undo"
    prompt: Optional[str] = None
    box: Optional[List[float]] = None
    label: Optional[bool] = True
    threshold: Optional[float] = None

class PostprocessRequest(BaseModel):
    mask_index: int
    blur: int = 2
    feather: int = 4
    threshold: float = 0.5

class ExtractRequest(BaseModel):
    mask_indices: List[int]
    blur: int = 2
    feather: int = 4
    threshold: float = 0.5

# ── Helpers ─────────────────────────────────────────────────

def mask_to_base64(mask: np.ndarray) -> str:
    """Convert a binary mask (H,W) to base64 PNG data URI."""
    img = Image.fromarray((mask * 255).astype(np.uint8) if mask.max() <= 1 else mask)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"

def apply_postprocess(mask_logits: torch.Tensor, blur: int, feather: int, threshold: float) -> np.ndarray:
    """Apply threshold, blur, and feather to mask logits."""
    # Threshold
    binary = (mask_logits > threshold).cpu().numpy().astype(np.uint8) * 255

    # Edge blur
    if blur > 0:
        ksize = blur * 2 + 1
        binary = cv2.GaussianBlur(binary, (ksize, ksize), 0)

    # Feather
    if feather > 0:
        ksize = feather * 2 + 1
        kernel = np.ones((ksize, ksize), np.uint8)
        eroded = cv2.erode(binary, kernel)
        feathered = cv2.GaussianBlur(eroded, (ksize, ksize), 0)
        binary = np.where(eroded > 0, binary, feathered)

    return binary

def replay_prompts():
    """Replay the prompt stack on current state (for undo)."""
    global state
    if processor is None or state is None:
        return
    processor.reset_all_prompts(state)
    for p in prompt_stack:
        if p["type"] == "text":
            state = processor.set_text_prompt(p["prompt"], state)
        elif p["type"] == "box":
            state = processor.add_geometric_prompt(p["box"], p["label"], state)
        elif p["type"] == "confidence":
            state = processor.set_confidence_threshold(p["threshold"], state)

def get_current_results() -> dict:
    """Extract masks, boxes, scores from current state."""
    if state is None or "masks" not in state:
        return {"masks": [], "boxes": [], "scores": []}

    masks = state["masks"]  # (N, 1, H, W) bool tensor
    boxes = state.get("boxes", torch.tensor([]))  # (N, 4) pixel coords
    scores = state.get("scores", torch.tensor([]))  # (N,) float

    mask_list = []
    for i in range(masks.shape[0]):
        m = masks[i].squeeze().cpu().numpy()
        mask_list.append(mask_to_base64(m))

    box_list = boxes.cpu().tolist() if boxes.numel() > 0 else []
    score_list = scores.cpu().tolist() if scores.numel() > 0 else []

    return {"masks": mask_list, "boxes": box_list, "scores": score_list}

# ── Endpoints ───────────────────────────────────────────────

@app.get("/health")
def health():
    reset_idle_timer()
    return {"status": "ok", "model_loaded": processor is not None}

@app.post("/set-image")
async def set_image(req: SetImageRequest):
    global processor, state, original_image, prompt_stack
    reset_idle_timer()

    if not req.image_path and not req.image_url:
        raise HTTPException(400, "Provide image_path or image_url")

    path = req.image_path
    if req.image_url:
        import urllib.request
        ext = os.path.splitext(req.image_url.split("?")[0])[-1] or ".jpg"
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        urllib.request.urlretrieve(req.image_url, tmp.name)
        path = tmp.name

    if not path or not os.path.isfile(path):
        raise HTTPException(400, f"Image not found: {path}")

    original_image = Image.open(path).convert("RGB")
    w, h = original_image.size

    # Load model if needed
    if processor is None:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        script_dir = os.path.dirname(os.path.abspath(__file__))
        bpe_path = os.path.join(script_dir, "sam3", "assets", "bpe_simple_vocab_16e6.txt.gz")
        model = build_sam3_image_model(bpe_path=bpe_path)
        model = model.to(device)
        processor = Sam3Processor(model, device=device)

    state = processor.set_image(original_image)
    prompt_stack = []

    return {"ok": True, "width": w, "height": h}

@app.post("/segment")
async def segment(req: SegmentRequest):
    global state, prompt_stack
    reset_idle_timer()

    if processor is None or state is None:
        raise HTTPException(400, "Call /set-image first")

    if req.type == "text":
        if not req.prompt:
            raise HTTPException(400, "Text prompt required")
        prompt_stack.append({"type": "text", "prompt": req.prompt})
        state = processor.set_text_prompt(req.prompt, state)

    elif req.type == "box":
        if not req.box or len(req.box) != 4:
            raise HTTPException(400, "Box must be [cx, cy, w, h]")
        prompt_stack.append({"type": "box", "box": req.box, "label": req.label})
        state = processor.add_geometric_prompt(req.box, req.label, state)

    elif req.type == "reset":
        prompt_stack = []
        processor.reset_all_prompts(state)
        return {"masks": [], "boxes": [], "scores": []}

    elif req.type == "confidence":
        if req.threshold is None:
            raise HTTPException(400, "Threshold required")
        state = processor.set_confidence_threshold(req.threshold, state)

    elif req.type == "undo":
        if prompt_stack:
            prompt_stack.pop()
            replay_prompts()
        else:
            return {"masks": [], "boxes": [], "scores": []}

    else:
        raise HTTPException(400, f"Unknown type: {req.type}")

    return get_current_results()

@app.post("/postprocess")
async def postprocess(req: PostprocessRequest):
    reset_idle_timer()
    if state is None or "masks_logits" not in state:
        raise HTTPException(400, "No masks available")

    logits = state["masks_logits"]
    if req.mask_index >= logits.shape[0]:
        raise HTTPException(400, f"Mask index {req.mask_index} out of range")

    mask_logit = logits[req.mask_index].squeeze()
    processed = apply_postprocess(mask_logit, req.blur, req.feather, req.threshold)
    return {"mask": mask_to_base64(processed)}

@app.post("/extract")
async def extract(req: ExtractRequest):
    reset_idle_timer()
    if state is None or "masks_logits" not in state or original_image is None:
        raise HTTPException(400, "No masks or image available")

    logits = state["masks_logits"]
    img_array = np.array(original_image)
    out_dir = os.path.join(tempfile.gettempdir(), f"sam3-segment-{int(time.time())}")
    os.makedirs(out_dir, exist_ok=True)

    layers = []
    combined_mask = np.zeros((img_array.shape[0], img_array.shape[1]), dtype=np.uint8)

    for i, idx in enumerate(req.mask_indices):
        if idx >= logits.shape[0]:
            continue
        mask_logit = logits[idx].squeeze()
        processed = apply_postprocess(mask_logit, req.blur, req.feather, req.threshold)

        # Accumulate for background
        combined_mask = np.maximum(combined_mask, processed)

        # RGBA cutout
        rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
        rgba[:, :, :3] = img_array
        rgba[:, :, 3] = processed
        cutout = Image.fromarray(rgba)

        name = f"segment_{i}"
        if "scores" in state and idx < state["scores"].shape[0]:
            score = float(state["scores"][idx])
            name = f"segment_{i}_{int(score*100)}"

        filepath = os.path.join(out_dir, f"{i+1:02d}_{name}.png")
        cutout.save(filepath)
        layers.append({
            "path": filepath,
            "name": f"Segment {i+1}",
            "type": "element",
            "z_order": i + 1,
        })

    # Background: original with holes where segments were
    bg_rgba = np.zeros((img_array.shape[0], img_array.shape[1], 4), dtype=np.uint8)
    bg_rgba[:, :, :3] = img_array
    bg_rgba[:, :, 3] = 255 - combined_mask
    bg_path = os.path.join(out_dir, "00_background.png")
    Image.fromarray(bg_rgba).save(bg_path)
    layers.insert(0, {
        "path": bg_path,
        "name": "Background",
        "type": "background",
        "z_order": 0,
    })

    return {"layers": layers}

# ── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    reset_idle_timer()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
```

- [ ] **Step 2: Install FastAPI deps in Sam3 venv**

```bash
cd ~/Desktop/Coding/Sam3
.venv/bin/pip install fastapi uvicorn
```

- [ ] **Step 3: Test server standalone**

```bash
cd ~/Desktop/Coding/Sam3
.venv/bin/python cinegen_server.py --port 8765 &
sleep 5
curl http://127.0.0.1:8765/health
# Expected: {"status":"ok","model_loaded":false}
kill %1
```

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/Coding/Sam3
git add cinegen_server.py
git commit -m "feat: add CineGen FastAPI segmentation server"
```

---

## Chunk 2: Electron IPC — Server Lifecycle

### Task 2: Create SAM 3 server manager

**Files:**
- Create: `electron/ipc/sam3-server.ts`

- [ ] **Step 1: Write sam3-server.ts**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const SAM3_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'Sam3');
const SAM3_PYTHON = path.join(SAM3_REPO, '.venv', 'bin', 'python');
const SAM3_SCRIPT = path.join(SAM3_REPO, 'cinegen_server.py');

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_MAX_ATTEMPTS = 60; // 30 seconds max wait for startup

class Sam3ServerManager {
  private proc: ChildProcess | null = null;
  private port = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  async start(): Promise<number> {
    if (this.proc && !this.proc.killed) {
      return this.port;
    }

    this.port = await this.findFreePort();
    console.log(`[sam3] Starting server on port ${this.port}`);

    this.proc = spawn(SAM3_PYTHON, [SAM3_SCRIPT, '--port', String(this.port)], {
      cwd: SAM3_REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', () => {}); // suppress
    this.proc.stderr?.on('data', () => {}); // suppress

    this.proc.on('exit', (code) => {
      console.log(`[sam3] Server exited with code ${code}`);
      this.proc = null;
    });

    // Wait for health endpoint
    await this.waitForHealth();
    this.resetIdleTimer();

    console.log('[sam3] Server ready');
    return this.port;
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.proc && !this.proc.killed) {
      console.log('[sam3] Stopping server');
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  async ensureRunning(): Promise<number> {
    if (this.isRunning()) {
      this.resetIdleTimer();
      return this.port;
    }
    return this.start();
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  getPort(): number {
    return this.port;
  }

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log('[sam3] Idle timeout — stopping server');
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error('Could not find free port'));
        }
      });
    });
  }

  private async waitForHealth(): Promise<void> {
    for (let i = 0; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (res.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    throw new Error('SAM 3 server failed to start within 30 seconds');
  }
}

const manager = new Sam3ServerManager();

export function registerSam3Handlers(): void {
  ipcMain.handle('sam3:start', async () => {
    const port = await manager.ensureRunning();
    return { port };
  });

  ipcMain.handle('sam3:stop', async () => {
    await manager.stop();
  });

  ipcMain.handle('sam3:port', () => {
    return { port: manager.getPort(), running: manager.isRunning() };
  });
}

export function stopSam3Server(): void {
  manager.stop();
}
```

- [ ] **Step 2: Register handlers in main process**

In the main Electron entry file (where `registerLocalModelHandlers()` is called), add:

```typescript
import { registerSam3Handlers, stopSam3Server } from './ipc/sam3-server';

// In the app startup:
registerSam3Handlers();

// In app.on('before-quit'):
stopSam3Server();
```

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/sam3-server.ts
git commit -m "feat: add SAM 3 server lifecycle manager"
```

---

### Task 3: Expose SAM 3 IPC in preload + types

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron.d.ts`

- [ ] **Step 1: Add sam3 to preload.ts**

In the `electronAPI` object exposed via `contextBridge`:

```typescript
sam3: {
  start: () => ipcRenderer.invoke('sam3:start'),
  stop: () => ipcRenderer.invoke('sam3:stop'),
  getPort: () => ipcRenderer.invoke('sam3:port'),
},
```

- [ ] **Step 2: Add sam3 types to electron.d.ts**

In the `ElectronAPI` interface:

```typescript
sam3: {
  start: () => Promise<{ port: number }>;
  stop: () => Promise<void>;
  getPort: () => Promise<{ port: number; running: boolean }>;
};
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts electron.d.ts
git commit -m "feat: expose SAM 3 server IPC in preload and types"
```

---

## Chunk 3: Model Registry + execute.ts

### Task 4: Add model registry entry

**Files:**
- Modify: `src/lib/fal/models.ts`

- [ ] **Step 1: Add sam3-segment to LOCAL_MODEL_REGISTRY**

After the `layer-decompose` entry:

```typescript
'sam3-segment': {
  id: 'sam3-segment', nodeType: 'sam3-segment', name: 'SAM 3 Segment',
  category: 'image-edit', description: 'Interactive segmentation — click, draw, or describe to select elements', outputType: 'image',
  provider: 'local',
  responseMapping: { path: 'output_path' },
  inputs: [
    { id: 'image_url', portType: 'image', label: 'Image', required: true, falParam: 'image_url', fieldType: 'port' },
  ],
},
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fal/models.ts
git commit -m "feat: add sam3-segment to LOCAL_MODEL_REGISTRY"
```

---

### Task 5: Skip sam3-segment in execute.ts

**Files:**
- Modify: `src/lib/workflows/execute.ts`

- [ ] **Step 1: Add skip logic for sam3-segment**

At the top of the model node execution function (around where `modelDef.provider === 'local'` is checked), add an early return for `sam3-segment`:

```typescript
// SAM 3 segment is interactive-only — uses modal, not automated execution
if (modelDef.nodeType === 'sam3-segment') {
  if (data.result?.url || data.result?.layers) {
    // Use pre-existing result from modal
    const existingUrl = data.result.url;
    if (existingUrl) {
      results.set(nodeId, { [modelDef.outputType]: existingUrl });
    }
  } else {
    dispatch.setNodeResult(nodeId, {
      status: 'error',
      error: 'Open the Segment modal to create a selection.',
    });
  }
  dispatch.setNodeRunning(nodeId, false);
  return;
}
```

Add this right after `dispatch.setNodeRunning(nodeId, true)` and before the `try` block.

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/execute.ts
git commit -m "feat: skip sam3-segment in automated workflow execution"
```

---

## Chunk 4: Segmentation Modal

### Task 6: Create the segmentation modal component

**Files:**
- Create: `src/components/create/sam3-modal.tsx`

This is the largest single file. It implements the full interactive segmentation UI.

- [ ] **Step 1: Write sam3-modal.tsx**

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';

interface Sam3ModalProps {
  imageUrl: string;
  onAcceptSelected: (result: { url: string }) => void;
  onAcceptAll: (result: { layers: Array<{ url: string; name: string; type: string; z_order: number }> }) => void;
  onClose: () => void;
}

interface MaskData {
  dataUri: string;
  box: number[];
  score: number;
}

type ToolMode = 'text' | 'click' | 'box';
type ViewMode = 'overlay' | 'cutout' | 'sideBySide';

const SEGMENT_COLORS = [
  'rgba(201, 168, 76, 0.35)',   // gold
  'rgba(74, 154, 201, 0.35)',   // blue
  'rgba(76, 201, 120, 0.35)',   // green
  'rgba(201, 76, 154, 0.35)',   // pink
  'rgba(154, 76, 201, 0.35)',   // purple
  'rgba(201, 120, 76, 0.35)',   // orange
];

export function Sam3Modal({ imageUrl, onAcceptSelected, onAcceptAll, onClose }: Sam3ModalProps) {
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('text');
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [textPrompt, setTextPrompt] = useState('');
  const [masks, setMasks] = useState<MaskData[]>([]);
  const [selectedMask, setSelectedMask] = useState(0);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  // Post-processing
  const [blur, setBlur] = useState(2);
  const [feather, setFeather] = useState(4);
  const [threshold, setThreshold] = useState(0.5);
  const [confidence, setConfidence] = useState(0.5);

  // Box drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const apiUrl = serverPort ? `http://127.0.0.1:${serverPort}` : null;

  // Start server + load image
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { port } = await window.electronAPI.sam3.start();
        if (cancelled) return;
        setServerPort(port);

        // Resolve image URL to a local path if needed
        let imagePath = imageUrl;
        if (imageUrl.startsWith('local-media://file')) {
          imagePath = decodeURIComponent(imageUrl.replace('local-media://file', ''));
        }

        const res = await fetch(`http://127.0.0.1:${port}/set-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            imagePath.startsWith('http') ? { image_url: imagePath } : { image_path: imagePath }
          ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load image');
        setImageSize({ width: data.width, height: data.height });
        setLoading(false);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to start SAM 3 server');
      }
    })();
    return () => { cancelled = true; };
  }, [imageUrl]);

  const callSegment = useCallback(async (body: Record<string, unknown>) => {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Segment failed');
      setMasks(data.masks.map((m: string, i: number) => ({
        dataUri: m,
        box: data.boxes[i] ?? [],
        score: data.scores[i] ?? 0,
      })));
    } catch (e) {
      console.error('[sam3-modal] Segment error:', e);
    }
  }, [apiUrl]);

  // Text submit
  const handleTextSubmit = useCallback(() => {
    if (!textPrompt.trim()) return;
    callSegment({ type: 'text', prompt: textPrompt.trim() });
  }, [textPrompt, callSegment]);

  // Click on canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (toolMode !== 'click' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // Tiny box centered on click
    callSegment({ type: 'box', box: [x, y, 0.02, 0.02], label: true });
  }, [toolMode, callSegment]);

  // Box draw
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (toolMode !== 'box' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setBoxStart({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
    setIsDrawing(true);
  }, [toolMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setBoxEnd({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
  }, [isDrawing]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !boxStart || !boxEnd) { setIsDrawing(false); return; }
    const cx = (boxStart.x + boxEnd.x) / 2;
    const cy = (boxStart.y + boxEnd.y) / 2;
    const w = Math.abs(boxEnd.x - boxStart.x);
    const h = Math.abs(boxEnd.y - boxStart.y);
    if (w > 0.01 && h > 0.01) {
      callSegment({ type: 'box', box: [cx, cy, w, h], label: true });
    }
    setIsDrawing(false);
    setBoxStart(null);
    setBoxEnd(null);
  }, [isDrawing, boxStart, boxEnd, callSegment]);

  // Undo / Clear
  const handleUndo = useCallback(() => callSegment({ type: 'undo' }), [callSegment]);
  const handleClear = useCallback(() => {
    callSegment({ type: 'reset' });
    setMasks([]);
  }, [callSegment]);

  // Confidence change
  const handleConfidenceChange = useCallback((val: number) => {
    setConfidence(val);
    callSegment({ type: 'confidence', threshold: val });
  }, [callSegment]);

  // Accept
  const handleAcceptSelected = useCallback(async () => {
    if (!apiUrl || masks.length === 0) return;
    const res = await fetch(`${apiUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mask_indices: [selectedMask], blur, feather, threshold }),
    });
    const data = await res.json();
    if (data.layers?.length > 1) {
      // layers[0] = background, layers[1] = selected cutout
      const cutoutPath = data.layers[1]?.path;
      if (cutoutPath) {
        onAcceptSelected({ url: `local-media://file${cutoutPath}` });
      }
    }
  }, [apiUrl, masks, selectedMask, blur, feather, threshold, onAcceptSelected]);

  const handleAcceptAll = useCallback(async () => {
    if (!apiUrl || masks.length === 0) return;
    const allIndices = masks.map((_, i) => i);
    const res = await fetch(`${apiUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mask_indices: allIndices, blur, feather, threshold }),
    });
    const data = await res.json();
    if (data.layers?.length > 0) {
      const layers = data.layers.map((l: any) => ({
        url: `local-media://file${l.path}`,
        name: l.name,
        type: l.type,
        z_order: l.z_order,
      }));
      onAcceptAll({ layers });
    }
  }, [apiUrl, masks, blur, feather, threshold, onAcceptAll]);

  if (error) {
    return (
      <div className="sam3-modal__overlay">
        <div className="sam3-modal__error">
          <h3>SAM 3 Error</h3>
          <p>{error}</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sam3-modal__overlay">
      <div className="sam3-modal">
        {/* Left: Canvas */}
        <div className="sam3-modal__canvas-area">
          {/* Toolbar */}
          <div className="sam3-modal__toolbar">
            <button className={toolMode === 'text' ? 'active' : ''} onClick={() => setToolMode('text')}>Text</button>
            <button className={toolMode === 'click' ? 'active' : ''} onClick={() => setToolMode('click')}>Click</button>
            <button className={toolMode === 'box' ? 'active' : ''} onClick={() => setToolMode('box')}>Box</button>
            <div style={{ flex: 1 }} />
            <button onClick={handleUndo}>Undo</button>
            <button onClick={handleClear}>Clear</button>
          </div>

          {/* Text prompt bar */}
          {toolMode === 'text' && (
            <div className="sam3-modal__text-bar">
              <input
                type="text"
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
                placeholder="Describe what to segment: person, logo, text..."
              />
              <button onClick={handleTextSubmit}>Segment</button>
            </div>
          )}

          {/* Image + masks */}
          <div
            ref={canvasRef}
            className={`sam3-modal__image-container ${toolMode === 'click' ? 'cursor-crosshair' : ''} ${toolMode === 'box' ? 'cursor-crosshair' : ''}`}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {loading ? (
              <div className="sam3-modal__loading">Loading SAM 3 model...</div>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Source" className="sam3-modal__source-img" />

                {/* Mask overlays */}
                {viewMode === 'overlay' && masks.map((mask, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={mask.dataUri}
                    alt={`Mask ${i}`}
                    className="sam3-modal__mask-overlay"
                    style={{
                      opacity: i === selectedMask ? 0.5 : 0.2,
                      mixBlendMode: 'multiply',
                    }}
                    onClick={(e) => { e.stopPropagation(); setSelectedMask(i); }}
                  />
                ))}

                {/* Box drawing preview */}
                {isDrawing && boxStart && boxEnd && (
                  <div
                    className="sam3-modal__draw-box"
                    style={{
                      left: `${Math.min(boxStart.x, boxEnd.x) * 100}%`,
                      top: `${Math.min(boxStart.y, boxEnd.y) * 100}%`,
                      width: `${Math.abs(boxEnd.x - boxStart.x) * 100}%`,
                      height: `${Math.abs(boxEnd.y - boxStart.y) * 100}%`,
                    }}
                  />
                )}
              </>
            )}
          </div>

          {/* View toggle */}
          <div className="sam3-modal__view-toggle">
            <button className={viewMode === 'overlay' ? 'active' : ''} onClick={() => setViewMode('overlay')}>Original + Mask</button>
            <button className={viewMode === 'cutout' ? 'active' : ''} onClick={() => setViewMode('cutout')}>Cutout Only</button>
            <button className={viewMode === 'sideBySide' ? 'active' : ''} onClick={() => setViewMode('sideBySide')}>Side by Side</button>
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="sam3-modal__sidebar">
          {/* Segments */}
          <div className="sam3-modal__section">
            <div className="sam3-modal__section-title">Segments</div>
            {masks.map((mask, i) => (
              <div
                key={i}
                className={`sam3-modal__segment-item ${i === selectedMask ? 'active' : ''}`}
                onClick={() => setSelectedMask(i)}
              >
                <div className="sam3-modal__segment-color" style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} />
                <span>Segment {i + 1}</span>
                <span className="sam3-modal__segment-score">{Math.round(mask.score * 100)}%</span>
              </div>
            ))}
          </div>

          {/* Post-processing */}
          <div className="sam3-modal__section">
            <div className="sam3-modal__section-title">Post-Processing</div>
            <label>Edge Blur: {blur}px
              <input type="range" min={0} max={20} value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
            </label>
            <label>Feather: {feather}px
              <input type="range" min={0} max={20} value={feather} onChange={(e) => setFeather(Number(e.target.value))} />
            </label>
            <label>Alpha Threshold: {threshold.toFixed(2)}
              <input type="range" min={0} max={1} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
            <label>Confidence: {confidence.toFixed(2)}
              <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={(e) => handleConfidenceChange(Number(e.target.value))} />
            </label>
          </div>

          {/* Actions */}
          <div className="sam3-modal__actions">
            <button className="sam3-modal__btn-cancel" onClick={onClose}>Cancel</button>
            <button className="sam3-modal__btn-accept" onClick={handleAcceptSelected} disabled={masks.length === 0}>Accept Selected</button>
            <button className="sam3-modal__btn-accept-all" onClick={handleAcceptAll} disabled={masks.length === 0}>Accept All</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/create/sam3-modal.tsx
git commit -m "feat: add SAM 3 segmentation modal component"
```

---

## Chunk 5: Node UI + CSS

### Task 7: Add "Segment" button to model-node

**Files:**
- Modify: `src/components/create/nodes/model-node.tsx`

- [ ] **Step 1: Add modal state and Segment button**

In model-node.tsx, add state for the SAM 3 modal:

```typescript
const [sam3ModalOpen, setSam3ModalOpen] = useState(false);
```

Where the Run button is rendered, add a conditional for `sam3-segment`:

```tsx
{modelDef.nodeType === 'sam3-segment' ? (
  <button
    type="button"
    className="model-node__run-btn nodrag"
    onClick={() => setSam3ModalOpen(true)}
    disabled={!inputImageUrl}
  >
    ✂ Segment
  </button>
) : (
  // existing Run Model button
)}
```

Add the modal render at the bottom of the component (before the closing fragment):

```tsx
{sam3ModalOpen && inputImageUrl && (
  <Sam3Modal
    imageUrl={inputImageUrl}
    onAcceptSelected={(result) => {
      updateNodeData(id, { result: { status: 'complete', url: result.url } });
      setSam3ModalOpen(false);
    }}
    onAcceptAll={(result) => {
      const primaryUrl = result.layers[0]?.url;
      updateNodeData(id, {
        result: { status: 'complete', url: primaryUrl, layers: result.layers, selectedLayerIndex: 0 },
      });
      setSam3ModalOpen(false);
    }}
    onClose={() => setSam3ModalOpen(false)}
  />
)}
```

Import Sam3Modal at the top:
```typescript
import { Sam3Modal } from '@/components/create/sam3-modal';
```

- [ ] **Step 2: Commit**

```bash
git add src/components/create/nodes/model-node.tsx
git commit -m "feat: add Segment button and modal integration to model node"
```

---

### Task 8: Add modal CSS

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add SAM 3 modal styles**

```css
/* SAM 3 Modal */
.sam3-modal__overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sam3-modal {
  width: 95vw;
  height: 90vh;
  display: flex;
  background: #0d0d1a;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #222;
}
.sam3-modal__canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #222;
}
.sam3-modal__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #151528;
  border-bottom: 1px solid #222;
}
.sam3-modal__toolbar button {
  padding: 4px 10px;
  background: #252540;
  border: none;
  border-radius: 4px;
  color: #999;
  font-size: 12px;
  cursor: pointer;
}
.sam3-modal__toolbar button.active {
  background: #c9a84c;
  color: #000;
  font-weight: 600;
}
.sam3-modal__text-bar {
  display: flex;
  gap: 8px;
  padding: 6px 12px;
  background: #111122;
  border-bottom: 1px solid #222;
}
.sam3-modal__text-bar input {
  flex: 1;
  padding: 6px 10px;
  background: #1a1a30;
  border: 1px solid #333;
  border-radius: 4px;
  color: #ccc;
  font-size: 13px;
}
.sam3-modal__text-bar button {
  padding: 6px 16px;
  background: #c9a84c;
  border: none;
  border-radius: 4px;
  color: #000;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.sam3-modal__image-container {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a15;
  overflow: hidden;
  user-select: none;
}
.sam3-modal__image-container.cursor-crosshair {
  cursor: crosshair;
}
.sam3-modal__source-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.sam3-modal__mask-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.sam3-modal__draw-box {
  position: absolute;
  border: 2px dashed #c9a84c;
  border-radius: 2px;
  pointer-events: none;
}
.sam3-modal__loading {
  color: #666;
  font-size: 14px;
}
.sam3-modal__view-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #111122;
  border-top: 1px solid #222;
}
.sam3-modal__view-toggle button {
  padding: 3px 8px;
  background: #252540;
  border: none;
  border-radius: 3px;
  color: #999;
  font-size: 11px;
  cursor: pointer;
}
.sam3-modal__view-toggle button.active {
  background: #c9a84c;
  color: #000;
}
.sam3-modal__sidebar {
  width: 240px;
  display: flex;
  flex-direction: column;
  background: #111122;
  overflow-y: auto;
}
.sam3-modal__section {
  padding: 12px;
  border-bottom: 1px solid #222;
}
.sam3-modal__section-title {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.sam3-modal__segment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #1a1a30;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 12px;
  color: #999;
  cursor: pointer;
  margin-bottom: 4px;
}
.sam3-modal__segment-item.active {
  border-color: #c9a84c;
  color: #ddd;
}
.sam3-modal__segment-color {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.sam3-modal__segment-score {
  margin-left: auto;
  font-size: 10px;
  color: #888;
}
.sam3-modal__section label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
}
.sam3-modal__section input[type="range"] {
  width: 100%;
  accent-color: #c9a84c;
}
.sam3-modal__actions {
  padding: 12px;
  border-top: 1px solid #222;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}
.sam3-modal__btn-cancel {
  padding: 8px;
  background: #252540;
  border: none;
  border-radius: 4px;
  color: #999;
  font-size: 12px;
  cursor: pointer;
}
.sam3-modal__btn-accept,
.sam3-modal__btn-accept-all {
  padding: 8px;
  background: #c9a84c;
  border: none;
  border-radius: 4px;
  color: #000;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.sam3-modal__btn-accept:disabled,
.sam3-modal__btn-accept-all:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sam3-modal__error {
  background: #1a1a30;
  padding: 24px;
  border-radius: 8px;
  text-align: center;
  color: #ccc;
}
.sam3-modal__error h3 { color: #c44; margin-bottom: 8px; }
.sam3-modal__error button {
  margin-top: 16px;
  padding: 8px 20px;
  background: #252540;
  border: none;
  border-radius: 4px;
  color: #999;
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: add SAM 3 segmentation modal CSS"
```

---

## Chunk 6: Verification

### Task 9: Manual testing

- [ ] **Step 1: Test server standalone**

```bash
cd ~/Desktop/Coding/Sam3
.venv/bin/pip install fastapi uvicorn
.venv/bin/python cinegen_server.py --port 8765
```

In another terminal:
```bash
curl http://127.0.0.1:8765/health
# Expected: {"status":"ok","model_loaded":false}

curl -X POST http://127.0.0.1:8765/set-image \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/tmp/test-flyer.jpg"}'
# Expected: {"ok":true,"width":...,"height":...}

curl -X POST http://127.0.0.1:8765/segment \
  -H "Content-Type: application/json" \
  -d '{"type": "text", "prompt": "logo"}'
# Expected: {"masks":["data:image/png;base64,..."],"boxes":[...],"scores":[...]}
```

- [ ] **Step 2: Test in the app**

1. Start the Electron app
2. Open the Create tab → Local tab
3. Verify "SAM 3 Segment" appears
4. Drag onto canvas, connect an image source
5. Click "Segment" button — modal should open
6. Wait for "Loading SAM 3 model..." to finish
7. Select Text mode, type "person", press Enter — mask overlay should appear
8. Switch to Click mode, click on an object — mask updates
9. Switch to Box mode, drag a box — mask updates
10. Adjust post-processing sliders — mask edges change
11. Click "Accept Selected" — modal closes, node shows cutout
12. Re-open modal, segment multiple objects, click "Accept All" — layer gallery appears

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A && git commit -m "fix: address issues from manual testing"
```
