// Curated Higgsfield model choices offered in the Frame Chat generate clarification step.
// A small, opinionated subset of HIGGSFIELD_MODELS — enough choice without overwhelming.

import { HIGGSFIELD_MODELS } from './higgsfield-models';

export type FrameChatOutputType = 'image' | 'video';

export interface FrameChatModelOption {
  id: string;
  label: string;
  outputType: FrameChatOutputType;
  /** Default pick for its output type. */
  isDefault: boolean;
}

export const FRAME_CHAT_MODEL_OPTIONS: FrameChatModelOption[] = [
  // Image — a still-frame edit (e.g. recolor a shirt). Nano Banana is the sharp default.
  { id: HIGGSFIELD_MODELS.nanoBanana, label: 'Nano Banana Pro — 4K image', outputType: 'image', isDefault: true },
  { id: HIGGSFIELD_MODELS.gptImage, label: 'GPT Image 2 — general / design', outputType: 'image', isDefault: false },
  { id: HIGGSFIELD_MODELS.soul, label: 'Soul V2 — portrait / character', outputType: 'image', isDefault: false },
  // Video — a short moving edit. Seedance is the reference-driven default.
  { id: HIGGSFIELD_MODELS.seedance, label: 'Seedance 2.0 — reference-driven', outputType: 'video', isDefault: true },
  { id: HIGGSFIELD_MODELS.kling, label: 'Kling 3.0 — multi-shot', outputType: 'video', isDefault: false },
  { id: HIGGSFIELD_MODELS.veo, label: 'Veo 3.1 — Google Veo', outputType: 'video', isDefault: false },
];

/** Models available for a given output type, in display order. */
export function modelsFor(outputType: FrameChatOutputType): FrameChatModelOption[] {
  return FRAME_CHAT_MODEL_OPTIONS.filter((m) => m.outputType === outputType);
}

/** The default model id for an output type (falls back to the first option of that type). */
export function defaultModelFor(outputType: FrameChatOutputType): string {
  const options = modelsFor(outputType);
  return (options.find((m) => m.isDefault) ?? options[0]).id;
}

/** The output type a model id produces, or null if it's not a known Frame Chat option. */
export function outputTypeForModel(modelId: string): FrameChatOutputType | null {
  return FRAME_CHAT_MODEL_OPTIONS.find((m) => m.id === modelId)?.outputType ?? null;
}

// Aspect ratios Higgsfield models accept via --aspect_ratio.
const SUPPORTED_RATIOS: Array<{ label: string; value: number }> = [
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '1:1', value: 1 },
  { label: '21:9', value: 21 / 9 },
];

/**
 * Snap a source width/height to the nearest supported aspect ratio so a generated edit matches the
 * footage instead of defaulting to square. Falls back to '16:9' when dimensions are unknown.
 */
export function aspectRatioFor(width?: number, height?: number): string {
  if (!width || !height || width <= 0 || height <= 0) return '16:9';
  const ratio = width / height;
  let best = SUPPORTED_RATIOS[0];
  for (const candidate of SUPPORTED_RATIOS) {
    if (Math.abs(candidate.value - ratio) < Math.abs(best.value - ratio)) best = candidate;
  }
  return best.label;
}
