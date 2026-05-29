import { describe, expect, it } from 'vitest';
import { buildStoryShape } from '@/lib/llm/selection';
import type { InsightMoment } from '@/lib/llm/editorial-workflow';

function m(id: string, start: number, energy?: string, emotion?: string): InsightMoment {
  return {
    id,
    assetId: 'a1',
    assetName: 'A',
    text: id,
    sourceStart: start,
    sourceEnd: start + 1,
    words: [],
    timelinePlacements: [],
    energy,
    emotion,
  };
}

describe('buildStoryShape', () => {
  it('returns empty shape for no moments', () => {
    const shape = buildStoryShape([]);
    expect(shape.points).toEqual([]);
    expect(shape.method).toBe('heuristic');
  });

  it('labels a low-open / back-half-peak / calm-close arc with setup, climax, resolution', () => {
    const moments = [
      m('open', 0, 'calm', 'reflective'),
      m('build', 10, 'building', 'tense'),
      m('peak', 20, 'high-driving', 'triumphant'),
      m('cool', 30, 'measured', 'reflective'),
      m('close', 40, 'low', 'wistful'),
    ];
    const shape = buildStoryShape(moments);
    expect(shape.points).toHaveLength(5);

    const beatOf = (id: string) => shape.points.find((p) => p.momentId === id)?.beat;
    expect(beatOf('open')).toBe('setup');
    expect(beatOf('peak')).toBe('climax');
    expect(beatOf('close')).toBe('resolution');

    // climax should carry the highest intensity
    const climax = shape.points.find((p) => p.beat === 'climax')!;
    expect(climax.intensity).toBeGreaterThanOrEqual(Math.max(...shape.points.map((p) => p.intensity)) - 1e-9);

    expect(typeof shape.arcSummary).toBe('string');
    expect(shape.arcSummary.length).toBeGreaterThan(0);
  });

  it('normalizes position 0..1 across moments in source order', () => {
    const moments = [m('a', 0), m('b', 5), m('c', 10)];
    const shape = buildStoryShape(moments);
    const positions = shape.points.map((p) => p.position);
    expect(Math.min(...positions)).toBe(0);
    expect(Math.max(...positions)).toBe(1);
  });
});
