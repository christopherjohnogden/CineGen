// src/lib/higgsfield/placement.ts
//
// Phase 0.5 — shared placement resolution. Pure: given the current timeline and a placement target,
// compute WHERE a generated clip lands (trackId + startTime, and which clip to replace, if any).
// The renderer then runs persist → ADD_ASSET → addClipToTrack with this result. Keeping the
// position math pure makes it unit-testable independent of Electron/persistence.

import type { Timeline } from '@/types/timeline';
import { clipEndTime } from '@/types/timeline';

export type PlacementTarget =
  | { mode: 'append'; trackId: string }
  | { mode: 'insert_after'; clipId: string }
  | { mode: 'replace'; clipId: string }
  | { mode: 'explicit'; trackId: string; startTime: number };

export interface ResolvedPlacement {
  trackId: string;
  startTime: number;
  replaceClipId?: string;
}

export function resolvePlacement(timeline: Timeline, target: PlacementTarget): ResolvedPlacement {
  switch (target.mode) {
    case 'explicit':
      return { trackId: target.trackId, startTime: Math.max(0, target.startTime) };

    case 'append': {
      const track = timeline.tracks.find((t) => t.id === target.trackId);
      if (!track) throw new Error(`Track not found: ${target.trackId}`);
      const onTrack = timeline.clips.filter((c) => c.trackId === target.trackId);
      const startTime = onTrack.reduce((max, c) => Math.max(max, clipEndTime(c)), 0);
      return { trackId: target.trackId, startTime };
    }

    case 'insert_after': {
      const ref = timeline.clips.find((c) => c.id === target.clipId);
      if (!ref) throw new Error(`Clip not found: ${target.clipId}`);
      return { trackId: ref.trackId, startTime: clipEndTime(ref) };
    }

    case 'replace': {
      const ref = timeline.clips.find((c) => c.id === target.clipId);
      if (!ref) throw new Error(`Clip not found: ${target.clipId}`);
      return { trackId: ref.trackId, startTime: ref.startTime, replaceClipId: ref.id };
    }
  }
}
