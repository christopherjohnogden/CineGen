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
