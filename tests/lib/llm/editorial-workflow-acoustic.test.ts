import { describe, expect, it } from 'vitest';
import { extractAcousticSegments } from '@/lib/llm/editorial-workflow';
import type { Asset } from '@/types/project';

function makeAsset(analysis: unknown): Asset {
  return {
    id: 'a1',
    name: 'Interview A',
    type: 'video',
    metadata: { analysis },
  } as unknown as Asset;
}

describe('extractAcousticSegments', () => {
  it('reads ready analysis segments from asset metadata', () => {
    const asset = makeAsset({
      status: 'ready',
      segments: [{ start: 0, end: 3.2, delivery: 'steady', emotion: 'calm' }],
      silenceMap: [{ start: 3.2, end: 3.6 }],
    });
    const segs = extractAcousticSegments(asset);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 0, end: 3.2, delivery: 'steady', emotion: 'calm' });
  });

  it('returns [] when analysis is missing or not ready', () => {
    expect(extractAcousticSegments(makeAsset(undefined))).toEqual([]);
    expect(extractAcousticSegments(makeAsset({ status: 'analyzing', segments: [] }))).toEqual([]);
  });
});
