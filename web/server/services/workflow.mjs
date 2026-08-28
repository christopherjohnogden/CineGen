import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityUnavailableError,
  ServiceError,
  createFalSubscriber,
  fetchJson,
  isPlainRecord,
  normalizeCloudInputs,
  optionalSecret,
  requireRecord,
  requireSecret,
  requireString,
  validateModelId,
  validatePublicUrl,
  validateRoute,
} from './_shared.mjs';
import { createRunpodLtx25Handlers } from './runpod-ltx25.mjs';

const KIE_BASE_URL = 'https://api.kie.ai/api/v1';
const RUNPOD_SERVERLESS_URL = 'https://api.runpod.ai/v2';
const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DATA_ROOT = path.join(WEB_ROOT, '.data');
const MAX_DIRECT_FAL_UPLOAD_BYTES = 90 * 1024 * 1024;

const MEDIA_TYPES = Object.freeze({
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
});

const KIE_MODELS = Object.freeze({
  'kie-runway': 'runway',
  'kie-veo3': 'veo',
  'kie-flux2': 'flux-2/pro-text-to-image',
  'kie-4o-image': '4o-image',
  'kie-wan': 'wan/2-6-flash-image-to-video',
  'kie-kling3': 'kling-3.0/video',
  'kie-nano-banana-pro': 'nano-banana-pro',
  'kie-nano-banana-2': 'nano-banana-2',
  'kie-seedance2': 'bytedance/seedance-2-image-to-video',
  'kie-suno-music': 'suno-music',
});

const KIE_DEDICATED_ENDPOINTS = Object.freeze({
  runway: `${KIE_BASE_URL}/runway/generate`,
  veo: `${KIE_BASE_URL}/veo/generate`,
  '4o-image': `${KIE_BASE_URL}/gpt4o-image/generate`,
  'suno-music': `${KIE_BASE_URL}/generate`,
});

const RUNPOD_DEFAULT_ENDPOINTS = Object.freeze({
  'runpod-sdxl': '2urujiktqqceer',
  'runpod-ltx-video': '',
  'runpod-wan-t2v': '',
  'runpod-wan-i2v': '',
  'runpod-qwen-image-edit': 'qwen_image_edit_2511_v1.1',
  'runpod-flux-dev': '',
  'runpod-qwen-image': '',
});

const POD_ROUTES = Object.freeze({
  'pod-sdxl': 'sdxl',
  'pod-flux': 'flux',
  'pod-qwen-edit': 'qwen-edit',
  'pod-ltx': 'ltx',
  'pod-wan-t2v': 'wan-t2v',
  'pod-wan-i2v': 'wan-i2v',
});

const LOCAL_NODE_TYPES = new Set([
  'ltx-local',
  'qwen-edit-local',
  'layer-decompose',
  'sam3-segment',
  'whisperx-local',
]);

const HIGGSFIELD_OUTPUT_TYPES = new Set(['image', 'video', 'audio', 'text', '3d']);
const HIGGSFIELD_OUTPUT_BY_MODEL = Object.freeze({
  text2image_soul_v2: 'image',
  nano_banana_2: 'image',
  gpt_image_2: 'image',
  soul_cast: 'image',
  seedance_2_0: 'video',
  kling3_0: 'video',
  veo3_1: 'video',
});
const HIGGSFIELD_OUTPUT_BY_NODE = Object.freeze({
  'hf-soul-v2': 'image',
  'hf-nano-banana-pro': 'image',
  'hf-gpt-image-2': 'image',
  'hf-seedance-2': 'video',
  'hf-kling-3': 'video',
  'hf-veo-3-1': 'video',
});

function getKieModel(nodeType, modelId) {
  if (KIE_MODELS[nodeType]) return KIE_MODELS[nodeType];
  return Object.values(KIE_MODELS).find((candidate) => candidate === modelId);
}

function getProvider(nodeType, modelId) {
  if (LOCAL_NODE_TYPES.has(nodeType) || nodeType.endsWith('-local')) return 'local';
  if (nodeType.startsWith('hf-')) return 'higgsfield';
  if (nodeType.startsWith('kie-') || getKieModel(nodeType, modelId)) return 'kie';
  if (nodeType.startsWith('runpod-') || modelId.startsWith('runpod-')) return 'runpod';
  if (nodeType.startsWith('pod-') || modelId.startsWith('pod-')) return 'pod';
  if (modelId.startsWith('fal-ai/') || modelId === 'openrouter/router') return 'fal';
  throw new ServiceError(`Unknown cloud model: ${modelId}`, {
    code: 'UNKNOWN_MODEL',
    statusCode: 422,
  });
}

function validateWorkflowParams(value) {
  const params = requireRecord(value, 'Workflow parameters');
  const nodeId = requireString(params.nodeId, 'Workflow node id', { maxLength: 256 });
  const nodeType = requireString(params.nodeType, 'Workflow node type', {
    maxLength: 256,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  });
  const modelId = requireString(params.modelId, 'Workflow model id', { maxLength: 512 });
  const inputs = requireRecord(params.inputs, 'Workflow inputs');
  return {
    ...params,
    nodeId,
    nodeType,
    modelId,
    inputs,
    apiKey: optionalSecret(params.apiKey, 'fal.ai API key'),
    kieKey: optionalSecret(params.kieKey, 'kie.ai API key'),
    runpodKey: optionalSecret(params.runpodKey, 'RunPod API key'),
  };
}

function sanitizeFalInputs(nodeType, modelId, inputs) {
  if (
    nodeType === 'kling-3-text'
    || nodeType === 'kling-3-image'
    || nodeType === 'sora-2'
    || nodeType === 'ltx-2-3-text'
    || nodeType === 'ltx-2-3-image'
  ) {
    delete inputs.quality;
  }
  if (nodeType === 'sora-2' && !modelId.endsWith('/pro')) {
    if (inputs.resolution === '1080p' || inputs.resolution === 'true_1080p') {
      inputs.resolution = '720p';
    }
  }
  return inputs;
}

function unwrapProviderResult(result) {
  if (isPlainRecord(result) && 'data' in result) return result.data;
  return result;
}

function getHiggsfieldOutputType(params) {
  const explicit = params.outputType
    ?? params.mediaType
    ?? params.inputs.outputType
    ?? params.inputs.output_type
    ?? params.inputs.mediaType
    ?? params.inputs.media_type;
  if (explicit !== undefined) {
    if (!HIGGSFIELD_OUTPUT_TYPES.has(explicit)) {
      throw new ServiceError('Higgsfield workflow output type must be image, video, audio, text, or 3d.', {
        code: 'INVALID_INPUT',
      });
    }
    return explicit;
  }
  const inferred = HIGGSFIELD_OUTPUT_BY_NODE[params.nodeType]
    ?? HIGGSFIELD_OUTPUT_BY_MODEL[params.modelId];
  if (inferred) return inferred;
  throw new ServiceError('Higgsfield workflow outputType is required for this model.', {
    code: 'INVALID_INPUT',
    statusCode: 422,
  });
}

function normalizeHiggsfieldWorkflowResult(value, outputType) {
  const result = requireRecord(value, 'Higgsfield generation result');
  const duration = Number(result.durationSec);
  if (outputType === 'text' && typeof result.text === 'string' && result.text.trim()) {
    const text = result.text.trim();
    return {
      output: { text },
      text,
      ...(typeof result.jobId === 'string' ? { jobId: result.jobId } : {}),
    };
  }
  if (typeof result.url === 'string' && result.url.trim()) {
    const url = result.url.trim();
    return {
      output: {
        url,
        ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
      },
      url,
      ...(typeof result.jobId === 'string' ? { jobId: result.jobId } : {}),
    };
  }
  if (typeof result.text === 'string' && result.text.trim()) {
    const text = result.text.trim();
    return {
      output: { text },
      text,
      ...(typeof result.jobId === 'string' ? { jobId: result.jobId } : {}),
    };
  }
  throw new ServiceError('Higgsfield generation returned neither a URL nor text.', {
    code: 'PROVIDER_BAD_RESPONSE',
    statusCode: 502,
  });
}

function createLocalMediaResolver(options, apiKeyValue) {
  const fetchImpl = options.fetchImpl;
  const dataRoot = path.resolve(options.dataRoot ?? process.env.CINEGEN_WEB_DATA_ROOT ?? DEFAULT_DATA_ROOT);
  const mediaRoot = path.resolve(dataRoot, 'media');
  const requestTimeoutMs = options.uploadTimeoutMs ?? 5 * 60_000;
  const cache = new Map();

  return async (mediaUrl, label) => {
    const cached = cache.get(mediaUrl);
    if (cached) return cached;
    const apiKey = optionalSecret(apiKeyValue, 'fal.ai API key');
    if (!apiKey) {
      throw new ServiceError(
        `${label} must be staged for the cloud. Add a fal.ai API key or configure CINEGEN_PUBLIC_BASE_URL.`,
        { code: 'MISSING_API_KEY', statusCode: 422 },
      );
    }
    if (typeof mediaUrl !== 'string' || !mediaUrl.startsWith('/media/')) {
      throw new ServiceError(`${label} is not a valid web media reference.`, {
        code: 'LOCAL_MEDIA_UNAVAILABLE',
        statusCode: 422,
      });
    }

    let relativePath;
    try {
      relativePath = decodeURIComponent(mediaUrl.slice('/media/'.length));
    } catch (cause) {
      throw new ServiceError(`${label} contains an invalid media path.`, {
        code: 'INVALID_URL',
        statusCode: 422,
        cause,
      });
    }
    const diskPath = path.resolve(mediaRoot, relativePath);
    if (diskPath === mediaRoot || !diskPath.startsWith(`${mediaRoot}${path.sep}`)) {
      throw new ServiceError(`${label} escapes the web media directory.`, {
        code: 'INVALID_URL',
        statusCode: 422,
      });
    }

    let realMediaRoot;
    let realDiskPath;
    let stats;
    try {
      [realMediaRoot, realDiskPath, stats] = await Promise.all([
        fs.realpath(mediaRoot),
        fs.realpath(diskPath),
        fs.stat(diskPath),
      ]);
    } catch (cause) {
      throw new ServiceError(`${label} no longer exists on the web server.`, {
        code: 'MEDIA_NOT_FOUND',
        statusCode: 404,
        cause,
      });
    }
    if (!stats.isFile() || !realDiskPath.startsWith(`${realMediaRoot}${path.sep}`)) {
      throw new ServiceError(`${label} is not a readable web media file.`, {
        code: 'INVALID_URL',
        statusCode: 422,
      });
    }
    if (stats.size > MAX_DIRECT_FAL_UPLOAD_BYTES) {
      throw new ServiceError(
        `${label} is larger than 90 MB. Configure CINEGEN_PUBLIC_BASE_URL so cloud providers can fetch it directly.`,
        { code: 'MEDIA_TOO_LARGE', statusCode: 413 },
      );
    }

    const name = path.basename(realDiskPath);
    const contentType = MEDIA_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
    const initiated = await fetchJson(fetchImpl, 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content_type: contentType, file_name: name }),
    }, { provider: 'fal.ai storage', timeoutMs: options.requestTimeoutMs });
    if (!isPlainRecord(initiated)) {
      throw new ServiceError('fal.ai storage returned an invalid upload response.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }
    const uploadUrl = validatePublicUrl(initiated.upload_url, 'fal.ai upload URL');
    const fileUrl = validatePublicUrl(initiated.file_url, 'fal.ai file URL');
    const buffer = await fs.readFile(realDiskPath);
    await fetchJson(fetchImpl, uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: buffer,
    }, { provider: 'fal.ai storage', timeoutMs: requestTimeoutMs });
    cache.set(mediaUrl, fileUrl.href);
    return fileUrl.href;
  };
}

function createKieClient(options) {
  const fetchImpl = options.fetchImpl;
  const sleep = options.sleep;
  const pollIntervalMs = options.kiePollIntervalMs ?? 3_000;
  const maxPollAttempts = options.kieMaxPollAttempts ?? 120;
  const requestTimeoutMs = options.requestTimeoutMs;

  return async function generateWithKie(modelValue, input, apiKeyValue) {
    const model = validateRoute(modelValue, 'kie.ai model');
    const apiKey = requireSecret(apiKeyValue, 'kie.ai API key');
    const dedicatedPrefix = Object.keys(KIE_DEDICATED_ENDPOINTS).find((prefix) => model.startsWith(prefix));
    const url = dedicatedPrefix
      ? KIE_DEDICATED_ENDPOINTS[dedicatedPrefix]
      : `${KIE_BASE_URL}/jobs/createTask`;
    const body = dedicatedPrefix
      ? { ...input, callBackUrl: '' }
      : { model, input, callBackUrl: '' };
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const submitted = await fetchJson(fetchImpl, url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, { provider: 'kie.ai', timeoutMs: requestTimeoutMs });
    const submittedRecord = requireRecord(submitted, 'kie.ai response');
    if (Number(submittedRecord.code) !== 200) {
      throw new ServiceError(
        typeof submittedRecord.msg === 'string' ? submittedRecord.msg : 'Failed to create kie.ai task.',
        { code: 'PROVIDER_ERROR', statusCode: 502 },
      );
    }
    const taskId = isPlainRecord(submittedRecord.data) ? submittedRecord.data.taskId : undefined;
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(taskId)) {
      throw new ServiceError('kie.ai returned an invalid task id.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (pollIntervalMs > 0) await sleep(pollIntervalMs);
      const pollUrl = `${KIE_BASE_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
      const polled = await fetchJson(fetchImpl, pollUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      }, { provider: 'kie.ai', timeoutMs: requestTimeoutMs });
      const pollRecord = isPlainRecord(polled) && isPlainRecord(polled.data) ? polled.data : undefined;
      if (!pollRecord || typeof pollRecord.state !== 'string') {
        throw new ServiceError('kie.ai returned an invalid job status.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      if (pollRecord.state === 'success') {
        if (typeof pollRecord.resultJson !== 'string') return pollRecord;
        try {
          return JSON.parse(pollRecord.resultJson);
        } catch {
          return pollRecord;
        }
      }
      if (pollRecord.state === 'fail') {
        throw new ServiceError(
          typeof pollRecord.failMsg === 'string' && pollRecord.failMsg
            ? pollRecord.failMsg
            : 'kie.ai generation failed.',
          { code: 'PROVIDER_ERROR', statusCode: 502 },
        );
      }
    }
    throw new ServiceError('kie.ai generation timed out.', {
      code: 'PROVIDER_TIMEOUT',
      statusCode: 504,
    });
  };
}

function normalizeRunpodOutput(output) {
  if (!isPlainRecord(output)) return output;
  const candidate = typeof output.image_url === 'string'
    ? ['image_url', output.image_url]
    : typeof output.image === 'string'
      ? ['image', output.image]
      : undefined;
  if (!candidate) return output;
  const [key, value] = candidate;
  if (/^(?:https?:|data:|\/)/i.test(value)) return output;
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return output;
  return { ...output, [key]: `data:image/png;base64,${compact}` };
}

function createRunpodClient(options) {
  const fetchImpl = options.fetchImpl;
  const sleep = options.sleep;
  const pollIntervalMs = options.runpodPollIntervalMs ?? 3_000;
  const maxPollAttempts = options.runpodMaxPollAttempts ?? 120;
  const requestTimeoutMs = options.requestTimeoutMs;

  return async function generateWithRunpod(endpointValue, input, apiKeyValue) {
    const endpointId = requireString(endpointValue, 'RunPod endpoint id', {
      maxLength: 256,
      pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    });
    const apiKey = requireSecret(apiKeyValue, 'RunPod API key');
    const baseUrl = `${RUNPOD_SERVERLESS_URL}/${encodeURIComponent(endpointId)}`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    const submitted = await fetchJson(fetchImpl, `${baseUrl}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    }, { provider: 'RunPod', timeoutMs: requestTimeoutMs });
    const jobId = isPlainRecord(submitted) ? submitted.id : undefined;
    if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(jobId)) {
      throw new ServiceError('RunPod returned an invalid job id.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (pollIntervalMs > 0) await sleep(pollIntervalMs);
      const polled = await fetchJson(fetchImpl, `${baseUrl}/status/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      }, { provider: 'RunPod', timeoutMs: requestTimeoutMs });
      const status = isPlainRecord(polled) && typeof polled.status === 'string'
        ? polled.status.toUpperCase()
        : '';
      if (status === 'COMPLETED') {
        return { output: normalizeRunpodOutput(polled.output) };
      }
      if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status)) {
        throw new ServiceError(
          isPlainRecord(polled) && typeof polled.error === 'string'
            ? polled.error
            : `RunPod job ${status.toLowerCase()}.`,
          { code: 'PROVIDER_ERROR', statusCode: 502 },
        );
      }
      if (!status || !['IN_QUEUE', 'IN_PROGRESS'].includes(status)) {
        throw new ServiceError('RunPod returned an unknown job status.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
    }
    throw new ServiceError('RunPod job timed out.', {
      code: 'PROVIDER_TIMEOUT',
      statusCode: 504,
    });
  };
}

function createPodClient(options) {
  const fetchImpl = options.fetchImpl;
  const requestTimeoutMs = options.requestTimeoutMs;
  const allowHttp = options.allowInsecurePodUrls === true;
  return async function generateWithPod(podUrlValue, routeValue, input) {
    const baseUrl = validatePublicUrl(podUrlValue, 'Pod URL', { allowHttp });
    const route = validateRoute(routeValue, 'Pod route');
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/generate/${route}`;
    baseUrl.search = '';
    baseUrl.hash = '';
    return await fetchJson(fetchImpl, baseUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    }, { provider: 'CineGen Pod', timeoutMs: requestTimeoutMs });
  };
}

function createPodControlHandlers(options) {
  const fetchImpl = options.fetchImpl;
  const requestTimeoutMs = options.requestTimeoutMs;

  async function graphql(paramsValue, operation) {
    const params = requireRecord(paramsValue, 'RunPod pod parameters');
    const runpodKey = requireSecret(params.runpodKey, 'RunPod API key');
    const podId = requireString(params.podId, 'RunPod pod id', {
      maxLength: 256,
      pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    });
    const endpoint = new URL(RUNPOD_GRAPHQL_URL);
    endpoint.searchParams.set('api_key', runpodKey);

    let query;
    if (operation === 'status') {
      query = `{ pod(input: { podId: "${podId}" }) { id desiredStatus runtime { ports { ip isIpPublic privatePort publicPort type } } } }`;
    } else if (operation === 'start') {
      query = `mutation { podResume(input: { podId: "${podId}" }) { id desiredStatus } }`;
    } else {
      query = `mutation { podStop(input: { podId: "${podId}" }) { id desiredStatus } }`;
    }

    const result = await fetchJson(fetchImpl, endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }, { provider: 'RunPod', timeoutMs: requestTimeoutMs });
    const resultRecord = requireRecord(result, 'RunPod response');
    if (Array.isArray(resultRecord.errors) && resultRecord.errors.length > 0) {
      throw new ServiceError(`RunPod pod ${operation} failed: ${JSON.stringify(resultRecord.errors).slice(0, 2_000)}`, {
        code: 'PROVIDER_ERROR',
        statusCode: 502,
      });
    }
    return resultRecord;
  }

  return {
    start: (params) => graphql(params, 'start'),
    stop: (params) => graphql(params, 'stop'),
    status: async (params) => {
      const result = await graphql(params, 'status');
      const pod = isPlainRecord(result.data) && isPlainRecord(result.data.pod)
        ? result.data.pod
        : undefined;
      if (!pod) {
        throw new ServiceError('RunPod pod was not found.', {
          code: 'NOT_FOUND',
          statusCode: 404,
        });
      }
      const ports = isPlainRecord(pod.runtime) && Array.isArray(pod.runtime.ports)
        ? pod.runtime.ports
        : [];
      const httpPort = ports.find((entry) => (
        isPlainRecord(entry)
        && Number(entry.privatePort) === 8000
        && entry.isIpPublic === true
      ));
      return {
        status: typeof pod.desiredStatus === 'string' ? pod.desiredStatus : 'UNKNOWN',
        ip: isPlainRecord(httpPort) && typeof httpPort.ip === 'string' ? httpPort.ip : null,
        port: isPlainRecord(httpPort) && Number.isFinite(Number(httpPort.publicPort))
          ? Number(httpPort.publicPort)
          : null,
      };
    },
  };
}

export function createWorkflowServices(options = {}) {
  const dependencies = {
    ...options,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    requestTimeoutMs: options.requestTimeoutMs ?? 90_000,
  };
  if (typeof dependencies.fetchImpl !== 'function') {
    throw new ServiceError('This Node runtime does not provide fetch.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }

  const falSubscribe = options.falSubscribe ?? createFalSubscriber(dependencies);
  const generateWithKie = createKieClient(dependencies);
  const generateWithRunpod = createRunpodClient(dependencies);
  const generateWithPod = createPodClient(dependencies);
  const publicBaseUrl = options.publicBaseUrl ?? process.env.CINEGEN_PUBLIC_BASE_URL;
  const higgsfieldGenerate = options.higgsfieldGenerate
    ?? options.higgsfieldService?.handlers?.generate;

  const workflowHandlers = {
    run: async (paramsValue) => {
      const params = validateWorkflowParams(paramsValue);
      const provider = getProvider(params.nodeType, params.modelId);
      if (provider === 'local') throw new CapabilityUnavailableError('Local model workflows');
      if (provider === 'higgsfield') {
        if (typeof higgsfieldGenerate !== 'function') {
          throw new CapabilityUnavailableError('Higgsfield CLI workflows');
        }
        const outputType = getHiggsfieldOutputType(params);
        const result = await higgsfieldGenerate({
          model: params.modelId,
          outputType,
          inputs: params.inputs,
        });
        return normalizeHiggsfieldWorkflowResult(result, outputType);
      }

      const inputs = await normalizeCloudInputs(params.inputs, {
        publicBaseUrl,
        localMediaResolver: createLocalMediaResolver(dependencies, params.apiKey),
      });
      let result;
      if (provider === 'kie') {
        if (!params.kieKey) throw new ServiceError('No kie.ai API key provided. Add one in Settings.', { code: 'MISSING_API_KEY' });
        const model = getKieModel(params.nodeType, params.modelId);
        if (!model) throw new ServiceError(`Unknown kie.ai model: ${params.modelId}`, { code: 'UNKNOWN_MODEL', statusCode: 422 });
        result = await generateWithKie(model, inputs, params.kieKey);
      } else if (provider === 'runpod') {
        if (!params.runpodKey) throw new ServiceError('No RunPod API key provided. Add one in Settings.', { code: 'MISSING_API_KEY' });
        const requestedEndpoint = typeof params.runpodEndpointId === 'string'
          ? params.runpodEndpointId.trim()
          : '';
        const endpointId = requestedEndpoint
          || RUNPOD_DEFAULT_ENDPOINTS[params.nodeType]
          || RUNPOD_DEFAULT_ENDPOINTS[params.modelId]
          || '';
        if (!endpointId) {
          throw new ServiceError('No RunPod endpoint ID configured for this model. Set it in the model definition.', {
            code: 'MISSING_ENDPOINT',
            statusCode: 422,
          });
        }
        result = await generateWithRunpod(endpointId, inputs, params.runpodKey);
      } else if (provider === 'pod') {
        if (typeof params.podUrl !== 'string' || !params.podUrl.trim()) {
          throw new ServiceError('No pod URL configured. Start your pod and set the URL in Settings.', {
            code: 'MISSING_ENDPOINT',
            statusCode: 422,
          });
        }
        const route = POD_ROUTES[params.nodeType] ?? POD_ROUTES[params.modelId];
        if (!route) throw new ServiceError(`Unknown CineGen Pod model: ${params.modelId}`, { code: 'UNKNOWN_MODEL', statusCode: 422 });
        result = await generateWithPod(params.podUrl, route, inputs);
      } else {
        if (!params.apiKey) throw new ServiceError('No fal.ai API key provided. Add one in Settings.', { code: 'MISSING_API_KEY' });
        const model = validateModelId(params.modelId, 'fal.ai model');
        const sanitizedInputs = sanitizeFalInputs(params.nodeType, model, { ...inputs });
        result = await falSubscribe(model, sanitizedInputs, params.apiKey);
      }
      return unwrapProviderResult(result);
    },

    pollJob: async (idValue) => {
      requireString(idValue, 'Workflow job id', { maxLength: 256 });
      throw new ServiceError('Workflow jobs complete inside workflow.run; no separate polling job exists.', {
        code: 'JOB_NOT_FOUND',
        statusCode: 404,
      });
    },
  };

  return {
    workflowHandlers,
    podHandlers: {
      ...createPodControlHandlers(dependencies),
      ...createRunpodLtx25Handlers(dependencies),
    },
  };
}

const defaultServices = createWorkflowServices();

export const workflowHandlers = defaultServices.workflowHandlers;
export const podHandlers = defaultServices.podHandlers;
