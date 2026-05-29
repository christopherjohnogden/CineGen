import { describe, expect, it } from 'vitest';
import { buildRerankPrompt, applyRerankResult } from '@/lib/llm/selection';
import type { RetrievedMoment } from '@/lib/llm/editorial-workflow';

function rm(id: string): RetrievedMoment {
  return {
    id,
    assetId: 'a1',
    assetName: 'A',
    text: `text ${id}`,
    sourceStart: 0,
    sourceEnd: 1,
    words: [],
    timelinePlacements: [],
    score: 10,
    reason: 'candidate',
  };
}

describe('buildRerankPrompt', () => {
  it('includes persona, story goal, and candidate ids+text', () => {
    const prompt = buildRerankPrompt({
      query: 'best opening line',
      brief: { persona: 'documentary-editor', tone: 'reflective', storyGoal: 'a coming-of-age arc', pacing: 'measured' },
      candidates: [rm('x1'), rm('x2')],
    });
    expect(prompt).toContain('documentary-editor');
    expect(prompt).toContain('coming-of-age');
    expect(prompt).toContain('x1');
    expect(prompt).toContain('x2');
  });
});

describe('applyRerankResult', () => {
  const heuristic = [rm('a'), rm('b'), rm('c')];

  it('reorders by the model id order', () => {
    const out = applyRerankResult(heuristic, '{"order":["c","a","b"]}');
    expect(out.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps missing ids at the tail in heuristic order', () => {
    const out = applyRerankResult(heuristic, '{"order":["b"]}');
    expect(out.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('ignores unknown ids', () => {
    const out = applyRerankResult(heuristic, '{"order":["zzz","b","a","c"]}');
    expect(out.map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns heuristic order unchanged on malformed JSON', () => {
    const out = applyRerankResult(heuristic, 'not json at all');
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns heuristic order on empty / missing order field', () => {
    expect(applyRerankResult(heuristic, '{}').map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(applyRerankResult(heuristic, '').map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('accepts fenced JSON', () => {
    const out = applyRerankResult(heuristic, 'Here:\n```json\n{"order":["c","b","a"]}\n```');
    expect(out.map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });
});
