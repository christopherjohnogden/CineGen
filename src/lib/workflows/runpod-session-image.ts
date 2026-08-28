import {
  generateSessionImageAndWait,
  type RunpodSessionImageClientOptions,
  type RunpodSessionImageInput,
  type RunpodSessionImageResult,
} from '@/lib/runpod/session-image-client';

export const RUNPOD_SDXL_SESSION_NODE_TYPE = 'runpod-sdxl-session';
export const RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE = 'runpod-qwen-image-edit-session';

export type RunpodSessionImageNodeType =
  | typeof RUNPOD_SDXL_SESSION_NODE_TYPE
  | typeof RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE;

export function isRunpodSessionImageNodeType(nodeType: string): nodeType is RunpodSessionImageNodeType {
  return nodeType === RUNPOD_SDXL_SESSION_NODE_TYPE
    || nodeType === RUNPOD_QWEN_IMAGE_EDIT_SESSION_NODE_TYPE;
}

export function runpodSessionImageLabel(nodeType: RunpodSessionImageNodeType): string {
  return nodeType === RUNPOD_SDXL_SESSION_NODE_TYPE ? 'SDXL' : 'Qwen Image Edit';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringsFrom(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap(stringsFrom);
}

/** Convert Spaces field values into the shared active-session image contract. */
export function buildRunpodSessionImageInput(
  nodeType: RunpodSessionImageNodeType,
  inputs: Record<string, unknown>,
): RunpodSessionImageInput {
  const prompt = optionalString(inputs.prompt) ?? '';
  if (nodeType === RUNPOD_SDXL_SESSION_NODE_TYPE) {
    const negativePrompt = optionalString(inputs.negativePrompt)
      ?? optionalString(inputs.negative_prompt);
    const width = optionalNumber(inputs.width);
    const height = optionalNumber(inputs.height);
    const steps = optionalNumber(inputs.steps)
      ?? optionalNumber(inputs.num_inference_steps);
    const guidanceScale = optionalNumber(inputs.guidanceScale)
      ?? optionalNumber(inputs.guidance_scale);
    const seed = optionalNumber(inputs.seed);
    return {
      model: 'sdxl',
      prompt,
      ...(negativePrompt ? { negativePrompt } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(guidanceScale !== undefined ? { guidanceScale } : {}),
      ...(seed !== undefined && seed >= 0 ? { seed } : {}),
    };
  }

  const referenceImages = [...new Set([
    ...stringsFrom(inputs.image_url),
    ...stringsFrom(inputs.image_urls),
    ...stringsFrom(inputs.referenceImages),
  ])].slice(0, 3);
  const width = optionalNumber(inputs.width);
  const height = optionalNumber(inputs.height);
  const seed = optionalNumber(inputs.seed);
  return {
    model: 'qwen-image-edit',
    prompt,
    referenceImages,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(seed !== undefined && seed >= 0 ? { seed } : {}),
  };
}

export function runRunpodSessionImage(
  nodeType: RunpodSessionImageNodeType,
  inputs: Record<string, unknown>,
  options?: RunpodSessionImageClientOptions,
): Promise<RunpodSessionImageResult> {
  return generateSessionImageAndWait(buildRunpodSessionImageInput(nodeType, inputs), options);
}
