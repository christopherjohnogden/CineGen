import type { RunResult } from 'better-sqlite3';
import { ProjectDatabase, generateId, timestamp } from './database.js';

// ---------------------------------------------------------------------------
// Row type interfaces — snake_case columns matching the SQL schema
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  resolution_width: number;
  resolution_height: number;
  frame_rate: number;
}

export interface AssetRow {
  id: string;
  project_id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  file_ref: string | null;
  original_path: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  file_size: number | null;
  checksum: string | null;
  proxy_ref: string | null;
  status: 'online' | 'offline' | 'processing';
  metadata: string | null;
  folder_id: string | null;
  created_at: string;
}

export interface MediaFolderRow {
  id: string;
  project_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface TimelineRow {
  id: string;
  project_id: string;
  name: string;
  duration: number;
  created_at: string;
}

export interface TrackRow {
  id: string;
  timeline_id: string;
  name: string;
  kind: 'video' | 'audio';
  color: string;
  muted: number;
  solo: number;
  locked: number;
  visible: number;
  volume: number;
  sort_order: number;
}

export interface ClipRow {
  id: string;
  timeline_id: string;
  track_id: string;
  asset_id: string | null;
  name: string;
  start_time: number;
  duration: number;
  trim_start: number;
  trim_end: number;
  speed: number;
  opacity: number;
  volume: number;
  flip_h: number;
  flip_v: number;
  linked_clip_id: string | null;
  created_at: string;
}

export interface KeyframeRow {
  id: string;
  clip_id: string;
  time: number;
  property: 'opacity' | 'volume';
  value: number;
}

export interface TransitionRow {
  id: string;
  timeline_id: string;
  type: 'dissolve' | 'fadeToBlack' | 'fadeFromBlack';
  duration: number;
  clip_a_id: string | null;
  clip_b_id: string | null;
}

export interface ElementRow {
  id: string;
  project_id: string;
  name: string;
  type: 'character' | 'location' | 'prop' | 'vehicle';
  description: string | null;
  images: string;
  created_at: string;
  updated_at: string;
}

export interface CacheMetadataRow {
  id: string;
  asset_id: string;
  type: 'thumbnail' | 'waveform' | 'filmstrip' | 'proxy';
  file_ref: string;
  created_at: string;
}

export interface ExportJobRow {
  id: string;
  project_id: string;
  status: 'queued' | 'rendering' | 'complete' | 'failed';
  progress: number;
  preset: string | null;
  fps: number | null;
  output_path: string | null;
  file_size: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// FullProjectState — returned by loadFullProject
// ---------------------------------------------------------------------------

export interface FullProjectState {
  project: ProjectRow;
  assets: AssetRow[];
  mediaFolders: MediaFolderRow[];
  timelines: Array<
    TimelineRow & {
      tracks: TrackRow[];
      clips: Array<ClipRow & { keyframes: KeyframeRow[] }>;
      transitions: TransitionRow[];
    }
  >;
  activeTimelineId: string;
  workflow: {
    nodes: unknown[];
    edges: unknown[];
    spaces?: Array<{
      id: string;
      name: string;
      createdAt?: string;
      created_at?: string;
      nodes: unknown[];
      edges: unknown[];
    }>;
    activeSpaceId?: string;
    openSpaceIds?: string[];
  };
  elements: ElementRow[];
  exports: ExportJobRow[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Valid column names per table — used to prevent SQL injection via dynamic SET clauses. */
const VALID_COLUMNS: Record<string, Set<string>> = {
  projects: new Set(['name', 'created_at', 'updated_at', 'resolution_width', 'resolution_height', 'frame_rate']),
  assets: new Set(['project_id', 'name', 'type', 'file_ref', 'original_path', 'source_url', 'thumbnail_url', 'duration', 'width', 'height', 'fps', 'codec', 'file_size', 'checksum', 'proxy_ref', 'status', 'metadata', 'folder_id', 'created_at']),
  media_folders: new Set(['project_id', 'name', 'parent_id', 'created_at']),
  timelines: new Set(['project_id', 'name', 'duration', 'created_at']),
  tracks: new Set(['timeline_id', 'name', 'kind', 'color', 'muted', 'solo', 'locked', 'visible', 'volume', 'sort_order']),
  clips: new Set(['timeline_id', 'track_id', 'asset_id', 'name', 'start_time', 'duration', 'trim_start', 'trim_end', 'speed', 'opacity', 'volume', 'flip_h', 'flip_v', 'linked_clip_id', 'created_at']),
  keyframes: new Set(['clip_id', 'time', 'property', 'value']),
  transitions: new Set(['timeline_id', 'type', 'duration', 'clip_a_id', 'clip_b_id']),
  elements: new Set(['project_id', 'name', 'type', 'description', 'images', 'created_at', 'updated_at']),
  export_jobs: new Set(['project_id', 'status', 'progress', 'preset', 'fps', 'output_path', 'file_size', 'error', 'created_at', 'completed_at']),
};

/**
 * Builds a dynamic SET clause from a partial row object, excluding `id`.
 * Only allows whitelisted column names to prevent SQL injection.
 * Returns { setClauses: string, values: unknown[] }.
 */
function buildSetClause<T extends Record<string, unknown>>(
  partial: Partial<T>,
  table: string,
): { setClauses: string; values: unknown[] } {
  const allowedCols = VALID_COLUMNS[table];
  const entries = Object.entries(partial).filter(
    ([k]) => k !== 'id' && (!allowedCols || allowedCols.has(k)),
  );
  if (entries.length === 0) throw new Error('No valid fields to update');
  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  return { setClauses, values };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function insertProject(db: ProjectDatabase, row: ProjectRow): RunResult {
  return db.run(
    `INSERT INTO projects (id, name, created_at, updated_at, resolution_width, resolution_height, frame_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      row.created_at,
      row.updated_at,
      row.resolution_width,
      row.resolution_height,
      row.frame_rate,
    ],
  );
}

export function getProject(db: ProjectDatabase, id: string): ProjectRow | undefined {
  return db.queryOne<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
}

export function updateProject(
  db: ProjectDatabase,
  id: string,
  partial: Partial<Omit<ProjectRow, 'id'>>,
): RunResult {
  const { setClauses, values } = buildSetClause(partial as Record<string, unknown>, 'projects');
  return db.run(`UPDATE projects SET ${setClauses} WHERE id = ?`, [...values, id]);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function getAssets(db: ProjectDatabase, projectId: string): AssetRow[] {
  return db.query<AssetRow>('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at', [
    projectId,
  ]);
}

export function insertAsset(db: ProjectDatabase, row: AssetRow): RunResult {
  return db.run(
    `INSERT INTO assets
       (id, project_id, name, type, file_ref, original_path, source_url, thumbnail_url,
        duration, width, height, fps, codec, file_size, checksum, proxy_ref,
        status, metadata, folder_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.name,
      row.type,
      row.file_ref,
      row.original_path,
      row.source_url,
      row.thumbnail_url,
      row.duration,
      row.width,
      row.height,
      row.fps,
      row.codec,
      row.file_size,
      row.checksum,
      row.proxy_ref,
      row.status,
      row.metadata,
      row.folder_id,
      row.created_at,
    ],
  );
}

export function updateAsset(
  db: ProjectDatabase,
  id: string,
  partial: Partial<Omit<AssetRow, 'id'>>,
): RunResult {
  const { setClauses, values } = buildSetClause(partial as Record<string, unknown>, 'assets');
  return db.run(`UPDATE assets SET ${setClauses} WHERE id = ?`, [...values, id]);
}

export function deleteAsset(db: ProjectDatabase, id: string): RunResult {
  return db.run('DELETE FROM assets WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// MediaFolders
// ---------------------------------------------------------------------------

export function getFolders(db: ProjectDatabase, projectId: string): MediaFolderRow[] {
  return db.query<MediaFolderRow>(
    'SELECT * FROM media_folders WHERE project_id = ? ORDER BY created_at',
    [projectId],
  );
}

export function insertFolder(db: ProjectDatabase, row: MediaFolderRow): RunResult {
  return db.run(
    `INSERT INTO media_folders (id, project_id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.id, row.project_id, row.name, row.parent_id, row.created_at],
  );
}

export function updateFolder(
  db: ProjectDatabase,
  id: string,
  partial: Partial<Omit<MediaFolderRow, 'id'>>,
): RunResult {
  const { setClauses, values } = buildSetClause(partial as Record<string, unknown>, 'media_folders');
  return db.run(`UPDATE media_folders SET ${setClauses} WHERE id = ?`, [...values, id]);
}

/** Deletes the folder and nulls out folder_id on any assets pointing to it. */
export function deleteFolder(db: ProjectDatabase, id: string): void {
  db.transaction(() => {
    db.run('UPDATE assets SET folder_id = NULL WHERE folder_id = ?', [id]);
    db.run('DELETE FROM media_folders WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

export function getTimelines(db: ProjectDatabase, projectId: string): TimelineRow[] {
  return db.query<TimelineRow>(
    'SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at',
    [projectId],
  );
}

export function insertTimeline(db: ProjectDatabase, row: TimelineRow): RunResult {
  return db.run(
    `INSERT INTO timelines (id, project_id, name, duration, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.id, row.project_id, row.name, row.duration, row.created_at],
  );
}

export function updateTimeline(
  db: ProjectDatabase,
  id: string,
  partial: Partial<Omit<TimelineRow, 'id'>>,
): RunResult {
  const { setClauses, values } = buildSetClause(partial as Record<string, unknown>, 'timelines');
  return db.run(`UPDATE timelines SET ${setClauses} WHERE id = ?`, [...values, id]);
}

/** Cascade-deletes tracks, clips, keyframes, and transitions for this timeline. */
export function deleteTimeline(db: ProjectDatabase, id: string): void {
  db.transaction(() => {
    // Keyframes for every clip on this timeline
    db.run(
      'DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE timeline_id = ?)',
      [id],
    );
    db.run('DELETE FROM clips WHERE timeline_id = ?', [id]);
    db.run('DELETE FROM tracks WHERE timeline_id = ?', [id]);
    db.run('DELETE FROM transitions WHERE timeline_id = ?', [id]);
    db.run('DELETE FROM timelines WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function getTracks(db: ProjectDatabase, timelineId: string): TrackRow[] {
  return db.query<TrackRow>(
    'SELECT * FROM tracks WHERE timeline_id = ? ORDER BY sort_order',
    [timelineId],
  );
}

export function upsertTrack(db: ProjectDatabase, row: TrackRow): RunResult {
  return db.run(
    `INSERT INTO tracks
       (id, timeline_id, name, kind, color, muted, solo, locked, visible, volume, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id = excluded.timeline_id,
       name        = excluded.name,
       kind        = excluded.kind,
       color       = excluded.color,
       muted       = excluded.muted,
       solo        = excluded.solo,
       locked      = excluded.locked,
       visible     = excluded.visible,
       volume      = excluded.volume,
       sort_order  = excluded.sort_order`,
    [
      row.id,
      row.timeline_id,
      row.name,
      row.kind,
      row.color,
      row.muted,
      row.solo,
      row.locked,
      row.visible,
      row.volume,
      row.sort_order,
    ],
  );
}

/** Cascade-deletes clips and their keyframes for this track, then the track. */
export function deleteTrack(db: ProjectDatabase, id: string): void {
  db.transaction(() => {
    db.run(
      'DELETE FROM keyframes WHERE clip_id IN (SELECT id FROM clips WHERE track_id = ?)',
      [id],
    );
    db.run('DELETE FROM clips WHERE track_id = ?', [id]);
    db.run('DELETE FROM tracks WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export function getClips(db: ProjectDatabase, timelineId: string): ClipRow[] {
  return db.query<ClipRow>(
    'SELECT * FROM clips WHERE timeline_id = ? ORDER BY start_time',
    [timelineId],
  );
}

export function upsertClip(db: ProjectDatabase, row: ClipRow): RunResult {
  return db.run(
    `INSERT INTO clips
       (id, timeline_id, track_id, asset_id, name, start_time, duration,
        trim_start, trim_end, speed, opacity, volume, flip_h, flip_v,
        linked_clip_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id    = excluded.timeline_id,
       track_id       = excluded.track_id,
       asset_id       = excluded.asset_id,
       name           = excluded.name,
       start_time     = excluded.start_time,
       duration       = excluded.duration,
       trim_start     = excluded.trim_start,
       trim_end       = excluded.trim_end,
       speed          = excluded.speed,
       opacity        = excluded.opacity,
       volume         = excluded.volume,
       flip_h         = excluded.flip_h,
       flip_v         = excluded.flip_v,
       linked_clip_id = excluded.linked_clip_id`,
    [
      row.id,
      row.timeline_id,
      row.track_id,
      row.asset_id,
      row.name,
      row.start_time,
      row.duration,
      row.trim_start,
      row.trim_end,
      row.speed,
      row.opacity,
      row.volume,
      row.flip_h,
      row.flip_v,
      row.linked_clip_id,
      row.created_at,
    ],
  );
}

/** Cascade-deletes keyframes for this clip, then the clip itself. */
export function deleteClip(db: ProjectDatabase, id: string): void {
  db.transaction(() => {
    db.run('DELETE FROM keyframes WHERE clip_id = ?', [id]);
    db.run('DELETE FROM clips WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

export function getKeyframes(db: ProjectDatabase, clipId: string): KeyframeRow[] {
  return db.query<KeyframeRow>(
    'SELECT * FROM keyframes WHERE clip_id = ? ORDER BY time',
    [clipId],
  );
}

/** Replaces all keyframes for a clip atomically (delete all + reinsert). */
export function setKeyframes(
  db: ProjectDatabase,
  clipId: string,
  keyframes: Omit<KeyframeRow, 'id'>[],
): void {
  db.transaction(() => {
    db.run('DELETE FROM keyframes WHERE clip_id = ?', [clipId]);
    for (const kf of keyframes) {
      db.run(
        'INSERT INTO keyframes (id, clip_id, time, property, value) VALUES (?, ?, ?, ?, ?)',
        [generateId(), kf.clip_id, kf.time, kf.property, kf.value],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function getTransitions(db: ProjectDatabase, timelineId: string): TransitionRow[] {
  return db.query<TransitionRow>(
    'SELECT * FROM transitions WHERE timeline_id = ?',
    [timelineId],
  );
}

export function upsertTransition(db: ProjectDatabase, row: TransitionRow): RunResult {
  return db.run(
    `INSERT INTO transitions (id, timeline_id, type, duration, clip_a_id, clip_b_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       timeline_id = excluded.timeline_id,
       type        = excluded.type,
       duration    = excluded.duration,
       clip_a_id   = excluded.clip_a_id,
       clip_b_id   = excluded.clip_b_id`,
    [row.id, row.timeline_id, row.type, row.duration, row.clip_a_id, row.clip_b_id],
  );
}

export function deleteTransition(db: ProjectDatabase, id: string): RunResult {
  return db.run('DELETE FROM transitions WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// WorkflowState
// ---------------------------------------------------------------------------

export function getWorkflowState(
  db: ProjectDatabase,
  projectId: string,
): FullProjectState['workflow'] {
  const row = db.queryOne<{ nodes: string; edges: string }>(
    'SELECT nodes, edges FROM workflow_state WHERE project_id = ?',
    [projectId],
  );
  if (!row) return { nodes: [], edges: [] };
  const nodes = JSON.parse(row.nodes) as unknown;
  const edges = JSON.parse(row.edges) as unknown;
  if (edges && typeof edges === 'object' && !Array.isArray(edges)) {
    const record = edges as Record<string, unknown>;
    return {
      nodes: Array.isArray(nodes) ? nodes : [],
      edges: Array.isArray(record.edges) ? record.edges : [],
      spaces: Array.isArray(record.spaces) ? record.spaces as FullProjectState['workflow']['spaces'] : undefined,
      activeSpaceId: typeof record.activeSpaceId === 'string' ? record.activeSpaceId : undefined,
      openSpaceIds: Array.isArray(record.openSpaceIds)
        ? record.openSpaceIds.filter((value): value is string => typeof value === 'string')
        : undefined,
    };
  }
  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : [],
  };
}

export function saveWorkflowState(
  db: ProjectDatabase,
  projectId: string,
  workflow: FullProjectState['workflow'],
): RunResult {
  return db.run(
    `INSERT INTO workflow_state (project_id, nodes, edges)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       nodes = excluded.nodes,
       edges = excluded.edges`,
    [
      projectId,
      JSON.stringify(workflow.nodes),
      JSON.stringify({
        edges: workflow.edges,
        spaces: workflow.spaces ?? [],
        activeSpaceId: workflow.activeSpaceId ?? null,
        openSpaceIds: workflow.openSpaceIds ?? [],
      }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export function getElements(db: ProjectDatabase, projectId: string): ElementRow[] {
  return db.query<ElementRow>(
    'SELECT * FROM elements WHERE project_id = ? ORDER BY created_at',
    [projectId],
  );
}

export function insertElement(db: ProjectDatabase, row: ElementRow): RunResult {
  return db.run(
    `INSERT INTO elements (id, project_id, name, type, description, images, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.name,
      row.type,
      row.description,
      row.images,
      row.created_at,
      row.updated_at,
    ],
  );
}

export function updateElement(
  db: ProjectDatabase,
  id: string,
  partial: Partial<Omit<ElementRow, 'id'>>,
): RunResult {
  const { setClauses, values } = buildSetClause(partial as Record<string, unknown>, 'elements');
  return db.run(`UPDATE elements SET ${setClauses} WHERE id = ?`, [...values, id]);
}

export function deleteElement(db: ProjectDatabase, id: string): RunResult {
  return db.run('DELETE FROM elements WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// CacheMetadata
// ---------------------------------------------------------------------------

export function getCacheMetadata(db: ProjectDatabase, assetId: string): CacheMetadataRow[] {
  return db.query<CacheMetadataRow>(
    'SELECT * FROM cache_metadata WHERE asset_id = ? ORDER BY created_at',
    [assetId],
  );
}

export function insertCacheMetadata(db: ProjectDatabase, row: CacheMetadataRow): RunResult {
  return db.run(
    `INSERT INTO cache_metadata (id, asset_id, type, file_ref, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [row.id, row.asset_id, row.type, row.file_ref, row.created_at],
  );
}

// ---------------------------------------------------------------------------
// ExportJobs
// ---------------------------------------------------------------------------

export function getExports(db: ProjectDatabase, projectId: string): ExportJobRow[] {
  return db.query<ExportJobRow>(
    'SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC',
    [projectId],
  );
}

export function insertExport(db: ProjectDatabase, row: ExportJobRow): RunResult {
  return db.run(
    `INSERT INTO export_jobs
       (id, project_id, status, progress, preset, fps, output_path, file_size,
        error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.status,
      row.progress,
      row.preset,
      row.fps,
      row.output_path,
      row.file_size,
      row.error,
      row.created_at,
      row.completed_at,
    ],
  );
}

export function updateExport(
  db: ProjectDatabase,
  id: string,
  partial: Partial<Omit<ExportJobRow, 'id'>>,
): RunResult {
  const { setClauses, values } = buildSetClause(partial as Record<string, unknown>, 'export_jobs');
  return db.run(`UPDATE export_jobs SET ${setClauses} WHERE id = ?`, [...values, id]);
}

// ---------------------------------------------------------------------------
// loadFullProject — queries all tables and returns a FullProjectState
// ---------------------------------------------------------------------------

export function loadFullProject(db: ProjectDatabase, projectId: string): FullProjectState {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const assets = getAssets(db, projectId);
  const mediaFolders = getFolders(db, projectId);
  const workflow = getWorkflowState(db, projectId);
  const elements = getElements(db, projectId);
  const exports = getExports(db, projectId);

  const timelineRows = getTimelines(db, projectId);

  const timelines = timelineRows.map((tl) => {
    const tracks = getTracks(db, tl.id);
    const clipRows = getClips(db, tl.id);
    const transitions = getTransitions(db, tl.id);

    const clips = clipRows.map((clip) => ({
      ...clip,
      keyframes: getKeyframes(db, clip.id),
    }));

    return { ...tl, tracks, clips, transitions };
  });

  const activeTimelineId = timelines.length > 0 ? timelines[0].id : '';

  return {
    project,
    assets,
    mediaFolders,
    timelines,
    activeTimelineId,
    workflow,
    elements,
    exports,
  };
}

// ---------------------------------------------------------------------------
// saveFullProject — persists the full state in a single transaction
// ---------------------------------------------------------------------------

export function saveFullProject(
  db: ProjectDatabase,
  projectId: string,
  state: FullProjectState,
): void {
  db.transaction(() => {
    // ---- Project ----
    const existingProject = getProject(db, projectId);
    if (existingProject) {
      updateProject(db, projectId, {
        name: state.project.name,
        updated_at: timestamp(),
        resolution_width: state.project.resolution_width,
        resolution_height: state.project.resolution_height,
        frame_rate: state.project.frame_rate,
      });
    } else {
      insertProject(db, { ...state.project, updated_at: timestamp() });
    }

    // ---- Media Folders ----
    const existingFolderIds = new Set(
      db.query<{ id: string }>('SELECT id FROM media_folders WHERE project_id = ?', [projectId])
        .map((r) => r.id),
    );
    const incomingFolderIds = new Set(state.mediaFolders.map((f) => f.id));
    for (const id of existingFolderIds) {
      if (!incomingFolderIds.has(id)) {
        db.run('UPDATE assets SET folder_id = NULL WHERE folder_id = ?', [id]);
        db.run('DELETE FROM media_folders WHERE id = ?', [id]);
      }
    }
    for (const folder of state.mediaFolders) {
      if (existingFolderIds.has(folder.id)) {
        updateFolder(db, folder.id, {
          name: folder.name,
          parent_id: folder.parent_id,
        });
      } else {
        insertFolder(db, folder);
      }
    }

    // ---- Assets ----
    const existingAssetIds = new Set(
      db.query<{ id: string }>('SELECT id FROM assets WHERE project_id = ?', [projectId])
        .map((r) => r.id),
    );
    const incomingAssetIds = new Set(state.assets.map((a) => a.id));
    for (const id of existingAssetIds) {
      if (!incomingAssetIds.has(id)) deleteAsset(db, id);
    }
    for (const asset of state.assets) {
      if (existingAssetIds.has(asset.id)) {
        const { id: _id, project_id: _pid, created_at: _ca, ...rest } = asset;
        updateAsset(db, asset.id, rest);
      } else {
        insertAsset(db, asset);
      }
    }

    // ---- Timelines ----
    const existingTimelineIds = new Set(
      db.query<{ id: string }>('SELECT id FROM timelines WHERE project_id = ?', [projectId])
        .map((r) => r.id),
    );
    const incomingTimelineIds = new Set(state.timelines.map((tl) => tl.id));
    for (const id of existingTimelineIds) {
      if (!incomingTimelineIds.has(id)) deleteTimeline(db, id);
    }

    for (const tl of state.timelines) {
      if (existingTimelineIds.has(tl.id)) {
        updateTimeline(db, tl.id, { name: tl.name, duration: tl.duration });
      } else {
        const { tracks: _t, clips: _c, transitions: _tr, ...tlRow } = tl;
        insertTimeline(db, tlRow);
      }

      // ---- Tracks ----
      const existingTrackIds = new Set(
        db.query<{ id: string }>('SELECT id FROM tracks WHERE timeline_id = ?', [tl.id])
          .map((r) => r.id),
      );
      const incomingTrackIds = new Set(tl.tracks.map((t) => t.id));
      for (const id of existingTrackIds) {
        if (!incomingTrackIds.has(id)) deleteTrack(db, id);
      }
      for (const track of tl.tracks) {
        upsertTrack(db, track);
      }

      // ---- Clips ----
      const existingClipIds = new Set(
        db.query<{ id: string }>('SELECT id FROM clips WHERE timeline_id = ?', [tl.id])
          .map((r) => r.id),
      );
      const incomingClipIds = new Set(tl.clips.map((c) => c.id));
      for (const id of existingClipIds) {
        if (!incomingClipIds.has(id)) deleteClip(db, id);
      }
      for (const clip of tl.clips) {
        const { keyframes, ...clipRow } = clip;
        upsertClip(db, clipRow);
        setKeyframes(
          db,
          clip.id,
          keyframes.map(({ id: _id, ...kf }) => kf),
        );
      }

      // ---- Transitions ----
      const existingTransitionIds = new Set(
        db.query<{ id: string }>('SELECT id FROM transitions WHERE timeline_id = ?', [tl.id])
          .map((r) => r.id),
      );
      const incomingTransitionIds = new Set(tl.transitions.map((tr) => tr.id));
      for (const id of existingTransitionIds) {
        if (!incomingTransitionIds.has(id)) deleteTransition(db, id);
      }
      for (const transition of tl.transitions) {
        upsertTransition(db, transition);
      }
    }

    // ---- Workflow State ----
    saveWorkflowState(db, projectId, state.workflow);

    // ---- Elements ----
    const existingElementIds = new Set(
      db.query<{ id: string }>('SELECT id FROM elements WHERE project_id = ?', [projectId])
        .map((r) => r.id),
    );
    const incomingElementIds = new Set(state.elements.map((e) => e.id));
    for (const id of existingElementIds) {
      if (!incomingElementIds.has(id)) deleteElement(db, id);
    }
    for (const el of state.elements) {
      if (existingElementIds.has(el.id)) {
        const { id: _id, project_id: _pid, created_at: _ca, ...rest } = el;
        updateElement(db, el.id, { ...rest, updated_at: timestamp() });
      } else {
        insertElement(db, el);
      }
    }

    // ---- Export Jobs (insert-only; never delete existing jobs) ----
    const existingExportIds = new Set(
      db.query<{ id: string }>('SELECT id FROM export_jobs WHERE project_id = ?', [projectId])
        .map((r) => r.id),
    );
    for (const job of state.exports) {
      if (existingExportIds.has(job.id)) {
        const { id: _id, project_id: _pid, created_at: _ca, ...rest } = job;
        updateExport(db, job.id, rest);
      } else {
        insertExport(db, job);
      }
    }
  });
}
