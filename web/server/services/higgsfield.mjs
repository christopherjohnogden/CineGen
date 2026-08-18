import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CapabilityUnavailableError,
  ServiceError,
  isPlainRecord,
  isWebMediaReference,
  requireRecord,
  requireString,
  resolveWebMediaPath,
  validatePublicUrl,
} from './_shared.mjs';

const execFileAsync = promisify(execFile);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OUTPUT_TYPES = new Set(['image', 'video', 'audio', 'text', '3d']);
const QUICK_EDIT_OUTPUT_TYPES = new Set(['image', 'video']);
const REFERENCE_MODES = new Set(['frame', 'segment', 'first-last']);
const MEDIA_ROLES = new Set(['image', 'start_image', 'end_image', 'video', 'audio']);
const ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);
const CLI_PARAM_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const MAX_GENERIC_PARAM_ENTRIES = 2_000;
const MAX_GENERIC_PARAM_DEPTH = 24;
const MAX_GENERIC_STRING_LENGTH = 2 * 1024 * 1024;
const RESERVED_CLI_PARAMS = new Set([
  'help', 'h', 'json', 'no-color', 'no_color', 'wait', 'wait-timeout', 'wait_timeout',
  'wait-interval', 'wait_interval', 'output-dir', 'output_dir',
  'image', 'image-references', 'image_references', 'start-image', 'start_image',
  'end-image', 'end_image', 'video', 'video-references', 'video_references',
  'audio', 'audio-references', 'audio_references', 'prompt',
]);
const MEDIA_INPUT_KEYS = Object.freeze({
  image_url: 'contextual_image',
  imageUrl: 'contextual_image',
  image_urls: 'contextual_image',
  image_references: 'image',
  input_image: 'contextual_image',
  input_images: 'image',
  reference_image_url: 'image',
  start_image_url: 'start_image',
  startImageUrl: 'start_image',
  end_image_url: 'end_image',
  endImageUrl: 'end_image',
  video_url: 'video',
  videoUrl: 'video',
  video_references: 'video',
  input_video: 'video',
  audio_url: 'audio',
  audioUrl: 'audio',
  audio_references: 'audio',
  input_audio: 'audio',
});
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.aac', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav']);
const ROLE_FLAGS = Object.freeze({
  image: '--image',
  start_image: '--start-image',
  end_image: '--end-image',
  video: '--video',
  audio: '--audio',
});

export const higgsfieldCapabilities = Object.freeze({
  transport: 'server-cli',
  accountStatus: true,
  deviceAuth: 'server-configured',
  quickEdit: true,
  generate: true,
  browserProgressEvents: false,
  browserCancellation: false,
  serverShutdownCancellation: true,
  rawDesktopPaths: false,
  remoteApiKeysAcceptedFromRenderer: false,
});

function parseBooleanSetting(value) {
  return value === true || value === '1' || value === 'true' || value === 'yes';
}

function parsePositiveSetting(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ServiceError(`${label} must be a positive number.`, {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  return Math.floor(parsed);
}

function validateCommand(value, label) {
  const command = requireString(value, label, { maxLength: 4_096 });
  if (/[\0\r\n]/.test(command)) {
    throw new ServiceError(`${label} contains invalid characters.`, {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  if (!path.isAbsolute(command) && !COMMAND_NAME_PATTERN.test(command)) {
    throw new ServiceError(`${label} must be an absolute path or a bare executable name.`, {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  return command;
}

function validateModel(value) {
  return requireString(value, 'Higgsfield model', { maxLength: 128, pattern: MODEL_PATTERN });
}

function validateOutputType(value) {
  if (!OUTPUT_TYPES.has(value)) {
    throw new ServiceError('Higgsfield output type must be image, video, audio, text, or 3d.', {
      code: 'INVALID_INPUT',
    });
  }
  return value;
}

function validateQuickEditOutputType(value) {
  if (!QUICK_EDIT_OUTPUT_TYPES.has(value)) {
    throw new ServiceError('Higgsfield Quick Edit output type must be image or video.', {
      code: 'INVALID_INPUT',
    });
  }
  return value;
}

function optionalPrompt(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ServiceError('Higgsfield prompt must be a string.', { code: 'INVALID_INPUT' });
  }
  const prompt = value.trim();
  if (!prompt) return undefined;
  if (prompt.length > 100_000) {
    throw new ServiceError('Higgsfield prompt is too long.', { code: 'INVALID_INPUT' });
  }
  if (prompt.includes('\0')) {
    throw new ServiceError('Higgsfield prompt contains invalid characters.', { code: 'INVALID_INPUT' });
  }
  return prompt;
}

function optionalPromptValue(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return optionalPrompt(value);
  return validateCliParamValue(value, 'Higgsfield prompt');
}

function optionalSeconds(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 7 * 24 * 60 * 60) {
    throw new ServiceError(`${label} must be a non-negative finite number.`, {
      code: 'INVALID_INPUT',
    });
  }
  return value;
}

function optionalReference(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, label, { maxLength: 4_096 });
}

function inferRawMediaRole(value, outputType) {
  let pathname = value;
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(value) || value.startsWith('/')) {
      pathname = new URL(value, 'https://cinegen.invalid').pathname;
    }
    pathname = decodeURIComponent(pathname);
  } catch {
    // Reference validation reports malformed URLs/encoding with the field label later.
  }
  const extension = path.extname(pathname).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (outputType === 'video') return 'start_image';
  if (outputType === 'text') return 'video';
  if (outputType === 'audio') return 'audio';
  return 'image';
}

function optionalAspectRatio(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const ratio = requireString(value, 'Higgsfield aspect ratio', { maxLength: 16 });
  if (!ASPECT_RATIOS.has(ratio)) {
    throw new ServiceError('Higgsfield aspect ratio is not supported.', { code: 'INVALID_INPUT' });
  }
  return ratio;
}

function validateGenerateParams(value) {
  const params = requireRecord(value, 'Higgsfield generation parameters');
  return {
    prompt: optionalPromptValue(params.prompt),
    model: validateModel(params.model),
    outputType: validateOutputType(params.outputType ?? params.mediaType),
    referenceValue: optionalReference(params.referenceValue, 'Higgsfield reference'),
    inputs: params.inputs === undefined ? undefined : requireRecord(params.inputs, 'Higgsfield inputs'),
    params: params.params === undefined ? undefined : requireRecord(params.params, 'Higgsfield params'),
    extra: params.extra === undefined ? undefined : requireRecord(params.extra, 'Higgsfield extra params'),
    medias: params.medias,
    aspectRatio: params.aspectRatio,
    durationSec: params.durationSec,
    count: params.count,
  };
}

function validateQuickEditParams(value) {
  const params = requireRecord(value, 'Higgsfield Quick Edit parameters');
  if (!REFERENCE_MODES.has(params.referenceMode)) {
    throw new ServiceError('Higgsfield reference mode is invalid.', { code: 'INVALID_INPUT' });
  }
  const frameTimeSec = optionalSeconds(params.frameTimeSec, 'Frame time');
  const sourceStartSec = optionalSeconds(params.sourceStartSec, 'Source start');
  const sourceEndSec = optionalSeconds(params.sourceEndSec, 'Source end');
  if (sourceStartSec !== undefined && sourceEndSec !== undefined && sourceEndSec < sourceStartSec) {
    throw new ServiceError('Source end must not precede source start.', { code: 'INVALID_INPUT' });
  }
  const drawnFramePath = optionalReference(params.drawnFramePath, 'Clean drawn frame');
  const guideFramePath = optionalReference(params.guideFramePath, 'Annotated guide frame');
  if (guideFramePath && !drawnFramePath) {
    throw new ServiceError('An annotated guide frame requires a clean drawn frame.', {
      code: 'INVALID_INPUT',
    });
  }
  if (drawnFramePath && params.referenceMode !== 'frame') {
    throw new ServiceError('Drawn-frame Quick Edits must use frame reference mode.', {
      code: 'INVALID_INPUT',
    });
  }
  return {
    fileRef: requireString(params.fileRef, 'Quick Edit source media', { maxLength: 4_096 }),
    prompt: requireString(params.prompt, 'Higgsfield prompt', { maxLength: 100_000 }),
    model: validateModel(params.model),
    outputType: validateQuickEditOutputType(params.outputType),
    referenceMode: params.referenceMode,
    frameTimeSec,
    sourceStartSec,
    sourceEndSec,
    drawnFramePath,
    guideFramePath,
    aspectRatio: optionalAspectRatio(params.aspectRatio),
  };
}

export function buildHiggsfieldCreateArgs(params) {
  const model = validateModel(params.model);
  const prompt = optionalPromptValue(params.prompt);
  validateOutputType(params.mediaType);
  const args = ['generate', 'create', model];
  if (prompt !== undefined) args.push('--prompt', serializeCliParamValue(prompt, 'Higgsfield prompt'));
  if (params.medias !== undefined) {
    if (!Array.isArray(params.medias) || params.medias.length > 64) {
      throw new ServiceError('Higgsfield media references must contain at most 64 entries.', {
        code: 'INVALID_INPUT',
      });
    }
    for (const [index, mediaValue] of params.medias.entries()) {
      const media = requireRecord(mediaValue, `Higgsfield media ${index + 1}`);
      if (!MEDIA_ROLES.has(media.role)) {
        throw new ServiceError(`Higgsfield media ${index + 1} has an invalid role.`, {
          code: 'INVALID_INPUT',
        });
      }
      const reference = requireString(media.value, `Higgsfield media ${index + 1}`, { maxLength: 4_096 });
      args.push(ROLE_FLAGS[media.role], reference);
    }
  }
  const aspectRatio = optionalAspectRatio(params.aspectRatio);
  if (aspectRatio) args.push('--aspect_ratio', aspectRatio);
  if (params.durationSec !== undefined) {
    if (typeof params.durationSec !== 'number' || !Number.isFinite(params.durationSec) || params.durationSec <= 0 || params.durationSec > 300) {
      throw new ServiceError('Higgsfield duration must be between 0 and 300 seconds.', {
        code: 'INVALID_INPUT',
      });
    }
    args.push('--duration', String(params.durationSec));
  }
  if (params.count !== undefined) {
    if (!Number.isInteger(params.count) || params.count < 1 || params.count > 4) {
      throw new ServiceError('Higgsfield output count must be between 1 and 4.', {
        code: 'INVALID_INPUT',
      });
    }
    args.push('--count', String(params.count));
  }
  const genericParams = params.params ?? params.extra;
  if (genericParams !== undefined) {
    const values = requireRecord(genericParams, 'Higgsfield CLI params');
    const entries = Object.entries(values);
    if (entries.length > MAX_GENERIC_PARAM_ENTRIES) {
      throw new ServiceError('Higgsfield CLI params contain too many fields.', { code: 'INVALID_INPUT' });
    }
    for (const [name, value] of entries) {
      if (value === undefined || value === null) continue;
      if (!CLI_PARAM_PATTERN.test(name) || RESERVED_CLI_PARAMS.has(name)) {
        throw new ServiceError(`Higgsfield param ${name} is not allowed.`, { code: 'INVALID_INPUT' });
      }
      args.push(`--${name}`, serializeCliParamValue(value, `Higgsfield param ${name}`));
    }
  }
  args.push('--wait', '--json');
  return args;
}

function validateCliParamValue(value, label, seen = new WeakSet(), depth = 0) {
  if (depth > MAX_GENERIC_PARAM_DEPTH) {
    throw new ServiceError(`${label} is too deeply nested.`, { code: 'INVALID_INPUT' });
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ServiceError(`${label} must contain only finite numbers.`, { code: 'INVALID_INPUT' });
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_GENERIC_STRING_LENGTH || value.includes('\0')) {
      throw new ServiceError(`${label} contains an invalid or oversized string.`, { code: 'INVALID_INPUT' });
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new ServiceError(`${label} cannot contain cycles.`, { code: 'INVALID_INPUT' });
    if (value.length > MAX_GENERIC_PARAM_ENTRIES) {
      throw new ServiceError(`${label} contains too many entries.`, { code: 'INVALID_INPUT' });
    }
    seen.add(value);
    const result = value.map((entry, index) => validateCliParamValue(entry, `${label}[${index}]`, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (isPlainRecord(value)) {
    if (seen.has(value)) throw new ServiceError(`${label} cannot contain cycles.`, { code: 'INVALID_INPUT' });
    const entries = Object.entries(value);
    if (entries.length > MAX_GENERIC_PARAM_ENTRIES) {
      throw new ServiceError(`${label} contains too many fields.`, { code: 'INVALID_INPUT' });
    }
    seen.add(value);
    const result = Object.create(null);
    for (const [key, entry] of entries) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new ServiceError(`${label} contains a forbidden field.`, { code: 'INVALID_INPUT' });
      }
      result[key] = validateCliParamValue(entry, `${label}.${key}`, seen, depth + 1);
    }
    seen.delete(value);
    return result;
  }
  throw new ServiceError(`${label} must contain only JSON values.`, { code: 'INVALID_INPUT' });
}

function serializeCliParamValue(value, label) {
  const validated = validateCliParamValue(value, label);
  if (Array.isArray(validated) || isPlainRecord(validated)) return JSON.stringify(validated);
  return String(validated);
}

function extractMediaUrl(value, seen = new WeakSet(), depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (isPlainRecord(value)) {
    for (const key of [
      'url', 'video_url', 'image_url', 'audio_url', 'model_url', 'glb_url',
      'file_url', 'asset_url', 'output_url', 'result_url',
    ]) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    for (const key of ['output', 'result', 'data', 'job']) {
      const found = extractMediaUrl(value[key], seen, depth + 1);
      if (found) return found;
    }
    for (const key of ['results', 'outputs', 'medias', 'jobs', 'items']) {
      const collection = value[key];
      if (!Array.isArray(collection)) continue;
      for (const entry of collection) {
        if (typeof entry === 'string' && /^https?:\/\//i.test(entry)) return entry;
        const found = extractMediaUrl(entry, seen, depth + 1);
        if (found) return found;
      }
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && /^https?:\/\//i.test(entry)) return entry;
      const found = extractMediaUrl(entry, seen, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function extractTextOutput(value, seen = new WeakSet(), depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (isPlainRecord(value)) {
    for (const key of ['text', 'output_text', 'result_text', 'summary', 'content']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    for (const key of ['output', 'result', 'data', 'job']) {
      const nested = value[key];
      if (typeof nested === 'string' && nested.trim() && !/^https?:\/\//i.test(nested.trim())) {
        return nested.trim();
      }
      const found = extractTextOutput(nested, seen, depth + 1);
      if (found) return found;
    }
    for (const key of ['results', 'outputs', 'jobs', 'items']) {
      const collection = value[key];
      if (!Array.isArray(collection)) continue;
      for (const entry of collection) {
        const found = extractTextOutput(entry, seen, depth + 1);
        if (found) return found;
      }
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractTextOutput(entry, seen, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function parseLastJson(stdout, label) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new ServiceError(`${label} returned no output.`, {
      code: 'PROVIDER_BAD_RESPONSE',
      statusCode: 502,
    });
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    for (const line of trimmed.split(/\r?\n/).reverse()) {
      const candidate = line.trim();
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep scanning for the last complete JSON event.
      }
    }
  }
  throw new ServiceError(`${label} output was not valid JSON.`, {
    code: 'PROVIDER_BAD_RESPONSE',
    statusCode: 502,
  });
}

export function parseHiggsfieldGenerateJson(stdout, params) {
  const parsed = parseLastJson(stdout, 'Higgsfield CLI');
  const envelope = Array.isArray(parsed) ? { results: parsed } : parsed;
  if (!isPlainRecord(envelope)) {
    throw new ServiceError('Higgsfield CLI output was not a JSON object or array.', {
      code: 'PROVIDER_BAD_RESPONSE',
      statusCode: 502,
    });
  }
  const firstResult = Array.isArray(envelope.results) && isPlainRecord(envelope.results[0])
    ? envelope.results[0]
    : envelope;
  const state = String(firstResult.state ?? firstResult.status ?? '').toLowerCase();
  if (['failed', 'error', 'fail'].includes(state)) {
    const detail = typeof firstResult.error === 'string' && firstResult.error.trim()
      ? firstResult.error.trim().slice(0, 2_000)
      : 'Higgsfield generation failed.';
    throw new ServiceError(detail, { code: 'HIGGSFIELD_GENERATION_FAILED', statusCode: 502 });
  }
  const mediaType = validateOutputType(params.mediaType);
  const rawUrl = extractMediaUrl(envelope);
  const text = mediaType === 'text' ? extractTextOutput(envelope) : undefined;
  if (!rawUrl && !text) {
    throw new ServiceError(
      mediaType === 'text'
        ? 'Higgsfield generation finished without text or a result URL.'
        : 'Higgsfield generation finished without a media URL.',
      { code: 'PROVIDER_BAD_RESPONSE', statusCode: 502 },
    );
  }
  const url = rawUrl ? validatePublicUrl(rawUrl, 'Higgsfield result URL').href : undefined;
  const durationValue = firstResult.duration
    ?? (isPlainRecord(firstResult.output) ? firstResult.output.duration : undefined);
  const duration = Number(durationValue);
  const jobIdValue = firstResult.job_id ?? firstResult.id ?? firstResult.jobId;
  return {
    ...(url ? { url } : {}),
    ...(text ? { text } : {}),
    mediaType,
    ...(Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {}),
    ...(typeof jobIdValue === 'string' && SAFE_JOB_ID.test(jobIdValue) ? { jobId: jobIdValue } : {}),
    model: validateModel(params.model),
  };
}

export function parseHiggsfieldConnectionState(account) {
  if (!isPlainRecord(account)) return { connected: false };
  const data = isPlainRecord(account.data) ? account.data : account;
  const planValue = data.subscription_plan_type ?? data.plan;
  const creditsValue = data.credits ?? data.balance;
  const credits = Number(creditsValue);
  return {
    connected: true,
    ...(typeof data.email === 'string' && data.email.trim()
      ? { email: data.email.trim().slice(0, 320) }
      : {}),
    ...(typeof planValue === 'string' && planValue.trim()
      ? { plan: planValue.trim().slice(0, 256) }
      : {}),
    ...(Number.isFinite(credits) ? { credits } : {}),
  };
}

function buildEnvironment(options) {
  const base = isPlainRecord(options.env) ? options.env : process.env;
  const extra = [
    path.join(os.homedir(), '.npm-global/bin'),
    path.join(os.homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const currentPath = typeof base.PATH === 'string' ? base.PATH : process.env.PATH ?? '';
  return {
    ...base,
    PATH: [...extra, currentPath].filter(Boolean).join(path.delimiter),
    NO_COLOR: '1',
    TERM: 'dumb',
  };
}

function defaultCandidates() {
  return [
    path.join(os.homedir(), '.npm-global/bin/higgsfield'),
    path.join(os.homedir(), '.local/bin/hf'),
    '/opt/homebrew/bin/higgsfield',
    '/usr/local/bin/higgsfield',
    'higgsfield',
  ];
}

function createDefaultProcessRunner() {
  return (spec, io) => new Promise((resolve, reject) => {
    if (spec.signal.aborted) {
      reject(spec.signal.reason ?? new Error('Higgsfield operation aborted.'));
      return;
    }
    let child;
    let settled = false;
    let killTimer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      spec.signal.removeEventListener('abort', terminate);
      if (killTimer) clearTimeout(killTimer);
      callback();
    };
    const terminate = () => {
      if (!child || settled) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2_000);
      killTimer.unref?.();
    };
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    spec.signal.addEventListener('abort', terminate, { once: true });
    child.stdout?.on('data', (chunk) => {
      if (settled) return;
      try {
        io.onStdout(chunk);
      } catch (error) {
        terminate();
        finish(() => reject(error));
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (settled) return;
      try {
        io.onStderr(chunk);
      } catch (error) {
        terminate();
        finish(() => reject(error));
      }
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code, signal) => finish(() => resolve({ code, signal })));
  });
}

function makeTimeoutError(label) {
  return new ServiceError(`${label} timed out.`, {
    code: 'HIGGSFIELD_TIMEOUT',
    statusCode: 504,
  });
}

async function raceWithAbort(promise, operation) {
  const guarded = Promise.resolve(promise);
  guarded.catch(() => {});
  const aborted = new Promise((_, reject) => {
    if (operation.controller.signal.aborted) {
      reject(operation.failure ?? makeTimeoutError(operation.label));
      return;
    }
    operation.controller.signal.addEventListener('abort', () => {
      reject(operation.failure ?? makeTimeoutError(operation.label));
    }, { once: true });
  });
  return Promise.race([guarded, aborted]);
}

function safeCliMessage(value, fallback) {
  const message = String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  return message ? message.slice(0, 2_000) : fallback;
}

function cliFailure(message, fallback = 'Higgsfield CLI failed.') {
  const detail = safeCliMessage(message, fallback);
  if (/session expired|not connected|not logged in|unauthori[sz]ed|authentication required/i.test(detail)) {
    return new ServiceError(
      'Higgsfield is not authenticated on the web server. Connect the server-hosted CLI before generating.',
      { code: 'HIGGSFIELD_AUTH_REQUIRED', statusCode: 422 },
    );
  }
  return new ServiceError(detail, { code: 'HIGGSFIELD_CLI_FAILED', statusCode: 502 });
}

function normalizePreparedMedia(value) {
  if (!isPlainRecord(value) || !Array.isArray(value.paths) || !Array.isArray(value.roles)) {
    throw new ServiceError('The Higgsfield media preparer returned an invalid result.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  const medias = value.paths.map((mediaPath, index) => {
    const mediaValue = requireString(mediaPath, `Prepared media ${index + 1}`, { maxLength: 4_096 });
    const role = value.roles[index] ?? 'image';
    if (!MEDIA_ROLES.has(role)) {
      throw new ServiceError('The Higgsfield media preparer returned an invalid role.', {
        code: 'SERVER_MISCONFIGURED',
        statusCode: 500,
      });
    }
    return { value: mediaValue, role };
  });
  return { medias, cleanup: typeof value.cleanup === 'function' ? value.cleanup : async () => {} };
}

function createDefaultMediaPreparer(options, settingsEnv) {
  const ffmpegPath = validateCommand(
    options.ffmpegPath ?? settingsEnv.CINEGEN_FFMPEG_PATH ?? 'ffmpeg',
    'ffmpeg executable',
  );
  const timeoutMs = options.ffmpegTimeoutMs ?? 2 * 60_000;
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  const runFfmpeg = async (args) => {
    await execFileImpl(ffmpegPath, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
  };
  return async (sourcePath, prepareOptions) => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-higgsfield-web-'));
    const cleanup = async () => fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    const start = Math.max(0, prepareOptions.sourceStartSec ?? 0);
    const end = Math.max(start, prepareOptions.sourceEndSec ?? start);
    try {
      if (prepareOptions.referenceMode === 'first-last') {
        const firstPath = path.join(tempDirectory, 'first.jpg');
        const lastPath = path.join(tempDirectory, 'last.jpg');
        await runFfmpeg(['-y', '-ss', String(start), '-i', sourcePath, '-frames:v', '1', '-q:v', '2', firstPath]);
        await runFfmpeg(['-y', '-ss', String(Math.max(start, end - 0.05)), '-i', sourcePath, '-frames:v', '1', '-q:v', '2', lastPath]);
        return { paths: [firstPath, lastPath], roles: ['start_image', 'end_image'], cleanup };
      }
      if (prepareOptions.referenceMode === 'segment') {
        const outputPath = path.join(tempDirectory, 'segment.mp4');
        const duration = Math.max(0.1, Math.min(end > start ? end - start : 30, 90));
        await runFfmpeg([
          '-y', '-ss', String(start), '-i', sourcePath, '-t', String(duration),
          '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-c:a', 'aac',
          '-b:a', '128k', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', outputPath,
        ]);
        return { paths: [outputPath], roles: ['image'], cleanup };
      }
      const outputPath = path.join(tempDirectory, 'frame.jpg');
      const frameTime = prepareOptions.frameTimeSec ?? (end > start ? (start + end) / 2 : start);
      await runFfmpeg(['-y', '-ss', String(Math.max(0, frameTime)), '-i', sourcePath, '-frames:v', '1', '-q:v', '2', outputPath]);
      return { paths: [outputPath], roles: ['image'], cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  };
}

export function createHiggsfieldService(options = {}) {
  const settingsEnv = isPlainRecord(options.env) ? options.env : process.env;
  const configuredExecutable = options.executable
    ?? settingsEnv.CINEGEN_HIGGSFIELD_BIN
    ?? settingsEnv.CINEGEN_HIGGSFIELD_PATH;
  let candidates;
  if (configuredExecutable) {
    candidates = [validateCommand(configuredExecutable, 'Higgsfield executable')];
  } else if (options.candidates !== undefined) {
    if (!Array.isArray(options.candidates) || options.candidates.length > 20) {
      throw new ServiceError('Higgsfield executable candidates must be an array with at most 20 entries.', {
        code: 'SERVER_MISCONFIGURED',
        statusCode: 500,
      });
    }
    candidates = options.candidates.map((candidate) => validateCommand(candidate, 'Higgsfield executable'));
  } else {
    candidates = defaultCandidates();
  }
  const cliEnvironment = buildEnvironment(options);
  const cliCwd = path.resolve(options.cwd ?? settingsEnv.CINEGEN_HIGGSFIELD_CWD ?? os.tmpdir());
  const allowAuthCommands = options.allowAuthCommands !== undefined
    ? options.allowAuthCommands === true
    : parseBooleanSetting(settingsEnv.CINEGEN_HIGGSFIELD_ALLOW_AUTH_COMMANDS);
  const generateTimeoutMs = parsePositiveSetting(
    options.generateTimeoutMs ?? settingsEnv.CINEGEN_HIGGSFIELD_GENERATE_TIMEOUT_MS,
    8 * 60_000,
    'Higgsfield generation timeout',
  );
  const commandTimeoutMs = parsePositiveSetting(
    options.commandTimeoutMs ?? settingsEnv.CINEGEN_HIGGSFIELD_COMMAND_TIMEOUT_MS,
    15_000,
    'Higgsfield command timeout',
  );
  const loginTimeoutMs = parsePositiveSetting(options.loginTimeoutMs, 5 * 60_000, 'Higgsfield login timeout');
  const detectionTimeoutMs = parsePositiveSetting(options.detectionTimeoutMs, 8_000, 'Higgsfield detection timeout');
  const maxOutputBytes = parsePositiveSetting(options.maxOutputBytes, 4 * 1024 * 1024, 'Higgsfield output limit');
  const maxStderrBytes = parsePositiveSetting(options.maxStderrBytes, 512 * 1024, 'Higgsfield stderr limit');
  const maxArgumentBytes = parsePositiveSetting(options.maxArgumentBytes, 240 * 1024, 'Higgsfield argument limit');
  const maxConcurrent = parsePositiveSetting(options.maxConcurrent, 4, 'Higgsfield concurrency limit');
  const processRunner = options.processRunner ?? createDefaultProcessRunner();
  const detector = options.detector;
  const mediaPreparer = options.mediaPreparer ?? createDefaultMediaPreparer(options, settingsEnv);
  const activeOperations = new Map();

  const detectExecutable = async () => {
    try {
      if (typeof detector === 'function') {
        const detected = await detector({
          candidates: [...candidates],
          env: { ...cliEnvironment },
          timeoutMs: detectionTimeoutMs,
        });
        if (detected === false || detected === null || detected === undefined) return null;
        if (typeof detected === 'string') return validateCommand(detected, 'Higgsfield executable');
        if (isPlainRecord(detected) && detected.installed === true) {
          return validateCommand(detected.path, 'Higgsfield executable');
        }
        return null;
      }
      for (const candidate of candidates) {
        try {
          const { stdout } = await execFileAsync(candidate, ['version'], {
            env: cliEnvironment,
            cwd: cliCwd,
            timeout: detectionTimeoutMs,
            maxBuffer: 64 * 1024,
            windowsHide: true,
          });
          if (stdout.trim()) return candidate;
        } catch {
          // Try the next server-configured executable.
        }
      }
    } catch {
      // Status detection degrades to unavailable.
    }
    return null;
  };

  const requireExecutable = async () => {
    const executable = await detectExecutable();
    if (!executable) throw new CapabilityUnavailableError('Server-hosted Higgsfield CLI generation');
    return executable;
  };

  const runCli = async (argsValue, { label, timeoutMs }) => {
    if (activeOperations.size >= maxConcurrent) {
      throw new ServiceError('The Higgsfield server runtime is busy. Try again shortly.', {
        code: 'HIGGSFIELD_BUSY',
        statusCode: 429,
      });
    }
    const executable = await requireExecutable();
    const args = [...argsValue];
    if (!args.includes('--json')) args.push('--json');
    const argumentBytes = args.reduce((total, argument) => total + Buffer.byteLength(argument, 'utf8'), 0);
    if (argumentBytes > maxArgumentBytes) {
      throw new ServiceError('Higgsfield request is too large for the server process transport.', {
        code: 'INVALID_INPUT',
        statusCode: 413,
      });
    }
    const operation = {
      id: crypto.randomUUID(),
      label,
      controller: new AbortController(),
      failure: undefined,
    };
    activeOperations.set(operation.id, operation);
    const timeout = setTimeout(() => {
      operation.failure = makeTimeoutError(label);
      operation.controller.abort();
    }, timeoutMs);
    let stdout = '';
    let stderr = '';
    try {
      const runnerPromise = processRunner({
        operationId: operation.id,
        command: executable,
        args,
        cwd: cliCwd,
        env: { ...cliEnvironment },
        shell: false,
        signal: operation.controller.signal,
      }, {
        onStdout(chunk) {
          if (operation.controller.signal.aborted) return;
          stdout += chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString('utf8')
            : String(chunk);
          if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
            operation.failure = new ServiceError('Higgsfield CLI output exceeded the configured limit.', {
              code: 'OUTPUT_LIMIT',
              statusCode: 502,
            });
            operation.controller.abort();
            throw operation.failure;
          }
        },
        onStderr(chunk) {
          if (operation.controller.signal.aborted) return;
          stderr += chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString('utf8')
            : String(chunk);
          if (Buffer.byteLength(stderr, 'utf8') > maxStderrBytes) {
            operation.failure = new ServiceError('Higgsfield CLI diagnostics exceeded the configured limit.', {
              code: 'OUTPUT_LIMIT',
              statusCode: 502,
            });
            operation.controller.abort();
            throw operation.failure;
          }
        },
      });
      const exit = await raceWithAbort(runnerPromise, operation);
      if (operation.controller.signal.aborted) throw operation.failure ?? makeTimeoutError(label);
      if (exit?.code !== 0) {
        throw cliFailure(stderr || stdout, `${label} exited with code ${exit?.code ?? 'unknown'}.`);
      }
      return stdout;
    } catch (error) {
      if (operation.controller.signal.aborted) throw operation.failure ?? makeTimeoutError(label);
      if (error instanceof ServiceError) throw error;
      throw cliFailure(error instanceof Error ? error.message : error, `${label} could not be started.`);
    } finally {
      clearTimeout(timeout);
      activeOperations.delete(operation.id);
    }
  };

  const resolveMediaReference = async (value, label, { allowOpaque = false } = {}) => {
    const reference = requireString(value, label, { maxLength: 4_096 });
    if (isWebMediaReference(reference)) {
      const resolved = await resolveWebMediaPath(reference, { dataRoot: options.dataRoot, label });
      return { value: resolved.diskPath, localPath: resolved.diskPath };
    }
    if (/^https?:\/\//i.test(reference)) {
      return { value: validatePublicUrl(reference, label).href, localPath: null };
    }
    if (allowOpaque && OPAQUE_REFERENCE_PATTERN.test(reference)) {
      return { value: reference, localPath: null };
    }
    throw new ServiceError(
      `${label} must be a browser-uploaded /media reference${allowOpaque ? ', a provider reference id,' : ''} or a public HTTPS URL.`,
      { code: 'LOCAL_MEDIA_UNAVAILABLE', statusCode: 422 },
    );
  };

  const resolveGenericReferences = async (
    value,
    label,
    referenceContext = false,
    seen = new WeakSet(),
    depth = 0,
  ) => {
    if (depth > MAX_GENERIC_PARAM_DEPTH) {
      throw new ServiceError(`${label} is too deeply nested.`, { code: 'INVALID_INPUT' });
    }
    if (typeof value === 'string') {
      if (isWebMediaReference(value)) {
        const resolved = await resolveMediaReference(value, label);
        return resolved.value;
      }
      if (value.startsWith('local-media://file')) {
        throw new ServiceError(`${label} is not a valid web media reference.`, {
          code: 'LOCAL_MEDIA_UNAVAILABLE',
          statusCode: 422,
        });
      }
      if (referenceContext && /^https?:\/\//i.test(value)) {
        return validatePublicUrl(value, label).href;
      }
      if (referenceContext && (
        /^(?:file|blob|data|javascript):/i.test(value)
        || path.isAbsolute(value)
        || path.win32.isAbsolute(value)
      )) {
        throw new ServiceError(`${label} must use a browser-uploaded /media reference or public HTTPS URL.`, {
          code: 'LOCAL_MEDIA_UNAVAILABLE',
          statusCode: 422,
        });
      }
      return validateCliParamValue(value, label);
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      return validateCliParamValue(value, label);
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new ServiceError(`${label} cannot contain cycles.`, { code: 'INVALID_INPUT' });
      if (value.length > MAX_GENERIC_PARAM_ENTRIES) {
        throw new ServiceError(`${label} contains too many entries.`, { code: 'INVALID_INPUT' });
      }
      seen.add(value);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        result.push(await resolveGenericReferences(
          value[index],
          `${label}[${index}]`,
          referenceContext,
          seen,
          depth + 1,
        ));
      }
      seen.delete(value);
      return result;
    }
    if (isPlainRecord(value)) {
      if (seen.has(value)) throw new ServiceError(`${label} cannot contain cycles.`, { code: 'INVALID_INPUT' });
      const entries = Object.entries(value);
      if (entries.length > MAX_GENERIC_PARAM_ENTRIES) {
        throw new ServiceError(`${label} contains too many fields.`, { code: 'INVALID_INPUT' });
      }
      seen.add(value);
      const result = Object.create(null);
      for (const [key, entry] of entries) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          throw new ServiceError(`${label} contains a forbidden field.`, { code: 'INVALID_INPUT' });
        }
        const childReferenceContext = referenceContext
          || /(?:url|uri|path|image|video|audio|media|file|reference)/i.test(key);
        result[key] = await resolveGenericReferences(
          entry,
          `${label}.${key}`,
          childReferenceContext,
          seen,
          depth + 1,
        );
      }
      seen.delete(value);
      return result;
    }
    throw new ServiceError(`${label} must contain only JSON values.`, { code: 'INVALID_INPUT' });
  };

  const normalizeGenerationRequest = async (params) => {
    const rawInputs = Object.create(null);
    for (const source of [params.inputs, params.params, params.extra]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) rawInputs[key] = value;
    }

    const prompt = params.prompt ?? optionalPromptValue(rawInputs.prompt);
    delete rawInputs.prompt;
    delete rawInputs.outputType;
    delete rawInputs.output_type;
    delete rawInputs.mediaType;
    delete rawInputs.media_type;

    const medias = [];
    const addMedia = async (value, roleValue, label) => {
      const role = roleValue === 'contextual_image'
        ? (params.outputType === 'video' ? 'start_image' : 'image')
        : roleValue;
      if (!MEDIA_ROLES.has(role)) {
        throw new ServiceError(`${label} has an invalid Higgsfield media role.`, { code: 'INVALID_INPUT' });
      }
      const values = Array.isArray(value) ? value : [value];
      for (const [index, entryValue] of values.entries()) {
        const entry = isPlainRecord(entryValue) && 'value' in entryValue
          ? entryValue.value
          : entryValue;
        if (typeof entry !== 'string' || !entry.trim()) {
          throw new ServiceError(`${label}[${index}] must be a media reference string.`, {
            code: 'INVALID_INPUT',
          });
        }
        const resolved = await resolveMediaReference(entry, `${label}[${index}]`, { allowOpaque: true });
        medias.push({ value: resolved.value, role });
        if (medias.length > 64) {
          throw new ServiceError('Higgsfield media references must contain at most 64 entries.', {
            code: 'INVALID_INPUT',
          });
        }
      }
    };

    if (params.referenceValue) {
      await addMedia(params.referenceValue, 'contextual_image', 'Higgsfield reference');
    }
    if (params.medias !== undefined) {
      if (!Array.isArray(params.medias) || params.medias.length > 64) {
        throw new ServiceError('Higgsfield media references must contain at most 64 entries.', {
          code: 'INVALID_INPUT',
        });
      }
      for (const [index, mediaValue] of params.medias.entries()) {
        const media = requireRecord(mediaValue, `Higgsfield media ${index + 1}`);
        await addMedia(media.value, media.role, `Higgsfield media ${index + 1}`);
      }
    }

    if (rawInputs.higgsfield_media_inputs !== undefined) {
      if (!Array.isArray(rawInputs.higgsfield_media_inputs) || rawInputs.higgsfield_media_inputs.length > 64) {
        throw new ServiceError('Higgsfield structured media inputs must be an array with at most 64 entries.', {
          code: 'INVALID_INPUT',
        });
      }
      for (const [index, mediaValue] of rawInputs.higgsfield_media_inputs.entries()) {
        const media = requireRecord(mediaValue, `Higgsfield structured media ${index + 1}`);
        await addMedia(
          media.value,
          media.role,
          `Higgsfield inputs.higgsfield_media_inputs[${index}]`,
        );
      }
      delete rawInputs.higgsfield_media_inputs;
    }

    if (Array.isArray(rawInputs.medias) && rawInputs.medias.every((entry) => (
      typeof entry === 'string'
      || (isPlainRecord(entry) && typeof entry.value === 'string' && MEDIA_ROLES.has(entry.role))
    ))) {
      for (const [index, mediaValue] of rawInputs.medias.entries()) {
        const media = isPlainRecord(mediaValue)
          ? mediaValue
          : { value: mediaValue, role: inferRawMediaRole(mediaValue, params.outputType) };
        await addMedia(media.value, media.role, `Higgsfield inputs.medias[${index}]`);
      }
      delete rawInputs.medias;
    }

    const cliParams = Object.create(null);
    for (const [key, value] of Object.entries(rawInputs)) {
      if (value === undefined || value === null) continue;
      const mappedRole = MEDIA_INPUT_KEYS[key];
      const canBecomeMedia = typeof value === 'string'
        || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
      if (mappedRole && canBecomeMedia) {
        await addMedia(value, mappedRole, `Higgsfield input ${key}`);
        continue;
      }
      const referenceContext = /(?:url|uri|path|image|video|audio|media|file|reference)/i.test(key);
      cliParams[key] = await resolveGenericReferences(
        value,
        `Higgsfield input ${key}`,
        referenceContext,
      );
    }

    return {
      model: params.model,
      prompt,
      mediaType: params.outputType,
      ...(medias.length > 0 ? { medias } : {}),
      ...(params.aspectRatio !== undefined && cliParams.aspect_ratio === undefined
        ? { aspectRatio: params.aspectRatio }
        : {}),
      ...(params.durationSec !== undefined && cliParams.duration === undefined
        ? { durationSec: params.durationSec }
        : {}),
      ...(params.count !== undefined && cliParams.count === undefined
        ? { count: params.count }
        : {}),
      ...(Object.keys(cliParams).length > 0 ? { params: cliParams } : {}),
    };
  };

  const generate = async (paramsValue) => {
    const params = validateGenerateParams(paramsValue);
    const generateParams = await normalizeGenerationRequest(params);
    const stdout = await runCli(buildHiggsfieldCreateArgs(generateParams), {
      label: 'Higgsfield generation',
      timeoutMs: generateTimeoutMs,
    });
    return parseHiggsfieldGenerateJson(stdout, generateParams);
  };

  const quickEdit = async (paramsValue) => {
    const params = validateQuickEditParams(paramsValue);
    let medias = [];
    let cleanup = async () => {};
    try {
      if (params.drawnFramePath) {
        const drawn = await resolveMediaReference(params.drawnFramePath, 'Clean drawn frame');
        medias.push({
          value: drawn.value,
          role: params.outputType === 'video' ? 'start_image' : 'image',
        });
        if (params.guideFramePath) {
          const guide = await resolveMediaReference(params.guideFramePath, 'Annotated guide frame');
          medias.push({ value: guide.value, role: 'image' });
        }
      } else {
        const source = await resolveMediaReference(params.fileRef, 'Quick Edit source media');
        if (source.localPath) {
          try {
            const prepared = normalizePreparedMedia(await mediaPreparer(source.localPath, {
              referenceMode: params.referenceMode,
              frameTimeSec: params.frameTimeSec,
              sourceStartSec: params.sourceStartSec,
              sourceEndSec: params.sourceEndSec,
            }));
            medias = prepared.medias;
            cleanup = prepared.cleanup;
          } catch {
            medias = [{
              value: source.localPath,
              role: params.outputType === 'video' ? 'start_image' : 'image',
            }];
          }
        } else {
          medias = [{
            value: source.value,
            role: params.outputType === 'video' ? 'start_image' : 'image',
          }];
        }
      }
      const generateParams = {
        model: params.model,
        prompt: params.prompt,
        mediaType: params.outputType,
        medias,
        aspectRatio: params.aspectRatio,
      };
      const stdout = await runCli(buildHiggsfieldCreateArgs(generateParams), {
        label: 'Higgsfield Quick Edit',
        timeoutMs: generateTimeoutMs,
      });
      return parseHiggsfieldGenerateJson(stdout, generateParams);
    } finally {
      await cleanup();
    }
  };

  const accountStatus = async () => {
    const executable = await detectExecutable();
    if (!executable) {
      return {
        connected: false,
        error: 'The Higgsfield CLI is not configured on the web server.',
      };
    }
    try {
      const stdout = await runCli(['account', 'status'], {
        label: 'Higgsfield account status',
        timeoutMs: commandTimeoutMs,
      });
      return parseHiggsfieldConnectionState(parseLastJson(stdout, 'Higgsfield account status'));
    } catch (error) {
      return {
        connected: false,
        error: error?.code === 'HIGGSFIELD_AUTH_REQUIRED'
          ? error.message
          : 'Higgsfield is not authenticated on the web server.',
      };
    }
  };

  const authLogin = async () => {
    const executable = await detectExecutable();
    if (!executable) {
      return { connected: false, error: 'The Higgsfield CLI is not configured on the web server.' };
    }
    if (!allowAuthCommands) {
      return {
        connected: false,
        error: 'Server-side Higgsfield device login is disabled. Set CINEGEN_HIGGSFIELD_ALLOW_AUTH_COMMANDS=1 on a trusted local server to enable it.',
      };
    }
    try {
      await runCli(['auth', 'login'], { label: 'Higgsfield device login', timeoutMs: loginTimeoutMs });
      return accountStatus();
    } catch (error) {
      return {
        connected: false,
        error: safeCliMessage(error instanceof Error ? error.message : error, 'Higgsfield login failed.'),
      };
    }
  };

  const authLogout = async () => {
    if (!allowAuthCommands || !(await detectExecutable())) return undefined;
    await runCli(['auth', 'logout'], {
      label: 'Higgsfield logout',
      timeoutMs: commandTimeoutMs,
    }).catch(() => {});
    return undefined;
  };

  const handlers = { accountStatus, authLogin, authLogout, quickEdit, generate };
  const context = {
    capabilities: higgsfieldCapabilities,
    authCommandsEnabled: allowAuthCommands,
    activeOperationCount: () => activeOperations.size,
    cancelAll: () => {
      for (const operation of activeOperations.values()) {
        operation.failure = new ServiceError('Higgsfield operation was cancelled during server shutdown.', {
          code: 'REQUEST_CANCELLED',
          statusCode: 499,
        });
        operation.controller.abort();
      }
    },
  };
  return { handlers, context };
}

export function createHiggsfieldHandlers(options = {}) {
  return createHiggsfieldService(options).handlers;
}

export const higgsfieldHandlers = createHiggsfieldHandlers();
