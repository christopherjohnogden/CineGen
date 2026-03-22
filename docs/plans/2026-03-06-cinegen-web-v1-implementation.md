# CINEGEN Web v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a node-based AI media generation web app with fal.ai, featuring a Create canvas, visual timeline editor, and MP4 export.

**Architecture:** Monolithic Next.js 16 App Router with React Flow for the node canvas, custom React components for the visual timeline, and Remotion for server-side video export. Single-page with client-side tab switching. All state managed via React context + useReducer.

**Tech Stack:** Next.js 16, TypeScript, @xyflow/react, @fal-ai/client, Remotion, Zod, Vitest, vanilla CSS with custom properties.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`

**Step 1: Initialize Next.js project**

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-eslint --no-src-dir --import-alias "@/*"
```

If the directory is not empty, run with `--yes` flag or manually create files.

**Step 2: Install dependencies**

```bash
npm install @xyflow/react @fal-ai/client zod
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

Note: Remotion will be installed in a later task when we build the Export tab.

**Step 3: Create `.env.example`**

```
FAL_KEY=your_fal_ai_key_here
FAL_IMAGE_MODEL=fal-ai/fast-sdxl
FAL_VIDEO_MODEL=fal-ai/minimax/video-01-live
CINEGEN_DATA_ROOT=.data/dev
```

**Step 4: Create `.gitignore`**

Ensure it includes:
```
node_modules/
.next/
.data/
.env
.env.local
```

**Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

**Step 6: Create `tests/setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest';
```

**Step 7: Update `package.json` scripts**

Add to scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 8: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold Next.js project with dependencies"
```

---

### Task 2: Design Tokens & Global Styles

**Files:**
- Create: `app/globals.css`

**Step 1: Write globals.css with all design tokens and base styles**

This single file contains:
1. CSS custom properties (all design tokens from the spec)
2. Font imports (Outfit from Google Fonts, Space Mono)
3. Reset/base styles
4. Utility classes for the dark theme

Key tokens:
```css
:root {
  --bg-void: #08090c;
  --bg-base: #0d0f14;
  --bg-raised: #13161e;
  --bg-elevated: #191d28;
  --bg-overlay: #1f2433;
  --bg-input: #0f1119;
  --text-primary: #e8e4df;
  --text-secondary: #8e8a82;
  --text-tertiary: #5c5851;
  --accent: #d4a054;
  --accent-hover: #e0b06a;
  --success: #5cb87a;
  --error: #c75450;
  --port-image: #5cb87a;
  --port-video: #d4a054;
  --port-text: #8e8a82;
  --port-number: #5b8fd4;
  --port-config: #a06cd5;
  --port-model: #cf7d60;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-medium: rgba(255, 255, 255, 0.10);
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

Body: `background: var(--bg-void); color: var(--text-primary); font-family: 'Outfit', sans-serif;`

**Step 2: Write root layout (`app/layout.tsx`)**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CINEGEN',
  description: 'Node-based AI media generation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add design tokens and global dark theme styles"
```

---

### Task 3: TypeScript Types

**Files:**
- Create: `types/workflow.ts`
- Create: `types/editor.ts`
- Create: `types/project.ts`
- Create: `types/export.ts`
- Create: `types/workspace.ts`

**Step 1: Write `types/workflow.ts`**

```typescript
export type PortType = 'text' | 'image' | 'video' | 'number' | 'config' | 'model';

export type NodeCategory = 'input' | 'generate' | 'output';

export type CinegenNodeType =
  | 'prompt'
  | 'modelSelect'
  | 'styleSeed'
  | 'duration'
  | 'imageGenerate'
  | 'videoGenerate'
  | 'assetOutput';

export interface PortDefinition {
  id: string;
  type: PortType;
  label: string;
}

export interface NodeTypeDefinition {
  type: CinegenNodeType;
  label: string;
  category: NodeCategory;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaultData: Record<string, unknown>;
}

export interface WorkflowNodeData {
  type: CinegenNodeType;
  label: string;
  config: Record<string, unknown>;
  result?: { url?: string; status?: 'idle' | 'running' | 'complete' | 'error'; error?: string };
}

export interface WorkflowRun {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  startedAt: string;
  completedAt?: string;
  nodeResults: Record<string, { status: string; output?: unknown; error?: string }>;
}
```

**Step 2: Write `types/editor.ts`**

```typescript
export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  name: string;
}

export interface Track {
  id: string;
  name: string;
  clips: Clip[];
}

export interface Sequence {
  id: string;
  tracks: Track[];
  duration: number;
}
```

**Step 3: Write `types/project.ts`**

```typescript
export interface Asset {
  id: string;
  name: string;
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
```

**Step 4: Write `types/export.ts`**

```typescript
export type ExportPreset = 'draft' | 'standard' | 'high';
export type ExportStatus = 'queued' | 'rendering' | 'complete' | 'failed';

export interface ExportJob {
  id: string;
  status: ExportStatus;
  progress: number;
  preset: ExportPreset;
  fps: 24 | 30 | 60;
  outputUrl?: string;
  fileSize?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
```

**Step 5: Write `types/workspace.ts`**

```typescript
import type { Node, Edge } from '@xyflow/react';
import type { Asset } from './project';
import type { Sequence } from './editor';
import type { ExportJob } from './export';
import type { WorkflowNodeData, WorkflowRun } from './workflow';

export type ProjectTab = 'create' | 'edit' | 'export';

export interface WorkspaceState {
  activeTab: ProjectTab;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  assets: Asset[];
  sequence: Sequence;
  currentRun: WorkflowRun | null;
  runningNodeIds: Set<string>;
  exports: ExportJob[];
}
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add TypeScript type definitions for workflow, editor, project, export"
```

---

### Task 4: Workspace Shell & Top Nav

**Files:**
- Create: `components/workspace/workspace-shell.tsx`
- Create: `components/workspace/top-tabs.tsx`
- Create: `components/workspace/status-indicator.tsx`
- Modify: `app/page.tsx`

**Step 1: Write `components/workspace/top-tabs.tsx`**

The top nav bar component:
- Fixed height 52px
- CINEGEN wordmark centered (uppercase, letter-spaced, Outfit font)
- Three tab buttons on the left: Create | Edit | Export
- Status indicator on the right
- Background: `var(--bg-base)` with bottom border `var(--border-subtle)`
- Active tab: amber accent underline + `var(--text-primary)` text
- Inactive tab: `var(--text-secondary)` text, hover brightens

Props: `activeTab`, `onTabChange`, `status` (idle/running/error)

**Step 2: Write `components/workspace/status-indicator.tsx`**

A small dot with three states:
- Idle: `var(--success)` dot, slow pulse (2.4s)
- Running: `var(--accent)` dot, fast pulse (0.6s)
- Error: `var(--error)` dot, no pulse

CSS keyframes for the pulse animation.

**Step 3: Write `components/workspace/workspace-shell.tsx`**

The main client component (`'use client'`):
- Uses `useReducer` for workspace state
- Provides state via React context
- Renders TopTabs + active tab content
- Tab content: conditionally renders CreateTab, EditTab, or ExportTab
- Manages assets array shared across tabs
- Handles debounced save to API (300ms debounce using `useRef` + `setTimeout`)

Reducer actions:
- `SET_TAB`
- `SET_NODES`, `SET_EDGES`
- `ADD_ASSET`, `REMOVE_ASSET`
- `SET_SEQUENCE`
- `SET_RUN_STATUS`, `SET_NODE_RUNNING`, `SET_NODE_RESULT`
- `ADD_EXPORT`, `UPDATE_EXPORT`

**Step 4: Wire up `app/page.tsx`**

```tsx
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default function Home() {
  return <WorkspaceShell />;
}
```

**Step 5: Add CSS for workspace components to `globals.css`**

Nav styles, tab buttons, status indicator animations.

**Step 6: Verify it runs**

```bash
npm run dev
```

Open http://localhost:3000 — should see dark background with top nav bar, three tabs, CINEGEN wordmark.

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add workspace shell with top nav tabs and status indicator"
```

---

### Task 5: Node Type Registry

**Files:**
- Create: `lib/workflows/node-registry.ts`

**Step 1: Write the node type registry**

A map of all `CinegenNodeType` values to their `NodeTypeDefinition`. This defines what ports each node has, its category, default data, and label.

```typescript
import type { NodeTypeDefinition } from '@/types/workflow';

export const NODE_REGISTRY: Record<string, NodeTypeDefinition> = {
  prompt: {
    type: 'prompt',
    label: 'Prompt',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'text', type: 'text', label: 'text' }],
    defaultData: { prompt: '' },
  },
  modelSelect: {
    type: 'modelSelect',
    label: 'Model Select',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'model', type: 'model', label: 'model' }],
    defaultData: { category: 'image', model: '' },
  },
  styleSeed: {
    type: 'styleSeed',
    label: 'Style / Seed',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'config', type: 'config', label: 'config' }],
    defaultData: { preset: 'quality', seed: -1, cfgScale: 7.5 },
  },
  duration: {
    type: 'duration',
    label: 'Duration',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'number', type: 'number', label: 'seconds' }],
    defaultData: { seconds: 5 },
  },
  imageGenerate: {
    type: 'imageGenerate',
    label: 'Image Generate',
    category: 'generate',
    inputs: [
      { id: 'text', type: 'text', label: 'prompt' },
      { id: 'model', type: 'model', label: 'model' },
      { id: 'config', type: 'config', label: 'config' },
    ],
    outputs: [{ id: 'image', type: 'image', label: 'image' }],
    defaultData: {},
  },
  videoGenerate: {
    type: 'videoGenerate',
    label: 'Video Generate',
    category: 'generate',
    inputs: [
      { id: 'text', type: 'text', label: 'prompt' },
      { id: 'model', type: 'model', label: 'model' },
      { id: 'config', type: 'config', label: 'config' },
      { id: 'number', type: 'number', label: 'seconds' },
    ],
    outputs: [{ id: 'video', type: 'video', label: 'video' }],
    defaultData: {},
  },
  assetOutput: {
    type: 'assetOutput',
    label: 'Asset Output',
    category: 'output',
    inputs: [
      { id: 'image', type: 'image', label: 'image' },
      { id: 'video', type: 'video', label: 'video' },
    ],
    outputs: [],
    defaultData: { name: 'Untitled' },
  },
};
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add node type registry with port definitions"
```

---

### Task 6: Custom Node Components

**Files:**
- Create: `components/create/nodes/base-node.tsx`
- Create: `components/create/nodes/prompt-node.tsx`
- Create: `components/create/nodes/model-select-node.tsx`
- Create: `components/create/nodes/style-seed-node.tsx`
- Create: `components/create/nodes/duration-node.tsx`
- Create: `components/create/nodes/image-generate-node.tsx`
- Create: `components/create/nodes/video-generate-node.tsx`
- Create: `components/create/nodes/asset-output-node.tsx`
- Create: `components/create/nodes/index.ts`

**Step 1: Write `base-node.tsx`**

A wrapper component all custom nodes use. It provides:
- Dark card shell: `var(--bg-raised)` background, rounded corners, `var(--border-subtle)` border
- Left accent stripe (5px, color based on node category: input=blue, generate=amber, output=green)
- Uppercase header strip with `var(--bg-elevated)` background
- Handle (port) rendering: maps the node's input/output ports to `<Handle>` components with correct positions (inputs on left, outputs on right)
- Handle colors based on port type using the `--port-*` CSS variables
- Handle hit area: 12x12 visible, larger invisible hit area
- Selected state: brighter border + subtle glow
- Generating state: pulsing border ring (`ne-node-generating-target` class)

Uses React Flow's `Handle` component from `@xyflow/react`:
```tsx
import { Handle, Position } from '@xyflow/react';
```

Props: `id`, `selected`, `isRunning`, `nodeType` (for registry lookup), `children` (body content)

**Step 2: Write each node component**

Each is a `memo`-wrapped component that renders `<BaseNode>` with specific body content:

- **`prompt-node.tsx`**: Multi-line `<textarea>` with `var(--bg-input)` background, updates node data on change. Placeholder: "Describe what to generate..."
- **`model-select-node.tsx`**: Two `<select>` dropdowns — Category (image/video) and Model (populated from `lib/fal/models.ts` which will be created in Task 8). Uses `var(--bg-input)` styled selects.
- **`style-seed-node.tsx`**: Three preset buttons (Fast Draft / Quality / Cinematic) styled as pill toggles with active state. Seed number `<input>`. CFG scale `<input type="range">` slider.
- **`duration-node.tsx`**: `<input type="range">` slider from 1-30 with current value label.
- **`image-generate-node.tsx`**: Shows "Generate" button (amber accent). When result exists, shows thumbnail preview. Status badge (idle/running/complete/error).
- **`video-generate-node.tsx`**: Same as image-generate but for video. Thumbnail is a poster frame.
- **`asset-output-node.tsx`**: Text input for asset name. "Send to Edit" button. Shows linked asset if one exists.

**Step 3: Write `index.ts` barrel export + nodeTypes map**

```typescript
import { PromptNode } from './prompt-node';
import { ModelSelectNode } from './model-select-node';
// ... etc

export const nodeTypes = {
  prompt: PromptNode,
  modelSelect: ModelSelectNode,
  styleSeed: StyleSeedNode,
  duration: DurationNode,
  imageGenerate: ImageGenerateNode,
  videoGenerate: VideoGenerateNode,
  assetOutput: AssetOutputNode,
};
```

**Step 4: Add node CSS to `globals.css`**

Node card styles, handle styles, hover/selected/generating states, textarea/select/slider styles within nodes.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add custom node components with dark theme styling"
```

---

### Task 7: Custom Edge Component (Pulsing Animation)

**Files:**
- Create: `components/create/edges/animated-edge.tsx`

**Step 1: Write the custom edge**

Uses React Flow's `BaseEdge` and `getBezierPath`:

```tsx
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
```

The edge has three visual states:
1. **Default**: Solid path, stroke-width 2, opacity 0.6, color from source port type
2. **Selected**: Stroke-width 3, dashed `6 3`, animated dash offset (`.ne-edge-selected`)
3. **Generating**: Dashed `6 3`, animated dash offset 0.4s linear infinite, drop-shadow glow (`.ne-edge-generating`)

The `data` prop carries `{ sourcePortType, isGenerating }`.

**Step 2: Add edge animation CSS to `globals.css`**

```css
@keyframes ne-edge-march {
  to { stroke-dashoffset: -9; }
}

.ne-edge-generating path {
  stroke-dasharray: 6 3;
  animation: ne-edge-march 0.4s linear infinite;
  filter: drop-shadow(0 0 4px currentColor);
}

.ne-edge-selected path {
  stroke-dasharray: 6 3;
  animation: ne-edge-march 0.4s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .ne-edge-generating path,
  .ne-edge-selected path {
    animation: none;
    stroke-dasharray: none;
    opacity: 1;
  }
}
```

**Step 3: Register edge type**

```typescript
export const edgeTypes = { animated: AnimatedEdge };
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add animated edge component with generating pulse effect"
```

---

### Task 8: fal.ai Client & Model Config

**Files:**
- Create: `lib/config/env.ts`
- Create: `lib/fal/client.ts`
- Create: `lib/fal/models.ts`

**Step 1: Write `lib/config/env.ts`**

```typescript
function getEnvVar(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

export const env = {
  falKey: () => getEnvVar('FAL_KEY'),
  falImageModel: () => getEnvVar('FAL_IMAGE_MODEL', 'fal-ai/fast-sdxl'),
  falVideoModel: () => getEnvVar('FAL_VIDEO_MODEL', 'fal-ai/minimax/video-01-live'),
  dataRoot: () => getEnvVar('CINEGEN_DATA_ROOT', '.data/dev'),
};
```

**Step 2: Write `lib/fal/client.ts`**

Server-only fal.ai wrapper. Uses `@fal-ai/client`:

```typescript
import { fal } from '@fal-ai/client';
import { env } from '@/lib/config/env';

fal.config({ credentials: env.falKey() });

export async function generateImage(model: string, input: Record<string, unknown>) {
  const result = await fal.subscribe(model, {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      // Could be used for progress tracking
    },
  });
  return result;
}

export async function generateVideo(model: string, input: Record<string, unknown>) {
  const result = await fal.subscribe(model, {
    input,
    logs: true,
  });
  return result;
}
```

**Step 3: Write `lib/fal/models.ts`**

Client-safe model definitions (no API keys):

```typescript
export interface ModelDefinition {
  id: string;
  name: string;
  category: 'image' | 'video';
  description: string;
}

export const FAL_MODELS: ModelDefinition[] = [
  { id: 'fal-ai/fast-sdxl', name: 'Fast SDXL', category: 'image', description: 'Fast image generation' },
  { id: 'fal-ai/flux/dev', name: 'FLUX Dev', category: 'image', description: 'High quality images' },
  { id: 'fal-ai/minimax/video-01-live', name: 'MiniMax Video', category: 'video', description: 'Video generation' },
];
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add fal.ai client wrapper and model definitions"
```

---

### Task 9: Spacebar Command Palette

**Files:**
- Create: `components/create/node-palette.tsx`

**Step 1: Write the palette component**

A floating panel that appears at the cursor position when Space is pressed:
- Position: absolute, anchored to mouse position on the React Flow canvas
- Background: `var(--bg-elevated)`, border: `var(--border-medium)`, rounded `var(--radius-lg)`
- Shadow: subtle layered shadow for depth
- Width: ~260px

Structure:
1. Search input at top (autofocused, `var(--bg-input)` background, placeholder "Search nodes...")
2. Category headers: uppercase, `var(--text-tertiary)`, letter-spaced (matching screenshots)
3. Node items: `var(--text-primary)` text, hover background `var(--bg-overlay)`
4. Categories: INPUT, GENERATE, OUTPUT
5. Items filtered by search input

Keyboard navigation:
- Arrow up/down to move selection
- Enter to insert selected node
- Escape to close

Props: `position: { x, y }`, `onSelect: (nodeType: CinegenNodeType) => void`, `onClose: () => void`

**Step 2: Add palette CSS to `globals.css`**

Floating panel, search input, category headers, item hover states, keyboard selection highlight.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add spacebar command palette for node insertion"
```

---

### Task 10: Workflow Canvas (Create Tab)

**Files:**
- Create: `components/create/create-tab.tsx`
- Create: `components/create/workflow-canvas.tsx`

**Step 1: Write `components/create/workflow-canvas.tsx`**

The main React Flow canvas:

```tsx
import { ReactFlow, Background, BackgroundVariant, useNodesState, useEdgesState, addEdge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges/animated-edge';
```

Features:
- Dark dot grid background (`BackgroundVariant.Dots`, gap 20, size 1, color `var(--text-tertiary)` at 0.3 opacity)
- Pan/zoom controls
- Spacebar listener: on keydown Space (if not in textarea/input), opens NodePalette at current mouse position
- On palette select: creates new node at that canvas position using `NODE_REGISTRY` defaults
- On connect: validates port type compatibility (source output type must match target input type), then adds edge with `animated` type and source port type data
- Passes `runningNodeIds` from workspace context to node components for generating state
- "Run Workflow" button floating top-right

Reads/writes nodes and edges from workspace context.

**Step 2: Write `components/create/create-tab.tsx`**

Simple wrapper that renders WorkflowCanvas full-height (minus nav bar height).

```tsx
export function CreateTab() {
  return (
    <div className="create-tab">
      <WorkflowCanvas />
    </div>
  );
}
```

CSS: `.create-tab { height: calc(100vh - 52px); width: 100%; }`

**Step 3: Verify the canvas renders**

```bash
npm run dev
```

Should see dark canvas with dot grid, spacebar opens palette, can add and connect nodes.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add workflow canvas with node palette and edge connections"
```

---

### Task 11: Workflow Execution Engine

**Files:**
- Create: `lib/workflows/topo-sort.ts`
- Create: `lib/workflows/execute.ts`
- Create: `lib/utils/ids.ts`

**Step 1: Write `lib/utils/ids.ts`**

```typescript
export function generateId(): string {
  return crypto.randomUUID();
}

export function timestamp(): string {
  return new Date().toISOString();
}
```

**Step 2: Write `lib/workflows/topo-sort.ts`**

Topological sort of workflow nodes based on edges. Returns ordered array of node IDs. Throws if cycle detected.

```typescript
import type { Node, Edge } from '@xyflow/react';

export function topologicalSort(nodes: Node[], edges: Edge[]): string[] {
  // Kahn's algorithm
  // Build adjacency list and in-degree map from edges
  // Return ordered node IDs
}
```

**Step 3: Write `lib/workflows/execute.ts`**

Orchestrates running a workflow:
1. Topological sort
2. For each node in order, resolve inputs from connected source node outputs
3. For generate nodes: call API route to trigger fal.ai
4. Update node results in workspace state
5. Report status changes (running/complete/error per node)

This is a client-side function that calls API routes — it does NOT call fal.ai directly.

```typescript
export async function executeWorkflow(
  nodes: Node[],
  edges: Edge[],
  dispatch: (action: WorkspaceAction) => void,
): Promise<void> {
  // ...
}
```

**Step 4: Write test for topological sort**

```typescript
// tests/lib/workflows/topo-sort.test.ts
import { topologicalSort } from '@/lib/workflows/topo-sort';
// Test: linear chain A->B->C returns [A,B,C]
// Test: diamond A->B, A->C, B->D, C->D returns valid topo order
// Test: cycle throws error
```

**Step 5: Run tests**

```bash
npm test
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add workflow execution engine with topological sort"
```

---

### Task 12: API Routes (Generation)

**Files:**
- Create: `app/api/workflows/route.ts`
- Create: `app/api/jobs/[id]/route.ts`
- Create: `lib/validation/schemas.ts`

**Step 1: Write `lib/validation/schemas.ts`**

Zod schemas for API request validation:

```typescript
import { z } from 'zod';

export const runWorkflowSchema = z.object({
  nodeId: z.string(),
  nodeType: z.enum(['imageGenerate', 'videoGenerate']),
  inputs: z.object({
    prompt: z.string().optional(),
    model: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    seconds: z.number().optional(),
  }),
});
```

**Step 2: Write `app/api/workflows/route.ts`**

- `POST`: Receives node execution request, calls `lib/fal/client.ts` to run generation, returns result (image/video URL).
- Uses `fal.subscribe()` for queue-based execution with status updates.
- Returns `{ requestId, status }` initially, then result when done.

**Step 3: Write `app/api/jobs/[id]/route.ts`**

- `GET`: Polls status of a fal.ai job by request ID. Returns current status + result if complete.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add API routes for workflow execution and job polling"
```

---

### Task 13: Persistence Layer

**Files:**
- Create: `lib/persistence/store.ts`
- Create: `app/api/project/route.ts`
- Create: `app/api/sequences/route.ts`

**Step 1: Write `lib/persistence/store.ts`**

File-based JSON storage:
- Reads/writes a single `project.json` file under `CINEGEN_DATA_ROOT`
- Contains: project metadata, workflow (nodes + edges), sequence (tracks + clips), assets, exports
- Atomic writes using write-to-temp-then-rename pattern
- Creates data directory if it doesn't exist

```typescript
import { env } from '@/lib/config/env';
import fs from 'fs/promises';
import path from 'path';

const dataPath = () => path.join(process.cwd(), env.dataRoot(), 'project.json');
```

**Step 2: Write `app/api/project/route.ts`**

- `GET`: Returns full project snapshot
- `PATCH`: Merges partial update into project

**Step 3: Write `app/api/sequences/route.ts`**

- `PUT`: Saves timeline sequence

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add file-based persistence and project API routes"
```

---

### Task 14: Edit Tab (Visual Timeline)

**Files:**
- Create: `components/edit/edit-tab.tsx`
- Create: `components/edit/preview-player.tsx`
- Create: `components/edit/asset-drawer.tsx`
- Create: `components/edit/timeline-editor.tsx`
- Create: `components/edit/track-row.tsx`
- Create: `components/edit/clip-card.tsx`
- Create: `lib/editor/timeline.ts`

**Step 1: Write `lib/editor/timeline.ts`**

Pure functions for timeline manipulation:
- `addClipToTrack(sequence, trackId, assetId, position)` → new Sequence
- `moveClip(sequence, clipId, newTrackId, newStartTime)` → new Sequence
- `trimClip(sequence, clipId, trimStart, trimEnd)` → new Sequence
- `splitClip(sequence, clipId, splitTime)` → new Sequence
- `removeClip(sequence, clipId)` → new Sequence
- `calculateSequenceDuration(sequence)` → number
- `addTrack(sequence, name)` → new Sequence
- `removeTrack(sequence, trackId)` → new Sequence

All pure, return new objects (immutable).

**Step 2: Write `components/edit/preview-player.tsx`**

Preview monitor:
- Takes about 50% of the edit tab height
- Background: `var(--bg-base)` with centered media
- Shows the asset at the current playhead position
- For images: renders `<img>`
- For videos: renders `<video>` with custom controls
- Transport bar below: play/pause button, scrub slider, timecode display (MM:SS.ff), fullscreen toggle
- Styled with amber accent for active controls

**Step 3: Write `components/edit/asset-drawer.tsx`**

Collapsible horizontal strip:
- Toggle button to show/hide
- Horizontal scrollable row of asset cards
- Each card: thumbnail, name, type badge (image/video), duration if video
- Drag-and-drop: `draggable="true"`, `onDragStart` sets asset ID in dataTransfer

**Step 4: Write `components/edit/clip-card.tsx`**

The visual clip on the timeline — this is the storyboard-style card:
- Min width: 120px (so thumbnails are always visible)
- Width proportional to duration (but with minimum)
- Shows: thumbnail background image, clip name overlay, duration label
- Border colored by type: `var(--port-image)` for images, `var(--port-video)` for videos
- Hover: shows trim handles (left/right edge drag zones)
- Selected state: brighter border + slight lift
- Drag to reorder within track

**Step 5: Write `components/edit/track-row.tsx`**

A horizontal lane:
- Track name label on the left
- Horizontal clip area: renders `ClipCard` components positioned by `startTime`
- Drop zone: accepts dragged assets from asset drawer
- "+" button to add another track

**Step 6: Write `components/edit/timeline-editor.tsx`**

Container for tracks + time ruler:
- Time ruler at top with tick marks and labels
- Playhead: vertical amber line, positioned by current time, draggable for scrubbing
- Renders `TrackRow` components
- Handles drop events for adding clips
- Right-click context menu: Split at Playhead, Remove Clip

**Step 7: Write `components/edit/edit-tab.tsx`**

Layout container:
- Top: `PreviewPlayer`
- Middle: `AssetDrawer` (collapsible)
- Bottom: `TimelineEditor`
- Flexbox layout with resizable panes (CSS flex-grow)

**Step 8: Add edit tab CSS to `globals.css`**

All timeline, clip card, track, ruler, playhead, preview player, and asset drawer styles.

**Step 9: Commit**

```bash
git add -A && git commit -m "feat: add visual multi-track timeline editor with storyboard-style clips"
```

---

### Task 15: Export Tab

**Files:**
- Create: `components/export/export-tab.tsx`
- Create: `components/export/export-settings.tsx`
- Create: `components/export/render-progress.tsx`
- Create: `app/api/exports/route.ts`
- Create: `app/api/exports/[id]/route.ts`

**Step 1: Install Remotion**

```bash
npm install @remotion/renderer @remotion/bundler @remotion/cli remotion
```

**Step 2: Write `components/export/export-settings.tsx`**

Settings panel:
- Preset selector: three cards (Draft 720p / Standard 1080p / High 4K) with radio-style selection
- FPS dropdown: 24 / 30 / 60
- Render button: amber accent, disabled if no clips on timeline (with tooltip)

**Step 3: Write `components/export/render-progress.tsx`**

Progress display:
- Progress bar (amber fill on dark track)
- Percentage text
- ETA text
- Cancel button
- On completion: download button (green accent) with file size

**Step 4: Write `components/export/export-tab.tsx`**

Layout:
- Centered panel (~600px max-width)
- Mini timeline preview (read-only representation)
- ExportSettings below
- RenderProgress below that (shown only when job is active/complete)

**Step 5: Write `app/api/exports/route.ts`**

- `POST`: Starts Remotion render. Calls `lib/export/remotion-pipeline.ts`.
- Returns `{ id, status: 'queued' }`

**Step 6: Write `app/api/exports/[id]/route.ts`**

- `GET`: Returns export job status + progress

**Step 7: Write Remotion composition stub**

- Create: `remotion/Root.tsx`
- Create: `remotion/index.ts`
- Create: `remotion/compositions/timeline-composition.tsx`
- Create: `lib/export/remotion-pipeline.ts`

The composition takes the sequence data and renders clips in order. The pipeline function bundles and renders.

**Step 8: Add export tab CSS to `globals.css`**

Settings cards, progress bar, download button styles.

**Step 9: Commit**

```bash
git add -A && git commit -m "feat: add export tab with Remotion render pipeline"
```

---

### Task 16: Polish & Integration Testing

**Files:**
- Create: `tests/lib/workflows/topo-sort.test.ts` (if not already)
- Create: `tests/lib/editor/timeline.test.ts`
- Create: `tests/components/workspace/workspace-shell.test.tsx`

**Step 1: Write timeline math tests**

Test all pure functions in `lib/editor/timeline.ts`:
- addClipToTrack, moveClip, trimClip, splitClip, removeClip
- Edge cases: overlapping clips, trim beyond bounds, split at start/end

**Step 2: Write workspace shell test**

Test tab switching renders correct content.

**Step 3: Run all tests**

```bash
npm test
```

**Step 4: Run build to catch type errors**

```bash
npm run build
```

Fix any TypeScript errors.

**Step 5: Visual polish pass**

- Verify all components match the dark theme
- Check spacebar palette positioning
- Check edge animations during simulated run
- Check timeline drag/drop
- Check responsive behavior

**Step 6: Commit**

```bash
git add -A && git commit -m "test: add unit tests for timeline and workflow, polish UI"
```

---

### Task 17: Final Cleanup

**Step 1: Update README.md**

Ensure it matches the actual implementation (file paths, commands, env vars).

**Step 2: Verify `.env.example` is complete**

**Step 3: Run full test suite + build**

```bash
npm test && npm run build
```

**Step 4: Final commit**

```bash
git add -A && git commit -m "docs: update README and finalize v1"
```
