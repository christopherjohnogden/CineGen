// src/lib/llm/cut-humanize.ts
//
// Phase 3 — human-feeling cut output. Pure functions only (timeline-in / timeline-out), so the
// boundary math is fully unit-testable with no Electron/network. Everything here is OPT-IN: the
// cut builder only runs this pass when a humanize option is supplied, so default output is
// unchanged. The Phase 1 objective silence map is the first downstream consumer here.

import type { Asset } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import type { SilenceInterval } from '@/lib/llm/acoustic-analysis';
import { extractSilenceMap } from '@/lib/llm/editorial-workflow';

export interface SilenceContext {
  forAsset(assetId: string): SilenceInterval[];
}

export function buildSilenceContext(assets: Asset[]): SilenceContext {
  const byAsset = new Map<string, SilenceInterval[]>();
  for (const asset of assets) {
    const map = extractSilenceMap(asset);
    if (map.length === 0) continue;
    byAsset.set(asset.id, [...map].sort((a, b) => a.start - b.start));
  }
  return {
    forAsset: (assetId: string) => byAsset.get(assetId) ?? [],
  };
}

/**
 * Nearest silence edge to `time` within `tolerance`, or null.
 * - side 'out' (a clip's out-point): snap to a silence START, so the cut ends as quiet begins.
 * - side 'in'  (a clip's in-point):  snap to a silence END, so the cut starts as quiet ends.
 */
export function nearestSilenceEdge(
  silences: SilenceInterval[],
  time: number,
  tolerance: number,
  side: 'in' | 'out',
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of silences) {
    const edge = side === 'out' ? s.start : s.end;
    const dist = Math.abs(edge - time);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = edge;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Snap-to-silence + room-tone handles.
// ---------------------------------------------------------------------------

export interface HumanizeOptions {
  snapToSilence: boolean;       // run the snap pass
  snapToleranceSec: number;     // only snap if a silence edge is this close
  roomToneHandleSec: number;    // pad into adjacent silence so cuts breathe
  minClipDurationSec: number;   // never snap a clip shorter than this
  jlCuts: boolean;              // run the J/L pass
  maxOverlapSec: number;        // cap on J/L audio lead/trail
}

export const DEFAULT_HUMANIZE: HumanizeOptions = {
  snapToSilence: true,
  snapToleranceSec: 0.4,
  roomToneHandleSec: 0.08,
  minClipDurationSec: 0.5,
  jlCuts: true,
  maxOverlapSec: 0.5,
};

const EPSILON = 1e-6;

/** Snap each clip's source in/out to nearby silence + add room-tone handles. Pure; re-flows startTimes. */
export function snapClipsToSilence(timeline: Timeline, ctx: SilenceContext, opts: HumanizeOptions): Timeline {
  if (!opts.snapToSilence) return timeline;

  const snapped = timeline.clips.map((clip) => {
    const silences = ctx.forAsset(clip.assetId);
    if (silences.length === 0) return clip;

    const sourceIn = clip.trimStart;
    const sourceOut = clip.duration - clip.trimEnd;

    let nextIn = sourceIn;
    let nextOut = sourceOut;

    // Out-point → nearest silence start; extend into the silence by the room-tone handle.
    const outEdge = nearestSilenceEdge(silences, sourceOut, opts.snapToleranceSec, 'out');
    if (outEdge !== null) {
      nextOut = Math.min(clip.duration, outEdge + opts.roomToneHandleSec);
    }

    // In-point → nearest silence end; pull the start back into the silence by the room-tone handle.
    const inEdge = nearestSilenceEdge(silences, sourceIn, opts.snapToleranceSec, 'in');
    if (inEdge !== null) {
      nextIn = Math.max(0, inEdge - opts.roomToneHandleSec);
    }

    // Clamp: stay within source bounds and never below the minimum clip duration.
    nextIn = Math.max(0, Math.min(nextIn, clip.duration));
    nextOut = Math.max(0, Math.min(nextOut, clip.duration));
    if (nextOut - nextIn < opts.minClipDurationSec - EPSILON) {
      return clip; // snapping would make the clip too short — leave it alone
    }

    const nextTrimStart = nextIn;
    const nextTrimEnd = clip.duration - nextOut;
    if (Math.abs(nextTrimStart - clip.trimStart) < EPSILON && Math.abs(nextTrimEnd - clip.trimEnd) < EPSILON) {
      return clip;
    }
    return { ...clip, trimStart: nextTrimStart, trimEnd: nextTrimEnd };
  });

  return reflowTracks({ ...timeline, clips: snapped });
}

/** Re-position clips end-to-end within each track, preserving track order. Keeps the timeline gapless. */
function reflowTracks(timeline: Timeline): Timeline {
  const byTrack = new Map<string, Clip[]>();
  for (const clip of timeline.clips) {
    const list = byTrack.get(clip.trackId) ?? [];
    list.push(clip);
    byTrack.set(clip.trackId, list);
  }

  const repositioned = new Map<string, Clip>();
  for (const list of byTrack.values()) {
    const ordered = [...list].sort((a, b) => a.startTime - b.startTime);
    let cursor = 0;
    for (const clip of ordered) {
      repositioned.set(clip.id, { ...clip, startTime: cursor });
      cursor += clipEffectiveDuration(clip);
    }
  }

  const clips = timeline.clips.map((clip) => repositioned.get(clip.id) ?? clip);
  const duration = clips.reduce((max, clip) => Math.max(max, clip.startTime + clipEffectiveDuration(clip)), 0);
  return { ...timeline, clips, duration };
}
