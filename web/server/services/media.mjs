import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStaticPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

import {
  ServiceError,
  requireRecord,
  requireString,
  validatePublicUrl,
} from './_shared.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.aac', '.flac', '.ogg', '.m4a', '.aiff', '.aif']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp', '.avif']);
const JOB_TYPES = new Set([
  'extract_metadata',
  'generate_thumbnail',
  'compute_waveform',
  'generate_filmstrip',
  'generate_proxy',
]);
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/;
const MAX_DATA_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_WAVEFORM_PCM_BYTES = 512 * 1024 * 1024;

function mediaError(message, code = 'INVALID_MEDIA_REQUEST', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function requireId(value, label) {
  return requireString(value, label, { maxLength: 128, pattern: SAFE_ID });
}

function requireFiniteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw mediaError(`${label} must be a finite number between ${min} and ${max}.`);
  }
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
    throw mediaError('Media path escapes the configured data directory.', 'INVALID_MEDIA_PATH');
  }
  return candidate;
}

function cleanFileName(value) {
  const base = path.basename(String(value || 'media.bin')).normalize('NFKC');
  const cleaned = base
    .replace(/[^A-Za-z0-9._() -]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return cleaned || 'media.bin';
}

function detectAssetType(filePath, fallback = 'image') {
  const extension = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return fallback;
}

function normalizeExtension(value, assetType, source) {
  let extension = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
  if (extension && !extension.startsWith('.')) extension = `.${extension}`;
  if (extension && !/^\.[a-z0-9]{1,10}$/.test(extension)) {
    throw mediaError('Generated asset extension has an invalid format.', 'INVALID_EXTENSION');
  }

  if (!extension && source) {
    try {
      extension = path.extname(new URL(source, 'https://cinegen.invalid').pathname).toLowerCase();
    } catch {
      extension = path.extname(source).toLowerCase();
    }
    if (!/^\.[a-z0-9]{1,10}$/.test(extension)) extension = '';
  }

  const allowed = assetType === 'video'
    ? VIDEO_EXTENSIONS
    : assetType === 'audio'
      ? AUDIO_EXTENSIONS
      : IMAGE_EXTENSIONS;
  if (extension === '.jpeg') extension = '.jpg';
  if (!allowed.has(extension)) {
    return assetType === 'video' ? '.mp4' : assetType === 'audio' ? '.mp3' : '.jpg';
  }
  return extension;
}

function parseFrameRate(value) {
  if (typeof value !== 'string' || !value) return 0;
  const [numerator, denominator] = value.split('/').map(Number);
  const result = denominator === undefined ? numerator : denominator === 0 ? 0 : numerator / denominator;
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0;
}

function parseImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), codec: 'png' };
  }
  if (buffer.length >= 10 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), codec: 'gif' };
  }
  if (buffer.length >= 26 && buffer.subarray(0, 2).toString('ascii') === 'BM') {
    return {
      width: Math.abs(buffer.readInt32LE(18)),
      height: Math.abs(buffer.readInt32LE(22)),
      codec: 'bmp',
    };
  }
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = buffer.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        codec: 'webp',
      };
    }
    if (kind === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
        codec: 'webp',
      };
    }
    if (kind === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        codec: 'webp',
      };
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > buffer.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          codec: 'mjpeg',
        };
      }
      offset += 2 + size;
    }
  }
  return null;
}

async function readImageMetadata(inputPath) {
  const handle = await fsp.open(inputPath, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return parseImageDimensions(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function summarizeProcessError(stderr, fallback) {
  const compact = String(stderr || '').trim().split('\n').slice(-8).join('\n');
  return compact ? `${fallback}: ${compact.slice(0, 2_000)}` : fallback;
}

/**
 * Build the browser media implementation.
 *
 * Context contract:
 * - `dataRoot`: absolute server data directory. All readable/writable media must
 *   live below `<dataRoot>/media`.
 * - `store.load(projectId)`: resolves when a project exists (optional only for
 *   isolated tests; production should provide it).
 * - `events.emit(name, payload)`: publishes SSE events.
 * - `pathForMediaReference(reference)`: maps a trusted `/media/...` browser
 *   reference to a filesystem path. Its result is rechecked against dataRoot.
 * - `mediaUrlForPath(filePath)`: maps a file below dataRoot/media back to a
 *   browser URL, normally `/media/...`.
 */
export function createMediaHandlers(context) {
  const options = requireRecord(context, 'Media service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'Media data root', { maxLength: 16_384 }));
  const mediaRoot = pathInside(dataRoot, 'media');
  const uploadsRoot = pathInside(mediaRoot, 'uploads');
  const projectsMediaRoot = pathInside(mediaRoot, 'projects');
  const temporaryRoot = pathInside(mediaRoot, 'temp');
  const store = options.store;
  const events = options.events;
  const ffmpegPath = options.ffmpegPath || ffmpegStaticPath;
  const ffprobePath = options.ffprobePath || ffprobeStatic?.path;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxDownloadBytes = Number.isFinite(options.maxDownloadBytes)
    ? Math.max(1, Number(options.maxDownloadBytes))
    : DEFAULT_MAX_DOWNLOAD_BYTES;
  const processTimeoutMs = Number.isFinite(options.processTimeoutMs)
    ? Math.max(1_000, Number(options.processTimeoutMs))
    : DEFAULT_PROCESS_TIMEOUT_MS;
  const maxConcurrentJobs = Number.isInteger(options.maxConcurrentJobs)
    ? Math.max(1, Math.min(8, options.maxConcurrentJobs))
    : 3;

  const queuedJobs = [];
  const jobs = new Map();
  let activeJobCount = 0;

  const emit = (name, payload) => {
    if (events && typeof events.emit === 'function') events.emit(name, payload);
  };

  const defaultPathForReference = (reference) => {
    let pathname = reference;
    try {
      if (/^https?:\/\//i.test(reference)) pathname = new URL(reference).pathname;
      pathname = decodeURIComponent(pathname);
    } catch (cause) {
      throw mediaError('Media reference is malformed.', 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (!pathname.startsWith('/media/')) {
      throw mediaError('Only uploaded web media references can be used.', 'INVALID_MEDIA_PATH');
    }
    return pathInside(mediaRoot, pathname.slice('/media/'.length));
  };

  const resolveMediaReference = async (value, label = 'Media reference') => {
    const reference = requireString(value, label, { maxLength: 16_384 });
    let resolved;
    if (path.isAbsolute(reference) && isPathInside(mediaRoot, reference)) {
      resolved = reference;
    } else if (typeof options.pathForMediaReference === 'function') {
      try {
        resolved = await options.pathForMediaReference(reference);
      } catch (cause) {
        if (cause instanceof ServiceError) throw cause;
        throw mediaError(`${label} is malformed or unavailable.`, 'INVALID_MEDIA_PATH', 400, cause);
      }
    } else {
      resolved = defaultPathForReference(reference);
    }
    if (typeof resolved !== 'string' || !resolved || !isPathInside(mediaRoot, resolved)) {
      throw mediaError(`${label} is outside the web media directory.`, 'INVALID_MEDIA_PATH');
    }
    return path.resolve(resolved);
  };

  const urlForMediaPath = async (filePath) => {
    const resolved = path.resolve(filePath);
    if (!isPathInside(mediaRoot, resolved)) {
      throw mediaError('Attempted to expose a file outside the web media directory.', 'INVALID_MEDIA_PATH');
    }
    if (typeof options.mediaUrlForPath === 'function') {
      const result = await options.mediaUrlForPath(resolved);
      if (typeof result !== 'string' || !result.trim()) {
        throw mediaError('mediaUrlForPath returned an invalid media URL.', 'INVALID_MEDIA_URL', 500);
      }
      return result;
    }
    const relative = path.relative(mediaRoot, resolved).split(path.sep).map(encodeURIComponent).join('/');
    return `/media/${relative}`;
  };

  const ensureProject = async (projectIdValue) => {
    const projectId = requireId(projectIdValue, 'Project id');
    if (store && typeof store.load === 'function') await store.load(projectId);
    return projectId;
  };

  const projectMediaDir = (projectId) => pathInside(projectsMediaRoot, projectId);

  const assertReadableFile = async (filePath, label = 'Media file') => {
    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch (cause) {
      if (cause?.code === 'ENOENT') {
        throw mediaError(`${label} was not found.`, 'MEDIA_NOT_FOUND', 404, cause);
      }
      throw cause;
    }
    if (!stats.isFile()) throw mediaError(`${label} must reference a file.`, 'INVALID_MEDIA_PATH');
    return stats;
  };

  const runProcess = (jobId, executable, args, {
    timeoutMs = processTimeoutMs,
    onStderr,
    maxStdoutBytes = MAX_PROCESS_OUTPUT_BYTES,
  } = {}) => {
    if (!executable) {
      throw mediaError('FFmpeg is not installed on this web server.', 'MEDIA_PROCESSOR_UNAVAILABLE', 501);
    }
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const record = jobs.get(jobId);
      if (record) record.child = child;
      const stdoutChunks = [];
      let stdoutBytes = 0;
      let stdoutTruncated = false;
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeoutMs);
      timer.unref?.();

      child.stdout?.on('data', (chunk) => {
        if (stdoutBytes >= maxStdoutBytes) {
          stdoutTruncated = true;
          return;
        }
        const remaining = maxStdoutBytes - stdoutBytes;
        const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stdoutChunks.push(kept);
        stdoutBytes += kept.length;
        if (kept.length !== chunk.length) stdoutTruncated = true;
      });
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        if (stderr.length < MAX_PROCESS_OUTPUT_BYTES) stderr += text.slice(0, MAX_PROCESS_OUTPUT_BYTES - stderr.length);
        onStderr?.(text);
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
        const current = jobs.get(jobId);
        if (current?.cancelled) {
          reject(mediaError('Media job was cancelled.', 'JOB_CANCELLED', 409));
          return;
        }
        if (signal === 'SIGKILL') {
          reject(mediaError('Media processing timed out.', 'MEDIA_PROCESS_TIMEOUT', 504));
          return;
        }
        resolve({ code, stdout: Buffer.concat(stdoutChunks), stdoutTruncated, stderr });
      });
    });
  };

  const probe = async (jobId, inputPath) => {
    const result = await runProcess(jobId, ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ], { timeoutMs: Math.min(processTimeoutMs, 60_000) });
    if (result.code !== 0) throw new Error(summarizeProcessError(result.stderr, `ffprobe exited with code ${result.code}`));
    try {
      return JSON.parse(result.stdout.toString('utf8'));
    } catch (cause) {
      throw new Error('ffprobe returned invalid metadata.', { cause });
    }
  };

  const outputPathForJob = (job) => {
    const cacheRoot = pathInside(projectMediaDir(job.projectId), 'cache');
    switch (job.type) {
      case 'generate_thumbnail': {
        const extension = detectAssetType(job.inputPath) === 'image'
          ? normalizeExtension(path.extname(job.inputPath), 'image', job.inputPath)
          : '.jpg';
        return pathInside(cacheRoot, 'thumbnails', `${job.assetId}${extension}`);
      }
      case 'compute_waveform':
        return pathInside(cacheRoot, 'waveforms', `${job.assetId}.json`);
      case 'generate_filmstrip':
        return pathInside(cacheRoot, 'filmstrips', `${job.assetId}.jpg`);
      case 'generate_proxy':
        return pathInside(cacheRoot, 'proxies', `${job.assetId}.mp4`);
      default:
        return '';
    }
  };

  const extractMetadata = async (job) => {
    const stats = await assertReadableFile(job.inputPath);
    if (detectAssetType(job.inputPath) === 'image') {
      const image = await readImageMetadata(job.inputPath);
      if (image) {
        return {
          duration: 0,
          width: image.width,
          height: image.height,
          fps: 0,
          codec: image.codec,
          fileSize: stats.size,
          bitrate: 0,
          audioChannels: 0,
          audioCodec: '',
        };
      }
    }
    const parsed = await probe(job.id, job.inputPath);
    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    return {
      duration: Number.parseFloat(parsed.format?.duration || '0') || 0,
      width: Number(videoStream?.width) || 0,
      height: Number(videoStream?.height) || 0,
      fps: parseFrameRate(videoStream?.r_frame_rate || videoStream?.avg_frame_rate),
      codec: typeof videoStream?.codec_name === 'string' ? videoStream.codec_name : '',
      fileSize: Number.parseInt(parsed.format?.size || `${stats.size}`, 10) || stats.size,
      bitrate: Number.parseInt(parsed.format?.bit_rate || '0', 10) || 0,
      audioChannels: Number(audioStream?.channels) || 0,
      audioCodec: typeof audioStream?.codec_name === 'string' ? audioStream.codec_name : '',
    };
  };

  const generateThumbnail = async (job) => {
    const outputPath = outputPathForJob(job);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    if (detectAssetType(job.inputPath) === 'image') {
      if (path.resolve(job.inputPath) !== path.resolve(outputPath)) await fsp.copyFile(job.inputPath, outputPath);
      return { outputPath: await urlForMediaPath(outputPath) };
    }
    let duration = 0;
    try {
      const parsed = await probe(job.id, job.inputPath);
      duration = Number.parseFloat(parsed.format?.duration || '0') || 0;
    } catch {
      // A quick early frame remains useful when probing malformed metadata fails.
    }
    const result = await runProcess(job.id, ffmpegPath, [
      '-y', '-threads', '1',
      '-ss', `${duration > 0 ? duration * 0.5 : 0.1}`,
      '-i', job.inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ], { timeoutMs: Math.min(processTimeoutMs, 120_000) });
    if (result.code !== 0) {
      await fsp.rm(outputPath, { force: true }).catch(() => {});
      throw new Error(summarizeProcessError(result.stderr, `ffmpeg thumbnail exited with code ${result.code}`));
    }
    return { outputPath: await urlForMediaPath(outputPath) };
  };

  const computeWaveform = async (job) => {
    const outputPath = outputPathForJob(job);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    const result = await runProcess(job.id, ffmpegPath, [
      '-threads', '1',
      '-i', job.inputPath,
      '-vn', '-f', 'f32le', '-ac', '1', '-ar', '8000',
      'pipe:1',
    ], { maxStdoutBytes: MAX_WAVEFORM_PCM_BYTES });
    if (result.code !== 0) throw new Error(summarizeProcessError(result.stderr, `ffmpeg waveform exited with code ${result.code}`));
    if (result.stdoutTruncated) throw new Error('Audio is too long to compute a waveform safely on this server.');
    const sampleCount = Math.floor(result.stdout.length / 4);
    const target = Math.max(2_000, Math.min(100_000, Math.round((sampleCount / 8_000) * 500)));
    const samplesPerPeak = Math.max(1, Math.ceil(sampleCount / target));
    const raw = [];
    for (let offset = 0; offset < sampleCount; offset += samplesPerPeak) {
      let peak = 0;
      const end = Math.min(sampleCount, offset + samplesPerPeak);
      for (let sample = offset; sample < end; sample += 1) {
        const value = Math.abs(result.stdout.readFloatLE(sample * 4));
        if (Number.isFinite(value) && value > peak) peak = value;
      }
      raw.push(peak);
    }
    const maximum = raw.reduce((current, value) => Math.max(current, value), 0.01);
    const peaks = raw.map((value) => Math.round((value / maximum) * 1_000) / 1_000);
    await fsp.writeFile(outputPath, JSON.stringify(peaks));
    let summary = peaks;
    if (summary.length > 4_096) {
      const bucketSize = summary.length / 4_096;
      summary = Array.from({ length: 4_096 }, (_, index) => {
        const start = Math.floor(index * bucketSize);
        const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
        let maximumValue = 0;
        for (let cursor = start; cursor < Math.min(end, peaks.length); cursor += 1) maximumValue = Math.max(maximumValue, peaks[cursor]);
        return maximumValue;
      });
    }
    return { peaks: summary, peaksPath: await urlForMediaPath(outputPath) };
  };

  const generateFilmstrip = async (job) => {
    const outputPath = outputPathForJob(job);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    const parsed = await probe(job.id, job.inputPath);
    const duration = Number.parseFloat(parsed.format?.duration || '0') || 0;
    if (duration <= 0) throw new Error('Cannot generate a filmstrip for media with no duration.');
    const frameCount = Math.min(120, Math.max(1, Math.ceil(duration)));
    const interval = Math.max(0.01, duration / frameCount);
    const result = await runProcess(job.id, ffmpegPath, [
      '-y', '-threads', '1', '-i', job.inputPath,
      '-vf', `fps=1/${interval},scale=160:-2,tile=${frameCount}x1`,
      '-frames:v', '1', outputPath,
    ]);
    if (result.code !== 0) {
      await fsp.rm(outputPath, { force: true }).catch(() => {});
      throw new Error(summarizeProcessError(result.stderr, `ffmpeg filmstrip exited with code ${result.code}`));
    }
    return { outputPath: await urlForMediaPath(outputPath) };
  };

  const generateProxy = async (job) => {
    const outputPath = outputPathForJob(job);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    let duration = 0;
    try {
      const parsed = await probe(job.id, job.inputPath);
      duration = Number.parseFloat(parsed.format?.duration || '0') || 0;
    } catch {
      // Continue without percentage progress.
    }
    let lastProgress = -1;
    const result = await runProcess(job.id, ffmpegPath, [
      '-y', '-threads', '2', '-i', job.inputPath,
      '-vf', "scale='trunc(min(960,iw)/2)*2':-2",
      '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', outputPath,
    ], {
      onStderr(text) {
        if (duration <= 0) return;
        const match = /time=(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(text);
        if (!match) return;
        const elapsed = Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
        const progress = Math.max(0, Math.min(99, Math.round((elapsed / duration) * 100)));
        if (progress !== lastProgress) {
          lastProgress = progress;
          emit('media:job-progress', { jobId: job.id, progress });
        }
      },
    });
    if (result.code !== 0) {
      await fsp.rm(outputPath, { force: true }).catch(() => {});
      throw new Error(summarizeProcessError(result.stderr, `ffmpeg proxy exited with code ${result.code}`));
    }
    emit('media:job-progress', { jobId: job.id, progress: 100 });
    return { outputPath: await urlForMediaPath(outputPath) };
  };

  const executeJob = async (job) => {
    switch (job.type) {
      case 'extract_metadata': return extractMetadata(job);
      case 'generate_thumbnail': return generateThumbnail(job);
      case 'compute_waveform': return computeWaveform(job);
      case 'generate_filmstrip': return generateFilmstrip(job);
      case 'generate_proxy': return generateProxy(job);
      default: throw mediaError(`Unsupported web media job: ${job.type}`, 'UNSUPPORTED_MEDIA_JOB', 501);
    }
  };

  const pumpJobs = () => {
    while (activeJobCount < maxConcurrentJobs && queuedJobs.length > 0) {
      const record = queuedJobs.shift();
      if (!record || record.cancelled) continue;
      activeJobCount += 1;
      record.state = 'active';
      void executeJob(record.job).then((result) => {
        if (record.cancelled) {
          record.reject(mediaError('Media job was cancelled.', 'JOB_CANCELLED', 409));
          return;
        }
        emit('media:job-complete', {
          jobId: record.job.id,
          result,
          assetId: record.job.assetId,
          jobType: record.job.type,
        });
        record.resolve(result);
      }).catch((cause) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        emit('media:job-error', {
          jobId: record.job.id,
          error: error.message,
          assetId: record.job.assetId,
          jobType: record.job.type,
        });
        record.reject(error);
      }).finally(() => {
        jobs.delete(record.job.id);
        activeJobCount -= 1;
        pumpJobs();
      });
    }
  };

  const normalizeJob = async (jobValue) => {
    const value = requireRecord(jobValue, 'Media job');
    const id = requireId(value.id, 'Media job id');
    const type = requireString(value.type, 'Media job type', { maxLength: 64 });
    if (!JOB_TYPES.has(type)) throw mediaError(`Unsupported web media job: ${type}`, 'UNSUPPORTED_MEDIA_JOB', 501);
    const assetId = requireId(value.assetId, 'Asset id');
    const inputPath = await resolveMediaReference(value.inputPath, 'Media job input');
    await assertReadableFile(inputPath, 'Media job input');
    let projectId = value.projectId;
    if (!projectId) {
      const relative = path.relative(projectsMediaRoot, inputPath).split(path.sep);
      if (relative.length >= 2 && relative[0] && relative[0] !== '..') projectId = relative[0];
    }
    projectId = await ensureProject(projectId);
    const allowedProjectRoot = projectMediaDir(projectId);
    if (!isPathInside(allowedProjectRoot, inputPath) && !isPathInside(uploadsRoot, inputPath)) {
      throw mediaError('Media job input belongs to a different project.', 'INVALID_MEDIA_PATH', 403);
    }
    return { id, type, assetId, projectId, inputPath };
  };

  const submitNormalizedJob = (job) => {
    if (jobs.has(job.id)) throw mediaError(`Media job already exists: ${job.id}`, 'DUPLICATE_JOB', 409);
    return new Promise((resolve, reject) => {
      const record = { job, resolve, reject, state: 'queued', child: null, cancelled: false };
      jobs.set(job.id, record);
      queuedJobs.push(record);
      pumpJobs();
    });
  };

  const submitJob = async (jobValue) => submitNormalizedJob(await normalizeJob(jobValue));

  const submitDerivedJob = (job) => {
    const promise = submitNormalizedJob(job);
    promise.catch(() => {});
    return promise;
  };

  const queueDerivationPipeline = (params) => {
    const metadataJobId = params.metadataJobId || crypto.randomUUID();
    submitDerivedJob({
      id: metadataJobId,
      type: 'extract_metadata',
      assetId: params.assetId,
      projectId: params.projectId,
      inputPath: params.inputPath,
    });
    if (params.type !== 'audio') {
      submitDerivedJob({
        id: crypto.randomUUID(), type: 'generate_thumbnail', assetId: params.assetId,
        projectId: params.projectId, inputPath: params.inputPath,
      });
    }
    if (params.type === 'audio' || params.type === 'video') {
      submitDerivedJob({
        id: crypto.randomUUID(), type: 'compute_waveform', assetId: params.assetId,
        projectId: params.projectId, inputPath: params.inputPath,
      });
    }
    if (params.type === 'video') {
      submitDerivedJob({
        id: crypto.randomUUID(), type: 'generate_filmstrip', assetId: params.assetId,
        projectId: params.projectId, inputPath: params.inputPath,
      });
      submitDerivedJob({
        id: crypto.randomUUID(), type: 'generate_proxy', assetId: params.assetId,
        projectId: params.projectId, inputPath: params.inputPath,
      });
    }
    return metadataJobId;
  };

  const importMedia = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Media import parameters');
    const projectId = await ensureProject(params.projectId);
    if (!Array.isArray(params.filePaths) || params.filePaths.length === 0 || params.filePaths.length > 100) {
      throw mediaError('Media import requires between 1 and 100 uploaded files.');
    }
    if (params.mode !== 'link' && params.mode !== 'copy') {
      throw mediaError('Media import mode must be link or copy.');
    }
    const results = [];
    const pipelines = [];
    for (const reference of params.filePaths) {
      const stagedPath = await resolveMediaReference(reference, 'Uploaded media reference');
      if (!isPathInside(uploadsRoot, stagedPath)) {
        throw mediaError('Web imports must use a staged /media/uploads/... file.', 'INVALID_MEDIA_PATH');
      }
      await assertReadableFile(stagedPath, 'Uploaded media file');
      const assetId = crypto.randomUUID();
      const originalName = cleanFileName(path.basename(stagedPath));
      const destination = pathInside(projectMediaDir(projectId), 'imported', assetId, originalName);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(stagedPath, destination);
      const type = detectAssetType(destination);
      const metadataJobId = crypto.randomUUID();
      const filePath = await urlForMediaPath(destination);
      results.push({ assetId, jobId: metadataJobId, filePath, type });
      pipelines.push({ assetId, metadataJobId, projectId, inputPath: destination, type });
    }

    setTimeout(() => {
      for (const pipeline of pipelines) queueDerivationPipeline(pipeline);
    }, 0).unref?.();
    return results;
  };

  const cancelJob = async (jobIdValue) => {
    const jobId = requireId(jobIdValue, 'Media job id');
    const record = jobs.get(jobId);
    if (!record) return { ok: true };
    record.cancelled = true;
    if (record.state === 'queued') {
      const index = queuedJobs.indexOf(record);
      if (index >= 0) queuedJobs.splice(index, 1);
      jobs.delete(jobId);
      record.reject(mediaError('Media job was cancelled.', 'JOB_CANCELLED', 409));
    } else {
      record.child?.kill('SIGTERM');
    }
    return { ok: true };
  };

  const queueProcessing = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Media processing parameters');
    const projectId = await ensureProject(params.projectId);
    const assetId = requireId(params.assetId, 'Asset id');
    const inputPath = await resolveMediaReference(params.inputPath, 'Media processing input');
    await assertReadableFile(inputPath, 'Media processing input');
    if (!isPathInside(projectMediaDir(projectId), inputPath)) {
      throw mediaError('Media processing input belongs to a different project.', 'INVALID_MEDIA_PATH', 403);
    }
    const jobTypes = [];
    if (params.includeThumbnail === true) jobTypes.push('generate_thumbnail');
    if (params.includeWaveform !== false) jobTypes.push('compute_waveform');
    if (params.includeFilmstrip !== false) jobTypes.push('generate_filmstrip');
    if (params.needsProxy === true) jobTypes.push('generate_proxy');
    for (const type of jobTypes) {
      submitDerivedJob({ id: crypto.randomUUID(), type, assetId, projectId, inputPath });
    }
    return { ok: true };
  };

  const extractFrame = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Frame extraction parameters');
    const inputPath = await resolveMediaReference(params.inputPath, 'Frame extraction input');
    await assertReadableFile(inputPath, 'Frame extraction input');
    const timeSec = requireFiniteNumber(params.timeSec, 'Frame time', { min: 0, max: 24 * 60 * 60 });
    await fsp.mkdir(temporaryRoot, { recursive: true });
    const outputPath = pathInside(temporaryRoot, `frame-${crypto.randomUUID()}.jpg`);
    const processId = `frame-${crypto.randomUUID()}`;
    const result = await runProcess(processId, ffmpegPath, [
      '-y', '-ss', `${timeSec}`, '-i', inputPath, '-frames:v', '1', '-q:v', '2', outputPath,
    ], { timeoutMs: 30_000 });
    if (result.code !== 0) {
      await fsp.rm(outputPath, { force: true }).catch(() => {});
      return null;
    }
    return { outputPath: await urlForMediaPath(outputPath) };
  };

  const writeTempImage = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Temporary image parameters');
    const dataUrl = requireString(params.dataUrl, 'Image data URL', { maxLength: Math.ceil(MAX_DATA_IMAGE_BYTES * 1.5) });
    const match = DATA_URL_PATTERN.exec(dataUrl);
    if (!match) throw mediaError('media.writeTempImage expects a base64 image data URL.', 'INVALID_IMAGE_DATA');
    const compact = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(compact, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_DATA_IMAGE_BYTES) {
      throw mediaError('Temporary image is empty or too large.', 'IMAGE_TOO_LARGE', 413);
    }
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    await fsp.mkdir(temporaryRoot, { recursive: true });
    const outputPath = pathInside(temporaryRoot, `frame-chat-${crypto.randomUUID()}.${extension}`);
    await fsp.writeFile(outputPath, buffer, { flag: 'wx' });
    return { outputPath: await urlForMediaPath(outputPath) };
  };

  const extractClip = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Clip extraction parameters');
    const inputPath = await resolveMediaReference(params.inputPath, 'Clip extraction input');
    await assertReadableFile(inputPath, 'Clip extraction input');
    const startTimeSec = requireFiniteNumber(params.startTimeSec, 'Clip start time', { min: 0, max: 24 * 60 * 60 });
    const durationSec = requireFiniteNumber(params.durationSec, 'Clip duration', { min: 0.1, max: 6 * 60 * 60 });
    await fsp.mkdir(temporaryRoot, { recursive: true });
    const outputPath = pathInside(temporaryRoot, `clip-${crypto.randomUUID()}.mp4`);
    const processId = `clip-${crypto.randomUUID()}`;
    const result = await runProcess(processId, ffmpegPath, [
      '-y', '-ss', `${startTimeSec}`, '-i', inputPath, '-t', `${durationSec}`,
      '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
    ], { timeoutMs: Math.max(120_000, Math.ceil(durationSec * 4_000)) });
    if (result.code !== 0) {
      await fsp.rm(outputPath, { force: true }).catch(() => {});
      return null;
    }
    return { outputPath: await urlForMediaPath(outputPath) };
  };

  const findExistingGeneratedAsset = async (directory, assetId) => {
    try {
      const entries = await fsp.readdir(directory, { withFileTypes: true });
      const found = entries.find((entry) => entry.isFile() && (entry.name === assetId || entry.name.startsWith(`${assetId}.`)));
      return found ? pathInside(directory, found.name) : null;
    } catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw cause;
    }
  };

  const fetchRemote = async (urlValue, destination) => {
    if (typeof fetchImpl !== 'function') throw mediaError('Remote downloads are unavailable.', 'DOWNLOAD_UNAVAILABLE', 501);
    let current = validatePublicUrl(urlValue, 'Remote media URL', { allowHttp: options.allowHttpRemote === true });
    let response;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      timer.unref?.();
      try {
        response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'video/*,audio/*,image/*,application/octet-stream;q=0.5' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers?.get?.('location');
      if (!location || redirects === 5) throw mediaError('Remote media redirected too many times.', 'DOWNLOAD_REDIRECT', 502);
      current = validatePublicUrl(new URL(location, current).href, 'Remote media redirect', {
        allowHttp: options.allowHttpRemote === true,
      });
    }
    if (!response?.ok) {
      throw mediaError(`Failed to download remote media (HTTP ${response?.status || 502}).`, 'DOWNLOAD_FAILED', 502);
    }
    const declaredSize = Number(response.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declaredSize) && declaredSize > maxDownloadBytes) {
      throw mediaError('Remote media exceeds the configured download limit.', 'DOWNLOAD_TOO_LARGE', 413);
    }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${crypto.randomUUID()}.download`;
    const handle = await fsp.open(temporary, 'wx');
    let written = 0;
    try {
      if (!response.body) throw mediaError('Remote media response was empty.', 'DOWNLOAD_FAILED', 502);
      for await (const value of response.body) {
        const chunk = Buffer.from(value);
        written += chunk.length;
        if (written > maxDownloadBytes) {
          throw mediaError('Remote media exceeds the configured download limit.', 'DOWNLOAD_TOO_LARGE', 413);
        }
        await handle.write(chunk);
      }
      if (written === 0) throw mediaError('Remote media response was empty.', 'DOWNLOAD_FAILED', 502);
      await handle.close();
      await fsp.rename(temporary, destination);
    } catch (cause) {
      await handle.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw cause;
    }
  };

  const persistGeneratedAssetInternal = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Generated asset parameters');
    const projectId = await ensureProject(params.projectId);
    const assetId = requireId(params.assetId, 'Asset id');
    if (!['video', 'audio', 'image'].includes(params.assetType)) {
      throw mediaError('Generated asset type must be video, audio, or image.');
    }
    const generatedDir = pathInside(projectMediaDir(projectId), 'generated');
    await fsp.mkdir(generatedDir, { recursive: true });
    const existing = await findExistingGeneratedAsset(generatedDir, assetId);
    if (existing) {
      const type = detectAssetType(existing, params.assetType);
      queueDerivationPipeline({ assetId, projectId, inputPath: existing, type });
      return {
        path: await urlForMediaPath(existing),
        ...(typeof params.remoteUrl === 'string' && params.remoteUrl.trim() ? { sourceUrl: params.remoteUrl.trim() } : {}),
        downloaded: false,
      };
    }

    let localSource = null;
    if (typeof params.localPathHint === 'string' && params.localPathHint.trim()) {
      localSource = await resolveMediaReference(params.localPathHint, 'Generated asset local source');
      await assertReadableFile(localSource, 'Generated asset local source');
      if (!isPathInside(uploadsRoot, localSource) && !isPathInside(projectMediaDir(projectId), localSource)) {
        throw mediaError('Generated asset source belongs to a different project.', 'INVALID_MEDIA_PATH', 403);
      }
    }
    const remoteUrl = typeof params.remoteUrl === 'string' ? params.remoteUrl.trim() : '';
    if (!localSource && remoteUrl) {
      let remotePathname = '';
      try {
        remotePathname = new URL(remoteUrl, 'http://cinegen.local').pathname;
      } catch {
        // A non-URL value is rejected by fetchRemote below.
      }
      if (remotePathname.startsWith('/media/')) {
        localSource = await resolveMediaReference(remoteUrl, 'Generated asset web source');
        await assertReadableFile(localSource, 'Generated asset web source');
        if (!isPathInside(projectMediaDir(projectId), localSource) && !isPathInside(uploadsRoot, localSource)) {
          throw mediaError('Generated asset source belongs to a different project.', 'INVALID_MEDIA_PATH', 403);
        }
      }
    }
    if (!localSource && !remoteUrl) {
      throw mediaError('No downloadable URL or uploaded file reference was provided.', 'MEDIA_SOURCE_REQUIRED', 422);
    }
    const extension = normalizeExtension(params.extension, params.assetType, remoteUrl || localSource);
    const destination = pathInside(generatedDir, `${assetId}${extension}`);
    if (localSource) {
      if (path.resolve(localSource) !== path.resolve(destination)) await fsp.copyFile(localSource, destination);
    } else {
      await fetchRemote(remoteUrl, destination);
    }
    const type = detectAssetType(destination, params.assetType);
    queueDerivationPipeline({ assetId, projectId, inputPath: destination, type });
    return {
      path: await urlForMediaPath(destination),
      ...(remoteUrl ? { sourceUrl: remoteUrl } : {}),
      downloaded: !localSource,
    };
  };

  const persistGeneratedAsset = async (params) => {
    try {
      return await persistGeneratedAssetInternal(params);
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  };

  const downloadRemote = async (paramsValue) => {
    const params = requireRecord(paramsValue, 'Remote download parameters');
    const result = await persistGeneratedAssetInternal({
      projectId: params.projectId,
      assetId: params.assetId,
      assetType: params.assetType || 'video',
      remoteUrl: params.url,
      extension: params.ext,
    });
    return { path: result.path };
  };

  return {
    import: importMedia,
    queueProcessing,
    submitJob,
    cancelJob,
    extractFrame,
    writeTempImage,
    extractClip,
    downloadRemote,
    persistGeneratedAsset,
  };
}
