import { getRunpodLtxPodAuthToken, getRunpodLtxPodId, getRunpodLtxPodUrl } from '@/lib/utils/api-key';

export interface RunpodLtx25Input {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  generateAudio: boolean;
  referenceImages?: string[];
}

export interface RunpodLtx25Result {
  jobId: string;
  url: string;
  durationSec?: number;
  model?: string;
}

interface RunpodLtx25Response {
  jobId?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  phase?: string;
  message?: string;
  output?: {
    url?: string;
    durationSec?: number;
    model?: string;
  };
  error?: string;
}

export interface RunpodLtx25StatusUpdate {
  jobId?: string;
  status: RunpodLtx25Response['status'];
  phase?: string;
  message?: string;
  elapsedMs: number;
}

type GenerateLtx25 = (params: {
  podId: string;
  podUrl: string;
  podAuthToken: string;
  input?: RunpodLtx25Input;
  jobId?: string;
}) => Promise<RunpodLtx25Response>;

export interface RunpodLtx25ClientOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onJobId?: (jobId: string) => void;
  onStatus?: (update: RunpodLtx25StatusUpdate) => void;
  /** Resume polling a previously submitted render without creating a second paid job. */
  resumeJobId?: string;
  /** Test hook. Production calls use the normal browser timer. */
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function isRetryableRunpodLtx25PollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /proxy read timeout|\b(?:502|503|504|520|522|524)\b|fetch failed|econnreset|etimedout|socket hang up|network error/i.test(message);
}

function ltx25Generator(): GenerateLtx25 {
  const pod = window.electronAPI?.pod as typeof window.electronAPI.pod & {
    generateLtx25?: GenerateLtx25;
  };
  if (!pod?.generateLtx25) {
    throw new Error('RunPod LTX-2.5 generation is not available in this CineGen build.');
  }
  return pod.generateLtx25.bind(pod);
}

function completedResult(response: RunpodLtx25Response, fallbackJobId?: string): RunpodLtx25Result | null {
  if (response.status === 'failed') {
    throw new Error(response.error?.trim() || 'RunPod LTX-2.5 generation failed.');
  }
  if (response.status !== 'completed') return null;
  const url = response.output?.url?.trim();
  if (!url) throw new Error('RunPod LTX-2.5 finished without returning a video URL.');
  return {
    jobId: response.jobId || fallbackJobId || '',
    url,
    durationSec: response.output?.durationSec,
    model: response.output?.model,
  };
}

export async function generateLtx25AndWait(
  input: RunpodLtx25Input,
  options: RunpodLtx25ClientOptions = {},
): Promise<RunpodLtx25Result> {
  const podId = getRunpodLtxPodId();
  const podUrl = getRunpodLtxPodUrl();
  const podAuthToken = getRunpodLtxPodAuthToken();
  if (!podId || !podUrl || !podAuthToken) {
    throw new Error('Start an LTX-2.5 Pod session in Settings before generating.');
  }

  const generate = ltx25Generator();
  const normalizedInput: RunpodLtx25Input = {
    ...input,
    prompt: input.prompt.trim(),
    referenceImages: input.referenceImages
      ? [...new Set(input.referenceImages.map((url) => url.trim()).filter(Boolean))]
      : undefined,
  };
  const pod = { podId, podUrl, podAuthToken };
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  let jobId = options.resumeJobId?.trim() ?? '';
  let response: RunpodLtx25Response;
  const notify = (next: RunpodLtx25Response, fallbackJobId?: string) => {
    options.onStatus?.({
      jobId: next.jobId?.trim() || fallbackJobId,
      status: next.status,
      phase: next.phase,
      message: next.message,
      elapsedMs: Date.now() - startedAt,
    });
  };
  const notifyChecking = (fallbackJobId: string, priorStatus: RunpodLtx25Response['status']) => {
    options.onStatus?.({
      jobId: fallbackJobId,
      status: priorStatus === 'queued' ? 'queued' : 'in_progress',
      phase: 'checking',
      message: 'Checking RunPod and receiving the finished video when it is ready…',
      elapsedMs: Date.now() - startedAt,
    });
  };

  if (jobId) {
    options.onJobId?.(jobId);
    notifyChecking(jobId, 'in_progress');
    try {
      response = await generate({ ...pod, jobId });
      notify(response, jobId);
      const resumed = completedResult(response, jobId);
      if (resumed) return resumed;
    } catch (error) {
      if (!isRetryableRunpodLtx25PollError(error)) throw error;
      response = { jobId, status: 'in_progress' };
      options.onStatus?.({
        jobId,
        status: 'in_progress',
        phase: 'retrying',
        message: 'RunPod connection paused; retrying this same render…',
        elapsedMs: Date.now() - startedAt,
      });
    }
  } else {
    options.onStatus?.({
      status: 'queued',
      phase: 'submitting',
      message: 'Submitting one LTX-2.5 render…',
      elapsedMs: 0,
    });
    response = await generate({ ...pod, input: normalizedInput });
    jobId = response.jobId?.trim() ?? '';
    notify(response, jobId);
    const immediate = completedResult(response);
    if (immediate) return immediate;
    if (!jobId) throw new Error('RunPod accepted the request but did not return a job ID.');
    options.onJobId?.(jobId);
  }

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    notifyChecking(jobId, response.status);
    try {
      response = await generate({ ...pod, jobId });
    } catch (error) {
      // Polls are idempotent. A proxy/network timeout must never submit a
      // second paid render or discard the existing remote job identifier.
      if (isRetryableRunpodLtx25PollError(error)) {
        options.onStatus?.({
          jobId,
          status: 'in_progress',
          phase: 'retrying',
          message: 'RunPod connection paused; retrying this same render…',
          elapsedMs: Date.now() - startedAt,
        });
        continue;
      }
      throw error;
    }
    notify(response, jobId);
    const completed = completedResult(response, jobId);
    if (completed) return completed;
  }

  throw new Error('RunPod LTX-2.5 is still generating after 30 minutes. The job may continue in RunPod.');
}
