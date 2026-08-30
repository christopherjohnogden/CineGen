import { app, ipcMain, safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createServer, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import type { TopviewGenerationCatalog, TopviewGenerationCatalogConfig } from '@/lib/topview/model-catalog';

export const TOPVIEW_MCP_URL = 'https://mcp.topview.ai/mcp';
const TOPVIEW_RESOURCE = 'https://mcp.topview.ai';
const TOPVIEW_AUTHORIZE_URL = 'https://www.topview.ai/mcp_oauth/oauth/authorize';
const TOPVIEW_TOKEN_URL = 'https://www.topview.ai/mcp_oauth/oauth/token';
const TOPVIEW_REGISTER_URL = 'https://www.topview.ai/mcp_oauth/oauth/register';
const TOPVIEW_USERINFO_URL = 'https://www.topview.ai/mcp_oauth/oauth/userinfo';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;
const MCP_REQUEST_TIMEOUT_MS = 90 * 1000;
const REFERENCE_DOWNLOAD_TIMEOUT_MS = 30 * 1000;
const MAX_REFERENCE_BYTES = 45 * 1024 * 1024;
const MAX_MCP_TOOL_PAGES = 50;

type JsonRecord = Record<string, unknown>;

export interface TopviewGenerateParams {
  prompt: string;
  model?: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  medias?: Array<{ value: string; role?: string }>;
}

export interface TopviewGenerateResult {
  url: string;
  mediaType: 'video';
  durationSec?: number;
  taskId?: string;
  boardUrl?: string;
  model?: string;
}

export interface TopviewImageGenerateParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  generateCount?: number;
  medias?: Array<{ value: string; role?: string }>;
}

export interface TopviewImageGenerateResult {
  url: string;
  mediaType: 'image';
  /** Stable Topview upload that can be passed into a later image-edit request. */
  referenceValue?: string;
  taskId?: string;
  boardUrl?: string;
  model?: string;
}

export interface TopviewAudioGenerateParams {
  prompt: string;
  model: string;
  kind: 'music' | 'voice' | 'audio';
  styles?: string;
  instrumental?: boolean;
  voiceId?: string;
  voiceSpeed?: number;
  emotion?: string;
  emotionText?: string;
  referenceAudio?: string;
}

export interface TopviewAudioGenerateResult {
  url: string;
  mediaType: 'audio';
  taskId?: string;
  boardUrl?: string;
  model?: string;
}

export type TopviewVideoTaskType = 'text_to_video' | 'image_to_video' | 'omni_reference';

export interface TopviewSubmitResult {
  taskId: string;
  taskType: TopviewVideoTaskType;
  boardId: string;
  model: string;
  durationSec: number;
}

export interface TopviewQueryParams extends TopviewSubmitResult {}

export interface TopviewQueryResult extends TopviewSubmitResult {
  status: 'init' | 'running' | 'success' | 'fail';
  url?: string;
  boardUrl?: string;
  error?: string;
}

type TopviewMediaRole = 'image' | 'start_image' | 'end_image' | 'video' | 'audio';

interface TopviewReference {
  value: string;
  role: TopviewMediaRole;
}

interface UploadedTopviewReference extends TopviewReference {
  fileId: string;
}

interface StoredClient extends JsonRecord {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method?: string;
  redirect_uri: string;
}

interface StoredToken extends JsonRecord {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export interface TopviewTeamConnection {
  client: StoredClient;
  token: StoredToken;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: JsonRecord;
}

interface McpSession {
  token: string;
  sessionId?: string;
  tools: McpTool[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function safeMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function oauthPage(success: boolean, message: string): string {
  const title = success ? 'Topview connected' : 'Topview connection failed';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0d;color:#f2eee8;font-family:system-ui,sans-serif}main{width:min(440px,calc(100vw - 48px));padding:34px;border:1px solid #343239;border-radius:22px;background:#191a20;box-shadow:0 24px 80px #0008}small{color:#d7a552;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;margin:10px 0 8px}p{color:#aaa6a0;line-height:1.55;margin:0}</style></head><body><main><small>CineGen + Topview</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main><script>setTimeout(()=>window.close(),1100)</script></body></html>`;
}

function sendOauthPage(response: ServerResponse, success: boolean, message: string): void {
  const body = oauthPage(success, message);
  response.writeHead(success ? 200 : 400, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

class SafeCredentialStore {
  private readonly root: string;

  constructor() {
    this.root = path.join(app.getPath('userData'), 'integrations', 'topview');
  }

  availabilityError(): string | undefined {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return 'Secure credential storage is unavailable on this device. Configure the operating-system keychain, then restart CineGen.';
      }
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
        return 'Topview sign-in requires a Linux secret store such as GNOME Keyring or KWallet.';
      }
      return undefined;
    } catch {
      return 'Secure credential storage is unavailable on this device. Restart CineGen and try again.';
    }
  }

  private assertAvailable(): void {
    const error = this.availabilityError();
    if (error) throw new Error(error);
  }

  async read<T extends JsonRecord>(name: string): Promise<T | null> {
    try {
      this.assertAvailable();
      const envelope = JSON.parse(await fs.readFile(path.join(this.root, `${name}.safe.json`), 'utf8')) as {
        version: number;
        data: string;
      };
      if (envelope.version !== 1 || typeof envelope.data !== 'string') {
        throw new Error('Topview credentials are stored in an unsupported format. Connect the account again.');
      }
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
      const value = JSON.parse(decrypted) as unknown;
      if (!isRecord(value)) throw new Error('Topview credentials are invalid. Connect the account again.');
      return value as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(name: string, value: JsonRecord): Promise<void> {
    this.assertAvailable();
    await fs.mkdir(this.root, { recursive: true });
    const envelope = JSON.stringify({
      version: 1,
      data: safeStorage.encryptString(JSON.stringify(value)).toString('base64'),
    });
    const target = path.join(this.root, `${name}.safe.json`);
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${envelope}\n`, { mode: 0o600 });
      await fs.rename(temporary, target);
      await fs.chmod(target, 0o600).catch(() => {});
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    await fs.unlink(path.join(this.root, `${name}.safe.json`)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function remoteError(status: number, payload: unknown, fallback: string): Error {
  const detail = isRecord(payload)
    ? payload.error_description ?? payload.message ?? payload.error
    : payload;
  return new Error(typeof detail === 'string' && detail.trim()
    ? detail.trim()
    : `${fallback} (${status})`);
}

async function requestJson(url: string, init: RequestInit, fallback: string): Promise<JsonRecord> {
  let response: Response;
  try { response = await fetch(url, init); } catch (error) {
    throw new Error(`Could not reach Topview. ${fallback}`, { cause: error });
  }
  const payload = await readResponse(response);
  if (!response.ok) throw remoteError(response.status, payload, fallback);
  if (!isRecord(payload)) throw new Error(`${fallback} Topview returned an invalid response.`);
  return payload;
}

function parseSse(text: string, expectedId: unknown): unknown {
  const messages: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try { messages.push(JSON.parse(data)); } catch { /* keepalives */ }
  }
  return messages.find((entry) => isRecord(entry) && entry.id === expectedId)
    ?? messages.find((entry) => isRecord(entry) && (entry.result !== undefined || entry.error !== undefined))
    ?? messages.at(-1);
}

function collectRecords(value: unknown, output: JsonRecord[] = [], depth = 0): JsonRecord[] {
  if (depth > 14 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output, depth + 1);
  } else if (isRecord(value)) {
    output.push(value);
    for (const item of Object.values(value)) collectRecords(item, output, depth + 1);
  }
  return output;
}

function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 14 || value === null || value === undefined) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output, depth + 1);
  else if (isRecord(value)) for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
  return output;
}

function parseToolDocuments(result: unknown): unknown[] {
  const values: unknown[] = [result];
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

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return undefined;
}

export function topviewCreditBalance(value: unknown): number | undefined {
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

function findBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (/^(ok|success|exists|ready|verified)$/i.test(key) && typeof nested === 'boolean') return nested;
    }
  }
  return undefined;
}

function findResultUrl(value: unknown): string | undefined {
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

function generatedImageFileReference(value: unknown): string | undefined {
  const fileId = findStringByKeys(value, [
    'fileId', 'file_id', 'outputFileId', 'output_file_id', 'mediaFileId', 'media_file_id',
  ]);
  return fileId ? `topview-file:${fileId}` : undefined;
}

function taskStatus(value: unknown): string {
  return (findStringByKeys(value, ['status', 'taskStatus', 'task_status', 'state']) ?? '').toLowerCase();
}

function normalizeSchemaValue(value: unknown, schema: unknown): unknown {
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
  if (types.includes('object') && isRecord(value)) {
    return normalizeTopviewToolRequest(schema, value);
  }
  return value;
}

export function normalizeTopviewToolRequest(inputSchema: unknown, req: JsonRecord): JsonRecord {
  if (!isRecord(inputSchema)) return { ...req };
  const topProperties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const wrapped = isRecord(topProperties.req) ? topProperties.req : undefined;
  const requestSchema = wrapped ?? inputSchema;
  const properties = isRecord(requestSchema.properties) ? requestSchema.properties : {};
  const strict = requestSchema.additionalProperties === false && Object.keys(properties).length > 0;
  const normalized: JsonRecord = {};
  for (const [key, value] of Object.entries(req)) {
    if (strict && !Object.hasOwn(properties, key)) continue;
    normalized[key] = normalizeSchemaValue(value, properties[key]);
  }
  return normalized;
}

function toolArguments(tool: McpTool, req: JsonRecord): JsonRecord {
  const properties = isRecord(tool.inputSchema?.properties) ? tool.inputSchema.properties : {};
  const normalized = normalizeTopviewToolRequest(tool.inputSchema, req);
  return Object.hasOwn(properties, 'req') ? { req: normalized } : normalized;
}

function findArrayByKey(value: unknown, keyPattern: RegExp): unknown[] | undefined {
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (keyPattern.test(key) && Array.isArray(nested)) return nested;
    }
  }
  return undefined;
}

function topviewBoard(result: unknown): { boardId: string; name?: string } | undefined {
  // The live Topview board API uses `data`; older MCP versions used `boards`.
  // Missing `data` here caused CineGen to create a new board for every render.
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

function configModels(result: unknown): JsonRecord[] {
  return (findArrayByKey(result, /^models$/i) ?? []).filter(isRecord);
}

function optionValues(model: JsonRecord, field: string): unknown[] {
  const options = model.submitParameterOptions;
  if (isRecord(options)) {
    const direct = options[field];
    if (Array.isArray(direct)) return direct.map(optionValue);
    if (isRecord(direct)) {
      for (const key of ['values', 'options', 'enum', 'allowedValues']) {
        if (Array.isArray(direct[key])) return direct[key].map(optionValue);
      }
    }
  }
  if (Array.isArray(options)) {
    const entry = options.find((candidate) => isRecord(candidate) && (
      candidate.name === field || candidate.key === field || candidate.field === field
    ));
    if (isRecord(entry)) {
      for (const key of ['values', 'options', 'enum', 'allowedValues']) {
        if (Array.isArray(entry[key])) return entry[key].map(optionValue);
      }
    }
  }
  return [];
}

function optionValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.value ?? value.key ?? value.id ?? value.name;
}

function requiredSubmitFields(model: JsonRecord): string[] {
  if (isRecord(model.requiredSubmitFields)) {
    return Object.entries(model.requiredSubmitFields)
      .filter(([, required]) => required === true || isRecord(required))
      .map(([field]) => field);
  }
  if (!Array.isArray(model.requiredSubmitFields)) return [];
  return model.requiredSubmitFields.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!isRecord(entry)) return '';
    const value = entry.name ?? entry.key ?? entry.field;
    return typeof value === 'string' ? value : '';
  }).filter(Boolean);
}

function optionFieldNames(model: JsonRecord): string[] {
  const options = model.submitParameterOptions;
  if (isRecord(options)) return Object.keys(options);
  if (!Array.isArray(options)) return [];
  return options.map((entry) => {
    if (!isRecord(entry)) return '';
    const value = entry.name ?? entry.key ?? entry.field;
    return typeof value === 'string' ? value : '';
  }).filter(Boolean);
}

function advertisesField(model: JsonRecord, field: string): boolean {
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  return Object.hasOwn(defaults, field)
    || requiredSubmitFields(model).includes(field)
    || optionFieldNames(model).includes(field);
}

function soundCapability(model: JsonRecord): boolean | undefined {
  if (model.nativeAudio === false || model.supportsNativeAudio === false) return false;
  if (model.nativeAudio === true || model.supportsNativeAudio === true) return true;
  const values = optionValues(model, 'sound');
  if (values.length) return matchingOption(values, 'on') !== undefined;
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  if (defaults.sound === 'on' || advertisesField(model, 'sound')) return true;
  return undefined;
}

function modelNames(model: JsonRecord): string[] {
  return [model.submitModel, model.displayName, model.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
}

function selectModel(result: unknown, requestedModel?: string, needsSound = false): JsonRecord {
  const models = configModels(result);
  if (!models.length) throw new Error('Topview did not return a compatible model for this request.');
  const requested = requestedModel?.trim();
  if (requested && requested !== 'auto') {
    const match = models.find((model) => modelNames(model)
      .some((value) => value.toLowerCase() === requested.toLowerCase()));
    if (!match) {
      throw new Error(`Topview model "${requested}" is not available for this generation type. Refresh the model choice and try again.`);
    }
    if (needsSound && soundCapability(match) === false) {
      throw new Error(`Topview model "${requested}" does not support native sound. Disable sound or choose a model that does.`);
    }
    return match;
  }
  const preferred = findStringByKeys(result, ['preferredSubmitModel', 'preferred_submit_model']);
  const selected = models.find((model) => modelNames(model).includes(preferred ?? ''))
    ?? models.find((model) => model.preferred === true)
    ?? models[0];
  if (needsSound && soundCapability(selected) === false) {
    throw new Error(`Topview's default model "${modelNames(selected)[0] ?? 'selected'}" does not support native sound. Disable sound or explicitly choose another model.`);
  }
  return selected;
}

function normalizeTopviewImageReferences(medias: TopviewImageGenerateParams['medias']): TopviewReference[] {
  return (medias ?? [])
    .flatMap((entry) => typeof entry?.value === 'string' && entry.value.trim()
      ? [{ value: entry.value.trim(), role: 'image' as const }]
      : [])
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);
}

export function buildTopviewImageRequest(args: {
  config: unknown;
  params: TopviewImageGenerateParams;
  references: UploadedTopviewReference[];
  boardId: string;
}): { req: JsonRecord; model: string; taskType: 'text_to_image' | 'image_edit' } {
  const taskType = args.references.length ? 'image_edit' : 'text_to_image';
  const model = selectModel(args.config, args.params.model);
  const submitModel = modelNames(model)[0]?.trim();
  if (!submitModel) throw new Error('Topview returned an image model without a submit identifier.');
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const req: JsonRecord = {
    taskType,
    model: submitModel,
    prompt: sanitizeTopviewPrompt(args.params.prompt),
    generateCount: Math.max(1, Math.min(4, Math.round(args.params.generateCount ?? 1))),
    boardId: args.boardId,
    ...(args.references.length ? { inputImageFileIds: args.references.map((reference) => reference.fileId) } : {}),
  };
  for (const [field, requested, fallback] of [
    ['aspectRatio', args.params.aspectRatio, '16:9'],
    ['resolution', args.params.resolution, '1K'],
  ] as const) {
    if (!advertisesField(model, field)) continue;
    req[field] = configValue({ model, field, requested, fallback });
  }
  for (const field of requiredSubmitFields(model)) {
    if ((req[field] === undefined || req[field] === null || req[field] === '') && defaults[field] !== undefined) {
      req[field] = defaults[field];
    }
    if (req[field] === undefined || req[field] === null || req[field] === '') {
      throw new Error(`Topview's selected image model requires the unsupported field "${field}".`);
    }
  }
  return { req, model: submitModel, taskType };
}

export function sanitizeTopviewPrompt(prompt: string): string {
  const withoutMentionSyntax = prompt
    .replace(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g, (_match, name: string) => name.replaceAll('-', ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();
  return `${withoutMentionSyntax}\n\nDo not render labels, mention tags, captions, subtitles, watermarks, interface text, or any other on-screen text.`;
}

function matchingOption(values: unknown[], requested: unknown): unknown | undefined {
  if (requested === undefined) return undefined;
  const requestedNumber = typeof requested === 'number'
    ? requested
    : typeof requested === 'string' && /^-?\d+(?:\.\d+)?p?$/i.test(requested.trim())
      ? Number.parseFloat(requested)
      : undefined;
  return values.find((value) => {
    if (requestedNumber !== undefined) {
      const valueNumber = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+(?:\.\d+)?p?$/i.test(value.trim())
          ? Number.parseFloat(value)
          : undefined;
      if (valueNumber !== undefined) return valueNumber === requestedNumber;
    }
    return String(value).toLowerCase() === String(requested).toLowerCase();
  });
}

function numericConstraint(model: JsonRecord, field: string): { min?: number; max?: number; step?: number } {
  const options = model.submitParameterOptions;
  let constraint: unknown;
  if (isRecord(options)) constraint = options[field];
  else if (Array.isArray(options)) constraint = options.find((candidate) => isRecord(candidate) && (
    candidate.name === field || candidate.key === field || candidate.field === field
  ));
  if (!isRecord(constraint)) return {};
  const min = Number(constraint.min ?? constraint.minimum);
  const max = Number(constraint.max ?? constraint.maximum);
  const step = Number(constraint.step ?? constraint.multipleOf);
  return {
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
    ...(Number.isFinite(step) && step > 0 ? { step } : {}),
  };
}

function configValue(args: {
  model: JsonRecord;
  field: string;
  requested?: unknown;
  fallback?: unknown;
  required?: boolean;
}): unknown {
  const defaults = isRecord(args.model.defaultSubmitParameters) ? args.model.defaultSubmitParameters : {};
  const hasExplicitRequest = args.requested !== undefined;
  const hasDefault = defaults[args.field] !== undefined && defaults[args.field] !== null;
  const requested = args.requested ?? defaults[args.field] ?? args.fallback;
  if (requested === undefined) {
    if (args.required) throw new Error(`Topview model configuration requires "${args.field}", but did not provide a usable default.`);
    return undefined;
  }
  const values = optionValues(args.model, args.field);
  if (values.length) {
    const match = matchingOption(values, requested);
    if (match === undefined) {
      if (!hasExplicitRequest && !hasDefault) return values[0];
      throw new Error(`Topview model "${modelNames(args.model)[0] ?? 'selected'}" does not allow ${args.field}=${String(requested)}. Allowed values: ${values.map(String).join(', ')}.`);
    }
    return match;
  }
  const constraint = numericConstraint(args.model, args.field);
  if (constraint.min !== undefined || constraint.max !== undefined || constraint.step !== undefined) {
    const number = Number(requested);
    if (!Number.isFinite(number)
      || (constraint.min !== undefined && number < constraint.min)
      || (constraint.max !== undefined && number > constraint.max)
      || (constraint.step !== undefined && constraint.min !== undefined
        && Math.abs((number - constraint.min) / constraint.step - Math.round((number - constraint.min) / constraint.step)) > 1e-9)) {
      throw new Error(`Topview model "${modelNames(args.model)[0] ?? 'selected'}" does not allow ${args.field}=${String(requested)}.`);
    }
    return number;
  }
  return requested;
}

function normalizeTopviewReferences(medias: TopviewGenerateParams['medias']): TopviewReference[] {
  const entries = medias ?? [];
  const allowed = new Set<TopviewMediaRole>(['image', 'start_image', 'end_image', 'video', 'audio']);
  const references = entries.map((entry, index): TopviewReference => {
    if (!entry || typeof entry.value !== 'string' || !entry.value.trim()) {
      throw new Error(`Topview element reference ${index + 1} is empty.`);
    }
    const role = (entry.role?.trim() || 'image') as TopviewMediaRole;
    if (!allowed.has(role)) throw new Error(`Topview does not support element role "${role}".`);
    return { value: entry.value.trim(), role };
  });
  if (references.filter((entry) => entry.role === 'start_image').length > 1) {
    throw new Error('Topview accepts only one start-frame element per generation.');
  }
  if (references.filter((entry) => entry.role === 'end_image').length > 1) {
    throw new Error('Topview accepts only one end-frame element per generation.');
  }
  return references;
}

export function topviewTaskTypeForMedias(medias: TopviewGenerateParams['medias']): TopviewVideoTaskType {
  const references = normalizeTopviewReferences(medias);
  if (!references.length) return 'text_to_video';
  const startFrames = references.filter((entry) => entry.role === 'start_image');
  const onlyFrameInputs = references.every((entry) => entry.role === 'start_image' || entry.role === 'end_image');
  return startFrames.length === 1 && onlyFrameInputs ? 'image_to_video' : 'omni_reference';
}

export function buildTopviewVideoRequest(args: {
  config: unknown;
  taskType: TopviewVideoTaskType;
  params: TopviewGenerateParams;
  references: UploadedTopviewReference[];
  boardId: string;
}): { req: JsonRecord; model: string; durationSec: number } {
  const model = selectModel(args.config, args.params.model, args.params.generateAudio === true);
  const submitModel = String(model.submitModel ?? '').trim();
  if (!submitModel) throw new Error('Topview returned a video model without a submit identifier.');
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const required = new Set(requiredSubmitFields(model));
  const requestedDuration = args.params.durationSec === undefined ? undefined : Math.round(args.params.durationSec);
  if (requestedDuration !== undefined && (!Number.isFinite(requestedDuration) || requestedDuration === 0 || requestedDuration < -1)) {
    throw new Error('Topview video duration must be a positive whole number of seconds.');
  }
  let prompt = sanitizeTopviewPrompt(args.params.prompt);
  const req: JsonRecord = {
    ...defaults,
    taskType: args.taskType,
    model: submitModel,
    prompt,
    boardId: args.boardId,
  };
  delete req.generateAudio;

  const assignConfigured = (field: string, requested: unknown, fallback?: unknown): void => {
    const supported = advertisesField(model, field);
    if (!supported) {
      if (requested !== undefined) {
        throw new Error(`Topview model "${submitModel}" does not accept ${field} for this generation type.`);
      }
      return;
    }
    const value = configValue({ model, field, requested, fallback, required: required.has(field) });
    if (value !== undefined) req[field] = value;
  };

  assignConfigured('resolution', args.params.resolution === undefined
    ? undefined
    : Number.parseInt(args.params.resolution, 10), 720);
  assignConfigured('duration', requestedDuration, 5);
  assignConfigured('generatingCount', undefined, 1);
  if (args.taskType !== 'image_to_video') {
    assignConfigured('aspectRatio', args.params.aspectRatio?.trim(), '16:9');
  } else if (args.params.aspectRatio !== undefined || required.has('aspectRatio')) {
    assignConfigured('aspectRatio', args.params.aspectRatio?.trim(), '16:9');
  }
  const audioCapability = soundCapability(model);
  if (audioCapability !== false && (advertisesField(model, 'sound') || args.params.generateAudio === true)) {
    req.sound = configValue({
      model,
      field: 'sound',
      requested: args.params.generateAudio === true ? 'on' : 'off',
      required: required.has('sound'),
    });
  } else if (args.params.generateAudio === true) {
    throw new Error(`Topview model "${submitModel}" does not support native sound.`);
  }

  if (args.taskType === 'image_to_video') {
    const firstFrame = args.references.find((entry) => entry.role === 'start_image');
    const endFrame = args.references.find((entry) => entry.role === 'end_image');
    if (!firstFrame) throw new Error('Topview image-to-video generation requires an explicit start-frame element.');
    req.firstFrameFileId = firstFrame.fileId;
    if (endFrame) req.endFrameFileId = endFrame.fileId;
  }
  if (args.taskType === 'omni_reference') {
    let imageIndex = 0;
    let videoIndex = 0;
    let audioIndex = 0;
    const inputImages: JsonRecord[] = [];
    const inputVideos: JsonRecord[] = [];
    const inputAudios: JsonRecord[] = [];
    const instructions: string[] = [];
    for (const reference of args.references) {
      if (reference.role === 'video') {
        const name = `Video${++videoIndex}`;
        inputVideos.push({ fileId: reference.fileId, name });
        instructions.push(`<${name.toUpperCase()}> is an authoritative motion and timing reference.`);
      } else if (reference.role === 'audio') {
        const name = `Audio${++audioIndex}`;
        inputAudios.push({ fileId: reference.fileId, name });
        instructions.push(`<${name.toUpperCase()}> is an authoritative audio reference.`);
      } else {
        const name = `Image${++imageIndex}`;
        inputImages.push({ fileId: reference.fileId, name });
        const meaning = reference.role === 'start_image'
          ? 'the requested opening-frame visual reference'
          : reference.role === 'end_image'
            ? 'the requested closing-frame visual reference'
            : 'an authoritative visual reference';
        instructions.push(`<${name.toUpperCase()}> is ${meaning}.`);
      }
    }
    if (inputAudios.length && !advertisesField(model, 'inputAudios')) {
      throw new Error(`Topview model "${submitModel}" does not accept audio reference elements for omni-reference video.`);
    }
    prompt = `${instructions.join('\n')} Match every supplied subject, setting, prop, wardrobe, silhouette, material, color, and requested motion.\n\n${prompt}`;
    req.prompt = prompt;
    if (inputImages.length) req.inputImages = inputImages;
    if (inputVideos.length) req.inputVideos = inputVideos;
    if (inputAudios.length) req.inputAudios = inputAudios;
  }

  for (const field of required) {
    if (req[field] === undefined || req[field] === null || req[field] === '') {
      throw new Error(`Topview model "${submitModel}" requires "${field}" for this request.`);
    }
  }
  const duration = Number(req.duration ?? defaults.duration ?? requestedDuration ?? 5);
  const durationSec = Number.isFinite(duration) ? duration : 5;
  return { req, model: submitModel, durationSec };
}

const CONTENT_TYPE_FORMATS: Record<string, string> = {
  'image/bmp': 'bmp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
};

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  bmp: 'image/bmp', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
};

function allowedFormats(role: TopviewMediaRole): Set<string> {
  if (role === 'video') return new Set(['mp4', 'avi', 'mov']);
  if (role === 'audio') return new Set(['mp3', 'wav', 'm4a']);
  return new Set(['png', 'jpg', 'jpeg', 'bmp', 'webp']);
}

function referenceFormat(value: string, role: TopviewMediaRole, contentType?: string | null): string {
  const normalizedType = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  const byType = normalizedType ? CONTENT_TYPE_FORMATS[normalizedType] : undefined;
  const pathname = (() => { try { return new URL(value).pathname; } catch { return value; } })();
  const byExtension = path.extname(pathname).slice(1).toLowerCase();
  const format = byType ?? byExtension;
  if (!format || !allowedFormats(role).has(format)) {
    const label = role === 'video' ? 'video' : role === 'audio' ? 'audio' : 'image';
    throw new Error(`Topview received an unsupported ${label} reference format. Supported formats: ${[...allowedFormats(role)].join(', ')}.`);
  }
  if (normalizedType && !byType) {
    throw new Error(`Topview refused a remote reference with content type "${normalizedType}".`);
  }
  return format;
}

function ipv4Bytes(address: string): number[] | undefined {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

function ipv6Bytes(address: string): number[] | undefined {
  let normalized = address.toLowerCase().split('%', 1)[0];
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1);
  const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (ipv4Tail) {
    const bytes = ipv4Bytes(ipv4Tail);
    if (!bytes) return undefined;
    normalized = `${normalized.slice(0, -ipv4Tail.length)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return undefined;
  const groups = [...left, ...Array.from({ length: omitted }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >>> 8, value & 0xff];
  });
}

function isPublicIpv4(address: string): boolean {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  return !(a === 0
    || a === 10
    || a === 100 && b >= 64 && b <= 127
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 0 && c === 0
    || a === 192 && b === 0 && c === 2
    || a === 192 && b === 88 && c === 99
    || a === 192 && b === 168
    || a === 198 && (b === 18 || b === 19)
    || a === 198 && b === 51 && c === 100
    || a === 203 && b === 0 && c === 113
    || a >= 224);
}

export function isPublicTopviewReferenceAddress(address: string): boolean {
  const normalized = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const version = isIP(normalized.split('%', 1)[0]);
  if (version === 4) return isPublicIpv4(normalized);
  if (version !== 6) return false;
  const bytes = ipv6Bytes(normalized);
  if (!bytes) return false;
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mappedIpv4) return isPublicIpv4(bytes.slice(12).join('.'));
  // Only globally routed unicast space is eligible; reject documentation, transition, and benchmark ranges.
  if (bytes[0] < 0x20 || bytes[0] > 0x3f) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xfe) === 0) return false; // 2001:0000::/23
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x02) return false; // benchmark
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xf0) === 0x10) return false; // ORCHID
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xf0) === 0x20) return false; // ORCHIDv2
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false; // 6to4 can tunnel private IPv4
  if (bytes[0] === 0x3f && (bytes[1] & 0xf0) === 0xf0) return false; // 3fff::/20 documentation
  return true;
}

async function resolvePublicReferenceHost(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const normalized = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const lower = normalized.toLowerCase().replace(/\.$/, '');
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new Error('Topview remote references must use a public HTTPS host.');
  }
  const literalFamily = isIP(normalized);
  const addresses = literalFamily
    ? [{ address: normalized, family: literalFamily as 4 | 6 }]
    : await lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicTopviewReferenceAddress(entry.address))) {
    throw new Error('Topview remote references cannot resolve to a private, local, or reserved network address.');
  }
  return { address: addresses[0].address, family: addresses[0].family as 4 | 6 };
}

async function downloadPublicReference(value: string, redirects = 0): Promise<{
  bytes: Buffer;
  contentType?: string;
  finalUrl: string;
}> {
  if (redirects > 5) throw new Error('Topview remote reference redirected too many times.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Topview remote references must use public HTTPS URLs without credentials or custom ports.');
  }
  const resolved = await resolvePublicReferenceHost(url.hostname);
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      protocol: 'https:',
      hostname: resolved.address,
      family: resolved.family,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
      headers: {
        Accept: 'image/png,image/jpeg,image/bmp,image/webp,video/mp4,video/quicktime,video/x-msvideo,audio/mpeg,audio/mp4,audio/wav',
        Host: url.host,
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error(`Topview remote reference redirected without a destination (${status}).`));
          return;
        }
        downloadPublicReference(new URL(location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Topview could not download an element reference (${status}).`));
        return;
      }
      const declaredSize = Number(response.headers['content-length'] ?? 0);
      if (Number.isFinite(declaredSize) && declaredSize > MAX_REFERENCE_BYTES) {
        response.destroy();
        reject(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer | Uint8Array) => {
        size += chunk.length;
        if (size > MAX_REFERENCE_BYTES) {
          response.destroy(new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.once('error', reject);
      response.once('end', () => resolve({
        bytes: Buffer.concat(chunks),
        contentType: typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : undefined,
        finalUrl: url.href,
      }));
    });
    request.setTimeout(REFERENCE_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error('Topview timed out while downloading an element reference.'));
    });
    request.once('error', reject);
    request.end();
  });
}

async function loadReference(value: string, role: TopviewMediaRole): Promise<{ bytes: Buffer; format: string; contentType?: string }> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Topview received an empty element reference.');
  if (trimmed.startsWith('data:')) {
    const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(trimmed);
    if (!match) throw new Error('Topview received an unsupported inline element reference.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_REFERENCE_BYTES) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const format = referenceFormat('', role, match[1]);
    return { bytes, format, contentType: FORMAT_CONTENT_TYPES[format] };
  }
  let filePath: string | undefined;
  if (trimmed.startsWith('local-media://file')) {
    try { filePath = decodeURIComponent(trimmed.slice('local-media://file'.length)); }
    catch { filePath = trimmed.slice('local-media://file'.length); }
  } else if (trimmed.startsWith('file://')) {
    filePath = decodeURIComponent(new URL(trimmed).pathname);
  } else if (!/^https?:\/\//i.test(trimmed)) {
    filePath = trimmed;
  }
  if (filePath) {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error('A Topview element reference is not a file.');
    if (stats.size > MAX_REFERENCE_BYTES) throw new Error("This reference exceeds CineGen's 45 MB Topview upload safety limit.");
    const format = referenceFormat(filePath, role);
    return { bytes: await fs.readFile(filePath), format, contentType: FORMAT_CONTENT_TYPES[format] };
  }
  const downloaded = await downloadPublicReference(trimmed);
  const format = referenceFormat(downloaded.finalUrl, role, downloaded.contentType);
  return { bytes: downloaded.bytes, format, contentType: FORMAT_CONTENT_TYPES[format] };
}

function uploadHeaders(value: unknown): Record<string, string> {
  const headerRecord = collectRecords(value).find((record) => isRecord(record.headers))?.headers;
  if (!isRecord(headerRecord)) return {};
  return Object.fromEntries(Object.entries(headerRecord)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

class TopviewMcpService {
  private readonly store = new SafeCredentialStore();

  private async saveToken(payload: JsonRecord, previous: Partial<StoredToken> = {}): Promise<StoredToken> {
    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new Error('Topview returned an invalid access token.');
    }
    const token: StoredToken = {
      ...previous,
      ...payload,
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : previous.refresh_token,
      expires_at: Date.now() + Math.max(30, Number(payload.expires_in || 3600)) * 1000,
    };
    await this.store.write('token', token);
    return token;
  }

  private async tokenExchange(body: JsonRecord, client: StoredClient): Promise<JsonRecord> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) if (value !== undefined) form.set(key, String(value));
    form.set('client_id', client.client_id);
    if (client.client_secret) form.set('client_secret', client.client_secret);
    return requestJson(TOPVIEW_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    }, 'Topview could not complete authorization.');
  }

  private async accessToken(): Promise<string> {
    const token = await this.store.read<StoredToken>('token');
    if (!token?.access_token) throw new Error('Connect your Topview account in Settings before generating.');
    if (token.expires_at > Date.now() + 60_000) return token.access_token;
    const client = await this.store.read<StoredClient>('client');
    if (!client?.client_id || !token.refresh_token) {
      await this.store.remove('token');
      throw new Error('Your Topview connection expired. Connect it again in Settings.');
    }
    try {
      const refreshed = await this.tokenExchange({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        resource: TOPVIEW_RESOURCE,
      }, client);
      return (await this.saveToken(refreshed, token)).access_token;
    } catch (error) {
      await this.store.remove('token');
      throw new Error('Your Topview connection expired. Connect it again in Settings.', { cause: error });
    }
  }

  async teamConnection(): Promise<TopviewTeamConnection | null> {
    const client = await this.store.read<StoredClient>('client');
    const token = await this.store.read<StoredToken>('token');
    if (!client?.client_id || !token?.access_token) return null;
    await this.accessToken();
    const refreshed = await this.store.read<StoredToken>('token');
    if (!refreshed?.access_token) return null;
    return { client, token: refreshed };
  }

  private async mcpRequest(token: string, message: JsonRecord, sessionId?: string): Promise<{ payload: JsonRecord; sessionId?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await fetch(TOPVIEW_MCP_URL, {
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
      const parsed = (response.headers.get('content-type') || '').includes('text/event-stream')
        ? parseSse(text, message.id)
        : text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : {};
      if (!response.ok) throw remoteError(response.status, parsed, 'Topview MCP request failed.');
      if (isRecord(parsed) && parsed.error !== undefined) throw remoteError(400, parsed.error, 'Topview MCP returned an error.');
      return {
        payload: isRecord(parsed) ? parsed : {},
        sessionId: response.headers.get('mcp-session-id') || sessionId,
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new Error('Topview did not respond in time. The generation may still be running in your Topview board.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async session(): Promise<McpSession> {
    const token = await this.accessToken();
    const initialized = await this.mcpRequest(token, {
      jsonrpc: '2.0', id: `init-${crypto.randomUUID()}`, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'CineGen Desktop', version: '1.0.0' },
      },
    });
    const notified = await this.mcpRequest(token, {
      jsonrpc: '2.0', method: 'notifications/initialized', params: {},
    }, initialized.sessionId);
    let sessionId = notified.sessionId || initialized.sessionId;
    let cursor: unknown;
    const seenCursors = new Set<string>();
    const toolsByName = new Map<string, McpTool>();
    for (let page = 0; page < MAX_MCP_TOOL_PAGES; page += 1) {
      const listed = await this.mcpRequest(token, {
        jsonrpc: '2.0', id: `tools-${crypto.randomUUID()}`, method: 'tools/list',
        params: cursor === undefined ? {} : { cursor },
      }, sessionId);
      sessionId = listed.sessionId || sessionId;
      const result = isRecord(listed.payload.result) ? listed.payload.result : {};
      const pageTools = Array.isArray(result.tools)
        ? result.tools.filter((tool): tool is McpTool => isRecord(tool) && typeof tool.name === 'string')
        : [];
      for (const tool of pageTools) toolsByName.set(tool.name, tool);
      const nextCursor = result.nextCursor;
      if (typeof nextCursor !== 'string' || !nextCursor) {
        return { token, sessionId, tools: [...toolsByName.values()] };
      }
      if (seenCursors.has(nextCursor)) throw new Error('Topview returned a repeated MCP tools cursor.');
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`Topview returned more than ${MAX_MCP_TOOL_PAGES} MCP tool pages.`);
  }

  private async callTool(session: McpSession, name: string, req: JsonRecord): Promise<unknown> {
    const tool = session.tools.find((entry) => entry.name === name);
    if (!tool) throw new Error(`Your Topview account does not currently expose ${name}.`);
    const called = await this.mcpRequest(session.token, {
      jsonrpc: '2.0', id: `call-${crypto.randomUUID()}`, method: 'tools/call', params: {
        name,
        arguments: toolArguments(tool, req),
      },
    }, session.sessionId);
    session.sessionId = called.sessionId || session.sessionId;
    const result = isRecord(called.payload) ? called.payload.result : undefined;
    if (isRecord(result) && result.isError === true) {
      throw new Error(collectStrings(result).join(' ').slice(0, 700) || `Topview could not run ${name}.`);
    }
    return result;
  }

  private async chooseBoard(session: McpSession): Promise<string> {
    const listed = await this.callTool(session, 'topview_list_boards', {
      pageNo: 1, pageSize: 100, mode: 'editable-by-me',
    });
    const existing = topviewBoard(parseToolDocuments(listed));
    if (existing) return existing.boardId;
    const created = await this.callTool(session, 'topview_create_board', { name: 'CineGen' });
    const boardId = findStringByKeys(parseToolDocuments(created), ['boardId', 'board_id', 'id']);
    if (!boardId) throw new Error('Topview did not return a board ID for the CineGen board.');
    return boardId;
  }

  private async uploadReference(session: McpSession, reference: TopviewReference): Promise<UploadedTopviewReference> {
    if (reference.value.startsWith('topview-file:')) {
      const fileId = reference.value.slice('topview-file:'.length).trim();
      if (!fileId) throw new Error('Topview received an empty existing file ID.');
      return { ...reference, fileId };
    }
    const source = await loadReference(reference.value, reference.role);
    const credential = await this.callTool(session, 'ta_upload_credential', {
      format: source.format,
      needAccelerateUrl: false,
    });
    const documents = parseToolDocuments(credential);
    const fileId = findStringByKeys(documents, ['fileId', 'file_id']);
    const uploadUrl = findStringByKeys(documents, ['uploadUrl', 'upload_url', 'accelerateUrl', 'accelerate_url']);
    if (!fileId || !uploadUrl) throw new Error('Topview did not return a usable upload destination for an element.');
    const method = (findStringByKeys(documents, ['method', 'httpMethod', 'http_method']) || 'PUT').toUpperCase();
    const response = await fetch(uploadUrl, {
      method,
      headers: { ...uploadHeaders(documents), ...(source.contentType ? { 'Content-Type': source.contentType } : {}) },
      body: source.bytes as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`Topview could not upload an element reference (${response.status}).`);
    const checked = await this.callTool(session, 'ta_upload_check_file', { fileId });
    if (findBoolean(parseToolDocuments(checked)) === false) throw new Error('Topview could not verify an uploaded element reference.');
    return { ...reference, fileId };
  }

  private async reusableGeneratedImageReference(session: McpSession, url: string): Promise<string | undefined> {
    try {
      const uploaded = await this.uploadReference(session, { value: url, role: 'image' });
      return `topview-file:${uploaded.fileId}`;
    } catch (error) {
      // Keep the completed image usable even when Topview's delivery URL cannot be
      // promoted to a stable reference. The sheet UI will stop before producing
      // unanchored follow-up views and surface a focused continuity error.
      console.warn('Could not prepare the generated Topview image as a reusable reference.', error);
      return undefined;
    }
  }

  async accountStatus(): Promise<{ connected: boolean; configured: boolean; email?: string; credits?: number; error?: string }> {
    const storageError = this.store.availabilityError();
    if (storageError) return { connected: false, configured: false, error: storageError };
    try {
      const token = await this.store.read<StoredToken>('token');
      if (!token?.access_token) return { connected: false, configured: true };
      const accessToken = await this.accessToken();
      const profile = await requestJson(TOPVIEW_USERINFO_URL, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      }, 'Topview could not validate the connected account.');
      await this.store.write('profile', profile);
      const session = await this.session();
      const requiredTools = [
        'topview_get_generation_config', 'topview_generate_image', 'topview_generate_video', 'topview_query_task',
        'ta_upload_credential', 'ta_upload_check_file', 'topview_list_boards', 'topview_create_board',
      ];
      const missingTools = requiredTools.filter((name) => !session.tools.some((tool) => tool.name === name));
      if (missingTools.length) {
        throw new Error(`This Topview account is missing required MCP capabilities: ${missingTools.join(', ')}.`);
      }
      let credits = topviewCreditBalance(profile);
      if (session.tools.some((tool) => tool.name === 'topview_get_credit')) {
        try {
          credits = topviewCreditBalance(parseToolDocuments(await this.callTool(session, 'topview_get_credit', {}))) ?? credits;
        } catch { /* Credit display is optional; keep the account connected. */ }
      }
      return {
        connected: true,
        configured: true,
        ...(typeof profile?.email === 'string' ? { email: profile.email } : {}),
        ...(credits !== undefined ? { credits } : {}),
      };
    } catch (error) {
      return { connected: false, configured: true, error: safeMessage(error, 'Topview connection expired.') };
    }
  }

  async modelCatalog(): Promise<TopviewGenerationCatalog> {
    const session = await this.session();
    if (!session.tools.some((tool) => tool.name === 'topview_get_generation_config')) {
      throw new Error('Your Topview account does not currently expose its model catalog.');
    }
    const requests: Array<Omit<TopviewGenerationCatalogConfig, 'config'>> = [
      { outputType: 'image', taskType: 'text_to_image' },
      { outputType: 'image', taskType: 'image_edit' },
      { outputType: 'video', taskType: 'text_to_video' },
      { outputType: 'video', taskType: 'image_to_video' },
      { outputType: 'video', taskType: 'omni_reference' },
      { outputType: 'audio', taskType: 'music', catalogType: 'music' },
      { outputType: 'audio', taskType: 'voice', catalogType: 'voice' },
      { outputType: 'audio', taskType: 'audio', catalogType: 'audio' },
    ];
    const configs: TopviewGenerationCatalogConfig[] = [];
    for (const request of requests) {
      try {
        const config = parseToolDocuments(await this.callTool(session, 'topview_get_generation_config', {
          type: request.catalogType ?? request.outputType,
          ...(request.catalogType ? {} : { taskType: request.taskType }),
          refresh: true,
        }));
        configs.push({ ...request, config });
      } catch {
        // Some accounts do not expose every generation mode. Keep the modes
        // that are actually available instead of failing the whole catalog.
      }
    }
    if (!configs.length) throw new Error('Topview returned an empty model catalog.');
    return {
      configs,
      tools: session.tools.map((tool) => tool.name),
      toolSchemas: Object.fromEntries(session.tools
        .filter((tool) => ['topview_get_generation_config', 'topview_generate_audio', 'topview_generate_music', 'topview_generate_voice', 'topview_clone_voice', 'topview_query_task'].includes(tool.name))
        .map((tool) => [tool.name, tool.inputSchema])),
      fetchedAt: new Date().toISOString(),
    };
  }

  async authLogin(): Promise<{ connected: boolean; configured: boolean; email?: string; credits?: number; error?: string }> {
    const storageError = this.store.availabilityError();
    if (storageError) throw new Error(storageError);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('CineGen could not open a secure local return address for Topview.');
    }
    const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
    const verifier = base64Url(crypto.randomBytes(48));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64Url(crypto.randomBytes(32));
    let callbackResponse: ServerResponse | undefined;
    let rejectCallback: ((error: Error) => void) | undefined;
    const callback = new Promise<URL>((resolve, reject) => {
      rejectCallback = reject;
      server.on('request', (request, response) => {
        const url = new URL(request.url || '/', redirectUri);
        if (url.pathname !== '/oauth/callback') {
          response.writeHead(404).end();
          return;
        }
        callbackResponse = response;
        resolve(url);
      });
    });
    const callbackTimer = setTimeout(() => rejectCallback?.(new Error('Topview sign-in timed out. Try connecting again.')), OAUTH_TIMEOUT_MS);
    callbackTimer.unref?.();
    try {
      const registered = await requestJson(TOPVIEW_REGISTER_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'CineGen Desktop',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'openid email mcp:tools',
        }),
      }, 'Topview could not register CineGen for sign-in.');
      if (typeof registered.client_id !== 'string') throw new Error('Topview did not return an OAuth client ID.');
      const client: StoredClient = {
        ...registered,
        client_id: registered.client_id,
        client_secret: typeof registered.client_secret === 'string' ? registered.client_secret : undefined,
        token_endpoint_auth_method: typeof registered.token_endpoint_auth_method === 'string'
          ? registered.token_endpoint_auth_method
          : 'none',
        redirect_uri: redirectUri,
      };
      await this.store.write('client', client);
      const authorization = new URL(TOPVIEW_AUTHORIZE_URL);
      authorization.search = new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
        scope: 'openid email mcp:tools', state, code_challenge: challenge,
        code_challenge_method: 'S256', resource: TOPVIEW_RESOURCE,
      }).toString();
      await shell.openExternal(authorization.href);
      const returned = await callback;
      const oauthError = returned.searchParams.get('error_description') || returned.searchParams.get('error');
      if (oauthError) throw new Error(oauthError);
      if (returned.searchParams.get('state') !== state) throw new Error('Topview sign-in could not be verified. Try again.');
      const code = returned.searchParams.get('code');
      if (!code) throw new Error('Topview did not return an authorization code.');
      const token = await this.tokenExchange({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier,
        resource: TOPVIEW_RESOURCE,
      }, client);
      const stored = await this.saveToken(token);
      try {
        const profileResponse = await fetch(TOPVIEW_USERINFO_URL, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${stored.access_token}` },
        });
        const profile = await readResponse(profileResponse);
        if (profileResponse.ok && isRecord(profile)) await this.store.write('profile', profile);
      } catch { /* profile is optional */ }
      sendOauthPage(callbackResponse!, true, 'You can close this window and return to CineGen.');
      return this.accountStatus();
    } catch (error) {
      if (callbackResponse && !callbackResponse.writableEnded) {
        sendOauthPage(callbackResponse, false, safeMessage(error, 'Topview sign-in did not complete.'));
      }
      throw error;
    } finally {
      clearTimeout(callbackTimer);
      server.close();
    }
  }

  async authLogout(): Promise<void> {
    await Promise.all([
      this.store.remove('token'), this.store.remove('client'), this.store.remove('profile'),
    ]);
  }

  private validateGenerateParams(params: TopviewGenerateParams): void {
    if (!params || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw new Error('Topview video generation requires a prompt.');
    }
  }

  private async submitWithSession(session: McpSession, params: TopviewGenerateParams): Promise<{
    result: TopviewSubmitResult;
    documents: unknown[];
  }> {
    this.validateGenerateParams(params);
    const references = normalizeTopviewReferences(params.medias);
    const taskType = topviewTaskTypeForMedias(params.medias);
    const boardId = await this.chooseBoard(session);
    const config = parseToolDocuments(await this.callTool(session, 'topview_get_generation_config', {
      type: 'video', taskType,
    }));
    // Validate model selection and every requested live-config field before uploading user media.
    buildTopviewVideoRequest({
      config,
      taskType,
      params,
      boardId,
      references: references.map((reference, index) => ({ ...reference, fileId: `preflight-${index + 1}` })),
    });
    const uploaded: UploadedTopviewReference[] = [];
    for (const reference of references) uploaded.push(await this.uploadReference(session, reference));
    const built = buildTopviewVideoRequest({ config, taskType, params, references: uploaded, boardId });
    const submitted = await this.callTool(session, 'topview_generate_video', built.req);
    const documents = parseToolDocuments(submitted);
    const taskId = findStringByKeys(documents, ['taskId', 'task_id', 'generationId', 'generation_id']);
    if (!taskId) throw new Error('Topview did not return a task ID for this generation.');
    return {
      result: { taskId, taskType, boardId, model: built.model, durationSec: built.durationSec },
      documents,
    };
  }

  async submit(params: TopviewGenerateParams): Promise<TopviewSubmitResult> {
    const submitted = await this.submitWithSession(await this.session(), params);
    return submitted.result;
  }

  private validateQueryParams(params: TopviewQueryParams): void {
    if (!params || typeof params.taskId !== 'string' || !params.taskId.trim()) {
      throw new Error('Topview task query requires a task ID.');
    }
    if (!['text_to_video', 'image_to_video', 'omni_reference'].includes(params.taskType)) {
      throw new Error('Topview task query received an unsupported task type.');
    }
    if (typeof params.boardId !== 'string' || !params.boardId.trim()) {
      throw new Error('Topview task query requires the board ID returned by submit.');
    }
    if (typeof params.model !== 'string' || !params.model.trim() || !Number.isFinite(params.durationSec)) {
      throw new Error('Topview task query requires the complete result returned by submit.');
    }
  }

  private async queryWithSession(session: McpSession, params: TopviewQueryParams): Promise<TopviewQueryResult> {
    this.validateQueryParams(params);
    const polled = await this.callTool(session, 'topview_query_task', {
      taskType: params.taskType,
      taskId: params.taskId.trim(),
      needCloudFrontUrl: true,
    });
    const documents = parseToolDocuments(polled);
    const rawStatus = taskStatus(documents);
    const url = findResultUrl(documents);
    const failure = /fail|error|cancel/.test(rawStatus);
    const successful = Boolean(url) || /success|complete|done/.test(rawStatus);
    const status: TopviewQueryResult['status'] = failure
      ? 'fail'
      : successful && url
        ? 'success'
        : successful
          ? 'fail'
          : /^(init|created|queued)$/.test(rawStatus)
            ? 'init'
            : 'running';
    const boardTaskId = findStringByKeys(documents, ['boardTaskId', 'board_task_id']);
    const remoteErrorMessage = findStringByKeys(documents, [
      'errorMsg', 'error_msg', 'errorMessage', 'error_message', 'failureReason', 'failure_reason',
    ]);
    const error = status === 'fail'
      ? remoteErrorMessage
        ?? (successful ? 'Topview completed the task without returning a video URL.' : 'Topview could not complete this video.')
      : undefined;
    return {
      ...params,
      taskId: params.taskId.trim(),
      status,
      ...(url ? { url } : {}),
      ...(error ? { error } : {}),
      boardUrl: `https://www.topview.ai/board/${encodeURIComponent(params.boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ''}`,
    };
  }

  async query(params: TopviewQueryParams): Promise<TopviewQueryResult> {
    return this.queryWithSession(await this.session(), params);
  }

  async generate(params: TopviewGenerateParams): Promise<TopviewGenerateResult> {
    const session = await this.session();
    const submitted = await this.submitWithSession(session, params);
    const initialUrl = findResultUrl(submitted.documents);
    if (initialUrl) {
      return {
        url: initialUrl,
        mediaType: 'video',
        durationSec: submitted.result.durationSec,
        taskId: submitted.result.taskId,
        model: submitted.result.model,
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(submitted.result.boardId)}`,
      };
    }
    const initialStatus = taskStatus(submitted.documents);
    if (/fail|error|cancel/.test(initialStatus)) {
      throw new Error(findStringByKeys(submitted.documents, ['errorMsg', 'error_msg', 'errorMessage', 'error_message'])
        ?? 'Topview could not complete this video.');
    }
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const query = await this.queryWithSession(session, submitted.result);
      if (query.status === 'fail') throw new Error(query.error ?? 'Topview could not complete this video.');
      if (query.status === 'success' && query.url) {
        return {
          url: query.url,
          mediaType: 'video',
          durationSec: query.durationSec,
          taskId: query.taskId,
          model: query.model,
          boardUrl: query.boardUrl,
        };
      }
    }
    throw new Error(`Topview is still processing task ${submitted.result.taskId}. Open your Topview board to check it; do not submit the same render again.`);
  }

  async generateImage(params: TopviewImageGenerateParams): Promise<TopviewImageGenerateResult> {
    if (!params || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw new Error('Topview image generation requires a prompt.');
    }
    const session = await this.session();
    const references = normalizeTopviewImageReferences(params.medias);
    const taskType = references.length ? 'image_edit' : 'text_to_image';
    const boardId = await this.chooseBoard(session);
    const config = parseToolDocuments(await this.callTool(session, 'topview_get_generation_config', {
      type: 'image', taskType,
    }));
    buildTopviewImageRequest({
      config, params, boardId,
      references: references.map((reference, index) => ({ ...reference, fileId: `preflight-${index + 1}` })),
    });
    const uploaded: UploadedTopviewReference[] = [];
    for (const reference of references) uploaded.push(await this.uploadReference(session, reference));
    const built = buildTopviewImageRequest({ config, params, references: uploaded, boardId });
    const submitted = await this.callTool(session, 'topview_generate_image', built.req);
    const documents = parseToolDocuments(submitted);
    const taskId = findStringByKeys(documents, ['taskId', 'task_id', 'generationId', 'generation_id']);
    const initialUrl = findResultUrl(documents);
    if (initialUrl) {
      return {
        url: initialUrl, mediaType: 'image', taskId, model: built.model,
        referenceValue: generatedImageFileReference(documents)
          ?? await this.reusableGeneratedImageReference(session, initialUrl),
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}`,
      };
    }
    if (!taskId) throw new Error('Topview did not return a task ID for this image generation.');
    const initialStatus = taskStatus(documents);
    if (/fail|error|cancel/.test(initialStatus)) {
      throw new Error(findStringByKeys(documents, ['errorMsg', 'error_msg', 'errorMessage', 'error_message'])
        ?? 'Topview could not complete this image.');
    }
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const polled = await this.callTool(session, 'topview_query_task', {
        taskType: built.taskType, taskId, needCloudFrontUrl: true,
      });
      const polledDocuments = parseToolDocuments(polled);
      const url = findResultUrl(polledDocuments);
      const status = taskStatus(polledDocuments);
      if (url) {
        const boardTaskId = findStringByKeys(polledDocuments, ['boardTaskId', 'board_task_id']);
        return {
          url, mediaType: 'image', taskId, model: built.model,
          referenceValue: generatedImageFileReference(polledDocuments)
            ?? await this.reusableGeneratedImageReference(session, url),
          boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ''}`,
        };
      }
      if (/fail|error|cancel/.test(status)) {
        throw new Error(findStringByKeys(polledDocuments, ['errorMsg', 'error_msg', 'errorMessage', 'error_message'])
          ?? 'Topview could not complete this image.');
      }
    }
    throw new Error(`Topview is still processing image task ${taskId}. Open your Topview board to check it; do not submit the same render again.`);
  }

  async generateAudio(params: TopviewAudioGenerateParams): Promise<TopviewAudioGenerateResult> {
    if (!params || typeof params.prompt !== 'string' || !params.prompt.trim()) {
      throw new Error('Topview audio generation requires text or a prompt.');
    }
    const session = await this.session();
    const boardId = await this.chooseBoard(session);
    let uploaded: UploadedTopviewReference | undefined;
    if (params.referenceAudio) {
      uploaded = await this.uploadReference(session, { value: params.referenceAudio, role: 'audio' });
    }
    let toolName: string;
    let taskType: string;
    let request: JsonRecord;
    if (params.kind === 'music') {
      toolName = 'topview_generate_music';
      taskType = 'ai_music';
      request = {
        model: params.model,
        lyrics: params.prompt.trim(),
        styles: params.styles,
        instrumental: params.instrumental,
        ...(uploaded ? { referenceAudio: { fileId: uploaded.fileId } } : {}),
        boardId,
      };
    } else if (params.kind === 'voice') {
      if (!params.voiceId?.trim()) throw new Error('Choose a Topview voice ID for text-to-speech.');
      toolName = 'topview_generate_voice';
      taskType = 'text_to_speech';
      request = {
        voiceId: params.voiceId.trim(),
        voiceText: params.prompt.trim(),
        voiceSpeed: params.voiceSpeed,
        emotionName: params.emotion,
        boardId,
      };
    } else {
      if (!uploaded) throw new Error('Seed Audio requires a reference audio clip.');
      toolName = 'topview_generate_audio';
      taskType = 'audio_design';
      request = {
        model: params.model,
        text: params.prompt.trim(),
        referenceAudioFileId: uploaded.fileId,
        emotionText: params.emotionText,
        boardId,
      };
    }
    let documents = parseToolDocuments(await this.callTool(session, toolName, request));
    const taskId = findStringByKeys(documents, ['taskId', 'task_id', 'generationId', 'generation_id']);
    const immediate = findResultUrl(documents);
    if (immediate) return { url: immediate, mediaType: 'audio', taskId, model: params.model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` };
    if (!taskId) throw new Error('Topview did not return a task ID for this audio generation.');
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      documents = parseToolDocuments(await this.callTool(session, 'topview_query_task', {
        taskType, taskId, needCloudFrontUrl: true,
      }));
      const url = findResultUrl(documents);
      if (url) return { url, mediaType: 'audio', taskId, model: params.model, boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` };
      if (/fail|error|cancel/.test(taskStatus(documents))) {
        throw new Error(findStringByKeys(documents, ['errorMsg', 'error_msg', 'errorMessage', 'error_message']) ?? 'Topview could not complete this audio generation.');
      }
    }
    throw new Error(`Topview is still processing audio task ${taskId}. Open your Topview board to check it; do not submit the same task again.`);
  }
}

const topviewMcpService = new TopviewMcpService();

export function exportTopviewTeamConnection(): Promise<TopviewTeamConnection | null> {
  return topviewMcpService.teamConnection();
}

export function registerTopviewHandlers(): void {
  const service = topviewMcpService;
  ipcMain.handle('topview:account-status', () => service.accountStatus());
  ipcMain.handle('topview:model-catalog', () => service.modelCatalog());
  ipcMain.handle('topview:auth-login', () => service.authLogin());
  ipcMain.handle('topview:auth-logout', () => service.authLogout());
  ipcMain.handle('topview:submit', (_event, params: TopviewGenerateParams) => service.submit(params));
  ipcMain.handle('topview:query', (_event, params: TopviewQueryParams) => service.query(params));
  ipcMain.handle('topview:generate', (_event, params: TopviewGenerateParams) => service.generate(params));
  ipcMain.handle('topview:generate-image', (_event, params: TopviewImageGenerateParams) => service.generateImage(params));
  ipcMain.handle('topview:generate-audio', (_event, params: TopviewAudioGenerateParams) => service.generateAudio(params));
}
