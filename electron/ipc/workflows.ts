import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateHiggsfield,
  type HiggsfieldGenerateParams,
  type HiggsfieldMedia,
  type HiggsfieldOutputKind,
  type HiggsfieldResult,
} from './higgsfield.js';

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

// --- Higgsfield client wrapper ---

const HIGGSFIELD_MEDIA_ROLES = new Set<HiggsfieldMedia['role']>([
  'image', 'start_image', 'end_image', 'video', 'audio',
]);

const HIGGSFIELD_MEDIA_PARAM_ROLES: Record<string, HiggsfieldMedia['role'] | 'legacy-image'> = {
  // Exact CLI role keys and their common URL aliases.
  image: 'image',
  start_image: 'start_image',
  start_image_url: 'start_image',
  end_image: 'end_image',
  end_image_url: 'end_image',
  video: 'video',
  video_url: 'video',
  audio: 'audio',
  audio_url: 'audio',

  // Model-schema media params returned by `higgsfield model get`.
  input_images: 'image',
  input_image: 'image',
  input_video: 'video',
  input_audio: 'audio',
  sketch: 'image',
  ref_image: 'image',
  urls: 'video',

  // Legacy CineGen fields. Video nodes historically treat these as first-frame inputs.
  image_url: 'legacy-image',
  imageUrl: 'legacy-image',
  image_urls: 'legacy-image',
};

function localMediaPath(value: string): string {
  if (!value.startsWith('local-media://file')) return value;
  try {
    return decodeURIComponent(value.slice('local-media://file'.length));
  } catch {
    return value.slice('local-media://file'.length);
  }
}

function mediaRoleFromValue(
  value: Record<string, unknown>,
  fallback: HiggsfieldMedia['role'],
): { role: HiggsfieldMedia['role']; explicit: boolean } {
  const explicitRole = value.role ?? value.media_role ?? value.mediaRole;
  if (typeof explicitRole === 'string' && HIGGSFIELD_MEDIA_ROLES.has(explicitRole as HiggsfieldMedia['role'])) {
    return { role: explicitRole as HiggsfieldMedia['role'], explicit: true };
  }
  const kind = String(value.type ?? value.kind ?? value.media_type ?? value.mediaType ?? value.mime_type ?? '').toLowerCase();
  if (kind === 'start_image' || kind === 'start-image') return { role: 'start_image', explicit: true };
  if (kind === 'end_image' || kind === 'end-image') return { role: 'end_image', explicit: true };
  if (kind.includes('audio')) return { role: 'audio', explicit: true };
  if (kind.includes('video')) return { role: 'video', explicit: true };
  if (kind.includes('image')) return { role: 'image', explicit: true };
  return { role: fallback, explicit: false };
}

function inferMediaRoleFromReference(
  value: string,
  fallback: HiggsfieldMedia['role'],
): HiggsfieldMedia['role'] {
  const normalized = value.split(/[?#]/, 1)[0].toLowerCase();
  if (normalized.startsWith('data:audio/') || /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/.test(normalized)) {
    return 'audio';
  }
  if (normalized.startsWith('data:video/') || /\.(?:avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/.test(normalized)) {
    return 'video';
  }
  return fallback;
}

function fallbackMediaRoleForOutput(outputKind: HiggsfieldOutputKind): HiggsfieldMedia['role'] {
  if (outputKind === 'video') return 'start_image';
  if (outputKind === 'text') return 'video';
  if (outputKind === 'audio') return 'audio';
  return 'image';
}

function mediaReferencesFromValue(
  value: unknown,
  fallbackRole: HiggsfieldMedia['role'],
  inferRoleFromExtension = false,
): HiggsfieldMedia[] {
  if (typeof value === 'string') {
    const normalized = localMediaPath(value).trim();
    const role = inferRoleFromExtension
      ? inferMediaRoleFromReference(normalized, fallbackRole)
      : fallbackRole;
    return normalized ? [{ value: normalized, role }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => mediaReferencesFromValue(entry, fallbackRole, inferRoleFromExtension));
  }
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const roleDescriptor = mediaRoleFromValue(record, fallbackRole);
  if (Array.isArray(record.allUrls)) {
    return record.allUrls.flatMap((entry) => mediaReferencesFromValue(
      entry,
      roleDescriptor.role,
      inferRoleFromExtension && !roleDescriptor.explicit,
    ));
  }

  const candidate = record.value
    ?? record.url
    ?? record.fileRef
    ?? record.path
    ?? record.id
    ?? record.uuid
    ?? record.media_id
    ?? record.mediaId
    ?? record.frontalImageUrl;
  return mediaReferencesFromValue(
    candidate,
    roleDescriptor.role,
    inferRoleFromExtension && !roleDescriptor.explicit,
  );
}

/**
 * Split schema-driven workflow inputs into CLI media flags and ordinary `--name value` params.
 * Kept pure/exported so the complete provider contract is covered without spawning the CLI.
 */
export function buildHiggsfieldWorkflowRequest(
  model: string,
  input: Record<string, unknown>,
  outputKind: HiggsfieldOutputKind,
): HiggsfieldGenerateParams {
  const medias: HiggsfieldMedia[] = [];
  const genericParams: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;

    if (key === 'medias' || key === 'higgsfield_media_inputs') {
      medias.push(...mediaReferencesFromValue(
        value,
        fallbackMediaRoleForOutput(outputKind),
        true,
      ));
      continue;
    }

    const mappedRole = HIGGSFIELD_MEDIA_PARAM_ROLES[key];
    if (mappedRole) {
      const role = mappedRole === 'legacy-image'
        ? (outputKind === 'video' ? 'start_image' : 'image')
        : mappedRole;
      medias.push(...mediaReferencesFromValue(value, role));
      continue;
    }

    // Every non-null schema parameter is forwarded verbatim. The CLI transport owns JSON
    // serialization for arrays/objects and preserves false/zero scalar values.
    genericParams[key] = value;
  }

  return {
    model,
    mediaType: outputKind,
    ...(medias.length > 0 ? { medias } : {}),
    ...(Object.keys(genericParams).length > 0 ? { params: genericParams } : {}),
  };
}

export function normalizeHiggsfieldWorkflowResult(
  result: HiggsfieldResult,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (result.url) output.url = result.url;
  if (result.urls) output.urls = result.urls;
  if (result.text) output.text = result.text;
  if (result.durationSec !== undefined) output.duration = result.durationSec;

  return {
    output,
    ...(result.url ? { url: result.url } : {}),
    ...(result.urls ? { urls: result.urls } : {}),
    ...(result.text ? { text: result.text } : {}),
    ...(result.jobId ? { jobId: result.jobId } : {}),
    model: result.model,
    mediaType: result.mediaType,
    outputKind: result.outputKind,
  };
}

async function generateWithHiggsfield(
  model: string,
  input: Record<string, unknown>,
  outputKind: HiggsfieldOutputKind,
): Promise<Record<string, unknown>> {
  const result = await generateHiggsfield(buildHiggsfieldWorkflowRequest(model, input, outputKind));
  return normalizeHiggsfieldWorkflowResult(result);
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
    outputType?: HiggsfieldOutputKind;
    inputs: Record<string, unknown>;
  }) => {
    const {
      apiKey, kieKey, runpodKey, runpodEndpointId, podUrl,
      nodeId, nodeType, modelId, outputType: requestedOutputType, inputs: rawInputs,
    } = params;

    // Dynamically import models registry
    const { ALL_MODELS, resolveVideoModelEndpoint, sanitizeVideoInputsForEndpoint } = await import('../../src/lib/fal/models.js');

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
        configureFal(key);
        const inputs = await resolveLocalMediaUrls(rawInputs);
        const result = await generateWithFal(modelId, inputs, key);
        const data = (result as Record<string, unknown>).data ?? result;
        return data;
      }
      throw new Error(`Unknown model: ${modelId}`);
    }

    const provider = (modelDef as { provider?: string }).provider;
    let inputs = rawInputs;
    if (provider !== 'higgsfield') {
      // Non-Higgsfield cloud providers require HTTPS inputs. Higgsfield instead receives local
      // paths directly through its CLI media flags, where the CLI performs its own upload.
      if (apiKey) configureFal(apiKey);
      inputs = await resolveLocalMediaUrls(rawInputs);
    }

    // Use the passed modelId (which may be altId for edit endpoints) if it looks like an API path,
    // otherwise fall back to the model definition's id
    let apiModelId = modelId.includes('/') ? modelId : (modelDef as { id: string }).id;
    const registryNodeType = (modelDef as { nodeType?: string }).nodeType ?? modelId;
    const hasImageInputs = Object.keys(inputs).some((key) =>
      key === 'image_url' || key === 'start_image_url' || key === 'image_urls' || key === 'imageUrl',
    );
    apiModelId = resolveVideoModelEndpoint(registryNodeType, modelDef as { id: string; altId?: string }, {
      hasImageInputs,
      quality: inputs.quality as string | undefined,
    });
    sanitizeVideoInputsForEndpoint(registryNodeType, apiModelId, inputs);

    let result: unknown;

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
    } else if (provider === 'higgsfield') {
      // The higgsfield CLI owns auth (device login); no token is threaded here. A "session expired"
      // CLI error surfaces as a connect-Higgsfield message from runHiggsfieldCli.
      const registryOutputType = (modelDef as { outputType?: string }).outputType;
      const outputKind: HiggsfieldOutputKind = requestedOutputType
        ?? (registryOutputType === 'video'
          ? 'video'
          : registryOutputType === 'audio'
            ? 'audio'
            : registryOutputType === 'text'
              ? 'text'
              : registryOutputType === '3d' || registryOutputType === 'model3d' || registryOutputType === 'model'
                ? '3d'
                : 'image');
      result = await generateWithHiggsfield(apiModelId, inputs, outputKind);
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
