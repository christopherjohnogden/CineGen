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
  'GPT Image 2': { '1K': 0.2, '2K': 0.8, '4K': 1.4 },
  'Reve Image Remix': { '1K': 1.6, '2K': 1.8, '4K': 2 },
  'Kontext-Pro': { default: 0.5 },
  'Imagen 4': { default: 0.5 },
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

export interface TopviewImageCreditEstimate {
  model: string;
  resolution?: string;
  unitCredits: number;
  totalCredits: number;
  count: number;
  pricingCheckedAt: string;
  usesAutomaticDefault: boolean;
}

export function topviewImageCreditEstimate(params: {
  model?: ModelDefinition;
  resolution?: string;
  count: number;
}): TopviewImageCreditEstimate | null {
  if (params.model?.provider !== 'topview') return null;
  const usesAutomaticDefault = params.model.id === 'topview/image/auto'
    || params.model.nodeType === 'topview-image-auto';
  const modelName = usesAutomaticDefault ? 'GPT Image 2' : params.model.name;
  const prices = TOPVIEW_IMAGE_CREDIT_PRICES[modelName];
  if (!prices) return null;
  const unitCredits = params.resolution && prices[params.resolution] !== undefined
    ? prices[params.resolution]
    : prices.default;
  if (unitCredits === undefined) return null;
  const count = Math.max(1, Math.floor(params.count));
  return {
    model: modelName,
    ...(params.resolution ? { resolution: params.resolution } : {}),
    unitCredits,
    totalCredits: Math.round(unitCredits * count * 100) / 100,
    count,
    pricingCheckedAt: TOPVIEW_IMAGE_PRICING_CHECKED_AT,
    usesAutomaticDefault,
  };
}
