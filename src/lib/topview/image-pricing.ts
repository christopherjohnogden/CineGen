import type { ModelDefinition } from '@/types/workflow';

export const TOPVIEW_IMAGE_PRICING_CHECKED_AT = '2026-08-28';

const TOPVIEW_IMAGE_CREDIT_PRICES: Record<string, Record<string, number>> = {
  'Nano Banana 2': { '512p': 0.25, '1K': 0.4, '2K': 0.6, '4K': 0.85 },
  'Nano Banana 2 Lite': { '1K': 0.3 },
  'Nano Banana Pro': { '1K': 0.8, '2K': 0.8, '4K': 1.4 },
  'Nano Banana': { default: 0.3 },
  'Seedream 5.0 Pro': { '1K': 0.4, '2K': 0.8 },
  'Seedream 5.0 Lite': { '2K': 0.2 },
  'Seedream 5.0': { '2K': 0.2 },
  'Seedream 4.5': { '2K': 0.2, '4K': 0.2 },
  'Seedream 4.0': { '1K': 0.15, '2K': 0.15, '4K': 0.15 },
  'Grok Image Quality': { '1K': 0.6, '2K': 1 },
  'Grok Image': { '1K': 0.3, '2K': 0.3 },
  'Kling V3 Omni': { '1K': 0.3, '2K': 0.3, '4K': 0.6 },
  // GPT Image 2 charges by quality as well; it lives in TOPVIEW_IMAGE_QUALITY_PRICES.
  'Reve Image Remix': { '1K': 1.6, '2K': 1.8, '4K': 2 },
  'Kontext-Pro': { default: 0.5 },
  'Imagen 4': { default: 0.5 },
};

interface QualityPricing {
  /** What Topview submits, and charges for, when no quality has been chosen. */
  default: string;
  prices: Record<string, Record<string, number>>;
}

/**
 * Some models charge for quality on top of resolution, and not by any constant
 * factor: GPT Image 2's High is eight times its Medium at 1K but only three and
 * a half times at 4K. A model listed here is priced from this table alone, so a
 * quality it has no row for shows nothing rather than the wrong resolution price.
 *
 * Unlike video, Topview quotes one figure for an image — there is no struck-through
 * list price beside it, so what is stored here is what the balance is charged.
 */
const TOPVIEW_IMAGE_QUALITY_PRICES: Record<string, QualityPricing> = {
  'GPT Image 2': {
    default: 'medium',
    prices: {
      medium: { '1K': 0.2, '2K': 0.8, '4K': 1.4 },
      high: { '1K': 1.6, '2K': 3.2, '4K': 4.8 },
    },
  },
};

function optionValue(option: unknown): string | undefined {
  if (typeof option === 'string' || typeof option === 'number') return String(option);
  if (!option || typeof option !== 'object' || Array.isArray(option)) return undefined;
  const record = option as Record<string, unknown>;
  const value = record.value ?? record.id ?? record.name ?? record.label;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

export function imageResolutionOptions(model?: ModelDefinition): string[] {
  const field = model?.inputs.find((input) => input.id === 'resolution' || input.falParam === 'resolution');
  const values = (field?.options ?? []).map(optionValue).filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

export function preferredImageResolution(model: ModelDefinition | undefined, configured?: unknown): string | undefined {
  const options = imageResolutionOptions(model);
  if (!options.length) return undefined;
  const requested = typeof configured === 'string' ? configured : '';
  if (requested && options.includes(requested)) return requested;
  const field = model?.inputs.find((input) => input.id === 'resolution' || input.falParam === 'resolution');
  const fallback = optionValue(field?.default);
  if (fallback && options.includes(fallback)) return fallback;
  if (options.includes('2K')) return '2K';
  if (options.includes('1K')) return '1K';
  return options[0];
}

/** The quality the model will submit when nothing has been chosen for it. */
export function preferredImageQuality(model: ModelDefinition | undefined, configured?: unknown): string | undefined {
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const field = model?.inputs.find((input) => input.id === 'quality' || input.falParam === 'quality');
  return field ? optionValue(field.default) : undefined;
}

export interface TopviewImageCreditEstimate {
  model: string;
  resolution?: string;
  quality?: string;
  unitCredits: number;
  totalCredits: number;
  count: number;
  pricingCheckedAt: string;
  usesAutomaticDefault: boolean;
}

export function topviewImageCreditEstimate(params: {
  model?: ModelDefinition;
  resolution?: string;
  /** Omit to price the quality the model submits by default. */
  quality?: unknown;
  count: number;
}): TopviewImageCreditEstimate | null {
  if (params.model?.provider !== 'topview') return null;
  const usesAutomaticDefault = params.model.id === 'topview/image/auto'
    || params.model.nodeType === 'topview-image-auto';
  const modelName = usesAutomaticDefault ? 'GPT Image 2' : params.model.name;

  // A model that charges for quality is priced from that table only: falling back
  // to the flat one would quote its cheapest tier for every tier.
  const byQuality = TOPVIEW_IMAGE_QUALITY_PRICES[modelName];
  const quality = byQuality
    ? (preferredImageQuality(params.model, params.quality) ?? byQuality.default).trim().toLowerCase()
    : undefined;
  const prices = byQuality ? byQuality.prices[quality ?? ''] : TOPVIEW_IMAGE_CREDIT_PRICES[modelName];
  if (!prices) return null;

  const unitCredits = params.resolution && prices[params.resolution] !== undefined
    ? prices[params.resolution]
    : prices.default;
  if (unitCredits === undefined) return null;
  const count = Math.max(1, Math.floor(params.count));
  return {
    model: modelName,
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(quality ? { quality } : {}),
    unitCredits,
    totalCredits: Math.round(unitCredits * count * 100) / 100,
    count,
    pricingCheckedAt: TOPVIEW_IMAGE_PRICING_CHECKED_AT,
    usesAutomaticDefault,
  };
}
