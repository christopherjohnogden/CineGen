import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStaticPath from 'ffmpeg-static';

import {
  ServiceError,
  createFalSubscriber,
  isPlainRecord,
  requireRecord,
  requireSecret,
  requireString,
  validatePublicUrl,
} from './_shared.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ENGINES = new Set(['faster-whisper-local', 'whisperx-local', 'whisper-cloud']);
const MODELS = new Set(['tiny', 'base', 'small', 'medium', 'large']);
const FAL_MODEL = 'fal-ai/whisper';
const FAL_VERSION = '3';
const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ERROR_LENGTH = 2_000;

function transcriptionError(message, code = 'INVALID_TRANSCRIPTION_REQUEST', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function requireId(value, label) {
  return requireString(value, label, { maxLength: 128, pattern: SAFE_ID });
}

function isPathInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function pathInside(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (!isPathInside(root, candidate)) {
    throw transcriptionError('Transcription path escapes the configured data directory.', 'INVALID_MEDIA_PATH');
  }
  return candidate;
}

function timestamp() {
  return new Date().toISOString();
}

function roundTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.round(Math.max(0, number) * 1_000) / 1_000;
}

function normalizeSpeaker(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : null;
}

function appendTranscriptToken(text, token) {
  const normalized = String(token || '').trim();
  if (!normalized) return text;
  if (!text) return normalized;
  if (/^[,.;:!?%)\]}]/.test(normalized) || /^['’]/.test(normalized)) return `${text}${normalized}`;
  return `${text} ${normalized}`;
}

function normalizeWord(value) {
  if (!isPlainRecord(value)) return null;
  const word = typeof value.word === 'string'
    ? value.word.trim()
    : typeof value.text === 'string'
      ? value.text.trim()
      : '';
  const start = roundTime(value.start);
  const end = roundTime(value.end);
  if (!word || start === undefined || end === undefined) return null;
  const probability = Number(value.prob ?? value.probability);
  const speaker = normalizeSpeaker(value.speaker);
  return {
    word: word.slice(0, 10_000),
    start,
    end: Math.max(start, end),
    ...(Number.isFinite(probability) ? { prob: probability } : {}),
    ...(speaker ? { speaker } : {}),
  };
}

function buildSegmentsFromWords(words) {
  const segments = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.text = current.text.trim();
    if (current.text || current.words.length > 0) segments.push(current);
    current = null;
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!current) {
      current = {
        text: '',
        start: word.start,
        end: word.end,
        words: [],
        ...(word.speaker ? { speaker: word.speaker } : {}),
      };
    }
    current.words.push(word);
    current.end = Math.max(current.end, word.end);
    current.text = appendTranscriptToken(current.text, word.word);
    if (!current.speaker && word.speaker) current.speaker = word.speaker;

    const next = words[index + 1];
    const gap = next ? Math.max(0, next.start - word.end) : 0;
    const speakerChanged = Boolean(next) && (next.speaker ?? null) !== (current.speaker ?? null);
    const duration = current.end - current.start;
    if (!next || /[.!?]["')\]]*$/.test(word.word) || gap >= 0.85 || duration >= 12 || speakerChanged) flush();
  }
  flush();
  return segments;
}

function normalizeSegment(value) {
  if (!isPlainRecord(value)) return null;
  const text = typeof value.text === 'string'
    ? value.text.trim().slice(0, 250_000)
    : typeof value.output_text === 'string'
      ? value.output_text.trim().slice(0, 250_000)
      : '';
  const timestampValue = Array.isArray(value.timestamp) ? value.timestamp : null;
  const start = roundTime(value.start ?? timestampValue?.[0]);
  const end = roundTime(value.end ?? timestampValue?.[1]);
  const words = Array.isArray(value.words) ? value.words.map(normalizeWord).filter(Boolean) : [];
  if (!text && words.length === 0) return null;
  const normalizedStart = start ?? words[0]?.start ?? 0;
  const normalizedEnd = Math.max(normalizedStart, end ?? words.at(-1)?.end ?? normalizedStart);
  const speaker = normalizeSpeaker(value.speaker);
  return {
    text: text || words.reduce((current, word) => appendTranscriptToken(current, word.word), ''),
    start: normalizedStart,
    end: normalizedEnd,
    ...(speaker ? { speaker } : {}),
    ...(words.length > 0 ? { words } : {}),
  };
}

function normalizeLanguage(data) {
  for (const candidate of [data.language, data.languages, data.inferred_languages]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 128);
    if (Array.isArray(candidate)) {
      const found = candidate.find((entry) => typeof entry === 'string' && entry.trim());
      if (found) return found.trim().slice(0, 128);
    }
  }
  return '';
}

export function normalizeTranscriptionResult(value) {
  let data = value;
  for (let depth = 0; depth < 3 && isPlainRecord(data); depth += 1) {
    if (isPlainRecord(data.data)) {
      data = data.data;
      continue;
    }
    if (isPlainRecord(data.result)) {
      data = data.result;
      continue;
    }
    break;
  }
  if (!isPlainRecord(data)) {
    throw transcriptionError('The transcription provider returned an invalid response.', 'PROVIDER_BAD_RESPONSE', 502);
  }

  const directSegments = Array.isArray(data.segments)
    ? data.segments.map(normalizeSegment).filter(Boolean)
    : [];
  const rawChunks = Array.isArray(data.chunks) ? data.chunks : [];
  const chunks = rawChunks.map(normalizeSegment).filter(Boolean);
  const chunkWords = rawChunks.map((chunk) => {
    if (!isPlainRecord(chunk)) return null;
    const timestampValue = Array.isArray(chunk.timestamp) ? chunk.timestamp : null;
    return normalizeWord({
      word: chunk.text,
      start: chunk.start ?? timestampValue?.[0],
      end: chunk.end ?? timestampValue?.[1],
      speaker: chunk.speaker,
    });
  }).filter(Boolean);
  const topLevelWords = Array.isArray(data.words)
    ? data.words.map(normalizeWord).filter(Boolean)
    : [];

  let segments = directSegments.length > 0 ? directSegments : chunks;
  const segmentWords = segments.flatMap((segment) => segment.words ?? []);
  const words = topLevelWords.length > 0
    ? topLevelWords
    : chunkWords.length > 0
      ? chunkWords
      : segmentWords;
  if (words.length > 0) segments = buildSegmentsFromWords(words);

  const explicitText = typeof data.text === 'string'
    ? data.text.trim()
    : typeof data.output_text === 'string'
      ? data.output_text.trim()
      : typeof data.transcript === 'string'
        ? data.transcript.trim()
        : '';
  const fullText = explicitText || segments.map((segment) => segment.text).filter(Boolean).join(' ').trim();
  if (!fullText && segments.length === 0) {
    throw transcriptionError('The transcription provider returned no transcript.', 'PROVIDER_BAD_RESPONSE', 502);
  }
  return { fullText, segments, language: normalizeLanguage(data) };
}

function validateConfiguredEndpoint(value, label, allowHttp) {
  const raw = requireString(value, label, { maxLength: 4_096 });
  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch (cause) {
    throw transcriptionError(`${label} must be a valid URL.`, 'INVALID_URL', 500, cause);
  }
  if (endpoint.username || endpoint.password || (endpoint.protocol !== 'https:' && !(allowHttp && endpoint.protocol === 'http:'))) {
    throw transcriptionError(`${label} must use ${allowHttp ? 'HTTP or HTTPS' : 'HTTPS'} without embedded credentials.`, 'INVALID_URL', 500);
  }
  return endpoint.href;
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4': return 'video/mp4';
    case '.m4v': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.flac': return 'audio/flac';
    case '.ogg': return 'audio/ogg';
    default: return 'application/octet-stream';
  }
}

function publicJob(job) {
  return {
    status: job.status,
    fullText: job.fullText,
    segments: job.segments,
    language: job.language,
    engine: job.engine,
    ...(job.error ? { error: job.error } : {}),
  };
}

/**
 * Create web transcription RPC handlers.
 *
 * Required context fields are `dataRoot`, `store`, `events`, and
 * `pathForMediaReference`. Optional provider hooks are `falSubscribe`,
 * `stageMediaForCloud`, `hostedEndpoint`, and `workerUrl`. A configured worker
 * receives multipart fields plus the media file and may serve either cloud or
 * local engines. API keys stay in the request closure and are never persisted.
 */
export function createTranscriptionHandlers(context) {
  const options = requireRecord(context, 'Transcription service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'Transcription data root', { maxLength: 16_384 }));
  const mediaRoot = pathInside(dataRoot, 'media');
  const projectsMediaRoot = pathInside(mediaRoot, 'projects');
  const jobsRoot = pathInside(dataRoot, 'transcription', 'jobs');
  const tempRoot = pathInside(dataRoot, 'transcription', 'temp');
  const store = options.store;
  const events = options.events;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const falSubscribe = options.falSubscribe ?? createFalSubscriber(options);
  const ffmpegPath = options.ffmpegPath || ffmpegStaticPath;
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
    ? Math.max(1_000, Number(options.requestTimeoutMs))
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const maxSourceBytes = Number.isFinite(options.maxSourceBytes)
    ? Math.max(1, Number(options.maxSourceBytes))
    : DEFAULT_MAX_SOURCE_BYTES;
  const activeJobs = new Map();

  const emit = (job, data) => {
    if (!events || typeof events.emit !== 'function') return;
    events.emit('transcription:progress', {
      jobId: job.jobId,
      assetId: job.assetId,
      engine: job.engine,
      ...data,
    });
  };

  const jobPath = (jobIdValue) => pathInside(jobsRoot, `${requireId(jobIdValue, 'Transcription job id')}.json`);

  const writeJob = async (job) => {
    const filePath = jobPath(job.jobId);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    const persisted = {
      jobId: job.jobId,
      assetId: job.assetId,
      projectId: job.projectId,
      engine: job.engine,
      status: job.status,
      segments: job.segments,
      fullText: job.fullText,
      language: job.language,
      ...(job.model ? { model: job.model } : {}),
      ...(job.error ? { error: job.error } : {}),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
    try {
      await fsp.writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fsp.rename(temporary, filePath);
    } catch (cause) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw cause;
    }
  };

  const readJob = async (jobId) => {
    try {
      const parsed = JSON.parse(await fsp.readFile(jobPath(jobId), 'utf8'));
      return isPlainRecord(parsed) ? parsed : null;
    } catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      if (cause instanceof SyntaxError) {
        throw transcriptionError('Saved transcription job is corrupt.', 'CORRUPT_JOB', 500, cause);
      }
      throw cause;
    }
  };

  const ensureProjectAndAsset = async (projectIdValue, assetIdValue) => {
    const projectId = requireId(projectIdValue, 'Project id');
    const assetId = requireId(assetIdValue, 'Asset id');
    if (!store || typeof store.load !== 'function') {
      throw transcriptionError('Transcription project storage is unavailable.', 'SERVER_MISCONFIGURED', 500);
    }
    const state = await store.load(projectId);
    if (isPlainRecord(state?.project) && state.project.id && state.project.id !== projectId) {
      throw transcriptionError('Project ownership check failed.', 'PROJECT_MISMATCH', 403);
    }
    let asset;
    if (Array.isArray(state?.assets)) {
      asset = state.assets.find((entry) => isPlainRecord(entry) && entry.id === assetId);
      if (!asset) throw transcriptionError(`Asset not found in project: ${assetId}`, 'ASSET_NOT_FOUND', 404);
      if (asset.project_id && asset.project_id !== projectId) {
        throw transcriptionError('Asset belongs to a different project.', 'PROJECT_MISMATCH', 403);
      }
    }
    return { projectId, assetId, state, asset };
  };

  const resolveSource = async (referenceValue, projectId) => {
    const reference = requireString(referenceValue, 'Transcription media file', { maxLength: 16_384 });
    if (typeof options.pathForMediaReference !== 'function') {
      throw transcriptionError('Web media path resolution is unavailable.', 'SERVER_MISCONFIGURED', 500);
    }
    let resolved;
    try {
      resolved = await options.pathForMediaReference(reference);
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      throw transcriptionError('Transcription media reference is invalid.', 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof resolved !== 'string' || !isPathInside(mediaRoot, resolved)) {
      throw transcriptionError('Transcription media is outside the web media directory.', 'INVALID_MEDIA_PATH', 403);
    }
    const projectRoot = pathInside(projectsMediaRoot, projectId);
    if (!isPathInside(projectRoot, resolved)) {
      throw transcriptionError('Transcription media belongs to a different project.', 'PROJECT_MISMATCH', 403);
    }
    let stats;
    let realMediaRoot;
    let realProjectRoot;
    let realSource;
    try {
      [stats, realMediaRoot, realProjectRoot, realSource] = await Promise.all([
        fsp.stat(resolved),
        fsp.realpath(mediaRoot),
        fsp.realpath(projectRoot),
        fsp.realpath(resolved),
      ]);
    } catch (cause) {
      if (cause?.code === 'ENOENT') throw transcriptionError('Transcription media was not found.', 'MEDIA_NOT_FOUND', 404, cause);
      throw cause;
    }
    if (!stats.isFile() || !isPathInside(realMediaRoot, realSource) || !isPathInside(realProjectRoot, realSource)) {
      throw transcriptionError('Transcription media is not a readable project file.', 'INVALID_MEDIA_PATH', 403);
    }
    if (stats.size <= 0 || stats.size > maxSourceBytes) {
      throw transcriptionError('Transcription media is empty or exceeds the server size limit.', 'MEDIA_TOO_LARGE', 413);
    }
    return { filePath: realSource, stats };
  };

  const updateStatus = async (job, { stage, message } = {}) => {
    job.updatedAt = timestamp();
    await writeJob(job);
    emit(job, {
      type: 'status',
      status: job.status,
      ...(stage ? { stage } : {}),
      ...(message ? { message } : {}),
    });
  };

  const runProcess = (executable, args, timeoutMs) => new Promise((resolve, reject) => {
    if (!executable) {
      reject(transcriptionError('FFmpeg is unavailable on this web server.', 'MEDIA_PROCESSOR_UNAVAILABLE', 501));
      return;
    }
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    timer.unref?.();
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 256_000) stderr += chunk.toString().slice(0, 256_000 - stderr.length);
    });
    child.once('error', (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(cause);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal === 'SIGKILL') {
        reject(transcriptionError('Preparing media for transcription timed out.', 'MEDIA_PROCESS_TIMEOUT', 504));
      } else if (code !== 0) {
        reject(new Error(stderr.trim().split('\n').slice(-8).join('\n').slice(0, MAX_ERROR_LENGTH) || `ffmpeg exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });

  const extractCloudAudio = async (job, sourcePath) => {
    await fsp.mkdir(tempRoot, { recursive: true });
    const outputPath = pathInside(tempRoot, `${job.jobId}.m4a`);
    await runProcess(ffmpegPath, [
      '-y', '-i', sourcePath,
      '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000',
      '-c:a', 'aac', '-b:a', '96k', outputPath,
    ], requestTimeoutMs);
    return outputPath;
  };

  const fetchWithTimeout = async (url, init, label) => {
    if (typeof fetchImpl !== 'function') {
      throw transcriptionError('This server does not provide fetch.', 'SERVER_MISCONFIGURED', 500);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    timer.unref?.();
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (cause?.name === 'AbortError') throw transcriptionError(`${label} timed out.`, 'PROVIDER_TIMEOUT', 504, cause);
      throw transcriptionError(`${label} could not be reached.`, 'PROVIDER_UNAVAILABLE', 502, cause);
    } finally {
      clearTimeout(timer);
    }
  };

  const uploadToFal = async (job, sourcePath, apiKey) => {
    if (typeof options.stageMediaForCloud === 'function') {
      const staged = await options.stageMediaForCloud(sourcePath, {
        apiKey,
        jobId: job.jobId,
        assetId: job.assetId,
        projectId: job.projectId,
      });
      return validatePublicUrl(staged, 'Staged transcription media URL').href;
    }

    const extractedPath = await extractCloudAudio(job, sourcePath);
    try {
      const initiateResponse = await fetchWithTimeout(
        'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content_type: 'audio/mp4', file_name: `${job.assetId}.m4a` }),
        },
        'fal.ai storage',
      );
      const initiateText = await initiateResponse.text();
      let initiated;
      try {
        initiated = initiateText ? JSON.parse(initiateText) : null;
      } catch {
        initiated = null;
      }
      if (!initiateResponse.ok || !isPlainRecord(initiated)) {
        throw transcriptionError(`fal.ai storage rejected the upload (HTTP ${initiateResponse.status}).`, 'PROVIDER_ERROR', 502);
      }
      const uploadUrl = validatePublicUrl(initiated.upload_url, 'fal.ai upload URL').href;
      const fileUrl = validatePublicUrl(initiated.file_url, 'fal.ai file URL').href;
      const bytes = await fsp.readFile(extractedPath);
      const uploadResponse = await fetchWithTimeout(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/mp4' },
        body: bytes,
      }, 'fal.ai media upload');
      if (!uploadResponse.ok) {
        throw transcriptionError(`fal.ai media upload failed (HTTP ${uploadResponse.status}).`, 'PROVIDER_ERROR', 502);
      }
      return fileUrl;
    } finally {
      await fsp.rm(extractedPath, { force: true }).catch(() => {});
    }
  };

  const runFalTranscription = async (job, sourcePath, params) => {
    await updateStatus(job, {
      stage: 'uploading',
      message: 'Preparing audio for cloud transcription',
    });
    const mediaUrl = await uploadToFal(job, sourcePath, params.apiKey);
    await updateStatus(job, {
      stage: 'transcribing',
      message: 'Running cloud transcription',
    });
    const input = {
      audio_url: mediaUrl,
      task: 'transcribe',
      chunk_level: 'word',
      version: FAL_VERSION,
      ...(params.language !== 'auto' ? { language: params.language } : {}),
    };
    return await falSubscribe(FAL_MODEL, input, params.apiKey);
  };

  const readProviderResponse = async (response, label) => {
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (cause) {
      throw transcriptionError(`${label} returned invalid JSON.`, 'PROVIDER_BAD_RESPONSE', 502, cause);
    }
    if (!response.ok) {
      const message = isPlainRecord(payload) && typeof (payload.error ?? payload.message) === 'string'
        ? String(payload.error ?? payload.message).slice(0, MAX_ERROR_LENGTH)
        : `${label} failed (HTTP ${response.status}).`;
      throw transcriptionError(message, 'PROVIDER_ERROR', 502);
    }
    return payload;
  };

  const runHostedTranscription = async (job, sourcePath, params, endpoint) => {
    await updateStatus(job, {
      stage: 'uploading',
      message: 'Uploading media to the transcription worker',
    });
    const bytes = await fsp.readFile(sourcePath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentTypeFor(sourcePath) }), path.basename(sourcePath));
    form.append('jobId', job.jobId);
    form.append('projectId', job.projectId);
    form.append('assetId', job.assetId);
    form.append('engine', job.engine);
    form.append('model', params.model);
    form.append('language', params.language);
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
      },
      body: form,
    }, 'Transcription worker');
    await updateStatus(job, {
      stage: 'transcribing',
      message: 'Running hosted transcription',
    });
    return await readProviderResponse(response, 'Transcription worker');
  };

  const persistAssetTranscript = async (job) => {
    if (!store || typeof store.load !== 'function' || typeof store.updateAsset !== 'function') return;
    try {
      const state = await store.load(job.projectId);
      const asset = Array.isArray(state?.assets)
        ? state.assets.find((entry) => isPlainRecord(entry) && entry.id === job.assetId)
        : null;
      if (!asset) return;
      let metadata = {};
      if (isPlainRecord(asset.metadata)) metadata = asset.metadata;
      else if (typeof asset.metadata === 'string') {
        try {
          const parsed = JSON.parse(asset.metadata);
          if (isPlainRecord(parsed)) metadata = parsed;
        } catch {
          // Preserve a usable transcript even if legacy metadata was malformed.
        }
      }
      await store.updateAsset(job.projectId, job.assetId, {
        metadata: {
          ...metadata,
          transcription: {
            text: job.fullText,
            segments: job.segments,
            language: job.language,
            engine: job.engine,
            ...(job.model ? { model: job.model } : {}),
            processedAt: timestamp(),
          },
          transcriptionJobId: undefined,
          transcriptionStatus: 'ready',
          transcriptionStage: undefined,
          transcriptionError: undefined,
        },
      });
    } catch {
      // The durable job result remains available even if a concurrent project
      // update prevents writing the convenience copy into asset metadata.
    }
  };

  const finishJob = async (job, providerResult) => {
    const normalized = normalizeTranscriptionResult(providerResult);
    job.status = 'done';
    job.fullText = normalized.fullText;
    job.segments = normalized.segments;
    job.language = normalized.language;
    job.error = undefined;
    job.updatedAt = timestamp();
    await writeJob(job);
    await persistAssetTranscript(job);
    emit(job, {
      type: 'done',
      text: job.fullText,
      segments: job.segments,
      language: job.language,
    });
  };

  const failJob = async (job, cause) => {
    const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_ERROR_LENGTH);
    job.status = 'error';
    job.error = message || 'Transcription failed.';
    job.updatedAt = timestamp();
    await writeJob(job).catch(() => {});
    emit(job, { type: 'error', error: job.error });
  };

  const runJob = async (job, sourcePath, params, provider) => {
    try {
      job.status = 'running';
      await updateStatus(job, { stage: 'starting', message: 'Starting transcription' });
      const result = provider.kind === 'fal'
        ? await runFalTranscription(job, sourcePath, params)
        : await runHostedTranscription(job, sourcePath, params, provider.endpoint);
      await finishJob(job, result);
    } catch (cause) {
      await failJob(job, cause);
    } finally {
      activeJobs.delete(job.jobId);
    }
  };

  const resolveProvider = (params, engine) => {
    if (params.hostedEndpoint !== undefined && params.hostedEndpoint !== null && params.hostedEndpoint !== '') {
      const endpoint = validatePublicUrl(params.hostedEndpoint, 'Hosted transcription endpoint').href;
      return { kind: 'hosted', endpoint, requiresApiKey: true };
    }
    if (engine === 'whisper-cloud') {
      const configured = options.hostedEndpoint || process.env.CINEGEN_TRANSCRIPTION_ENDPOINT;
      if (configured) {
        return {
          kind: 'hosted',
          endpoint: validateConfiguredEndpoint(configured, 'Configured transcription endpoint', options.allowHttpWorker === true),
          requiresApiKey: true,
        };
      }
      return { kind: 'fal', requiresApiKey: true };
    }
    const worker = options.workerUrl || process.env.CINEGEN_TRANSCRIPTION_WORKER_URL;
    if (!worker) {
      throw transcriptionError(
        `${engine} runs on the CineGen desktop app. Configure CINEGEN_TRANSCRIPTION_WORKER_URL to use it from the web app.`,
        'WEB_CAPABILITY_UNAVAILABLE',
        501,
      );
    }
    return {
      kind: 'hosted',
      endpoint: validateConfiguredEndpoint(worker, 'Configured transcription worker URL', options.allowHttpWorker === true),
      requiresApiKey: false,
    };
  };

  const start = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Transcription parameters');
    const engine = params.engine === undefined || params.engine === null || params.engine === ''
      ? 'faster-whisper-local'
      : requireString(params.engine, 'Transcription engine', { maxLength: 64 });
    if (!ENGINES.has(engine)) throw transcriptionError('Transcription engine is invalid.');
    const model = params.model === undefined || params.model === null || params.model === ''
      ? 'large'
      : requireString(params.model, 'Transcription model', { maxLength: 32 });
    if (!MODELS.has(model)) throw transcriptionError('Transcription model is invalid.');
    const language = params.language === undefined || params.language === null || params.language === ''
      ? 'auto'
      : requireString(params.language, 'Transcription language', {
        maxLength: 64,
        pattern: /^(?:auto|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*)$/,
      });
    const provider = resolveProvider(params, engine);
    let apiKey;
    if (provider.requiresApiKey) apiKey = requireSecret(params.apiKey, 'Transcription API key');
    else if (typeof params.apiKey === 'string' && params.apiKey.trim()) apiKey = requireSecret(params.apiKey, 'Transcription API key');
    else if (typeof options.workerApiKey === 'string' && options.workerApiKey.trim()) apiKey = options.workerApiKey.trim();

    const ownership = await ensureProjectAndAsset(params.projectId, params.assetId);
    const source = await resolveSource(params.filePath, ownership.projectId);
    const jobId = `txn-${crypto.randomUUID()}`;
    const now = timestamp();
    const job = {
      jobId,
      assetId: ownership.assetId,
      projectId: ownership.projectId,
      engine,
      status: 'pending',
      segments: [],
      fullText: '',
      language: '',
      model: engine === 'whisper-cloud' ? FAL_VERSION : model,
      createdAt: now,
      updatedAt: now,
    };
    await writeJob(job);
    activeJobs.set(jobId, job);
    const runParams = { model, language, apiKey };
    const timer = setTimeout(() => void runJob(job, source.filePath, runParams, provider), 0);
    timer.unref?.();
    return { jobId };
  };

  const get = async (jobIdValue) => {
    const jobId = requireId(jobIdValue, 'Transcription job id');
    const job = await readJob(jobId);
    if (!job) return null;
    if ((job.status === 'pending' || job.status === 'running') && !activeJobs.has(jobId)) {
      job.status = 'error';
      job.error = 'Transcription was interrupted before it completed.';
      job.updatedAt = timestamp();
      await writeJob(job);
    }
    return publicJob(job);
  };

  return { start, get };
}
