import type { ModelDefinition } from '@/types/workflow';

export const KLING_V3_QUALITY_OPTS = [
  { value: 'standard', label: 'Standard (720p)' },
  { value: 'pro', label: 'Pro (1080p)' },
  { value: '4k', label: '4K' },
];

export const SORA2_QUALITY_OPTS = [
  { value: 'pro', label: 'Pro (up to 1080p)' },
  { value: 'standard', label: 'Standard (720p)' },
];

export const LTX23_QUALITY_OPTS = [
  { value: 'pro', label: 'Pro' },
  { value: 'fast', label: 'Fast' },
];

export type KlingV3Quality = 'standard' | 'pro' | '4k';
export type KlingV3Mode = 'text-to-video' | 'image-to-video';

export function isKlingV3NodeType(nodeType: string): boolean {
  return nodeType === 'kling-3-text' || nodeType === 'kling-3-image';
}

/** fal.ai Kling 3 resolution is selected by endpoint tier, not a request param. */
export function resolveKlingV3ModelId(mode: KlingV3Mode, quality?: string | null): string {
  const tier: KlingV3Quality = quality === 'standard' || quality === '4k' ? quality : 'pro';
  return `fal-ai/kling-video/v3/${tier}/${mode}`;
}

export function usesEndpointQualityRouting(nodeType: string): boolean {
  return isKlingV3NodeType(nodeType)
    || nodeType === 'sora-2'
    || nodeType === 'ltx-2-3-text'
    || nodeType === 'ltx-2-3-image';
}

/** Pick the fal API endpoint when quality/tier is encoded in the URL path. */
export function resolveVideoModelEndpoint(
  nodeType: string,
  modelDef: Pick<ModelDefinition, 'id' | 'altId'>,
  opts: { hasImageInputs: boolean; quality?: string | null },
): string {
  const quality = opts.quality ?? 'pro';

  if (isKlingV3NodeType(nodeType)) {
    const mode: KlingV3Mode = nodeType === 'kling-3-image' ? 'image-to-video' : 'text-to-video';
    return resolveKlingV3ModelId(mode, quality);
  }

  if (nodeType === 'sora-2') {
    return quality === 'standard'
      ? 'fal-ai/sora-2/image-to-video'
      : 'fal-ai/sora-2/image-to-video/pro';
  }

  if (nodeType === 'ltx-2-3-text') {
    return quality === 'fast'
      ? 'fal-ai/ltx-2.3/text-to-video/fast'
      : 'fal-ai/ltx-2.3/text-to-video';
  }

  if (nodeType === 'ltx-2-3-image') {
    return quality === 'fast'
      ? 'fal-ai/ltx-2.3/image-to-video/fast'
      : 'fal-ai/ltx-2.3/image-to-video';
  }

  return (opts.hasImageInputs && modelDef.altId) ? modelDef.altId : modelDef.id;
}

/** Strip routing-only params and clamp resolution to what the chosen endpoint supports. */
export function sanitizeVideoInputsForEndpoint(
  nodeType: string,
  effectiveModelId: string,
  inputs: Record<string, unknown>,
): void {
  if (usesEndpointQualityRouting(nodeType)) {
    delete inputs.quality;
  }

  if (nodeType === 'sora-2' && !effectiveModelId.endsWith('/pro')) {
    if (inputs.resolution === '1080p' || inputs.resolution === 'true_1080p') {
      inputs.resolution = '720p';
    }
  }
}
