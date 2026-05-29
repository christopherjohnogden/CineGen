import { describe, expect, it } from 'vitest';
import { applyJLCuts, buildSilenceContext, DEFAULT_HUMANIZE } from '@/lib/llm/cut-humanize';
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

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'assetId' | 'trackId' | 'startTime' | 'duration' | 'trimStart' | 'trimEnd' | 'linkedClipIds'>): Clip {
  return { name: over.id, speed: 1, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [], ...over } as Clip;
}

/** Two segments, each a linked V+A pair, laid end to end. Asset has source handle past each out-point. */
function twoSegmentTimeline(silenceMap: SilenceInterval[]): { tl: Timeline; assets: Asset[] } {
  const a = asset('a1', 60, silenceMap);
  // segment 1: source [0,5]; segment 2: source [20,25]; each on V2/A2.
  const clips: Clip[] = [
    clip({ id: 'v1', assetId: 'a1', trackId: 'V', startTime: 0, duration: 60, trimStart: 0, trimEnd: 55, linkedClipIds: ['a1c'] }),
    clip({ id: 'a1c', assetId: 'a1', trackId: 'A', startTime: 0, duration: 60, trimStart: 0, trimEnd: 55, linkedClipIds: ['v1'] }),
    clip({ id: 'v2', assetId: 'a1', trackId: 'V', startTime: 5, duration: 60, trimStart: 20, trimEnd: 35, linkedClipIds: ['a2c'] }),
    clip({ id: 'a2c', assetId: 'a1', trackId: 'A', startTime: 5, duration: 60, trimStart: 20, trimEnd: 35, linkedClipIds: ['v2'] }),
  ];
  const tl: Timeline = {
    id: 't1', name: 'T', tracks: [
      { id: 'V', name: 'V2', kind: 'video', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'A', name: 'A2', kind: 'audio', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
    clips, duration: 10, transitions: [], markers: [],
  };
  return { tl, assets: [a] };
}

describe('applyJLCuts', () => {
  it('extends an audio clip past its linked video where silence + source handle permit', () => {
    // silence at the first segment's out-point region (around source 5s) lets the audio trail (L-cut).
    const { tl, assets } = twoSegmentTimeline([{ start: 5.0, end: 5.6 }]);
    const out = applyJLCuts(tl, buildSilenceContext(assets), DEFAULT_HUMANIZE);
    const v1 = out.clips.find((c) => c.id === 'v1')!;
    const a1c = out.clips.find((c) => c.id === 'a1c')!;
    // audio now plays longer than its linked video (the L-cut overlap)
    expect(clipEffectiveDuration(a1c)).toBeGreaterThan(clipEffectiveDuration(v1));
    // bounded by maxOverlapSec
    expect(clipEffectiveDuration(a1c) - clipEffectiveDuration(v1)).toBeLessThanOrEqual(DEFAULT_HUMANIZE.maxOverlapSec + 1e-6);
    // still linked
    expect(a1c.linkedClipIds).toContain('v1');
  });

  it('leaves pairs frame-aligned when there is no adjacent silence', () => {
    const { tl, assets } = twoSegmentTimeline([{ start: 40, end: 41 }]); // far from any out-point
    const out = applyJLCuts(tl, buildSilenceContext(assets), DEFAULT_HUMANIZE);
    const v1 = out.clips.find((c) => c.id === 'v1')!;
    const a1c = out.clips.find((c) => c.id === 'a1c')!;
    expect(clipEffectiveDuration(a1c)).toBeCloseTo(clipEffectiveDuration(v1), 5);
  });

  it('does nothing when jlCuts is disabled', () => {
    const { tl, assets } = twoSegmentTimeline([{ start: 5.0, end: 5.6 }]);
    const out = applyJLCuts(tl, buildSilenceContext(assets), { ...DEFAULT_HUMANIZE, jlCuts: false });
    expect(out).toBe(tl);
  });

  it('never extends audio past source bounds', () => {
    // out-point at source 5; only 0.2s of handle before the asset ends would be available if duration were small.
    const a = asset('a1', 5.2, [{ start: 5.0, end: 5.6 }]);
    const clips: Clip[] = [
      clip({ id: 'v1', assetId: 'a1', trackId: 'V', startTime: 0, duration: 5.2, trimStart: 0, trimEnd: 0.2, linkedClipIds: ['a1c'] }),
      clip({ id: 'a1c', assetId: 'a1', trackId: 'A', startTime: 0, duration: 5.2, trimStart: 0, trimEnd: 0.2, linkedClipIds: ['v1'] }),
    ];
    const tl: Timeline = {
      id: 't', name: 'T', tracks: [
        { id: 'V', name: 'V2', kind: 'video', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: 'A', name: 'A2', kind: 'audio', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      ],
      clips, duration: 5, transitions: [], markers: [],
    };
    const out = applyJLCuts(tl, buildSilenceContext([a]), DEFAULT_HUMANIZE);
    const a1c = out.clips.find((c) => c.id === 'a1c')!;
    expect(a1c.trimEnd).toBeGreaterThanOrEqual(0);
    expect(a1c.duration - a1c.trimEnd).toBeLessThanOrEqual(a1c.duration + 1e-6);
  });
});
