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

// ---------------------------------------------------------------------------
// J/L cuts via linked-audio offset.
// ---------------------------------------------------------------------------

/**
 * Create L-cuts by extending a segment's linked audio past its video where the source has handle
 * and there's silence at the out-point (so the trailing audio sits under quiet). Pure. The audio
 * clip keeps its startTime but reveals more source (smaller trimEnd), so it plays longer than its
 * video — bounded by maxOverlapSec, available source handle, and the silence width. Where conditions
 * aren't met, the pair stays frame-aligned.
 */
export function applyJLCuts(timeline: Timeline, ctx: SilenceContext, opts: HumanizeOptions): Timeline {
  if (!opts.jlCuts) return timeline;

  const byId = new Map(timeline.clips.map((c) => [c.id, c]));
  const isVideoTrack = new Map(timeline.tracks.map((t) => [t.id, t.kind === 'video']));
  const adjusted = new Map<string, Clip>();

  for (const clip of timeline.clips) {
    if (!isVideoTrack.get(clip.trackId)) continue;            // drive from the video clip
    const linkedId = (clip.linkedClipIds ?? []).find((id) => {
      const linked = byId.get(id);
      return linked && !isVideoTrack.get(linked.trackId);     // its linked audio
    });
    if (!linkedId) continue;
    const audio = byId.get(linkedId);
    if (!audio) continue;

    const silences = ctx.forAsset(clip.assetId);
    if (silences.length === 0) continue;

    const outPoint = clip.duration - clip.trimEnd;
    // Need silence AT the out-point: it must start within tolerance of the out-point (or already
    // contain it) and extend past it, so the trailing audio sits under genuinely adjacent quiet.
    const silence = silences.find((s) => s.end > outPoint && s.start <= outPoint + opts.snapToleranceSec);
    if (!silence) continue;

    const sourceHandle = clip.duration - outPoint;            // source available past the out-point
    const silenceTail = silence.end - outPoint;               // quiet available to cover the trail
    const overlap = Math.max(0, Math.min(opts.maxOverlapSec, sourceHandle, silenceTail));
    if (overlap < EPSILON) continue;

    // Extend audio out-point by `overlap` (reveal more source = smaller trimEnd). Video unchanged.
    const nextTrimEnd = Math.max(0, audio.trimEnd - overlap);
    adjusted.set(audio.id, { ...audio, trimEnd: nextTrimEnd });
  }

  if (adjusted.size === 0) return timeline;
  const clips = timeline.clips.map((c) => adjusted.get(c.id) ?? c);
  const duration = clips.reduce((max, c) => Math.max(max, c.startTime + clipEffectiveDuration(c)), 0);
  return { ...timeline, clips, duration };
}

// ---------------------------------------------------------------------------
// Orchestrator.
// ---------------------------------------------------------------------------

/** Snap boundaries to silence, then apply J/L cuts. Each pass is gated by its opt flag. Pure. */
export function humanizeCutTimeline(
  timeline: Timeline,
  ctx: SilenceContext,
  opts: HumanizeOptions = DEFAULT_HUMANIZE,
): Timeline {
  let next = snapClipsToSilence(timeline, ctx, opts);
  next = applyJLCuts(next, ctx, opts);
  return next;
}
