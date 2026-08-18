import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  ServiceError,
  isPlainRecord,
  requireRecord,
  requireString,
} from './_shared.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NODE_TYPES = new Set(['ltx-local', 'qwen-edit-local', 'layer-decompose', 'whisperx-local']);
const MAX_STDOUT_LINE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 2_000;
const RESOLUTION_MAP = Object.freeze({
  '512x896': { height: 896, width: 512 },
  '896x512': { height: 512, width: 896 },
  '512x512': { height: 512, width: 512 },
  '704x1280': { height: 1280, width: 704 },
  '1280x704': { height: 704, width: 1280 },
  '768x768': { height: 768, width: 768 },
});

const RUNTIME_ENV = Object.freeze({
  'ltx-local': {
    repo: 'CINEGEN_LTX_REPO',
    python: 'CINEGEN_LTX_PYTHON',
    script: 'CINEGEN_LTX_SCRIPT',
  },
  'qwen-edit-local': {
    repo: 'CINEGEN_QWEN_EDIT_REPO',
    python: 'CINEGEN_QWEN_EDIT_PYTHON',
    script: 'CINEGEN_QWEN_EDIT_SCRIPT',
  },
  'layer-decompose': {
    repo: 'CINEGEN_LAYER_DECOMPOSE_REPO',
    python: 'CINEGEN_LAYER_DECOMPOSE_PYTHON',
    script: 'CINEGEN_LAYER_DECOMPOSE_SCRIPT',
  },
  'whisperx-local': {
    repo: 'CINEGEN_WHISPERX_REPO',
    python: 'CINEGEN_WHISPERX_PYTHON',
    script: 'CINEGEN_WHISPERX_SCRIPT',
  },
});

function localModelError(message, code = 'INVALID_LOCAL_MODEL_REQUEST', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function requireId(value, label) {
  return requireString(value, label, { maxLength: 128, pattern: SAFE_ID });
}

function optionalString(value, label, { maxLength = 100_000, pattern } = {}) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw localModelError(`${label} must be text.`);
  const result = value.trim();
  if (result.length > maxLength || (pattern && result && !pattern.test(result))) {
    throw localModelError(`${label} is invalid.`);
  }
  return result;
}

function finiteNumber(value, fallback, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const result = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw localModelError(`${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
  return result;
}

function booleanValue(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw localModelError(`${label} must be true or false.`);
  return value;
}

function isPathInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function pathInside(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (!isPathInside(root, candidate)) {
    throw localModelError('Local model path escapes the configured data directory.', 'INVALID_MEDIA_PATH');
  }
  return candidate;
}

function timestamp() {
  return new Date().toISOString();
}

function cleanFileName(value, fallback = 'output.bin') {
  const base = path.basename(String(value || fallback)).normalize('NFKC');
  const safe = base.replace(/[^A-Za-z0-9._() -]+/g, '_').replace(/^\.+/, '').slice(0, 180);
  return safe || fallback;
}

function cleanDisplayString(value, fallback, maxLength = 256) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function stripLocalMediaWrapper(value) {
  let result = value;
  if (result.startsWith('local-media://file')) result = result.slice('local-media://file'.length);
  try {
    return decodeURIComponent(result);
  } catch {
    throw localModelError('Local model media reference is malformed.', 'INVALID_MEDIA_PATH');
  }
}

function normalizeWord(value) {
  if (!isPlainRecord(value) || typeof value.word !== 'string') return null;
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const probability = Number(value.prob ?? value.probability);
  const speaker = typeof value.speaker === 'string' && value.speaker.trim()
    ? value.speaker.trim().slice(0, 256)
    : null;
  return {
    word: value.word.trim().slice(0, 10_000),
    start: Math.round(Math.max(0, start) * 1_000) / 1_000,
    end: Math.round(Math.max(0, end) * 1_000) / 1_000,
    ...(Number.isFinite(probability) ? { prob: probability } : {}),
    ...(speaker ? { speaker } : {}),
  };
}

function normalizeSegment(value) {
  if (!isPlainRecord(value) || typeof value.text !== 'string') return null;
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const words = Array.isArray(value.words) ? value.words.map(normalizeWord).filter(Boolean) : [];
  const speaker = typeof value.speaker === 'string' && value.speaker.trim()
    ? value.speaker.trim().slice(0, 256)
    : null;
  return {
    text: value.text.trim().slice(0, 250_000),
    start: Math.round(Math.max(0, start) * 1_000) / 1_000,
    end: Math.round(Math.max(0, end) * 1_000) / 1_000,
    ...(speaker ? { speaker } : {}),
    ...(words.length > 0 ? { words } : {}),
  };
}

function normalizeSegments(value) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 100_000).map(normalizeSegment).filter(Boolean);
}

function safeMetadata(value, depth = 0) {
  if (depth > 8) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'string' ? value.slice(0, 100_000) : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.slice(0, 1_000).map((entry) => safeMetadata(entry, depth + 1));
  if (!isPlainRecord(value)) return undefined;
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 1_000)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    const safe = safeMetadata(entry, depth + 1);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function publicJob(job) {
  return {
    status: job.status,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.outputPath ? { outputPath: job.outputPath } : {}),
    ...(job.outputText !== undefined ? { outputText: job.outputText } : {}),
    ...(job.transcriptPath ? { transcriptPath: job.transcriptPath } : {}),
    ...(job.segments ? { segments: job.segments } : {}),
    ...(job.language !== undefined ? { language: job.language } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function defaultProcessRunner(spec, handlers) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let handlerChain = Promise.resolve();
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), spec.timeoutMs);
    timer.unref?.();

    const queueLine = (line) => {
      if (!line.trim()) return;
      if (Buffer.byteLength(line, 'utf8') > MAX_STDOUT_LINE_BYTES) {
        handlerChain = handlerChain.then(() => {
          throw localModelError('Local model emitted an oversized response.', 'LOCAL_MODEL_BAD_RESPONSE', 502);
        });
        return;
      }
      handlerChain = handlerChain.then(() => handlers.onStdoutLine(line));
    };

    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        queueLine(stdoutBuffer.slice(0, newline));
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
      }
      if (Buffer.byteLength(stdoutBuffer, 'utf8') > MAX_STDOUT_LINE_BYTES) {
        child.kill('SIGKILL');
      }
    });
    child.stderr?.on('data', (chunk) => handlers.onStderr?.(chunk.toString()));
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
      if (stdoutBuffer.trim()) queueLine(stdoutBuffer);
      void handlerChain.then(
        () => resolve({ code, signal }),
        reject,
      );
    });
  });
}

/**
 * Create the web local-model bridge.
 *
 * Context requires `dataRoot`, `store`, `events`, and
 * `pathForMediaReference`. `mediaUrlForPath` is optional (the default returns
 * `/media/...`). Configure runtimes through `runtimes[nodeType]` with
 * `{ python, script, repo|cwd, env? }`, or the documented CINEGEN_* environment
 * variables. `processRunner(spec, handlers)` may be injected for tests; it
 * should call/await `handlers.onStdoutLine(line)` and resolve `{ code, signal }`.
 */
export function createLocalModelHandlers(context) {
  const options = requireRecord(context, 'Local model service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'Local model data root', { maxLength: 16_384 }));
  const mediaRoot = pathInside(dataRoot, 'media');
  const projectsMediaRoot = pathInside(mediaRoot, 'projects');
  const jobsRoot = pathInside(dataRoot, 'local-model', 'jobs');
  const store = options.store;
  const events = options.events;
  const processRunner = options.processRunner ?? defaultProcessRunner;
  const maxOutputBytes = Number.isFinite(options.maxOutputBytes)
    ? Math.max(1, Number(options.maxOutputBytes))
    : DEFAULT_MAX_OUTPUT_BYTES;
  const processTimeoutMs = Number.isFinite(options.processTimeoutMs)
    ? Math.max(1_000, Number(options.processTimeoutMs))
    : DEFAULT_PROCESS_TIMEOUT_MS;
  const activeJobs = new Map();

  const emit = (job, data) => {
    if (events && typeof events.emit === 'function') {
      events.emit('local-model:progress', { jobId: job.jobId, ...data });
    }
  };

  const mediaUrlForPath = async (filePath) => {
    const resolved = path.resolve(filePath);
    if (!isPathInside(mediaRoot, resolved)) {
      throw localModelError('Attempted to expose a local model file outside web media.', 'INVALID_MEDIA_PATH', 500);
    }
    if (typeof options.mediaUrlForPath === 'function') {
      const result = await options.mediaUrlForPath(resolved);
      if (typeof result !== 'string' || !result.trim()) {
        throw localModelError('mediaUrlForPath returned an invalid URL.', 'INVALID_MEDIA_URL', 500);
      }
      return result;
    }
    const relative = path.relative(mediaRoot, resolved).split(path.sep).map(encodeURIComponent).join('/');
    return `/media/${relative}`;
  };

  const jobPath = (jobIdValue) => pathInside(jobsRoot, `${requireId(jobIdValue, 'Local model job id')}.json`);

  const writeJob = async (job) => {
    const filePath = jobPath(job.jobId);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, `${JSON.stringify({
        jobId: job.jobId,
        projectId: job.projectId,
        nodeType: job.nodeType,
        status: job.status,
        ...(job.stage ? { stage: job.stage } : {}),
        ...(job.outputPath ? { outputPath: job.outputPath } : {}),
        ...(job.outputText !== undefined ? { outputText: job.outputText } : {}),
        ...(job.transcriptPath ? { transcriptPath: job.transcriptPath } : {}),
        ...(job.segments ? { segments: job.segments } : {}),
        ...(job.language !== undefined ? { language: job.language } : {}),
        ...(job.error ? { error: job.error } : {}),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fsp.rename(temporary, filePath);
    } catch (cause) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw cause;
    }
  };

  const readJob = async (jobId) => {
    try {
      const value = JSON.parse(await fsp.readFile(jobPath(jobId), 'utf8'));
      return isPlainRecord(value) ? value : null;
    } catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      if (cause instanceof SyntaxError) throw localModelError('Saved local model job is corrupt.', 'CORRUPT_JOB', 500, cause);
      throw cause;
    }
  };

  const resolveRuntime = (nodeType) => {
    const envKeys = RUNTIME_ENV[nodeType];
    const supplied = isPlainRecord(options.runtimes?.[nodeType]) ? options.runtimes[nodeType] : {};
    const repoValue = supplied.repo ?? supplied.cwd ?? process.env[envKeys.repo];
    const pythonValue = supplied.python ?? supplied.command ?? process.env[envKeys.python];
    const scriptValue = supplied.script ?? process.env[envKeys.script];
    if (!pythonValue || !scriptValue) {
      throw localModelError(
        `${nodeType} is not configured on this web server. Set ${envKeys.python} and ${envKeys.script}, or provide runtimes["${nodeType}"].`,
        'WEB_CAPABILITY_UNAVAILABLE',
        501,
      );
    }
    const python = requireString(pythonValue, `${nodeType} Python runtime`, { maxLength: 16_384 });
    const repo = repoValue ? path.resolve(requireString(repoValue, `${nodeType} repository`, { maxLength: 16_384 })) : undefined;
    const scriptRaw = requireString(scriptValue, `${nodeType} runtime script`, { maxLength: 16_384 });
    const script = path.isAbsolute(scriptRaw) ? scriptRaw : path.resolve(repo ?? process.cwd(), scriptRaw);
    const runtimeEnvironment = isPlainRecord(supplied.env)
      ? Object.fromEntries(Object.entries(supplied.env).flatMap(([key, value]) => (
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' ? [[key, value]] : []
      )))
      : {};
    return {
      command: python,
      script,
      cwd: repo ?? path.dirname(script),
      env: { ...process.env, ...runtimeEnvironment },
    };
  };

  const ensureRuntimeFiles = async (runtime) => {
    if (options.processRunner) return;
    const checks = [
      [runtime.script, 'runtime script'],
      [runtime.cwd, 'runtime working directory'],
    ];
    if (path.isAbsolute(runtime.command)) checks.push([runtime.command, 'Python runtime']);
    for (const [filePath, label] of checks) {
      try {
        await fsp.access(filePath);
      } catch (cause) {
        throw localModelError(`Configured local model ${label} does not exist: ${filePath}`, 'WEB_CAPABILITY_UNAVAILABLE', 501, cause);
      }
    }
  };

  const loadProject = async (projectIdValue) => {
    const projectId = requireId(projectIdValue, 'Project id');
    if (!store || typeof store.load !== 'function') {
      throw localModelError('Project storage is unavailable for local models.', 'SERVER_MISCONFIGURED', 500);
    }
    const state = await store.load(projectId);
    if (isPlainRecord(state?.project) && state.project.id && state.project.id !== projectId) {
      throw localModelError('Project ownership check failed.', 'PROJECT_MISMATCH', 403);
    }
    return projectId;
  };

  const resolveInputMedia = async (value, label) => {
    const raw = requireString(value, label, { maxLength: 16_384 });
    if (typeof options.pathForMediaReference !== 'function') {
      throw localModelError('Web media path resolution is unavailable.', 'SERVER_MISCONFIGURED', 500);
    }
    const reference = stripLocalMediaWrapper(raw);
    let filePath;
    try {
      filePath = await options.pathForMediaReference(reference);
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      throw localModelError(`${label} is not a valid web media reference.`, 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof filePath !== 'string' || !isPathInside(projectsMediaRoot, filePath)) {
      throw localModelError(`${label} is outside project-owned web media.`, 'INVALID_MEDIA_PATH', 403);
    }
    const relative = path.relative(projectsMediaRoot, filePath).split(path.sep);
    const projectId = requireId(relative[0], 'Media project id');
    let stats;
    let realProjectRoot;
    let realPath;
    try {
      [stats, realProjectRoot, realPath] = await Promise.all([
        fsp.stat(filePath),
        fsp.realpath(pathInside(projectsMediaRoot, projectId)),
        fsp.realpath(filePath),
      ]);
    } catch (cause) {
      if (cause?.code === 'ENOENT') throw localModelError(`${label} was not found.`, 'MEDIA_NOT_FOUND', 404, cause);
      throw cause;
    }
    if (!stats.isFile() || !isPathInside(realProjectRoot, realPath)) {
      throw localModelError(`${label} belongs to a different project.`, 'PROJECT_MISMATCH', 403);
    }
    return { filePath: realPath, projectId };
  };

  const resolveProject = async (explicitValue, mediaInputs) => {
    const derived = [...new Set(mediaInputs.filter(Boolean).map((entry) => entry.projectId))];
    if (derived.length > 1) throw localModelError('Local model inputs belong to different projects.', 'PROJECT_MISMATCH', 403);
    let projectId;
    if (explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
      projectId = requireId(explicitValue, 'Project id');
      if (derived.length === 1 && derived[0] !== projectId) {
        throw localModelError('Local model input belongs to a different project.', 'PROJECT_MISMATCH', 403);
      }
    } else if (derived.length === 1) {
      [projectId] = derived;
    } else {
      throw localModelError('projectId is required for local generation without a media input.', 'PROJECT_ID_REQUIRED');
    }
    return await loadProject(projectId);
  };

  const prepareRun = async (params) => {
    const nodeType = requireString(params.nodeType, 'Local model node type', { maxLength: 64 });
    if (!NODE_TYPES.has(nodeType)) throw localModelError(`Unsupported local model node type: ${nodeType}`, 'UNSUPPORTED_LOCAL_MODEL', 501);
    const inputs = requireRecord(params.inputs, 'Local model inputs');
    const runtime = resolveRuntime(nodeType);
    await ensureRuntimeFiles(runtime);
    let mediaInput = null;
    let args;

    if (nodeType === 'qwen-edit-local') {
      const prompt = requireString(inputs.prompt, 'Qwen edit prompt', { maxLength: 100_000 });
      if (!inputs.image_url) throw localModelError('Qwen Image Edit requires an input image.');
      mediaInput = await resolveInputMedia(inputs.image_url, 'Qwen input image');
      const steps = finiteNumber(inputs.num_inference_steps, 50, 'Inference steps', { min: 1, max: 200, integer: true });
      const guidance = finiteNumber(inputs.guidance_scale, 1, 'Guidance scale', { min: 0, max: 100 });
      const trueCfg = finiteNumber(inputs.true_cfg_scale, 4, 'True CFG scale', { min: 0, max: 100 });
      const seed = finiteNumber(inputs.seed, 42, 'Seed', { min: -1, max: 4_294_967_295, integer: true });
      args = [
        runtime.script,
        '--image_path', mediaInput.filePath,
        '--prompt', prompt,
        '--num_inference_steps', `${steps}`,
        '--guidance_scale', `${guidance}`,
        '--true_cfg_scale', `${trueCfg}`,
        '--seed', `${seed}`,
      ];
    } else if (nodeType === 'layer-decompose') {
      if (!inputs.image_url) throw localModelError('Layer Decompose requires an input image.');
      mediaInput = await resolveInputMedia(inputs.image_url, 'Layer Decompose input image');
      const prompts = optionalString(inputs.prompts, 'Layer prompts', { maxLength: 100_000 });
      const inpainter = optionalString(inputs.inpainter, 'Layer inpainter', { maxLength: 64 }) || 'qwen-edit-local';
      if (!['qwen-edit-local', 'qwen-edit-cloud', 'qwen-edit-runpod', 'lama'].includes(inpainter)) {
        throw localModelError('Layer inpainter is invalid.');
      }
      const reconstruct = booleanValue(inputs.reconstruct_bg, true, 'Reconstruct background');
      const seed = finiteNumber(inputs.seed, 42, 'Seed', { min: -1, max: 4_294_967_295, integer: true });
      const pythonInpainter = reconstruct && inpainter === 'lama' ? 'lama' : 'none';
      args = [runtime.script, '--image_path', mediaInput.filePath, '--inpainter', pythonInpainter, '--seed', `${seed}`];
      if (prompts) args.push('--prompts', prompts);
    } else if (nodeType === 'whisperx-local') {
      if (!inputs.audio_url) throw localModelError('WhisperX requires an audio input.');
      mediaInput = await resolveInputMedia(inputs.audio_url, 'WhisperX media input');
      const model = optionalString(inputs.model, 'WhisperX model', { maxLength: 32 }) || 'base';
      if (!['tiny', 'base', 'small', 'medium', 'large-v3'].includes(model)) throw localModelError('WhisperX model is invalid.');
      const language = optionalString(inputs.language, 'WhisperX language', {
        maxLength: 64,
        pattern: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/,
      });
      const diarize = booleanValue(inputs.diarize, true, 'WhisperX diarization');
      args = [runtime.script, '--audio_path', mediaInput.filePath, '--model', model];
      if (language) args.push('--language', language);
      if (!diarize) args.push('--no_diarize');
    } else {
      const prompt = requireString(inputs.prompt, 'LTX prompt', { maxLength: 100_000 });
      if (inputs.image_url) mediaInput = await resolveInputMedia(inputs.image_url, 'LTX input image');
      const resolution = optionalString(inputs.resolution, 'LTX resolution', { maxLength: 32 }) || '896x512';
      const dimensions = RESOLUTION_MAP[resolution];
      if (!dimensions) throw localModelError('LTX resolution is invalid.');
      const frameRate = finiteNumber(inputs.frame_rate, 24, 'LTX frame rate', { min: 1, max: 120 });
      const duration = finiteNumber(inputs.duration_secs, 4, 'LTX duration', { min: 0.25, max: 60 });
      const frames = Math.max(9, Math.round((duration * frameRate) / 8) * 8 + 1);
      const seed = finiteNumber(inputs.seed, 42, 'Seed', { min: -1, max: 4_294_967_295, integer: true });
      const enhancePrompt = booleanValue(inputs.enhance_prompt, false, 'Enhance prompt');
      args = [
        runtime.script,
        '--prompt', prompt,
        '--height', `${dimensions.height}`,
        '--width', `${dimensions.width}`,
        '--num_frames', `${frames}`,
        '--frame_rate', `${frameRate}`,
        '--seed', `${seed}`,
      ];
      if (mediaInput) args.push('--image_path', mediaInput.filePath);
      if (enhancePrompt) args.push('--enhance_prompt');
    }

    const projectId = await resolveProject(params.projectId ?? inputs.projectId ?? inputs.__projectId, [mediaInput]);
    return { nodeType, runtime, args, projectId };
  };

  const outputRootFor = (job) => pathInside(projectsMediaRoot, job.projectId, 'generated', 'local-model', job.jobId);

  const createOutputMapper = (job, runtimeCwd) => {
    const cache = new Map();
    let outputIndex = 0;
    return async (sourceValue, label) => {
      const source = requireString(sourceValue, label, { maxLength: 16_384 });
      if (cache.has(source)) return cache.get(source);
      const sourcePath = path.isAbsolute(source) ? source : path.resolve(runtimeCwd, source);
      if (cache.has(sourcePath)) return cache.get(sourcePath);
      let stats;
      let realSource;
      try {
        [stats, realSource] = await Promise.all([fsp.stat(sourcePath), fsp.realpath(sourcePath)]);
      } catch (cause) {
        if (cause?.code === 'ENOENT') throw localModelError(`${label} was not created by the runtime.`, 'LOCAL_MODEL_OUTPUT_MISSING', 502, cause);
        throw cause;
      }
      if (!stats.isFile() || stats.size > maxOutputBytes) {
        throw localModelError(`${label} is not a usable file or exceeds the server output limit.`, 'LOCAL_MODEL_BAD_OUTPUT', 502);
      }
      const outputRoot = outputRootFor(job);
      await fsp.mkdir(outputRoot, { recursive: true });
      let destination = realSource;
      if (!isPathInside(outputRoot, realSource)) {
        outputIndex += 1;
        destination = pathInside(outputRoot, `${String(outputIndex).padStart(2, '0')}-${cleanFileName(realSource)}`);
        await fsp.copyFile(realSource, destination, fsConstantsCopyExclusive());
      }
      const url = await mediaUrlForPath(destination);
      cache.set(source, url);
      cache.set(sourcePath, url);
      cache.set(realSource, url);
      return url;
    };
  };

  const normalizeLayer = async (value, index, mapOutput) => {
    const layer = requireRecord(value, `Layer ${index + 1}`);
    const layerPath = await mapOutput(layer.path, `Layer ${index + 1} output`);
    const zOrder = Number(layer.z_order);
    return {
      path: layerPath,
      name: cleanDisplayString(layer.name, `Layer ${index + 1}`),
      type: cleanDisplayString(layer.type, 'unknown', 64),
      z_order: Number.isFinite(zOrder) ? zOrder : index,
      ...(isPlainRecord(layer.metadata) ? { metadata: safeMetadata(layer.metadata) } : {}),
    };
  };

  const processMessage = async (job, value, mapOutput) => {
    let message;
    try {
      message = JSON.parse(value);
    } catch {
      return;
    }
    if (!isPlainRecord(message) || typeof message.type !== 'string') return;
    if (job.status === 'done' || job.status === 'error') return;

    if (message.type === 'progress') {
      job.stage = cleanDisplayString(message.stage, job.stage ?? '', 256) || undefined;
      if (typeof message.output_text === 'string') job.outputText = message.output_text.slice(0, 2_000_000);
      const segments = normalizeSegments(message.segments);
      if (segments) job.segments = segments;
      if (typeof message.language === 'string') job.language = message.language.trim().slice(0, 128);
      job.updatedAt = timestamp();
      await writeJob(job);
      emit(job, {
        type: 'progress',
        ...(job.stage ? { stage: job.stage } : {}),
        ...(typeof message.message === 'string' ? { message: message.message.slice(0, 2_000) } : {}),
        ...(job.outputText !== undefined ? { output_text: job.outputText } : {}),
        ...(job.segments ? { segments: job.segments } : {}),
        ...(job.language !== undefined ? { language: job.language } : {}),
      });
      return;
    }

    if (message.type === 'error') {
      job.status = 'error';
      job.error = cleanDisplayString(message.error, 'Local model runtime reported an error.', MAX_ERROR_LENGTH);
      job.updatedAt = timestamp();
      await writeJob(job);
      emit(job, { type: 'error', error: job.error });
      return;
    }

    if (message.type !== 'done') return;
    const outputPath = message.output_path ? await mapOutput(message.output_path, 'Local model output') : undefined;
    const transcriptPath = message.transcript_path
      ? await mapOutput(message.transcript_path, 'Local model transcript')
      : undefined;
    const layers = Array.isArray(message.layers)
      ? await Promise.all(message.layers.slice(0, 1_000).map((layer, index) => normalizeLayer(layer, index, mapOutput)))
      : undefined;
    const combinedMaskPath = message.combined_mask_path
      ? await mapOutput(message.combined_mask_path, 'Combined mask output')
      : undefined;
    job.status = 'done';
    job.outputPath = outputPath;
    if (typeof message.output_text === 'string') job.outputText = message.output_text.slice(0, 2_000_000);
    job.transcriptPath = transcriptPath;
    const segments = normalizeSegments(message.segments);
    if (segments) job.segments = segments;
    if (typeof message.language === 'string') job.language = message.language.trim().slice(0, 128);
    job.updatedAt = timestamp();
    await writeJob(job);
    emit(job, {
      type: 'done',
      ...(outputPath ? { output_path: outputPath } : {}),
      ...(job.outputText !== undefined ? { output_text: job.outputText } : {}),
      ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
      ...(job.segments ? { segments: job.segments } : {}),
      ...(job.language !== undefined ? { language: job.language } : {}),
      ...(layers ? { layers } : {}),
      ...(message.needs_inpainting !== undefined ? { needs_inpainting: Boolean(message.needs_inpainting) } : {}),
      ...(combinedMaskPath ? { combined_mask_path: combinedMaskPath } : {}),
    });
  };

  const failJob = async (job, cause) => {
    if (job.status === 'error') return;
    job.status = 'error';
    job.error = (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_ERROR_LENGTH) || 'Local model failed.';
    job.updatedAt = timestamp();
    await writeJob(job).catch(() => {});
    emit(job, { type: 'error', error: job.error });
  };

  const executeJob = async (job, prepared) => {
    const mapOutput = createOutputMapper(job, prepared.runtime.cwd);
    let stderr = '';
    try {
      job.status = 'running';
      job.updatedAt = timestamp();
      await writeJob(job);
      emit(job, { type: 'status', status: 'running' });
      const result = await processRunner({
        command: prepared.runtime.command,
        args: prepared.args,
        cwd: prepared.runtime.cwd,
        env: prepared.runtime.env,
        timeoutMs: processTimeoutMs,
        jobId: job.jobId,
        nodeType: job.nodeType,
        projectId: job.projectId,
        outputDir: outputRootFor(job),
      }, {
        onStdoutLine: (line) => processMessage(job, String(line), mapOutput),
        onStderr: (value) => {
          if (stderr.length < 256_000) stderr += String(value).slice(0, 256_000 - stderr.length);
        },
      });
      const code = typeof result === 'number' ? result : result?.code ?? 0;
      const signal = isPlainRecord(result) ? result.signal : undefined;
      if (job.status === 'error') return;
      if (code !== 0 || signal) {
        throw new Error(stderr.trim().split('\n').slice(-8).join('\n').slice(0, MAX_ERROR_LENGTH) || `Local model process exited with code ${code}.`);
      }
      if (job.status !== 'done') throw localModelError('Local model exited without producing a result.', 'LOCAL_MODEL_BAD_RESPONSE', 502);
    } catch (cause) {
      await failJob(job, cause);
    } finally {
      activeJobs.delete(job.jobId);
    }
  };

  const run = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Local model parameters');
    const prepared = await prepareRun(params);
    const jobId = `local-${crypto.randomUUID()}`;
    const now = timestamp();
    const job = {
      jobId,
      projectId: prepared.projectId,
      nodeType: prepared.nodeType,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await writeJob(job);
    activeJobs.set(jobId, job);
    const timer = setTimeout(() => void executeJob(job, prepared), 0);
    timer.unref?.();
    return { jobId };
  };

  const get = async (jobIdValue) => {
    const jobId = requireId(jobIdValue, 'Local model job id');
    const job = await readJob(jobId);
    if (!job) return null;
    if ((job.status === 'pending' || job.status === 'running') && !activeJobs.has(jobId)) {
      job.status = 'error';
      job.error = 'Local model job was interrupted before it completed.';
      job.updatedAt = timestamp();
      await writeJob(job);
    }
    return publicJob(job);
  };

  const readTranscript = async (referenceValue) => {
    const raw = requireString(referenceValue, 'Transcript reference', { maxLength: 16_384 });
    if (typeof options.pathForMediaReference !== 'function') {
      throw localModelError('Web media path resolution is unavailable.', 'SERVER_MISCONFIGURED', 500);
    }
    const reference = stripLocalMediaWrapper(raw);
    let filePath;
    try {
      filePath = await options.pathForMediaReference(reference);
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      throw localModelError('Transcript reference is invalid.', 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof filePath !== 'string' || !isPathInside(projectsMediaRoot, filePath)) {
      throw localModelError('Transcript must be a project-owned local model output.', 'INVALID_MEDIA_PATH', 403);
    }
    const relative = path.relative(projectsMediaRoot, filePath).split(path.sep);
    if (
      relative.length < 5
      || relative[1] !== 'generated'
      || relative[2] !== 'local-model'
      || !SAFE_ID.test(relative[0])
      || !SAFE_ID.test(relative[3])
      || path.extname(filePath).toLowerCase() !== '.json'
    ) {
      throw localModelError('Transcript is not a local model transcript output.', 'INVALID_MEDIA_PATH', 403);
    }
    let stats;
    let realOutputRoot;
    let realPath;
    try {
      const outputRoot = pathInside(projectsMediaRoot, relative[0], 'generated', 'local-model', relative[3]);
      [stats, realOutputRoot, realPath] = await Promise.all([
        fsp.stat(filePath),
        fsp.realpath(outputRoot),
        fsp.realpath(filePath),
      ]);
    } catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw cause;
    }
    if (!stats.isFile() || stats.size > 32 * 1024 * 1024 || !isPathInside(realOutputRoot, realPath)) {
      throw localModelError('Transcript is not a readable local model output.', 'INVALID_MEDIA_PATH', 403);
    }
    try {
      const parsed = JSON.parse(await fsp.readFile(realPath, 'utf8'));
      if (!isPlainRecord(parsed)) return null;
      const segments = normalizeSegments(parsed.segments);
      const outputText = typeof parsed.output_text === 'string' ? parsed.output_text.slice(0, 2_000_000) : undefined;
      const language = typeof parsed.language === 'string' ? parsed.language.trim().slice(0, 128) : undefined;
      return {
        ...(outputText !== undefined ? { output_text: outputText } : {}),
        ...(segments ? { segments } : {}),
        ...(language !== undefined ? { language } : {}),
      };
    } catch (cause) {
      if (cause instanceof SyntaxError) return null;
      throw cause;
    }
  };

  return { run, get, readTranscript };
}

function fsConstantsCopyExclusive() {
  // COPYFILE_EXCL is stable across supported Node releases. Keeping the import
  // local avoids loading the legacy callback fs surface into this service.
  return 1;
}
