/**
 * db-converters.ts
 *
 * Bidirectional conversion between SQLite DB rows (snake_case, 0/1 booleans,
 * JSON strings) and the React state types used throughout the application
 * (camelCase, real booleans, parsed objects).
 *
 * Row parameters are typed as Record<string, unknown> because that is what
 * arrives over the Electron IPC bridge.  Each converter casts individual
 * fields with safe fallback values so callers never receive undefined where
 * the interface demands a concrete type.
 */

import type { Asset, MediaFolder } from '../types/project';
import type { Timeline, Track, Clip, Keyframe, Transition } from '../types/timeline';
import type { Element, ElementImage } from '../types/elements';
import type { ExportJob, ExportPreset, ExportStatus } from '../types/export';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely cast an unknown value to a string, or return the fallback. */
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Safely cast an unknown value to a number, or return the fallback. */
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

/** Safely cast an unknown value to a boolean.  SQLite stores booleans as
 *  0/1 integers; JS booleans pass through unchanged. */
function bool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

/** Return the value if it's a non-empty string, otherwise undefined. */
function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Return the value if it's a finite number, otherwise undefined. */
function optNum(v: unknown): number | undefined {
  const n = Number(v);
  return v !== null && v !== undefined && !isNaN(n) ? n : undefined;
}

/** Parse a JSON string field; return a fallback value on failure. */
function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Return true when a URL looks like a CDN/remote URL rather than a local path. */
function isCdnUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

// ---------------------------------------------------------------------------
// DB Row → React State (hydration)
// ---------------------------------------------------------------------------

/** Convert an AssetRow (from DB/IPC) to the React Asset type. */
export function assetFromRow(row: Record<string, unknown>): Asset {
  const fileRef = optStr(row['file_ref']);
  const sourceUrl = optStr(row['source_url']);

  // url is the primary playback/display URL: prefer source_url (CDN) when
  // present, otherwise fall back to file_ref (local file).
  const url = sourceUrl ?? fileRef ?? '';

  return {
    id: str(row['id']),
    name: str(row['name']),
    type: (str(row['type']) || 'video') as Asset['type'],
    url,
    thumbnailUrl: optStr(row['thumbnail_url']),
    duration: optNum(row['duration']),
    width: optNum(row['width']),
    height: optNum(row['height']),
    createdAt: str(row['created_at']),
    metadata: parseJson<Record<string, unknown>>(row['metadata'], {}),
    folderId: optStr(row['folder_id']),
    // Extended fields
    fileRef,
    originalPath: optStr(row['original_path']),
    sourceUrl,
    proxyRef: optStr(row['proxy_ref']),
    fps: optNum(row['fps']),
    codec: optStr(row['codec']),
    fileSize: optNum(row['file_size']),
    checksum: optStr(row['checksum']),
    status: (optStr(row['status']) as Asset['status']) ?? 'online',
  };
}

/** Convert a MediaFolderRow (from DB/IPC) to the React MediaFolder type. */
export function folderFromRow(row: Record<string, unknown>): MediaFolder {
  return {
    id: str(row['id']),
    name: str(row['name']),
    parentId: optStr(row['parent_id']),
    createdAt: str(row['created_at']),
  };
}

/** Convert a TrackRow (from DB/IPC) to the React Track type.
 *  SQLite stores muted/solo/locked/visible as 0/1 integers. */
export function trackFromRow(row: Record<string, unknown>): Track {
  return {
    id: str(row['id']),
    name: str(row['name']),
    kind: (str(row['kind']) || 'video') as Track['kind'],
    color: str(row['color']),
    muted: bool(row['muted']),
    solo: bool(row['solo']),
    locked: bool(row['locked']),
    visible: bool(row['visible'], true),
    volume: num(row['volume'], 1),
  };
}

/** Convert a KeyframeRow (from DB/IPC) to the React Keyframe type. */
export function keyframeFromRow(row: Record<string, unknown>): Keyframe {
  return {
    time: num(row['time']),
    property: (str(row['property']) || 'opacity') as Keyframe['property'],
    value: num(row['value'], 1),
  };
}

/** Convert a ClipRow plus its pre-converted Keyframe array to a React Clip. */
export function clipFromRow(
  row: Record<string, unknown>,
  keyframes: Keyframe[] = [],
): Clip {
  return {
    id: str(row['id']),
    assetId: str(row['asset_id']),
    trackId: str(row['track_id']),
    name: str(row['name']),
    startTime: num(row['start_time']),
    duration: num(row['duration']),
    trimStart: num(row['trim_start']),
    trimEnd: num(row['trim_end']),
    speed: num(row['speed'], 1),
    opacity: num(row['opacity'], 1),
    volume: num(row['volume'], 1),
    flipH: bool(row['flip_h']),
    flipV: bool(row['flip_v']),
    keyframes,
    linkedClipIds: (() => {
      const raw = row['linked_clip_id'] ?? row['linked_clip_ids'];
      if (!raw) return undefined;
      if (typeof raw === 'string') {
        // Backwards compat: single ID string or JSON array string
        if (raw.startsWith('[')) {
          try { return JSON.parse(raw) as string[]; } catch { return [raw]; }
        }
        return [raw];
      }
      if (Array.isArray(raw)) return raw as string[];
      return undefined;
    })(),
  };
}

/** Convert a TransitionRow (from DB/IPC) to the React Transition type. */
export function transitionFromRow(row: Record<string, unknown>): Transition {
  return {
    id: str(row['id']),
    type: (str(row['type']) || 'dissolve') as Transition['type'],
    duration: num(row['duration']),
    clipAId: str(row['clip_a_id']),
    clipBId: optStr(row['clip_b_id']),
  };
}

/**
 * Assemble a full React Timeline from its constituent DB rows.
 *
 * @param tlRow        - The TimelineRow object (or plain record from IPC).
 * @param trackRows    - TrackRows for this timeline, already ordered.
 * @param clipRows     - ClipRows with an optional nested `keyframes` array.
 * @param transitions  - Already-converted Transition objects for this timeline.
 */
export function timelineFromRows(
  tlRow: Record<string, unknown>,
  trackRows: Record<string, unknown>[],
  clipRows: Array<Record<string, unknown> & { keyframes?: Record<string, unknown>[] }>,
  transitionRows: Record<string, unknown>[],
): Timeline {
  const tracks = trackRows.map(trackFromRow);

  const clips = clipRows.map((clipRow) => {
    const rawKeyframes = Array.isArray(clipRow['keyframes'])
      ? (clipRow['keyframes'] as Record<string, unknown>[])
      : [];
    const keyframes = rawKeyframes.map(keyframeFromRow);
    return clipFromRow(clipRow, keyframes);
  });

  const transitions = transitionRows.map(transitionFromRow);

  let markers: Timeline['markers'] = [];
  try {
    const raw = typeof tlRow['markers'] === 'string' ? JSON.parse(tlRow['markers'] as string) : tlRow['markers'];
    if (Array.isArray(raw)) {
      markers = raw.map((m: Record<string, unknown>) => ({
        id: str(m['id']),
        time: num(m['time']),
        color: str(m['color']) || '#f1c40f',
        label: str(m['label']) || '',
      }));
    }
  } catch { /* ignore malformed markers */ }

  return {
    id: str(tlRow['id']),
    name: str(tlRow['name']),
    duration: num(tlRow['duration']),
    tracks,
    clips,
    transitions,
    markers,
  };
}

/** Convert an ElementRow (from DB/IPC) to the React Element type.
 *  The `images` column is a JSON-serialised array of ElementImage objects. */
export function elementFromRow(row: Record<string, unknown>): Element {
  const images = parseJson<ElementImage[]>(row['images'], []);
  return {
    id: str(row['id']),
    name: str(row['name']),
    type: (str(row['type']) || 'character') as Element['type'],
    description: str(row['description']),
    images,
    createdAt: str(row['created_at']),
    updatedAt: str(row['updated_at']),
  };
}

/** Convert an ExportJobRow (from DB/IPC) to the React ExportJob type.
 *  `output_path` in the DB maps to `outputUrl` in the React state. */
export function exportFromRow(row: Record<string, unknown>): ExportJob {
  return {
    id: str(row['id']),
    status: (str(row['status']) || 'queued') as ExportStatus,
    progress: num(row['progress']),
    preset: (str(row['preset']) || 'standard') as ExportPreset,
    fps: (num(row['fps'], 24) || 24) as ExportJob['fps'],
    outputUrl: optStr(row['output_path']),
    fileSize: optNum(row['file_size']),
    error: optStr(row['error']),
    createdAt: str(row['created_at']),
    completedAt: optStr(row['completed_at']),
  };
}

// ---------------------------------------------------------------------------
// React State → DB Row (persistence)
// ---------------------------------------------------------------------------

/** Convert a React Asset to an AssetRow-shaped object for DB insertion/update.
 *
 * URL routing:
 *  - If `asset.url` looks like a CDN/remote URL → store it in `source_url`.
 *  - Otherwise treat it as a local path and store it in `file_ref`.
 *  Explicit `sourceUrl` / `fileRef` fields always take precedence.
 */
export function assetToRow(
  asset: Asset,
  projectId: string,
): Record<string, unknown> {
  // Determine where the primary url should go
  const explicitSourceUrl = asset.sourceUrl ?? (isCdnUrl(asset.url) ? asset.url : undefined);
  const explicitFileRef = asset.fileRef ?? (!isCdnUrl(asset.url) ? asset.url : undefined);

  return {
    id: asset.id,
    project_id: projectId,
    name: asset.name,
    type: asset.type,
    file_ref: explicitFileRef ?? null,
    original_path: asset.originalPath ?? null,
    source_url: explicitSourceUrl ?? null,
    thumbnail_url: asset.thumbnailUrl ?? null,
    duration: asset.duration ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    fps: asset.fps ?? null,
    codec: asset.codec ?? null,
    file_size: asset.fileSize ?? null,
    checksum: asset.checksum ?? null,
    proxy_ref: asset.proxyRef ?? null,
    status: asset.status ?? 'online',
    metadata: asset.metadata ? JSON.stringify(asset.metadata) : null,
    folder_id: asset.folderId ?? null,
    created_at: asset.createdAt,
  };
}

/** Convert a React Track to a TrackRow-shaped object.
 *
 * @param track       - The React Track object.
 * @param timelineId  - The parent timeline's ID (required by the DB schema).
 * @param sortOrder   - The track's position in the track list (0-indexed).
 */
export function trackToRow(
  track: Track,
  timelineId: string,
  sortOrder: number,
): Record<string, unknown> {
  return {
    id: track.id,
    timeline_id: timelineId,
    name: track.name,
    kind: track.kind,
    color: track.color,
    muted: track.muted ? 1 : 0,
    solo: track.solo ? 1 : 0,
    locked: track.locked ? 1 : 0,
    visible: track.visible ? 1 : 0,
    volume: track.volume,
    sort_order: sortOrder,
  };
}

/** Convert a React Clip to a ClipRow-shaped object.
 *
 * Note: keyframes are stored in their own table and are NOT included here.
 * Use the separate keyframe persistence helpers for those.
 */
export function clipToRow(clip: Clip, timelineId: string): Record<string, unknown> {
  return {
    id: clip.id,
    timeline_id: timelineId,
    track_id: clip.trackId,
    asset_id: clip.assetId || null,
    name: clip.name,
    start_time: clip.startTime,
    duration: clip.duration,
    trim_start: clip.trimStart,
    trim_end: clip.trimEnd,
    speed: clip.speed,
    opacity: clip.opacity,
    volume: clip.volume,
    flip_h: clip.flipH ? 1 : 0,
    flip_v: clip.flipV ? 1 : 0,
    linked_clip_id: clip.linkedClipIds?.length ? JSON.stringify(clip.linkedClipIds) : null,
  };
}

/** Convert a React Transition to a TransitionRow-shaped object. */
export function transitionToRow(
  transition: Transition,
  timelineId: string,
): Record<string, unknown> {
  return {
    id: transition.id,
    timeline_id: timelineId,
    type: transition.type,
    duration: transition.duration,
    clip_a_id: transition.clipAId || null,
    clip_b_id: transition.clipBId ?? null,
  };
}
