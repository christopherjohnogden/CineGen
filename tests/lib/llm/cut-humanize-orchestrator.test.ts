import { describe, expect, it } from 'vitest';
import { humanizeCutTimeline, buildSilenceContext, DEFAULT_HUMANIZE } from '@/lib/llm/cut-humanize';
import type { Asset } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';
import type { SilenceInterval } from '@/lib/llm/acoustic-analysis';

function asset(id: string, duration: number, silenceMap: SilenceInterval[]): Asset {
  return {
    id, name: id, type: 'video', duration,
    metadata: { analysis: { status: 'ready', segments: [], silenceMap } },
  } as unknown as Asset;
}

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'assetId' | 'trackId' | 'startTime' | 'duration' | 'trimStart' | 'trimEnd'>): Clip {
  return { name: over.id, speed: 1, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [], ...over } as Clip;
}

function fixture(silenceMap: SilenceInterval[]): { tl: Timeline; assets: Asset[] } {
  const a = asset('a1', 60, silenceMap);
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

describe('humanizeCutTimeline', () => {
  it('runs snap then J/L and yields at least one J/L cut on a silence-bearing fixture', () => {
    const { tl, assets } = fixture([{ start: 5.0, end: 5.6 }]);
    const out = humanizeCutTimeline(tl, buildSilenceContext(assets), DEFAULT_HUMANIZE);
    const v1 = out.clips.find((c) => c.id === 'v1')!;
    const a1c = out.clips.find((c) => c.id === 'a1c')!;
    expect(clipEffectiveDuration(a1c)).toBeGreaterThan(clipEffectiveDuration(v1));
  });

  it('keeps the video track gapless', () => {
    const { tl, assets } = fixture([{ start: 5.0, end: 5.6 }]);
    const out = humanizeCutTimeline(tl, buildSilenceContext(assets), DEFAULT_HUMANIZE);
    const videoClips = out.clips.filter((c) => c.trackId === 'V').sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < videoClips.length; i++) {
      expect(videoClips[i].startTime).toBeCloseTo(clipEndTime(videoClips[i - 1]), 5);
    }
  });

  it('returns an equivalent timeline when both passes are disabled', () => {
    const { tl, assets } = fixture([{ start: 5.0, end: 5.6 }]);
    const out = humanizeCutTimeline(tl, buildSilenceContext(assets), {
      ...DEFAULT_HUMANIZE, snapToSilence: false, jlCuts: false,
    });
    expect(out.clips.map((c) => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd })))
      .toEqual(tl.clips.map((c) => ({ id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd })));
  });
});
