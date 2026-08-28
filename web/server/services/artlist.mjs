import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ServiceError } from './_shared.mjs';

export const ARTLIST_MCP_URL = 'https://mcp.artlist.io/mcp';
const ARTLIST_RESOURCE = 'https://mcp.artlist.io/';
const ARTLIST_AUTH_BASE = 'https://auth.artlist.io';
const OAUTH_AUTHORIZE_URL = `${ARTLIST_AUTH_BASE}/authorize`;
const OAUTH_TOKEN_URL = `${ARTLIST_AUTH_BASE}/oauth/token`;
const OAUTH_REVOKE_URL = `${ARTLIST_AUTH_BASE}/oauth/revoke`;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_INLINE_REFERENCE_BYTES = 15 * 1024 * 1024;
const VIDEO_URL_PATTERN = /https?:\/\/[^\s"'<>]+(?:\.mp4|\.mov|\.webm)(?:\?[^\s"'<>]*)?/i;

const MIME_BY_EXTENSION = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

function serviceError(message, code, statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOrigin(value, configuredPublicBaseUrl) {
  let origin;
  try {
    origin = new URL(String(value || '')).origin;
  } catch {
    throw serviceError('CineGen could not determine a safe OAuth return address.', 'ARTLIST_INVALID_ORIGIN');
  }
  const parsed = new URL(origin);
  const local = parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const configured = configuredPublicBaseUrl
    ? origin === new URL(configuredPublicBaseUrl).origin
    : false;
  if (!local && !configured) {
    throw serviceError(
      'Artlist login requires an approved HTTPS CineGen origin.',
      'ARTLIST_INVALID_ORIGIN',
      403,
    );
  }
  return origin;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function callbackHtml({ success, message }) {
  const title = success ? 'Artlist connected' : 'Artlist connection failed';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f2eee8;font-family:system-ui,sans-serif}
main{width:min(440px,calc(100vw - 48px));padding:34px;border:1px solid #343239;border-radius:22px;background:#191a20;box-shadow:0 24px 80px #0008}
small{color:#d7a552;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;margin:10px 0 8px}p{color:#aaa6a0;line-height:1.55;margin:0}
</style></head><body><main><small>CineGen + Artlist</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>
<script>if(window.opener){window.opener.postMessage({type:'cinegen:artlist-oauth',success:${success ? 'true' : 'false'}},window.location.origin)}setTimeout(()=>window.close(),900)</script>
</body></html>`;
}

async function writeAtomic(filePath, contents, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { mode });
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, mode).catch(() => {});
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function responseError(status, payload, fallback) {
  const detail = isRecord(payload)
    ? payload.error_description || payload.message || payload.error
    : undefined;
  return serviceError(
    typeof detail === 'string' && detail.trim() ? detail.trim() : fallback,
    status === 401 ? 'ARTLIST_AUTH_REQUIRED' : 'ARTLIST_REMOTE_ERROR',
    status === 401 ? 401 : 502,
  );
}

async function readRemoteResponse(response) {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function parseSse(text, expectedId) {
  const messages = [];
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try { messages.push(JSON.parse(data)); } catch { /* Ignore keepalives. */ }
  }
  return messages.find((message) => message?.id === expectedId)
    ?? messages.find((message) => message?.error || message?.result)
    ?? messages.at(-1);
}

function allStrings(value, depth = 0, output = []) {
  if (depth > 12 || value === null || value === undefined) return output;
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) allStrings(item, depth + 1, output);
    return output;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) allStrings(item, depth + 1, output);
  }
  return output;
}

function findIdentifier(value) {
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findIdentifier(nested);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of ['generationId', 'generation_id', 'jobId', 'job_id', 'taskId', 'task_id', 'id']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  for (const nested of Object.values(value)) {
    if (isRecord(nested)) {
      const found = findIdentifier(nested);
      if (found) return found;
    }
  }
  return undefined;
}

function findExplicitVideoUrl(value) {
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findExplicitVideoUrl(nested);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.type === 'video' && typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) return value.url;
  if (typeof value.uri === 'string' && /^video\//i.test(String(value.mimeType || value.mime_type || ''))) return value.uri;
  for (const [key, nested] of Object.entries(value)) {
    if (
      typeof nested === 'string'
      && /^https?:\/\//i.test(nested)
      && /^(url|video_?url|download_?url|media_?url|output_?url|asset_?url)$/i.test(key)
      && !/account|session/i.test(key)
    ) return nested;
    const found = findExplicitVideoUrl(nested);
    if (found) return found;
  }
  return undefined;
}

export function parseArtlistMcpResult(result) {
  const strings = allStrings(result);
  const directVideo = strings.map((value) => value.match(VIDEO_URL_PATTERN)?.[0]).find(Boolean);
  const url = directVideo || findExplicitVideoUrl(result);
  const generationId = findIdentifier(result);
  if (!url) return { generationId };
  const accountUrl = strings.find((value) => /^https?:\/\//i.test(value) && /artlist\.io/i.test(value) && value !== url);
  return {
    url,
    mediaType: 'video',
    ...(generationId ? { generationId } : {}),
    ...(accountUrl ? { accountUrl } : {}),
  };
}

function toolScore(tool) {
  const text = `${tool?.name || ''} ${tool?.description || ''} ${JSON.stringify(tool?.inputSchema || {})}`.toLowerCase();
  let score = 0;
  if (/video/.test(text)) score += 12;
  if (/generat|creat|render|media/.test(text)) score += 8;
  if (/image.to.video|text.to.video|video generation/.test(text)) score += 8;
  if (/search|list|catalog|recommend|delete|remove/.test(text)) score -= 10;
  return score;
}

export function selectArtlistVideoTool(tools) {
  const candidates = Array.isArray(tools) ? tools.filter((tool) => isRecord(tool)) : [];
  return candidates.sort((a, b) => toolScore(b) - toolScore(a))[0];
}

function enumValue(schema, pattern, fallback) {
  const values = Array.isArray(schema?.enum) ? schema.enum : [];
  return values.find((value) => typeof value === 'string' && pattern.test(value)) ?? fallback;
}

function buildBrief(params) {
  const references = (params.medias ?? []).length;
  return [
    params.prompt.trim(),
    `Create one finished video. Duration: ${Math.max(1, Math.round(params.durationSec ?? 5))} seconds.`,
    `Aspect ratio: ${params.aspectRatio?.trim() || '16:9'}. Resolution: ${params.resolution?.trim() || '720p'}.`,
    `Generated audio: ${params.generateAudio ? 'on' : 'off'}.`,
    params.model?.trim() && params.model.trim() !== 'auto' ? `Use model: ${params.model.trim()}.` : '',
    references ? `Use all ${references} attached reference image${references === 1 ? '' : 's'} and preserve their identity and design details.` : '',
  ].filter(Boolean).join('\n');
}

function propertyKind(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^(prompt|instruction|instructions|request|description|brief|message|query)$/.test(normalized)) return 'prompt';
  if (/^(mediatype|outputtype|generationtype|kind|type)$/.test(normalized)) return 'type';
  if (/model/.test(normalized)) return 'model';
  if (/duration|length/.test(normalized)) return 'duration';
  if (/aspect|ratio/.test(normalized)) return 'aspect';
  if (/resolution|quality/.test(normalized)) return 'resolution';
  if (/audio|sound/.test(normalized)) return 'audio';
  if (/reference|references|images|media|attachments|ingredients/.test(normalized) && !/type/.test(normalized)) return 'references';
  return 'unknown';
}

function primitiveForSchema(schema) {
  if (schema?.default !== undefined) return schema.default;
  if (Array.isArray(schema?.enum) && schema.enum.length) return schema.enum[0];
  if (schema?.type === 'boolean') return false;
  if (schema?.type === 'number' || schema?.type === 'integer') return schema.minimum ?? 1;
  if (schema?.type === 'array') return [];
  if (schema?.type === 'object') return {};
  return undefined;
}

async function referenceForSchema(reference, schema, context) {
  let url = reference.value;
  let base64;
  let mimeType;
  let name;
  if (typeof url === 'string' && (url.startsWith('/media/') || /^https?:\/\//i.test(url))) {
    let localPath;
    try { localPath = context.pathForMediaReference?.(url); } catch { localPath = undefined; }
    if (localPath) {
      name = path.basename(localPath);
      mimeType = MIME_BY_EXTENSION.get(path.extname(localPath).toLowerCase()) || 'application/octet-stream';
      if (context.publicBaseUrl) {
        const pathname = /^https?:\/\//i.test(url) ? new URL(url).pathname : url;
        url = new URL(pathname, context.publicBaseUrl).href;
      } else {
        const stats = await fs.stat(localPath);
        if (stats.size > MAX_INLINE_REFERENCE_BYTES) {
          throw serviceError(
            'This Artlist reference is too large to send from localhost. Configure CINEGEN_PUBLIC_BASE_URL or use a smaller element image.',
            'ARTLIST_REFERENCE_TOO_LARGE',
            413,
          );
        }
        base64 = (await fs.readFile(localPath)).toString('base64');
        url = `data:${mimeType};base64,${base64}`;
      }
    }
  }

  if (schema?.type !== 'object' || !isRecord(schema.properties)) return url;
  const output = {};
  for (const [key, child] of Object.entries(schema.properties)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/^(url|uri|source|sourceurl|imageurl|mediaurl|value)$/.test(normalized)) output[key] = url;
    else if (/^(data|base64|content)$/.test(normalized)) {
      if (!base64 && typeof url === 'string' && url.startsWith('data:')) base64 = url.split(',', 2)[1];
      if (base64) output[key] = base64;
    } else if (/^(mimetype|contenttype|type)$/.test(normalized) && mimeType) output[key] = mimeType;
    else if (/^(name|filename)$/.test(normalized) && name) output[key] = name;
    else if (/^(role|purpose)$/.test(normalized)) output[key] = reference.role || 'reference';
  }
  return Object.keys(output).length ? output : url;
}

export async function buildArtlistToolArguments(tool, params, context = {}) {
  const schema = isRecord(tool?.inputSchema) ? tool.inputSchema : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const output = {};
  const brief = buildBrief(params);
  let promptAssigned = false;
  let referencesAssigned = false;

  for (const [key, childSchema] of Object.entries(properties)) {
    const kind = propertyKind(key);
    if (kind === 'prompt') {
      output[key] = brief;
      promptAssigned = true;
    } else if (kind === 'type') {
      output[key] = enumValue(childSchema, /video/i, 'video');
    } else if (kind === 'model' && params.model?.trim() && params.model.trim() !== 'auto') {
      output[key] = params.model.trim();
    } else if (kind === 'duration') {
      output[key] = Math.max(1, Math.round(params.durationSec ?? 5));
    } else if (kind === 'aspect') {
      output[key] = params.aspectRatio?.trim() || '16:9';
    } else if (kind === 'resolution') {
      output[key] = params.resolution?.trim() || enumValue(childSchema, /720/i, '720p');
    } else if (kind === 'audio') {
      output[key] = Boolean(params.generateAudio);
    } else if (kind === 'references' && (params.medias?.length ?? 0) > 0) {
      const references = [...new Map(params.medias.map((entry) => [entry.value, entry])).values()].slice(0, 3);
      const itemSchema = childSchema?.type === 'array' ? childSchema.items : childSchema;
      const values = await Promise.all(references.map((entry) => referenceForSchema(entry, itemSchema, context)));
      output[key] = childSchema?.type === 'array' ? values : values[0];
      referencesAssigned = true;
    } else if (required.has(key)) {
      const fallback = primitiveForSchema(childSchema);
      if (fallback !== undefined) output[key] = fallback;
    }
  }

  if (!promptAssigned) {
    const stringEntry = Object.entries(properties).find(([key, child]) => (
      child?.type === 'string' && !Object.hasOwn(output, key)
    ));
    if (stringEntry) {
      output[stringEntry[0]] = brief;
      promptAssigned = true;
    }
  }
  if (!promptAssigned && Object.keys(properties).length === 0) output.prompt = brief;
  if ((params.medias?.length ?? 0) > 0 && !referencesAssigned) {
    throw serviceError(
      `Artlist's current ${tool.name} tool does not expose a reference-image input. Choose another Artlist model or generate without elements.`,
      'ARTLIST_REFERENCES_UNSUPPORTED',
      422,
    );
  }
  return output;
}

function pollingTool(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => /status|poll|get.*generation|get.*job|result/i.test(`${tool?.name || ''} ${tool?.description || ''}`))
    .sort((a, b) => (/poll|status/i.test(b.name) ? 1 : 0) - (/poll|status/i.test(a.name) ? 1 : 0))[0];
}

function pollingArguments(tool, id) {
  const properties = isRecord(tool?.inputSchema?.properties) ? tool.inputSchema.properties : {};
  const key = Object.keys(properties).find((name) => /generation.*id|job.*id|task.*id|^id$/i.test(name))
    ?? Object.keys(properties)[0]
    ?? 'id';
  return { [key]: id };
}

class EncryptedStore {
  constructor(root, secret) {
    this.root = root;
    this.keyPath = path.join(root, 'local-secret.key');
    this.secret = secret;
  }

  async key() {
    if (this.secret) return sha256(this.secret);
    try {
      const existing = await fs.readFile(this.keyPath);
      if (existing.length === 32) return existing;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const generated = crypto.randomBytes(32);
    await fs.mkdir(this.root, { recursive: true });
    try {
      await fs.writeFile(this.keyPath, generated, { flag: 'wx', mode: 0o600 });
      return generated;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      return fs.readFile(this.keyPath);
    }
  }

  async read(name) {
    try {
      const envelope = JSON.parse(await fs.readFile(path.join(this.root, `${name}.enc.json`), 'utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]);
      return JSON.parse(clear.toString('utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(name, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', await this.key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    });
    await writeAtomic(path.join(this.root, `${name}.enc.json`), `${envelope}\n`);
  }

  async remove(name) {
    await fs.unlink(path.join(this.root, `${name}.enc.json`)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

export function createArtlistService(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const integrationRoot = path.join(options.dataRoot, 'integrations', 'artlist');
  const store = new EncryptedStore(integrationRoot, options.tokenSecret ?? process.env.CINEGEN_ARTLIST_TOKEN_SECRET);
  const publicBaseUrl = options.publicBaseUrl ?? process.env.CINEGEN_PUBLIC_BASE_URL;
  const configuredClientId = options.clientId ?? process.env.CINEGEN_ARTLIST_CLIENT_ID;
  const configuredClientSecret = options.clientSecret ?? process.env.CINEGEN_ARTLIST_CLIENT_SECRET;
  const configuredMetadataUrl = options.clientMetadataUrl ?? process.env.CINEGEN_ARTLIST_CLIENT_METADATA_URL;
  const generationTimeoutMs = options.generationTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function requestJson(url, init, fallback) {
    let response;
    try { response = await fetchImpl(url, init); } catch (cause) {
      throw serviceError('Could not reach Artlist. Check the server connection and try again.', 'ARTLIST_UNREACHABLE', 502, cause);
    }
    const payload = await readRemoteResponse(response);
    if (!response.ok) throw responseError(response.status, payload, fallback);
    return payload;
  }

  async function resolveClient(redirectUri, origin) {
    let clientId = configuredClientId || configuredMetadataUrl;
    if (!clientId && publicBaseUrl) {
      const publicOrigin = new URL(publicBaseUrl).origin;
      if (origin === publicOrigin && new URL(publicBaseUrl).protocol === 'https:') {
        clientId = `${publicOrigin}/api/artlist/oauth/client-metadata`;
      }
    }
    if (!clientId) {
      throw serviceError(
        "Artlist can't authorize this localhost build yet. Connect from CineGen's hosted HTTPS site, or add an Artlist-issued OAuth client to the web server.",
        'ARTLIST_CLIENT_REGISTRATION_REQUIRED',
        422,
      );
    }
    const client = {
      client_id: clientId,
      ...(configuredClientSecret ? { client_secret: configuredClientSecret } : {}),
      token_endpoint_auth_method: configuredClientSecret ? 'client_secret_basic' : 'none',
      redirect_uri: redirectUri,
    };
    await store.write('client', client);
    return client;
  }

  function tokenRequestHeaders(client) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    if (client.client_secret && client.token_endpoint_auth_method !== 'none') {
      headers.Authorization = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`;
    }
    return headers;
  }

  async function exchangeToken(body, client) {
    const form = new URLSearchParams(body);
    if (!client.client_secret || client.token_endpoint_auth_method === 'none') form.set('client_id', client.client_id);
    return requestJson(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: tokenRequestHeaders(client),
      body: form,
    }, 'Artlist could not complete authorization.');
  }

  async function saveToken(payload, previous = {}) {
    if (!isRecord(payload) || typeof payload.access_token !== 'string') {
      throw serviceError('Artlist returned an invalid access token.', 'ARTLIST_OAUTH_INVALID', 502);
    }
    const token = {
      ...previous,
      ...payload,
      refresh_token: payload.refresh_token || previous.refresh_token,
      expires_at: now() + Math.max(30, Number(payload.expires_in || 3600)) * 1000,
    };
    await store.write('token', token);
    return token;
  }

  async function accessToken() {
    const token = await store.read('token');
    if (!token?.access_token) throw serviceError('Connect your Artlist account in Settings before generating.', 'ARTLIST_AUTH_REQUIRED', 401);
    if (!token.expires_at || token.expires_at > now() + 60_000) return token.access_token;
    if (!token.refresh_token) {
      await store.remove('token');
      throw serviceError('Your Artlist connection expired. Connect it again in Settings.', 'ARTLIST_AUTH_REQUIRED', 401);
    }
    const client = await store.read('client');
    if (!client?.client_id) throw serviceError('Reconnect Artlist to refresh authorization.', 'ARTLIST_AUTH_REQUIRED', 401);
    try {
      const refreshed = await exchangeToken({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        resource: ARTLIST_RESOURCE,
      }, client);
      return (await saveToken(refreshed, token)).access_token;
    } catch (error) {
      await store.remove('token');
      throw serviceError('Your Artlist connection expired. Connect it again in Settings.', 'ARTLIST_AUTH_REQUIRED', 401, error);
    }
  }

  async function mcpCall(token, message, sessionId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), generationTimeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(ARTLIST_MCP_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-06-18',
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      if ((response.headers.get('content-type') || '').includes('text/event-stream')) payload = parseSse(text, message.id);
      else if (text) {
        try { payload = JSON.parse(text); } catch { payload = text; }
      }
      if (!response.ok) throw responseError(response.status, payload, 'Artlist MCP request failed.');
      if (payload?.error) throw responseError(400, payload.error, 'Artlist MCP returned an error.');
      return { payload, sessionId: response.headers.get('mcp-session-id') || sessionId };
    } catch (error) {
      if (error?.name === 'AbortError') throw serviceError('Artlist generation timed out.', 'ARTLIST_TIMEOUT', 504, error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function createMcpSession(token) {
    const initialized = await mcpCall(token, {
      jsonrpc: '2.0',
      id: `init-${crypto.randomUUID()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'CineGen Web', version: '1.0.0' },
      },
    });
    await mcpCall(token, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, initialized.sessionId);
    return initialized.sessionId;
  }

  async function listTools(token, sessionId) {
    const listed = await mcpCall(token, {
      jsonrpc: '2.0', id: `tools-${crypto.randomUUID()}`, method: 'tools/list', params: {},
    }, sessionId);
    return listed.payload?.result?.tools ?? [];
  }

  async function callTool(token, sessionId, name, args) {
    const called = await mcpCall(token, {
      jsonrpc: '2.0',
      id: `call-${crypto.randomUUID()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }, sessionId);
    if (called.payload?.result?.isError) {
      const detail = allStrings(called.payload.result).join(' ').slice(0, 600);
      throw serviceError(detail || 'Artlist could not generate this video.', 'ARTLIST_GENERATION_FAILED', 422);
    }
    return called.payload?.result;
  }

  async function generate(params) {
    if (!isRecord(params) || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw serviceError('Artlist generation requires a prompt.', 'INVALID_INPUT');
    }
    const token = await accessToken();
    const sessionId = await createMcpSession(token);
    const tools = await listTools(token, sessionId);
    const tool = selectArtlistVideoTool(tools);
    if (!tool || toolScore(tool) < 1) {
      throw serviceError('The connected Artlist account did not expose a video-generation tool.', 'ARTLIST_VIDEO_UNAVAILABLE', 422);
    }
    const argumentsValue = await buildArtlistToolArguments(tool, params, {
      pathForMediaReference: options.pathForMediaReference,
      publicBaseUrl,
    });
    let result = await callTool(token, sessionId, tool.name, argumentsValue);
    let parsed = parseArtlistMcpResult(result);
    const poller = parsed.url ? null : pollingTool(tools);
    const deadline = now() + generationTimeoutMs;
    while (!parsed.url && parsed.generationId && poller && now() < deadline) {
      await sleep(3000);
      result = await callTool(token, sessionId, poller.name, pollingArguments(poller, parsed.generationId));
      parsed = { ...parsed, ...parseArtlistMcpResult(result) };
      if (/failed|error|cancelled/i.test(allStrings(result).join(' '))) {
        throw serviceError('Artlist could not complete this video generation.', 'ARTLIST_GENERATION_FAILED', 422);
      }
    }
    if (!parsed.url) {
      throw serviceError(
        'Artlist accepted the generation but did not return a downloadable video URL. Check the new MCP session in your Artlist account.',
        'ARTLIST_RESULT_UNAVAILABLE',
        502,
      );
    }
    return {
      ...parsed,
      durationSec: Math.max(1, Math.round(params.durationSec ?? 5)),
      ...(params.model?.trim() && params.model.trim() !== 'auto' ? { model: params.model.trim() } : {}),
    };
  }

  const handlers = {
    async accountStatus() {
      const token = await store.read('token');
      if (!token?.access_token) {
        const configured = Boolean(configuredClientId || configuredMetadataUrl || publicBaseUrl || await store.read('client'));
        return {
          connected: false,
          configured,
          ...(!configured ? {
            setupRequired: true,
            setupMessage: "Artlist must approve CineGen's web address before sign-in. Local testing cannot complete this connection yet.",
          } : {}),
        };
      }
      try {
        await accessToken();
        return { connected: true, configured: true };
      } catch (error) {
        return { connected: false, configured: true, error: error.message };
      }
    },

    async authLogin(originValue) {
      const origin = normalizeOrigin(originValue, publicBaseUrl);
      const redirectUri = `${origin}/api/artlist/oauth/callback`;
      const client = await resolveClient(redirectUri, origin);
      const verifier = base64Url(crypto.randomBytes(48));
      const challenge = base64Url(sha256(verifier));
      const state = base64Url(crypto.randomBytes(32));
      await store.write('pending', { state, verifier, redirectUri, createdAt: now() });
      const authorization = new URL(OAUTH_AUTHORIZE_URL);
      authorization.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope: 'openid offline_access',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: ARTLIST_RESOURCE,
      }).toString();
      return { connected: false, configured: true, authorizationUrl: authorization.href };
    },

    async authLogout() {
      const token = await store.read('token');
      const client = await store.read('client');
      if (token?.refresh_token && client?.client_id) {
        const body = new URLSearchParams({ token: token.refresh_token, client_id: client.client_id });
        await fetchImpl(OAUTH_REVOKE_URL, {
          method: 'POST', headers: tokenRequestHeaders(client), body,
        }).catch(() => {});
      }
      await Promise.all([store.remove('token'), store.remove('pending')]);
    },

    generate,
  };

  async function handleCallback(url, response) {
    const pending = await store.read('pending');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
    let success = false;
    let message;
    try {
      if (oauthError) throw serviceError(oauthError, 'ARTLIST_AUTH_DENIED', 400);
      if (!pending || !state || state !== pending.state || !code) {
        throw serviceError('The Artlist authorization response could not be verified. Please try connecting again.', 'ARTLIST_OAUTH_STATE', 400);
      }
      if (now() - pending.createdAt > 10 * 60 * 1000) {
        throw serviceError('The Artlist authorization request expired. Please try connecting again.', 'ARTLIST_OAUTH_EXPIRED', 400);
      }
      const client = await store.read('client');
      const token = await exchangeToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
        resource: ARTLIST_RESOURCE,
      }, client);
      await saveToken(token);
      success = true;
      message = 'You can close this window and return to CineGen.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Artlist authorization did not complete.';
    } finally {
      await store.remove('pending');
    }
    const body = callbackHtml({ success, message });
    response.writeHead(success ? 200 : 400, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    response.end(body);
  }

  function handleClientMetadata(response) {
    if (!publicBaseUrl || new URL(publicBaseUrl).protocol !== 'https:') {
      const body = JSON.stringify({ error: 'Artlist client metadata is only available on the configured HTTPS deployment.' });
      response.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    }
    const origin = new URL(publicBaseUrl).origin;
    const clientId = `${origin}/api/artlist/oauth/client-metadata`;
    const body = JSON.stringify({
      client_id: clientId,
      client_name: 'CineGen Web',
      client_uri: origin,
      redirect_uris: [`${origin}/api/artlist/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'public, max-age=300',
    });
    response.end(body);
  }

  return { handlers, handleCallback, handleClientMetadata };
}
