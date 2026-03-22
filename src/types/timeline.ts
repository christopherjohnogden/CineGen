export type TrackKind = 'video' | 'audio';

export type ToolType =
  | 'select'
  | 'trackForward'
  | 'blade'
  | 'ripple'
  | 'roll'
  | 'slip'
  | 'slide'
  | 'music'
  | 'fillGap'
  | 'extend'
  | 'mask';

export const DEFAULT_VIDEO_COLOR = '#4a9fd6';
export const DEFAULT_AUDIO_COLOR = '#5bbf5b';

export const TRACK_COLORS = [
  '#4a9fd6', '#5bbf5b', '#e74c3c', '#9b59b6', '#e67e22',
  '#1abc9c', '#f39c12', '#d466a8', '#e91e63', '#5bc5c5',
] as const;

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  visible: boolean;
  volume: number;
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  speed: number;          // 0.25–4, default 1
  opacity: number;        // 0–1, default 1
  volume: number;         // 0–2, default 1 (1 = unity, >1 = boost)
  flipH: boolean;
  flipV: boolean;
  keyframes: Keyframe[];
  linkedClipIds?: string[];  // linked video↔audio pairs (supports multiple linked clips)
}

export interface Keyframe {
  time: number;       // relative to clip's visible window (0 = first visible frame)
  property: 'opacity' | 'volume';
  value: number;
}

export interface Transition {
  id: string;
  type: 'dissolve' | 'fadeToBlack' | 'fadeFromBlack';
  duration: number;
  clipAId: string;
  clipBId?: string;   // undefined for fades (single-clip)
}

export interface TimelineMarker {
  id: string;
  time: number;
  color: string;
  label: string;
}

export interface Timeline {
  id: string;
  name: string;
  tracks: Track[];
  clips: Clip[];
  duration: number;
  transitions: Transition[];
  markers: TimelineMarker[];
}

/** Effective duration of a clip (what plays on the timeline). */
export function clipEffectiveDuration(clip: Clip): number {
  return (clip.duration - clip.trimStart - clip.trimEnd) / clip.speed;
}

/** End time of a clip on the timeline. */
export function clipEndTime(clip: Clip): number {
  return clip.startTime + clipEffectiveDuration(clip);
}

export interface EditorLayout {
  leftPanelWidth: number;
  leftPanelMode: 'full' | 'compact';
  viewerTimelineSplit: number;
  sourceTimelineSplit: number;
  sourceViewerVisible: boolean;
  rightPanelWidth: number;
  inspectorVisible: boolean;
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = {
  leftPanelWidth: 240,
  leftPanelMode: 'full',
  viewerTimelineSplit: 0.55,
  sourceTimelineSplit: 0.5,
  sourceViewerVisible: true,
  rightPanelWidth: 280,
  inspectorVisible: false,
};
