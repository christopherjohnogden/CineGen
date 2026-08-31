import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ServiceError, validatePublicUrl } from './_shared.mjs';

export const TOPVIEW_MCP_URL = 'https://mcp.topview.ai/mcp';
export const TOPVIEW_RESOURCE = 'https://mcp.topview.ai';

const TOPVIEW_AUTHORIZE_URL = 'https://www.topview.ai/mcp_oauth/oauth/authorize';
const TOPVIEW_TOKEN_URL = 'https://www.topview.ai/mcp_oauth/oauth/token';
const TOPVIEW_REGISTER_URL = 'https://www.topview.ai/mcp_oauth/oauth/register';
const TOPVIEW_USERINFO_URL = 'https://www.topview.ai/mcp_oauth/oauth/userinfo';
const TOPVIEW_SCOPES = 'openid email mcp:tools';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_GENERATION_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5 * 1000;
const MAX_REFERENCE_BYTES = 45 * 1024 * 1024;
const MAX_TOOL_PAGES = 10;

const MIME_BY_EXTENSION = new Map([
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['gif', 'image/gif'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/wav'],
  ['m4a', 'audio/mp4'],
]);

function serviceError(message, code, statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function normalizeOrigin(value, configuredPublicBaseUrl) {
  let origin;
  try {
    origin = new URL(String(value || '')).origin;
  } catch {
    throw serviceError('CineGen could not determine a safe OAuth return address.', 'TOPVIEW_INVALID_ORIGIN');
  }
  const parsed = new URL(origin);
  const local = parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const configuredUrl = configuredPublicBaseUrl ? new URL(configuredPublicBaseUrl) : undefined;
  const configured = configuredUrl
    ? configuredUrl.protocol === 'https:' && origin === configuredUrl.origin
    : false;
  if (!local && !configured) {
    throw serviceError(
      'Topview login requires this CineGen web address to be configured as the public HTTPS origin.',
      'TOPVIEW_INVALID_ORIGIN',
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
  const title = success ? 'Topview connected' : 'Topview connection failed';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f2eee8;font-family:system-ui,sans-serif}
main{width:min(440px,calc(100vw - 48px));padding:34px;border:1px solid #343239;border-radius:22px;background:#191a20;box-shadow:0 24px 80px #0008}
small{color:#d7a552;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;margin:10px 0 8px}p{color:#aaa6a0;line-height:1.55;margin:0}
</style></head><body><main><small>CineGen + Topview</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>
<script>if(window.opener){window.opener.postMessage({type:'cinegen:topview-oauth',success:${success ? 'true' : 'false'}},window.location.origin)}setTimeout(()=>window.close(),900)</script>
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

class EncryptedStore {
  constructor(root, secret) {
    this.root = root;
    this.keyPath = path.join(root, 'local-secret.key');
    this.secret = secret;
  }

  async key() {
    if (this.secret) return sha256(`cinegen:topview:${this.secret}`);
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
      decipher.setAAD(Buffer.from(`cinegen:topview:${name}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]).toString('utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(name, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', await this.key(), iv);
    cipher.setAAD(Buffer.from(`cinegen:topview:${name}`, 'utf8'));
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

async function readRemoteResponse(response) {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function errorDetail(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 1_000);
  if (isRecord(value)) {
    for (const key of ['error_description', 'message', 'errorMsg', 'error_msg', 'detail', 'error', 'reason']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0, 1_000);
    }
  }
  return fallback;
}

function responseError(status, payload, fallback) {
  return serviceError(
    errorDetail(payload, fallback),
    status === 401 ? 'TOPVIEW_AUTH_REQUIRED' : 'TOPVIEW_REMOTE_ERROR',
    status === 401 ? 401 : 502,
  );
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
  return messages.find((message) => isRecord(message) && message.id === expectedId)
    ?? messages.find((message) => isRecord(message) && (message.error !== undefined || message.result !== undefined))
    ?? messages.at(-1);
}

function collectRecords(value, output = [], depth = 0) {
  if (depth > 14 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output, depth + 1);
  } else if (isRecord(value)) {
    output.push(value);
    for (const item of Object.values(value)) collectRecords(item, output, depth + 1);
  }
  return output;
}

function collectStrings(value, output = [], depth = 0) {
  if (depth > 14 || value === null || value === undefined) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output, depth + 1);
  else if (isRecord(value)) for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
  return output;
}

export function parseTopviewToolDocuments(result) {
  const values = [result];
  if (!isRecord(result)) return values;
  if (result.structuredContent !== undefined) values.unshift(result.structuredContent);
  if (Array.isArray(result.content)) {
    for (const entry of result.content) {
      if (!isRecord(entry) || typeof entry.text !== 'string') continue;
      try { values.unshift(JSON.parse(entry.text)); } catch { values.push(entry.text); }
    }
  }
  return values;
}

function findStringByKeys(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return undefined;
}

export function topviewCreditBalance(value) {
  const wanted = new Set([
    'remaincredit', 'remain_credit', 'remainingcredit', 'remaining_credit',
    'availablecredit', 'available_credit', 'creditbalance', 'credit_balance',
    'credits', 'credit', 'balance',
  ]);
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (!wanted.has(key.toLowerCase())) continue;
      const number = typeof nested === 'number' ? nested : typeof nested === 'string' ? Number(nested) : Number.NaN;
      if (Number.isFinite(number)) return number;
    }
  }
  return undefined;
}

function findBoolean(value) {
  if (typeof value === 'boolean') return value;
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (/^(ok|success|exists|ready|verified)$/i.test(key) && typeof nested === 'boolean') return nested;
    }
  }
  return undefined;
}

function findArrayByKey(value, keyPattern) {
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (keyPattern.test(key) && Array.isArray(nested)) return nested;
    }
  }
  return undefined;
}

function findResultUrl(value) {
  const preferred = findStringByKeys(value, [
    'cloudFrontUrl', 'cloudfront_url', 'downloadUrl', 'download_url', 'videoUrl', 'video_url',
    'imageUrl', 'image_url', 'resultUrl', 'result_url', 'outputUrl', 'output_url',
    'mediaUrl', 'media_url', 'filePath', 'file_path', 'url',
  ]);
  if (preferred && /^https?:\/\//i.test(preferred)) return preferred;
  return collectStrings(value).find((entry) => (
    /^https?:\/\//i.test(entry)
    && (/\.(?:mp4|mov|webm|png|jpe?g|webp|avif)(?:[?#]|$)/i.test(entry) || /cloudfront|cdn|output|result/i.test(entry))
  ));
}

export function parseTopviewMcpResult(result) {
  const documents = parseTopviewToolDocuments(result);
  const status = (findStringByKeys(documents, ['status', 'taskStatus', 'task_status', 'state']) ?? '').toLowerCase();
  const taskId = findStringByKeys(documents, ['taskId', 'task_id', 'generationId', 'generation_id']);
  const boardTaskId = findStringByKeys(documents, ['boardTaskId', 'board_task_id']);
  const boardId = findStringByKeys(documents, ['boardId', 'board_id']);
  const url = findResultUrl(documents);
  const fileId = findStringByKeys(documents, ['fileId', 'file_id', 'outputFileId', 'output_file_id', 'mediaFileId', 'media_file_id']);
  const error = findStringByKeys(documents, ['errorMsg', 'error_msg', 'errorMessage', 'error_message', 'failMsg', 'message']);
  return {
    status,
    ...(taskId ? { taskId } : {}),
    ...(boardTaskId ? { boardTaskId } : {}),
    ...(boardId ? { boardId } : {}),
    ...(url ? { url } : {}),
    ...(fileId ? { fileId } : {}),
    ...(error ? { error } : {}),
  };
}

function normalizeSchemaValue(value, schema) {
  if (!isRecord(schema)) return value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('boolean') && typeof value === 'string') {
    if (/^(?:true|1|yes|on)$/i.test(value)) return true;
    if (/^(?:false|0|no|off)$/i.test(value)) return false;
  }
  if ((types.includes('integer') || types.includes('number')) && typeof value === 'string' && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number) && (!types.includes('integer') || Number.isInteger(number))) return number;
  }
  if (types.includes('array') && Array.isArray(value)) {
    return value.map((entry) => normalizeSchemaValue(entry, schema.items));
  }
  if (types.includes('object') && isRecord(value)) return normalizeTopviewToolRequest(schema, value);
  return value;
}

export function normalizeTopviewToolRequest(inputSchema, req) {
  if (!isRecord(inputSchema)) return { ...req };
  const topProperties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const wrapped = isRecord(topProperties.req) ? topProperties.req : undefined;
  const requestSchema = wrapped ?? inputSchema;
  const properties = isRecord(requestSchema.properties) ? requestSchema.properties : {};
  const strict = requestSchema.additionalProperties === false && Object.keys(properties).length > 0;
  const normalized = {};
  for (const [key, value] of Object.entries(req)) {
    if (strict && !Object.hasOwn(properties, key)) continue;
    normalized[key] = normalizeSchemaValue(value, properties[key]);
  }
  return normalized;
}

function toolArguments(tool, req) {
  const properties = isRecord(tool?.inputSchema?.properties) ? tool.inputSchema.properties : {};
  const normalized = normalizeTopviewToolRequest(tool?.inputSchema, req);
  return Object.hasOwn(properties, 'req') ? { req: normalized } : normalized;
}

function toolRequestProperties(tool) {
  const topLevel = isRecord(tool?.inputSchema?.properties) ? tool.inputSchema.properties : {};
  const reqSchema = isRecord(topLevel.req) ? topLevel.req : undefined;
  return isRecord(reqSchema?.properties) ? reqSchema.properties : topLevel;
}

function toolExposesField(tool, field) {
  const properties = toolRequestProperties(tool);
  return Object.keys(properties).some((key) => key.toLowerCase() === field.toLowerCase());
}

function topviewBoard(result) {
  // Topview's current list response stores boards in `data`. Recognize both
  // current and legacy response shapes so one CineGen board is always reused.
  const boards = findArrayByKey(result, /^(?:boards|list|items|records|data|rows)$/i) ?? [];
  const candidates = boards.filter(isRecord).map((entry) => ({
    boardId: String(entry.boardId ?? entry.board_id ?? entry.id ?? '').trim(),
    name: typeof entry.name === 'string' ? entry.name : typeof entry.boardName === 'string' ? entry.boardName : undefined,
    isSystemDefault: entry.isSystemDefault === true || entry.is_system_default === true,
    taskCount: Number(entry.taskCount ?? entry.task_count ?? 0) || 0,
  })).filter((entry) => entry.boardId);
  const cinegenBoards = candidates
    .filter((entry) => entry.name?.trim().toLowerCase() === 'cinegen')
    .sort((left, right) => right.taskCount - left.taskCount);
  return cinegenBoards[0]
    ?? candidates.find((entry) => entry.isSystemDefault)
    ?? candidates.find((entry) => entry.name === 'My First Board')
    ?? candidates[0];
}

function configModels(result) {
  return (findArrayByKey(result, /^models$/i) ?? []).filter(isRecord);
}

function optionContainer(model) {
  return isRecord(model.submitParameterOptions) ? model.submitParameterOptions : {};
}

function optionEntry(model, field) {
  const options = model.submitParameterOptions;
  if (isRecord(options)) return options[field];
  if (Array.isArray(options)) {
    return options.find((candidate) => isRecord(candidate) && (
      candidate.name === field || candidate.key === field || candidate.field === field
    ));
  }
  return undefined;
}

function optionValues(model, field) {
  const entry = optionEntry(model, field);
  const raw = Array.isArray(entry)
    ? entry
    : isRecord(entry)
      ? ['values', 'options', 'enum', 'allowedValues'].map((key) => entry[key]).find(Array.isArray) ?? []
      : [];
  return raw.map((value) => {
    if (!isRecord(value)) return value;
    return value.value ?? value.id ?? value.name ?? value.label;
  }).filter((value) => value !== undefined && value !== null);
}

function requiredFields(model) {
  return new Set(Array.isArray(model.requiredSubmitFields)
    ? model.requiredSubmitFields.filter((field) => typeof field === 'string')
    : []);
}

function configuredField(model, aliases) {
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const required = requiredFields(model);
  const options = optionContainer(model);
  return aliases.find((field) => (
    Object.hasOwn(defaults, field)
    || required.has(field)
    || Object.hasOwn(options, field)
    || optionEntry(model, field) !== undefined
  ));
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function matchingNumeric(values, requested) {
  for (const value of values) {
    if (numericValue(value) === requested) return typeof value === 'number' ? value : numericValue(value);
  }
  return undefined;
}

function matchingString(values, requested) {
  return values.find((value) => typeof value === 'string' && value.toLowerCase() === requested.toLowerCase());
}

function numericConstraint(model, field) {
  const entry = optionEntry(model, field);
  if (!isRecord(entry)) return {};
  const min = Number(entry.min ?? entry.minimum);
  const max = Number(entry.max ?? entry.maximum);
  const step = Number(entry.step ?? entry.multipleOf);
  return {
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
    ...(Number.isFinite(step) && step > 0 ? { step } : {}),
  };
}

function configuredValue(model, field, requested, fallback) {
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const value = requested ?? defaults[field] ?? fallback;
  if (value === undefined) return undefined;
  const values = optionValues(model, field);
  if (values.length) {
    const numericRequest = typeof value === 'number'
      || (typeof value === 'string' && /^-?\d+(?:\.\d+)?p?$/i.test(value.trim()));
    const match = numericRequest
      ? matchingNumeric(values, numericValue(value))
      : matchingString(values, String(value));
    if (match === undefined) {
      throw serviceError(
        `Topview model "${String(model.displayName ?? model.submitModel ?? 'selected')}" does not allow ${field}=${String(value)}. Allowed values: ${values.map(String).join(', ')}.`,
        'TOPVIEW_MODEL_PARAMETERS_UNSUPPORTED',
        422,
      );
    }
    return match;
  }
  const constraint = numericConstraint(model, field);
  if (constraint.min !== undefined || constraint.max !== undefined || constraint.step !== undefined) {
    const number = Number(value);
    const invalidStep = constraint.step !== undefined && constraint.min !== undefined
      && Math.abs((number - constraint.min) / constraint.step - Math.round((number - constraint.min) / constraint.step)) > 1e-9;
    if (!Number.isFinite(number)
      || (constraint.min !== undefined && number < constraint.min)
      || (constraint.max !== undefined && number > constraint.max)
      || invalidStep) {
      throw serviceError(
        `Topview model "${String(model.displayName ?? model.submitModel ?? 'selected')}" does not allow ${field}=${String(value)}.`,
        'TOPVIEW_MODEL_PARAMETERS_UNSUPPORTED',
        422,
      );
    }
    return number;
  }
  return value;
}

function selectModel(config, params) {
  const models = configModels(config);
  if (!models.length) {
    throw serviceError('Topview did not return a compatible model for this request.', 'TOPVIEW_MODEL_UNAVAILABLE', 422);
  }
  const requested = typeof params.model === 'string' ? params.model.trim() : '';
  if (requested && requested !== 'auto') {
    const match = models.find((model) => [model.submitModel, model.displayName, model.name, model.model]
      .some((value) => typeof value === 'string' && value.toLowerCase() === requested.toLowerCase()));
    if (!match) {
      throw serviceError(`Topview's live configuration does not include the requested model "${requested}".`, 'TOPVIEW_MODEL_UNAVAILABLE', 422);
    }
    return match;
  }
  const preferred = findStringByKeys(config, ['preferredSubmitModel', 'preferred_submit_model']);
  return models.find((model) => [model.submitModel, model.displayName, model.name]
    .some((value) => typeof value === 'string' && value === preferred))
    ?? models.find((model) => model.preferred === true)
    ?? models[0];
}

function soundCapability(model) {
  if (model.nativeAudio === false || model.supportsNativeAudio === false) return false;
  if (model.nativeAudio === true || model.supportsNativeAudio === true) return true;
  const values = optionValues(model, 'sound');
  if (values.length) return matchingString(values, 'on') !== undefined;
  return configuredField(model, ['sound', 'generateAudio', 'generate_audio']) ? true : undefined;
}

export function sanitizeTopviewPrompt(prompt) {
  const withoutMentionSyntax = String(prompt)
    .replace(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g, (_match, name) => name.replaceAll('-', ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();
  return `${withoutMentionSyntax}\n\nDo not render labels, mention tags, captions, subtitles, watermarks, interface text, or any other on-screen text.`;
}

export function topviewVideoReferences(medias) {
  const references = (Array.isArray(medias) ? medias : [])
    .flatMap((entry) => (
      isRecord(entry) && typeof entry.value === 'string' && entry.value.trim()
        ? [{ value: entry.value.trim(), role: typeof entry.role === 'string' ? entry.role : 'image' }]
        : []
    ))
    .filter((entry, index, all) => all.findIndex((candidate) => (
      candidate.value === entry.value && candidate.role === entry.role
    )) === index);
  const isStartFrame = (role) => /^(?:start_image|startimage|first_frame|firstframe)$/i.test(role);
  const isEndFrame = (role) => /^(?:end_image|endimage|end_frame|endframe|last_frame|lastframe)$/i.test(role);
  const startFrames = references.filter((entry) => isStartFrame(entry.role));
  const onlyFrameInputs = references.every((entry) => isStartFrame(entry.role) || isEndFrame(entry.role));
  const taskType = references.length === 0
    ? 'text_to_video'
    : startFrames.length === 1 && onlyFrameInputs
      ? 'image_to_video'
      : 'omni_reference';
  return { references, taskType };
}

export function buildTopviewVideoRequest({ config, generateTool, taskType, params, references = [], fileIds = [], boardId }) {
  if (!['text_to_video', 'image_to_video', 'omni_reference'].includes(taskType)) {
    throw serviceError('Topview received an unsupported video input mode.', 'TOPVIEW_TASK_TYPE_UNSUPPORTED', 422);
  }
  const durationRequested = Math.max(1, Math.round(params.durationSec ?? 5));
  const model = selectModel(config, params);
  const submitModel = String(model.submitModel ?? '').trim();
  if (!submitModel) {
    throw serviceError('Topview returned a video model without a submit identifier.', 'TOPVIEW_MODEL_INVALID', 502);
  }
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const durationField = configuredField(model, ['duration']);
  const resolutionField = configuredField(model, ['resolution']);
  const ratioField = configuredField(model, ['aspectRatio', 'aspect_ratio']);
  const audioCapability = soundCapability(model);
  const soundField = configuredField(model, ['sound', 'generateAudio', 'generate_audio'])
    ?? (toolExposesField(generateTool, 'sound') ? 'sound' : undefined);
  const requestedResolution = Number.parseInt(String(params.resolution ?? '720'), 10) || 720;
  const requestedRatio = String(params.aspectRatio ?? '16:9').trim() || '16:9';
  let prompt = sanitizeTopviewPrompt(params.prompt);
  const req = {
    taskType,
    model: submitModel,
    prompt,
    generatingCount: 1,
    ...(boardId ? { boardId } : {}),
  };

  if (durationField) {
    req[durationField] = configuredValue(
      model,
      durationField,
      params.durationSec === undefined ? undefined : durationRequested,
      durationRequested,
    );
  }
  if (resolutionField) {
    req[resolutionField] = configuredValue(
      model,
      resolutionField,
      params.resolution === undefined ? undefined : requestedResolution,
      requestedResolution,
    );
  }
  if (taskType !== 'image_to_video' && ratioField) {
    req[ratioField] = configuredValue(
      model,
      ratioField,
      params.aspectRatio === undefined ? undefined : requestedRatio,
      requestedRatio,
    );
  }
  if (soundField && toolExposesField(generateTool, soundField)) {
    if (params.generateAudio === undefined && defaults[soundField] !== undefined) {
      req[soundField] = defaults[soundField];
    } else {
      req[soundField] = soundField === 'sound'
        ? (params.generateAudio ? 'on' : 'off')
        : Boolean(params.generateAudio);
    }
  } else if (params.generateAudio && audioCapability === false) {
    throw serviceError(
      `Topview model "${String(model.displayName ?? submitModel)}" does not support native audio for this generation type.`,
      'TOPVIEW_MODEL_PARAMETERS_UNSUPPORTED',
      422,
    );
  }
  if (taskType === 'image_to_video') {
    const startIndex = references.findIndex((entry) => /^(?:start_image|startimage|first_frame|firstframe)$/i.test(entry.role));
    const endIndex = references.findIndex((entry) => /^(?:end_image|endimage|end_frame|endframe|last_frame|lastframe)$/i.test(entry.role));
    req.firstFrameFileId = fileIds[startIndex >= 0 ? startIndex : 0];
    if (endIndex >= 0 && fileIds[endIndex]) req.endFrameFileId = fileIds[endIndex];
  }
  if (taskType === 'omni_reference') {
    const inputImages = fileIds.map((fileId, index) => ({ fileId, name: `Image${index + 1}` }));
    prompt = `${inputImages.map((entry) => `<<<${entry.name}>>>`).join(', ')} are authoritative visual references. Match every supplied subject, setting, prop, wardrobe, silhouette, material, color, and design detail.\n\n${prompt}`;
    req.prompt = prompt;
    req.inputImages = inputImages;
  }

  for (const field of requiredFields(model)) {
    if ((req[field] === undefined || req[field] === null || req[field] === '') && defaults[field] !== undefined) {
      req[field] = defaults[field];
    }
    if (req[field] === undefined || req[field] === null || req[field] === '') {
      throw serviceError(`Topview's selected model requires the unsupported field "${field}".`, 'TOPVIEW_MODEL_PARAMETERS_UNSUPPORTED', 422);
    }
  }
  const durationSec = numericValue(req[durationField]) ?? numericValue(defaults.duration) ?? durationRequested;
  return { req, model: submitModel, durationSec };
}

export function topviewImageReferences(medias) {
  return (Array.isArray(medias) ? medias : [])
    .flatMap((entry) => isRecord(entry) && typeof entry.value === 'string' && entry.value.trim()
      ? [{ value: entry.value.trim(), role: 'image' }]
      : [])
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);
}

export function buildTopviewImageRequest({ config, params, fileIds = [], boardId }) {
  const taskType = fileIds.length ? 'image_edit' : 'text_to_image';
  const model = selectModel(config, params);
  const submitModel = String(model.submitModel ?? '').trim();
  if (!submitModel) {
    throw serviceError('Topview returned an image model without a submit identifier.', 'TOPVIEW_MODEL_INVALID', 502);
  }
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const ratioField = configuredField(model, ['aspectRatio', 'aspect_ratio']);
  const resolutionField = configuredField(model, ['resolution']);
  const req = {
    taskType,
    model: submitModel,
    prompt: sanitizeTopviewPrompt(params.prompt),
    generateCount: Math.max(1, Math.min(4, Math.round(params.generateCount ?? 1))),
    ...(boardId ? { boardId } : {}),
    ...(fileIds.length ? { inputImageFileIds: fileIds } : {}),
  };
  if (ratioField) {
    req[ratioField] = configuredValue(model, ratioField, params.aspectRatio, '16:9');
  }
  if (resolutionField) {
    req[resolutionField] = configuredValue(model, resolutionField, params.resolution, '1K');
  }
  for (const field of requiredFields(model)) {
    if ((req[field] === undefined || req[field] === null || req[field] === '') && defaults[field] !== undefined) {
      req[field] = defaults[field];
    }
    if (req[field] === undefined || req[field] === null || req[field] === '') {
      throw serviceError(`Topview's selected image model requires the unsupported field "${field}".`, 'TOPVIEW_MODEL_PARAMETERS_UNSUPPORTED', 422);
    }
  }
  return { req, model: submitModel, taskType };
}

function inferImageFormat(value, contentType) {
  const type = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  const byType = [...MIME_BY_EXTENSION.entries()].find((entry) => entry[1] === type)?.[0];
  if (byType) return byType === 'jpeg' ? 'jpg' : byType;
  let pathname = value;
  try { pathname = new URL(value).pathname; } catch { /* Local path. */ }
  const extension = path.extname(pathname).slice(1).toLowerCase();
  return MIME_BY_EXTENSION.has(extension) ? (extension === 'jpeg' ? 'jpg' : extension) : undefined;
}

async function readLimitedBody(response, label) {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_REFERENCE_BYTES) {
    throw serviceError(`${label} exceeds CineGen's 45 MB Topview upload safety limit.`, 'TOPVIEW_REFERENCE_TOO_LARGE', 413);
  }
  const chunks = [];
  let total = 0;
  if (response.body && Symbol.asyncIterator in response.body) {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_REFERENCE_BYTES) {
        await response.body.cancel?.().catch(() => {});
        throw serviceError(`${label} exceeds CineGen's 45 MB Topview upload safety limit.`, 'TOPVIEW_REFERENCE_TOO_LARGE', 413);
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw serviceError(`${label} exceeds CineGen's 45 MB Topview upload safety limit.`, 'TOPVIEW_REFERENCE_TOO_LARGE', 413);
  }
  return bytes;
}

function sanitizedUploadHeaders(value) {
  const headersValue = collectRecords(value).find((record) => isRecord(record.headers))?.headers;
  if (!isRecord(headersValue)) return {};
  const headers = {};
  for (const [key, nested] of Object.entries(headersValue)) {
    if (typeof nested !== 'string' || /[\r\n]/.test(key) || /[\r\n]/.test(nested)) continue;
    if (/^(authorization|cookie|host|content-length|proxy-authorization)$/i.test(key)) continue;
    headers[key] = nested;
  }
  return headers;
}

export function createTopviewService(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw serviceError('This Node runtime does not provide fetch.', 'SERVER_MISCONFIGURED', 500);
  }
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const generationTimeoutMs = options.generationTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const integrationRoot = path.join(options.dataRoot, 'integrations', 'topview');
  const store = new EncryptedStore(integrationRoot, options.tokenSecret ?? process.env.CINEGEN_TOPVIEW_TOKEN_SECRET);
  const publicBaseUrl = options.publicBaseUrl ?? process.env.CINEGEN_PUBLIC_BASE_URL;
  let refreshPromise;

  async function request(url, init, fallback, timeoutMs = requestTimeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (cause) {
      const message = controller.signal.aborted
        ? `${fallback} Topview did not respond in time.`
        : 'Could not reach Topview. Check the server connection and try again.';
      throw serviceError(message, controller.signal.aborted ? 'TOPVIEW_TIMEOUT' : 'TOPVIEW_UNREACHABLE', 502, cause);
    } finally {
      clearTimeout(timeout);
    }
    return response;
  }

  async function requestJson(url, init, fallback, timeoutMs) {
    const response = await request(url, init, fallback, timeoutMs);
    const payload = await readRemoteResponse(response);
    if (!response.ok) throw responseError(response.status, payload, fallback);
    if (!isRecord(payload)) throw serviceError(`${fallback} Topview returned an invalid response.`, 'TOPVIEW_BAD_RESPONSE', 502);
    return payload;
  }

  async function resolveClient(redirectUri, origin) {
    const existing = await store.read('client');
    if (existing?.client_id && existing.redirect_uri === redirectUri) return existing;
    const registered = await requestJson(TOPVIEW_REGISTER_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'CineGen Web',
        client_uri: origin,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: TOPVIEW_SCOPES,
      }),
    }, 'Topview could not register CineGen for sign-in.');
    if (typeof registered.client_id !== 'string' || !registered.client_id.trim()) {
      throw serviceError('Topview did not return an OAuth client ID.', 'TOPVIEW_OAUTH_INVALID', 502);
    }
    const client = {
      ...registered,
      client_id: registered.client_id,
      client_secret: typeof registered.client_secret === 'string' ? registered.client_secret : undefined,
      token_endpoint_auth_method: typeof registered.token_endpoint_auth_method === 'string'
        ? registered.token_endpoint_auth_method
        : 'none',
      redirect_uri: redirectUri,
    };
    await store.write('client', client);
    return client;
  }

  function tokenRequest(client, body) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) if (value !== undefined) form.set(key, String(value));
    form.set('client_id', client.client_id);
    if (client.client_secret && client.token_endpoint_auth_method === 'client_secret_post') {
      form.set('client_secret', client.client_secret);
    }
    const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    if (client.client_secret && client.token_endpoint_auth_method === 'client_secret_basic') {
      headers.Authorization = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`;
    }
    return { method: 'POST', headers, body: form };
  }

  async function exchangeToken(body, client) {
    return requestJson(TOPVIEW_TOKEN_URL, tokenRequest(client, body), 'Topview could not complete authorization.');
  }

  async function saveToken(payload, previous = {}) {
    if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw serviceError('Topview returned an invalid access token.', 'TOPVIEW_OAUTH_INVALID', 502);
    }
    const token = {
      ...previous,
      ...payload,
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : previous.refresh_token,
      expires_at: now() + Math.max(30, Number(payload.expires_in || 3600)) * 1000,
    };
    await store.write('token', token);
    return token;
  }

  async function refreshAccessToken(token) {
    const client = await store.read('client');
    if (!client?.client_id || !token.refresh_token) {
      await store.remove('token');
      throw serviceError('Your Topview connection expired. Connect it again in Settings.', 'TOPVIEW_AUTH_REQUIRED', 401);
    }
    try {
      const refreshed = await exchangeToken({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        resource: TOPVIEW_RESOURCE,
      }, client);
      return (await saveToken(refreshed, token)).access_token;
    } catch (error) {
      await store.remove('token');
      throw serviceError('Your Topview connection expired. Connect it again in Settings.', 'TOPVIEW_AUTH_REQUIRED', 401, error);
    }
  }

  async function accessToken() {
    const token = await store.read('token');
    if (!token?.access_token) {
      throw serviceError('Connect your Topview account in Settings before generating.', 'TOPVIEW_AUTH_REQUIRED', 401);
    }
    if (!token.expires_at || token.expires_at > now() + 60_000) return token.access_token;
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken(token).finally(() => { refreshPromise = undefined; });
    }
    return refreshPromise;
  }

  async function mcpRequest(token, message, sessionId) {
    const response = await request(TOPVIEW_MCP_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify(message),
    }, 'Topview MCP request failed.');
    const text = await response.text();
    const payload = (response.headers.get('content-type') || '').includes('text/event-stream')
      ? parseSse(text, message.id)
      : text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : {};
    if (!response.ok) {
      if (response.status === 401) await store.remove('token');
      throw responseError(response.status, payload, 'Topview MCP request failed.');
    }
    if (isRecord(payload) && payload.error !== undefined) {
      throw serviceError(errorDetail(payload.error, 'Topview MCP returned an error.'), 'TOPVIEW_MCP_ERROR', 502);
    }
    return {
      payload: isRecord(payload) ? payload : {},
      sessionId: response.headers.get('mcp-session-id') || sessionId,
    };
  }

  async function createMcpSession() {
    const token = await accessToken();
    const initialized = await mcpRequest(token, {
      jsonrpc: '2.0',
      id: `init-${crypto.randomUUID()}`,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'CineGen Web', version: '1.0.0' },
      },
    });
    const notified = await mcpRequest(token, {
      jsonrpc: '2.0', method: 'notifications/initialized', params: {},
    }, initialized.sessionId);
    const session = { token, sessionId: notified.sessionId || initialized.sessionId, tools: [] };
    let cursor;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const listed = await mcpRequest(token, {
        jsonrpc: '2.0', id: `tools-${crypto.randomUUID()}`, method: 'tools/list',
        params: cursor ? { cursor } : {},
      }, session.sessionId);
      session.sessionId = listed.sessionId || session.sessionId;
      const result = isRecord(listed.payload.result) ? listed.payload.result : {};
      if (Array.isArray(result.tools)) {
        session.tools.push(...result.tools.filter((tool) => isRecord(tool) && typeof tool.name === 'string'));
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    if (cursor) throw serviceError('Topview returned too many tool pages.', 'TOPVIEW_MCP_BAD_RESPONSE', 502);
    return session;
  }

  async function callTool(session, name, req) {
    const tool = session.tools.find((entry) => entry.name === name);
    if (!tool) {
      throw serviceError(`Your Topview account does not currently expose ${name}.`, 'TOPVIEW_TOOL_UNAVAILABLE', 422);
    }
    const called = await mcpRequest(session.token, {
      jsonrpc: '2.0', id: `call-${crypto.randomUUID()}`, method: 'tools/call', params: {
        name,
        arguments: toolArguments(tool, req),
      },
    }, session.sessionId);
    session.sessionId = called.sessionId || session.sessionId;
    const result = called.payload.result;
    if (isRecord(result) && result.isError === true) {
      const detail = collectStrings(result).join(' ').slice(0, 1_000);
      throw serviceError(detail || `Topview could not run ${name}.`, 'TOPVIEW_TOOL_ERROR', 422);
    }
    return result;
  }

  async function chooseBoard(session) {
    if (!session.tools.some((tool) => tool.name === 'topview_list_boards')) return undefined;
    const listed = await callTool(session, 'topview_list_boards', {
      pageNo: 1, pageSize: 100, mode: 'editable-by-me',
    });
    const existing = topviewBoard(parseTopviewToolDocuments(listed));
    if (existing) return existing.boardId;
    if (!session.tools.some((tool) => tool.name === 'topview_create_board')) return undefined;
    const created = await callTool(session, 'topview_create_board', { name: 'CineGen' });
    return findStringByKeys(parseTopviewToolDocuments(created), ['boardId', 'board_id', 'id']);
  }

  async function downloadPublicReference(value, label) {
    let current = validatePublicUrl(value, label);
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await request(current, {
        method: 'GET',
        headers: { Accept: 'image/*' },
        redirect: 'manual',
      }, `Topview could not download ${label.toLowerCase()}.`);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect === 3) throw serviceError(`${label} redirected too many times.`, 'TOPVIEW_REFERENCE_INVALID', 422);
        const location = response.headers.get('location');
        if (!location) throw serviceError(`${label} returned an invalid redirect.`, 'TOPVIEW_REFERENCE_INVALID', 422);
        current = validatePublicUrl(new URL(location, current).href, label);
        continue;
      }
      if (!response.ok) {
        throw serviceError(`Topview could not download ${label.toLowerCase()} (${response.status}).`, 'TOPVIEW_REFERENCE_UNAVAILABLE', 422);
      }
      const contentType = response.headers.get('content-type') || '';
      const format = inferImageFormat(current.href, contentType);
      if (!format || (contentType && !contentType.toLowerCase().startsWith('image/'))) {
        throw serviceError(`${label} must be a supported image.`, 'TOPVIEW_REFERENCE_UNSUPPORTED', 422);
      }
      return { bytes: await readLimitedBody(response, label), format, contentType: MIME_BY_EXTENSION.get(format) };
    }
    throw serviceError(`${label} could not be downloaded.`, 'TOPVIEW_REFERENCE_UNAVAILABLE', 422);
  }

  async function loadReference(value, index) {
    const label = `Topview reference ${index + 1}`;
    if (typeof value !== 'string' || !value.trim()) {
      throw serviceError(`${label} is empty.`, 'INVALID_INPUT');
    }
    const trimmed = value.trim();
    if (trimmed.startsWith('data:')) {
      const match = /^data:((?:image|audio)\/[^;,]+);base64,(.+)$/s.exec(trimmed);
      if (!match) throw serviceError(`${label} uses an unsupported inline format.`, 'TOPVIEW_REFERENCE_UNSUPPORTED', 422);
      const format = inferImageFormat('', match[1]);
      const bytes = Buffer.from(match[2], 'base64');
      if (!format) throw serviceError(`${label} must be a supported image or audio file.`, 'TOPVIEW_REFERENCE_UNSUPPORTED', 422);
      if (bytes.length > MAX_REFERENCE_BYTES) throw serviceError(`${label} exceeds CineGen's 45 MB Topview upload safety limit.`, 'TOPVIEW_REFERENCE_TOO_LARGE', 413);
      return { bytes, format, contentType: MIME_BY_EXTENSION.get(format) };
    }
    let mediaReference = trimmed;
    if (mediaReference.startsWith('local-media://file')) {
      mediaReference = mediaReference.slice('local-media://file'.length);
      try { mediaReference = decodeURIComponent(mediaReference); } catch {
        throw serviceError(`${label} contains an invalid media path.`, 'TOPVIEW_REFERENCE_INVALID', 422);
      }
    }
    if (mediaReference.startsWith('/media/')) {
      if (typeof options.pathForMediaReference !== 'function') {
        throw serviceError(`${label} cannot be read by this web server.`, 'TOPVIEW_REFERENCE_UNAVAILABLE', 422);
      }
      const filePath = options.pathForMediaReference(mediaReference);
      const stats = await fs.stat(filePath).catch((cause) => {
        throw serviceError(`${label} no longer exists.`, 'TOPVIEW_REFERENCE_UNAVAILABLE', 404, cause);
      });
      const format = inferImageFormat(filePath);
      if (!stats.isFile() || !format) throw serviceError(`${label} must be a supported image or audio file.`, 'TOPVIEW_REFERENCE_UNSUPPORTED', 422);
      if (stats.size > MAX_REFERENCE_BYTES) throw serviceError(`${label} exceeds CineGen's 45 MB Topview upload safety limit.`, 'TOPVIEW_REFERENCE_TOO_LARGE', 413);
      return { bytes: await fs.readFile(filePath), format, contentType: MIME_BY_EXTENSION.get(format) };
    }
    if (/^https:\/\//i.test(mediaReference)) return downloadPublicReference(mediaReference, label);
    throw serviceError(
      `${label} must be a browser-uploaded /media image or a public HTTPS image.`,
      'TOPVIEW_REFERENCE_UNSUPPORTED',
      422,
    );
  }

  async function uploadReference(session, reference, index) {
    if (reference.startsWith('topview-file:')) {
      const fileId = reference.slice('topview-file:'.length).trim();
      if (!/^[A-Za-z0-9._:-]{1,512}$/.test(fileId)) {
        throw serviceError('Topview received an invalid existing file ID.', 'TOPVIEW_REFERENCE_INVALID', 422);
      }
      return fileId;
    }
    const source = await loadReference(reference, index);
    const credential = await callTool(session, 'ta_upload_credential', {
      format: source.format,
      needAccelerateUrl: false,
    });
    const documents = parseTopviewToolDocuments(credential);
    const fileId = findStringByKeys(documents, ['fileId', 'file_id']);
    const uploadUrl = findStringByKeys(documents, [
      'uploadUrl', 'upload_url', 'accelerateUrl', 'accelerate_url', 'presignedUrl', 'presigned_url', 'signedUrl', 'signed_url',
    ]);
    if (!fileId || !uploadUrl) {
      throw serviceError('Topview did not return a usable upload destination for a reference.', 'TOPVIEW_UPLOAD_INVALID', 502);
    }
    const target = validatePublicUrl(uploadUrl, 'Topview upload URL');
    const method = (findStringByKeys(documents, ['method', 'httpMethod', 'http_method']) || 'PUT').toUpperCase();
    if (!['PUT', 'POST'].includes(method)) {
      throw serviceError('Topview returned an unsupported upload method.', 'TOPVIEW_UPLOAD_INVALID', 502);
    }
    const headers = sanitizedUploadHeaders(documents);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type') && source.contentType) {
      headers['Content-Type'] = source.contentType;
    }
    const uploaded = await request(target, {
      method,
      headers,
      body: source.bytes,
      redirect: 'error',
    }, 'Topview could not upload a reference.', requestTimeoutMs);
    if (!uploaded.ok) {
      throw serviceError(`Topview could not upload a reference (${uploaded.status}).`, 'TOPVIEW_UPLOAD_FAILED', 502);
    }
    const checked = await callTool(session, 'ta_upload_check_file', { fileId });
    if (findBoolean(parseTopviewToolDocuments(checked)) === false) {
      throw serviceError('Topview could not verify an uploaded reference.', 'TOPVIEW_UPLOAD_FAILED', 502);
    }
    return fileId;
  }

  async function reusableGeneratedImageReference(session, url) {
    try {
      return `topview-file:${await uploadReference(session, url, 0)}`;
    } catch (error) {
      // Do not discard a completed image if its delivery URL cannot be promoted.
      // The client will stop the sheet before creating unanchored follow-up views.
      console.warn('Could not prepare the generated Topview image as a reusable reference.', error);
      return undefined;
    }
  }

  async function generate(params) {
    if (!isRecord(params) || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw serviceError('Topview video generation requires a prompt.', 'INVALID_INPUT');
    }
    const { references, taskType } = topviewVideoReferences(params.medias);
    // A CineGen element is an identity/reference still, not an opening frame. Only an
    // explicitly wired start frame may select image-to-video; generic element images use
    // Topview's omni-reference mode even when there is just one of them.
    const session = await createMcpSession();
    const generateTool = session.tools.find((tool) => tool.name === 'topview_generate_video');
    if (!generateTool) {
      throw serviceError('Your Topview account does not currently expose video generation.', 'TOPVIEW_TOOL_UNAVAILABLE', 422);
    }
    const boardId = await chooseBoard(session);
    let config = await callTool(session, 'topview_get_generation_config', { type: 'video', taskType });
    const fileIds = [];
    for (let index = 0; index < references.length; index += 1) {
      fileIds.push(await uploadReference(session, references[index].value, index));
    }
    let built;
    try {
      built = buildTopviewVideoRequest({
        config: parseTopviewToolDocuments(config), generateTool, taskType, params, references, fileIds, boardId,
      });
    } catch (error) {
      const explicitModel = typeof params.model === 'string' && params.model.trim() && params.model.trim() !== 'auto';
      if (!explicitModel || error?.code !== 'TOPVIEW_MODEL_UNAVAILABLE') throw error;
      config = await callTool(session, 'topview_get_generation_config', { type: 'video', taskType, refresh: true });
      built = buildTopviewVideoRequest({
        config: parseTopviewToolDocuments(config), generateTool, taskType, params, references, fileIds, boardId,
      });
    }
    let result = await callTool(session, 'topview_generate_video', built.req);
    let parsed = parseTopviewMcpResult(result);
    const taskId = parsed.taskId;
    if (!taskId) throw serviceError('Topview did not return a task ID for this generation.', 'TOPVIEW_BAD_RESPONSE', 502);
    let boardTaskId = parsed.boardTaskId;
    const deadline = now() + generationTimeoutMs;
    while (!parsed.url) {
      if (/^(fail|failed|error|cancel|cancelled|canceled)$/i.test(parsed.status)) {
        throw serviceError(parsed.error || 'Topview could not complete this video.', 'TOPVIEW_GENERATION_FAILED', 422);
      }
      if (parsed.status === 'success') {
        throw serviceError('Topview completed the task without a downloadable video URL.', 'TOPVIEW_RESULT_UNAVAILABLE', 502);
      }
      if (now() >= deadline) {
        throw serviceError(
          `Topview is still processing task ${taskId}. CineGen will not submit a duplicate; check the selected Topview board for the result.`,
          'TOPVIEW_GENERATION_PENDING',
          504,
        );
      }
      await sleep(pollIntervalMs);
      result = await callTool(session, 'topview_query_task', { taskType, taskId, needCloudFrontUrl: true });
      parsed = parseTopviewMcpResult(result);
      boardTaskId = parsed.boardTaskId || boardTaskId;
    }
    return {
      url: parsed.url,
      mediaType: 'video',
      durationSec: built.durationSec,
      taskId,
      model: built.model,
      ...(boardId ? {
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ''}`,
      } : {}),
    };
  }

  async function generateAudio(params) {
    if (!isRecord(params) || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw serviceError('Topview audio generation requires text or a prompt.', 'INVALID_INPUT');
    }
    const session = await createMcpSession();
    const boardId = await chooseBoard(session);
    const model = typeof params.model === 'string' ? params.model.trim() : '';
    const kind = params.kind === 'music' || params.kind === 'voice' ? params.kind : 'audio';
    let referenceAudioFileId;
    if (typeof params.referenceAudio === 'string' && params.referenceAudio.trim()) {
      referenceAudioFileId = await uploadReference(session, params.referenceAudio, 0);
    }
    let toolName;
    let taskType;
    let req;
    if (kind === 'music') {
      toolName = 'topview_generate_music';
      taskType = 'ai_music';
      req = {
        model,
        lyrics: params.prompt.trim(),
        styles: params.styles,
        instrumental: params.instrumental,
        ...(referenceAudioFileId ? { referenceAudio: { fileId: referenceAudioFileId } } : {}),
        boardId,
      };
    } else if (kind === 'voice') {
      if (typeof params.voiceId !== 'string' || !params.voiceId.trim()) {
        throw serviceError('Choose a Topview voice ID for text-to-speech.', 'INVALID_INPUT');
      }
      toolName = 'topview_generate_voice';
      taskType = 'text_to_speech';
      req = {
        voiceId: params.voiceId.trim(), voiceText: params.prompt.trim(), voiceSpeed: params.voiceSpeed,
        emotionName: params.emotion, boardId,
      };
    } else {
      if (!referenceAudioFileId) throw serviceError('Seed Audio requires a reference audio clip.', 'INVALID_INPUT');
      toolName = 'topview_generate_audio';
      taskType = 'audio_design';
      req = { model, text: params.prompt.trim(), referenceAudioFileId, emotionText: params.emotionText, boardId };
    }
    let parsed = parseTopviewMcpResult(await callTool(session, toolName, req));
    const taskId = parsed.taskId;
    if (parsed.url) return { url: parsed.url, mediaType: 'audio', taskId, model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` };
    if (!taskId) throw serviceError('Topview did not return a task ID for this audio generation.', 'TOPVIEW_BAD_RESPONSE', 502);
    const deadline = now() + generationTimeoutMs;
    while (!parsed.url) {
      if (/^(fail|failed|error|cancel|cancelled|canceled)$/i.test(parsed.status)) {
        throw serviceError(parsed.error || 'Topview could not complete this audio generation.', 'TOPVIEW_GENERATION_FAILED', 422);
      }
      if (now() >= deadline) throw serviceError(`Topview is still processing audio task ${taskId}. Check your Topview board for the result.`, 'TOPVIEW_GENERATION_PENDING', 504);
      await sleep(pollIntervalMs);
      parsed = parseTopviewMcpResult(await callTool(session, 'topview_query_task', { taskType, taskId, needCloudFrontUrl: true }));
    }
    return { url: parsed.url, mediaType: 'audio', taskId, model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` };
  }

  async function generateImage(params) {
    if (!isRecord(params) || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw serviceError('Topview image generation requires a prompt.', 'INVALID_INPUT');
    }
    const references = topviewImageReferences(params.medias);
    const taskType = references.length ? 'image_edit' : 'text_to_image';
    const session = await createMcpSession();
    if (!session.tools.some((tool) => tool.name === 'topview_generate_image')) {
      throw serviceError('Your Topview account does not currently expose image generation.', 'TOPVIEW_TOOL_UNAVAILABLE', 422);
    }
    const boardId = await chooseBoard(session);
    let config = await callTool(session, 'topview_get_generation_config', { type: 'image', taskType });
    const fileIds = [];
    for (let index = 0; index < references.length; index += 1) {
      fileIds.push(await uploadReference(session, references[index].value, index));
    }
    let built;
    try {
      built = buildTopviewImageRequest({
        config: parseTopviewToolDocuments(config), params, fileIds, boardId,
      });
    } catch (error) {
      const explicitModel = typeof params.model === 'string' && params.model.trim() && params.model.trim() !== 'auto';
      if (!explicitModel || error?.code !== 'TOPVIEW_MODEL_UNAVAILABLE') throw error;
      config = await callTool(session, 'topview_get_generation_config', { type: 'image', taskType, refresh: true });
      built = buildTopviewImageRequest({
        config: parseTopviewToolDocuments(config), params, fileIds, boardId,
      });
    }
    let result = await callTool(session, 'topview_generate_image', built.req);
    let parsed = parseTopviewMcpResult(result);
    const taskId = parsed.taskId;
    if (!taskId && !parsed.url) throw serviceError('Topview did not return a task ID for this image generation.', 'TOPVIEW_BAD_RESPONSE', 502);
    let boardTaskId = parsed.boardTaskId;
    const deadline = now() + generationTimeoutMs;
    while (!parsed.url) {
      if (/^(fail|failed|error|cancel|cancelled|canceled)$/i.test(parsed.status)) {
        throw serviceError(parsed.error || 'Topview could not complete this image.', 'TOPVIEW_GENERATION_FAILED', 422);
      }
      if (parsed.status === 'success') {
        throw serviceError('Topview completed the task without a downloadable image URL.', 'TOPVIEW_RESULT_UNAVAILABLE', 502);
      }
      if (now() >= deadline) {
        throw serviceError(
          `Topview is still processing image task ${taskId}. CineGen will not submit a duplicate; check the selected Topview board for the result.`,
          'TOPVIEW_GENERATION_PENDING',
          504,
        );
      }
      await sleep(Math.min(pollIntervalMs, 3000));
      result = await callTool(session, 'topview_query_task', { taskType, taskId, needCloudFrontUrl: true });
      parsed = parseTopviewMcpResult(result);
      boardTaskId = parsed.boardTaskId || boardTaskId;
    }
    const referenceValue = parsed.fileId
      ? `topview-file:${parsed.fileId}`
      : await reusableGeneratedImageReference(session, parsed.url);
    return {
      url: parsed.url,
      mediaType: 'image',
      ...(referenceValue ? { referenceValue } : {}),
      ...(taskId ? { taskId } : {}),
      model: built.model,
      ...(boardId ? {
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ''}`,
      } : {}),
    };
  }

  const handlers = {
    async modelCatalog() {
      const session = await createMcpSession();
      if (!session.tools.some((tool) => tool.name === 'topview_get_generation_config')) {
        throw serviceError('Your Topview account does not currently expose its model catalog.', 'TOPVIEW_TOOL_UNAVAILABLE', 422);
      }
      const requests = [
        { outputType: 'image', taskType: 'text_to_image' },
        { outputType: 'image', taskType: 'image_edit' },
        { outputType: 'video', taskType: 'text_to_video' },
        { outputType: 'video', taskType: 'image_to_video' },
        { outputType: 'video', taskType: 'omni_reference' },
        { outputType: 'audio', taskType: 'music', catalogType: 'music' },
        { outputType: 'audio', taskType: 'voice', catalogType: 'voice' },
        { outputType: 'audio', taskType: 'audio', catalogType: 'audio' },
      ];
      const configs = [];
      for (const request of requests) {
        try {
          const config = parseTopviewToolDocuments(await callTool(session, 'topview_get_generation_config', {
            type: request.catalogType ?? request.outputType,
            ...(request.catalogType ? {} : { taskType: request.taskType }),
            refresh: true,
          }));
          configs.push({ ...request, config });
        } catch {
          // Keep the generation modes that this account actually exposes.
        }
      }
      if (!configs.length) throw serviceError('Topview returned an empty model catalog.', 'TOPVIEW_MODEL_UNAVAILABLE', 422);
      return {
        configs,
        tools: session.tools.map((tool) => tool.name),
        toolSchemas: Object.fromEntries(session.tools
          .filter((tool) => ['topview_get_generation_config', 'topview_generate_audio', 'topview_generate_music', 'topview_generate_voice', 'topview_clone_voice', 'topview_query_task'].includes(tool.name))
          .map((tool) => [tool.name, tool.inputSchema])),
        fetchedAt: new Date(now()).toISOString(),
      };
    },

    async accountStatus() {
      const token = await store.read('token');
      if (!token?.access_token) return { connected: false, configured: true };
      try {
        await accessToken();
        const profile = await store.read('profile');
        let credits = topviewCreditBalance(profile);
        try {
          const session = await createMcpSession();
          if (session.tools.some((tool) => tool.name === 'topview_get_credit')) {
            credits = topviewCreditBalance(parseTopviewToolDocuments(await callTool(session, 'topview_get_credit', {}))) ?? credits;
          }
        } catch { /* Credit display is optional; keep the account connected. */ }
        return {
          connected: true,
          configured: true,
          ...(typeof profile?.email === 'string' ? { email: profile.email } : {}),
          ...(credits !== undefined ? { credits } : {}),
        };
      } catch (error) {
        return { connected: false, configured: true, error: error instanceof Error ? error.message : 'Topview connection expired.' };
      }
    },

    async authLogin(originValue) {
      const origin = normalizeOrigin(originValue, publicBaseUrl);
      const redirectUri = `${origin}/api/topview/oauth/callback`;
      const client = await resolveClient(redirectUri, origin);
      const verifier = base64Url(crypto.randomBytes(48));
      const challenge = base64Url(sha256(verifier));
      const state = base64Url(crypto.randomBytes(32));
      await store.write('pending', { state, verifier, redirectUri, createdAt: now() });
      const authorization = new URL(TOPVIEW_AUTHORIZE_URL);
      authorization.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope: TOPVIEW_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: TOPVIEW_RESOURCE,
      }).toString();
      return { connected: false, configured: true, authorizationUrl: authorization.href };
    },

    async authLogout() {
      await Promise.all([
        store.remove('token'),
        store.remove('profile'),
        store.remove('pending'),
      ]);
    },

    generate,
    generateImage,
    generateAudio,
  };

  async function handleCallback(url, response) {
    const pending = await store.read('pending');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
    let success = false;
    let message;
    try {
      if (oauthError) throw serviceError(oauthError, 'TOPVIEW_AUTH_DENIED', 400);
      if (!pending || !state || state !== pending.state || !code) {
        throw serviceError('The Topview authorization response could not be verified. Please try connecting again.', 'TOPVIEW_OAUTH_STATE', 400);
      }
      if (now() - pending.createdAt > 10 * 60 * 1000) {
        throw serviceError('The Topview authorization request expired. Please try connecting again.', 'TOPVIEW_OAUTH_EXPIRED', 400);
      }
      const client = await store.read('client');
      if (!client?.client_id) throw serviceError('Reconnect Topview to restart authorization.', 'TOPVIEW_AUTH_REQUIRED', 401);
      const token = await exchangeToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
        resource: TOPVIEW_RESOURCE,
      }, client);
      const stored = await saveToken(token);
      try {
        const profileResponse = await request(TOPVIEW_USERINFO_URL, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${stored.access_token}` },
        }, 'Topview could not load the connected profile.');
        const profile = await readRemoteResponse(profileResponse);
        if (profileResponse.ok && isRecord(profile)) await store.write('profile', profile);
      } catch { /* Profile data is optional. */ }
      success = true;
      message = 'You can close this window and return to CineGen.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Topview authorization did not complete.';
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

  return { handlers, handleCallback };
}
