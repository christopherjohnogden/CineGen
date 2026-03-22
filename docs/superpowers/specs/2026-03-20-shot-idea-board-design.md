# Shot Idea Board Node — Design Spec

**Date:** 2026-03-20
**Status:** Approved

## Overview

A self-contained "Shot Board" node for the workflow canvas that generates 9 independent cinematic shots from a single reference image. Each shot uses a different camera angle/framing, and users can regenerate individual shots or all at once. The model powering generation is selectable via a dropdown inside the node.

## Node Registration

- **Type:** `shotBoard`
- **Category:** `utility`
- **Registry entry in `node-registry.ts`:**
  - Inputs: `image` port (reference image), `text` port (optional base prompt)
  - Outputs: none (results displayed within the node)
  - Default data: `selectedModel` (string, defaults to `'nano-banana-2'`), `shots` (array of 9 shot objects)

## Shot Definitions

Each shot has an editable prompt pre-filled with a default. All prompts are prefixed at execution time with:

> "Using the provided reference image. Same character face, costume, props, lighting, and atmosphere. Cinematic color grading. "

| # | Default Prompt |
|---|---------------|
| 1 | Establishing wide shot - full scene, character in context |
| 2 | Full body shot, straight-on |
| 3 | Full body shot, low angle looking up |
| 4 | Medium shot waist-up, front |
| 5 | Medium shot waist-up, side profile |
| 6 | Medium shot waist-up, over-the-shoulder angle |
| 7 | Close-up portrait, front |
| 8 | Close-up portrait, 3/4 turn |
| 9 | Extreme close-up, eyes and expression |

## Shot Data Structure

```typescript
interface ShotEntry {
  prompt: string;       // editable shot prompt
  url: string | null;   // generated image URL (null = not yet generated)
  status: 'idle' | 'running' | 'complete' | 'error';
  error?: string;
}
```

Stored in node config as `shots: ShotEntry[]` (length 9).

## Node Component — `shot-board-node.tsx`

### Layout

```
┌─────────────────────────────────────────┐
│ [IMG] Shot Board                        │
├─────────────────────────────────────────┤
│ Model: [Nano Banana 2 ▼]               │
├─────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │  Shot 1  │ │  Shot 2  │ │  Shot 3  │   │
│ │  [img]   │ │  [img]   │ │  [img]   │   │
│ │  ↻       │ │  ↻       │ │  ↻       │   │
│ └─────────┘ └─────────┘ └─────────┘   │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │  Shot 4  │ │  Shot 5  │ │  Shot 6  │   │
│ │  [img]   │ │  [img]   │ │  [img]   │   │
│ │  ↻       │ │  ↻       │ │  ↻       │   │
│ └─────────┘ └─────────┘ └─────────┘   │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │  Shot 7  │ │  Shot 8  │ │  Shot 9  │   │
│ │  [img]   │ │  [img]   │ │  [img]   │   │
│ │  ↻       │ │  ↻       │ │  ↻       │   │
│ └─────────┘ └─────────┘ └─────────┘   │
│                                         │
│ ┌──────────────────────────────────────┐│
│ │ Shot prompt text area (when cell     ││
│ │ is selected for editing)             ││
│ └──────────────────────────────────────┘│
├─────────────────────────────────────────┤
│ [Generate All]              [Clear All] │
└─────────────────────────────────────────┘
```

- **Width:** ~420px (wider than standard nodes)
- **Cell size:** ~120x120px
- **Each cell:** thumbnail (or placeholder with camera icon), shot label, regenerate button (↻), spinner overlay when running
- **Handles:** image input on left side, optional text input on left side
- **Interactive elements** use `nodrag` CSS class to prevent canvas drag interference

### Prompt Editing

Each cell's prompt is collapsed by default (shows just the label like "Wide shot"). Click on a cell to expand an inline text area below the grid for editing the prompt. This keeps the node compact while allowing customization.

### Model Selector

Dropdown at top of node listing all image-generation models filtered from `ALL_MODELS` where `category === 'image'`. Stored in config as `selectedModel` (the model's registry key, e.g. `'nano-banana-2'`, `'nano-banana-pro'`).

## Execution Logic

Execution is handled inside `shot-board-node.tsx`, not in `execute.ts`, since this node manages its own multi-call pattern.

### Generate Single Shot

1. **Validate:** Check that an API key exists via `getApiKey()` / `getKieApiKey()` (depending on model provider). Show error if missing.
2. **Resolve reference image:** Get connected image URL from the input port edge (same pattern as `model-node.tsx`'s `findConnectedInputUrl`). Show error if no image connected.
3. **Resolve base prompt:** If a text node is connected, read `sourceNode.data.config.prompt` or `sourceNode.data.result?.text` for the base prompt text.
4. **Look up model:** Get model definition from `ALL_MODELS` using `selectedModel` config key. Use `altId` (edit endpoint) when available, since a reference image is always provided.
5. **Build prompt:** `prefix + basePrompt (if any) + shot prompt`
6. **Build inputs:** Determine the correct input structure from the model definition:
   - Find the first `portType: 'image'` input field to get its `falParam`
   - If `falParam` ends with `s` (e.g. `image_urls`), wrap URL in an array: `[url]`
   - Otherwise pass as a string
7. **Call API:**
   ```typescript
   window.electronAPI.workflow.run({
     apiKey: getApiKey(),
     kieKey: getKieApiKey(),
     runpodKey: getRunpodApiKey(),
     runpodEndpointId: getRunpodEndpointId(nodeType),
     podUrl: getPodUrl(),
     nodeId,
     nodeType: selectedModel,
     modelId: effectiveModelId, // altId if available, otherwise id
     inputs: { prompt, [imageParam]: imageValue },
   });
   ```
8. **Extract result:** Use model's `responseMapping.path` to extract the image URL from the response.
9. **Update shot:** Set `url` and `status: 'complete'` (or `status: 'error'` with message) via `updateNodeData`.

### Generate All

Run all 9 shots with concurrency limit of 3 (to avoid API rate limiting) using a simple pool pattern. Each shot updates independently as it completes. Failures don't block other shots.

### Reference Image Resolution

Uses the same pattern as `model-node.tsx`'s `findConnectedInputUrl`:
- Find edges targeting this node's `image` handle
- Get the source node's result URL (`data.result?.url`) or config fileUrl (`data.config?.fileUrl`)
- The `workflow:run` handler resolves `local-media://` to HTTPS automatically via `resolveLocalMediaUrls`

### Text Input Resolution

For the optional base prompt port:
- Find edges targeting this node's `text` handle
- Get the source node's text value: `data.config?.prompt` (for prompt nodes) or `data.result?.text` (for text-output nodes)

## Per-Shot Loading UI

- **Idle:** Placeholder with camera icon and shot label
- **Running:** Spinner overlay on the cell, regenerate button disabled
- **Complete:** Generated image thumbnail
- **Error:** Red-tinted cell with error icon, tooltip shows error message

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/create/nodes/shot-board-node.tsx` | Node component with grid UI and execution logic |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/workflows/node-registry.ts` | Add `shotBoard` entry with inputs/outputs/defaults |
| `src/components/create/nodes/index.ts` | Add `shotBoard` to `nodeTypes` map |
| `src/styles/globals.css` | Add `.shot-board-node` styles for grid layout, cells, edit states |

## Edge Cases

- **No reference image connected:** Show inline error message, disable Generate buttons
- **No API key configured:** Show "No API key" error, disable Generate buttons
- **Model not found:** Fall back to `nano-banana-2`
- **API error on single shot:** Mark that cell as error with message, don't affect others
- **User changes model mid-generation:** Queue change, apply to next generation call
- **Base prompt connected:** Prepend connected text to every shot's prompt (after the fixed prefix, before the shot-specific text)
- **Result persistence:** Generated image URLs are HTTPS (from fal.ai storage) and survive save/reload. `local-media://` URLs are resolved to HTTPS before the API call, so stored results are always remote URLs.
