import type { Node } from '@xyflow/react';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

/**
 * Everything the clip grid and the clip viewer need that is not React.
 *
 * Review status, likes, and comments live on the node's config so they travel
 * with the project (and sync through the cloud revision) instead of a side
 * table that would drift from the generation it describes. "Seen" bookkeeping
 * is deliberately local: which clips *you* have looked at is per person and
 * per browser, and never worth a revision.
 */

export type GenerationStatus = 'queued' | 'running' | 'complete' | 'error' | 'stalled';

export type ClipReviewStatus = 'in_progress' | 'needs_review' | 'approved';

export const CLIP_REVIEW_STATUSES: ReadonlyArray<{ id: ClipReviewStatus; label: string; color: string }> = [
  { id: 'in_progress', label: 'In progress', color: '#3b82f6' },
  { id: 'needs_review', label: 'Needs review', color: '#f97316' },
  { id: 'approved', label: 'Approved', color: '#a3e635' },
];

export interface StudioComment {
  id: string;
  text: string;
  /** ISO timestamp of when it was written. */
  at: string;
  /** Position in the clip the comment refers to, when it was left on a video. */
  timeSec?: number;
  author: string;
}

export interface ClipItem {
  id: string;
  node: Node<WorkflowNodeData>;
  model: ModelDefinition;
  kind: 'image' | 'video';
  /** The generation currently shown; empty while a render is still in flight. */
  url: string;
  urls: string[];
  prompt: string;
  status: GenerationStatus;
  error?: string;
  createdAt: number;
  liked: boolean;
  review?: ClipReviewStatus;
  comments: StudioComment[];
  elementNames: string[];
  isNew: boolean;
  lastViewed: boolean;
}

export type ClipCardSize = 's' | 'm' | 'l';

/**
 * `running` and an explicit running result are the only honest in-flight
 * signals. An idle Studio node with no media never started — calling it
 * "Generating…" hid exactly the failures the feed exists to surface.
 */
export function generationStatus(
  node: Node<WorkflowNodeData>,
  running: boolean,
  urlCount: number,
): GenerationStatus {
  const result = node.data.result;
  const resultStatus = result?.status ?? 'idle';
  if (running || resultStatus === 'running') {
    return result?.progressStage === 'queued' || result?.progressStage === 'submitting' ? 'queued' : 'running';
  }
  if (resultStatus === 'error') return 'error';
  if (urlCount > 0) return 'complete';
  return node.data.config.__studioGenerated ? 'stalled' : 'queued';
}

export function clipLiked(node: Node<WorkflowNodeData>): boolean {
  return node.data.config.__studioLiked === true;
}

export function clipReview(node: Node<WorkflowNodeData>): ClipReviewStatus | undefined {
  const value = node.data.config.__studioReview;
  return CLIP_REVIEW_STATUSES.some((status) => status.id === value) ? (value as ClipReviewStatus) : undefined;
}

export function clipComments(node: Node<WorkflowNodeData>): StudioComment[] {
  const raw = node.data.config.__studioComments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is StudioComment => (
    Boolean(entry) && typeof entry === 'object'
    && typeof (entry as StudioComment).id === 'string'
    && typeof (entry as StudioComment).text === 'string'
    && typeof (entry as StudioComment).at === 'string'
  ));
}

export function clipElementNames(node: Node<WorkflowNodeData>): string[] {
  const raw = node.data.config.__studioElementNames;
  return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string' && name !== '') : [];
}

// ---------------------------------------------------------------------------
// Seen / New / Last viewed
// ---------------------------------------------------------------------------

export interface SeenState {
  /** Everything created after this is "New" until it is opened. */
  seenAt: number;
  /** Clips that have been opened, newest last; capped so storage stays small. */
  viewed: string[];
  lastViewed: string;
}

const SEEN_KEY = 'cinegen_studio_seen';
const VIEWED_CAP = 500;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSeen(projectId: string): SeenState {
  const empty: SeenState = { seenAt: 0, viewed: [], lastViewed: '' };
  const store = storage();
  if (!store) return empty;
  try {
    const raw = store.getItem(`${SEEN_KEY}:${projectId}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<SeenState>;
    return {
      seenAt: typeof parsed.seenAt === 'number' && Number.isFinite(parsed.seenAt) ? parsed.seenAt : 0,
      viewed: Array.isArray(parsed.viewed) ? parsed.viewed.filter((id): id is string => typeof id === 'string') : [],
      lastViewed: typeof parsed.lastViewed === 'string' ? parsed.lastViewed : '',
    };
  } catch {
    return empty;
  }
}

export function writeSeen(projectId: string, patch: Partial<SeenState>): SeenState {
  const current = readSeen(projectId);
  const next: SeenState = {
    seenAt: patch.seenAt ?? current.seenAt,
    viewed: (patch.viewed ?? current.viewed).slice(-VIEWED_CAP),
    lastViewed: patch.lastViewed ?? current.lastViewed,
  };
  const store = storage();
  if (store) {
    try {
      store.setItem(`${SEEN_KEY}:${projectId}`, JSON.stringify(next));
    } catch {
      // Private mode or a full quota: "New" badges just reset next visit.
    }
  }
  return next;
}

/** A clip is new when it arrived after the last visit and has not been opened since. */
export function isNewClip(createdAt: number, id: string, seen: SeenState): boolean {
  return createdAt > seen.seenAt && !seen.viewed.includes(id);
}

const CARD_SIZE_KEY = 'cinegen_studio_card_size';

export function readCardSize(): ClipCardSize {
  const value = storage()?.getItem(CARD_SIZE_KEY);
  return value === 's' || value === 'l' ? value : 'm';
}

export function writeCardSize(size: ClipCardSize): void {
  try {
    storage()?.setItem(CARD_SIZE_KEY, size);
  } catch {
    // Non-fatal.
  }
}

const FEED_VIEW_KEY = 'cinegen_studio_feed_view';

export function readFeedView(): 'grid' | 'list' {
  return storage()?.getItem(FEED_VIEW_KEY) === 'list' ? 'list' : 'grid';
}

export function writeFeedView(view: 'grid' | 'list'): void {
  try {
    storage()?.setItem(FEED_VIEW_KEY, view);
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pad(value: number, width = 2): string {
  return String(Math.max(0, Math.floor(value))).padStart(width, '0');
}

/** `1:23` in standard form, `00:01:23:456` as a millisecond timecode. */
export function formatClipTime(seconds: number, mode: 'standard' | 'timecode' = 'standard'): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (mode === 'timecode') {
    const millis = Math.round((safe - whole) * 1000);
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}:${pad(millis, 3)}`;
  }
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** `August 20, 2026 at 11:13 PM`, or an em dash when the clip has no timestamp. */
export function formatCreated(ms: number): string {
  if (!ms) return '—';
  const date = new Date(ms);
  const day = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'clip';
}

function extensionOf(url: string, kind: 'image' | 'video'): string {
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  const ext = match?.[1]?.toLowerCase();
  if (ext && ext !== 'com' && ext !== 'net') return ext;
  return kind === 'video' ? 'mp4' : 'png';
}

export function clipFileName(model: ModelDefinition, createdAt: number, url: string, kind: 'image' | 'video'): string {
  const when = createdAt ? new Date(createdAt) : new Date();
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `${slug(model.name)}-${stamp}.${extensionOf(url, kind)}`;
}

// ---------------------------------------------------------------------------
// Browser actions
// ---------------------------------------------------------------------------

const MAX_FRAME_WIDTH = 1920;

/**
 * Grab one frame of a video as a JPEG data URL. Resolves with the frame at the
 * start, the end, or a given second. Rejects when the media cannot be read
 * back (cross-origin without CORS headers) so the caller can say so.
 */
export function captureVideoFrame(url: string, at: 'start' | 'end' | number): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      fn();
    };
    const fail = (message: string) => finish(() => reject(new Error(message)));
    const timer = window.setTimeout(() => fail('The video took too long to load.'), 15000);

    video.addEventListener('error', () => { window.clearTimeout(timer); fail('The video could not be loaded.'); });
    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = at === 'start' ? 0 : at === 'end' ? Math.max(0, duration - 0.05) : Math.min(Math.max(0, at), duration);
      const draw = () => {
        window.clearTimeout(timer);
        if (!video.videoWidth || !video.videoHeight) { fail('The video has no picture.'); return; }
        try {
          const width = Math.min(video.videoWidth, MAX_FRAME_WIDTH);
          const height = Math.max(1, Math.round(width * (video.videoHeight / video.videoWidth)));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) { fail('Canvas is unavailable.'); return; }
          context.drawImage(video, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          if (!dataUrl.startsWith('data:image/')) { fail('The frame could not be read.'); return; }
          finish(() => resolve(dataUrl));
        } catch {
          fail('This video does not allow frame capture.');
        }
      };
      video.addEventListener('seeked', draw, { once: true });
      if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) draw();
      else {
        try {
          video.currentTime = target;
        } catch {
          video.addEventListener('loadeddata', draw, { once: true });
        }
      }
    });
    video.src = url;
  });
}

/** Save a generation to disk; falls back to opening it when it cannot be fetched. */
export async function downloadUrl(url: string, filename: string): Promise<void> {
  const anchor = document.createElement('a');
  anchor.rel = 'noopener';
  anchor.download = filename;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    anchor.href = objectUrl;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch {
    anchor.href = url;
    anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function commentId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
