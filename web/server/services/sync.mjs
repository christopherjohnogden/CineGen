import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpegStaticPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

import { ServiceError, requireRecord, requireString } from './_shared.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FPCALC_PATH = path.resolve(MODULE_DIR, '../../../vendor/fpcalc/fpcalc');
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FP_INDEX_TO_SECONDS = 0.1238;
const PCM_SAMPLE_RATE = 8_000;
const MIN_MATCH_CONFIDENCE = 0.4;
const FAST_ACCEPT_CONFIDENCE = 0.55;
const DEFAULT_MAX_FINGERPRINT_SECONDS = 300;
const DEFAULT_MAX_PCM_SECONDS = 120;
const DEFAULT_PROCESS_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_ASSETS_PER_KIND = 200;
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;

function syncError(message, code = 'INVALID_SYNC_REQUEST', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathInside(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (!isPathInside(root, candidate)) {
    throw syncError('Sync path escapes the web media directory.', 'INVALID_MEDIA_PATH');
  }
  return candidate;
}

function requireId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw syncError(`${label} has an invalid format.`, 'INVALID_ID');
  }
  return value;
}

function parseTimecode(value, fps) {
  if (typeof value !== 'string' || !Number.isFinite(fps) || fps <= 0) return null;
  const match = /^(\d{2}):(\d{2}):(\d{2})([;:])(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[5]);
  if (minutes > 59 || seconds > 59 || frames >= Math.ceil(fps)) return null;
  if (match[4] === ';') {
    const roundedFps = Math.round(fps);
    const droppedFrames = Math.round(fps * 0.066666);
    const totalMinutes = hours * 60 + minutes;
    return roundedFps * 3600 * hours
      + roundedFps * 60 * minutes
      + roundedFps * seconds
      + frames
      - droppedFrames * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * fps) + frames;
}

function computeTimecodeOffset(sourceTimecode, targetTimecode, fps) {
  const sourceFrames = parseTimecode(sourceTimecode, fps);
  const targetFrames = parseTimecode(targetTimecode, fps);
  if (sourceFrames === null || targetFrames === null) return null;
  return (targetFrames - sourceFrames) / fps;
}

function popcount32(value) {
  let number = value >>> 0;
  number -= (number >>> 1) & 0x55555555;
  number = (number & 0x33333333) + ((number >>> 2) & 0x33333333);
  return (((number + (number >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function crossCorrelateFingerprints(source, target, maxOffsetSeconds = 120) {
  const maxShift = Math.min(
    Math.ceil(maxOffsetSeconds / FP_INDEX_TO_SECONDS),
    Math.max(source.length, target.length) - 1,
  );
  let bestOffset = 0;
  let bestScore = -1;
  let bestOverlap = 0;
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    let bitErrors = 0;
    let overlap = 0;
    for (let index = 0; index < source.length; index += 1) {
      const targetIndex = index + shift;
      if (targetIndex < 0 || targetIndex >= target.length) continue;
      bitErrors += popcount32((source[index] ^ target[targetIndex]) >>> 0);
      overlap += 1;
    }
    if (overlap < Math.min(8, source.length, target.length)) continue;
    const rawScore = 1 - bitErrors / (overlap * 32);
    // Tiny edge overlaps can otherwise beat a strong, long correlation.
    const coverage = overlap / Math.max(1, Math.min(source.length, target.length));
    const score = rawScore * (0.8 + 0.2 * coverage);
    if (score > bestScore || (score === bestScore && overlap > bestOverlap)) {
      bestScore = score;
      bestOffset = shift;
      bestOverlap = overlap;
    }
  }
  return {
    // `shift` is the target index relative to the source index. Renderer
    // semantics are the opposite: positive means the target recording starts
    // later on the source timeline.
    offsetSeconds: -bestOffset * FP_INDEX_TO_SECONDS,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}

function stem(value) {
  const name = path.basename(value);
  const extension = path.extname(name);
  if (!extension && name.startsWith('.')) return '';
  return path.basename(name, extension).toLowerCase();
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1]
        : 1 + Math.min(previous[rightIndex], current[rightIndex - 1], previous[rightIndex - 1]);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function scoreFilenameSimilarity(left, right) {
  const leftStem = stem(left);
  const rightStem = stem(right);
  const length = Math.max(leftStem.length, rightStem.length);
  return length === 0 ? 1 : 1 - levenshteinDistance(leftStem, rightStem) / length;
}

function defaultProcessRunner({ executable, args, signal, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    let forceKillTimer;
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    timeout.unref?.();

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
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
    child.stdout?.on('data', (chunk) => {
      if (stdoutBytes >= MAX_PROCESS_OUTPUT_BYTES) return;
      const remaining = MAX_PROCESS_OUTPUT_BYTES - stdoutBytes;
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stdout.push(kept);
      stdoutBytes += kept.length;
    });
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
    });
    child.once('error', (cause) => finish(() => reject(cause)));
    child.once('close', (code, exitSignal) => finish(() => resolve({
      code: Number.isInteger(code) ? code : 1,
      signal: exitSignal,
      stdout: Buffer.concat(stdout),
      stderr,
    })));
  });
}

function parseProbeOutput(value) {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value || ''));
    if (!parsed || typeof parsed !== 'object') return null;
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream?.codec_type === 'video');
    let fps = 24;
    if (typeof video?.r_frame_rate === 'string') {
      const [numerator, denominator] = video.r_frame_rate.split('/').map(Number);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) fps = numerator / denominator;
    }
    const formatTags = parsed.format?.tags && typeof parsed.format.tags === 'object' ? parsed.format.tags : {};
    let timecode = formatTags.timecode ?? formatTags['com.apple.quicktime.timecode'];
    if (typeof timecode !== 'string') {
      timecode = streams.map((stream) => stream?.tags?.timecode).find((entry) => typeof entry === 'string');
    }
    const duration = Number(parsed.format?.duration);
    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      fps: Number.isFinite(fps) && fps > 0 ? fps : 24,
      hasAudio: streams.some((stream) => stream?.codec_type === 'audio'),
      timecode: typeof timecode === 'string' ? timecode : null,
    };
  } catch {
    return null;
  }
}

function parseFingerprint(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  const match = /(?:^|\n)FINGERPRINT=([^\n]+)/.exec(text);
  if (!match) return null;
  const values = match[1].split(',').map((entry) => Number.parseInt(entry.trim(), 10));
  if (values.length < 8 || values.length > 1_000_000 || values.some((entry) => !Number.isInteger(entry))) return null;
  return values;
}

function readPcm(buffer) {
  const usableLength = buffer.byteLength - (buffer.byteLength % 2);
  const samples = new Float32Array(usableLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2) / 32768;
  }
  return samples;
}

function summarizeVotes(votes) {
  if (votes.length === 0) return { offsetSeconds: 0, confidence: 0 };
  votes.sort((left, right) => left.offsetSeconds - right.offsetSeconds);
  let best = [];
  let bestScore = -1;
  for (let index = 0; index < votes.length; index += 1) {
    const group = votes.filter((vote) => Math.abs(vote.offsetSeconds - votes[index].offsetSeconds) < 1.5);
    const confidence = group.reduce((sum, vote) => sum + vote.confidence, 0) / group.length;
    const score = group.length * confidence;
    if (score > bestScore) {
      bestScore = score;
      best = group;
    }
  }
  const total = best.reduce((sum, vote) => sum + vote.confidence, 0);
  if (total <= 0) return { offsetSeconds: 0, confidence: 0 };
  return {
    offsetSeconds: best.reduce((sum, vote) => sum + vote.offsetSeconds * vote.confidence, 0) / total,
    confidence: Math.min(1, total / best.length),
  };
}

function crossCorrelatePcm(source, target) {
  const shorter = source.length <= target.length ? source : target;
  const longer = source.length <= target.length ? target : source;
  const flipped = source.length > target.length;
  const skipEdge = Math.min(5 * PCM_SAMPLE_RATE, Math.floor(shorter.length * 0.05));
  const usableLength = shorter.length - skipEdge * 2;
  const anchorLength = Math.min(5 * PCM_SAMPLE_RATE, usableLength);
  if (anchorLength < PCM_SAMPLE_RATE || longer.length < anchorLength) {
    return { offsetSeconds: 0, confidence: 0 };
  }
  const anchorCount = Math.min(4, Math.max(1, Math.floor(usableLength / anchorLength)));
  const spacing = Math.floor((usableLength - anchorLength) / Math.max(1, anchorCount - 1));
  const coarseStep = Math.max(1, Math.floor(PCM_SAMPLE_RATE * 0.25));
  const fineStep = Math.max(1, Math.floor(PCM_SAMPLE_RATE * 0.01));
  const votes = [];

  for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex += 1) {
    const anchorStart = skipEdge + anchorIndex * spacing;
    const anchor = shorter.subarray(anchorStart, anchorStart + anchorLength);
    let anchorSum = 0;
    let anchorSquares = 0;
    for (const sample of anchor) {
      anchorSum += sample;
      anchorSquares += sample * sample;
    }
    const anchorMean = anchorSum / anchor.length;
    const anchorVariance = anchorSquares / anchor.length - anchorMean * anchorMean;
    if (anchorVariance < 1e-10) continue;

    const ncc = (position) => {
      let sum = 0;
      let squares = 0;
      let cross = 0;
      for (let index = 0; index < anchor.length; index += 1) {
        const sample = longer[position + index];
        sum += sample;
        squares += sample * sample;
        cross += anchor[index] * sample;
      }
      const mean = sum / anchor.length;
      const variance = squares / anchor.length - mean * mean;
      return variance < 1e-10 ? -1 : (cross / anchor.length - anchorMean * mean) / Math.sqrt(anchorVariance * variance);
    };

    const searchEnd = longer.length - anchor.length;
    let bestPosition = 0;
    let bestConfidence = -1;
    for (let position = 0; position <= searchEnd; position += coarseStep) {
      const confidence = ncc(position);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestPosition = position;
      }
    }
    const fineStart = Math.max(0, bestPosition - coarseStep * 2);
    const fineEnd = Math.min(searchEnd, bestPosition + coarseStep * 2);
    for (let position = fineStart; position <= fineEnd; position += fineStep) {
      const confidence = ncc(position);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestPosition = position;
      }
    }
    if (bestConfidence > 0.15) {
      const rawOffset = (bestPosition - anchorStart) / PCM_SAMPLE_RATE;
      votes.push({ offsetSeconds: flipped ? rawOffset : -rawOffset, confidence: bestConfidence });
    }
  }
  return summarizeVotes(votes);
}

/**
 * Build secure web implementations of `sync.computeOffset` and
 * `sync.batchMatch`. The returned methods accept the same single parameter
 * object as Electron's preload bridge.
 */
export function createSyncHandlers(context) {
  const options = requireRecord(context, 'Sync service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'Sync data root', { maxLength: 16_384 }));
  const mediaRoot = pathInside(dataRoot, 'media');
  const projectsRoot = pathInside(mediaRoot, 'projects');
  const syncTempRoot = pathInside(mediaRoot, 'temp', 'sync');
  const store = options.store;
  const events = options.events;
  const ffmpegPath = options.ffmpegPath || ffmpegStaticPath;
  const ffprobePath = options.ffprobePath || ffprobeStatic?.path;
  const fpcalcPath = options.fpcalcPath || DEFAULT_FPCALC_PATH;
  const processRunner = options.processRunner || defaultProcessRunner;
  const processTimeoutMs = Number.isFinite(options.processTimeoutMs)
    ? Math.max(1_000, Number(options.processTimeoutMs))
    : DEFAULT_PROCESS_TIMEOUT_MS;
  const maxFingerprintSeconds = Number.isFinite(options.maxFingerprintSeconds)
    ? Math.max(10, Math.min(3_600, Number(options.maxFingerprintSeconds)))
    : DEFAULT_MAX_FINGERPRINT_SECONDS;
  const maxPcmSeconds = Number.isFinite(options.maxPcmSeconds)
    ? Math.max(10, Math.min(600, Number(options.maxPcmSeconds)))
    : DEFAULT_MAX_PCM_SECONDS;

  if (typeof processRunner !== 'function') throw syncError('Sync process runner must be a function.', 'INVALID_SYNC_CONTEXT', 500);

  const run = async (executable, args, kind, jobId) => {
    if (typeof executable !== 'string' || !executable) {
      throw syncError(`The ${kind} tool is unavailable on this web server.`, 'SYNC_TOOL_UNAVAILABLE', 501);
    }
    try {
      return await processRunner({ executable, args, kind, jobId, timeoutMs: processTimeoutMs });
    } catch (cause) {
      throw syncError(`${kind} could not be started.`, 'SYNC_TOOL_FAILED', 500, cause);
    }
  };

  const ensureProject = async (value) => {
    const projectId = requireId(value, 'Project id');
    if (store && typeof store.load === 'function') await store.load(projectId);
    return projectId;
  };

  const resolveReference = async (value, projectId, label) => {
    const reference = requireString(value, label, { maxLength: 16_384 });
    if (typeof options.pathForMediaReference !== 'function') {
      throw syncError('Media reference resolver is unavailable.', 'INVALID_SYNC_CONTEXT', 500);
    }
    let resolved;
    try {
      resolved = await options.pathForMediaReference(reference);
    } catch (cause) {
      throw syncError(`${label} is malformed or unavailable.`, 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof resolved !== 'string' || !isPathInside(mediaRoot, resolved)) {
      throw syncError(`${label} is outside the web media directory.`, 'INVALID_MEDIA_PATH');
    }
    let realMediaRoot;
    let realPath;
    try {
      [realMediaRoot, realPath] = await Promise.all([fsp.realpath(mediaRoot), fsp.realpath(resolved)]);
      const stats = await fsp.stat(realPath);
      if (!stats.isFile()) throw syncError(`${label} must point to a file.`, 'INVALID_MEDIA_PATH');
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      if (cause?.code === 'ENOENT') throw syncError(`${label} was not found.`, 'MEDIA_NOT_FOUND', 404, cause);
      throw cause;
    }
    const realProjectRoot = pathInside(realMediaRoot, 'projects', projectId);
    if (!isPathInside(realMediaRoot, realPath) || !isPathInside(realProjectRoot, realPath)) {
      throw syncError(`${label} does not belong to project ${projectId}.`, 'PROJECT_MEDIA_MISMATCH');
    }
    return realPath;
  };

  const probe = async (filePath, jobId) => {
    const result = await run(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ], 'ffprobe', jobId);
    const parsed = result?.code === 0 ? parseProbeOutput(result.stdout) : null;
    if (!parsed) throw syncError('Unable to read media metadata for audio sync.', 'SYNC_PROBE_FAILED', 422);
    return parsed;
  };

  const fingerprint = async (filePath, jobId) => {
    const result = await run(fpcalcPath, [
      '-raw', '-length', String(Math.round(maxFingerprintSeconds)), filePath,
    ], 'fpcalc', jobId);
    return result?.code === 0 ? parseFingerprint(result.stdout) : null;
  };

  const extractPcm = async (filePath, outputPath, duration, jobId) => {
    const boundedDuration = Math.min(duration || maxPcmSeconds, maxPcmSeconds);
    const result = await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', filePath,
      '-t', String(boundedDuration), '-vn', '-acodec', 'pcm_s16le',
      '-ar', String(PCM_SAMPLE_RATE), '-ac', '1', '-f', 's16le', outputPath,
    ], 'ffmpeg-pcm', jobId);
    if (result?.code !== 0) throw syncError('Unable to decode audio for synchronization.', 'SYNC_AUDIO_DECODE_FAILED', 422);
    const buffer = await fsp.readFile(outputPath);
    const maxBytes = maxPcmSeconds * PCM_SAMPLE_RATE * 2 + 2;
    if (buffer.length > maxBytes) throw syncError('Decoded sync audio exceeded its safe size limit.', 'SYNC_AUDIO_TOO_LARGE', 413);
    return readPcm(buffer);
  };

  const computeResolvedOffset = async (sourcePath, targetPath, jobId) => {
    const [sourceProbe, targetProbe] = await Promise.all([
      probe(sourcePath, jobId),
      probe(targetPath, jobId),
    ]);
    if (sourceProbe.timecode && targetProbe.timecode) {
      const offset = computeTimecodeOffset(sourceProbe.timecode, targetProbe.timecode, sourceProbe.fps);
      if (offset !== null) return { offsetSeconds: offset, method: 'timecode', confidence: 1 };
    }
    if (!sourceProbe.hasAudio) throw syncError('Source video has no audio stream.', 'SOURCE_AUDIO_MISSING', 422);
    if (!targetProbe.hasAudio) throw syncError('Target audio file has no audio stream.', 'TARGET_AUDIO_MISSING', 422);

    let fingerprintResult = null;
    try {
      const [sourceFingerprint, targetFingerprint] = await Promise.all([
        fingerprint(sourcePath, jobId),
        fingerprint(targetPath, jobId),
      ]);
      if (sourceFingerprint && targetFingerprint) {
        fingerprintResult = crossCorrelateFingerprints(sourceFingerprint, targetFingerprint);
        if (fingerprintResult.confidence >= FAST_ACCEPT_CONFIDENCE) {
          return { ...fingerprintResult, method: 'waveform' };
        }
      }
    } catch {
      // PCM below is the compatibility fallback when Chromaprint is absent.
    }

    const longestDuration = Math.max(sourceProbe.duration || Infinity, targetProbe.duration || Infinity);
    if (longestDuration > maxPcmSeconds) {
      if (fingerprintResult) return { ...fingerprintResult, method: 'waveform' };
      throw syncError(
        `Waveform fallback is limited to ${maxPcmSeconds} seconds when no fingerprint is available.`,
        'SYNC_MEDIA_TOO_LONG',
        422,
      );
    }

    const workDir = pathInside(syncTempRoot, jobId);
    const sourcePcmPath = pathInside(workDir, 'source.raw');
    const targetPcmPath = pathInside(workDir, 'target.raw');
    await fsp.mkdir(workDir, { recursive: true });
    try {
      const [sourcePcm, targetPcm] = await Promise.all([
        extractPcm(sourcePath, sourcePcmPath, sourceProbe.duration, jobId),
        extractPcm(targetPath, targetPcmPath, targetProbe.duration, jobId),
      ]);
      const correlation = crossCorrelatePcm(sourcePcm, targetPcm);
      return { ...correlation, method: 'waveform' };
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  const computeOffset = async (value) => {
    const params = requireRecord(value, 'Sync parameters');
    const projectId = await ensureProject(params.projectId);
    requireId(params.sourceAssetId, 'Source asset id');
    requireId(params.targetAssetId, 'Target asset id');
    const [sourcePath, targetPath] = await Promise.all([
      resolveReference(params.sourceFilePath, projectId, 'Source media'),
      resolveReference(params.targetFilePath, projectId, 'Target media'),
    ]);
    return computeResolvedOffset(sourcePath, targetPath, crypto.randomUUID());
  };

  const validateAssets = async (values, kind, projectId) => {
    if (!Array.isArray(values)) throw syncError(`${kind} assets must be an array.`);
    if (values.length > MAX_ASSETS_PER_KIND) {
      throw syncError(`At most ${MAX_ASSETS_PER_KIND} ${kind.toLowerCase()} assets can be synchronized at once.`);
    }
    const ids = new Set();
    const result = [];
    for (let index = 0; index < values.length; index += 1) {
      const entry = requireRecord(values[index], `${kind} asset ${index + 1}`);
      const id = requireId(entry.id, `${kind} asset id`);
      if (ids.has(id)) throw syncError(`${kind} asset ids must be unique.`, 'DUPLICATE_ASSET_ID');
      ids.add(id);
      const name = requireString(entry.name, `${kind} asset name`, { maxLength: 512 });
      const filePath = await resolveReference(entry.filePath, projectId, `${kind} media`);
      result.push({ id, name, filePath });
    }
    return result;
  };

  const batchMatch = async (value) => {
    const params = requireRecord(value, 'Batch sync parameters');
    const projectId = await ensureProject(params.projectId);
    const [videoAssets, audioAssets] = await Promise.all([
      validateAssets(params.videoAssets, 'Video', projectId),
      validateAssets(params.audioAssets, 'Audio', projectId),
    ]);
    const jobId = crypto.randomUUID();
    const pairs = [];
    const usedAudioIds = new Set();
    const emit = (payload) => {
      if (events && typeof events.emit === 'function') {
        events.emit('sync:batch-progress', { jobId, ...payload });
      }
    };

    for (let videoIndex = 0; videoIndex < videoAssets.length; videoIndex += 1) {
      const video = videoAssets[videoIndex];
      const candidates = audioAssets
        .filter((audio) => !usedAudioIds.has(audio.id))
        .map((audio) => ({ audio, nameScore: scoreFilenameSimilarity(video.name, audio.name) }))
        .sort((left, right) => right.nameScore - left.nameScore);
      for (const candidate of candidates) {
        emit({
          completedPairs: videoIndex,
          totalPairs: videoAssets.length,
          currentVideoName: video.name,
          currentAudioName: candidate.audio.name,
        });
        try {
          const matched = await computeResolvedOffset(video.filePath, candidate.audio.filePath, jobId);
          if (matched.confidence >= MIN_MATCH_CONFIDENCE) {
            pairs.push({
              videoAssetId: video.id,
              audioAssetId: candidate.audio.id,
              offsetSeconds: matched.offsetSeconds,
              matchMethod: matched.method,
              nameScore: candidate.nameScore,
              waveformScore: matched.confidence,
            });
            usedAudioIds.add(candidate.audio.id);
            break;
          }
        } catch {
          // Match failures are candidate-local, matching Electron behavior.
        }
      }
    }
    const matchedVideoIds = new Set(pairs.map((pair) => pair.videoAssetId));
    const result = {
      pairs,
      unmatchedVideos: videoAssets.filter((asset) => !matchedVideoIds.has(asset.id)).map((asset) => asset.id),
      unmatchedAudio: audioAssets.filter((asset) => !usedAudioIds.has(asset.id)).map((asset) => asset.id),
    };
    emit({
      completedPairs: videoAssets.length,
      totalPairs: videoAssets.length,
      currentVideoName: '',
      currentAudioName: '',
    });
    return result;
  };

  return { computeOffset, batchMatch };
}
