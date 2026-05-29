import { describe, expect, it } from 'vitest';
import {
  snapClipsToSilence,
  buildSilenceContext,
  DEFAULT_HUMANIZE,
  type HumanizeOptions,
} from '@/lib/llm/cut-humanize';
import type { Asset } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import type { SilenceInterval } from '@/lib/llm/acoustic-analysis';

function asset(id: string, duration: number, silenceMap: SilenceInterval[]): Asset {
  return {
    id, name: id, type: 'video', duration,
    metadata: { analysis: { status: 'ready', segments: [], silenceMap } },
  } as unknown as Asset;
}

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'assetId' | 'trackId' | 'startTime' | 'duration' | 'trimStart' | 'trimEnd'>): Clip {
  return {
    name: over.id, speed: 1, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [], ...over,
  } as Clip;
}

function timeline(clips: Clip[]): Timeline {
  return {
    id: 't1', name: 'T', tracks: [
      { id: 'V', name: 'V2', kind: 'video', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'A', name: 'A2', kind: 'audio', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
    clips, duration: 0, transitions: [], markers: [],
  };
}

const NO_JL: HumanizeOptions = { ...DEFAULT_HUMANIZE, jlCuts: false };

describe('snapClipsToSilence', () => {
  it('snaps an out-point that sits just before a silence onto the silence edge', () => {
    // Asset 60s; a video clip uses source [0, 2.8]; silence at [3.0, 3.5].
    // trimStart=0, trimEnd=60-2.8=57.2 → out-point 2.8 is 0.2s before silence start 3.0.
    const a = asset('a1', 60, [{ start: 3.0, end: 3.5 }]);
    const tl = timeline([
      clip({ id: 'v', assetId: 'a1', trackId: 'V', startTime: 0, duration: 60, trimStart: 0, trimEnd: 57.2 }),
    ]);
    const out = snapClipsToSilence(tl, buildSilenceContext([a]), NO_JL);
    const v = out.clips.find((c) => c.id === 'v')!;
    const outPoint = v.duration - v.trimEnd;
    // snapped to 3.0 and extended by the room-tone handle into the silence
    expect(outPoint).toBeGreaterThanOrEqual(3.0);
    expect(outPoint).toBeLessThanOrEqual(3.0 + DEFAULT_HUMANIZE.roomToneHandleSec + 1e-6);
  });

  it('leaves a clip untouched when no silence edge is within tolerance', () => {
    const a = asset('a1', 60, [{ start: 30, end: 31 }]);
    const tl = timeline([
      clip({ id: 'v', assetId: 'a1', trackId: 'V', startTime: 0, duration: 60, trimStart: 0, trimEnd: 57.2 }),
    ]);
    const out = snapClipsToSilence(tl, buildSilenceContext([a]), NO_JL);
    const v = out.clips.find((c) => c.id === 'v')!;
    expect(v.trimStart).toBe(0);
    expect(v.trimEnd).toBe(57.2);
  });

  it('never snaps a clip below the minimum duration', () => {
    // clip is exactly minClipDuration; a silence edge that would shrink it must be ignored.
    const min = DEFAULT_HUMANIZE.minClipDurationSec;
    const a = asset('a1', 60, [{ start: min - 0.1, end: min }]); // would pull out-point below min
    const tl = timeline([
      clip({ id: 'v', assetId: 'a1', trackId: 'V', startTime: 0, duration: 60, trimStart: 0, trimEnd: 60 - min }),
    ]);
    const out = snapClipsToSilence(tl, buildSilenceContext([a]), NO_JL);
    const v = out.clips.find((c) => c.id === 'v')!;
    expect(clipEffectiveDuration(v)).toBeGreaterThanOrEqual(min - 1e-6);
  });

  it('keeps the timeline gapless after snapping (recomputed startTimes)', () => {
    const a = asset('a1', 60, [{ start: 3.0, end: 3.5 }]);
    const tl = timeline([
      clip({ id: 'v1', assetId: 'a1', trackId: 'V', startTime: 0, duration: 60, trimStart: 0, trimEnd: 57.2 }),
      clip({ id: 'v2', assetId: 'a1', trackId: 'V', startTime: 2.8, duration: 60, trimStart: 50, trimEnd: 0 }),
    ]);
    const out = snapClipsToSilence(tl, buildSilenceContext([a]), NO_JL);
    const v1 = out.clips.find((c) => c.id === 'v1')!;
    const v2 = out.clips.find((c) => c.id === 'v2')!;
    // v2 starts exactly where v1 ends (gapless on the same track)
    expect(v2.startTime).toBeCloseTo(v1.startTime + clipEffectiveDuration(v1), 5);
  });

  it('never trims past source bounds', () => {
    const a = asset('a1', 5, [{ start: 4.9, end: 5.0 }]);
    const tl = timeline([
      clip({ id: 'v', assetId: 'a1', trackId: 'V', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0.2 }),
    ]);
    const out = snapClipsToSilence(tl, buildSilenceContext([a]), NO_JL);
    const v = out.clips.find((c) => c.id === 'v')!;
    expect(v.trimStart).toBeGreaterThanOrEqual(0);
    expect(v.trimEnd).toBeGreaterThanOrEqual(0);
    expect(v.duration - v.trimEnd).toBeLessThanOrEqual(v.duration + 1e-6);
  });
});

describe('DEFAULT_HUMANIZE', () => {
  it('has the documented conservative defaults', () => {
    expect(DEFAULT_HUMANIZE.snapToleranceSec).toBe(0.4);
    expect(DEFAULT_HUMANIZE.roomToneHandleSec).toBe(0.08);
    expect(DEFAULT_HUMANIZE.minClipDurationSec).toBe(0.5);
    expect(DEFAULT_HUMANIZE.maxOverlapSec).toBe(0.5);
  });
});
