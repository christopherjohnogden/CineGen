# Real Footage Support & SQLite Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform CINEGEN Desktop into a full NLE supporting local file import with SQLite persistence, proxy workflows, and real ffmpeg export.

**Architecture:** SQLite (better-sqlite3) replaces JSON project files. A Node.js worker thread manages all ffmpeg jobs (proxies, filmstrips, waveforms, export). The React state layer stays unchanged — SQLite is the persistence backend, not the runtime store. The playback engine gains viewport-aware pooling with LRU eviction.

**Tech Stack:** Electron 35, React 19, better-sqlite3, ffmpeg-static, ffprobe-static, Node.js worker_threads

**Spec:** `docs/superpowers/specs/2026-03-11-real-footage-sqlite-design.md`

**Security note:** All ffmpeg/ffprobe invocations use `child_process.spawn` with explicit argument arrays — never `exec` with shell strings.

---

## File Structure

### New Files (Electron / Main Process)

| File | Responsibility |
|------|---------------|
| `electron/db/schema.ts` | SQLite schema definition, table creation |
| `electron/db/database.ts` | Database class — open/close, query helpers |
| `electron/db/project-db.ts` | Project-specific CRUD operations |
| `electron/ipc/db.ts` | IPC handler registration for `db:*` channels |
| `electron/ipc/media-import.ts` | IPC handlers for file import + worker management |
| `electron/workers/media-worker.ts` | Worker thread — job queue, ffmpeg spawning |
| `electron/workers/media-worker-types.ts` | Shared types for worker communication |
| `electron/lib/ffmpeg-paths.ts` | Resolve ffmpeg/ffprobe binary paths |

### New Files (Renderer / React)

| File | Responsibility |
|------|---------------|
| `src/types/db.ts` | TypeScript types mirroring SQLite row shapes |
| `src/lib/db-converters.ts` | Convert between DB rows and React state |
| `src/components/edit/filmstrip-background.tsx` | Sprite sheet rendering for clip cards |
| `src/components/edit/proxy-toggle.tsx` | "Use Proxies" toolbar toggle |

### Modified Files

| File | What Changes |
|------|-------------|
| `package.json` | Add better-sqlite3, ffmpeg-static, ffprobe-static |
| `vite.config.ts` | Externalize native modules, add worker entry |
| `electron/main.ts` | Register new IPC handlers, spawn worker |
| `electron/preload.ts` | Expose `db`, `media` IPC channels |
| `electron/ipc/exports.ts` | Real ffmpeg export replacing mock |
| `src/types/project.ts` | Add fileRef, proxyRef, sourceUrl, status to Asset |
| `src/components/workspace/workspace-shell.tsx` | SQLite hydrate/save paths |
| `src/components/edit/left-panel.tsx` | Import button, broken link indicators |
| `src/components/edit/clip-card.tsx` | Filmstrip background rendering |
| `src/lib/editor/playback-engine.ts` | Viewport-aware pool, proxy resolution |

---

## Chunk 1: Foundation — Dependencies + SQLite Schema + Database

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production deps**

```bash
cd "/Users/cogden/Desktop/Coding/CINEGEN - Desktop"
npm install better-sqlite3 ffmpeg-static ffprobe-static
```

- [ ] **Step 2: Install dev type definitions**

```bash
npm install -D @types/better-sqlite3
```

- [ ] **Step 3: Verify**

```bash
npm ls better-sqlite3 ffmpeg-static ffprobe-static
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3, ffmpeg-static, ffprobe-static"
```

---

### Task 2: Configure Vite for Native Modules

**Files:**
- Modify: `vite.config.ts:58-62`

- [ ] **Step 1: Externalize native modules in main process build**

In `vite.config.ts`, in the first electron entry's `rollupOptions.external` (line ~61), change:

```typescript
// Before:
external: ['electron'],
// After:
external: ['electron', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static'],
```

- [ ] **Step 2: Verify dev server starts**

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "build: externalize native modules from Vite bundling"
```

---

### Task 3: FFmpeg Path Resolution

**Files:**
- Create: `electron/lib/ffmpeg-paths.ts`

- [ ] **Step 1: Create utility**

```typescript
import { app } from 'electron';

function resolvePackagedPath(modulePath: string): string {
  if (app.isPackaged) {
    return modulePath.replace('app.asar', 'app.asar.unpacked');
  }
  return modulePath;
}

export function getFfmpegPath(): string {
  const p = require('ffmpeg-static') as string;
  return resolvePackagedPath(p);
}

export function getFfprobePath(): string {
  const p = require('ffprobe-static').path as string;
  return resolvePackagedPath(p);
}
```

- [ ] **Step 2: Smoke test** — temporarily log paths in `electron/main.ts`, run `npm run dev`, verify valid paths print, remove logs.

- [ ] **Step 3: Commit**

```bash
git add electron/lib/ffmpeg-paths.ts
git commit -m "feat: add ffmpeg/ffprobe path resolution for dev and packaged builds"
```

---

### Task 4: SQLite Schema

**Files:**
- Create: `electron/db/schema.ts`

- [ ] **Step 1: Create schema with all 13 tables and indexes**

Tables: `projects`, `media_folders`, `assets`, `timelines`, `tracks`, `clips`, `keyframes`, `transitions`, `workflow_state`, `elements`, `cache_metadata`, `export_jobs`.

All use `CREATE TABLE IF NOT EXISTS`. Export as `SCHEMA_SQL` and `INDEXES_SQL` string constants plus `SCHEMA_VERSION = 1`.

See spec for full column definitions. Key design choices:
- All IDs are `TEXT PRIMARY KEY` (UUIDs)
- Booleans stored as `INTEGER` (0/1)
- JSON blobs stored as `TEXT` (workflow nodes/edges, element images, asset metadata)
- Timestamps as `TEXT` with `datetime('now')` defaults

- [ ] **Step 2: Commit**

```bash
git add electron/db/schema.ts
git commit -m "feat: define SQLite schema (13 tables, indexes)"
```

---

### Task 5: Database Connection Manager

**Files:**
- Create: `electron/db/database.ts`

- [ ] **Step 1: Create `ProjectDatabase` class**

```typescript
import Database from 'better-sqlite3';
```

Class with:
- Constructor takes `projectId`, opens `~/Documents/CINEGEN/{id}/project.db`
- Sets `pragma journal_mode = WAL` and `pragma foreign_keys = ON`
- `initSchema()` — runs SCHEMA_SQL and INDEXES_SQL
- `query<T>(sql, params?)` — returns rows
- `queryOne<T>(sql, params?)` — returns single row
- `run(sql, params?)` — INSERT/UPDATE/DELETE
- `transaction<T>(fn)` — wraps in transaction
- `close()` — closes connection

Export helpers: `ensureProjectDirs(id)` (creates media/, .cache/ subdirs), `generateId()`, `timestamp()`, `projectsRoot()`, `projectDir(id)`.

- [ ] **Step 2: Commit**

```bash
git add electron/db/database.ts
git commit -m "feat: add ProjectDatabase class with WAL mode and schema init"
```

---

### Task 6: Project CRUD Operations

**Files:**
- Create: `electron/db/project-db.ts`

- [ ] **Step 1: Create all row type interfaces**

`ProjectRow`, `AssetRow`, `MediaFolderRow`, `TimelineRow`, `TrackRow`, `ClipRow`, `KeyframeRow`, `TransitionRow`, `ElementRow`, `ExportJobRow`, `CacheMetadataRow`.

- [ ] **Step 2: Create CRUD functions for each entity**

Each entity gets: `get*`, `insert*`, `update*`, `delete*` functions. Tracks and clips use `UPSERT` (INSERT ... ON CONFLICT DO UPDATE) for idempotent saves.

- [ ] **Step 3: Create `loadFullProject(db, projectId)` function**

Queries all tables and returns `FullProjectState` — the complete project state for hydration. Joins timelines with their tracks, clips (with keyframes), and transitions.

- [ ] **Step 4: Create `saveFullProject(db, projectId, state)` function**

Receives the React state shape and persists it in a single transaction. Handles diff: deletes removed entities, upserts existing ones.

- [ ] **Step 5: Commit**

```bash
git add electron/db/project-db.ts
git commit -m "feat: add SQLite CRUD operations for all project entities"
```

---

### Task 7: Database IPC Handlers + Preload

**Files:**
- Create: `electron/ipc/db.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create `electron/ipc/db.ts`**

- Connection cache: `Map<string, ProjectDatabase>` — one DB per open project
- `getDb(id)` — lazy-opens and caches connections
- Handlers:
  - `db:project:create` — creates project dir, SQLite DB, default timeline with tracks, updates projects.json index with `useSqlite: true` flag
  - `db:project:load` — opens DB, calls `loadFullProject()`
  - `db:project:save` — calls `saveFullProject()`, updates index metadata
  - `db:project:delete` — closes DB, removes directory, updates index
  - `db:project:close` — closes DB connection
  - `db:asset:insert`, `db:asset:update`, `db:asset:delete` — individual asset operations

- [ ] **Step 2: Register in `electron/main.ts`**

```typescript
import { registerDbHandlers, closeAllDbs } from './ipc/db.js';
// After existing registrations:
registerDbHandlers();
// In before-quit:
app.on('before-quit', () => { closeAllDbs(); });
```

- [ ] **Step 3: Expose in `electron/preload.ts`**

Add `db` namespace to `electronAPI`:
```typescript
db: {
  createProject: (name) => ipcRenderer.invoke('db:project:create', name),
  loadProject: (id) => ipcRenderer.invoke('db:project:load', id),
  saveProject: (id, state) => ipcRenderer.invoke('db:project:save', id, state),
  deleteProject: (id) => ipcRenderer.invoke('db:project:delete', id),
  closeProject: (id) => ipcRenderer.invoke('db:project:close', id),
  updateProject: (id, data) => ipcRenderer.invoke('db:project:update', id, data),
  insertAsset: (asset) => ipcRenderer.invoke('db:asset:insert', asset),
  updateAsset: (projId, id, data) => ipcRenderer.invoke('db:asset:update', projId, id, data),
  deleteAsset: (projId, id) => ipcRenderer.invoke('db:asset:delete', projId, id),
},
```

- [ ] **Step 4: Verify app starts**

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/db.ts electron/main.ts electron/preload.ts
git commit -m "feat: wire up SQLite IPC handlers and preload bridge"
```

---

## Chunk 2: React ↔ SQLite Integration

### Task 8: Extend Asset Type

**Files:**
- Modify: `src/types/project.ts:1-16`

- [ ] **Step 1: Add new fields to Asset interface**

Add after `url`: `fileRef?: string`, `originalPath?: string`, `sourceUrl?: string`, `proxyRef?: string`. Add after `height`: `fps?: number`, `codec?: string`, `fileSize?: number`, `checksum?: string`. Add: `status?: 'online' | 'offline' | 'processing'`.

- [ ] **Step 2: Commit**

```bash
git add src/types/project.ts
git commit -m "feat: extend Asset type with local file and proxy fields"
```

---

### Task 9: DB Row ↔ React State Converters

**Files:**
- Create: `src/lib/db-converters.ts`

- [ ] **Step 1: Create converter functions**

Two directions:
- `*FromRow(row)` — converts SQLite row (snake_case) to React state (camelCase)
- `*ToRow(state, parentId)` — converts React state to SQLite row shape

Functions needed: `assetFromRow/assetToRow`, `folderFromRow`, `trackFromRow/trackToRow`, `clipFromRow/clipToRow`, `keyframeFromRow`, `transitionFromRow/transitionToRow`, `timelineFromRows`, `elementFromRow`, `exportFromRow`.

Key conversions:
- `file_ref` → `fileRef`, `source_url` → `sourceUrl`
- Booleans: `muted: 0/1` → `muted: boolean`
- JSON strings: `metadata: string` → `metadata: Record<string, unknown>`
- URL resolution: `asset.url = sourceUrl || fileRef || ''`

- [ ] **Step 2: Commit**

```bash
git add src/lib/db-converters.ts
git commit -m "feat: add DB row ↔ React state converter functions"
```

---

### Task 10: Wire Workspace Shell to SQLite

**Files:**
- Modify: `src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1: Add `useSqlite` prop**

```typescript
export function WorkspaceShell({ projectId, useSqlite, onBackToHome }: {
  projectId: string; useSqlite: boolean; onBackToHome: () => void;
})
```

- [ ] **Step 2: Add SQLite hydration branch**

In the load `useEffect` (line ~397), add `if (useSqlite)` branch that calls `window.electronAPI.db.loadProject(projectId)` and converts the result using `db-converters` before dispatching `HYDRATE`.

Keep the existing JSON path in the `else` branch unchanged.

- [ ] **Step 3: Add SQLite save branch**

In the save `useEffect` (line ~425), add `if (useSqlite)` branch that converts React state to DB row shapes using `db-converters` and calls `window.electronAPI.db.saveProject(projectId, ...)`.

Keep existing JSON save in `else` branch.

- [ ] **Step 4: Verify app builds**

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/workspace-shell.tsx
git commit -m "feat: add SQLite hydrate/save paths to workspace shell"
```

---

### Task 11: Update Home View for SQLite Projects

**Files:**
- Modify: `src/components/home/home-view.tsx`

- [ ] **Step 1: Read home-view.tsx** to understand project creation and opening.

- [ ] **Step 2: New projects use SQLite**

Change project creation to call `window.electronAPI.db.createProject(name)` instead of `window.electronAPI.project.create(name)`.

- [ ] **Step 3: Pass `useSqlite` to WorkspaceShell**

When opening a project, check the `useSqlite` flag from the project index. Pass it to `<WorkspaceShell useSqlite={...} />`.

- [ ] **Step 4: Test**

1. Create new project → verify `project.db` exists in `~/Documents/CINEGEN/{id}/`
2. Open the project → verify timeline loads
3. Add a clip, save, reload → verify persistence works
4. Open an old JSON project → verify it still works

- [ ] **Step 5: Commit**

```bash
git add src/components/home/home-view.tsx
git commit -m "feat: new projects use SQLite; legacy JSON projects still supported"
```

---

## Chunk 3: Media Worker + File Import

### Task 12: Worker Types

**Files:**
- Create: `electron/workers/media-worker-types.ts`

- [ ] **Step 1: Define shared types**

- `JobType`: `'extract_metadata' | 'generate_thumbnail' | 'compute_waveform' | 'generate_filmstrip' | 'generate_proxy'`
- `JOB_PRIORITY`: metadata=0, thumbnail=1, waveform=2, filmstrip=3, proxy=4
- `MediaJob`: `{ id, type, assetId, inputPath, outputPath, projectDir }`
- `WorkerMessageToMain`: progress, complete, error, ready
- `MainMessageToWorker`: submit, cancel, config
- `MediaMetadata`: duration, width, height, fps, codec, fileSize, bitrate, audioChannels, audioCodec

- [ ] **Step 2: Commit**

```bash
git add electron/workers/media-worker-types.ts
git commit -m "feat: define media worker shared types"
```

---

### Task 13: Media Worker Thread

**Files:**
- Create: `electron/workers/media-worker.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create the worker**

Uses `worker_threads.parentPort`. Implements:
- Priority queue with `MAX_CONCURRENT = 2`
- Job implementations using `child_process.spawn` (NOT exec):
  - `extract_metadata`: spawns ffprobe with JSON output, parses result
  - `generate_thumbnail`: spawns ffmpeg, extracts single frame at 0.1s
  - `compute_waveform`: spawns ffmpeg to pipe raw PCM, computes peak values in JS
  - `generate_filmstrip`: probes duration, spawns ffmpeg with `fps=1,scale=160:-2,tile=Nx1`
  - `generate_proxy`: spawns ffmpeg with `scale=960:-2 -c:v libx264 -crf 23`, parses stderr for progress
- Message handler: `config` (stores paths), `job:submit` (enqueues), `job:cancel` (kills process)

- [ ] **Step 2: Add worker entry to Vite config**

Add third entry to `electron([...])` array in `vite.config.ts`:

```typescript
{
  entry: 'electron/workers/media-worker.ts',
  vite: {
    build: {
      outDir: 'dist-electron/workers',
      rollupOptions: {
        external: ['electron', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static'],
      },
    },
  },
},
```

- [ ] **Step 3: Commit**

```bash
git add electron/workers/media-worker.ts vite.config.ts
git commit -m "feat: implement media worker with priority queue and all ffmpeg job types"
```

---

### Task 14: Worker Manager + Import IPC

**Files:**
- Create: `electron/ipc/media-import.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create `electron/ipc/media-import.ts`**

- `ensureWorker()`: lazy-creates Worker from `dist-electron/workers/media-worker.js`, sends config with ffmpeg paths
- `submitJob(job)`: returns Promise, resolves when worker sends `job:complete`
- Forwards `job:progress`, `job:complete`, `job:error` to all BrowserWindows via `webContents.send`
- IPC handlers:
  - `media:import` — accepts `{ filePaths, projectId, mode: 'link'|'copy' }`. For each file: if copy, copies to `media/imported/`; submits `extract_metadata` job; on completion, queues `generate_thumbnail`. Returns `[{ assetId, jobId, filePath }]`.
  - `media:submit-job` — submit arbitrary job
  - `media:cancel-job` — cancel a job
  - `media:queue-processing` — accepts `{ assetId, projectId, inputPath, needsProxy }`. Queues waveform + filmstrip jobs, optionally proxy.

- [ ] **Step 2: Register in main.ts**

```typescript
import { registerMediaImportHandlers, terminateMediaWorker } from './ipc/media-import.js';
registerMediaImportHandlers();
// In before-quit: terminateMediaWorker();
```

- [ ] **Step 3: Expose in preload.ts**

```typescript
media: {
  import: (params) => ipcRenderer.invoke('media:import', params),
  submitJob: (job) => ipcRenderer.invoke('media:submit-job', job),
  cancelJob: (jobId) => ipcRenderer.invoke('media:cancel-job', jobId),
  queueProcessing: (params) => ipcRenderer.invoke('media:queue-processing', params),
  onJobProgress: (cb) => ipcRenderer.on('media:job-progress', (_e, d) => cb(d)),
  onJobComplete: (cb) => ipcRenderer.on('media:job-complete', (_e, d) => cb(d)),
  onJobError: (cb) => ipcRenderer.on('media:job-error', (_e, d) => cb(d)),
},
```

- [ ] **Step 4: Verify**

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/media-import.ts electron/main.ts electron/preload.ts
git commit -m "feat: add media worker manager with import and processing IPC"
```

---

### Task 15: Import Button in Media Pool

**Files:**
- Modify: `src/components/edit/left-panel.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Read left-panel.tsx header area** to find where toolbar controls live.

- [ ] **Step 2: Add `handleImport()` function**

Opens `dialog.showOpen` with media file filters, calls `media:import`, creates `ADD_ASSET` dispatch for each file with `status: 'processing'`.

File type detection by extension:
- Video: mp4, mov, avi, mkv, webm, mxf, m4v
- Audio: wav, mp3, aac, flac, ogg, m4a
- Image: everything else

- [ ] **Step 3: Add Import button** in the toolbar area.

- [ ] **Step 4: Add CSS** for `.left-panel__import-btn`.

- [ ] **Step 5: Test** — import a video file, verify it appears in media pool.

- [ ] **Step 6: Commit**

```bash
git add src/components/edit/left-panel.tsx src/styles/globals.css
git commit -m "feat: add Import button to media pool with file dialog integration"
```

---

## Chunk 4: Playback Engine Updates

### Task 16: Proxy Toggle + Source Resolution

**Files:**
- Modify: `src/lib/editor/playback-engine.ts`
- Create: `src/components/edit/proxy-toggle.tsx`

- [ ] **Step 1: Add to PlaybackEngine class**

```typescript
private _useProxies = false;
setUseProxies(value: boolean): void { this._useProxies = value; this.updateVideoPool(); }
get useProxies(): boolean { return this._useProxies; }

private resolvePlaybackUrl(asset: Asset): string {
  if (this._useProxies && asset.proxyRef) return asset.proxyRef;
  return asset.fileRef || asset.url;
}
```

Update `updateVideoPool()` to use `resolvePlaybackUrl()` instead of `asset.url`.

- [ ] **Step 2: Create `proxy-toggle.tsx`** — simple button showing Proxy: ON/OFF.

- [ ] **Step 3: Wire into edit-tab toolbar**, connect to `engine.setUseProxies()`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/editor/playback-engine.ts src/components/edit/proxy-toggle.tsx
git commit -m "feat: add proxy toggle and source URL resolution to playback engine"
```

---

### Task 17: Viewport-Aware Video Pool

**Files:**
- Modify: `src/lib/editor/playback-engine.ts`

- [ ] **Step 1: Add constants and lookahead method**

```typescript
private static readonly MAX_POOL_SIZE = 8;
private static readonly LOOKAHEAD_SECONDS = 10;

private getLookaheadClips(): Set<string> { ... }
```

Returns clip IDs that overlap `[currentTime, currentTime + 10s]` on video tracks.

- [ ] **Step 2: Update `updateVideoPool()`**

Change from "create element for every clip" to:
1. Compute needed = active clip IDs ∪ lookahead clip IDs
2. If `needed.size > MAX_POOL_SIZE`, keep only clips closest to playhead
3. Remove pool elements not in needed set
4. Create elements for new needed clips
5. Clips not in pool show cached thumbnail (handled by clip-card)

- [ ] **Step 3: Test** with 10+ clips — verify memory stays bounded, no playback glitches.

- [ ] **Step 4: Commit**

```bash
git add src/lib/editor/playback-engine.ts
git commit -m "feat: viewport-aware video pool with max 8 elements and LRU eviction"
```

---

## Chunk 5: Visual Feedback — Filmstrips + Waveforms

### Task 18: Filmstrip Background Component

**Files:**
- Create: `src/components/edit/filmstrip-background.tsx`
- Modify: `src/components/edit/clip-card.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Create `filmstrip-background.tsx`**

Props: `filmstripUrl`, `assetDuration`, `trimStart`, `clipDuration`, `clipWidthPx`.

Renders a `div` with CSS `background-image` set to the sprite sheet, `background-size` scaled to match clip width, `background-position` offset by trim.

Each sprite frame is 160px wide at 1fps. Math:
- `pxPerSecond = clipWidthPx / clipDuration`
- `scaledSpriteWidth = totalFrames * pxPerSecond`
- `offsetX = -(trimStart * pxPerSecond)`

- [ ] **Step 2: Integrate into clip-card.tsx**

Fallback chain:
1. If asset has filmstrip cache entry → render `<FilmstripBackground>`
2. Else if asset has thumbnailUrl → render as stretched background
3. Else → current solid color behavior

- [ ] **Step 3: Add `.filmstrip-bg` CSS** — absolute positioned, opacity 0.4, pointer-events none.

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/filmstrip-background.tsx src/components/edit/clip-card.tsx src/styles/globals.css
git commit -m "feat: filmstrip sprite sheet rendering on timeline clip cards"
```

---

### Task 19: Pre-computed Waveform Rendering

**Files:**
- Modify: `src/components/edit/waveform-canvas.tsx`

- [ ] **Step 1: Read existing waveform-canvas.tsx** to understand current implementation.

- [ ] **Step 2: Add support for loading peaks from JSON file**

Accept an optional `peaksUrl` prop. When provided, fetch the JSON and use the peaks array for rendering instead of decoding audio in-browser.

Short clips (<30s) with no peaksUrl continue using the existing browser AudioContext path.

- [ ] **Step 3: Test** — import audio file, wait for waveform generation, place on timeline, verify waveform renders.

- [ ] **Step 4: Commit**

```bash
git add src/components/edit/waveform-canvas.tsx
git commit -m "feat: support pre-computed waveform peaks from JSON files"
```

---

## Chunk 6: Export Pipeline + Link Detection

### Task 20: Real FFmpeg Export

**Files:**
- Modify: `electron/ipc/exports.ts`

- [ ] **Step 1: Rewrite export handler**

Replace `simulateRender()` with real ffmpeg rendering. The handler receives timeline state from the renderer, resolves source paths (always originals, never proxies), builds an ffmpeg command.

Start simple: sequential concat with `ffmpeg -filter_complex "[0:v]...[N:v]concat=n=N:v=1:a=1"`.

Handle per-clip: trim (in/out via `-ss`/`-t`), speed, volume.

- [ ] **Step 2: Add presets**

| Preset | Res | CRF | Codec |
|--------|-----|-----|-------|
| draft | source/2 | 28 | libx264 |
| standard | source | 20 | libx264 |
| high | source | 16 | libx264 |

- [ ] **Step 3: Progress reporting** — parse ffmpeg stderr for `time=` lines, compute percentage from total duration, forward to renderer.

- [ ] **Step 4: Cancellation** — kill ffmpeg child process, delete partial output file.

- [ ] **Step 5: Test** — create project with 2-3 clips, export, verify output plays correctly.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/exports.ts
git commit -m "feat: real ffmpeg export pipeline replacing mock renderer"
```

---

### Task 21: Broken Link Detection

**Files:**
- Modify: `electron/ipc/db.ts`
- Modify: `src/components/edit/left-panel.tsx`

- [ ] **Step 1: Validate links on project load**

In `db:project:load` handler, after `loadFullProject()`, iterate assets. For each asset with `file_ref` and no `source_url` (i.e., local file, not CDN), check if the file exists on disk. If not, set `status = 'offline'`.

- [ ] **Step 2: Show broken link indicator in media pool**

In left-panel.tsx, when rendering asset cards, check `asset.status === 'offline'`. Show a small warning icon overlay.

- [ ] **Step 3: Test** — import a file, close project, move the original file, reopen project, verify broken link icon appears.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/db.ts src/components/edit/left-panel.tsx
git commit -m "feat: broken link detection on project load with visual indicator"
```

---

## Task Summary

| Chunk | Tasks | Delivers |
|-------|-------|----------|
| 1: Foundation | 1-7 | SQLite schema, database, CRUD, IPC handlers |
| 2: React Bridge | 8-11 | Asset types, converters, workspace shell integration, home view |
| 3: Media Worker | 12-15 | Worker thread, ffmpeg jobs, file import, import button |
| 4: Playback | 16-17 | Proxy toggle, viewport-aware video pool |
| 5: Visual | 18-19 | Filmstrip backgrounds, pre-computed waveforms |
| 6: Export | 20-21 | Real ffmpeg export, broken link detection |
