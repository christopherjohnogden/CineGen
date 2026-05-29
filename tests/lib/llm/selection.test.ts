import { describe, expect, it } from 'vitest';
import {
  BASE_WEIGHTS,
  PERSONA_WEIGHTS,
  scoreMomentPerformance,
  type ScoringContext,
} from '@/lib/llm/selection';
import type { InsightMoment } from '@/lib/llm/editorial-workflow';

function makeMoment(overrides: Partial<InsightMoment> = {}): InsightMoment {
  return {
    id: overrides.id ?? 'm1',
    assetId: 'a1',
    assetName: 'Interview A',
    text: 'I grew up in a small town.',
    sourceStart: 0,
    sourceEnd: 3.2,
    words: [{ word: 'I', start: 0, end: 0.2 }],
    timelinePlacements: [],
    ...overrides,
  };
}

const baseCtx: ScoringContext = { activeTimelineId: '', queryEmotions: [] };

describe('BASE_WEIGHTS', () => {
  it('preserves the documented keyword defaults from the legacy scorer', () => {
    expect(BASE_WEIGHTS.termInText).toBe(4);
    expect(BASE_WEIGHTS.termElsewhere).toBe(2);
    expect(BASE_WEIGHTS.activeTimeline).toBe(2);
    expect(BASE_WEIGHTS.wordTiming).toBe(2);
  });
});

describe('PERSONA_WEIGHTS', () => {
  it('has a profile for every editorial persona', () => {
    const personas = [
      'documentary-editor',
      'promo-trailer-editor',
      'brand-storyteller',
      'social-shortform-editor',
      'interview-producer',
    ] as const;
    for (const p of personas) {
      expect(PERSONA_WEIGHTS[p]).toBeDefined();
      expect(Array.isArray(PERSONA_WEIGHTS[p].preferredEnergy)).toBe(true);
      expect(Array.isArray(PERSONA_WEIGHTS[p].preferredPace)).toBe(true);
    }
  });
});

describe('scoreMomentPerformance', () => {
  it('returns a score and structured reasons', () => {
    const result = scoreMomentPerformance(makeMoment(), ['town'], baseCtx);
    expect(typeof result.score).toBe('number');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('scores a keyword in transcript text higher than a keyword only in words/name', () => {
    const inText = scoreMomentPerformance(
      makeMoment({ text: 'the town was quiet' }),
      ['town'],
      baseCtx,
    ).score;
    const inWordsOnly = scoreMomentPerformance(
      makeMoment({ text: 'nothing relevant here', words: [{ word: 'town', start: 0, end: 0.3 }] }),
      ['town'],
      baseCtx,
    ).score;
    expect(inText).toBeGreaterThan(inWordsOnly);
  });

  it('no-persona ordering matches legacy relative behavior (term match beats no match)', () => {
    const matched = scoreMomentPerformance(makeMoment({ text: 'a town story' }), ['town'], baseCtx).score;
    const unmatched = scoreMomentPerformance(makeMoment({ text: 'a city story' }), ['town'], baseCtx).score;
    expect(matched).toBeGreaterThan(unmatched);
  });

  it('promo-trailer persona ranks high-energy above low-energy for the same keywords', () => {
    const ctx: ScoringContext = { ...baseCtx, persona: 'promo-trailer-editor' };
    const highEnergy = scoreMomentPerformance(
      makeMoment({ text: 'the big reveal', energy: 'high-driving', emotion: 'excited' }),
      ['reveal'],
      ctx,
    ).score;
    const lowEnergy = scoreMomentPerformance(
      makeMoment({ text: 'the big reveal', energy: 'low-and-deliberate', emotion: 'reflective' }),
      ['reveal'],
      ctx,
    ).score;
    expect(highEnergy).toBeGreaterThan(lowEnergy);
  });

  it('documentary persona ranks reflective/slow above high-energy for the same keywords', () => {
    const ctx: ScoringContext = { ...baseCtx, persona: 'documentary-editor' };
    const reflective = scoreMomentPerformance(
      makeMoment({ text: 'leaving home', pace: 'slow', emotion: 'reflective' }),
      ['home'],
      ctx,
    ).score;
    const punchy = scoreMomentPerformance(
      makeMoment({ text: 'leaving home', pace: 'fast', emotion: 'excited' }),
      ['home'],
      ctx,
    ).score;
    expect(reflective).toBeGreaterThan(punchy);
  });

  it('boosts moments whose emotion matches an emotion word in the query', () => {
    const ctx: ScoringContext = { ...baseCtx, queryEmotions: ['emotional'] };
    const emotional = scoreMomentPerformance(
      makeMoment({ text: 'about my father', emotion: 'emotional' }),
      ['father'],
      ctx,
    );
    const flat = scoreMomentPerformance(
      makeMoment({ text: 'about my father', emotion: 'neutral' }),
      ['father'],
      ctx,
    );
    expect(emotional.score).toBeGreaterThan(flat.score);
    expect(emotional.reasons.join(' ').toLowerCase()).toContain('emotion');
  });

  it('adds signal for each notable entry and explains it', () => {
    const withNotable = scoreMomentPerformance(
      makeMoment({ notable: ['usable as hook', '400ms pause before home'] }),
      ['town'],
      baseCtx,
    );
    const without = scoreMomentPerformance(makeMoment({ notable: undefined }), ['town'], baseCtx);
    expect(withNotable.score).toBeGreaterThan(without.score);
    expect(withNotable.reasons.join(' ').toLowerCase()).toContain('notable');
  });
});
