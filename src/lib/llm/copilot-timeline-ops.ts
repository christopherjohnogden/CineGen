import {
  removeClip,
  splitClip,
  trimClip,
} from '@/lib/editor/timeline-operations';
import type { Timeline, TimelineMarker } from '@/types/timeline';
import { generateId } from '@/lib/utils/ids';

export type TimelineEditOp =
  | { op: 'split_clip'; clipId: string; time: number }
  | { op: 'trim_clip'; clipId: string; trimStart: number; trimEnd: number; startTime?: number }
  | { op: 'remove_clip'; clipId: string }
  | { op: 'close_gaps'; maxGapSec?: number; ripple?: boolean }
  | { op: 'add_markers'; markers: Array<{ time: number; label: string; color?: string }> };

function closeGapsOnTimeline(timeline: Timeline, maxGapSec = 0.5): Timeline {
  let nextTimeline = timeline;

  for (const track of timeline.tracks) {
    const trackClips = [...nextTimeline.clips]
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.startTime - b.startTime);

    let cursor = 0;
    for (const clip of trackClips) {
      const gap = clip.startTime - cursor;
      if (gap > 0 && gap <= maxGapSec) {
        nextTimeline = {
          ...nextTimeline,
          clips: nextTimeline.clips.map((entry) => (
            entry.id === clip.id
              ? { ...entry, startTime: Math.max(0, entry.startTime - gap) }
              : entry
          )),
        };
        cursor = clip.startTime - gap + (clip.duration - clip.trimStart - clip.trimEnd) / clip.speed;
      } else {
        cursor = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd) / clip.speed;
      }
    }
  }

  return nextTimeline;
}

export function applyTimelineEditOps(timeline: Timeline, ops: TimelineEditOp[]): Timeline {
  let nextTimeline = timeline;

  for (const operation of ops) {
    switch (operation.op) {
      case 'split_clip':
        nextTimeline = splitClip(nextTimeline, operation.clipId, operation.time);
        break;
      case 'trim_clip':
        nextTimeline = trimClip(
          nextTimeline,
          operation.clipId,
          operation.trimStart,
          operation.trimEnd,
          operation.startTime,
        );
        break;
      case 'remove_clip':
        nextTimeline = removeClip(nextTimeline, operation.clipId);
        break;
      case 'close_gaps':
        nextTimeline = closeGapsOnTimeline(nextTimeline, operation.maxGapSec ?? 0.5);
        break;
      case 'add_markers': {
        const markers: TimelineMarker[] = operation.markers.map((marker) => ({
          id: generateId(),
          time: marker.time,
          label: marker.label,
          color: marker.color ?? '#ff8c3c',
        }));
        nextTimeline = {
          ...nextTimeline,
          markers: [...(nextTimeline.markers ?? []), ...markers],
        };
        break;
      }
      default:
        break;
    }
  }

  return nextTimeline;
}

export function resolveTimelineTarget(
  ref: string | undefined,
  timelines: Timeline[],
  activeTimelineId: string,
): Timeline | null {
  if (timelines.length === 0) return null;
  const normalized = ref?.trim().toLowerCase();
  if (!normalized || normalized === 'active') {
    return timelines.find((timeline) => timeline.id === activeTimelineId) ?? timelines[0] ?? null;
  }
  return timelines.find((timeline) => timeline.id === ref)
    ?? timelines.find((timeline) => timeline.name.toLowerCase() === normalized)
    ?? timelines.find((timeline) => timeline.name.toLowerCase().includes(normalized))
    ?? null;
}
