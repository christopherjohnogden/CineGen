# Real Footage Support & SQLite Migration — Design Spec

## Goal

Transform CINEGEN Desktop from an AI-clip-only editor into a full NLE that supports importing real footage (video, image, audio) from the user's computer, while migrating from JSON file storage to SQLite for scalability. All existing AI generation features (workflow canvas, music generation, elements) must continue working.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | better-sqlite3 | Fast, synchronous, battle-tested in Electron (Obsidian, Linear) |
| Import mode | Link by default (copy optional) | Saves disk space; user can choose to copy per-import |
| Media processing | Node.js worker thread | Keeps main process responsive; ffmpeg runs as child processes of the worker |
| Migration | Fresh start | New projects use SQLite; old JSON projects remain untouched |
| AI features | Must keep working | AI-generated assets download to project folder and are treated identically to imported files |
| ffmpeg | ffmpeg-static + ffprobe-static npm packages | No system install required; bundled per-platform |

---

## Section 1: Project Folder Structure & SQLite Schema

### Project Folder

```
~/Documents/CINEGEN/{project-id}/
├── project.db                    # SQLite database (replaces project.json)
├── media/
│   ├── generated/                # AI-generated clips
│   │   ├── ai_clip_001.mp4
│   │   └── ai_music_001.wav
│   └── imported/                 # Copied files (when user chooses copy)
│       └── interview.mov
├── .cache/
│   ├── thumbnails/               # Single-frame thumbnails
│   ├── filmstrips/               # Sprite sheets for timeline scrubbing
│   ├── waveforms/                # Pre-computed audio peak JSON
│   └── proxies/                  # Low-res H.264 for editing
└── .links.json                   # Tracks symlinks/references to external files
```

### SQLite Schema

**projects** — project-level settings

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  resolution_width INTEGER DEFAULT 1920,
  resolution_height INTEGER DEFAULT 1080,
  frame_rate REAL DEFAULT 24.0
);
```

**assets** — every media file (imported, generated, AI music)

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('video', 'image', 'audio')),
  file_ref TEXT NOT NULL,           -- relative path (copied/generated) or absolute path (linked)
  original_path TEXT,               -- original import location for relinking
  source_url TEXT,                  -- CDN URL for AI-generated content
  thumbnail_url TEXT,
  duration REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  codec TEXT,
  file_size INTEGER,
  checksum TEXT,                    -- for relink matching
  proxy_ref TEXT,                   -- relative path to proxy file
  status TEXT DEFAULT 'online' CHECK(status IN ('online', 'offline', 'processing')),
  metadata TEXT,                    -- JSON blob for extensible metadata (pendingMusic, generating, etc.)
  folder_id TEXT REFERENCES media_folders(id),
  created_at TEXT DEFAULT (datetime('now'))
);
```

**media_folders** — folder organization in media pool

```sql
CREATE TABLE media_folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES media_folders(id),
  created_at TEXT DEFAULT (datetime('now'))
);
```

**timelines**

```sql
CREATE TABLE timelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  duration REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**tracks**

```sql
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL REFERENCES timelines(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('video', 'audio')),
  color TEXT NOT NULL DEFAULT '#666',
  muted INTEGER DEFAULT 0,
  solo INTEGER DEFAULT 0,
  locked INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  volume REAL DEFAULT 1.0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

**clips**

```sql
CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL REFERENCES timelines(id),
  track_id TEXT NOT NULL REFERENCES tracks(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  name TEXT NOT NULL,
  start_time REAL NOT NULL,
  duration REAL NOT NULL,
  trim_start REAL DEFAULT 0,
  trim_end REAL DEFAULT 0,
  speed REAL DEFAULT 1.0,
  opacity REAL DEFAULT 1.0,
  volume REAL DEFAULT 1.0,
  flip_h INTEGER DEFAULT 0,
  flip_v INTEGER DEFAULT 0,
  linked_clip_id TEXT REFERENCES clips(id),
  created_at TEXT DEFAULT (datetime('now'))
);
```

**keyframes**

```sql
CREATE TABLE keyframes (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL REFERENCES clips(id),
  time REAL NOT NULL,
  property TEXT NOT NULL CHECK(property IN ('opacity', 'volume')),
  value REAL NOT NULL
);
```

**transitions**

```sql
CREATE TABLE transitions (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL REFERENCES timelines(id),
  type TEXT NOT NULL CHECK(type IN ('dissolve', 'fadeToBlack', 'fadeFromBlack')),
  duration REAL NOT NULL,
  clip_a_id TEXT NOT NULL REFERENCES clips(id),
  clip_b_id TEXT REFERENCES clips(id)
);
```

**workflow_state** — xyflow nodes/edges stored as JSON

```sql
CREATE TABLE workflow_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  nodes TEXT DEFAULT '[]',          -- JSON array of xyflow nodes
  edges TEXT DEFAULT '[]'           -- JSON array of xyflow edges
);
```

**elements** — character/prop library

```sql
CREATE TABLE elements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('character', 'location', 'prop', 'vehicle')),
  description TEXT,
  images TEXT DEFAULT '[]',         -- JSON array of image URLs
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**cache_metadata** — tracks generated cache files

```sql
CREATE TABLE cache_metadata (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  type TEXT NOT NULL CHECK(type IN ('thumbnail', 'waveform', 'filmstrip', 'proxy')),
  file_ref TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**export_jobs** — export history

```sql
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'rendering', 'complete', 'failed')),
  progress REAL DEFAULT 0,
  preset TEXT,
  fps REAL,
  output_path TEXT,
  file_size INTEGER,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
```

---

## Section 2: Data Layer — SQLite Access & State Management

React state remains the source of truth during editing. SQLite is the persistence layer.

### Why not query SQLite at runtime?

- React useReducer + undo/redo already works — rewriting on top of SQL queries would be wasteful
- Playback engine needs in-memory data (60fps access)
- The current 500ms debounced save pattern works — just swap JSON writes for SQL writes

### State flow

1. **HYDRATE (project open):** Main process calls `loadFullProject(id)` — queries all tables, assembles same state shape the reducer expects. React side doesn't know the difference.

2. **Save (debounced 500ms):** Individual reducer actions map to targeted SQL operations:
   - `ADD_ASSET` → `INSERT INTO assets`
   - `SET_TIMELINE` → diff-based `UPDATE clips/tracks`
   - `UPDATE_NODE_CONFIG` → `UPDATE workflow_state SET nodes = ?`

3. **Undo/Redo:** Stays in-memory (React). SQLite persists only the "current" state.

### New IPC channels

```typescript
electronAPI.db = {
  // Project
  getProject(id: string): Promise<ProjectRow>
  updateProject(id: string, data: Partial<ProjectRow>): Promise<void>

  // Assets
  getAssets(projectId: string): Promise<AssetRow[]>
  insertAsset(asset: AssetRow): Promise<void>
  updateAsset(id: string, data: Partial<AssetRow>): Promise<void>
  deleteAsset(id: string): Promise<void>

  // Timeline (tracks + clips + transitions)
  getTimeline(id: string): Promise<{ tracks, clips, transitions, keyframes }>
  getTimelines(projectId: string): Promise<TimelineRow[]>
  upsertTrack(track: TrackRow): Promise<void>
  upsertClip(clip: ClipRow): Promise<void>
  deleteClip(id: string): Promise<void>
  upsertTransition(transition: TransitionRow): Promise<void>
  deleteTransition(id: string): Promise<void>

  // Keyframes
  setKeyframes(clipId: string, keyframes: KeyframeRow[]): Promise<void>

  // Workflow
  getWorkflowState(projectId: string): Promise<{ nodes, edges }>
  saveWorkflowState(projectId: string, data: { nodes, edges }): Promise<void>

  // Elements
  getElements(projectId: string): Promise<ElementRow[]>
  insertElement(element: ElementRow): Promise<void>
  updateElement(id: string, data: Partial<ElementRow>): Promise<void>
  deleteElement(id: string): Promise<void>

  // Folders
  getFolders(projectId: string): Promise<MediaFolderRow[]>
  insertFolder(folder: MediaFolderRow): Promise<void>
  updateFolder(id: string, data: Partial<MediaFolderRow>): Promise<void>
  deleteFolder(id: string): Promise<void>

  // Exports
  getExports(projectId: string): Promise<ExportJobRow[]>
  insertExport(job: ExportJobRow): Promise<void>
  updateExport(id: string, data: Partial<ExportJobRow>): Promise<void>

  // Cache
  getCacheMetadata(assetId: string): Promise<CacheMetadataRow[]>
  insertCacheMetadata(meta: CacheMetadataRow): Promise<void>

  // Bulk load
  loadFullProject(id: string): Promise<FullProjectState>
}
```

---

## Section 3: File Import Pipeline

### User experience

1. User clicks "Import" in media pool or drags files onto the app
2. Native file dialog opens — accepts video, image, audio
3. Files appear in media pool immediately (metadata extracted in <1s)
4. Background jobs kick off for proxy, filmstrip, waveform
5. Progress indicators show on asset cards until processing completes

### Import modes

- **Link (default):** Store absolute path in `assets.file_ref`. File stays in place. Fast, no disk usage.
- **Copy:** Copy file into `media/imported/`. Store relative path in `file_ref`. Slower but portable.

User picks per-import via a toggle. `assets.original_path` always stores the source location for relinking.

### Metadata extraction (ffprobe)

Runs immediately on import (<1 second). Extracts: duration, resolution, FPS, codec, file size, audio channels. Generates a checksum for relink matching.

### AI-generated assets

When an AI workflow completes:
1. Download file to `media/generated/`
2. Extract metadata via ffprobe
3. Insert asset into SQLite with both `file_ref` (local) and `source_url` (CDN)
4. Queue background jobs (thumbnail, filmstrip, etc.)

AI and imported content are treated identically once in the project.

### Broken link detection

On project open, check all linked assets. If `file_ref` doesn't exist, set `status = 'offline'`. Show broken-link icon in media pool. User can relink or app searches by checksum.

### Supported formats

- Video: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.mxf`, `.m4v`
- Audio: `.wav`, `.mp3`, `.aac`, `.flac`, `.ogg`, `.m4a`
- Image: `.jpg`, `.jpeg`, `.png`, `.webp`, `.tiff`, `.bmp`, `.gif`

---

## Section 4: Media Processing — Worker Thread & Job Queue

### Architecture

```
Renderer (React)
    ↕ IPC (job:submit, job:status, job:cancel)
Electron Main Process
    ↕ worker_threads (postMessage)
Media Worker Thread
    ↕ child_process.spawn
ffmpeg / ffprobe processes
```

### Worker configuration

- Single long-lived worker thread, spawned on app startup
- Concurrency limit: 2 simultaneous ffmpeg processes
- Priority: metadata > thumbnail > waveform > filmstrip > proxy
- Cancelable: main process can kill specific ffmpeg child processes

### Job types

| Job | Output | Speed |
|-----|--------|-------|
| `extract_metadata` | Asset row fields | <1s |
| `generate_thumbnail` | `.cache/thumbnails/{assetId}.jpg` | <1s |
| `compute_waveform` | `.cache/waveforms/{assetId}.json` | 2-10s |
| `generate_filmstrip` | `.cache/filmstrips/{assetId}.jpg` sprite sheet | 5-30s |
| `generate_proxy` | `.cache/proxies/{assetId}.mp4` 960px H.264 CRF 23 | 30s-5min |

### Progress reporting

Worker sends `postMessage` updates → main process → renderer via IPC:
- `{ jobId, status: 'running', progress: 0.45 }`
- `{ jobId, status: 'complete', outputPath: '...' }`
- `{ jobId, status: 'error', error: '...' }`

### Proxy trigger conditions

Proxy generated when:
- Video resolution > 1080p, OR
- Video bitrate > 50 Mbps, OR
- Codec is not H.264/H.265

Small H.264 files play directly — no proxy overhead.

### Playback toggle

"Use Proxies" toolbar toggle. When on, playback engine resolves `proxy_ref` instead of `file_ref`. Export always uses original files.

---

## Section 5: Viewport-Aware Video Pool

### The problem

Current pool creates a `<video>` element per clip. With dozens of imported clips loading multi-GB files, this causes memory exhaustion.

### Pool rules

- **Active zone:** Clips overlapping current playhead — always loaded, playing
- **Lookahead buffer:** Clips within 10 seconds ahead — pre-loaded, pre-seeked
- **Max pool size:** 8 simultaneous `<video>` elements, LRU eviction
- **Everything else:** Show cached thumbnail/filmstrip

### Integration with playback engine

Extend `PlaybackEngine` with `getLookaheadClips(bufferSeconds)`. Change `updateVideoPool()` from "element per clip" to "elements for active + lookahead only, evict the rest."

### Source resolution

1. "Use Proxies" on + `proxy_ref` exists → proxy file
2. Otherwise → `file_ref` (original or linked)
3. AI asset with only `source_url` → CDN URL (backwards compatible)

### Eviction

When a clip leaves the lookahead buffer and pool is at max: `src = ''`, remove from DOM, delete Map entry.

---

## Section 6: Filmstrip Thumbnails & Waveforms

### Filmstrip thumbnails

- ffmpeg generates horizontal sprite sheet: one 160px-wide frame per second
- Stored as single JPEG: `.cache/filmstrips/{assetId}.jpg`
- Clip-card uses CSS `background-image` + `background-position` for correct slice
- As clip is trimmed/resized, visible sprite portion shifts

### Fallback chain

1. Filmstrip ready → sprite sheet slices
2. Not yet generated → single thumbnail stretched
3. No thumbnail → colored placeholder (current behavior)

### Waveforms

- ffmpeg extracts mono PCM at 8kHz, compute ~4000 peak values per file
- Stored as JSON: `.cache/waveforms/{assetId}.json`
- Canvas renderer reads peaks array and draws waveform
- Short AI clips (<30s): can use browser `AudioContext.decodeAudioData()` as fast path

---

## Section 7: Export Pipeline

### Flow

1. User picks preset + output format
2. Renderer sends full timeline state to main process
3. Main resolves all source paths — always originals, never proxies
4. Passes to media worker as `export` job
5. Worker builds ffmpeg filter graph, spawns process
6. Progress via frame count → percentage
7. Returns output file path on completion

### Source resolution for export

- AI-generated → `media/generated/{file}`
- Linked import → original absolute path
- Copied import → `media/imported/{file}`

### Filter graph

Per clip: trim, speed/reverse, opacity, transitions, audio mixing with volume keyframes. Concat all.

### Presets

| Preset | Resolution | Codec | Quality |
|--------|-----------|-------|---------|
| Draft | Source/2 | H.264 | CRF 28 |
| Standard | Source | H.264 | CRF 20 |
| High | Source | ProRes 422 / H.264 | CRF 16 |

### Output formats

`.mp4` (H.264), `.mov` (ProRes), `.webm` (VP9)

### Cancellation

Kill ffmpeg child process, delete partial output.

---

## Section 8: ffmpeg Bundling

### Packages

- `ffmpeg-static` — pre-built ffmpeg binary
- `ffprobe-static` — pre-built ffprobe binary

### Electron packaging

```json
{
  "asarUnpack": [
    "node_modules/ffmpeg-static/**",
    "node_modules/ffprobe-static/**"
  ]
}
```

### Path resolution

```typescript
function getFfmpegPath(): string {
  const bin = require('ffmpeg-static');
  return app.isPackaged ? bin.replace('app.asar', 'app.asar.unpacked') : bin;
}
```

### Size impact

~70-100MB per platform. Standard for video editing apps.

---

## Implementation Priority

| Phase | What | Impact |
|-------|------|--------|
| 1 | SQLite + better-sqlite3 + schema + project CRUD | Foundation for everything |
| 2 | Data layer — IPC channels, hydrate, save | React ↔ SQLite bridge |
| 3 | ffmpeg bundling + media worker thread | Processing infrastructure |
| 4 | File import flow + metadata extraction | Users can bring in footage |
| 5 | Proxy workflow | Real footage playable in browser |
| 6 | Viewport-aware video pool | Memory management for many clips |
| 7 | Filmstrip thumbnails + waveforms | Visual timeline feedback |
| 8 | Export pipeline (real ffmpeg) | Full-res output |
