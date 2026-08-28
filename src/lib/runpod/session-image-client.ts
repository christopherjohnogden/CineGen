import {
  getRunpodLtxPodAuthToken,
  getRunpodLtxPodId,
  getRunpodLtxPodUrl,
} from '@/lib/utils/api-key';

export type RunpodSessionImageModel = 'sdxl' | 'qwen-image-edit';

export interface RunpodSessionImageInput {
  model: RunpodSessionImageModel;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  referenceImages?: string[];
}

export interface RunpodSessionImageResult {
  jobId: string;
  url: string;
  model?: string;
}

interface RunpodSessionImageResponse {
  jobId?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  output?: {
    url?: string;
    model?: string;
  };
  error?: string;
}

type GenerateSessionImage = (params: {
  podId: string;
  podUrl: string;
  podAuthToken: string;
  /** Keeps older generation-session gateways identifiable while polling. */
  model?: RunpodSessionImageModel;
  input?: RunpodSessionImageInput;
  jobId?: string;
}) => Promise<RunpodSessionImageResponse>;

export interface RunpodSessionImageClientOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onJobId?: (jobId: string) => void;
  /** Resume polling a previously submitted image without creating another paid job. */
  resumeJobId?: string;
  /** Test hook. Production calls use the normal browser timer. */
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizedReferences(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

/** Polling is idempotent; these failures may safely retry against the same job ID. */
export function isRetryableRunpodSessionImagePollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /invalid image-generation task|proxy read timeout|\b(?:502|503|504|520|522|524)\b|fetch failed|econnreset|etimedout|socket hang up|network error/i.test(message);
}

export function normalizeRunpodSessionImageInput(input: RunpodSessionImageInput): RunpodSessionImageInput {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('Image prompt is required.');
  if (input.model !== 'sdxl' && input.model !== 'qwen-image-edit') {
    throw new Error('Choose a supported RunPod session image model.');
  }

  const referenceImages = normalizedReferences(input.referenceImages);
  if (input.model === 'sdxl') {
    if (referenceImages.length > 0) {
      throw new Error('SDXL Session is text-to-image and does not accept reference images.');
    }
    const negativePrompt = typeof input.negativePrompt === 'string'
      ? input.negativePrompt.trim()
      : '';
    const width = optionalFiniteNumber(input.width);
    const height = optionalFiniteNumber(input.height);
    const steps = optionalFiniteNumber(input.steps);
    const guidanceScale = optionalFiniteNumber(input.guidanceScale);
    const seed = optionalFiniteNumber(input.seed);
    return {
      model: input.model,
      prompt,
      ...(negativePrompt ? { negativePrompt } : {}),
      ...(width !== undefined ? { width: Math.round(width) } : {}),
      ...(height !== undefined ? { height: Math.round(height) } : {}),
      ...(steps !== undefined ? { steps: Math.round(steps) } : {}),
      ...(guidanceScale !== undefined ? { guidanceScale } : {}),
      ...(seed !== undefined && seed >= 0 ? { seed: Math.round(seed) } : {}),
    };
  }

  if (referenceImages.length === 0) {
    throw new Error('Qwen Image Edit Session requires at least one source image.');
  }
  if (referenceImages.length > 3) {
    throw new Error('Qwen Image Edit Session supports up to three reference images.');
  }
  const width = optionalFiniteNumber(input.width);
  const height = optionalFiniteNumber(input.height);
  const seed = optionalFiniteNumber(input.seed);
  return {
    model: input.model,
    prompt,
    referenceImages,
    ...(width !== undefined ? { width: Math.round(width) } : {}),
    ...(height !== undefined ? { height: Math.round(height) } : {}),
    ...(seed !== undefined && seed >= 0 ? { seed: Math.round(seed) } : {}),
  };
}

function sessionImageGenerator(): GenerateSessionImage {
  const pod = window.electronAPI?.pod as typeof window.electronAPI.pod & {
    generateSessionImage?: GenerateSessionImage;
  };
  if (!pod?.generateSessionImage) {
    throw new Error('RunPod session image generation is not available in this CineGen build.');
  }
  return pod.generateSessionImage.bind(pod);
}

function completedResult(
  response: RunpodSessionImageResponse,
  fallbackJobId?: string,
): RunpodSessionImageResult | null {
  if (response.status === 'failed') {
    throw new Error(response.error?.trim() || 'RunPod session image generation failed.');
  }
  if (response.status !== 'completed') return null;
  const url = response.output?.url?.trim();
  if (!url) throw new Error('RunPod finished without returning an image URL.');
  return {
    jobId: response.jobId || fallbackJobId || '',
    url,
    model: response.output?.model,
  };
}

export async function generateSessionImageAndWait(
  input: RunpodSessionImageInput,
  options: RunpodSessionImageClientOptions = {},
): Promise<RunpodSessionImageResult> {
  const podId = getRunpodLtxPodId();
  const podUrl = getRunpodLtxPodUrl();
  const podAuthToken = getRunpodLtxPodAuthToken();
  if (!podId || !podUrl || !podAuthToken) {
    throw new Error('Start a RunPod generation session in Settings before generating an image.');
  }

  const generate = sessionImageGenerator();
  const pod = { podId, podUrl, podAuthToken };
  const model = input.model;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  let jobId = options.resumeJobId?.trim() ?? '';
  let response: RunpodSessionImageResponse;

  if (jobId) {
    options.onJobId?.(jobId);
    try {
      response = await generate({ ...pod, model, jobId });
      const resumed = completedResult(response, jobId);
      if (resumed) return resumed;
    } catch (error) {
      if (!isRetryableRunpodSessionImagePollError(error)) throw error;
      response = { jobId, status: 'in_progress' };
    }
  } else {
    // Never retry an ambiguous initial submission: doing so could create a
    // second paid render if the first request reached the Pod before timing out.
    const normalizedInput = normalizeRunpodSessionImageInput(input);
    response = await generate({ ...pod, model: normalizedInput.model, input: normalizedInput });
    const immediate = completedResult(response);
    if (immediate) return immediate;

    jobId = response.jobId?.trim() ?? '';
    if (!jobId) throw new Error('RunPod accepted the image request but did not return a job ID.');
    options.onJobId?.(jobId);
  }

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    try {
      response = await generate({ ...pod, model, jobId });
    } catch (error) {
      if (isRetryableRunpodSessionImagePollError(error)) continue;
      throw error;
    }
    const completed = completedResult(response, jobId);
    if (completed) return completed;
  }

  throw new Error('RunPod is still generating the image after 30 minutes. The job may continue in RunPod.');
}
