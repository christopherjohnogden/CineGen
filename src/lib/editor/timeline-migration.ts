import type { Timeline, Track } from '@/types/timeline';
import { TRACK_COLORS, DEFAULT_VIDEO_COLOR, DEFAULT_AUDIO_COLOR } from '@/types/timeline';
import { generateId } from '@/lib/utils/ids';
import { calculateTimelineDuration } from './timeline-operations';

interface OldTrack {
  id: string;
  name: string;
  color?: string;
  muted?: boolean;
  solo?: boolean;
  clips: Array<{
    id: string;
    assetId: string;
    trackId: string;
    name: string;
    startTime: number;
    duration: number;
    trimStart: number;
    trimEnd: number;
  }>;
}

interface OldSequence {
  id: string;
  tracks: OldTrack[];
  duration: number;
}

/**
 * Migrate a project snapshot from old Sequence format to new Timeline[] format.
 * If `timelines` already exists, returns unchanged.
 */
export function migrateSequenceToTimelines(snapshot: any): any {
  if (snapshot.timelines && Array.isArray(snapshot.timelines)) {
    // Ensure existing timelines have fields added in later updates
    const patched = snapshot.timelines.map((tl: any) => ({
      ...tl,
      transitions: tl.transitions ?? [],
      clips: (tl.clips ?? []).map((c: any) => ({
        speed: 1,
        opacity: 1,
        volume: 1,
        flipH: false,
        flipV: false,
        keyframes: [],
        ...c,
      })),
    }));
    return { ...snapshot, timelines: patched };
  }

  const seq: OldSequence | undefined = snapshot.sequence;
  if (!seq) {
    // No sequence and no timelines — create a default
    const defaultTl: Timeline = {
      id: generateId(),
      name: 'Timeline 1',
      tracks: [
        { id: generateId(), name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: generateId(), name: 'V2', kind: 'video', color: '#3498db', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: generateId(), name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: generateId(), name: 'A2', kind: 'audio', color: '#1abc9c', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      ],
      clips: [],
      duration: 0,
      transitions: [],
      markers: [],
    };
    const { sequence: _removed, ...rest } = snapshot;
    return { ...rest, timelines: [defaultTl], activeTimelineId: defaultTl.id };
  }

  // Determine track kinds by looking at asset types
  const assets: Array<{ id: string; type: string }> = snapshot.assets ?? [];
  const assetTypeMap = new Map(assets.map((a) => [a.id, a.type]));

  function inferTrackKind(oldTrack: OldTrack): 'video' | 'audio' {
    if (oldTrack.clips.length === 0) return 'video'; // default
    const types = oldTrack.clips.map((c) => assetTypeMap.get(c.assetId) ?? 'video');
    const audioCount = types.filter((t) => t === 'audio').length;
    return audioCount > types.length / 2 ? 'audio' : 'video';
  }

  // Convert tracks
  const tracks: Track[] = seq.tracks.map((old, i) => ({
    id: old.id,
    name: old.name,
    kind: inferTrackKind(old),
    color: old.color ?? (inferTrackKind(old) === 'video' ? DEFAULT_VIDEO_COLOR : DEFAULT_AUDIO_COLOR),
    muted: old.muted ?? false,
    solo: old.solo ?? false,
    locked: false,
    visible: true,
    volume: 1,
  }));

  // Flatten clips from nested tracks
  const clips = seq.tracks.flatMap((t) =>
    t.clips.map((c) => ({
      id: c.id,
      assetId: c.assetId,
      trackId: c.trackId,
      name: c.name,
      startTime: c.startTime,
      duration: c.duration,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [] as import('@/types/timeline').Keyframe[],
    })),
  );

  const timeline: Timeline = {
    id: seq.id || generateId(),
    name: 'Timeline 1',
    tracks,
    clips,
    duration: 0,
    transitions: [],
    markers: [],
  };
  timeline.duration = calculateTimelineDuration(timeline);

  const { sequence: _removed, ...rest } = snapshot;
  return { ...rest, timelines: [timeline], activeTimelineId: timeline.id };
}
