// src/lib/llm/selection.ts
//
// Phase 2 — performance-aware selection. Pure functions only (no Electron/network), so the whole
// ranking/story-shape/relation surface is unit-testable. The heuristic scorer here is the
// deterministic backbone; an optional LLM re-rank (also pure: prompt-build + apply) can reorder the
// top slice without ever regressing the heuristic order.

import type { EditorialPersona, InsightMoment } from '@/lib/llm/editorial-workflow';

export interface ScoringWeights {
  termInText: number;        // keyword found in transcript text
  termElsewhere: number;     // keyword in assetName/words only
  activeTimeline: number;    // moment already used on the active timeline
  wordTiming: number;        // has word-level timestamps
  hasEmotion: number;        // any emotion descriptor present
  hasDelivery: number;       // delivery descriptor present (vocal performance)
  energyMatch: number;       // energy matches the persona's preferred energy
  paceMatch: number;         // pace matches the persona's preferred pace
  notableSignal: number;     // per notable[] entry (hooks, pauses, beats)
  emotionQueryMatch: number; // query mentions an emotion word this moment carries
  emotionBias: number;       // emotion is in the persona's favored set
}

// Mirrors the legacy scoreMoment defaults so that, with no persona, the new scorer is a strict
// superset of the old keyword behavior.
export const BASE_WEIGHTS: ScoringWeights = {
  termInText: 4,
  termElsewhere: 2,
  activeTimeline: 2,
  wordTiming: 2,
  hasEmotion: 1,
  hasDelivery: 1,
  energyMatch: 3,
  paceMatch: 3,
  notableSignal: 1,
  emotionQueryMatch: 5,
  emotionBias: 2,
};

export interface PersonaProfile {
  weights: Partial<ScoringWeights>; // overrides on BASE_WEIGHTS
  preferredEnergy: string[];        // fuzzy-matched against the free-text energy descriptor
  preferredPace: string[];          // fuzzy-matched against the free-text pace descriptor
  emotionBias: string[];            // emotions this persona favors surfacing
}

export type PersonaWeightProfile = Record<EditorialPersona, PersonaProfile>;

// The single place persona specialization lives. Adding a persona = adding a row.
export const PERSONA_WEIGHTS: PersonaWeightProfile = {
  'documentary-editor': {
    weights: { paceMatch: 4, emotionBias: 3 },
    preferredEnergy: ['low', 'measured', 'calm', 'deliberate', 'steady'],
    preferredPace: ['slow', 'measured', 'deliberate', 'unhurried'],
    emotionBias: ['reflective', 'wistful', 'sincere', 'somber', 'thoughtful', 'emotional'],
  },
  'promo-trailer-editor': {
    weights: { energyMatch: 5, notableSignal: 2 },
    preferredEnergy: ['high', 'driving', 'punchy', 'energetic', 'intense', 'building'],
    preferredPace: ['fast', 'quick', 'snappy', 'urgent'],
    emotionBias: ['excited', 'triumphant', 'tense', 'hyped', 'epic'],
  },
  'brand-storyteller': {
    weights: { hasEmotion: 2, emotionBias: 3 },
    preferredEnergy: ['warm', 'confident', 'uplifting', 'steady'],
    preferredPace: ['measured', 'flowing', 'smooth'],
    emotionBias: ['inspired', 'hopeful', 'proud', 'warm', 'aspirational'],
  },
  'social-shortform-editor': {
    weights: { energyMatch: 4, notableSignal: 3 },
    preferredEnergy: ['high', 'punchy', 'snappy', 'energetic', 'hooky'],
    preferredPace: ['fast', 'quick', 'snappy', 'rapid'],
    emotionBias: ['excited', 'funny', 'surprised', 'relatable', 'bold'],
  },
  'interview-producer': {
    weights: { hasDelivery: 2, emotionBias: 2 },
    preferredEnergy: ['conversational', 'natural', 'steady', 'engaged'],
    preferredPace: ['natural', 'measured', 'conversational'],
    emotionBias: ['candid', 'reflective', 'honest', 'vulnerable', 'emotional'],
  },
};

export interface ScoringContext {
  activeTimelineId: string;
  persona?: EditorialPersona;
  queryEmotions: string[]; // emotion words detected in the query
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

function resolveWeights(persona?: EditorialPersona): ScoringWeights {
  if (!persona) return BASE_WEIGHTS;
  return { ...BASE_WEIGHTS, ...PERSONA_WEIGHTS[persona].weights };
}

/** Fuzzy token match: does the free-text descriptor contain any of the preferred tokens? */
function descriptorMatches(descriptor: string | undefined, preferred: string[]): boolean {
  if (!descriptor) return false;
  const lower = descriptor.toLowerCase();
  return preferred.some((token) => lower.includes(token.toLowerCase()));
}

export function scoreMomentPerformance(
  moment: InsightMoment,
  terms: string[],
  ctx: ScoringContext,
): ScoreResult {
  const weights = resolveWeights(ctx.persona);
  const profile = ctx.persona ? PERSONA_WEIGHTS[ctx.persona] : undefined;
  const reasons: string[] = [];
  let score = 0;

  // --- Keyword relevance (legacy-compatible) ---
  if (terms.length === 0) {
    // Match the legacy no-term baseline: word-timing-rich moments and active-timeline moments win.
    score += moment.words.length > 0 ? 3 : 1;
  } else {
    const text = moment.text.toLowerCase();
    const haystack = `${moment.assetName} ${moment.text} ${moment.words.map((w) => w.word).join(' ')}`.toLowerCase();
    let matched = 0;
    for (const term of terms) {
      if (!haystack.includes(term)) continue;
      matched += 1;
      score += text.includes(term) ? weights.termInText : weights.termElsewhere;
    }
    if (matched > 0) reasons.push(`matched ${terms.slice(0, 4).join(', ')}`);
  }

  if (moment.timelinePlacements.some((p) => p.timelineId === ctx.activeTimelineId) && ctx.activeTimelineId) {
    score += weights.activeTimeline;
    reasons.push('already on the active timeline');
  }
  if (moment.words.length > 0) {
    score += weights.wordTiming;
  }

  // --- Phase 1 performance signal ---
  if (moment.emotion) {
    score += weights.hasEmotion;
  }
  if (moment.delivery) {
    score += weights.hasDelivery;
    reasons.push('has vocal delivery notes');
  }
  if (profile) {
    if (descriptorMatches(moment.energy, profile.preferredEnergy)) {
      score += weights.energyMatch;
      reasons.push(`${moment.energy} energy fits ${ctx.persona}`);
    }
    if (descriptorMatches(moment.pace, profile.preferredPace)) {
      score += weights.paceMatch;
      reasons.push(`${moment.pace} pace fits ${ctx.persona}`);
    }
    if (moment.emotion && profile.emotionBias.some((e) => moment.emotion!.toLowerCase().includes(e))) {
      score += weights.emotionBias;
      reasons.push(`${moment.emotion} emotion favored by ${ctx.persona}`);
    }
  }
  if (moment.emotion && ctx.queryEmotions.some((q) => moment.emotion!.toLowerCase().includes(q) || q.includes(moment.emotion!.toLowerCase()))) {
    score += weights.emotionQueryMatch;
    reasons.push(`emotion (${moment.emotion}) matches the query`);
  }
  if (moment.notable && moment.notable.length > 0) {
    score += weights.notableSignal * moment.notable.length;
    reasons.push(`notable: ${moment.notable.slice(0, 2).join('; ')}`);
  }

  return { score, reasons };
}
