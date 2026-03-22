import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// --- kie.ai client (moved from lib/kie/client.ts) ---

const KIE_BASE = 'https://api.kie.ai/api/v1';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;

const DEDICATED_ENDPOINTS: Record<string, string> = {
  'runway': `${KIE_BASE}/runway/generate`,
  'veo': `${KIE_BASE}/veo/generate`,
  '4o-image': `${KIE_BASE}/gpt4o-image/generate`,
  'suno-music': `${KIE_BASE}/generate`,
};

function getDedicatedEndpoint(model: string): string | undefined {
  for (const [prefix, endpoint] of Object.entries(DEDICATED_ENDPOINTS)) {
    if (model.startsWith(prefix)) return endpoint;
  }
  return undefined;
}

async function submitKieTask(
  model: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<string> {
  const dedicatedUrl = getDedicatedEndpoint(model);
  const url = dedicatedUrl ?? `${KIE_BASE}/jobs/createTask`;
  const body = dedicatedUrl
    ? { ...input, callBackUrl: '' }
    : { model, input, callBackUrl: '' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).msg || `kie.ai error ${res.status}`);
  }

  const data = await res.json();
  if ((data as Record<string, unknown>).code !== 200) {
    throw new Error((data as Record<string, string>).msg || 'Failed to create kie.ai task');
  }

  return (data as { data: { taskId: string } }).data.taskId;
}

async function pollKieResult(taskId: string, apiKey: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) continue;

    const data = await res.json();
    const record = (data as { data: { state: string; resultJson: string; failMsg: string } }).data;

    if (record.state === 'success') {
      try {
        return JSON.parse(record.resultJson) as Record<string, unknown>;
      } catch {
        return record as unknown as Record<string, unknown>;
      }
    }

    if (record.state === 'fail') {
      throw new Error(record.failMsg || 'kie.ai generation failed');
    }
  }

  throw new Error('kie.ai generation timed out');
}

async function generateWithKie(
  model: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const taskId = await submitKieTask(model, input, apiKey);
  return await pollKieResult(taskId, apiKey);
}

// --- RunPod client ---

const RUNPOD_BASE = 'https://api.runpod.ai/v2';
const RUNPOD_POLL_INTERVAL_MS = 3000;
const RUNPOD_MAX_POLL_ATTEMPTS = 120;

async function generateWithRunpod(
  endpointId: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  if (!endpointId) throw new Error('No RunPod endpoint ID configured for this model. Set it in the model definition.');

  const runRes = await fetch(`${RUNPOD_BASE}/${endpointId}/run`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!runRes.ok) {
    const err = await runRes.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).error || `RunPod error ${runRes.status}`);
  }

  const { id: jobId } = await runRes.json() as { id: string };

  for (let i = 0; i < RUNPOD_MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, RUNPOD_POLL_INTERVAL_MS));

    const statusRes = await fetch(`${RUNPOD_BASE}/${endpointId}/status/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) continue;

    const data = await statusRes.json() as { status: string; output?: Record<string, unknown>; error?: string };

    if (data.status === 'COMPLETED') {
      const out = data.output as Record<string, unknown> | undefined;

      // If the output contains a base64 image, save it to a temp file and return a local-media:// URL
      const b64 = (out?.image_url ?? out?.image) as string | undefined;
      if (b64 && !b64.startsWith('http') && !b64.startsWith('local-media://')) {
        const base64Data = b64.includes(',') ? b64.split(',')[1] : b64;
        const tmpPath = path.join(os.tmpdir(), `cinegen-runpod-${Date.now()}.png`);
        await fs.writeFile(tmpPath, Buffer.from(base64Data, 'base64'));
        return { output: { ...out, image_url: `local-media://file${tmpPath}` } };
      }

      return { output: out };
    }

    if (data.status === 'FAILED') {
      throw new Error(data.error || 'RunPod job failed');
    }
  }

  throw new Error('RunPod job timed out');
}

// --- CineGen Pod client ---

async function generateWithPod(
  podUrl: string,
  route: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${podUrl.replace(/\/$/, '')}/generate/${route}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail || `Pod error ${res.status}`);
  }
  return await res.json() as Record<string, unknown>;
}

async function podAction(
  runpodKey: string,
  podId: string,
  action: 'start' | 'stop',
): Promise<Record<string, unknown>> {
  const url = `https://api.runpod.io/graphql?api_key=${runpodKey}`;
  const mutation = action === 'start'
    ? `mutation { podResume(input: { podId: "${podId}" }) { id desiredStatus } }`
    : `mutation { podStop(input: { podId: "${podId}" }) { id desiredStatus } }`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: mutation }),
  });
  const data = await res.json() as Record<string, unknown>;
  if ((data as { errors?: unknown }).errors) {
    throw new Error(`RunPod pod ${action} failed: ${JSON.stringify((data as { errors: unknown }).errors)}`);
  }
  return data;
}

async function getPodStatus(
  runpodKey: string,
  podId: string,
): Promise<{ status: string; ip: string | null; port: number | null }> {
  const url = `https://api.runpod.io/graphql?api_key=${runpodKey}`;
  const query = `{ pod(input: { podId: "${podId}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await res.json() as {
    data?: {
      pod?: {
        desiredStatus: string;
        runtime?: { ports?: Array<{ ip: string; isIpPublic: boolean; privatePort: number; publicPort: number; type: string }> };
      };
    };
  };

  const pod = data.data?.pod;
  if (!pod) throw new Error('Pod not found');

  const httpPort = pod.runtime?.ports?.find((p) => p.privatePort === 8000 && p.isIpPublic);
  return {
    status: pod.desiredStatus,
    ip: httpPort?.ip ?? null,
    port: httpPort?.publicPort ?? null,
  };
}

// --- fal.ai client (moved from lib/fal/client.ts) ---

function configureFal(key: string) {
  fal.config({ credentials: key });
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  };
  return types[ext] ?? 'application/octet-stream';
}

/**
 * Upload a local-media:// URL to fal storage, returning an HTTPS URL.
 */
async function uploadLocalMedia(localUrl: string): Promise<string> {
  const fsPath = decodeURIComponent(localUrl.replace('local-media://file', ''));
  const buffer = await fs.readFile(fsPath);
  const type = guessContentType(fsPath);
  const blob = new Blob([buffer], { type });
  const file = new File([blob], path.basename(fsPath), { type });
  return fal.storage.upload(file);
}

/**
 * Recursively resolve all local-media:// URLs in workflow inputs to HTTPS URLs
 * by uploading them to fal storage.
 */
async function resolveLocalMediaUrls(
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === 'string' && value.startsWith('local-media://file')) {
      resolved[key] = await uploadLocalMedia(value);
    } else if (Array.isArray(value)) {
      resolved[key] = await Promise.all(
        value.map(async (item) => {
          if (typeof item === 'string' && item.startsWith('local-media://file')) {
            return uploadLocalMedia(item);
          }
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return resolveLocalMediaUrls(item as Record<string, unknown>);
          }
          return item;
        }),
      );
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      resolved[key] = await resolveLocalMediaUrls(value as Record<string, unknown>);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

async function generateWithFal(
  model: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<unknown> {
  configureFal(apiKey);
  console.log('[fal] Calling model:', model, 'with input:', JSON.stringify(input, null, 2));
  try {
    return await fal.subscribe(model, { input, logs: true });
  } catch (err: any) {
    console.error('[fal] Error details:', JSON.stringify(err?.body ?? err, null, 2));
    if (err?.body?.detail) {
      console.error('[fal] Validation errors:', JSON.stringify(err.body.detail, null, 2));
    }
    throw err;
  }
}

// --- IPC handler ---

export function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:run', async (_event, params: {
    apiKey?: string;
    kieKey?: string;
    runpodKey?: string;
    runpodEndpointId?: string;
    podUrl?: string;
    nodeId: string;
    nodeType: string;
    modelId: string;
    inputs: Record<string, unknown>;
  }) => {
    const { apiKey, kieKey, runpodKey, runpodEndpointId, podUrl, nodeId, nodeType, modelId, inputs: rawInputs } = params;

    // Upload any local-media:// URLs to fal storage before sending to cloud APIs
    if (apiKey) configureFal(apiKey);
    const inputs = await resolveLocalMediaUrls(rawInputs);

    // Dynamically import models registry
    const { ALL_MODELS } = await import('../../src/lib/fal/models.js');

    // Look up by registry key first, then by m.id / m.altId
    const modelDef = (ALL_MODELS as Record<string, { id: string; altId?: string; nodeType?: string; provider?: string }>)[modelId]
      ?? Object.values(ALL_MODELS).find(
        (m: { id: string; altId?: string; nodeType?: string }) =>
          m.id === modelId || m.altId === modelId || m.nodeType === modelId,
      );

    if (!modelDef) {
      if (modelId.startsWith('fal-ai/')) {
        const key = apiKey;
        if (!key) throw new Error('No fal.ai API key provided. Add one in Settings.');
        const result = await generateWithFal(modelId, inputs, key);
        const data = (result as Record<string, unknown>).data ?? result;
        return data;
      }
      throw new Error(`Unknown model: ${modelId}`);
    }

    // Use the passed modelId (which may be altId for edit endpoints) if it looks like an API path,
    // otherwise fall back to the model definition's id
    const apiModelId = modelId.includes('/') ? modelId : (modelDef as { id: string }).id;

    let result: unknown;

    const provider = (modelDef as { provider?: string }).provider;

    if (provider === 'kie') {
      const key = kieKey;
      if (!key) throw new Error('No kie.ai API key provided. Add one in Settings.');
      result = await generateWithKie(apiModelId, inputs, key);
    } else if (provider === 'pod') {
      if (!podUrl) throw new Error('No pod URL configured. Start your pod and set the URL in Settings.');
      const route = (modelDef as { podRoute?: string }).podRoute ?? apiModelId;
      result = await generateWithPod(podUrl, route, inputs);
    } else if (provider === 'runpod') {
      const key = runpodKey;
      if (!key) throw new Error('No RunPod API key provided. Add one in Settings.');
      const endpointId = runpodEndpointId || (modelDef as { runpodEndpointId?: string }).runpodEndpointId || '';
      result = await generateWithRunpod(endpointId, inputs, key);
    } else {
      const key = apiKey;
      if (!key) throw new Error('No fal.ai API key provided. Add one in Settings.');
      result = await generateWithFal(apiModelId, inputs, key);
    }

    const data = (result as Record<string, unknown>).data ?? result;
    return data;
  });

  // Job polling (replaces /api/jobs/[id])
  const jobStore = new Map<string, { status: string; result?: unknown }>();

  ipcMain.handle('workflow:poll-job', async (_event, id: string) => {
    const job = jobStore.get(id);
    if (!job) throw new Error('Job not found');
    return job;
  });

  ipcMain.handle('pod:start', async (_event, params: { runpodKey: string; podId: string }) => {
    return await podAction(params.runpodKey, params.podId, 'start');
  });

  ipcMain.handle('pod:stop', async (_event, params: { runpodKey: string; podId: string }) => {
    return await podAction(params.runpodKey, params.podId, 'stop');
  });

  ipcMain.handle('pod:status', async (_event, params: { runpodKey: string; podId: string }) => {
    return await getPodStatus(params.runpodKey, params.podId);
  });
}
