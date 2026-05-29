import { describe, expect, it } from 'vitest';
import { buildProjectInsightIndex, extractAcousticSegments, extractSilenceMap } from '@/lib/llm/editorial-workflow';
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

describe('extractSilenceMap', () => {
  it('reads ready silence intervals', () => {
    const asset = makeAsset({ status: 'ready', segments: [], silenceMap: [{ start: 1, end: 2 }] });
    expect(extractSilenceMap(asset)).toEqual([{ start: 1, end: 2 }]);
  });
  it('returns [] when not ready or missing', () => {
    expect(extractSilenceMap(makeAsset(undefined))).toEqual([]);
    expect(extractSilenceMap(makeAsset({ status: 'analyzing', silenceMap: [{ start: 1, end: 2 }] }))).toEqual([]);
  });
  it('drops intervals where end <= start or array is absent', () => {
    expect(extractSilenceMap(makeAsset({ status: 'ready', silenceMap: [{ start: 2, end: 2 }, { start: 3, end: 1 }] }))).toEqual([]);
    expect(extractSilenceMap(makeAsset({ status: 'ready' }))).toEqual([]);
  });
});

describe('buildProjectInsightIndex acoustic join', () => {
  it('joins acoustic segment onto the overlapping transcript moment', () => {
    const asset = {
      id: 'a1',
      name: 'Interview A',
      type: 'video',
      duration: 10,
      metadata: {
        transcription: {
          segments: [
            { text: 'I grew up in a small town.', start: 0, end: 3.2, words: [{ word: 'I', start: 0, end: 0.2 }] },
            { text: 'It was hard to leave home.', start: 3.2, end: 7.0, words: [{ word: 'It', start: 3.2, end: 3.4 }] },
          ],
        },
        analysis: {
          status: 'ready',
          segments: [
            { start: 3.2, end: 7.0, delivery: "cracks on 'home'", emotion: 'reflective', pace: 'slow', notable: ['400ms pause'] },
          ],
          silenceMap: [{ start: 2.9, end: 3.15 }, { start: 7.0, end: 7.5 }],
        },
      },
    } as unknown as Asset;

    const index = buildProjectInsightIndex({
      projectId: 'p1',
      assets: [asset],
      timelines: [],
      activeTimelineId: '',
    });

    const moment = index.moments.find((m) => m.text === 'It was hard to leave home.');
    expect(moment).toBeDefined();
    expect(moment!.delivery).toBe("cracks on 'home'");
    expect(moment!.emotion).toBe('reflective');
    expect(moment!.notable).toEqual(['400ms pause']);
    expect(moment!.silenceAfter).toEqual({ start: 7.0, end: 7.5 });
    expect(moment!.silenceBefore).toEqual({ start: 2.9, end: 3.15 });

    const firstMoment = index.moments.find((m) => m.text === 'I grew up in a small town.');
    expect(firstMoment!.delivery).toBeUndefined();
  });
});
