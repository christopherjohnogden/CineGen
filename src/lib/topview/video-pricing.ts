import { TOPVIEW_INHERITED_VIDEO_DURATION } from '@/lib/topview/video-duration';
import type { ModelDefinition } from '@/types/workflow';

export const TOPVIEW_VIDEO_PRICING_CHECKED_AT = '2026-09-03';

/** Credits a second of video costs, before and after the discount on the account. */
interface VideoSecondRate {
  /** The struck-through figure Topview quotes. */
  list: number;
  /** What the balance is actually charged. */
  billed: number;
}

/**
 * Topview only reports what a clip cost once it has run, but its own generate
 * button prices one first, and that price is linear: a per-second rate fixed by
 * resolution, times the seconds, times the generation count. Read off the button
 * at every duration it offers (4/8/10/15/20/30s), all three heights came back exact.
 *
 * Both rates are stored because the discount is not one multiplier: 480p and 720p
 * come off a fifth, 1080p comes off two fifths. Deriving one from the other would
 * be right for two rows and wrong for the third.
 */
const TOPVIEW_VIDEO_RATE_CARD: Record<string, VideoSecondRate> = {
  '480': { list: 0.7, billed: 0.56 },
  '720': { list: 1.5, billed: 1.2 },
  '1080': { list: 3.7, billed: 2.2 },
};

const TOPVIEW_VIDEO_CREDITS_PER_SECOND: Record<string, Record<string, VideoSecondRate>> = {
  'Seedance 2.5': TOPVIEW_VIDEO_RATE_CARD,
  Standard: TOPVIEW_VIDEO_RATE_CARD,
  Fast: TOPVIEW_VIDEO_RATE_CARD,
};

function round2(credits: number): number {
  return Math.round(credits * 100) / 100;
}

/** Catalogs spell the same height `720`, `720p`, or `720P` depending on the model. */
function normalizeResolution(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim().toLowerCase().replace(/p$/, '');
  return /^\d+$/.test(text) ? text : undefined;
}

/** Select options arrive as strings even where the field is declared numeric. */
function normalizeSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const seconds = Number(String(value).trim().replace(/s$/i, ''));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export interface TopviewVideoCreditEstimate {
  model: string;
  resolution: string;
  seconds: number;
  /** Billed credits a second, at this resolution. */
  creditsPerSecond: number;
  /** One clip, at the discount actually billed. */
  unitCredits: number;
  /** Every clip this run would make, at the discount actually billed. */
  totalCredits: number;
  /** The same run before the discount — the struck-through figure Topview shows. */
  listCredits: number;
  count: number;
  pricingCheckedAt: string;
}

export function topviewVideoCreditEstimate(params: {
  model?: ModelDefinition;
  resolution?: unknown;
  duration?: unknown;
  count: number;
}): TopviewVideoCreditEstimate | null {
  if (params.model?.provider !== 'topview' || params.model.outputType !== 'video') return null;
  const rates = TOPVIEW_VIDEO_CREDITS_PER_SECOND[params.model.name];
  if (!rates) return null;

  const resolution = normalizeResolution(params.resolution);
  if (!resolution) return null;
  const rate = rates[resolution];
  if (!rate) return null;

  // A video edit inherits its length from the attached clip, so the seconds this
  // run will be billed for are not knowable until the provider has the clip.
  if (Number(params.duration) === TOPVIEW_INHERITED_VIDEO_DURATION) return null;
  const seconds = normalizeSeconds(params.duration);
  if (!seconds) return null;

  const count = Math.max(1, Math.floor(params.count));
  return {
    model: params.model.name,
    resolution,
    seconds,
    creditsPerSecond: rate.billed,
    unitCredits: round2(rate.billed * seconds),
    totalCredits: round2(rate.billed * seconds * count),
    listCredits: round2(rate.list * seconds * count),
    count,
    pricingCheckedAt: TOPVIEW_VIDEO_PRICING_CHECKED_AT,
  };
}
