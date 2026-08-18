import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import ffmpegStaticPath from 'ffmpeg-static';

import { ServiceError, requireRecord, requireString } from './_shared.mjs';

const PRESETS = Object.freeze({
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 },
});
const FPS_VALUES = new Set([24, 30, 60]);
const CLIP_TYPES = new Set(['video', 'image', 'audio']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CLIPS = 2_000;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const MAX_ERROR_LENGTH = 4_000;

function exportError(message, code = 'INVALID_EXPORT', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathInside(root, ...segments) {
  const result = path.resolve(root, ...segments);
  if (!isPathInside(root, result)) {
    throw exportError('Export path escapes the web media directory.', 'INVALID_MEDIA_PATH');
  }
  return result;
}

function finiteNumber(value, label, { min, max, fallback } = {}) {
  const candidate = value === undefined && fallback !== undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw exportError(`${label} must be a finite number.`);
  }
  if (min !== undefined && candidate < min) throw exportError(`${label} must be at least ${min}.`);
  if (max !== undefined && candidate > max) throw exportError(`${label} must be at most ${max}.`);
  return candidate;
}

function validateJobId(value) {
  if (typeof value !== 'string' || !JOB_ID.test(value)) {
    throw exportError('Invalid export id.', 'INVALID_EXPORT_ID');
  }
  return value;
}

function evenDimension(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 16 || parsed > 16_384) return fallback;
  const rounded = Math.round(parsed);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function atempoFilters(speed) {
  const factors = [];
  let remaining = speed;
  while (remaining < 0.5 - 1e-8) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  while (remaining > 2 + 1e-8) {
    factors.push(2);
    remaining /= 2;
  }
  if (Math.abs(remaining - 1) > 1e-8) factors.push(remaining);
  return factors.map((factor) => `atempo=${factor.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`);
}

function parseProgress(text, totalDuration) {
  let seconds;
  const micros = /(?:^|\n)out_time_ms=(\d+)/.exec(text);
  if (micros) seconds = Number(micros[1]) / 1_000_000;
  if (seconds === undefined) {
    const clock = /(?:^|\n)out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    if (clock) seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  if (!Number.isFinite(seconds)) return null;
  return Math.max(0, Math.min(99, (seconds / totalDuration) * 100));
}

function summarizeFailure(stderr, fallback) {
  const lines = String(stderr || '').trim().split(/\r?\n/).filter(Boolean);
  const detail = lines.slice(-8).join('\n').slice(0, MAX_ERROR_LENGTH);
  return detail ? `${fallback}: ${detail}` : fallback;
}

function defaultProcessRunner({ executable, args, signal, onStderr }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let forceKillTimer;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => {
      if (child.exitCode !== null || child.killed) return;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000);
      forceKillTimer.unref?.();
    };

    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-MAX_ERROR_LENGTH);
      onStderr?.(text);
    });
    child.once('error', (cause) => finish(() => reject(cause)));
    child.once('close', (code, exitSignal) => finish(() => resolve({
      code: Number.isInteger(code) ? code : 1,
      signal: exitSignal,
      stderr,
    })));
  });
}

function publicJob(record) {
  return { ...record.job };
}

/**
 * Create the browser-safe export service.
 *
 * All inputs must be `/media/projects/<projectId>/...` references (or paths
 * resolved there by `pathForMediaReference`). The project is intentionally
 * inferred from those paths because the desktop `export.start` contract does
 * not include a project id.
 */
export function createExportHandlers(context) {
  const options = requireRecord(context, 'Export service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'Export data root', { maxLength: 16_384 }));
  const mediaRoot = pathInside(dataRoot, 'media');
  const projectsRoot = pathInside(mediaRoot, 'projects');
  const store = options.store;
  const events = options.events;
  const ffmpegPath = options.ffmpegPath || ffmpegStaticPath;
  const processRunner = options.processRunner || defaultProcessRunner;
  const jobs = new Map();

  if (!ffmpegPath || typeof ffmpegPath !== 'string') {
    throw exportError('FFmpeg is not installed on this web server.', 'EXPORT_PROCESSOR_UNAVAILABLE', 501);
  }
  if (typeof processRunner !== 'function') {
    throw exportError('Export process runner must be a function.', 'INVALID_EXPORT_CONTEXT', 500);
  }

  const emitProgress = (record) => {
    if (events && typeof events.emit === 'function') {
      events.emit('export:progress', { jobId: record.job.id, progress: record.job.progress });
    }
  };

  const resolveReference = async (reference) => {
    const value = requireString(reference, 'Clip media reference', { maxLength: 16_384 });
    if (typeof options.pathForMediaReference !== 'function') {
      throw exportError('Media reference resolver is unavailable.', 'INVALID_EXPORT_CONTEXT', 500);
    }
    let resolved;
    try {
      resolved = await options.pathForMediaReference(value);
    } catch (cause) {
      throw exportError('Clip media reference is malformed or unavailable.', 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof resolved !== 'string' || !isPathInside(mediaRoot, resolved)) {
      throw exportError('Clip media must be stored inside the web media directory.', 'INVALID_MEDIA_PATH');
    }

    let realPath;
    let realMediaRoot;
    try {
      [realPath, realMediaRoot] = await Promise.all([fsp.realpath(resolved), fsp.realpath(mediaRoot)]);
      const stats = await fsp.stat(realPath);
      if (!stats.isFile()) throw exportError('Clip media reference must point to a file.', 'INVALID_MEDIA_PATH');
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      if (cause?.code === 'ENOENT') throw exportError('Clip media file was not found.', 'MEDIA_NOT_FOUND', 404, cause);
      throw cause;
    }
    const realProjectsRoot = pathInside(realMediaRoot, 'projects');
    if (!isPathInside(realMediaRoot, realPath) || !isPathInside(realProjectsRoot, realPath)) {
      throw exportError('Exports only accept media owned by a CineGen web project.', 'INVALID_MEDIA_PATH');
    }
    const relative = path.relative(realProjectsRoot, realPath);
    const projectId = relative.split(path.sep)[0];
    if (!SAFE_ID.test(projectId)) throw exportError('Clip media has an invalid project id.', 'INVALID_PROJECT_ID');
    return { path: realPath, projectId };
  };

  const validateStart = async (value) => {
    const params = requireRecord(value, 'Export parameters');
    const preset = params.preset === undefined ? 'standard' : params.preset;
    if (typeof preset !== 'string' || !Object.hasOwn(PRESETS, preset)) {
      throw exportError('Export preset must be draft, standard, or high.');
    }
    const fps = finiteNumber(params.fps, 'Export frame rate', { fallback: 30 });
    if (!Number.isInteger(fps) || !FPS_VALUES.has(fps)) {
      throw exportError('Export frame rate must be 24, 30, or 60.');
    }
    const totalDuration = finiteNumber(params.totalDuration, 'Export duration', {
      min: 1 / fps,
      max: MAX_DURATION_SECONDS,
    });
    if (!Array.isArray(params.clips) || params.clips.length === 0) {
      throw exportError('At least one clip is required for export.');
    }
    if (params.clips.length > MAX_CLIPS) throw exportError(`Exports support at most ${MAX_CLIPS} clips.`);

    const clips = [];
    let projectId;
    for (let index = 0; index < params.clips.length; index += 1) {
      const clip = requireRecord(params.clips[index], `Export clip ${index + 1}`);
      if (!CLIP_TYPES.has(clip.type)) throw exportError(`Export clip ${index + 1} has an invalid media type.`);
      const startTime = finiteNumber(clip.startTime, `Export clip ${index + 1} start time`, {
        min: 0,
        max: MAX_DURATION_SECONDS,
      });
      const duration = finiteNumber(clip.duration, `Export clip ${index + 1} duration`, {
        min: 1 / fps,
        max: MAX_DURATION_SECONDS,
      });
      const trimStart = finiteNumber(clip.trimStart, `Export clip ${index + 1} trim start`, {
        min: 0,
        max: MAX_DURATION_SECONDS,
        fallback: 0,
      });
      const speed = finiteNumber(clip.speed, `Export clip ${index + 1} speed`, {
        min: 0.25,
        max: 4,
        fallback: 1,
      });
      const volume = finiteNumber(clip.volume, `Export clip ${index + 1} volume`, {
        min: 0,
        max: 4,
        fallback: 1,
      });
      if (startTime + duration > totalDuration + 1 / fps) {
        throw exportError(`Export clip ${index + 1} extends beyond the export duration.`);
      }
      const media = await resolveReference(clip.inputPath);
      if (projectId && media.projectId !== projectId) {
        throw exportError('All export clips must belong to one project.', 'MIXED_PROJECT_MEDIA');
      }
      projectId = media.projectId;
      clips.push({
        type: clip.type,
        inputPath: media.path,
        startTime,
        duration,
        trimStart,
        speed,
        volume,
      });
    }
    if (!projectId) throw exportError('Unable to derive a project from the export clips.', 'INVALID_PROJECT_ID');
    const state = store && typeof store.load === 'function' ? await store.load(projectId) : undefined;
    return { preset, fps, totalDuration, clips, projectId, state };
  };

  const run = async (record, args, kind, onStderr) => {
    if (record.cancelled || record.controller.signal.aborted) {
      throw exportError('Export was cancelled.', 'EXPORT_CANCELLED', 409);
    }
    return processRunner({
      executable: ffmpegPath,
      args,
      signal: record.controller.signal,
      onStderr,
      kind,
      jobId: record.job.id,
      outputPath: record.outputPath,
    });
  };

  const hasAudioStream = async (record, clip) => {
    if (clip.type === 'audio') return true;
    if (clip.type === 'image') return false;
    const result = await run(record, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(clip.trimStart),
      '-i', clip.inputPath,
      '-map', '0:a:0',
      '-frames:a', '1',
      '-f', 'null', '-',
    ], 'probe-audio');
    return result?.code === 0;
  };

  const buildCommand = (validated, audioFlags, outputPath) => {
    const preset = PRESETS[validated.preset];
    const sourceWidth = evenDimension(validated.state?.project?.resolution_width, 1920);
    const sourceHeight = evenDimension(validated.state?.project?.resolution_height, 1080);
    const width = Math.max(16, Math.floor(sourceWidth * preset.scale / 2) * 2);
    const height = Math.max(16, Math.floor(sourceHeight * preset.scale / 2) * 2);
    const args = [
      '-hide_banner', '-y', '-progress', 'pipe:2', '-nostats',
      '-f', 'lavfi', '-i',
      `color=c=black:s=${width}x${height}:r=${validated.fps}:d=${validated.totalDuration}`,
    ];

    for (const clip of validated.clips) {
      if (clip.type === 'image') {
        args.push('-loop', '1', '-framerate', String(validated.fps), '-t', String(clip.duration), '-i', clip.inputPath);
      } else {
        args.push('-ss', String(clip.trimStart), '-t', String(clip.duration * clip.speed), '-i', clip.inputPath);
      }
    }

    const filters = ['[0:v]format=yuv420p[base0]'];
    let visualCount = 0;
    const audioLabels = [];
    for (let clipIndex = 0; clipIndex < validated.clips.length; clipIndex += 1) {
      const clip = validated.clips[clipIndex];
      const inputIndex = clipIndex + 1;
      if (clip.type !== 'audio') {
        const inputDuration = clip.type === 'image' ? clip.duration : clip.duration * clip.speed;
        const speedExpression = clip.type === 'image' ? '' : `/(${clip.speed})`;
        filters.push(
          `[${inputIndex}:v]trim=duration=${inputDuration},setpts=(PTS-STARTPTS)${speedExpression}+${clip.startTime}/TB,`
          + `fps=${validated.fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,`
          + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[clipv${visualCount}]`,
        );
        filters.push(
          `[base${visualCount}][clipv${visualCount}]overlay=eof_action=pass:shortest=0:`
          + `enable='between(t,${clip.startTime},${clip.startTime + clip.duration})'[base${visualCount + 1}]`,
        );
        visualCount += 1;
      }

      if (audioFlags[clipIndex]) {
        const audio = [
          `atrim=start=0:duration=${clip.duration * clip.speed}`,
          'asetpts=PTS-STARTPTS',
          ...atempoFilters(clip.speed),
          `volume=${clip.volume}`,
          `adelay=${Math.round(clip.startTime * 1000)}:all=1`,
        ];
        filters.push(`[${inputIndex}:a]${audio.join(',')}[clipa${audioLabels.length}]`);
        audioLabels.push(`[clipa${audioLabels.length}]`);
      }
    }
    filters.push(`[base${visualCount}]trim=duration=${validated.totalDuration},setpts=PTS-STARTPTS[outv]`);
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${validated.totalDuration}[silence]`);
    if (audioLabels.length > 0) {
      filters.push(
        `[silence]${audioLabels.join('')}amix=inputs=${audioLabels.length + 1}:duration=first:`
        + `dropout_transition=0,atrim=duration=${validated.totalDuration}[outa]`,
      );
    } else {
      filters.push('[silence]anull[outa]');
    }

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[outv]', '-map', '[outa]',
      '-r', String(validated.fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(preset.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', '-t', String(validated.totalDuration),
      outputPath,
    );
    return args;
  };

  const failRecord = async (record, error) => {
    if (record.cancelled) return;
    record.job = {
      ...record.job,
      status: 'failed',
      error: error instanceof Error ? error.message.slice(0, MAX_ERROR_LENGTH) : String(error).slice(0, MAX_ERROR_LENGTH),
      completedAt: new Date().toISOString(),
    };
    await fsp.rm(record.outputPath, { force: true }).catch(() => {});
  };

  const render = async (record, validated) => {
    if (record.cancelled) return;
    record.job = { ...record.job, status: 'rendering' };
    emitProgress(record);
    try {
      await fsp.mkdir(path.dirname(record.outputPath), { recursive: true });
      const audioFlags = [];
      for (const clip of validated.clips) audioFlags.push(await hasAudioStream(record, clip));
      const args = buildCommand(validated, audioFlags, record.outputPath);
      let progressBuffer = '';
      const result = await run(record, args, 'render', (chunk) => {
        progressBuffer = `${progressBuffer}${chunk}`.slice(-8_192);
        const progress = parseProgress(progressBuffer, validated.totalDuration);
        if (progress !== null && progress > record.job.progress) {
          record.job = { ...record.job, progress };
          emitProgress(record);
        }
      });
      if (record.cancelled) return;
      if (!result || result.code !== 0) {
        throw exportError(
          summarizeFailure(result?.stderr, `FFmpeg exited with code ${result?.code ?? 'unknown'}`),
          'EXPORT_FAILED',
          500,
        );
      }
      const stats = await fsp.stat(record.outputPath);
      if (!stats.isFile() || stats.size === 0) throw exportError('FFmpeg did not produce an export file.', 'EXPORT_FAILED', 500);
      const outputUrl = typeof options.mediaUrlForPath === 'function'
        ? await options.mediaUrlForPath(record.outputPath)
        : `/media/${path.relative(mediaRoot, record.outputPath).split(path.sep).map(encodeURIComponent).join('/')}`;
      if (typeof outputUrl !== 'string' || !outputUrl.startsWith('/media/')) {
        throw exportError('Export URL mapper returned an unsafe media URL.', 'INVALID_MEDIA_URL', 500);
      }
      record.job = {
        ...record.job,
        status: 'complete',
        progress: 100,
        outputUrl,
        fileSize: stats.size,
        completedAt: new Date().toISOString(),
      };
      emitProgress(record);
    } catch (error) {
      await failRecord(record, error);
    }
  };

  const start = async (params) => {
    const validated = await validateStart(params);
    const id = crypto.randomUUID();
    const outputPath = pathInside(projectsRoot, validated.projectId, 'exports', `${id}.mp4`);
    const record = {
      cancelled: false,
      controller: new AbortController(),
      outputPath,
      job: {
        id,
        status: 'queued',
        progress: 0,
        preset: validated.preset,
        fps: validated.fps,
        createdAt: new Date().toISOString(),
      },
    };
    jobs.set(id, record);
    const response = publicJob(record);
    queueMicrotask(() => void render(record, validated));
    return response;
  };

  const poll = async (idValue) => {
    const id = validateJobId(idValue);
    const record = jobs.get(id);
    if (!record) throw exportError('Export not found.', 'EXPORT_NOT_FOUND', 404);
    return publicJob(record);
  };

  const cancel = async (idValue) => {
    const id = validateJobId(idValue);
    const record = jobs.get(id);
    if (!record) throw exportError('Export not found.', 'EXPORT_NOT_FOUND', 404);
    if (record.job.status === 'queued' || record.job.status === 'rendering') {
      record.cancelled = true;
      record.controller.abort();
      record.job = {
        ...record.job,
        status: 'failed',
        error: 'Cancelled by user',
        completedAt: new Date().toISOString(),
      };
      await fsp.rm(record.outputPath, { force: true }).catch(() => {});
    }
    return { ok: true };
  };

  return { start, poll, cancel };
}
