// electron/ipc/higgsfield.ts
//
// Phase 0.2 — shared Higgsfield generation client (native REST). One service backs Spaces nodes,
// the Quick Edit modal, and the copilot agent; they differ only in how they gather inputs and where
// they place outputs.
//
// The request-building and response-parsing logic is PURE and unit-tested (see
// tests/lib/higgsfield/client.test.ts). The network submit/poll/cancel uses fetch and is mockable.
//
// NOTE (needs confirmation against the live API): the exact REST paths, auth header, and response
// envelope below are modeled on the RunPod-style submit→poll→result shape used elsewhere in this
// file's sibling providers. Verify against Higgsfield's actual API and adjust HIGGSFIELD_BASE / the
// endpoint paths / parseJobStatus if they differ. The pure helpers are written so only the constants
// and the parse map need touching.

export const HIGGSFIELD_BASE = 'https://api.higgsfield.ai/v1';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200;

export type HiggsfieldMediaType = 'image' | 'video';

export interface HiggsfieldGenerateParams {
  model: string;                 // Higgsfield model id (e.g. 'seedance-2', 'soul-v2')
  prompt: string;
  mediaType: HiggsfieldMediaType;
  imageUrls?: string[];          // reference image(s) — single frame, or first/last pair
  aspectRatio?: string;          // e.g. '16:9'
  durationSec?: number;          // for video
  extra?: Record<string, unknown>;
}

export interface HiggsfieldResult {
  url: string;
  mediaType: HiggsfieldMediaType;
  durationSec?: number;
  jobId?: string;
  model: string;
}

export type HiggsfieldJobState = 'queued' | 'running' | 'completed' | 'failed';

export interface HiggsfieldJobStatus {
  state: HiggsfieldJobState;
  url?: string;
  durationSec?: number;
  error?: string;
}

// --- Pure helpers (unit-tested) -------------------------------------------------

/** Build the submit request body from generation params. Pure. */
export function buildSubmitBody(params: HiggsfieldGenerateParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt.trim(),
    type: params.mediaType,
  };
  if (params.imageUrls && params.imageUrls.length > 0) body.image_urls = params.imageUrls;
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (typeof params.durationSec === 'number' && params.durationSec > 0) body.duration = params.durationSec;
  if (params.extra) Object.assign(body, params.extra);
  return body;
}

/** Parse a poll response into a normalized job status. Pure. Tolerant of envelope shape. */
export function parseJobStatus(raw: unknown): HiggsfieldJobStatus {
  if (!raw || typeof raw !== 'object') return { state: 'running' };
  const r = raw as Record<string, unknown>;
  // Allow either a top-level record or a { data: {...} } envelope.
  const record = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>;

  const rawState = String(record.state ?? record.status ?? '').toLowerCase();
  const url = extractMediaUrl(record);

  if (rawState === 'completed' || rawState === 'success' || rawState === 'succeeded' || (url && (rawState === '' || rawState === 'done'))) {
    return {
      state: 'completed',
      url,
      durationSec: typeof record.duration === 'number' ? record.duration : undefined,
    };
  }
  if (rawState === 'failed' || rawState === 'error' || rawState === 'fail') {
    return { state: 'failed', error: typeof record.error === 'string' ? record.error : (typeof record.message === 'string' ? record.message : 'Higgsfield generation failed') };
  }
  if (rawState === 'queued' || rawState === 'pending') return { state: 'queued' };
  return { state: 'running' };
}

/** Pull a media URL out of a variety of plausible response shapes. Pure. */
export function extractMediaUrl(record: Record<string, unknown>): string | undefined {
  const direct = record.url ?? record.video_url ?? record.image_url ?? record.output_url ?? record.result_url;
  if (typeof direct === 'string' && direct) return direct;
  const output = record.output ?? record.result;
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    const nested = o.url ?? o.video_url ?? o.image_url;
    if (typeof nested === 'string' && nested) return nested;
  }
  if (Array.isArray(record.outputs) && record.outputs.length > 0) {
    const first = record.outputs[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const u = (first as Record<string, unknown>).url;
      if (typeof u === 'string') return u;
    }
  }
  return undefined;
}

// --- Network client (mockable) --------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Submit a generation job and return its job id. */
export async function submitHiggsfieldJob(params: HiggsfieldGenerateParams, token: string): Promise<string> {
  const res = await fetch(`${HIGGSFIELD_BASE}/generate`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(buildSubmitBody(params)),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).message || `Higgsfield error ${res.status}`);
  }
  const data = await res.json() as Record<string, unknown>;
  const record = (data.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
  const jobId = record.job_id ?? record.id ?? record.task_id;
  if (typeof jobId !== 'string' || !jobId) throw new Error('Higgsfield did not return a job id');
  return jobId;
}

/** Poll a job until it completes or fails. */
export async function pollHiggsfieldJob(
  jobId: string,
  params: HiggsfieldGenerateParams,
  token: string,
): Promise<HiggsfieldResult> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${HIGGSFIELD_BASE}/jobs/${jobId}`, { headers: authHeaders(token) });
    if (!res.ok) continue;
    const status = parseJobStatus(await res.json());
    if (status.state === 'completed') {
      if (!status.url) throw new Error('Higgsfield completed without a media URL');
      return { url: status.url, mediaType: params.mediaType, durationSec: status.durationSec, jobId, model: params.model };
    }
    if (status.state === 'failed') throw new Error(status.error || 'Higgsfield generation failed');
  }
  throw new Error('Higgsfield generation timed out');
}

/** Submit + poll convenience. */
export async function generateHiggsfield(params: HiggsfieldGenerateParams, token: string): Promise<HiggsfieldResult> {
  const jobId = await submitHiggsfieldJob(params, token);
  return pollHiggsfieldJob(jobId, params, token);
}

/** Cancel an in-flight job (best-effort). */
export async function cancelHiggsfieldJob(jobId: string, token: string): Promise<void> {
  await fetch(`${HIGGSFIELD_BASE}/jobs/${jobId}/cancel`, { method: 'POST', headers: authHeaders(token) }).catch(() => {});
}
