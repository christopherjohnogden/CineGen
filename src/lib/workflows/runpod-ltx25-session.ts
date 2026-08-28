import {
  generateLtx25AndWait,
  type RunpodLtx25ClientOptions,
  type RunpodLtx25Input,
  type RunpodLtx25Result,
} from '@/lib/runpod/ltx25-client';

export const RUNPOD_LTX25_SESSION_NODE_TYPE = 'runpod-ltx25-session';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Convert Spaces field values into the shared active-session client contract. */
export function buildRunpodLtx25SessionInput(inputs: Record<string, unknown>): RunpodLtx25Input {
  const prompt = optionalString(inputs.prompt) ?? '';
  const rawDuration = Number(inputs.durationSec);
  const durationSec = Number.isFinite(rawDuration)
    ? Math.min(20, Math.max(1, Math.round(rawDuration)))
    : 5;
  const aspectRatio = ['16:9', '9:16', '1:1'].includes(String(inputs.aspectRatio))
    ? String(inputs.aspectRatio)
    : '16:9';
  const resolution = inputs.resolution === '1080p' ? '1080p' : '720p';
  const firstFrame = optionalString(inputs.image_url)
    ?? (Array.isArray(inputs.referenceImages) ? optionalString(inputs.referenceImages[0]) : undefined);

  return {
    prompt,
    durationSec,
    aspectRatio,
    resolution,
    generateAudio: inputs.generateAudio !== false,
    ...(firstFrame ? { referenceImages: [firstFrame] } : {}),
  };
}

/** Run a Spaces node through the same temporary Pod client used by Director. */
export function runRunpodLtx25Session(
  inputs: Record<string, unknown>,
  options?: RunpodLtx25ClientOptions,
): Promise<RunpodLtx25Result> {
  return generateLtx25AndWait(buildRunpodLtx25SessionInput(inputs), options);
}
