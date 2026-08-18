import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MODEL_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_STRING_LENGTH = 2 * 1024 * 1024;
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DATA_ROOT = path.join(WEB_ROOT, '.data');
const MAX_DIRECT_FAL_UPLOAD_BYTES = 90 * 1024 * 1024;

const MEDIA_TYPES = Object.freeze({
  '.aac': 'audio/aac',
  '.avi': 'video/x-msvideo',
  '.bmp': 'image/bmp',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
});

export class ServiceError extends Error {
  constructor(message, { code = 'SERVICE_ERROR', statusCode = 400, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CapabilityUnavailableError extends ServiceError {
  constructor(capability) {
    super(`${capability} is available in the CineGen desktop app but is not available on the web server.`, {
      code: 'WEB_CAPABILITY_UNAVAILABLE',
      // Use a client-visible 4xx response because the web server deliberately
      // redacts all 5xx messages in production.
      statusCode: 422,
    });
    this.name = 'CapabilityUnavailableError';
  }
}

export function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireRecord(value, label) {
  if (!isPlainRecord(value)) {
    throw new ServiceError(`${label} must be an object.`, { code: 'INVALID_INPUT' });
  }
  return value;
}

export function requireString(value, label, { maxLength = 4096, pattern } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ServiceError(`${label} is required.`, { code: 'INVALID_INPUT' });
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new ServiceError(`${label} is too long.`, { code: 'INVALID_INPUT' });
  }
  if (pattern && !pattern.test(result)) {
    throw new ServiceError(`${label} has an invalid format.`, { code: 'INVALID_INPUT' });
  }
  return result;
}

export function optionalSecret(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, label, { maxLength: 4096 });
}

export function requireSecret(value, label) {
  return requireString(value, label, { maxLength: 4096 });
}

export function validateModelId(value, label = 'Model') {
  const model = requireString(value, label, { maxLength: 512 });
  const segments = model.split('/');
  if (segments.length < 2 || segments.some((segment) => !MODEL_SEGMENT.test(segment))) {
    throw new ServiceError(`${label} has an invalid format.`, { code: 'INVALID_MODEL' });
  }
  return model;
}

export function validateRoute(value, label = 'Route') {
  const route = requireString(value, label, { maxLength: 512 });
  const segments = route.split('/');
  if (segments.some((segment) => !MODEL_SEGMENT.test(segment))) {
    throw new ServiceError(`${label} has an invalid format.`, { code: 'INVALID_INPUT' });
  }
  return route;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] === 0;
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) {
    return host === '::1'
      || host === '::'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || /^fe[89ab]/.test(host)
      || host.startsWith('::ffff:127.')
      || host.startsWith('::ffff:10.')
      || host.startsWith('::ffff:192.168.');
  }
  return false;
}

export function validatePublicUrl(value, label, { allowHttp = false } = {}) {
  const raw = requireString(value, label, { maxLength: 4096 });
  let url;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new ServiceError(`${label} must be a valid URL.`, {
      code: 'INVALID_URL',
      cause,
    });
  }
  const allowedProtocol = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:');
  if (!allowedProtocol) {
    throw new ServiceError(`${label} must use ${allowHttp ? 'HTTP or HTTPS' : 'HTTPS'}.`, {
      code: 'INVALID_URL',
    });
  }
  if (url.username || url.password || isPrivateHost(url.hostname)) {
    throw new ServiceError(`${label} must point to a public host and cannot include credentials.`, {
      code: 'INVALID_URL',
    });
  }
  return url;
}

function normalizeWebMediaReference(value, label) {
  const source = requireString(value, label, { maxLength: 4096 });
  let mediaUrl = source;
  if (source.startsWith('local-media://file')) {
    mediaUrl = source.slice('local-media://file'.length);
  }
  try {
    mediaUrl = decodeURIComponent(mediaUrl);
  } catch (cause) {
    throw new ServiceError(`${label} contains an invalid media path.`, {
      code: 'INVALID_URL',
      statusCode: 422,
      cause,
    });
  }
  if (!mediaUrl.startsWith('/media/')) {
    throw new ServiceError(
      `${label} is not a web media reference. Browser uploads must use a /media URL.`,
      { code: 'LOCAL_MEDIA_UNAVAILABLE', statusCode: 422 },
    );
  }
  return mediaUrl;
}

export function isWebMediaReference(value) {
  return typeof value === 'string'
    && (value.startsWith('/media/') || value.startsWith('local-media://file/media/'));
}

/**
 * Resolve a browser-uploaded /media reference to a file while defending against
 * path traversal and symlink escapes. Raw desktop file paths are intentionally
 * unavailable to web RPC callers.
 */
export async function resolveWebMediaPath(value, options = {}) {
  const label = options.label ?? 'Media source';
  const mediaUrl = normalizeWebMediaReference(value, label);
  const dataRoot = path.resolve(options.dataRoot ?? process.env.CINEGEN_WEB_DATA_ROOT ?? DEFAULT_DATA_ROOT);
  const mediaRoot = path.resolve(dataRoot, 'media');
  const relativePath = mediaUrl.slice('/media/'.length);
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

  const name = path.basename(realDiskPath);
  return {
    mediaUrl,
    diskPath: realDiskPath,
    name,
    size: stats.size,
    contentType: MEDIA_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
  };
}

/**
 * Creates a request-scoped local-media stager. Public URLs are validated and
 * passed through; /media files are uploaded to fal storage with the key supplied
 * to that individual call (never process-global state).
 */
export function createFalMediaStager(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ServiceError('This Node runtime does not provide fetch.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  const requestTimeoutMs = options.requestTimeoutMs ?? 90_000;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 5 * 60_000;

  return async function stageMedia(sourceValue, apiKeyValue, label = 'Media source') {
    const source = requireString(sourceValue, label, { maxLength: 4096 });
    if (/^https?:\/\//i.test(source)) {
      return validatePublicUrl(source, label, { allowHttp: true }).href;
    }
    if (!isWebMediaReference(source)) {
      throw new ServiceError(
        `${label} must be a public HTTP(S) URL or a browser-uploaded /media reference.`,
        { code: 'LOCAL_MEDIA_UNAVAILABLE', statusCode: 422 },
      );
    }

    const apiKey = requireSecret(apiKeyValue, 'fal.ai API key');
    const media = await resolveWebMediaPath(source, { dataRoot: options.dataRoot, label });
    if (media.size > MAX_DIRECT_FAL_UPLOAD_BYTES) {
      throw new ServiceError(
        `${label} is larger than 90 MB and cannot be staged directly to fal.ai.`,
        { code: 'MEDIA_TOO_LARGE', statusCode: 413 },
      );
    }

    const initiated = await fetchJson(fetchImpl, 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content_type: media.contentType, file_name: media.name }),
    }, { provider: 'fal.ai storage', timeoutMs: requestTimeoutMs });
    if (!isPlainRecord(initiated)) {
      throw new ServiceError('fal.ai storage returned an invalid upload response.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }
    const uploadUrl = validatePublicUrl(initiated.upload_url, 'fal.ai upload URL');
    const fileUrl = validatePublicUrl(initiated.file_url, 'fal.ai file URL');
    const buffer = await fs.readFile(media.diskPath);
    await fetchJson(fetchImpl, uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': media.contentType },
      body: buffer,
    }, { provider: 'fal.ai storage', timeoutMs: uploadTimeoutMs });
    return fileUrl.href;
  };
}

function validateRemoteInputUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ServiceError(`${label} contains an invalid URL.`, {
      code: 'INVALID_URL',
      cause,
    });
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new ServiceError(`${label} must use HTTP or HTTPS and cannot include credentials.`, {
      code: 'INVALID_URL',
    });
  }
  return url.href;
}

function isUrlField(key) {
  return /(?:^|_)(?:url|urls|uri|image|video|audio|media|file|source|reference)(?:$|_)/i.test(key)
    || /(?:Url|Urls|URI)$/.test(key);
}

async function resolveLocalMedia(value, publicBaseUrl, localMediaResolver, label) {
  let pathValue = value.slice('local-media://file'.length);
  try {
    pathValue = decodeURIComponent(pathValue);
  } catch {
    throw new ServiceError(`${label} contains an invalid local media reference.`, {
      code: 'INVALID_URL',
    });
  }

  if (/^https?:\/\//i.test(pathValue)) {
    return validateRemoteInputUrl(pathValue, label);
  }
  if (!pathValue.startsWith('/media/')) {
    throw new ServiceError(`${label} is not a valid web media reference.`, {
      code: 'LOCAL_MEDIA_UNAVAILABLE',
      statusCode: 422,
    });
  }
  if (pathValue.startsWith('/') && publicBaseUrl) {
    return new URL(pathValue, publicBaseUrl).href;
  }
  if (typeof localMediaResolver === 'function') {
    return await localMediaResolver(pathValue, label);
  }
  throw new ServiceError(
    `${label} references desktop-local media. Upload it first or configure CINEGEN_PUBLIC_BASE_URL for web uploads.`,
    { code: 'LOCAL_MEDIA_UNAVAILABLE', statusCode: 422 },
  );
}

export async function normalizeCloudInputs(value, { publicBaseUrl, localMediaResolver } = {}) {
  let normalizedPublicBase;
  if (publicBaseUrl) {
    normalizedPublicBase = validatePublicUrl(publicBaseUrl, 'CINEGEN_PUBLIC_BASE_URL', {
      allowHttp: false,
    });
  }

  const seen = new WeakSet();
  let itemCount = 0;

  const visit = async (item, label, parentKey, depth) => {
    itemCount += 1;
    if (itemCount > 20_000 || depth > 24) {
      throw new ServiceError('Workflow inputs are too deeply nested or contain too many values.', {
        code: 'INVALID_INPUT',
      });
    }

    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        throw new ServiceError(`${label} must be a finite number.`, { code: 'INVALID_INPUT' });
      }
      return item;
    }
    if (typeof item === 'string') {
      if (item.length > MAX_STRING_LENGTH) {
        throw new ServiceError(`${label} is too long.`, { code: 'INVALID_INPUT' });
      }
      if (item.startsWith('local-media://file')) {
        return await resolveLocalMedia(item, normalizedPublicBase, localMediaResolver, label);
      }
      if (isUrlField(parentKey)) {
        if (/^https?:\/\//i.test(item)) return validateRemoteInputUrl(item, label);
        if ((item.startsWith('/api/') || item.startsWith('/media/')) && normalizedPublicBase) {
          return new URL(item, normalizedPublicBase).href;
        }
        if (item.startsWith('/media/')) {
          if (typeof localMediaResolver === 'function') {
            return await localMediaResolver(item, label);
          }
          throw new ServiceError(
            `${label} references web media that is not publicly reachable. Configure CINEGEN_PUBLIC_BASE_URL.`,
            { code: 'LOCAL_MEDIA_UNAVAILABLE', statusCode: 422 },
          );
        }
        if (/^(?:blob|data|file|javascript):/i.test(item)) {
          throw new ServiceError(`${label} uses a URL scheme unavailable to cloud providers.`, {
            code: 'INVALID_URL',
          });
        }
      }
      return item;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new ServiceError('Workflow inputs cannot contain cycles.', { code: 'INVALID_INPUT' });
      if (item.length > 2_000) throw new ServiceError(`${label} contains too many entries.`, { code: 'INVALID_INPUT' });
      seen.add(item);
      const result = [];
      for (let index = 0; index < item.length; index += 1) {
        result.push(await visit(item[index], `${label}[${index}]`, parentKey, depth + 1));
      }
      seen.delete(item);
      return result;
    }
    if (isPlainRecord(item)) {
      if (seen.has(item)) throw new ServiceError('Workflow inputs cannot contain cycles.', { code: 'INVALID_INPUT' });
      const entries = Object.entries(item);
      if (entries.length > 2_000) throw new ServiceError(`${label} has too many fields.`, { code: 'INVALID_INPUT' });
      seen.add(item);
      const result = {};
      for (const [key, entry] of entries) {
        if (FORBIDDEN_KEYS.has(key)) {
          throw new ServiceError(`${label} contains a forbidden field.`, { code: 'INVALID_INPUT' });
        }
        result[key] = await visit(entry, `${label}.${key}`, key, depth + 1);
      }
      seen.delete(item);
      return result;
    }
    throw new ServiceError(`${label} contains a value that cannot be sent to a provider.`, {
      code: 'INVALID_INPUT',
    });
  };

  const result = await visit(value, 'inputs', '', 0);
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) {
    throw new ServiceError('Workflow inputs are too large.', { code: 'INVALID_INPUT', statusCode: 413 });
  }
  return result;
}

function errorMessage(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 2_000);
  if (isPlainRecord(payload)) {
    for (const key of ['message', 'error', 'detail', 'msg', 'reason', 'failMsg']) {
      const candidate = payload[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 2_000);
      if (candidate && typeof candidate === 'object') {
        try {
          return JSON.stringify(candidate).slice(0, 2_000);
        } catch {
          // Continue to the fallback.
        }
      }
    }
  }
  return fallback;
}

export async function fetchJson(fetchImpl, url, init = {}, options = {}) {
  const provider = options.provider || 'Remote service';
  const timeoutMs = options.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error(`${provider} request timed out.`)), timeoutMs)
    : undefined;
  timer?.unref?.();

  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    throw new ServiceError(
      timedOut ? `${provider} request timed out.` : `Could not reach ${provider}.`,
      { code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', statusCode: 502, cause },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  let text = '';
  try {
    text = await response.text();
  } catch (cause) {
    throw new ServiceError(`${provider} returned an unreadable response.`, {
      code: 'PROVIDER_BAD_RESPONSE',
      statusCode: 502,
      cause,
    });
  }

  let payload;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new ServiceError(errorMessage(payload, `${provider} request failed (${response.status}).`), {
      code: 'PROVIDER_ERROR',
      statusCode: 502,
    });
  }
  return payload;
}

export function createFalSubscriber(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const pollIntervalMs = options.falPollIntervalMs ?? 500;
  const maxPollAttempts = options.falMaxPollAttempts ?? 1_200;
  const requestTimeoutMs = options.requestTimeoutMs ?? 90_000;

  if (typeof fetchImpl !== 'function') {
    throw new ServiceError('This Node runtime does not provide fetch.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }

  return async function falSubscribe(modelValue, input, apiKeyValue) {
    const model = validateModelId(modelValue, 'fal.ai model');
    const apiKey = requireSecret(apiKeyValue, 'fal.ai API key');
    const baseUrl = `https://queue.fal.run/${model}`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const submitted = await fetchJson(fetchImpl, baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }, { provider: 'fal.ai', timeoutMs: requestTimeoutMs });

    const submittedRecord = isPlainRecord(submitted) ? submitted : {};
    const requestId = submittedRecord.request_id;
    if (typeof requestId !== 'string') {
      // Some synchronous/custom fal endpoints return their result immediately.
      if (isPlainRecord(submitted)) return { data: submitted, requestId: '' };
      throw new ServiceError('fal.ai did not return a request id.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) {
      throw new ServiceError('fal.ai returned an invalid request id.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }

    // fal endpoint ids may contain a path after owner/alias (for example
    // fal-ai/flux/dev). Queue status/result URLs intentionally omit that
    // endpoint path, matching @fal-ai/client's parseEndpointId behavior.
    const modelParts = model.split('/');
    const queueIdentityLength = ['workflows', 'comfy'].includes(modelParts[0]) ? 3 : 2;
    const queueIdentity = modelParts.slice(0, queueIdentityLength).join('/');
    const requestBase = `https://queue.fal.run/${queueIdentity}/requests/${encodeURIComponent(requestId)}`;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (attempt > 0 && pollIntervalMs > 0) await sleep(pollIntervalMs);
      const statusPayload = await fetchJson(fetchImpl, `${requestBase}/status?logs=0`, {
        method: 'GET',
        headers,
      }, { provider: 'fal.ai', timeoutMs: requestTimeoutMs });
      const statusRecord = isPlainRecord(statusPayload) ? statusPayload : {};
      const status = typeof statusRecord.status === 'string' ? statusRecord.status.toUpperCase() : '';
      if (status === 'COMPLETED') {
        const data = await fetchJson(fetchImpl, requestBase, {
          method: 'GET',
          headers,
        }, { provider: 'fal.ai', timeoutMs: requestTimeoutMs });
        return { data, requestId };
      }
      if (status === 'FAILED' || status === 'CANCELLED') {
        throw new ServiceError(errorMessage(statusRecord, `fal.ai request ${status.toLowerCase()}.`), {
          code: 'PROVIDER_ERROR',
          statusCode: 502,
        });
      }
      if (!status || !['IN_QUEUE', 'IN_PROGRESS'].includes(status)) {
        throw new ServiceError('fal.ai returned an unknown queue status.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
    }

    throw new ServiceError('fal.ai generation timed out.', {
      code: 'PROVIDER_TIMEOUT',
      statusCode: 504,
    });
  };
}
