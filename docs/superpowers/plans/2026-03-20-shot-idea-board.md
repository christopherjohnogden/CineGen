# Shot Idea Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained "Shot Board" node that generates 9 independent cinematic shots from a reference image, each with a different camera angle, individually regeneratable.

**Architecture:** A single custom node component (`shot-board-node.tsx`) registered as a utility node. It renders a 3x3 image grid with per-cell regeneration and a model selector dropdown. Execution happens inside the component (not `execute.ts`) since it manages 9 independent API calls with concurrency control.

**Tech Stack:** React, ReactFlow (@xyflow/react), fal.ai client (via Electron IPC)

**Spec:** `docs/superpowers/specs/2026-03-20-shot-idea-board-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/components/create/nodes/shot-board-node.tsx` | **Create** — Node component: 3x3 grid UI, model selector, per-cell regeneration, execution logic |
| `src/lib/workflows/node-registry.ts` | **Modify** — Add `shotBoard` entry to `UTILITY_NODES` |
| `src/components/create/nodes/index.ts` | **Modify** — Add `ShotBoardNode` to `nodeTypes` map |
| `src/styles/globals.css` | **Modify** — Add `.shot-board-node` CSS styles |

---

### Task 1: Register the Shot Board node

**Files:**
- Modify: `src/lib/workflows/node-registry.ts`
- Modify: `src/components/create/nodes/index.ts`

- [ ] **Step 1: Add `shotBoard` to `UTILITY_NODES` in `node-registry.ts`**

Add this entry after the `filePicker` entry (around line 76):

```typescript
  shotBoard: {
    type: 'shotBoard',
    label: 'Shot Board',
    category: 'utility',
    inputs: [
      { id: 'image', type: 'image', label: 'Image' },
      { id: 'text', type: 'text', label: 'Prompt' },
    ],
    outputs: [],
    defaultData: {
      selectedModel: 'nano-banana-2',
      shots: [
        { prompt: 'Establishing wide shot - full scene, character in context', url: null, status: 'idle' },
        { prompt: 'Full body shot, straight-on', url: null, status: 'idle' },
        { prompt: 'Full body shot, low angle looking up', url: null, status: 'idle' },
        { prompt: 'Medium shot waist-up, front', url: null, status: 'idle' },
        { prompt: 'Medium shot waist-up, side profile', url: null, status: 'idle' },
        { prompt: 'Medium shot waist-up, over-the-shoulder angle', url: null, status: 'idle' },
        { prompt: 'Close-up portrait, front', url: null, status: 'idle' },
        { prompt: 'Close-up portrait, 3/4 turn', url: null, status: 'idle' },
        { prompt: 'Extreme close-up, eyes and expression', url: null, status: 'idle' },
      ],
    },
  },
```

- [ ] **Step 2: Create stub `ShotBoardNode` component and register it in `index.ts`**

Create `src/components/create/nodes/shot-board-node.tsx` with a minimal stub:

```tsx
import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { BaseNode } from './base-node';
import type { WorkflowNodeData } from '@/types/workflow';

type ShotBoardNodeProps = NodeProps & { data: WorkflowNodeData };

function ShotBoardNodeInner({ data, selected }: ShotBoardNodeProps) {
  return (
    <BaseNode nodeType="shotBoard" selected={!!selected}>
      <div style={{ padding: 8 }}>Shot Board (stub)</div>
    </BaseNode>
  );
}

export const ShotBoardNode = memo(ShotBoardNodeInner);
```

Add to `src/components/create/nodes/index.ts`:

```typescript
import { ShotBoardNode } from './shot-board-node';
```

And add `shotBoard: ShotBoardNode,` to the `nodeTypes` object (after `filePicker: FilePickerNode,`).

- [ ] **Step 3: Verify the node appears in the palette and can be placed on canvas**

Run the app, open the node palette (right-click canvas), search for "Shot Board". It should appear under utility. Place it — it should render with "Shot Board (stub)" text and two input handles (image, text) on the left.

- [ ] **Step 4: Commit**

```
feat: register Shot Board node in registry and palette
```

---

### Task 2: Build the Shot Board grid UI

**Files:**
- Modify: `src/components/create/nodes/shot-board-node.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add CSS styles for the shot board grid**

Add to the end of `src/styles/globals.css` (in the Node Editor section):

```css
/* ============================================
   Node Editor — Shot Board Node
   ============================================ */

.shot-board-node {
  width: 420px;
}

.shot-board-node__model-select {
  width: 100%;
  padding: 6px 8px;
  background: var(--bg-void);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  margin-bottom: 8px;
}
.shot-board-node__model-select:focus {
  border-color: var(--accent);
}

.shot-board-node__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}

.shot-board-node__cell {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.shot-board-node__cell:hover {
  border-color: var(--text-tertiary);
}
.shot-board-node__cell--selected {
  border-color: var(--accent);
}
.shot-board-node__cell--running {
  border-color: var(--accent);
}
.shot-board-node__cell--error {
  border-color: var(--error);
}

.shot-board-node__cell-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.shot-board-node__cell-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 4px;
  color: var(--text-tertiary);
  font-size: 10px;
  text-align: center;
  padding: 4px;
}

.shot-board-node__cell-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 2px 4px;
  background: rgba(0, 0, 0, 0.6);
  color: var(--text-secondary);
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shot-board-node__cell-regen {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.5);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--transition-fast), background var(--transition-fast);
}
.shot-board-node__cell:hover .shot-board-node__cell-regen,
.shot-board-node__cell--running .shot-board-node__cell-regen {
  opacity: 1;
}
.shot-board-node__cell-regen:hover {
  background: rgba(0, 0, 0, 0.8);
  color: var(--accent);
}

.shot-board-node__cell-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}

.shot-board-node__prompt-editor {
  margin-bottom: 8px;
}
.shot-board-node__prompt-editor textarea {
  width: 100%;
  padding: 6px 8px;
  background: var(--bg-void);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 11px;
  resize: vertical;
  min-height: 40px;
  outline: none;
  font-family: inherit;
}
.shot-board-node__prompt-editor textarea:focus {
  border-color: var(--accent);
}
.shot-board-node__prompt-editor-label {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-bottom: 3px;
}

.shot-board-node__actions {
  display: flex;
  gap: 6px;
}
.shot-board-node__actions button {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.shot-board-node__actions button:hover {
  background: var(--bg-raised);
  border-color: var(--text-tertiary);
}
.shot-board-node__actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.shot-board-node__actions button:first-child {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-void);
}
.shot-board-node__actions button:first-child:hover {
  opacity: 0.9;
}
```

- [ ] **Step 2: Build the full Shot Board node component**

Replace the stub in `src/components/create/nodes/shot-board-node.tsx` with:

```tsx
import { memo, useCallback, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, type Node } from '@xyflow/react';
import { ALL_MODELS, getModelDefinition } from '@/lib/fal/models';
import { CATEGORY_COLORS, PORT_COLORS } from '@/lib/workflows/node-registry';
import { getApiKey, getKieApiKey, getRunpodApiKey, getRunpodEndpointId, getPodUrl } from '@/lib/utils/api-key';
import type { WorkflowNodeData } from '@/types/workflow';

type ShotBoardNodeProps = NodeProps & { data: WorkflowNodeData };

interface ShotEntry {
  prompt: string;
  url: string | null;
  status: 'idle' | 'running' | 'complete' | 'error';
  error?: string;
}

const SHOT_LABELS = [
  'Wide', 'Full front', 'Low angle',
  'Medium front', 'Side profile', 'Over shoulder',
  'Close front', '3/4 turn', 'Extreme CU',
];

const PROMPT_PREFIX = 'Using the provided reference image. Same character face, costume, props, lighting, and atmosphere. Cinematic color grading. ';

const HEADER_HEIGHT = 36;
const PORT_SPACING = 24;

function ShotBoardNodeInner({ id, data, selected }: ShotBoardNodeProps) {
  const { updateNodeData, getEdges, getNode } = useReactFlow();
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const selectedModel = (data.config?.selectedModel as string) ?? 'nano-banana-2';
  const shots: ShotEntry[] = (data.config?.shots as ShotEntry[]) ?? [];

  const imageModels = Object.entries(ALL_MODELS)
    .filter(([, m]) => m.category === 'image')
    .map(([key, m]) => ({ key, name: m.name }));

  const findConnectedImageUrl = (): string | undefined => {
    const edges = getEdges();
    const edge = edges.find((e) => e.target === id && e.targetHandle === 'image');
    if (!edge) return undefined;
    const sourceNode = getNode(edge.source) as Node<WorkflowNodeData> | undefined;
    return sourceNode?.data?.result?.url
      ?? (sourceNode?.data?.config as Record<string, unknown>)?.fileUrl as string | undefined;
  };

  const findConnectedText = (): string | undefined => {
    const edges = getEdges();
    const edge = edges.find((e) => e.target === id && e.targetHandle === 'text');
    if (!edge) return undefined;
    const sourceNode = getNode(edge.source) as Node<WorkflowNodeData> | undefined;
    return (sourceNode?.data?.config as Record<string, unknown>)?.prompt as string | undefined
      ?? sourceNode?.data?.result?.text;
  };

  // Use a ref to avoid stale closures during concurrent Generate All
  const latestConfigRef = useRef(data.config);
  latestConfigRef.current = data.config;

  const updateShot = useCallback((index: number, update: Partial<ShotEntry>) => {
    const currentConfig = latestConfigRef.current;
    const currentShots = (currentConfig?.shots as ShotEntry[]) ?? [];
    const newShots = [...currentShots];
    newShots[index] = { ...newShots[index], ...update };
    const newConfig = { ...currentConfig, shots: newShots };
    latestConfigRef.current = newConfig;
    updateNodeData(id, { config: newConfig });
  }, [id, updateNodeData]);

  const generateShot = useCallback(async (index: number) => {
    const imageUrl = findConnectedImageUrl();
    if (!imageUrl) {
      updateShot(index, { status: 'error', error: 'No reference image connected' });
      return;
    }

    const modelDef = getModelDefinition(selectedModel);
    if (!modelDef) {
      updateShot(index, { status: 'error', error: 'Model not found' });
      return;
    }

    const provider = modelDef.provider ?? 'fal';
    const apiKey = provider === 'kie' ? getKieApiKey() : getApiKey();
    if (!apiKey) {
      updateShot(index, { status: 'error', error: `No ${provider} API key configured` });
      return;
    }

    updateShot(index, { status: 'running', error: undefined });

    try {
      const basePrompt = findConnectedText();
      const fullPrompt = PROMPT_PREFIX + (basePrompt ? basePrompt + ' ' : '') + shots[index].prompt;

      // Build image input based on model's falParam
      const imageField = modelDef.inputs.find((f) => f.portType === 'image' && f.fieldType === 'port');
      const imageParam = imageField?.falParam ?? 'image_urls';
      const imageValue = imageParam.endsWith('s') ? [imageUrl] : imageUrl;

      // Use altId (edit endpoint) when available since we always have a reference image
      const effectiveModelId = modelDef.altId ?? modelDef.id;

      const result = await window.electronAPI.workflow.run({
        apiKey: getApiKey(),
        kieKey: getKieApiKey(),
        runpodKey: getRunpodApiKey(),
        runpodEndpointId: getRunpodEndpointId(selectedModel),
        podUrl: getPodUrl(),
        nodeId: id,
        nodeType: selectedModel,
        modelId: effectiveModelId,
        inputs: { prompt: fullPrompt, [imageParam]: imageValue },
      });

      // Extract URL from result using the model's response mapping
      const resultData = (result as Record<string, unknown>)?.data ?? result;
      const urlPath = modelDef.responseMapping.path;
      let url: string | undefined;
      const parts = urlPath.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current: unknown = resultData;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') { current = undefined; break; }
        current = (current as Record<string, unknown>)[part];
      }
      url = typeof current === 'string' ? current : undefined;

      if (url) {
        updateShot(index, { status: 'complete', url });
      } else {
        updateShot(index, { status: 'error', error: 'No image in response' });
      }
    } catch (err) {
      updateShot(index, { status: 'error', error: err instanceof Error ? err.message : 'Generation failed' });
    }
  }, [id, data.config, shots, selectedModel, updateNodeData, getEdges, getNode]);

  const generateAll = useCallback(async () => {
    // Concurrency limit of 3
    const indices = shots.map((_, i) => i);
    const pool: Promise<void>[] = [];
    let next = 0;

    const runNext = async (): Promise<void> => {
      while (next < indices.length) {
        const idx = next++;
        await generateShot(idx);
      }
    };

    for (let i = 0; i < Math.min(3, indices.length); i++) {
      pool.push(runNext());
    }
    await Promise.allSettled(pool);
  }, [shots, generateShot]);

  const clearAll = useCallback(() => {
    const cleared = shots.map((s) => ({ ...s, url: null, status: 'idle' as const, error: undefined }));
    updateNodeData(id, { config: { ...data.config, shots: cleared } });
    setSelectedCell(null);
  }, [id, data.config, shots, updateNodeData]);

  const anyRunning = shots.some((s) => s.status === 'running');
  const accentColor = CATEGORY_COLORS['utility'];

  return (
    <div className={`cinegen-node shot-board-node${selected ? ' cinegen-node--selected' : ''}`}>
      <div className="cinegen-node__accent" style={{ background: accentColor }} />
      <div className="cinegen-node__content">
        <div className="cinegen-node__header">Shot Board</div>
        <div className="cinegen-node__body">
          {/* Model selector */}
          <select
            className="shot-board-node__model-select nodrag"
            value={selectedModel}
            onChange={(e) => updateNodeData(id, { config: { ...data.config, selectedModel: e.target.value } })}
          >
            {imageModels.map((m) => (
              <option key={m.key} value={m.key}>{m.name}</option>
            ))}
          </select>

          {/* 3x3 Grid */}
          <div className="shot-board-node__grid nodrag">
            {shots.map((shot, i) => (
              <div
                key={i}
                className={[
                  'shot-board-node__cell',
                  selectedCell === i && 'shot-board-node__cell--selected',
                  shot.status === 'running' && 'shot-board-node__cell--running',
                  shot.status === 'error' && 'shot-board-node__cell--error',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedCell(selectedCell === i ? null : i)}
                title={shot.status === 'error' ? shot.error : shot.prompt}
              >
                {shot.url ? (
                  <img className="shot-board-node__cell-img" src={shot.url} alt={SHOT_LABELS[i]} />
                ) : (
                  <div className="shot-board-node__cell-placeholder">
                    <span style={{ fontSize: 18 }}>🎬</span>
                    <span>{SHOT_LABELS[i]}</span>
                  </div>
                )}
                <span className="shot-board-node__cell-label">{SHOT_LABELS[i]}</span>
                {shot.status === 'running' && (
                  <div className="shot-board-node__cell-spinner">⏳</div>
                )}
                <button
                  className="shot-board-node__cell-regen"
                  onClick={(e) => { e.stopPropagation(); generateShot(i); }}
                  disabled={anyRunning}
                  title="Regenerate"
                >
                  ↻
                </button>
              </div>
            ))}
          </div>

          {/* Prompt editor for selected cell */}
          {selectedCell !== null && (
            <div className="shot-board-node__prompt-editor nodrag">
              <div className="shot-board-node__prompt-editor-label">
                Shot {selectedCell + 1}: {SHOT_LABELS[selectedCell]}
              </div>
              <textarea
                value={shots[selectedCell]?.prompt ?? ''}
                onChange={(e) => updateShot(selectedCell, { prompt: e.target.value })}
                rows={2}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="shot-board-node__actions">
            <button onClick={generateAll} disabled={anyRunning}>
              {anyRunning ? 'Generating...' : '→ Generate All'}
            </button>
            <button onClick={clearAll} disabled={anyRunning}>
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{
          background: PORT_COLORS['image'],
          width: 12, height: 12, borderRadius: '50%',
          border: '2px solid var(--bg-raised)',
          top: HEADER_HEIGHT + PORT_SPACING / 2,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{
          background: PORT_COLORS['text'],
          width: 12, height: 12, borderRadius: '50%',
          border: '2px solid var(--bg-raised)',
          top: HEADER_HEIGHT + PORT_SPACING + PORT_SPACING / 2,
        }}
      />

      {/* Port labels */}
      <span
        className="base-node__port-label base-node__port-label--left"
        style={{ top: HEADER_HEIGHT + PORT_SPACING / 2 }}
      >
        Image
      </span>
      <span
        className="base-node__port-label base-node__port-label--left"
        style={{ top: HEADER_HEIGHT + PORT_SPACING + PORT_SPACING / 2 }}
      >
        Prompt
      </span>
    </div>
  );
}

export const ShotBoardNode = memo(ShotBoardNodeInner);
```

- [ ] **Step 3: Verify the grid renders correctly**

Run the app. Place a Shot Board node. It should show:
- Model dropdown (defaults to Nano Banana 2)
- 3x3 grid of placeholder cells with camera emoji and short labels
- Click a cell to see its editable prompt below the grid
- "Generate All" and "Clear All" buttons at bottom
- Two input handles on the left (green for image, gray for text)

- [ ] **Step 4: Commit**

```
feat: build Shot Board node grid UI with model selector and prompt editing
```

---

### Task 3: Wire up execution and test end-to-end

**Files:**
- Modify: `src/components/create/nodes/shot-board-node.tsx` (already contains execution logic from Task 2)

- [ ] **Step 1: Test single shot generation**

1. Place a File Upload node, upload a reference image
2. Place a Shot Board node
3. Connect File Upload → Shot Board's Image input
4. Click the ↻ button on one cell
5. Verify: cell shows spinner → image appears on success, or red border + error tooltip on failure

- [ ] **Step 2: Test Generate All**

1. Same setup as above
2. Click "Generate All"
3. Verify: cells generate with concurrency (max 3 at once), each cell updates independently

- [ ] **Step 3: Test prompt editing**

1. Click a cell to select it
2. Edit the prompt in the text area below the grid
3. Regenerate that cell
4. Verify: the new prompt is used

- [ ] **Step 4: Test base prompt connection**

1. Add a Prompt node, type "anime style"
2. Connect Prompt → Shot Board's Prompt input
3. Generate a shot
4. Verify: the prompt sent to the API includes "anime style" between the prefix and shot prompt

- [ ] **Step 5: Test error states**

1. Try generating without connecting an image — should show "No reference image connected" error on the cell
2. Remove your API key from settings, try generating — should show "No fal API key configured" error

- [ ] **Step 6: Test Clear All**

Click "Clear All" — all cells reset to placeholders, selected cell deselects

- [ ] **Step 7: Commit**

```
feat: Shot Board execution with per-cell regeneration and concurrency control
```

---

### Task 4: Polish and edge cases

**Files:**
- Modify: `src/components/create/nodes/shot-board-node.tsx`

- [ ] **Step 1: Handle model change**

Change the model dropdown. Verify new generations use the newly selected model. Existing results should remain until regenerated.

- [ ] **Step 2: Test with different models**

Try generating with at least 2 different models (e.g. Nano Banana 2 and Nano Banana Pro). Verify both work correctly — the `falParam` and `altId` logic should adapt to each model's definition.

- [ ] **Step 3: Test save/reload persistence**

1. Generate some shots
2. Switch to a different space and back
3. Verify results persist (URLs are HTTPS from fal storage)

- [ ] **Step 4: Final commit**

```
feat: complete Shot Board node with full generation pipeline
```
