# CINEGEN Web v1 — Design Document

**Date:** 2026-03-06
**Status:** Approved

## Overview

A node-based AI media generation web app powered by fal.ai. Users build image/video generation workflows on an infinite canvas, arrange results on a visual timeline, and export the final sequence as an MP4. Dark cinematic UI inspired by the existing CINEGEN visual language.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Node Canvas | @xyflow/react (React Flow v12) |
| AI Generation | fal.ai via @fal-ai/client |
| Video Export | Remotion (@remotion/renderer + @remotion/bundler) |
| Validation | Zod |
| Testing | Vitest + Testing Library |
| Styling | Vanilla CSS with custom properties (no CSS framework) |
| Fonts | Outfit (display/body), Space Mono (monospace metadata) |

## 1. App Shell & Routing

Single-page app with client-side tab switching. No multi-page routing — all three workspace tabs share one page so state persists across tabs without extra persistence.

### Layout

- `app/layout.tsx` — root layout, dark theme, font loading
- `app/page.tsx` — entry point, renders WorkspaceShell

### Top Nav Bar

- Fixed, ~48-56px height
- CINEGEN wordmark centered
- Three tab buttons: **Create** | **Edit** | **Export**
- Status indicator on the right (idle/running/error dot with pulse)

### State Management

- Single `WorkspaceShell` client component owns all state
- React context + useReducer (no external state library)
- State: active tab, workflow graph, timeline sequence, generated assets, running jobs
- Optimistic local updates with debounced saves to API routes

## 2. Design Tokens

```css
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
```

### Port Type Colors

```css
--port-image: #5cb87a;
--port-video: #d4a054;
--port-text: #8e8a82;
--port-number: #5b8fd4;
--port-config: #a06cd5;
--port-model: #cf7d60;
```

## 3. Create Tab — Node Editor

Full-canvas React Flow editor on `--bg-void` with subtle dot grid.

### Spacebar Command Palette

- Space key (when no text input focused) opens floating palette at cursor
- Search input at top
- Categories:
  - **Input:** Prompt, Model Select, Style/Seed, Duration
  - **Generate:** Image Generate, Video Generate
  - **Output:** Asset Output
- Click/Enter inserts node at cursor, Escape dismisses

### Node Components

Dark card styling: `--bg-raised` background, left accent stripe (category color), uppercase header.

| Node | Inputs | Outputs | Body |
|------|--------|---------|------|
| Prompt | — | text | Multi-line textarea |
| Model Select | — | model | Category dropdown (image/video), model dropdown |
| Style/Seed | — | config | Preset buttons (Fast Draft/Quality/Cinematic), seed input, CFG slider |
| Duration | — | number | Slider (1-30s) |
| Image Generate | text, model, config | image | Generate button, thumbnail preview |
| Video Generate | text, model, config, number | video | Generate button, thumbnail preview |
| Asset Output | image or video | — | "Send to Edit" button, name input |

### Edge Connectors

- SVG cubic bezier, colored by source port type
- Default: stroke-width 2, opacity 0.6
- Running state: dash-march animation (`6 3`, `0.4s linear infinite`) + drop-shadow glow
- Source node gets `.generating-source` pulse, target node gets `.generating-target` ring
- Draft connector during drag: dashed, port-type colored

### Workflow Execution

- "Run Workflow" button (top-right) or per-node Generate button
- Topological sort determines order
- Each node executes via API route → fal.ai
- Running nodes show pulse animation
- Results (image/video URLs) stored in asset state

## 4. Edit Tab — Visual Multi-Track Timeline

### Layout (top to bottom)

1. **Preview Monitor** (~50% height) — current frame at playhead, play/pause, scrub, timecode, fullscreen
2. **Asset Drawer** (collapsible) — horizontal scroll of generated assets, drag onto tracks
3. **Timeline** (bottom ~40%) — multi-track with scrub playhead

### Clip Cards (Storyboard Style)

Clips render as visual cards, not thin waveform blocks:

- Thumbnail image or video poster frame
- Clip name + duration label overlay
- Rounded corners, border colored by type (green=image, amber=video)
- Minimum card width so thumbnails stay visible even for short clips
- Hover reveals trim handles on left/right edges

### Editing Operations

- Drag from asset drawer onto track to add
- Drag left/right within track to reorder
- Drag edge handles to trim
- Right-click > Split at Playhead
- Double-click for mini inspector (duration input)
- Select + Delete to remove

### Timeline Elements

- Time ruler at top with tick marks
- Playhead: vertical amber line spanning all tracks
- Track lanes with add/remove track controls

## 5. Export Tab

Centered panel (not full-canvas).

### Elements

1. **Mini Timeline Preview** — read-only representation of what will export
2. **Settings:**
   - Preset: Draft (720p) / Standard (1080p) / High Quality (4K)
   - Format: MP4
   - Frame rate: 24 / 30 / 60 fps
3. **Render Button** — starts Remotion server-side render
4. **Progress:** bar, percentage, ETA, cancel button
5. **Completion:** download button + file size

### API

- `POST /api/exports` — start render job
- `GET /api/exports/[id]` — poll status (queued/rendering/complete/failed)
- Remotion bundles timeline composition, renders server-side
- Output stored in `CINEGEN_DATA_ROOT`

## 6. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/project` | GET/PATCH | Project snapshot (full state) |
| `/api/workflows` | PUT | Save workflow graph |
| `/api/workflows` | POST | Run workflow (triggers fal.ai) |
| `/api/sequences` | PUT | Save timeline sequence |
| `/api/exports` | POST | Start export render |
| `/api/exports/[id]` | GET | Poll export status |
| `/api/jobs/[id]` | GET | Poll generation job status |

All fal.ai calls go through API routes — key never sent to browser.

## 7. Data Model (Types)

### Core types

- `Asset` — id, name, type (image/video), url, metadata, createdAt
- `WorkflowNode` — id, type, position, data (config per node type)
- `WorkflowEdge` — id, source, target, sourceHandle, targetHandle
- `WorkflowRun` — id, status, nodeResults map
- `Clip` — id, assetId, trackId, startTime, duration, trimStart, trimEnd
- `Track` — id, name, clips[]
- `Sequence` — id, tracks[], duration
- `ExportJob` — id, status, progress, preset, outputUrl
- `ProjectSnapshot` — workflow, sequence, assets[], exports[]

## 8. File Structure

```
app/
  layout.tsx
  page.tsx
  globals.css
  api/
    project/route.ts
    workflows/route.ts
    sequences/route.ts
    exports/route.ts
    exports/[id]/route.ts
    jobs/[id]/route.ts

components/
  workspace/
    top-tabs.tsx
    workspace-shell.tsx
    status-indicator.tsx
  create/
    create-tab.tsx
    workflow-canvas.tsx
    node-palette.tsx
    nodes/
      prompt-node.tsx
      model-select-node.tsx
      style-seed-node.tsx
      duration-node.tsx
      image-generate-node.tsx
      video-generate-node.tsx
      asset-output-node.tsx
      base-node.tsx
  edit/
    edit-tab.tsx
    preview-player.tsx
    asset-drawer.tsx
    timeline-editor.tsx
    track-row.tsx
    clip-card.tsx
  export/
    export-tab.tsx
    export-settings.tsx
    render-progress.tsx

lib/
  config/env.ts
  fal/client.ts
  fal/models.ts
  editor/timeline.ts
  export/remotion-pipeline.ts
  persistence/store.ts
  validation/schemas.ts
  workflows/execute.ts
  workflows/topo-sort.ts
  utils/ids.ts

types/
  project.ts
  workflow.ts
  editor.ts
  export.ts
  workspace.ts

remotion/
  Root.tsx
  index.ts
  compositions/timeline-composition.tsx

tests/
  (mirrors source structure)
```

## 9. Accessibility & Motion

- Keyboard-operable node editor and timeline
- `prefers-reduced-motion` disables dash-march animation, replaces with static high-contrast edge
- Reduced glow/pulse in reduced-motion mode
- Contrast-safe color choices for all text tiers

## 10. Current Scope Exclusions (v1)

- No authentication or multi-user
- No audio tracks
- No keyframing or effects
- No multi-provider abstraction (fal.ai only)
- No database (file-based persistence)
- Export runs on the same server process (no background worker)
