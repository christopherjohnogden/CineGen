# Qwen Image Edit 2511 (Local) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qwen-Image-Edit-2511 as a local model in the Create tab, runnable on Mac MPS with 128GB unified memory.

**Architecture:** A Python inference script at `~/Desktop/Coding/qwen-edit/` loads the 20B model via HuggingFace diffusers and communicates with Electron via JSON-line stdout protocol (same as LTX local). The Electron IPC handler routes `qwen-edit-local` to this script, and the model registry entry makes it appear in the node palette under the Local tab.

**Tech Stack:** Python (diffusers, transformers, torch), Electron IPC, TypeScript

---

## Chunk 1: Python Infrastructure

### Task 1: Create setup script

**Files:**
- Create: `~/Desktop/Coding/qwen-edit/setup.sh`

- [ ] **Step 1: Create the qwen-edit directory**

```bash
mkdir -p ~/Desktop/Coding/qwen-edit
```

- [ ] **Step 2: Write setup.sh**

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
pip install diffusers transformers accelerate
pip install pillow

echo "Pre-downloading model weights (this may take a while — ~40GB)..."
python -c "
import torch
from diffusers import DiffusionPipeline
print('Downloading Qwen/Qwen-Image-Edit-2511...')
DiffusionPipeline.from_pretrained('Qwen/Qwen-Image-Edit-2511', torch_dtype=torch.bfloat16)
print('Done — model cached.')
"

echo ""
echo "Setup complete! Run inference with:"
echo "  .venv/bin/python cinegen_infer.py --image_path input.jpg --prompt 'your edit'"
```

- [ ] **Step 3: Make setup.sh executable**

```bash
chmod +x ~/Desktop/Coding/qwen-edit/setup.sh
```

---

### Task 2: Create Python inference script

**Files:**
- Create: `~/Desktop/Coding/qwen-edit/cinegen_infer.py`

- [ ] **Step 1: Write cinegen_infer.py**

The script follows the exact same JSON-line stdout protocol as `~/Desktop/Coding/ltx/cinegen_infer.py`:
- `{"type": "progress", "stage": "...", "message": "..."}` for status updates
- `{"type": "done", "output_path": "/path/to/output.png"}` on success
- `{"type": "error", "error": "..."}` on failure

```python
#!/usr/bin/env python3
"""CineGen local inference script for Qwen-Image-Edit-2511 on Mac MPS."""

import argparse
import json
import os
import sys
import tempfile
import time

def log(msg_type: str, **kwargs):
    """Print a JSON message to stdout for the Electron IPC bridge."""
    print(json.dumps({"type": msg_type, **kwargs}), flush=True)

def main():
    parser = argparse.ArgumentParser(description="Qwen Image Edit 2511 — local MPS inference")
    parser.add_argument("--image_path", required=True, help="Path to input image")
    parser.add_argument("--prompt", required=True, help="Edit instruction")
    parser.add_argument("--num_inference_steps", type=int, default=50)
    parser.add_argument("--guidance_scale", type=float, default=1.0)
    parser.add_argument("--true_cfg_scale", type=float, default=4.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output_dir", default=None, help="Directory for output (default: system temp)")
    args = parser.parse_args()

    if not os.path.isfile(args.image_path):
        log("error", error=f"Input image not found: {args.image_path}")
        sys.exit(1)

    try:
        log("progress", stage="loading", message="Loading Qwen-Image-Edit-2511 model…")

        import torch
        from diffusers import DiffusionPipeline
        from PIL import Image

        device = "mps"
        dtype = torch.bfloat16  # bfloat16 halves memory (~40GB vs ~80GB for float32)

        pipe = DiffusionPipeline.from_pretrained(
            "Qwen/Qwen-Image-Edit-2511",
            torch_dtype=dtype,
        )
        pipe.to(device)

        log("progress", stage="loaded", message="Model loaded on MPS")

        # Load input image
        log("progress", stage="preprocessing", message="Loading input image…")
        input_image = Image.open(args.image_path).convert("RGB")

        # Set up generator for reproducibility
        generator = torch.Generator(device=device).manual_seed(args.seed)

        log("progress", stage="generating", message=f"Generating edit ({args.num_inference_steps} steps)…")
        start = time.time()

        output = pipe(
            image=[input_image],
            prompt=args.prompt,
            num_inference_steps=args.num_inference_steps,
            guidance_scale=args.guidance_scale,
            true_cfg_scale=args.true_cfg_scale,
            generator=generator,
        )

        elapsed = time.time() - start
        log("progress", stage="saving", message=f"Generation complete in {elapsed:.1f}s — saving…")

        # Save output image
        out_dir = args.output_dir or tempfile.gettempdir()
        os.makedirs(out_dir, exist_ok=True)
        output_path = os.path.join(out_dir, f"qwen-edit-{int(time.time())}.png")
        output.images[0].save(output_path)

        log("done", output_path=output_path)

    except Exception as e:
        log("error", error=str(e))
        sys.exit(1)

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x ~/Desktop/Coding/qwen-edit/cinegen_infer.py
```

- [ ] **Step 3: Commit Python infrastructure**

```bash
cd ~/Desktop/Coding/qwen-edit
git init && git add -A && git commit -m "feat: add Qwen-Image-Edit-2511 local inference script and setup"
```

> **Note:** The Python repo is separate from the Electron app, matching the pattern of `~/Desktop/Coding/ltx/`.

---

## Chunk 2: Electron Integration

> **Note:** No changes are needed to `execute.ts`, `preload.ts`, `node-registry.ts`, or `electron.d.ts`. The existing `provider === 'local'` branch in `execute.ts` (line 393) is generic — it passes `nodeType` and inputs via `window.electronAPI.localModel.run()`, and the `local-media://` URL conversion (line 438) handles local file paths for any output type. The node palette and model node component auto-discover models from `ALL_MODELS`.

### Task 3: Add model registry entry

**Files:**
- Modify: `src/lib/fal/models.ts:491-524` (LOCAL_MODEL_REGISTRY)

- [ ] **Step 1: Add qwen-edit-local to LOCAL_MODEL_REGISTRY**

Add after the existing `ltx-local` entry (line 523), before the closing `};` of LOCAL_MODEL_REGISTRY:

```typescript
  'qwen-edit-local': {
    id: 'qwen-edit-local', nodeType: 'qwen-edit-local', name: 'Qwen Image Edit (Local)',
    category: 'image-edit', description: 'Qwen-Image-Edit-2511 — instruction-based image editing on your Mac via MPS', outputType: 'image',
    provider: 'local',
    responseMapping: { path: 'output_path' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Edit Instruction', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'image_url', portType: 'image', label: 'Image', required: true, falParam: 'image_url', fieldType: 'port' },
      { id: 'num_inference_steps', portType: 'number', label: 'Steps', required: false, falParam: 'num_inference_steps', fieldType: 'range', default: 50, min: 10, max: 100, step: 1 },
      { id: 'guidance_scale', portType: 'number', label: 'Guidance', required: false, falParam: 'guidance_scale', fieldType: 'range', default: 1.0, min: 0.5, max: 5, step: 0.5 },
      { id: 'true_cfg_scale', portType: 'number', label: 'True CFG', required: false, falParam: 'true_cfg_scale', fieldType: 'range', default: 4.0, min: 1, max: 10, step: 0.5 },
      { id: 'seed', portType: 'number', label: 'Seed', required: false, falParam: 'seed', fieldType: 'number', default: 42 },
    ],
  },
```

- [ ] **Step 2: Verify the app compiles**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: No type errors

- [ ] **Step 3: Commit registry entry**

```bash
git add src/lib/fal/models.ts
git commit -m "feat: add qwen-edit-local to LOCAL_MODEL_REGISTRY"
```

---

### Task 4: Add IPC handler for qwen-edit-local

**Files:**
- Modify: `electron/ipc/local-models.ts`

- [ ] **Step 1: Add Qwen path constants and shared image resolver**

At the top of the file (after the LTX constants, line 9), add:

```typescript
const QWEN_EDIT_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'qwen-edit');
const QWEN_EDIT_PYTHON = path.join(QWEN_EDIT_REPO, '.venv', 'bin', 'python');
const QWEN_EDIT_SCRIPT = path.join(QWEN_EDIT_REPO, 'cinegen_infer.py');
```

Then extract the duplicated image URL resolution logic into a shared helper (add before `registerLocalModelHandlers`):

```typescript
async function resolveImageUrl(
  raw: string,
  jobId: string,
): Promise<{ imagePath: string; tempPath: string | null }> {
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const ext = path.extname(new URL(raw).pathname) || '.jpg';
    const tempPath = path.join(os.tmpdir(), `cinegen-img-${jobId}${ext}`);
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    const buf = await res.arrayBuffer();
    await fs.writeFile(tempPath, Buffer.from(buf));
    return { imagePath: tempPath, tempPath };
  } else if (raw.startsWith('local-media://file/')) {
    return { imagePath: decodeURIComponent(raw.replace('local-media://file', '')), tempPath: null };
  }
  return { imagePath: raw, tempPath: null };
}
```

- [ ] **Step 2: Add nodeType routing in the IPC handler**

Inside `ipcMain.handle('local-model:run', ...)` (currently lines 40–155), the handler currently assumes LTX for all local models. Refactor to route by `nodeType`.

Replace the body of the handler (after `jobs.set(jobId, job)` on line 51) with nodeType-based routing:

```typescript
    let proc: ReturnType<typeof spawn>;
    let tempImagePath: string | null = null;

    if (params.nodeType === 'qwen-edit-local') {
      // --- Qwen Image Edit ---
      const prompt = String(inputs.prompt ?? '');
      const num_inference_steps = Number(inputs.num_inference_steps ?? 50);
      const guidance_scale = Number(inputs.guidance_scale ?? 1.0);
      const true_cfg_scale = Number(inputs.true_cfg_scale ?? 4.0);
      const seed = Number(inputs.seed ?? 42);

      let image_path: string | null = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }
      if (!image_path) throw new Error('Qwen Image Edit requires an input image');

      const args: string[] = [
        QWEN_EDIT_SCRIPT,
        '--image_path', image_path,
        '--prompt', prompt,
        '--num_inference_steps', String(num_inference_steps),
        '--guidance_scale', String(guidance_scale),
        '--true_cfg_scale', String(true_cfg_scale),
        '--seed', String(seed),
      ];

      proc = spawn(QWEN_EDIT_PYTHON, args, {
        cwd: QWEN_EDIT_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    } else {
      // --- LTX (existing) ---
      const prompt = String(inputs.prompt ?? '');
      const resolution = String(inputs.resolution ?? '896x512');
      const { height, width } = RESOLUTION_MAP[resolution] ?? { height: 512, width: 896 };
      const frame_rate = Number(inputs.frame_rate ?? 24);
      const duration_secs = Number(inputs.duration_secs ?? 4);
      const raw_frames = Math.round((duration_secs * frame_rate) / 8) * 8 + 1;
      const num_frames = Math.max(9, raw_frames);
      const seed = Number(inputs.seed ?? 42);
      const enhance_prompt = Boolean(inputs.enhance_prompt);

      let image_path: string | null = null;
      if (inputs.image_url) {
        const resolved = await resolveImageUrl(String(inputs.image_url), jobId);
        image_path = resolved.imagePath;
        tempImagePath = resolved.tempPath;
      }

      const args: string[] = [
        LTX_SCRIPT,
        '--prompt', prompt,
        '--height', String(height),
        '--width', String(width),
        '--num_frames', String(num_frames),
        '--frame_rate', String(frame_rate),
        '--seed', String(seed),
      ];
      if (image_path) args.push('--image_path', image_path);
      if (enhance_prompt) args.push('--enhance_prompt');

      proc = spawn(LTX_PYTHON, args, {
        cwd: LTX_REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // --- Common stdout/stderr/lifecycle handling (unchanged) ---
```

The stdout JSON parsing, stderr suppression, error/close handlers, and progress forwarding remain exactly the same — they work generically for any local model since both scripts use the same JSON protocol.

- [ ] **Step 3: Verify the app compiles**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: No type errors

- [ ] **Step 4: Commit IPC handler**

```bash
git add electron/ipc/local-models.ts
git commit -m "feat: add qwen-edit-local routing in local model IPC handler"
```

---

## Chunk 3: Verification

### Task 5: Manual testing

- [ ] **Step 1: Run setup script**

```bash
cd ~/Desktop/Coding/qwen-edit && bash setup.sh
```

Expected: venv created, deps installed, model weights downloaded (~40GB).

- [ ] **Step 2: Test Python script standalone**

```bash
cd ~/Desktop/Coding/qwen-edit
.venv/bin/python cinegen_infer.py \
  --image_path /path/to/test-image.jpg \
  --prompt "Change the sky to sunset colors"
```

Expected: JSON progress lines on stdout, final `{"type": "done", "output_path": "..."}` with a valid PNG.

- [ ] **Step 3: Test in the app**

1. Start the Electron app
2. Open the Create tab
3. Switch to the "Local" tab in the node palette
4. Verify "Qwen Image Edit (Local)" appears alongside "LTX 2.3 (Local)"
5. Drag it onto the canvas
6. Connect an image source to the Image port
7. Enter an edit instruction in the Prompt port
8. Click Run
9. Verify the edited image appears in the node output

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address issues from manual testing"
```
