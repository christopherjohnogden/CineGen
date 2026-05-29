import { describe, expect, it } from 'vitest';
import { buildSilenceContext, nearestSilenceEdge } from '@/lib/llm/cut-humanize';
import type { Asset } from '@/types/project';
import type { SilenceInterval } from '@/lib/llm/acoustic-analysis';

function asset(id: string, silenceMap: SilenceInterval[]): Asset {
  return {
    id,
    name: id,
    type: 'video',
    duration: 60,
    metadata: { analysis: { status: 'ready', segments: [], silenceMap } },
  } as unknown as Asset;
}

describe('buildSilenceContext', () => {
  it('reads silence intervals per asset from analysis.silenceMap', () => {
    const ctx = buildSilenceContext([
      asset('a1', [{ start: 3, end: 3.5 }, { start: 10, end: 10.4 }]),
      asset('a2', []),
    ]);
    expect(ctx.forAsset('a1')).toEqual([{ start: 3, end: 3.5 }, { start: 10, end: 10.4 }]);
    expect(ctx.forAsset('a2')).toEqual([]);
    expect(ctx.forAsset('missing')).toEqual([]);
  });

  it('returns intervals sorted by start', () => {
    const ctx = buildSilenceContext([asset('a1', [{ start: 10, end: 10.4 }, { start: 3, end: 3.5 }])]);
    expect(ctx.forAsset('a1').map((s) => s.start)).toEqual([3, 10]);
  });

  it('ignores assets without ready analysis', () => {
    const a = { id: 'x', name: 'x', type: 'video', metadata: {} } as unknown as Asset;
    expect(buildSilenceContext([a]).forAsset('x')).toEqual([]);
  });
});

describe('nearestSilenceEdge', () => {
  const silences: SilenceInterval[] = [
    { start: 3.0, end: 3.5 },
    { start: 10.0, end: 10.4 },
  ];

  it('snaps an out-point to a nearby silence start within tolerance', () => {
    // a cut ending at 2.8 is 0.2s before the silence at 3.0 → snap out to 3.0
    expect(nearestSilenceEdge(silences, 2.8, 0.4, 'out')).toBe(3.0);
  });

  it('snaps an in-point to a nearby silence end within tolerance', () => {
    // a cut starting at 3.6 is 0.1s after the silence end 3.5 → snap in to 3.5
    expect(nearestSilenceEdge(silences, 3.6, 0.4, 'in')).toBe(3.5);
  });

  it('returns null when no edge is within tolerance', () => {
    expect(nearestSilenceEdge(silences, 6.0, 0.4, 'out')).toBeNull();
    expect(nearestSilenceEdge(silences, 6.0, 0.4, 'in')).toBeNull();
  });

  it('returns null for empty silence list', () => {
    expect(nearestSilenceEdge([], 3.0, 0.4, 'out')).toBeNull();
  });
});
