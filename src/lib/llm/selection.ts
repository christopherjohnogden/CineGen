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

// ---------------------------------------------------------------------------
// Story-shape map (heuristic) — where the narrative arc sits across moments.
// ---------------------------------------------------------------------------

export type StoryBeat = 'setup' | 'rising' | 'climax' | 'falling' | 'resolution';

export interface StoryShapePoint {
  momentId: string;
  position: number;   // 0..1 normalized position in source order
  beat: StoryBeat;
  intensity: number;  // 0..1 from energy/emotion descriptors
  reason: string;
}

export interface StoryShape {
  points: StoryShapePoint[];
  arcSummary: string;
  method: 'heuristic' | 'llm-refined';
}

const HIGH_INTENSITY_TOKENS = ['high', 'driving', 'punchy', 'intense', 'building', 'epic', 'urgent', 'tense', 'excited', 'triumphant', 'hyped'];
const LOW_INTENSITY_TOKENS = ['low', 'calm', 'measured', 'deliberate', 'slow', 'quiet', 'reflective', 'wistful', 'somber', 'gentle'];

/** 0..1 intensity from the free-text energy + emotion descriptors. Neutral defaults to 0.5. */
function momentIntensity(moment: InsightMoment): number {
  const text = `${moment.energy ?? ''} ${moment.emotion ?? ''}`.toLowerCase();
  if (!text.trim()) return 0.4; // unknown performance → slightly below neutral
  const high = HIGH_INTENSITY_TOKENS.some((t) => text.includes(t));
  const low = LOW_INTENSITY_TOKENS.some((t) => text.includes(t));
  if (high && !low) return 0.85;
  if (low && !high) return 0.2;
  return 0.5;
}

export function buildStoryShape(moments: InsightMoment[]): StoryShape {
  if (moments.length === 0) {
    return { points: [], arcSummary: '', method: 'heuristic' };
  }

  const ordered = [...moments].sort((a, b) => a.sourceStart - b.sourceStart);
  const n = ordered.length;
  const intensities = ordered.map(momentIntensity);
  const peakIntensity = Math.max(...intensities);
  // Prefer a peak in the back half for the climax; fall back to the global peak.
  let climaxIndex = intensities.indexOf(peakIntensity);
  const backHalf = intensities.map((v, i) => ({ v, i })).filter(({ i }) => i >= Math.floor(n / 2));
  if (backHalf.length > 0) {
    const backPeak = backHalf.reduce((best, cur) => (cur.v > best.v ? cur : best));
    if (backPeak.v >= peakIntensity - 0.15) climaxIndex = backPeak.i;
  }

  const points: StoryShapePoint[] = ordered.map((moment, i) => {
    const position = n === 1 ? 0 : i / (n - 1);
    const intensity = intensities[i];
    let beat: StoryBeat;
    if (i === climaxIndex) {
      beat = 'climax';
    } else if (i === 0 || (position < 0.2 && intensity <= 0.5)) {
      beat = 'setup';
    } else if (i === n - 1 || (position > 0.8 && intensity <= 0.5)) {
      beat = 'resolution';
    } else if (i < climaxIndex) {
      beat = 'rising';
    } else {
      beat = 'falling';
    }
    return {
      momentId: moment.id,
      position: Math.round(position * 1000) / 1000,
      beat,
      intensity,
      reason: `${beat} (intensity ${intensity.toFixed(2)} at ${(position * 100).toFixed(0)}%)`,
    };
  });

  // Make sure the position extremes are exactly 0 and 1 for n > 1.
  if (n > 1) {
    points[0].position = 0;
    points[n - 1].position = 1;
  }

  const climaxPos = points[climaxIndex]?.position ?? 0;
  const arcSummary = describeArc(climaxPos, intensities);

  return { points, arcSummary, method: 'heuristic' };
}

function describeArc(climaxPos: number, intensities: number[]): string {
  const front = climaxPos < 0.4;
  const back = climaxPos > 0.66;
  const shape = front ? 'front-loaded' : back ? 'late-climax' : 'centered';
  const last = intensities[intensities.length - 1];
  const resolution = last <= 0.3 ? 'soft landing' : last >= 0.7 ? 'high-energy ending' : 'even resolution';
  return `${shape} arc, ${resolution}`;
}

// ---------------------------------------------------------------------------
// Repetition / contradiction map (heuristic) — which moments restate or conflict.
// ---------------------------------------------------------------------------

export interface MomentRelation {
  aId: string;
  bId: string;
  kind: 'repetition' | 'contradiction';
  similarity: number; // 0..1
  reason: string;
}

export interface RelationMap {
  relations: MomentRelation[];
  method: 'heuristic' | 'llm-refined';
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'is', 'was', 'it', 'i', 'we', 'you', 'he', 'she', 'they', 'my', 'this', 'that']);
const POSITIVE_CUES = ['best', 'great', 'love', 'happy', 'good', 'better', 'amazing', 'proud', 'glad'];
const NEGATIVE_CUES = ['worst', 'hate', 'sad', 'bad', 'worse', 'terrible', 'regret', 'awful', 'angry'];
const POSITIVE_EMOTIONS = ['happy', 'excited', 'proud', 'hopeful', 'joy', 'triumphant'];
const NEGATIVE_EMOTIONS = ['sad', 'angry', 'somber', 'tense', 'regret', 'fear'];

const REPETITION_THRESHOLD = 0.6;
const CONTRADICTION_OVERLAP_THRESHOLD = 0.45;

function tokenSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function sentimentSign(moment: InsightMoment): -1 | 0 | 1 {
  const text = moment.text.toLowerCase();
  const emotion = (moment.emotion ?? '').toLowerCase();
  const pos = POSITIVE_CUES.some((c) => text.includes(c)) || POSITIVE_EMOTIONS.some((e) => emotion.includes(e));
  const neg = NEGATIVE_CUES.some((c) => text.includes(c)) || NEGATIVE_EMOTIONS.some((e) => emotion.includes(e));
  if (pos && !neg) return 1;
  if (neg && !pos) return -1;
  return 0;
}

export function buildRelationMap(moments: InsightMoment[]): RelationMap {
  const relations: MomentRelation[] = [];
  if (moments.length < 2) return { relations, method: 'heuristic' };

  const tokens = moments.map((m) => tokenSet(m.text));
  const signs = moments.map(sentimentSign);

  for (let i = 0; i < moments.length; i++) {
    for (let j = i + 1; j < moments.length; j++) {
      const similarity = jaccard(tokens[i], tokens[j]);
      const oppositeSentiment = signs[i] !== 0 && signs[j] !== 0 && signs[i] !== signs[j];
      // Opposite sentiment over a shared subject is a contradiction even at high overlap (the texts
      // can be near-identical save for an antonym), so check it before the repetition branch.
      if (similarity >= CONTRADICTION_OVERLAP_THRESHOLD && oppositeSentiment) {
        relations.push({
          aId: moments[i].id,
          bId: moments[j].id,
          kind: 'contradiction',
          similarity: Math.round(similarity * 1000) / 1000,
          reason: `same subject (${(similarity * 100).toFixed(0)}% overlap) but opposite sentiment — possible contradiction`,
        });
      } else if (similarity >= REPETITION_THRESHOLD) {
        relations.push({
          aId: moments[i].id,
          bId: moments[j].id,
          kind: 'repetition',
          similarity: Math.round(similarity * 1000) / 1000,
          reason: `${(similarity * 100).toFixed(0)}% word overlap — likely the same line/take`,
        });
      }
    }
  }

  return { relations, method: 'heuristic' };
}
