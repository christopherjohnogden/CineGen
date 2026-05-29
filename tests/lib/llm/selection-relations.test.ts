import { describe, expect, it } from 'vitest';
import { buildRelationMap } from '@/lib/llm/selection';
import type { InsightMoment } from '@/lib/llm/editorial-workflow';

function m(id: string, text: string, emotion?: string): InsightMoment {
  return {
    id,
    assetId: 'a1',
    assetName: 'A',
    text,
    sourceStart: 0,
    sourceEnd: 1,
    words: [],
    timelinePlacements: [],
    emotion,
  };
}

describe('buildRelationMap', () => {
  it('flags two near-identical-text moments as repetition with high similarity', () => {
    const map = buildRelationMap([
      m('t1', 'I grew up in a small town'),
      m('t2', 'I grew up in a small town'),
      m('other', 'completely different subject entirely'),
    ]);
    const rep = map.relations.find((r) => r.kind === 'repetition');
    expect(rep).toBeDefined();
    expect(new Set([rep!.aId, rep!.bId])).toEqual(new Set(['t1', 't2']));
    expect(rep!.similarity).toBeGreaterThan(0.8);
    expect(map.method).toBe('heuristic');
  });

  it('does not flag unrelated moments', () => {
    const map = buildRelationMap([
      m('a', 'the weather was sunny today'),
      m('b', 'quarterly revenue exceeded projections'),
    ]);
    expect(map.relations.filter((r) => r.kind === 'repetition')).toHaveLength(0);
  });

  it('flags a contradiction candidate when high overlap meets opposite emotion', () => {
    const map = buildRelationMap([
      m('pos', 'the move to the city was the best decision', 'happy'),
      m('neg', 'the move to the city was the worst decision', 'sad'),
    ]);
    // high lexical overlap + opposite emotion cue → contradiction candidate
    const contradiction = map.relations.find((r) => r.kind === 'contradiction');
    expect(contradiction).toBeDefined();
  });

  it('returns no relations for a single moment', () => {
    expect(buildRelationMap([m('only', 'one moment')]).relations).toEqual([]);
  });
});
