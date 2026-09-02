import type { TopviewVideoTaskState } from '@/types/workflow';

export interface TopviewVideoRequest {
  prompt: string;
  model?: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  medias?: Array<{ value: string; role?: string }>;
}

export interface TopviewVideoTaskQuery extends TopviewVideoTaskState {
  status: 'init' | 'running' | 'success' | 'fail';
  url?: string;
  error?: string;
}

export interface TopviewVideoTaskClient {
  submit: (request: TopviewVideoRequest) => Promise<TopviewVideoTaskState>;
  query: (task: TopviewVideoTaskState) => Promise<TopviewVideoTaskQuery>;
}

export interface TopviewVideoResult {
  url: string;
  mediaType: 'video';
  durationSec?: number;
  taskId?: string;
  boardUrl?: string;
  model?: string;
}

export interface RunTopviewVideoTaskOptions {
  resumeTask?: unknown;
  onTask?: (task: TopviewVideoTaskState) => void;
  onStatus?: (query: TopviewVideoTaskQuery, task: TopviewVideoTaskState) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

// Topview queues can outlive the old 20-minute synchronous IPC timeout. Keep
// polling for a practical upper bound, then leave the task persisted for a
// later query instead of ever paying for the same render twice.
export const TOPVIEW_VIDEO_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const TOPVIEW_VIDEO_POLL_INTERVAL_MS = 5_000;

const TOPVIEW_TASK_TYPES = new Set<TopviewVideoTaskState['taskType']>([
  'text_to_video',
  'image_to_video',
  'omni_reference',
]);

export function normalizeTopviewVideoTask(value: unknown): TopviewVideoTaskState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : '';
  const taskType = typeof record.taskType === 'string'
    && TOPVIEW_TASK_TYPES.has(record.taskType as TopviewVideoTaskState['taskType'])
    ? record.taskType as TopviewVideoTaskState['taskType']
    : undefined;
  const boardId = typeof record.boardId === 'string' && record.boardId.trim()
    ? record.boardId.trim()
    : undefined;
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  // Fixed-length models (Gemini Omni Flash, Kling Omni, Grok Video Edit) never report a
  // duration. Requiring one here discarded the task ID of a render Topview had already
  // accepted and charged for, so the poll never started and the video was never claimed.
  const duration = Number(record.durationSec);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : undefined;
  if (!taskId || !taskType || !model) return undefined;
  const boardUrl = typeof record.boardUrl === 'string' && record.boardUrl.trim()
    ? record.boardUrl.trim()
    : undefined;
  return {
    taskId,
    taskType,
    model,
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(boardId ? { boardId } : {}),
    ...(boardUrl ? { boardUrl } : {}),
  };
}

export class TopviewVideoTaskFailedError extends Error {
  readonly task: TopviewVideoTaskState;

  constructor(message: string, task: TopviewVideoTaskState) {
    super(message);
    this.name = 'TopviewVideoTaskFailedError';
    this.task = task;
  }
}

export class TopviewVideoTaskPendingError extends Error {
  readonly task: TopviewVideoTaskState;

  constructor(task: TopviewVideoTaskState) {
    super(`Topview is still processing task ${task.taskId}. Run this node again to resume checking the same render; it will not be submitted twice.`);
    this.name = 'TopviewVideoTaskPendingError';
    this.task = task;
  }
}

export function isTopviewVideoTaskFailedError(error: unknown): boolean {
  return error instanceof TopviewVideoTaskFailedError
    || (Boolean(error) && typeof error === 'object' && (error as { name?: unknown }).name === 'TopviewVideoTaskFailedError');
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/** Submit once or resume an existing task, polling until Topview exposes its media URL. */
export async function runTopviewVideoTask(
  client: TopviewVideoTaskClient,
  request: TopviewVideoRequest,
  options: RunTopviewVideoTaskOptions = {},
): Promise<TopviewVideoResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? TOPVIEW_VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = options.pollTimeoutMs ?? TOPVIEW_VIDEO_POLL_TIMEOUT_MS;
  const resumedTask = normalizeTopviewVideoTask(options.resumeTask);
  const initialTask = resumedTask ?? normalizeTopviewVideoTask(await client.submit(request));
  if (!initialTask) throw new Error('Topview did not return complete task details for this video.');
  let task: TopviewVideoTaskState = initialTask;
  options.onTask?.(task);

  const startedAt = now();
  for (;;) {
    const query = await client.query(task);
    const updatedTask = normalizeTopviewVideoTask({ ...task, ...query }) ?? task;
    task = updatedTask;
    options.onStatus?.(query, task);

    if (query.status === 'fail') {
      throw new TopviewVideoTaskFailedError(query.error ?? 'Topview could not complete this video.', task);
    }
    const url = typeof query.url === 'string' ? query.url.trim() : '';
    if (query.status === 'success') {
      if (!url) {
        throw new TopviewVideoTaskFailedError('Topview completed the task without returning a video URL.', task);
      }
      return {
        url,
        mediaType: 'video',
        ...(task.durationSec !== undefined ? { durationSec: task.durationSec } : {}),
        taskId: task.taskId,
        model: task.model,
        ...(task.boardUrl ? { boardUrl: task.boardUrl } : {}),
      };
    }
    if (now() - startedAt >= pollTimeoutMs) {
      throw new TopviewVideoTaskPendingError(task);
    }
    await sleep(Math.max(0, pollIntervalMs));
  }
}
