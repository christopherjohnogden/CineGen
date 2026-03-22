# Layer Decompose Node Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Layer Decompose" node that takes an image and decomposes it into separate RGBA layers using Grounding DINO + SAM 2.1 + PaddleOCR, with configurable inpainting (Qwen Edit local/cloud/RunPod, or LaMa).

**Architecture:** Python script handles segmentation/extraction/LaMa inpainting. Electron IPC handler spawns it. Phase 2 Qwen inpainting runs in `execute.ts` on the renderer side (not in the IPC handler) because that's where fal/RunPod/local workflow runners are accessible. The model-node UI adds a layer gallery for multi-image output. Types are extended to support `layers` on node results.

**Tech Stack:** Python (Grounding DINO, SAM 2.1, PaddleOCR, simple-lama, torch, PIL, opencv), TypeScript/React (Electron IPC, ReactFlow nodes)

**Spec:** `docs/superpowers/specs/2026-03-15-layer-decompose-design.md`

**Deviation from spec:** The spec lists `electron/ipc/workflows.ts` as a file to modify for exposing inpainting helpers. This plan moves Phase 2 Qwen inpainting to `execute.ts` instead, reusing existing `window.electronAPI.workflow.run()` and `window.electronAPI.localModel.run()` calls. This avoids duplicating provider-routing logic in the main process. As a result, `workflows.ts` does not need modification.

---

## Chunk 1: Python Infrastructure

### Task 1: Create setup script

**Files:**
- Create: `~/Desktop/Coding/layer-decompose/setup.sh`

- [ ] **Step 1: Create directory and setup.sh**

```bash
mkdir -p ~/Desktop/Coding/layer-decompose
```

Write `~/Desktop/Coding/layer-decompose/setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Creating Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

echo "Installing dependencies..."
pip install --upgrade pip
pip install torch torchvision
pip install transformers                # Grounding DINO
pip install sam2                        # SAM 2.1 (segmentation)
pip install paddlepaddle paddleocr
pip install simple-lama-inpainting
pip install pillow numpy opencv-python
pip install psd-tools

echo ""
echo "Setup complete! Models will auto-download on first run."
echo "  SAM 3 (~750MB) — via HuggingFace"
echo "  PaddleOCR (~15MB) — auto-download"
echo "  LaMa (~27MB) — auto-download"
echo ""
echo "Run with:"
echo "  .venv/bin/python cinegen_infer.py --image_path input.png"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/Desktop/Coding/layer-decompose/setup.sh
```

---

### Task 2: Create Python inference script

**Files:**
- Create: `~/Desktop/Coding/layer-decompose/cinegen_infer.py`

This is the largest single file. It implements the full precision-mode pipeline.

- [ ] **Step 1: Write cinegen_infer.py**

```python
#!/usr/bin/env python3
"""CineGen Layer Decompose — SAM 3 + PaddleOCR + LaMa pipeline."""

import argparse
import json
import os
import sys
import tempfile
import time

import cv2
import numpy as np
from PIL import Image


def log(msg_type: str, **kwargs):
    """Print a JSON message to stdout for the Electron IPC bridge."""
    print(json.dumps({"type": msg_type, **kwargs}), flush=True)


# ── OCR ─────────────────────────────────────────────────────

def detect_text(image: Image.Image):
    """Detect text regions using PaddleOCR. Returns list of (text, bbox_polygon, confidence)."""
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    img_array = np.array(image)
    results = ocr.ocr(img_array, cls=True)

    regions = []
    if results and results[0]:
        for line in results[0]:
            bbox = line[0]          # 4-point polygon [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            text = line[1][0]       # detected text
            conf = line[1][1]       # confidence
            regions.append({"text": text, "bbox": bbox, "confidence": conf})

    return regions


def text_region_to_mask(region, image_size):
    """Convert a text region's polygon bbox to a binary mask."""
    w, h = image_size
    mask = np.zeros((h, w), dtype=np.uint8)
    pts = np.array(region["bbox"], dtype=np.int32)
    cv2.fillPoly(mask, [pts], 255)
    return mask


# ── Segmentation ────────────────────────────────────────────

def _apply_exclude_masks(mask, exclude_masks):
    """Remove already-claimed regions from a mask."""
    if not exclude_masks:
        return mask
    combined_exclude = np.zeros_like(mask)
    for em in exclude_masks:
        combined_exclude = cv2.bitwise_or(combined_exclude, em)
    return cv2.bitwise_and(mask, cv2.bitwise_not(combined_exclude))


def segment_elements(image: Image.Image, prompts=None, exclude_masks=None):
    """Segment visual elements. Uses Grounding DINO + SAM 2 for text prompts, SAM 2 auto for no prompts."""
    import torch
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    device = "mps" if torch.backends.mps.is_available() else "cpu"

    elements = []
    img_array = np.array(image)

    if prompts:
        # Text-prompted: Grounding DINO detects bounding boxes, SAM 2 refines to masks
        dino_model_id = "IDEA-Research/grounding-dino-base"
        dino_processor = AutoProcessor.from_pretrained(dino_model_id)
        dino_model = AutoModelForZeroShotObjectDetection.from_pretrained(dino_model_id).to(device)

        # Join prompts into a single query string for Grounding DINO
        text_query = ". ".join(prompts) + "."
        dino_inputs = dino_processor(images=image, text=text_query, return_tensors="pt").to(device)
        with torch.no_grad():
            dino_outputs = dino_model(**dino_inputs)
        dino_results = dino_processor.post_process_grounded_object_detection(
            dino_outputs,
            dino_inputs.input_ids,
            box_threshold=0.3,
            text_threshold=0.25,
            target_sizes=[image.size[::-1]],  # (H, W)
        )[0]

        if len(dino_results["boxes"]) > 0:
            # Use SAM 2 to refine bounding boxes into precise masks
            sam_predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2.1-hiera-large")
            sam_predictor.set_image(img_array)

            boxes = dino_results["boxes"].cpu().numpy()  # (N, 4) in xyxy format
            labels = dino_results["labels"]
            scores = dino_results["scores"].cpu().numpy()

            masks_out, _, _ = sam_predictor.predict(
                box=boxes,
                multimask_output=False,
            )

            for i in range(len(boxes)):
                mask = (masks_out[i][0] * 255).astype(np.uint8) if masks_out[i].ndim == 3 else (masks_out[i] * 255).astype(np.uint8)
                mask = _apply_exclude_masks(mask, exclude_masks)
                if mask.sum() > 0:
                    x, y, w, h = cv2.boundingRect(mask)
                    elements.append({
                        "mask": mask,
                        "label": labels[i] if i < len(labels) else f"element_{i}",
                        "confidence": float(scores[i]) if i < len(scores) else 0.85,
                        "bbox": (x, y, x + w, y + h),
                    })
    else:
        # Auto segmentation: SAM 2 automatic mask generator
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

        mask_generator = SAM2AutomaticMaskGenerator.from_pretrained(
            "facebook/sam2.1-hiera-large",
            points_per_side=32,
            pred_iou_thresh=0.8,
            stability_score_thresh=0.9,
            min_mask_region_area=500,
        )
        auto_masks = mask_generator.generate(img_array)

        for i, ann in enumerate(auto_masks):
            mask = (ann["segmentation"].astype(np.uint8)) * 255
            mask = _apply_exclude_masks(mask, exclude_masks)
            if mask.sum() > 100:
                x, y, w, h = cv2.boundingRect(mask)
                elements.append({
                    "mask": mask,
                    "label": f"element_{i}",
                    "confidence": float(ann.get("predicted_iou", 0.85)),
                    "bbox": (x, y, x + w, y + h),
                })

    return elements


# ── Mask Utilities ──────────────────────────────────────────

def merge_masks(masks):
    """OR-combine multiple masks into one."""
    if not masks:
        return None
    combined = np.zeros_like(masks[0])
    for m in masks:
        combined = cv2.bitwise_or(combined, m)
    return combined


def extract_with_alpha(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Extract a region from an image as RGBA with transparency."""
    rgba = image.convert("RGBA")
    # Feather edges slightly for cleaner extraction
    alpha = cv2.GaussianBlur(mask, (3, 3), 0)
    rgba_array = np.array(rgba)
    rgba_array[:, :, 3] = alpha
    return Image.fromarray(rgba_array)


def dilate_mask(mask, pixels=5):
    """Expand a mask by N pixels for cleaner extraction."""
    kernel = np.ones((pixels * 2 + 1, pixels * 2 + 1), np.uint8)
    return cv2.dilate(mask, kernel)


# ── Inpainting ──────────────────────────────────────────────

def inpaint_lama(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Inpaint using LaMa (lightweight, fast)."""
    from simple_lama_inpainting import SimpleLama

    lama = SimpleLama()
    # simple-lama expects PIL images
    mask_pil = Image.fromarray(mask)
    result = lama(image, mask_pil)
    return result


# ── Main Pipeline ───────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Layer Decompose — SAM 3 + PaddleOCR pipeline")
    parser.add_argument("--image_path", required=True, help="Path to input image")
    parser.add_argument("--prompts", default="", help="Comma-separated segmentation prompts")
    parser.add_argument("--inpainter", default="none", choices=["lama", "none"],
                        help="Inpainting engine (lama or none)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output_dir", default=None, help="Output directory (default: system temp)")
    args = parser.parse_args()

    if not os.path.isfile(args.image_path):
        log("error", error=f"Input image not found: {args.image_path}")
        sys.exit(1)

    try:
        np.random.seed(args.seed)

        # Setup output directory
        out_dir = args.output_dir or os.path.join(
            tempfile.gettempdir(), f"layer-decompose-{int(time.time())}"
        )
        os.makedirs(out_dir, exist_ok=True)

        image = Image.open(args.image_path).convert("RGB")

        # ── Step 1: OCR ──
        log("progress", stage="ocr", message="Detecting text regions…")
        text_regions = detect_text(image)
        text_masks = [text_region_to_mask(r, image.size) for r in text_regions]
        log("progress", stage="ocr", message=f"Found {len(text_regions)} text regions")

        # ── Step 2: Segmentation ──
        log("progress", stage="segmentation", message="Segmenting elements (SAM 3)…")
        prompts = [p.strip() for p in args.prompts.split(",") if p.strip()] if args.prompts else None
        elements = segment_elements(image, prompts=prompts, exclude_masks=text_masks)
        log("progress", stage="segmentation", message=f"Found {len(elements)} elements")

        # ── Step 3: Mask Composition ──
        log("progress", stage="masks", message="Compositing masks…")
        all_masks = text_masks + [e["mask"] for e in elements]
        combined_mask = merge_masks(all_masks)

        # Save combined mask for Phase 2 Qwen inpainting
        if combined_mask is not None:
            combined_mask_path = os.path.join(out_dir, "combined_mask.png")
            cv2.imwrite(combined_mask_path, combined_mask)
        else:
            combined_mask_path = None

        # ── Step 4: Layer Extraction ──
        log("progress", stage="extraction", message="Extracting layers…")
        layers = []
        z_order = 1  # 0 reserved for background

        # Text layers
        for i, region in enumerate(text_regions):
            mask = dilate_mask(text_masks[i], pixels=3)
            layer_img = extract_with_alpha(image, mask)
            safe_name = region["text"][:30].replace(" ", "_").replace("/", "_")
            filename = f"{z_order:02d}_text_{safe_name}.png"
            filepath = os.path.join(out_dir, filename)
            layer_img.save(filepath)
            layers.append({
                "path": filepath,
                "name": f"Text: {region['text'][:30]}",
                "type": "text",
                "z_order": z_order,
                "metadata": {
                    "text": region["text"],
                    "confidence": region["confidence"],
                    "bbox": region["bbox"],
                },
            })
            z_order += 1

        # Element layers
        for i, element in enumerate(elements):
            mask = dilate_mask(element["mask"], pixels=3)
            layer_img = extract_with_alpha(image, mask)
            filename = f"{z_order:02d}_{element['label']}_{i}.png"
            filepath = os.path.join(out_dir, filename)
            layer_img.save(filepath)
            layers.append({
                "path": filepath,
                "name": f"{element['label'].title()} {i + 1}",
                "type": element["label"],
                "z_order": z_order,
                "metadata": {
                    "confidence": element["confidence"],
                    "bbox": list(element["bbox"]),
                },
            })
            z_order += 1

        # ── Step 5: Background ──
        needs_inpainting = False
        bg_path = os.path.join(out_dir, "00_background.png")

        if combined_mask is not None and args.inpainter == "lama":
            log("progress", stage="inpainting", message="Reconstructing background (LaMa)…")
            bg_image = inpaint_lama(image, combined_mask)
            bg_image.convert("RGBA").save(bg_path)
        elif combined_mask is not None and args.inpainter == "none":
            # Save raw background with holes — Electron will handle Qwen inpainting
            bg_rgba = image.convert("RGBA")
            bg_array = np.array(bg_rgba)
            bg_array[:, :, 3] = cv2.bitwise_not(combined_mask)  # transparent where foreground was
            Image.fromarray(bg_array).save(bg_path)
            needs_inpainting = True
        else:
            # No foreground found — whole image is background
            image.convert("RGBA").save(bg_path)

        bg_layer = {
            "path": bg_path,
            "name": "Background",
            "type": "background",
            "z_order": 0,
        }

        # Insert background at position 0
        layers.insert(0, bg_layer)

        # ── Step 6: Save metadata ──
        log("progress", stage="saving", message=f"Saving {len(layers)} layers…")
        metadata = {
            "source": args.image_path,
            "source_size": list(image.size),
            "layers": [{k: v for k, v in l.items() if k != "mask"} for l in layers],
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        with open(os.path.join(out_dir, "metadata.json"), "w") as f:
            json.dump(metadata, f, indent=2, default=str)

        # ── Done ──
        log("done",
            output_path=bg_path,
            combined_mask_path=combined_mask_path,
            needs_inpainting=needs_inpainting,
            layers=layers)

    except Exception as e:
        log("error", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/Desktop/Coding/layer-decompose/cinegen_infer.py
```

- [ ] **Step 3: Commit Python infrastructure**

```bash
cd ~/Desktop/Coding/layer-decompose
git init && git add -A && git commit -m "feat: add Layer Decompose pipeline — SAM 3 + PaddleOCR + LaMa"
```

---

## Chunk 2: TypeScript Types & Model Registry

### Task 3: Extend workflow types

**Files:**
- Modify: `src/types/workflow.ts:56-70`

- [ ] **Step 1: Add LayerInfo interface and extend result type**

After the existing imports (or at the top of the types section), add the `LayerInfo` interface. Then extend the `result` type inside `WorkflowNodeData` to include `layers` and `selectedLayerIndex`.

Add before `WorkflowNodeData` (around line 55):

```typescript
export interface LayerInfo {
  url: string;
  name: string;
  type: string;
  z_order: number;
  metadata?: Record<string, unknown>;
}
```

Modify the `result` field inside `WorkflowNodeData` (lines 61-67) to add `layers` and `selectedLayerIndex`:

```typescript
  result?: {
    url?: string;
    text?: string;
    status?: 'idle' | 'running' | 'complete' | 'error';
    progress?: number;
    error?: string;
    layers?: LayerInfo[];
    selectedLayerIndex?: number;
  };
```

- [ ] **Step 2: Commit**

```bash
git add src/types/workflow.ts
git commit -m "feat: add LayerInfo type and layers support to node result"
```

---

### Task 4: Extend electron.d.ts types

**Files:**
- Modify: `electron.d.ts:150-157`

- [ ] **Step 1: Add layers fields to onProgress data type**

Extend the `onProgress` callback data type (lines 150-157) to include `layers`, `needs_inpainting`, and `combined_mask_path`:

```typescript
    onProgress: (cb: (data: {
      jobId: string;
      type: 'status' | 'progress' | 'done' | 'error';
      stage?: string;
      message?: string;
      output_path?: string;
      error?: string;
      layers?: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
      needs_inpainting?: boolean;
      combined_mask_path?: string;
    }) => void) => (() => void);
```

- [ ] **Step 2: Commit**

```bash
git add electron.d.ts
git commit -m "feat: extend local model progress type with layers support"
```

---

### Task 5: Add model registry entry

**Files:**
- Modify: `src/lib/fal/models.ts` (LOCAL_MODEL_REGISTRY, after `qwen-edit-local`)

- [ ] **Step 1: Add layer-decompose to LOCAL_MODEL_REGISTRY**

Add after the `qwen-edit-local` entry, before the closing `};` of `LOCAL_MODEL_REGISTRY`:

```typescript
  'layer-decompose': {
    id: 'layer-decompose', nodeType: 'layer-decompose', name: 'Layer Decompose',
    category: 'image-edit', description: 'Decompose an image into separate layers using SAM 3 + PaddleOCR', outputType: 'image',
    provider: 'local',
    responseMapping: { path: 'output_path' },
    inputs: [
      { id: 'image_url', portType: 'image', label: 'Image', required: true, falParam: 'image_url', fieldType: 'port' },
      { id: 'prompts', portType: 'text', label: 'Prompts', required: false, falParam: 'prompts', fieldType: 'textarea', default: '' },
      { id: 'inpainter', portType: 'text', label: 'Inpainter', required: false, falParam: 'inpainter', fieldType: 'select', default: 'qwen-edit-local', options: [
        { value: 'qwen-edit-local', label: 'Qwen Edit (Local)' },
        { value: 'qwen-edit-cloud', label: 'Qwen Edit (Cloud)' },
        { value: 'qwen-edit-runpod', label: 'Qwen Edit (RunPod)' },
        { value: 'lama', label: 'LaMa (Fast)' },
      ]},
      { id: 'reconstruct_bg', portType: 'number', label: 'Reconstruct Background', required: false, falParam: 'reconstruct_bg', fieldType: 'toggle', default: true },
      { id: 'seed', portType: 'number', label: 'Seed', required: false, falParam: 'seed', fieldType: 'number', default: 42 },
    ],
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fal/models.ts
git commit -m "feat: add layer-decompose to LOCAL_MODEL_REGISTRY"
```

---

## Chunk 3: Electron IPC Handler

### Task 6: Add layer-decompose IPC routing with two-phase execution

**Files:**
- Modify: `electron/ipc/local-models.ts`

This is the most complex task. The handler spawns the Python script (Phase 1), then optionally runs Qwen inpainting (Phase 2) via local subprocess, fal.ai, or RunPod.

- [ ] **Step 1: Add path constants**

After the Qwen Edit constants (line 13), add:

```typescript
const LAYER_DECOMPOSE_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'layer-decompose');
const LAYER_DECOMPOSE_PYTHON = path.join(LAYER_DECOMPOSE_REPO, '.venv', 'bin', 'python');
const LAYER_DECOMPOSE_SCRIPT = path.join(LAYER_DECOMPOSE_REPO, 'cinegen_infer.py');
```

- [ ] **Step 2: Extend the stdout parser type**

In the `proc.stdout.on('data')` handler, extend the `msg` type assertion to include the new fields:

```typescript
const msg = JSON.parse(trimmed) as {
  type: string;
  stage?: string;
  message?: string;
  output_path?: string;
  error?: string;
  layers?: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
  needs_inpainting?: boolean;
  combined_mask_path?: string;
};
```

- [ ] **Step 3: Update the done handler to forward layers**

In the `done` case of the stdout parser, change to:

```typescript
} else if (msg.type === 'done') {
  job.status = 'done';
  job.outputPath = msg.output_path;
  sendProgress(jobId, {
    type: 'done',
    output_path: msg.output_path,
    ...(msg.layers && { layers: msg.layers }),
    ...(msg.needs_inpainting !== undefined && { needs_inpainting: msg.needs_inpainting }),
    ...(msg.combined_mask_path && { combined_mask_path: msg.combined_mask_path }),
  });
}
```

- [ ] **Step 4: Add layer-decompose routing in the nodeType if/else**

Add a new branch before the `else` (LTX) case:

```typescript
    } else if (params.nodeType === 'layer-decompose') {
      // --- Layer Decompose ---
      const prompts = String(inputs.prompts ?? '');
      const inpainterSetting = String(inputs.inpainter ?? 'qwen-edit-local');
      const reconstructBg = Boolean(inputs.reconstruct_bg ?? true);
      const seed = Number(inputs.seed ?? 42);

      // Resolve image
      let image_path: string | null = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }
      if (!image_path) throw new Error('Layer Decompose requires an input image');

      // Determine Python-side inpainter: only 'lama' runs in Python, everything else is 'none'
      const pythonInpainter = (reconstructBg && inpainterSetting === 'lama') ? 'lama' : 'none';

      const args: string[] = [
        LAYER_DECOMPOSE_SCRIPT,
        '--image_path', image_path,
        '--inpainter', pythonInpainter,
        '--seed', String(seed),
      ];
      if (prompts) args.push('--prompts', prompts);

      proc = spawn(LAYER_DECOMPOSE_PYTHON, args, {
        cwd: LAYER_DECOMPOSE_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    } else {
```

Note: Phase 2 Qwen inpainting is handled in `execute.ts` on the renderer side, since that's where the fal/RunPod/local workflow runners are accessible. The IPC handler just forwards the `needs_inpainting` flag and `combined_mask_path` — the renderer-side execution pipeline decides what to do next.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/local-models.ts
git commit -m "feat: add layer-decompose IPC handler with two-phase execution support"
```

---

## Chunk 4: Execution Pipeline Changes

### Task 7: Handle layers and Phase 2 inpainting in execute.ts

**Files:**
- Modify: `src/lib/workflows/execute.ts:393-456`

- [ ] **Step 1: Capture layers from done event**

In the `provider === 'local'` branch (line ~393), update the `done` handler inside the `onProgress` callback to capture all layer-decompose fields:

Change:
```typescript
result = { output_path: data.output_path };
```
To:
```typescript
result = {
  output_path: data.output_path,
  ...(data.layers && { layers: data.layers }),
  ...(data.needs_inpainting !== undefined && { needs_inpainting: data.needs_inpainting }),
  ...(data.combined_mask_path && { combined_mask_path: data.combined_mask_path }),
};
```

- [ ] **Step 2: Add Phase 2 Qwen inpainting after local model completes**

After the `await new Promise<void>(...)` block that waits for the local model to complete (line ~412), and before the result-handling block (line ~427), add the Phase 2 inpainting logic:

```typescript
    // Phase 2: Qwen inpainting for layer-decompose (if needed)
    if (modelDef.nodeType === 'layer-decompose' && (result as any)?.needs_inpainting) {
      const inpainterSetting = String(falInputs.inpainter ?? 'qwen-edit-local');
      const reconstructBg = Boolean(falInputs.reconstruct_bg ?? true);

      if (reconstructBg && inpainterSetting.startsWith('qwen-edit')) {
        dispatch.setNodeResult(nodeId, { status: 'running', progress: undefined });

        const combinedMaskPath = (result as any).combined_mask_path as string;
        const originalImagePath = (result as any).output_path as string;
        // The background layer path is in layers[0].path
        const bgLayerPath = (result as any).layers?.[0]?.path as string;
        const inpaintPrompt = 'reconstruct the background behind the removed elements, maintain the style and context of the surrounding image';

        let inpaintedUrl: string | undefined;

        if (inpainterSetting === 'qwen-edit-local') {
          // Spawn qwen-edit local subprocess
          const qwenResult = await window.electronAPI.localModel.run({
            nodeType: 'qwen-edit-local',
            inputs: { image_url: `local-media://file${bgLayerPath}`, prompt: inpaintPrompt },
          });
          // Wait for qwen-edit to complete
          await new Promise<void>((resolve, reject) => {
            const unsub = window.electronAPI.localModel.onProgress((qData) => {
              if (qData.jobId !== qwenResult.jobId) return;
              if (qData.type === 'done') { unsub(); inpaintedUrl = qData.output_path; resolve(); }
              else if (qData.type === 'error') { unsub(); reject(new Error(qData.error ?? 'Qwen Edit error')); }
            });
          });
        } else {
          // Cloud or RunPod — use workflow.run
          const qwenInputs: Record<string, unknown> = {
            image_url: `local-media://file${bgLayerPath}`,
            prompt: inpaintPrompt,
          };
          const modelId = inpainterSetting === 'qwen-edit-cloud'
            ? 'fal-ai/qwen-image-edit-2511'
            : 'runpod-qwen-image-edit';
          const qwenResult = await window.electronAPI.workflow.run({
            apiKey: getApiKey(),
            kieKey: getKieApiKey(),
            runpodKey: getRunpodApiKey(),
            runpodEndpointId: getRunpodEndpointId('runpod-qwen-image-edit'),
            podUrl: getPodUrl(),
            nodeId,
            nodeType: inpainterSetting === 'qwen-edit-cloud' ? 'qwen-edit-cloud' : 'runpod-qwen-image-edit',
            modelId,
            inputs: qwenInputs,
          });
          // Extract URL from cloud/runpod result
          inpaintedUrl = extractUrl(qwenResult, 'output.image_url')
            ?? extractUrl(qwenResult, 'images.0.url')
            ?? extractUrl(qwenResult, 'image.url');
        }

        // Update background layer in the layers array
        if (inpaintedUrl && (result as any).layers) {
          const bgLayer = (result as any).layers[0];
          if (bgLayer) {
            bgLayer.path = inpaintedUrl.startsWith('/') ? inpaintedUrl : bgLayer.path;
            // If cloud result is a URL, store directly
            if (inpaintedUrl.startsWith('http')) {
              bgLayer.path = inpaintedUrl;
            }
          }
          (result as any).output_path = bgLayer.path;
        }
      }
    }
```

- [ ] **Step 3: Convert layers paths to local-media URLs in the result handler**

In the result-handling block (after computing the primary `url`, around line ~434), add layer conversion:

```typescript
    // Handle multi-layer output (layer-decompose)
    const rawLayers = (result as any)?.layers;
    if (rawLayers && Array.isArray(rawLayers)) {
      const layers = rawLayers.map((l: any) => ({
        url: l.path?.startsWith('/') ? `local-media://file${l.path}` : (l.path ?? ''),
        name: l.name ?? 'Layer',
        type: l.type ?? 'unknown',
        z_order: l.z_order ?? 0,
        metadata: l.metadata,
      }));
      dispatch.setNodeResult(nodeId, { status: 'complete', url, layers, selectedLayerIndex: 0 });
      if (url) dispatch.addGeneration(nodeId, url);
    } else {
```

And wrap the existing `dispatch.setNodeResult` call in the `else` branch.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/execute.ts
git commit -m "feat: handle layer-decompose multi-layer output and Phase 2 Qwen inpainting"
```

---

## Chunk 5: Layer Gallery UI

### Task 8: Add layer gallery to model-node.tsx

**Files:**
- Modify: `src/components/create/nodes/model-node.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add layer gallery component within model-node**

In `model-node.tsx`, within the preview section (around line 357), add a conditional block that renders when `data.result?.layers` exists:

```tsx
{data.result?.layers && data.result.layers.length > 0 && (
  <div className="layer-gallery">
    <div className="layer-gallery__strip">
      {data.result.layers.map((layer, idx) => (
        <button
          key={idx}
          className={`layer-gallery__thumb ${idx === (data.result?.selectedLayerIndex ?? 0) ? 'layer-gallery__thumb--active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateNodeData(id, {
              result: {
                ...data.result,
                url: layer.url,
                selectedLayerIndex: idx,
              },
            });
          }}
          title={layer.name}
        >
          <img src={layer.url} alt={layer.name} />
          <span className="layer-gallery__label">{layer.name.slice(0, 8)}</span>
        </button>
      ))}
    </div>
  </div>
)}
```

Place this just before the main image preview area so it appears above the full-size preview.

- [ ] **Step 2: Add gallery CSS**

In `src/styles/globals.css`, add:

```css
/* Layer Gallery — model node thumbnail strip */
.layer-gallery {
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.layer-gallery__strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.layer-gallery__thumb {
  flex-shrink: 0;
  width: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  transition: border-color 0.15s;
}
.layer-gallery__thumb:hover {
  border-color: rgba(255, 255, 255, 0.2);
}
.layer-gallery__thumb--active {
  border-color: #c9a84c;
}
.layer-gallery__thumb img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 2px;
  background: repeating-conic-gradient(#222 0% 25%, #333 0% 50%) 50% / 8px 8px;
}
.layer-gallery__label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 44px;
}
```

The checkerboard background on thumbnails helps visualize transparency in the RGBA layers.

- [ ] **Step 3: Commit**

```bash
git add src/components/create/nodes/model-node.tsx src/styles/globals.css
git commit -m "feat: add layer gallery UI to model node for multi-layer output"
```

---

## Chunk 6: Verification

### Task 9: Manual testing

- [ ] **Step 1: Run setup script**

```bash
cd ~/Desktop/Coding/layer-decompose && bash setup.sh
```

Expected: venv created, deps installed. SAM 3 weights download on first inference run.

- [ ] **Step 2: Test Python script standalone**

```bash
cd ~/Desktop/Coding/layer-decompose
.venv/bin/python cinegen_infer.py \
  --image_path /path/to/test-poster.png \
  --inpainter lama
```

Expected: JSON progress lines, then `done` with layers array. Output PNGs in temp directory.

- [ ] **Step 3: Test Python script with prompts**

```bash
.venv/bin/python cinegen_infer.py \
  --image_path /path/to/test-poster.png \
  --prompts "person,logo,text" \
  --inpainter none
```

Expected: `needs_inpainting: true` in output, combined_mask.png saved.

- [ ] **Step 4: Test in the app (LaMa mode)**

1. Start the Electron app
2. Open the Create tab → Local tab
3. Verify "Layer Decompose" appears
4. Drag onto canvas, connect an image source
5. Set inpainter to "LaMa (Fast)"
6. Click Run
7. Verify: progress stages appear, then layer gallery shows thumbnails
8. Click different thumbnails — main preview updates
9. Connect output to a downstream node — verify it receives the selected layer

- [ ] **Step 5: Test in the app (Qwen Edit Local mode)**

1. Set inpainter to "Qwen Edit (Local)"
2. Click Run
3. Verify: Phase 1 completes (segmentation), then Phase 2 runs (Qwen inpainting progress)
4. Background layer should show clean inpainted background

- [ ] **Step 6: Final commit if fixes needed**

```bash
git add -A && git commit -m "fix: address issues from manual testing"
```
