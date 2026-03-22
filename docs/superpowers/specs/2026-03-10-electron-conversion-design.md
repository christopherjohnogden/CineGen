# CINEGEN Electron Conversion Design

## Overview

Convert CINEGEN from a Next.js web app to an Electron desktop application with Vite + React. Add a splash screen and a home screen with project gallery for multi-project management.

**Reference:** [LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) — Electron + Vite + React architecture.

## Goals

- Offline-capable standalone desktop app (.app/.dmg on macOS)
- Native file system access for project storage
- Distributable as a downloadable application
- Splash screen with custom branding image
- Home screen with project gallery (create, open, delete projects)

## Architecture: Clean Vite Rebuild

Strip Next.js entirely. Rebuild renderer as Vite + React. Move all server logic to Electron main process as IPC handlers.

### Directory Structure

```
CINEGEN - Desktop/
├── electron/
│   ├── main.ts              # Electron main process entry
│   ├── preload.ts           # Context bridge (exposes IPC to renderer)
│   ├── splash.html          # Splash screen (standalone HTML + image)
│   ├── ipc/
│   │   ├── project.ts       # Project CRUD (replaces /api/project)
│   │   ├── workflows.ts     # AI generation (replaces /api/workflows)
│   │   ├── exports.ts       # Export handlers (replaces /api/exports)
│   │   ├── elements.ts      # Element upload (replaces /api/elements)
│   │   ├── music-prompt.ts  # Music prompt (replaces /api/music-prompt)
│   │   └── file-system.ts   # Native file dialogs, path management
│   └── window.ts            # Window management (splash + main)
├── src/
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Root component (view: home | workspace)
│   ├── components/
│   │   ├── home/
│   │   │   ├── home-view.tsx      # Project gallery home screen
│   │   │   └── project-card.tsx   # Individual project card
│   │   ├── workspace/             # (existing, relocated)
│   │   ├── create/                # (existing, relocated)
│   │   ├── edit/                  # (existing, relocated)
│   │   ├── elements/              # (existing, relocated)
│   │   └── export/                # (existing, relocated)
│   ├── hooks/
│   │   └── use-electron.ts  # Hook wrapping window.electronAPI calls
│   ├── lib/                 # (existing client-side libs, relocated)
│   ├── types/               # (existing types, relocated)
│   └── styles/
│       ├── globals.css      # (existing, relocated)
│       └── fonts/           # Bundled Outfit + Space Mono fonts
├── index.html               # Vite HTML entry point
├── vite.config.ts           # Vite config (3 build targets)
├── electron-builder.yml     # Packaging config
├── package.json
└── tsconfig.json
```

## Window Management

### Two-Window Approach

1. **Splash Window**
   - Fixed size matching user's splash image dimensions
   - Frameless (`frame: false`), not resizable, centered
   - Loads `electron/splash.html` via `path.join(__dirname, 'splash.html')` — standalone HTML outside the Vite renderer tree
   - Shows user's custom splash image
   - Closes after main window fires `ready-to-show` (minimum ~3s display)

2. **Main Window**
   - Starts maximized/fullscreen
   - `backgroundColor: '#08090c'` (--bg-void) to prevent white flash
   - Hidden until `ready-to-show`
   - Contains home view and workspace

### Application Flow

```
App Launch → Splash Window (custom image, fixed size)
                ↓ main window ready
           Splash closes → Main Window shown (fullscreen)
                ↓ user picks/creates project
           Home View → Workspace View (tab switching)
                ↓ "Back to Projects" button
           Workspace → Home View
```

### View Switching (No Router)

Pure React state in `App.tsx`:
```ts
currentView: 'home' | 'workspace'
currentProjectId: string | null
```

- `home` — Project gallery (create new, open recent, delete)
- `workspace` — WorkspaceShell (Elements/Create/Edit/Export tabs)

### Project Switch Behavior

When navigating from workspace back to home:
1. Auto-save current project state
2. Reset undo/redo history (fresh stack for next project)
3. Clear `currentProjectId`
4. Unmount WorkspaceShell entirely (not hidden — fully unmounted) so `loadedRef` resets naturally

When opening a project from home:
1. Set `currentProjectId`
2. Switch view to `workspace`
3. WorkspaceShell mounts fresh, `loadedRef` is false, triggers `project:load` IPC → `HYDRATE`

## IPC Architecture

All current API routes become IPC handlers. Renderer calls through `window.electronAPI` bridge. All IPC calls use `ipcRenderer.invoke` / `ipcMain.handle` and are **asynchronous** — every bridge method returns a `Promise`.

### Channel Mapping

| Current API Route | IPC Channel | Purpose |
|---|---|---|
| `GET /api/project` | `project:load` | Load project from disk |
| `PATCH /api/project` | `project:save` | Save/patch project data |
| *(new)* | `project:list` | List all projects |
| *(new)* | `project:create` | Create new project |
| *(new)* | `project:delete` | Delete a project |
| `POST /api/workflows` | `workflow:run` | Execute AI generation |
| `GET /api/jobs/[id]` | `workflow:poll-job` | Poll job status |
| `POST /api/exports` | `export:start` | Start export |
| `GET /api/exports/[id]` | `export:poll` | Poll export status |
| `POST /api/elements/upload` | `elements:upload` | Upload file to fal.ai storage |
| `POST /api/music-prompt` | `music:generate-prompt` | AI music prompt |
| `PUT /api/sequences` | *(removed)* | Merged into `project:save` |

### Preload Bridge

```ts
interface ElectronAPI {
  project: {
    list: () => Promise<ProjectMeta[]>;
    create: (name: string) => Promise<ProjectSnapshot>;
    load: (id: string) => Promise<ProjectSnapshot>;
    save: (id: string, data: Partial<ProjectSnapshot>) => Promise<ProjectSnapshot>;
    delete: (id: string) => Promise<void>;
  };
  workflow: {
    run: (params: WorkflowRunParams) => Promise<WorkflowResult>;
    pollJob: (id: string) => Promise<JobStatus>;
  };
  export: {
    start: (params: ExportParams) => Promise<ExportJob>;
    poll: (id: string) => Promise<ExportJob>;
  };
  elements: {
    upload: (fileData: { buffer: ArrayBuffer; name: string; type: string }, apiKey: string) => Promise<{ url: string }>;
  };
  music: {
    generatePrompt: (params: MusicPromptParams) => Promise<{ prompt: string }>;
  };
  dialog: {
    showSave: (options: SaveDialogOptions) => Promise<string | null>;
    showOpen: (options: OpenDialogOptions) => Promise<string | null>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

### File Upload Across Context Bridge

Browser `File` objects cannot cross the context bridge (only serializable values). For element/file uploads:

1. Renderer reads the `File` into an `ArrayBuffer` via `file.arrayBuffer()`
2. Passes `{ buffer: ArrayBuffer, name: string, type: string }` through IPC
3. Main process reconstructs a `Buffer` from the `ArrayBuffer` and uploads to fal.ai

### Workflow Execution (Non-Blocking)

The current `/api/workflows` route has two patterns:
- **fal.ai:** Uses `fal.subscribe()` which blocks until complete (can take 30-120s)
- **kie.ai:** Uses a polling loop with `setInterval` (up to 6 minutes)

Both would block the Electron main process event loop. Solution:

- **fal.ai calls:** Run in the main process but are inherently async (fal SDK returns a Promise). The `ipcMain.handle` handler simply `await`s the Promise — this does NOT block the event loop because Promises are non-blocking.
- **kie.ai polling:** Replace the blocking `for` loop with `setTimeout`-based async polling. The `ipcMain.handle` handler returns a Promise that resolves when polling completes.
- **Progress updates (future):** If needed, use `webContents.send()` to push progress events to the renderer via a separate `workflow:progress` channel. For now, the renderer polls via `workflow:pollJob` as it does today.

### Security

- `contextBridge.exposeInMainWorld` with `contextIsolation: true`
- API keys passed per-call from renderer (stored in localStorage, same as today)
- Main process never stores API keys

## Project Storage

### Central Directory: `~/Documents/CINEGEN/`

```
~/Documents/CINEGEN/
├── projects.json              # Index: list of all projects
├── abc123/                    # Directory named by ID only (not project name)
│   ├── project.json           # Full project snapshot
│   └── assets/                # Generated assets (future)
├── def456/
│   ├── project.json
│   └── assets/
```

Project directories are named by **ID only** (UUID), not project name. This avoids filesystem issues with special characters, spaces, or duplicate names. The human-readable name lives only in `project.json` and the index.

### Index File (projects.json)

```ts
{
  projects: [
    {
      id: string,           // UUID, also the directory name
      name: string,         // Display name (any characters allowed)
      createdAt: string,    // ISO 8601
      updatedAt: string,    // ISO 8601
      assetCount: number,   // Computed from snapshot.assets.length on save
      elementCount: number, // Computed from snapshot.elements.length on save
      thumbnail: string | null  // Future: path to first image asset
    }
  ]
}
```

### ProjectSnapshot Type

Must match the existing type exactly, including `mediaFolders`:

```ts
interface ProjectSnapshot {
  project: { id: string; name: string; createdAt: string; updatedAt: string };
  workflow: { nodes: unknown[]; edges: unknown[] };
  sequence: { id: string; tracks: Track[]; duration: number };
  assets: Asset[];
  mediaFolders: MediaFolder[];
  exports: ExportJob[];
  elements: Element[];
}
```

### Project Name Validation

- Max length: 100 characters
- Empty/whitespace-only names rejected
- Duplicate names are allowed (projects are identified by UUID, not name)
- No filesystem-invalid character restrictions (name is never used as a path)

### Data Migration

On first launch, if `.data/dev/project.json` exists (legacy single-project data):
1. Create `~/Documents/CINEGEN/` directory
2. Copy the legacy project into a new UUID-named subdirectory
3. Build `projects.json` index from it
4. Do NOT delete the original `.data/dev/` — leave it as a backup

### Project Lifecycle

- **Create** — User enters name → create UUID folder + empty project.json + update index → navigate to workspace
- **Load** — Click project card → read its project.json → hydrate workspace
- **Save** — Debounced auto-save (500ms) via `electronAPI.project.save(id, data)`. On each save, update `assetCount`, `elementCount`, and `updatedAt` in `projects.json` index.
- **Delete** — User confirms → remove folder recursively + remove from index

## Build System

### Dependencies

**Remove:** `next`, `server-only`, `@remotion/*`, `remotion`

**Add:** `electron`, `electron-builder`, `vite`, `@vitejs/plugin-react`, `vite-plugin-electron` (handles multi-target builds for main/preload/renderer)

**Keep:** `react`, `react-dom`, `@xyflow/react`, `@fal-ai/client`, `zod`

### Vite Configuration

Use `vite-plugin-electron` to handle the 3 build targets in a single `vite.config.ts`:

| Target | Entry | Output | Format | Notes |
|---|---|---|---|---|
| Renderer | `src/main.tsx` | `dist/` | ESM | Standard Vite React build |
| Main | `electron/main.ts` | `dist-electron/main.js` | ESM | Node target |
| Preload | `electron/preload.ts` | `dist-electron/preload.js` | CJS | Required for contextBridge |

Key config details:
- Renderer: `base: './'` for Electron's `file://` protocol
- Main/Preload: `external: ['electron']` — do NOT bundle Electron or Node built-ins (`fs`, `path`, `os`, `child_process`)
- Main process: Use `import.meta.dirname` (ESM equivalent of `__dirname`) for resolving paths to `splash.html`, `preload.js`, and `dist/index.html` after packaging
- `vite-plugin-electron` handles dev mode (launches Electron with HMR for renderer) and production builds automatically

### Scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "electron .",
  "package": "electron-builder"
}
```

### Packaging

macOS target initially (Darwin). electron-builder.yml config for .app/.dmg. The `electron/splash.html` and splash image are included as `extraResources` so they're accessible at runtime via `process.resourcesPath`.

### Fonts

Download Outfit and Space Mono font files, bundle in `src/styles/fonts/`, load via `@font-face` in globals.css for offline support. Remove the Google Fonts `<link>` tags from the HTML.

## Export System

The current export system is entirely simulated (`simulateRender` with `setInterval` faking progress). Remotion packages exist in `package.json` but are not wired up. For the Electron conversion:

- **Remove Remotion** — it was never functional
- **Keep the simulated export** for now — the `export:start` and `export:poll` IPC handlers replicate the same fake progress behavior
- **Future:** Replace with actual export using `ffmpeg` as a bundled binary, writing output to a user-chosen path via `dialog.showSaveDialog` + the `dialog.showSave` bridge method
- **Fix `outputUrl`:** In the current stub, `job.outputUrl` is a meaningless URL. In Electron, change this to a local file path. The renderer uses `shell.openPath()` (exposed via a new `shell.openPath` bridge method) instead of `<a href download>` to open the exported file.

## Component Migration

### Unchanged (relocate only)

All `create/` components (except those listed below), all `edit/` components, all `elements/` components (except those listed below), all `export/` components (except those listed below), plus `workspace/top-tabs.tsx` and `workspace/status-indicator.tsx`.

### Modified

| Component | Changes |
|---|---|
| `workspace-shell.tsx` | Replace `fetch('/api/project')` with `electronAPI.project.load(projectId)`. Replace `fetch PATCH` with `electronAPI.project.save(projectId, data)`. Accept `projectId` prop. Add "Back to Projects" button that triggers save + unmount. On `HYDRATE`, reset undo history (fresh `past: []`, `future: []`). |
| `workflow-canvas.tsx` | Replace `fetch('/api/workflows')` with `electronAPI.workflow.run()` |
| `element-generate.tsx` | Replace `fetch('/api/workflows')` with `electronAPI.workflow.run()` (this calls the AI model, NOT elements upload) |
| `file-picker-node.tsx` | Replace `fetch('/api/elements/upload')` with file-to-ArrayBuffer + `electronAPI.elements.upload()` |
| `music-generation-popup.tsx` | Replace `fetch('/api/music-prompt')` with `electronAPI.music.generatePrompt()` |
| `music-prompt-node.tsx` | Replace `fetch('/api/music-prompt')` with `electronAPI.music.generatePrompt()` |
| `element-image-upload.tsx` | Replace `fetch('/api/elements/upload')` with file-to-ArrayBuffer + `electronAPI.elements.upload()` |
| `export-settings.tsx` | Replace `fetch('/api/exports')` with `electronAPI.export.start()` |
| `render-progress.tsx` | Replace fetch polling with `electronAPI.export.poll()`. Replace `<a href download>` with `electronAPI.shell.openPath()` for opening exported files. |

### New

| Component | Purpose |
|---|---|
| `App.tsx` | Root: view switching (home/workspace), holds projectId state. Unmounts WorkspaceShell entirely on project switch. |
| `home/home-view.tsx` | Project gallery grid with create/delete functionality |
| `home/project-card.tsx` | Project card (name, date, asset count, element count) |

### use-electron.ts Hook

Thin wrapper providing typed access to `window.electronAPI` with error handling:

```ts
export function useElectron() {
  const api = window.electronAPI;
  if (!api) throw new Error('Not running in Electron');
  return api;
}
```

Components use this hook instead of accessing `window.electronAPI` directly. This provides a single point for error handling and makes it easy to mock in tests. The hook is intentionally minimal — it does NOT wrap individual methods or add caching. Components call `api.project.load(id)` etc. directly from the returned object.

### Removed

- `app/layout.tsx` → HTML shell moves to `index.html`
- `app/page.tsx` → `src/main.tsx` renders `<App />`
- All `app/api/` routes → replaced by `electron/ipc/` handlers

### Library Migration

- `lib/fal/client.ts` → `electron/ipc/workflows.ts` (remove `server-only` import)
- `lib/kie/client.ts` → `electron/ipc/workflows.ts`
- `lib/persistence/store.ts` → `electron/ipc/project.ts` (path: `~/Documents/CINEGEN/`)
- Client-side libs (`workflows/execute.ts`, `editor/timeline.ts`, etc.) → `src/lib/`, replace `fetch('/api/...')` calls with `window.electronAPI.*`
- `lib/config/env.ts` → simplified, API keys from localStorage only (no server-side env vars)

## Home Screen UI

Project Gallery style:
- Visual grid of project cards with thumbnails (16:10 aspect ratio cards)
- "New Project" card with dashed border and + icon as first card
- Each card shows: project name, last modified date, asset count
- Click to open project in workspace
- Delete button on card (with confirmation dialog)
- CINEGEN branding header at top
- Matches existing dark cinematic theme (--bg-void, --accent gold)
- Empty state: just the "New Project" card with a welcome message
