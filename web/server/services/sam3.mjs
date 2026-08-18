import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as dns } from 'node:dns';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { ServiceError, requireRecord, requireString } from './_shared.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_COMMAND = /^[A-Za-z0-9._+-]{1,128}$/;
const PATH_BODY_KEYS = new Set(['image_path', 'video_path']);
const OUTPUT_PATH_KEYS = new Set([
  'image_path', 'video_path', 'output_path', 'mask_path', 'preview_path', 'path',
]);
const OUTPUT_PATH_COLLECTION_KEYS = new Set([
  'image_paths', 'video_paths', 'output_paths', 'mask_paths', 'preview_paths', 'paths',
]);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);
const RESPONSE_HEADERS = new Set([
  'cache-control', 'content-disposition', 'content-encoding', 'content-language',
  'content-length', 'content-type', 'etag', 'last-modified',
]);
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60 * 1_000;
const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function sam3Error(message, code = 'SAM3_ERROR', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathInside(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (!isPathInside(root, candidate)) {
    throw sam3Error('SAM 3 media path escapes the configured data root.', 'INVALID_MEDIA_PATH');
  }
  return candidate;
}

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIp(address) {
  const normalized = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice('::ffff:'.length));
  const family = isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family !== 6) return true;
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('ff');
}

function validateRemoteBase(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value));
  } catch (cause) {
    throw sam3Error('CINEGEN_SAM3_BASE_URL is not a valid URL.', 'INVALID_SAM3_BASE_URL', 500, cause);
  }
  if (url.protocol !== 'https:') {
    throw sam3Error('Remote SAM 3 services must use HTTPS.', 'INVALID_SAM3_BASE_URL', 500);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw sam3Error('Remote SAM 3 URL cannot contain credentials, a query, or a fragment.', 'INVALID_SAM3_BASE_URL', 500);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw sam3Error('Remote SAM 3 host must be publicly routable.', 'SAM3_REMOTE_FORBIDDEN', 500);
  }
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw sam3Error('Remote SAM 3 host cannot use a private or reserved address.', 'SAM3_REMOTE_FORBIDDEN', 500);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

function validateProxyTarget(rawRequestUrl) {
  if (typeof rawRequestUrl !== 'string' || rawRequestUrl.length > 16_384) {
    throw sam3Error('Invalid SAM 3 proxy path.', 'INVALID_PROXY_PATH');
  }
  const queryIndex = rawRequestUrl.indexOf('?');
  const rawPath = queryIndex === -1 ? rawRequestUrl : rawRequestUrl.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? '' : rawRequestUrl.slice(queryIndex + 1);
  if (rawQuery.length > 8_192) throw sam3Error('SAM 3 query string is too large.', 'INVALID_PROXY_PATH');
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch (cause) {
    throw sam3Error('SAM 3 proxy path is malformed.', 'INVALID_PROXY_PATH', 400, cause);
  }
  if (decoded.includes('\\') || decoded.includes('\0') || /%2e|%2f|%5c/i.test(decoded)) {
    throw sam3Error('SAM 3 proxy path contains unsafe encoding.', 'INVALID_PROXY_PATH');
  }
  if (decoded !== '/api/sam3' && !decoded.startsWith('/api/sam3/')) {
    throw sam3Error('Request is outside the SAM 3 proxy.', 'INVALID_PROXY_PATH', 404);
  }
  const suffix = decoded.slice('/api/sam3'.length);
  const segments = suffix.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw sam3Error('SAM 3 proxy path cannot traverse directories.', 'INVALID_PROXY_PATH');
  }
  return { segments, query: rawQuery };
}

function createTargetUrl(baseUrl, proxyTarget) {
  const target = new URL(baseUrl.href);
  const prefix = target.pathname.replace(/\/+$/, '');
  const suffix = proxyTarget.segments.map(encodeURIComponent).join('/');
  target.pathname = suffix ? `${prefix}/${suffix}` : prefix || '/';
  target.search = proxyTarget.query ? `?${proxyTarget.query}` : '';
  return target;
}

async function readRequestBody(request, maxBytes) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw sam3Error('SAM 3 request body is too large.', 'SAM3_REQUEST_TOO_LARGE', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw sam3Error('SAM 3 request body is too large.', 'SAM3_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

function sanitizeConfiguredHeaders(value) {
  if (value === undefined) return {};
  const headers = requireRecord(value, 'SAM 3 remote headers');
  const result = {};
  for (const [name, rawValue] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (HOP_HEADERS.has(normalized) || normalized === 'content-length' || normalized === 'cookie') continue;
    if (!/^[a-z0-9-]{1,128}$/.test(normalized) || typeof rawValue !== 'string' || /[\r\n]/.test(rawValue)) {
      throw sam3Error('SAM 3 remote headers are invalid.', 'INVALID_SAM3_CONTEXT', 500);
    }
    result[normalized] = rawValue;
  }
  return result;
}

function requestHeaders(incoming, configured, body) {
  const result = { ...configured };
  for (const name of ['accept', 'content-type']) {
    const value = incoming.headers[name];
    if (typeof value === 'string' && !/[\r\n]/.test(value)) result[name] = value;
  }
  if (body) result['content-length'] = String(body.length);
  return result;
}

function responseHeaders(upstream) {
  const result = {};
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (RESPONSE_HEADERS.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  result['x-content-type-options'] = 'nosniff';
  return result;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(sam3Error('Could not allocate a SAM 3 port.', 'SAM3_PORT_UNAVAILABLE', 500));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

/**
 * Create a managed SAM 3 service.
 *
 * Returned contract:
 * - `handlers`: RPC methods `{ start, stop, getPort }`
 * - `handleHttp(request, response)`: proxy for `/api/sam3/*`
 * - `close()`: server-shutdown cleanup
 */
export function createSam3Service(context) {
  const options = requireRecord(context, 'SAM 3 service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'SAM 3 data root', { maxLength: 16_384 }));
  const mediaRoot = pathInside(dataRoot, 'media');
  const store = options.store;
  const remoteBase = validateRemoteBase(options.baseUrl ?? process.env.CINEGEN_SAM3_BASE_URL);
  const pythonValue = options.pythonPath ?? process.env.CINEGEN_SAM3_PYTHON;
  const scriptValue = options.scriptPath ?? process.env.CINEGEN_SAM3_SCRIPT;
  const cwdValue = options.cwd ?? process.env.CINEGEN_SAM3_CWD;
  const spawnProcess = options.spawnProcess || spawn;
  const portAllocator = options.portAllocator || allocatePort;
  const dnsLookup = options.dnsLookup || dns.lookup;
  const upstreamRequestImpl = options.upstreamRequest;
  const idleTimeoutMs = Number.isFinite(options.idleTimeoutMs)
    ? Math.max(10, Number(options.idleTimeoutMs))
    : DEFAULT_IDLE_TIMEOUT_MS;
  const startupTimeoutMs = Number.isFinite(options.startupTimeoutMs)
    ? Math.max(50, Number(options.startupTimeoutMs))
    : DEFAULT_STARTUP_TIMEOUT_MS;
  const healthPollIntervalMs = Number.isFinite(options.healthPollIntervalMs)
    ? Math.max(5, Number(options.healthPollIntervalMs))
    : 500;
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
    ? Math.max(50, Number(options.requestTimeoutMs))
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRequestBytes = Number.isFinite(options.maxRequestBytes)
    ? Math.max(1, Number(options.maxRequestBytes))
    : DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes = Number.isFinite(options.maxResponseBytes)
    ? Math.max(1, Number(options.maxResponseBytes))
    : DEFAULT_MAX_RESPONSE_BYTES;
  const maxJsonResponseBytes = Number.isFinite(options.maxJsonResponseBytes)
    ? Math.max(1, Math.min(maxResponseBytes, Number(options.maxJsonResponseBytes)))
    : Math.min(maxResponseBytes, DEFAULT_MAX_JSON_RESPONSE_BYTES);
  const maxOutputFileBytes = Number.isFinite(options.maxOutputFileBytes)
    ? Math.max(1, Number(options.maxOutputFileBytes))
    : DEFAULT_MAX_OUTPUT_FILE_BYTES;
  const configuredOutputRoots = Array.isArray(options.outputRoots)
    ? options.outputRoots.map((root) => path.resolve(requireString(root, 'SAM 3 output root', { maxLength: 16_384 })))
    : [];
  const remoteHeaders = sanitizeConfiguredHeaders(options.remoteHeaders);
  const apiKey = options.apiKey ?? process.env.CINEGEN_SAM3_API_KEY;
  if (typeof apiKey === 'string' && apiKey.trim()) remoteHeaders.authorization = `Bearer ${apiKey.trim()}`;

  let child = null;
  let localPort = 0;
  let remoteRunning = false;
  let startPromise = null;
  let idleTimer = null;
  let activeRequests = 0;
  const sessionOwners = new Map();
  let imageOwnerProjectId = null;

  const status = () => ({
    port: 0,
    running: remoteBase ? remoteRunning : Boolean(child && !child.killed && child.exitCode === null),
    baseUrl: '/api/sam3',
  });

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const scheduleIdle = () => {
    clearIdle();
    if (activeRequests > 0 || !status().running) return;
    idleTimer = setTimeout(() => void stop(), idleTimeoutMs);
    idleTimer.unref?.();
  };

  const resolveRemoteAddress = async (url) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname)) {
      if (isPrivateIp(hostname)) throw sam3Error('Remote SAM 3 resolved to a private address.', 'SAM3_REMOTE_FORBIDDEN', 502);
      return { address: hostname, family: isIP(hostname) };
    }
    let records;
    try {
      records = await dnsLookup(hostname, { all: true, verbatim: true });
    } catch (cause) {
      throw sam3Error('Remote SAM 3 hostname could not be resolved.', 'SAM3_REMOTE_UNAVAILABLE', 502, cause);
    }
    const list = Array.isArray(records) ? records : [records];
    if (list.length === 0 || list.some((record) => !record?.address || isPrivateIp(record.address))) {
      throw sam3Error('Remote SAM 3 host resolved to a private or invalid address.', 'SAM3_REMOTE_FORBIDDEN', 502);
    }
    return list[0];
  };

  const openUpstream = async ({ url, method = 'GET', headers = {}, body, timeoutMs = requestTimeoutMs }) => {
    const remoteAddress = url.protocol === 'https:' ? await resolveRemoteAddress(url) : null;
    if (upstreamRequestImpl !== undefined) {
      if (typeof upstreamRequestImpl !== 'function') {
        throw sam3Error('SAM 3 upstream request adapter must be a function.', 'INVALID_SAM3_CONTEXT', 500);
      }
      return upstreamRequestImpl({ url, method, headers, body, timeoutMs, remoteAddress });
    }
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const requestOptions = {
        method,
        headers,
        signal: undefined,
      };
      if (remoteAddress) {
        requestOptions.lookup = (_hostname, _lookupOptions, callback) => {
          callback(null, remoteAddress.address, remoteAddress.family);
        };
      }
      const upstreamRequest = transport.request(url, requestOptions, resolve);
      upstreamRequest.setTimeout(timeoutMs, () => {
        upstreamRequest.destroy(sam3Error('SAM 3 request timed out.', 'SAM3_TIMEOUT', 504));
      });
      upstreamRequest.once('error', (cause) => {
        if (cause instanceof ServiceError) reject(cause);
        else reject(sam3Error('SAM 3 service is unavailable.', 'SAM3_UNAVAILABLE', 502, cause));
      });
      upstreamRequest.end(body);
    });
  };

  const collectResponse = async (
    upstream,
    limit = 64 * 1024,
    message = 'SAM 3 response was too large.',
    code = 'SAM3_RESPONSE_TOO_LARGE',
  ) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of upstream) {
      size += chunk.length;
      if (size > limit) {
        upstream.destroy();
        throw sam3Error(message, code, 502);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  const backendBase = () => remoteBase || new URL(`http://127.0.0.1:${localPort}/`);

  const healthCheck = async () => {
    const target = createTargetUrl(backendBase(), { segments: ['health'], query: '' });
    const upstream = await openUpstream({
      url: target,
      headers: remoteBase ? remoteHeaders : {},
      timeoutMs: Math.min(2_000, requestTimeoutMs),
    });
    await collectResponse(upstream);
    return upstream.statusCode >= 200 && upstream.statusCode < 300;
  };

  const stop = async () => {
    clearIdle();
    remoteRunning = false;
    sessionOwners.clear();
    imageOwnerProjectId = null;
    const processToStop = child;
    child = null;
    localPort = 0;
    if (processToStop && !processToStop.killed && processToStop.exitCode === null) {
      let stopTimer;
      const exited = new Promise((resolve) => processToStop.once('exit', resolve));
      processToStop.kill('SIGTERM');
      await Promise.race([
        exited,
        new Promise((resolve) => {
          stopTimer = setTimeout(resolve, 2_000);
          stopTimer.unref?.();
        }),
      ]);
      if (stopTimer) clearTimeout(stopTimer);
      if (processToStop.exitCode === null && !processToStop.killed) processToStop.kill('SIGKILL');
    }
    return { ok: true };
  };

  const validateLocalRuntime = async () => {
    if (typeof pythonValue !== 'string' || !pythonValue.trim() || typeof scriptValue !== 'string' || !scriptValue.trim()) {
      throw sam3Error(
        'Local SAM 3 requires CINEGEN_SAM3_PYTHON and CINEGEN_SAM3_SCRIPT.',
        'SAM3_NOT_CONFIGURED',
        501,
      );
    }
    const python = pythonValue.trim();
    if (!path.isAbsolute(python) && !SAFE_COMMAND.test(python)) {
      throw sam3Error('Configured SAM 3 Python command is invalid.', 'INVALID_SAM3_CONTEXT', 500);
    }
    const cwd = path.resolve(cwdValue || path.dirname(path.resolve(scriptValue)));
    const script = path.resolve(cwd, scriptValue);
    const [scriptStats, cwdStats] = await Promise.all([fsp.stat(script), fsp.stat(cwd)]).catch((cause) => {
      throw sam3Error('Configured SAM 3 runtime files were not found.', 'SAM3_NOT_CONFIGURED', 501, cause);
    });
    if (!scriptStats.isFile() || !cwdStats.isDirectory()) {
      throw sam3Error('Configured SAM 3 runtime paths are invalid.', 'SAM3_NOT_CONFIGURED', 501);
    }
    if (path.isAbsolute(python)) {
      const pythonStats = await fsp.stat(python).catch((cause) => {
        throw sam3Error('Configured SAM 3 Python runtime was not found.', 'SAM3_NOT_CONFIGURED', 501, cause);
      });
      if (!pythonStats.isFile()) throw sam3Error('Configured SAM 3 Python runtime is invalid.', 'SAM3_NOT_CONFIGURED', 501);
    }
    return { python, script, cwd };
  };

  const startInternal = async () => {
    if (status().running) {
      scheduleIdle();
      return status();
    }
    if (remoteBase) {
      if (!await healthCheck()) throw sam3Error('Remote SAM 3 health check failed.', 'SAM3_START_FAILED', 502);
      remoteRunning = true;
      scheduleIdle();
      return status();
    }

    const runtime = await validateLocalRuntime();
    localPort = await portAllocator();
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
      localPort = 0;
      throw sam3Error('SAM 3 port allocator returned an invalid port.', 'SAM3_PORT_UNAVAILABLE', 500);
    }
    const extraArgs = Array.isArray(options.localArgs)
      ? options.localArgs.map((value) => requireString(value, 'SAM 3 runtime argument', { maxLength: 4_096 }))
      : [];
    let childStartError = null;
    try {
      const spawned = spawnProcess(runtime.python, [runtime.script, '--port', String(localPort), ...extraArgs], {
        cwd: runtime.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(options.spawnEnv || {}), PYTORCH_ENABLE_MPS_FALLBACK: '1' },
      });
      child = spawned;
      spawned.once('error', (cause) => {
        childStartError = cause;
        if (child === spawned) {
          child = null;
          localPort = 0;
          sessionOwners.clear();
          imageOwnerProjectId = null;
          clearIdle();
        }
      });
      spawned.once('exit', () => {
        if (child === spawned) {
          child = null;
          localPort = 0;
          sessionOwners.clear();
          imageOwnerProjectId = null;
          clearIdle();
        }
      });
      spawned.stdout?.on('data', () => {});
      spawned.stderr?.on('data', () => {});
    } catch (cause) {
      localPort = 0;
      throw sam3Error('Could not start the local SAM 3 runtime.', 'SAM3_START_FAILED', 502, cause);
    }

    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (!child || child.killed || child.exitCode !== null) break;
      try {
        if (await healthCheck()) {
          scheduleIdle();
          return status();
        }
      } catch {
        // Runtime is still loading.
      }
      await delay(healthPollIntervalMs);
    }
    await stop();
    throw sam3Error(
      childStartError ? 'The configured SAM 3 runtime could not be launched.' : 'SAM 3 server failed its startup health check.',
      'SAM3_START_FAILED',
      childStartError ? 502 : 504,
      childStartError,
    );
  };

  const start = async () => {
    if (!startPromise) {
      startPromise = startInternal().finally(() => { startPromise = null; });
    }
    return startPromise;
  };

  const getPort = async () => status();

  const resolveProjectMedia = async (reference) => {
    if (typeof reference !== 'string' || !reference.startsWith('/media/')) {
      throw sam3Error('SAM 3 local path fields must use a web /media/... reference.', 'INVALID_MEDIA_PATH');
    }
    if (typeof options.pathForMediaReference !== 'function') {
      throw sam3Error('SAM 3 media reference resolver is unavailable.', 'INVALID_SAM3_CONTEXT', 500);
    }
    let resolved;
    try {
      resolved = await options.pathForMediaReference(reference);
    } catch (cause) {
      throw sam3Error('SAM 3 media reference is malformed.', 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof resolved !== 'string' || !isPathInside(mediaRoot, resolved)) {
      throw sam3Error('SAM 3 media reference is outside the web media directory.', 'INVALID_MEDIA_PATH');
    }
    let realMediaRoot;
    let realPath;
    try {
      [realMediaRoot, realPath] = await Promise.all([fsp.realpath(mediaRoot), fsp.realpath(resolved)]);
      const stats = await fsp.stat(realPath);
      if (!stats.isFile()) throw sam3Error('SAM 3 media reference must point to a file.', 'INVALID_MEDIA_PATH');
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      if (cause?.code === 'ENOENT') throw sam3Error('SAM 3 media file was not found.', 'MEDIA_NOT_FOUND', 404, cause);
      throw cause;
    }
    const realProjectsRoot = pathInside(realMediaRoot, 'projects');
    if (!isPathInside(realProjectsRoot, realPath)) {
      throw sam3Error('SAM 3 only accepts media owned by a CineGen project.', 'INVALID_MEDIA_PATH');
    }
    const projectId = path.relative(realProjectsRoot, realPath).split(path.sep)[0];
    if (!SAFE_ID.test(projectId)) throw sam3Error('SAM 3 media has an invalid project id.', 'INVALID_MEDIA_PATH');
    if (store && typeof store.load === 'function') {
      try {
        await store.load(projectId);
      } catch (cause) {
        throw sam3Error('SAM 3 media does not belong to an available project.', 'PROJECT_MEDIA_MISMATCH', 403, cause);
      }
    }
    return { filePath: realPath, projectId };
  };

  const rewriteLocalPaths = async (value, ownership, depth = 0) => {
    if (depth > 32) throw sam3Error('SAM 3 JSON body is too deeply nested.', 'INVALID_SAM3_BODY');
    if (Array.isArray(value)) {
      if (value.length > 100_000) throw sam3Error('SAM 3 JSON array is too large.', 'INVALID_SAM3_BODY');
      return Promise.all(value.map((entry) => rewriteLocalPaths(entry, ownership, depth + 1)));
    }
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw sam3Error('SAM 3 JSON body contains an unsafe key.', 'INVALID_SAM3_BODY');
      }
      if (PATH_BODY_KEYS.has(key)) {
        if (remoteBase) {
          throw sam3Error(
            `Remote SAM 3 cannot read ${key}; use a remotely accessible URL field.`,
            'REMOTE_MEDIA_UNAVAILABLE',
            422,
          );
        }
        const resolved = await resolveProjectMedia(entry);
        ownership.projectIds.add(resolved.projectId);
        result[key] = resolved.filePath;
      } else if (key === 'session_id' && typeof entry === 'string') {
        if (entry.length > 512) throw sam3Error('SAM 3 session id is too long.', 'INVALID_SAM3_BODY');
        ownership.sessionIds.add(entry);
        const owner = sessionOwners.get(entry);
        if (owner) ownership.projectIds.add(owner);
        result[key] = entry;
      } else {
        result[key] = await rewriteLocalPaths(entry, ownership, depth + 1);
      }
    }
    return result;
  };

  const prepareBody = async (request) => {
    const encoding = request.headers['content-encoding'];
    if (encoding && String(encoding).toLowerCase() !== 'identity') {
      throw sam3Error('Compressed SAM 3 request bodies are not accepted.', 'UNSUPPORTED_CONTENT_ENCODING', 415);
    }
    const body = await readRequestBody(request, maxRequestBytes);
    const ownership = { projectIds: new Set(), sessionIds: new Set() };
    if (!body) return { body: null, ownership };
    const contentType = String(request.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) return { body, ownership };
    let json;
    try {
      json = JSON.parse(body.toString('utf8'));
    } catch (cause) {
      throw sam3Error('SAM 3 request body must contain valid JSON.', 'INVALID_SAM3_BODY', 400, cause);
    }
    const rewritten = await rewriteLocalPaths(json, ownership);
    if (ownership.projectIds.size > 1) {
      throw sam3Error('SAM 3 request combines media from different projects.', 'PROJECT_MEDIA_MISMATCH', 403);
    }
    return { body: Buffer.from(JSON.stringify(rewritten), 'utf8'), ownership };
  };

  const safeOutputName = (value) => {
    const base = path.basename(String(value || 'sam3-output.bin')).normalize('NFKC');
    const safe = base.replace(/[^A-Za-z0-9._() -]+/g, '_').replace(/^\.+/, '').slice(0, 180);
    return safe || 'sam3-output.bin';
  };

  const urlForMediaPath = async (filePath) => {
    const resolved = path.resolve(filePath);
    if (!isPathInside(mediaRoot, resolved)) {
      throw sam3Error('Attempted to expose a SAM 3 file outside web media storage.', 'INVALID_MEDIA_PATH', 500);
    }
    const url = typeof options.mediaUrlForPath === 'function'
      ? await options.mediaUrlForPath(resolved)
      : `/media/${path.relative(mediaRoot, resolved).split(path.sep).map(encodeURIComponent).join('/')}`;
    if (typeof url !== 'string' || !url.startsWith('/media/')) {
      throw sam3Error('SAM 3 media URL mapper returned an unsafe URL.', 'INVALID_MEDIA_URL', 500);
    }
    return url;
  };

  const outputIsTrusted = async (realPath, realMediaRoot) => {
    if (isPathInside(realMediaRoot, realPath)) return { temporary: false };
    const realTempRoot = await fsp.realpath(os.tmpdir());
    if (isPathInside(realTempRoot, realPath)) {
      const firstSegment = path.relative(realTempRoot, realPath).split(path.sep)[0];
      if (firstSegment.startsWith('sam3-')) return { temporary: true };
    }
    for (const configuredRoot of configuredOutputRoots) {
      let realRoot;
      try {
        realRoot = await fsp.realpath(configuredRoot);
      } catch {
        continue;
      }
      if (isPathInside(realRoot, realPath)) return { temporary: false };
    }
    throw sam3Error(
      'SAM 3 returned a file outside its approved output directories.',
      'SAM3_OUTPUT_PATH_FORBIDDEN',
      502,
    );
  };

  const copyLocalOutput = async (value, projectId, requestId, outputCache) => {
    if (!projectId) {
      throw sam3Error('SAM 3 output could not be associated with a project.', 'SAM3_OUTPUT_UNOWNED', 502);
    }
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      throw sam3Error('SAM 3 returned an invalid local output path.', 'SAM3_OUTPUT_PATH_FORBIDDEN', 502);
    }
    let realPath;
    let realMediaRoot;
    try {
      [realPath, realMediaRoot] = await Promise.all([fsp.realpath(value), fsp.realpath(mediaRoot)]);
      const handle = await fsp.open(realPath, 'r');
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw sam3Error('SAM 3 output path is not a file.', 'SAM3_OUTPUT_PATH_FORBIDDEN', 502);
        if (stats.size > maxOutputFileBytes) {
          throw sam3Error('SAM 3 output file is too large.', 'SAM3_OUTPUT_TOO_LARGE', 502);
        }
      } finally {
        await handle.close();
      }
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      throw sam3Error('SAM 3 output file is missing or unreadable.', 'SAM3_OUTPUT_UNREADABLE', 502, cause);
    }
    const cached = outputCache.get(realPath);
    if (cached) return cached;
    const trust = await outputIsTrusted(realPath, realMediaRoot);
    const destinationDir = pathInside(
      mediaRoot,
      'projects',
      projectId,
      'generated',
      'sam3',
      requestId,
    );
    await fsp.mkdir(destinationDir, { recursive: true });
    const destination = pathInside(
      destinationDir,
      `${crypto.randomUUID().slice(0, 8)}-${safeOutputName(realPath)}`,
    );
    await fsp.copyFile(realPath, destination);
    const url = await urlForMediaPath(destination);
    outputCache.set(realPath, url);
    if (trust.temporary) {
      await fsp.rm(realPath, { force: true }).catch(() => {});
      await fsp.rmdir(path.dirname(realPath)).catch(() => {});
    }
    return url;
  };

  const preserveRemoteOutput = async (value) => {
    if (typeof value !== 'string') {
      throw sam3Error('Remote SAM 3 returned an invalid output reference.', 'SAM3_REMOTE_OUTPUT_UNSAFE', 502);
    }
    if (/^data:(image|video)\/[A-Za-z0-9.+-]+;base64,/i.test(value)) return value;
    let url;
    try {
      url = new URL(value);
    } catch (cause) {
      throw sam3Error('Remote SAM 3 returned a non-public output path.', 'SAM3_REMOTE_OUTPUT_UNSAFE', 502, cause);
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw sam3Error('Remote SAM 3 output must be a public HTTPS URL or data URI.', 'SAM3_REMOTE_OUTPUT_UNSAFE', 502);
    }
    await resolveRemoteAddress(url);
    return url.href;
  };

  const rewriteResponsePaths = async (value, state, depth = 0, collection = false) => {
    if (depth > 32) throw sam3Error('SAM 3 response is too deeply nested.', 'INVALID_SAM3_RESPONSE', 502);
    if (collection) {
      if (!Array.isArray(value)) throw sam3Error('SAM 3 returned an invalid output path collection.', 'INVALID_SAM3_RESPONSE', 502);
      return Promise.all(value.map(async (entry) => {
        if (entry === null) return null;
        return remoteBase
          ? preserveRemoteOutput(entry)
          : copyLocalOutput(entry, state.projectId, state.requestId, state.outputCache);
      }));
    }
    if (Array.isArray(value)) return Promise.all(value.map((entry) => rewriteResponsePaths(entry, state, depth + 1)));
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw sam3Error('SAM 3 response contains an unsafe key.', 'INVALID_SAM3_RESPONSE', 502);
      }
      if (OUTPUT_PATH_KEYS.has(key) && entry !== null && entry !== '') {
        result[key] = remoteBase
          ? await preserveRemoteOutput(entry)
          : await copyLocalOutput(entry, state.projectId, state.requestId, state.outputCache);
      } else if (OUTPUT_PATH_COLLECTION_KEYS.has(key) && entry !== null) {
        result[key] = await rewriteResponsePaths(entry, state, depth + 1, true);
      } else {
        result[key] = await rewriteResponsePaths(entry, state, depth + 1);
      }
    }
    return result;
  };

  const handleHttp = async (request, response) => {
    if (!ALLOWED_METHODS.has(request.method || '')) {
      throw sam3Error('HTTP method is not allowed by the SAM 3 proxy.', 'METHOD_NOT_ALLOWED', 405);
    }
    const proxyTarget = validateProxyTarget(request.url || '');
    clearIdle();
    activeRequests += 1;
    try {
      const prepared = request.method === 'GET' || request.method === 'HEAD'
        ? { body: null, ownership: { projectIds: new Set(), sessionIds: new Set() } }
        : await prepareBody(request);
      if (!remoteBase) {
        for (const sessionId of prepared.ownership.sessionIds) {
          if (!sessionOwners.has(sessionId)) {
            throw sam3Error('SAM 3 video session is unknown or expired.', 'SAM3_SESSION_NOT_FOUND', 404);
          }
        }
      }
      const routePath = `/${proxyTarget.segments.join('/')}`;
      const ownedProjects = [...prepared.ownership.projectIds];
      let requestProjectId = ownedProjects[0] || null;
      if (!requestProjectId && !remoteBase && (
        routePath === '/segment'
        || routePath === '/postprocess'
        || routePath === '/extract'
      )) {
        requestProjectId = imageOwnerProjectId;
      }
      await start();
      const target = createTargetUrl(backendBase(), proxyTarget);
      const upstream = await openUpstream({
        url: target,
        method: request.method,
        headers: requestHeaders(request, remoteBase ? remoteHeaders : {}, prepared.body),
        body: prepared.body,
      });
      upstream.setTimeout(requestTimeoutMs, () => upstream.destroy(sam3Error('SAM 3 response timed out.', 'SAM3_TIMEOUT', 504)));
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.destroy();
        throw sam3Error('SAM 3 upstream redirects are not allowed.', 'SAM3_REDIRECT_BLOCKED', 502);
      }
      const declaredLength = Number(upstream.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        upstream.destroy();
        throw sam3Error('SAM 3 response is too large.', 'SAM3_RESPONSE_TOO_LARGE', 502);
      }
      if (request.method === 'HEAD') {
        response.writeHead(upstream.statusCode || 502, responseHeaders(upstream));
        upstream.destroy();
        response.end();
        return true;
      }
      const contentType = String(upstream.headers['content-type'] || '').toLowerCase();
      const isJson = contentType.includes('application/json') || contentType.includes('+json');
      if (isJson) {
        const encoding = String(upstream.headers['content-encoding'] || 'identity').toLowerCase();
        if (encoding !== 'identity') {
          upstream.destroy();
          throw sam3Error('Compressed SAM 3 JSON responses are not accepted.', 'UNSUPPORTED_CONTENT_ENCODING', 502);
        }
        if (Number.isFinite(declaredLength) && declaredLength > maxJsonResponseBytes) {
          upstream.destroy();
          throw sam3Error('SAM 3 JSON response is too large to validate.', 'SAM3_RESPONSE_TOO_LARGE', 502);
        }
        const raw = await collectResponse(
          upstream,
          maxJsonResponseBytes,
          'SAM 3 JSON response is too large to validate.',
        );
        let parsed;
        try {
          parsed = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null;
        } catch (cause) {
          throw sam3Error('SAM 3 returned malformed JSON.', 'INVALID_SAM3_RESPONSE', 502, cause);
        }
        const successful = upstream.statusCode >= 200 && upstream.statusCode < 300;
        if (!remoteBase && successful && routePath === '/video/start-session') {
          if (!requestProjectId || typeof parsed?.session_id !== 'string' || !parsed.session_id || parsed.session_id.length > 512) {
            throw sam3Error('SAM 3 returned an invalid video session.', 'INVALID_SAM3_RESPONSE', 502);
          }
          sessionOwners.set(parsed.session_id, requestProjectId);
        }
        if (!remoteBase && successful && routePath === '/set-image') {
          if (!requestProjectId) throw sam3Error('SAM 3 image session has no project owner.', 'SAM3_OUTPUT_UNOWNED', 502);
          imageOwnerProjectId = requestProjectId;
        }
        const rewritten = await rewriteResponsePaths(parsed, {
          projectId: requestProjectId,
          requestId: crypto.randomUUID(),
          outputCache: new Map(),
        });
        if (!remoteBase && successful && routePath === '/video/close-session') {
          for (const sessionId of prepared.ownership.sessionIds) sessionOwners.delete(sessionId);
        }
        const encoded = Buffer.from(JSON.stringify(rewritten), 'utf8');
        const headers = responseHeaders(upstream);
        delete headers['content-encoding'];
        delete headers['content-length'];
        headers['content-length'] = String(encoded.length);
        response.writeHead(upstream.statusCode || 502, headers);
        response.end(encoded);
        return true;
      }
      response.writeHead(upstream.statusCode || 502, responseHeaders(upstream));
      let bytes = 0;
      for await (const chunk of upstream) {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          upstream.destroy();
          response.destroy(sam3Error('SAM 3 response exceeded its safe size limit.', 'SAM3_RESPONSE_TOO_LARGE', 502));
          return true;
        }
        if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve));
      }
      response.end();
      return true;
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
      scheduleIdle();
    }
  };

  return {
    handlers: { start, stop, getPort },
    handleHttp,
    close: stop,
  };
}
