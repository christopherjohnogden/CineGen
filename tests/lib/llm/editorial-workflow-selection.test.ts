import { describe, expect, it } from 'vitest';
import { retrieveRelevantMoments, type ProjectInsightIndex, type InsightMoment } from '@/lib/llm/editorial-workflow';

function makeMoment(overrides: Partial<InsightMoment>): InsightMoment {
  return {
    id: 'm',
    assetId: 'a1',
    assetName: 'Interview A',
    text: '',
    sourceStart: 0,
    sourceEnd: 1,
    words: [],
    timelinePlacements: [],
    ...overrides,
  };
}

function makeIndex(moments: InsightMoment[]): ProjectInsightIndex {
  return {
    projectId: 'p1',
    activeTimelineId: '',
    builtAt: '2026-05-29T00:00:00.000Z',
    stats: {
      assetCount: 1,
      transcriptReadyCount: 1,
      wordTimestampReadyCount: 1,
      videoCount: 1,
      audioCount: 0,
      visualSummaryReadyCount: 0,
    },
    moments,
    referenceTimelines: [],
    visualInputs: [],
  } as unknown as ProjectInsightIndex;
}

describe('retrieveRelevantMoments — backward compatibility', () => {
  it('accepts a legacy numeric limit as the third argument', () => {
    const moments = Array.from({ length: 5 }, (_, i) =>
      makeMoment({ id: `m${i}`, text: `town story ${i}`, sourceStart: i }),
    );
    const out = retrieveRelevantMoments(makeIndex(moments), 'town', 2);
    expect(out).toHaveLength(2);
  });

  it('ranks a keyword-in-text moment above a no-match moment (no persona)', () => {
    const index = makeIndex([
      makeMoment({ id: 'match', text: 'a town story' }),
      makeMoment({ id: 'nomatch', text: 'a city story' }),
    ]);
    const out = retrieveRelevantMoments(index, 'town');
    expect(out[0].id).toBe('match');
    expect(out.find((m) => m.id === 'nomatch')).toBeUndefined(); // score 0 filtered out
  });
});

describe('retrieveRelevantMoments — persona-aware', () => {
  it('promo-trailer persona surfaces the high-energy take above the flat one', () => {
    const index = makeIndex([
      makeMoment({ id: 'flat', text: 'the big reveal', energy: 'low-and-deliberate' }),
      makeMoment({ id: 'punchy', text: 'the big reveal', energy: 'high-driving' }),
    ]);
    const out = retrieveRelevantMoments(index, 'reveal', { persona: 'promo-trailer-editor' });
    expect(out[0].id).toBe('punchy');
  });

  it('emits performance reasons in RetrievedMoment.reason', () => {
    const index = makeIndex([
      makeMoment({ id: 'm1', text: 'leaving home', delivery: 'voice cracks on home', emotion: 'reflective' }),
    ]);
    const out = retrieveRelevantMoments(index, 'home', { persona: 'documentary-editor' });
    expect(out[0].reason.toLowerCase()).toMatch(/delivery|emotion|matched/);
  });
});
