import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, mkdtemp, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const FINGERPRINT_SAMPLE_RATE = 16000;

// ─── Timecode Parsing ────────────────────────────────────────────────────────

/**
 * Parse SMPTE timecode string to total frame count.
 * Supports non-drop-frame (HH:MM:SS:FF) and drop-frame (HH:MM:SS;FF).
 * Returns null for invalid input.
 */
export function parseTimecode(tc: string, fps: number): number | null {
  const match = tc.match(/^(\d{2}):(\d{2}):(\d{2})([;:])(\d{2})$/);
  if (!match) return null;

  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  const separator = match[4];
  const f = parseInt(match[5], 10);

  const isDropFrame = separator === ';';

  if (isDropFrame) {
    // Drop-frame calculation for 29.97 fps (30000/1001)
    // Drop 2 frames at start of each minute except every 10th minute
    const roundFps = Math.round(fps); // 30
    const dropFrames = Math.round(fps * 0.066666); // 2 for 29.97
    const totalMinutes = 60 * h + m;
    const frameNumber =
      roundFps * 3600 * h +
      roundFps * 60 * m +
      roundFps * s +
      f -
      dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
    return frameNumber;
  } else {
    // Non-drop-frame: straight multiplication
    return Math.round((h * 3600 + m * 60 + s) * fps) + f;
  }
}

/**
 * Compute offset in seconds between two timecodes (target - source).
 * Returns null if either timecode is invalid.
 */
export function computeTimecodeOffset(
  sourceTc: string,
  targetTc: string,
  fps: number,
): number | null {
  const sourceFrames = parseTimecode(sourceTc, fps);
  const targetFrames = parseTimecode(targetTc, fps);
  if (sourceFrames === null || targetFrames === null) return null;
  return (targetFrames - sourceFrames) / fps;
}

// ─── Fingerprint Cross-Correlation ──────────────────────────────────────────

/** Seconds represented by each fingerprint index (fpcalc resolution) */
export const FP_INDEX_TO_SECONDS = 0.1238;

export interface CorrelationResult {
  /** Offset in abstract index units (fingerprint or window). */
  offsetIndex: number;
  /** Similarity score 0-1, where 1 = identical */
  confidence: number;
  /** Offset in seconds (set by PCM correlator, 0 for fingerprint). */
  _offsetSeconds: number;
}

/**
 * Hamming weight (popcount) of a 32-bit integer.
 */
export function popcount32(n: number): number {
  n = n >>> 0; // treat as unsigned 32-bit
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Slide source fingerprint over target using bit-error-rate (popcount of XOR).
 * Returns the offset index with the highest similarity and its confidence.
 * Minimum 3 overlapping samples required for a valid position.
 */
export function crossCorrelateFingerprints(
  source: number[],
  target: number[],
  maxOffsetSeconds = 120,
): CorrelationResult {
  // Limit search range: offset between scratch and external audio is rarely > 2 minutes.
  // Each fingerprint index ≈ 0.1238s, so 120s ≈ 969 indices.
  const maxShiftFromTime = Math.ceil(maxOffsetSeconds / FP_INDEX_TO_SECONDS);
  const maxShift = Math.min(maxShiftFromTime, Math.max(source.length, target.length) - 1);
  let bestOffset = 0;
  let bestScore = -1;

  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let totalBitErrors = 0;
    let overlapCount = 0;

    for (let i = 0; i < source.length; i++) {
      const j = i + shift;
      if (j < 0 || j >= target.length) continue;
      totalBitErrors += popcount32((source[i] ^ target[j]) >>> 0);
      overlapCount++;
    }

    if (overlapCount < 3) continue;

    const avgBitError = totalBitErrors / overlapCount;
    const score = 1 - avgBitError / 32;

    if (score > bestScore) {
      bestScore = score;
      bestOffset = shift;
    }
  }

  return {
    offsetIndex: bestOffset,
    confidence: Math.max(0, bestScore),
    _offsetSeconds: bestOffset * FP_INDEX_TO_SECONDS,
  };
}

/**
 * Search a short fingerprint anchor inside a longer fingerprint.
 * Returns the offset where the anchor starts within the search fingerprint.
 */
export function searchFingerprintAnchor(
  anchor: number[],
  search: number[],
): CorrelationResult {
  if (anchor.length < 3 || search.length < anchor.length) {
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  }

  const searchEnd = search.length - anchor.length;
  let bestOffset = 0;
  let bestScore = -1;

  for (let offset = 0; offset <= searchEnd; offset++) {
    let totalBitErrors = 0;

    for (let i = 0; i < anchor.length; i++) {
      totalBitErrors += popcount32((anchor[i] ^ search[offset + i]) >>> 0);
    }

    const score = 1 - totalBitErrors / (anchor.length * 32);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return {
    offsetIndex: bestOffset,
    confidence: Math.max(0, bestScore),
    _offsetSeconds: bestOffset * FP_INDEX_TO_SECONDS,
  };
}

// ─── Filename Similarity ─────────────────────────────────────────────────────

/**
 * Standard dynamic-programming Levenshtein distance.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Normalized similarity score between two filenames (ignoring extensions).
 * Returns 1.0 for identical basenames, 0.0 for completely different.
 */
/** Strip extension from a filename, treating dotfiles (e.g. `.mov`) as pure-extension names with an empty stem. */
function stemOf(file: string): string {
  const name = path.basename(file);
  const ext = path.extname(name);
  // path.extname('.mov') returns '' because Node treats it as a dotfile;
  // detect the pattern manually: starts with dot, no other dots → empty stem.
  if (ext === '' && name.startsWith('.')) return '';
  return path.basename(name, ext);
}

export function scoreFilenameSimilarity(fileA: string, fileB: string): number {
  const baseA = stemOf(fileA).toLowerCase();
  const baseB = stemOf(fileB).toLowerCase();

  if (baseA.length === 0 && baseB.length === 0) return 1.0;

  const dist = levenshteinDistance(baseA, baseB);
  const maxLen = Math.max(baseA.length, baseB.length);
  if (maxLen === 0) return 1.0;

  return 1 - dist / maxLen;
}

// ─── FFprobe / fpcalc Wrappers ───────────────────────────────────────────────

interface FfprobeOutput {
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    r_frame_rate?: string;
    tags?: Record<string, string>;
  }>;
}

/**
 * Extract embedded timecode from a media file using ffprobe.
 * Checks format tags and per-stream tags. Also returns fps from video stream.
 * Returns null if no timecode found.
 */
export async function extractTimecode(
  filePath: string,
  ffprobePath: string,
): Promise<{ timecode: string; fps: number } | null> {
  let stdout: string;
  try {
    const result = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    stdout = result.stdout;
  } catch {
    return null;
  }

  let probe: FfprobeOutput;
  try {
    probe = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return null;
  }

  // Extract fps from video stream
  let fps = 24;
  const videoStream = probe.streams?.find((s) => s.codec_type === 'video');
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den && den > 0) fps = num / den;
  }

  // Look for timecode in format tags
  const formatTags = probe.format?.tags ?? {};
  const tcFromFormat =
    formatTags['timecode'] ??
    formatTags['com.apple.quicktime.timecode'] ??
    null;
  if (tcFromFormat) return { timecode: tcFromFormat, fps };

  // Look for timecode in stream tags
  for (const stream of probe.streams ?? []) {
    const tc = stream.tags?.['timecode'];
    if (tc) return { timecode: tc, fps };
  }

  return null;
}

/**
 * Check whether a media file has at least one audio stream.
 */
export async function hasAudioStream(
  filePath: string,
  ffprobePath: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'a',
      filePath,
    ]);
    const probe = JSON.parse(stdout) as FfprobeOutput;
    return (probe.streams?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Run fpcalc and return the raw fingerprint as an array of 32-bit integers.
 */
export async function extractFingerprint(
  filePath: string,
  fpcalcPath: string,
  lengthSeconds = 300,
): Promise<number[]> {
  const safeLength = !Number.isFinite(lengthSeconds) || lengthSeconds < 0
    ? 300
    : Math.round(lengthSeconds);
  const { stdout } = await execFileAsync(fpcalcPath, ['-raw', '-length', String(safeLength), filePath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  // fpcalc output:  FINGERPRINT=<comma-separated integers>
  const match = stdout.match(/FINGERPRINT=([^\n]+)/);
  if (!match) throw new Error('fpcalc: no FINGERPRINT in output');
  return match[1].split(',').map((v) => {
    const parsed = parseInt(v.trim(), 10);
    if (isNaN(parsed)) throw new Error(`fpcalc: invalid fingerprint value "${v}"`);
    return parsed;
  });
}

/** Sample rate for sync analysis — 8kHz preserves transients/timing for accurate correlation. */
const SYNC_SAMPLE_RATE = 8000;
const FAST_SYNC_WINDOW_SECONDS = 20;
const FAST_SYNC_MIN_PAIR_CONFIDENCE = 0.4;
const FAST_SYNC_ACCEPT_CONFIDENCE = 0.55;

interface AnalysisWindow {
  label: 'start' | 'middle' | 'end';
  startSeconds: number;
  durationSeconds: number;
}

interface OffsetVote {
  offsetSeconds: number;
  confidence: number;
  label: string;
}

interface FingerprintWindow extends AnalysisWindow {
  fingerprint: number[];
}

/**
 * Read media duration in seconds from ffprobe.
 */
export async function extractMediaDuration(
  filePath: string,
  ffprobePath: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ]);
    const probe = JSON.parse(stdout) as FfprobeOutput;
    const duration = Number(probe.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

/**
 * Build sampled analysis windows that cover the beginning, middle, and end.
 * Nearby duplicate windows are collapsed for shorter files.
 */
export function buildAnalysisWindows(
  durationSeconds: number,
  windowSeconds = FAST_SYNC_WINDOW_SECONDS,
): AnalysisWindow[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];

  const clipWindow = Math.min(windowSeconds, durationSeconds);
  const maxStart = Math.max(0, durationSeconds - clipWindow);
  const candidates: AnalysisWindow[] = [
    { label: 'start', startSeconds: 0, durationSeconds: clipWindow },
    {
      label: 'middle',
      startSeconds: Math.max(0, durationSeconds / 2 - clipWindow / 2),
      durationSeconds: clipWindow,
    },
    { label: 'end', startSeconds: maxStart, durationSeconds: clipWindow },
  ];

  const dedupeThreshold = Math.max(1, clipWindow * 0.1);
  const windows: AnalysisWindow[] = [];

  for (const candidate of candidates) {
    const startSeconds = Math.max(0, Math.min(candidate.startSeconds, maxStart));
    if (windows.some((window) => Math.abs(window.startSeconds - startSeconds) < dedupeThreshold)) {
      continue;
    }
    windows.push({
      label: candidate.label,
      startSeconds,
      durationSeconds: Math.min(clipWindow, durationSeconds - startSeconds),
    });
  }

  return windows;
}

function summarizeOffsetVotes(
  votes: OffsetVote[],
  label: string,
): CorrelationResult {
  if (votes.length === 0) {
    console.log(`[audio-sync] ${label}: no valid matches found`);
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  }

  console.log(`[audio-sync] ${label} votes:`, votes.map((vote) =>
    `${vote.label}: offset=${vote.offsetSeconds.toFixed(2)}s conf=${vote.confidence.toFixed(3)}`
  ).join(' | '));

  votes.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  let bestGroup: OffsetVote[] = [];
  let bestGroupScore = -Infinity;

  for (let i = 0; i < votes.length; i++) {
    const group = [votes[i]];
    for (let j = i + 1; j < votes.length; j++) {
      if (Math.abs(votes[j].offsetSeconds - votes[i].offsetSeconds) < 1.5) {
        group.push(votes[j]);
      }
    }
    const avgConfidence = group.reduce((sum, vote) => sum + vote.confidence, 0) / group.length;
    const score = group.length * avgConfidence;
    if (score > bestGroupScore) {
      bestGroupScore = score;
      bestGroup = group;
    }
  }

  const totalConfidence = bestGroup.reduce((sum, vote) => sum + vote.confidence, 0);
  const weightedOffset =
    bestGroup.reduce((sum, vote) => sum + vote.offsetSeconds * vote.confidence, 0) / totalConfidence;
  const avgConfidence = totalConfidence / bestGroup.length;

  console.log(
    `[audio-sync] ${label} result: offset=${weightedOffset.toFixed(3)}s confidence=${avgConfidence.toFixed(3)} (${bestGroup.length}/${votes.length} votes agreed)`,
  );

  return {
    offsetIndex: 0,
    confidence: Math.min(1.0, avgConfidence),
    _offsetSeconds: weightedOffset,
  };
}

/**
 * Extract FULL audio to a temporary raw PCM file (mono, 16-bit signed LE, 8kHz).
 * No duration limit — we need the whole file because the overlap region
 * could be anywhere (e.g., audio recording started mid-way through video).
 * At 8kHz mono 16-bit, a 1-hour file is ~57MB — manageable.
 */
export async function extractAudioToTempPcm(
  inputPath: string,
  ffmpegPath: string,
  options: { startSeconds?: number; durationSeconds?: number } = {},
): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cinegen-sync-'));
  const pcmPath = path.join(tmpDir, 'audio.raw');
  const args = [
    '-y',
  ];
  if (typeof options.startSeconds === 'number' && options.startSeconds > 0) {
    args.push('-ss', options.startSeconds.toFixed(3));
  }
  args.push('-i', inputPath);
  if (typeof options.durationSeconds === 'number' && options.durationSeconds > 0) {
    args.push('-t', options.durationSeconds.toFixed(3));
  }
  args.push(
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', String(SYNC_SAMPLE_RATE),
    '-ac', '1',
    '-f', 's16le',
    pcmPath,
  );
  await execFileAsync(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 });
  return pcmPath;
}

/**
 * Extract a sampled audio segment to a temporary WAV file for fpcalc.
 */
export async function extractAudioToTempWav(
  inputPath: string,
  ffmpegPath: string,
  options: { startSeconds?: number; durationSeconds?: number } = {},
): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cinegen-sync-'));
  const wavPath = path.join(tmpDir, 'audio.wav');
  const args = ['-y'];
  if (typeof options.startSeconds === 'number' && options.startSeconds > 0) {
    args.push('-ss', options.startSeconds.toFixed(3));
  }
  args.push('-i', inputPath);
  if (typeof options.durationSeconds === 'number' && options.durationSeconds > 0) {
    args.push('-t', options.durationSeconds.toFixed(3));
  }
  args.push(
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', String(FINGERPRINT_SAMPLE_RATE),
    '-ac', '1',
    wavPath,
  );
  await execFileAsync(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 });
  return wavPath;
}

/**
 * Read raw PCM s16le file into a Float32 array normalized to [-1, 1].
 */
export async function readPcmAsFloat32(filePath: string): Promise<Float32Array> {
  const buf = await readFile(filePath);
  const int16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const float = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float[i] = int16[i] / 32768;
  }
  return float;
}

/**
 * Cross-correlate two PCM waveforms to find the best time offset.
 *
 * The offset tells you: target audio starts at (offset) seconds relative to source.
 * Positive offset = target starts later than source (audio recording started after camera).
 * Negative offset = target starts earlier than source (audio recording started before camera).
 *
 * Strategy: take anchors from the SHORTER file and search the ENTIRE longer file.
 * This handles cases where the audio recording only covers part of the video
 * (e.g., audio started mid-way through, or audio is longer than video).
 *
 * Uses coarse-then-fine Pearson NCC for speed + sub-frame accuracy.
 */
export function crossCorrelatePcm(
  source: Float32Array,
  target: Float32Array,
  sampleRate: number,
): CorrelationResult {
  const coarseStep = Math.floor(sampleRate * 0.25); // 0.25s coarse scan
  const fineStep = Math.floor(sampleRate * 0.01);   // 10ms fine refinement

  // Use the SHORTER file for anchors, search the LONGER file
  // This ensures we find overlap even if audio only covers part of video
  const shorter = source.length <= target.length ? source : target;
  const longer = source.length <= target.length ? target : source;
  const flipped = source.length > target.length; // if true, offset sign needs flipping

  console.log(`[audio-sync] Anchor file: ${(shorter.length / sampleRate).toFixed(1)}s, Search file: ${(longer.length / sampleRate).toFixed(1)}s${flipped ? ' (flipped)' : ''}`);

  // Pick anchors from start, middle, and end of the shorter file
  const skipEdge = Math.min(5 * sampleRate, Math.floor(shorter.length * 0.05));
  const usableLen = shorter.length - 2 * skipEdge;
  const desiredAnchorSamples = 10 * sampleRate;
  const minAnchorSamples = Math.max(1, Math.floor(sampleRate * 2));
  const anchorSamples = Math.max(
    Math.min(desiredAnchorSamples, usableLen),
    Math.min(minAnchorSamples, usableLen),
  );
  const numAnchors = Math.min(6, Math.max(1, Math.floor(usableLen / Math.max(1, anchorSamples))));

  if (usableLen <= 0 || anchorSamples <= 0 || longer.length < anchorSamples) {
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  }

  const anchorSpacing = Math.floor((usableLen - anchorSamples) / Math.max(1, numAnchors - 1));
  const votes: OffsetVote[] = [];

  for (let a = 0; a < numAnchors; a++) {
    const anchorStart = skipEdge + a * anchorSpacing;
    const anchorEnd = Math.min(anchorStart + anchorSamples, shorter.length);
    const anchor = shorter.subarray(anchorStart, anchorEnd);
    const anchorLen = anchor.length;
    if (anchorLen < anchorSamples * 0.5) continue;

    // Precompute anchor stats for Pearson NCC
    let aSum = 0, aSum2 = 0;
    for (let i = 0; i < anchorLen; i++) {
      aSum += anchor[i];
      aSum2 += anchor[i] * anchor[i];
    }
    const aMean = aSum / anchorLen;
    const aVar = aSum2 / anchorLen - aMean * aMean;
    if (aVar < 1e-10) continue; // silence, skip

    const computeNCC = (pos: number): number => {
      let tSum = 0, tSum2 = 0, cross = 0;
      for (let i = 0; i < anchorLen; i++) {
        const t = longer[pos + i];
        tSum += t;
        tSum2 += t * t;
        cross += anchor[i] * t;
      }
      const tMean = tSum / anchorLen;
      const tVar = tSum2 / anchorLen - tMean * tMean;
      if (tVar < 1e-10) return -1;
      return (cross / anchorLen - aMean * tMean) / Math.sqrt(aVar * tVar);
    };

    // Search the ENTIRE longer file (no maxOffset limit since overlap could be anywhere)
    const searchEnd = longer.length - anchorLen;
    let bestNCC = -Infinity;
    let bestPos = 0;

    // Coarse pass
    for (let pos = 0; pos <= searchEnd; pos += coarseStep) {
      const ncc = computeNCC(pos);
      if (ncc > bestNCC) { bestNCC = ncc; bestPos = pos; }
    }

    // Fine pass around coarse best (±0.5s)
    const fineStart = Math.max(0, bestPos - coarseStep * 2);
    const fineEnd = Math.min(searchEnd, bestPos + coarseStep * 2);
    for (let pos = fineStart; pos <= fineEnd; pos += fineStep) {
      const ncc = computeNCC(pos);
      if (ncc > bestNCC) { bestNCC = ncc; bestPos = pos; }
    }

    if (bestNCC > 0.15) {
      const rawOffset = (bestPos - anchorStart) / sampleRate;
      const finalOffset = flipped ? rawOffset : -rawOffset;
      votes.push({ offsetSeconds: finalOffset, confidence: bestNCC, label: `a${a}` });
    }
  }

  return summarizeOffsetVotes(votes, 'PCM anchor');
}

async function extractFingerprintWindows(
  inputPath: string,
  ffmpegPath: string,
  fpcalcPath: string,
  windows: AnalysisWindow[],
  tempFiles: string[],
): Promise<FingerprintWindow[]> {
  return Promise.all(
    windows.map(async (window) => {
      const wavPath = await extractAudioToTempWav(inputPath, ffmpegPath, {
        startSeconds: window.startSeconds,
        durationSeconds: window.durationSeconds,
      });
      tempFiles.push(wavPath);
      const fingerprint = await extractFingerprint(wavPath, fpcalcPath);
      return { ...window, fingerprint };
    }),
  );
}

async function computeSampledWaveformSyncOffset(
  sourceVideoPath: string,
  targetAudioPath: string,
  ffmpegPath: string,
  ffprobePath: string,
  fpcalcPath: string,
  tempFiles: string[],
): Promise<CorrelationResult | null> {
  const [sourceDuration, targetDuration] = await Promise.all([
    extractMediaDuration(sourceVideoPath, ffprobePath),
    extractMediaDuration(targetAudioPath, ffprobePath),
  ]);

  if (!sourceDuration || !targetDuration) {
    console.log('[audio-sync] Sampled pass skipped: missing duration metadata');
    return null;
  }

  const sourceIsShorter = sourceDuration <= targetDuration;
  const anchorPath = sourceIsShorter ? sourceVideoPath : targetAudioPath;
  const searchPath = sourceIsShorter ? targetAudioPath : sourceVideoPath;
  const anchorWindows = buildAnalysisWindows(Math.min(sourceDuration, targetDuration));
  if (anchorWindows.length === 0) {
    console.log('[audio-sync] Sampled pass skipped: no analysis windows');
    return null;
  }

  console.log(
    `[audio-sync] Sampled fingerprint pass: ${anchorWindows.length} anchor windows against full ${sourceIsShorter ? 'target' : 'source'} fingerprint`,
  );

  const [anchorFingerprintWindows, searchFingerprint] = await Promise.all([
    extractFingerprintWindows(anchorPath, ffmpegPath, fpcalcPath, anchorWindows, tempFiles),
    extractFingerprint(searchPath, fpcalcPath, 0),
  ]);

  const votes: OffsetVote[] = [];

  for (const anchorWindow of anchorFingerprintWindows) {
    const correlation = searchFingerprintAnchor(anchorWindow.fingerprint, searchFingerprint);
    if (correlation.confidence < FAST_SYNC_MIN_PAIR_CONFIDENCE) continue;

    const rawOffset = correlation._offsetSeconds - anchorWindow.startSeconds;
    const finalOffset = sourceIsShorter ? -rawOffset : rawOffset;
    votes.push({
      offsetSeconds: finalOffset,
      confidence: correlation.confidence,
      label: anchorWindow.label,
    });
  }

  return summarizeOffsetVotes(votes, 'Sampled fingerprint');
}

// ─── Batch Match ─────────────────────────────────────────────────────────────

export interface BatchProgress {
  completedPairs: number;
  totalPairs: number;
  currentVideoName: string;
  currentAudioName: string;
}

export interface BatchPair {
  videoAssetId: string;
  audioAssetId: string;
  offsetSeconds: number;
  matchMethod: 'timecode' | 'waveform';
  nameScore: number;
  waveformScore: number;
}

export interface BatchResult {
  pairs: BatchPair[];
  unmatchedVideos: string[];
  unmatchedAudio: string[];
}

export async function computeBatchMatch(
  videoAssets: Array<{ id: string; filePath: string; name: string }>,
  audioAssets: Array<{ id: string; filePath: string; name: string }>,
  ffmpegPath: string,
  ffprobePath: string,
  fpcalcPath: string,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchResult> {
  const pairs: BatchPair[] = [];
  const usedAudioIds = new Set<string>();
  const totalPairs = videoAssets.length;

  for (let vi = 0; vi < videoAssets.length; vi++) {
    const video = videoAssets[vi];

    const candidates = audioAssets
      .filter((a) => !usedAudioIds.has(a.id))
      .map((a) => ({
        audio: a,
        nameScore: scoreFilenameSimilarity(video.name, a.name),
      }))
      .sort((a, b) => b.nameScore - a.nameScore);

    let matched = false;

    for (const candidate of candidates) {
      onProgress?.({
        completedPairs: vi,
        totalPairs,
        currentVideoName: video.name,
        currentAudioName: candidate.audio.name,
      });

      try {
        const syncResult = await computeSyncOffset(
          video.filePath,
          candidate.audio.filePath,
          ffmpegPath,
          ffprobePath,
          fpcalcPath,
        );

        if (syncResult.confidence >= 0.4) {
          pairs.push({
            videoAssetId: video.id,
            audioAssetId: candidate.audio.id,
            offsetSeconds: syncResult.offsetSeconds,
            matchMethod: syncResult.method,
            nameScore: candidate.nameScore,
            waveformScore: syncResult.confidence,
          });
          usedAudioIds.add(candidate.audio.id);
          matched = true;
          break;
        }
      } catch {
        continue;
      }
    }

    void matched; // suppress unused variable warning
  }

  const matchedVideoIds = new Set(pairs.map((p) => p.videoAssetId));
  const unmatchedVideos = videoAssets.filter((v) => !matchedVideoIds.has(v.id)).map((v) => v.id);
  const unmatchedAudio = audioAssets.filter((a) => !usedAudioIds.has(a.id)).map((a) => a.id);

  onProgress?.({ completedPairs: totalPairs, totalPairs, currentVideoName: '', currentAudioName: '' });

  return { pairs, unmatchedVideos, unmatchedAudio };
}

// ─── Full Sync Pipeline ──────────────────────────────────────────────────────

export interface SyncResult {
  offsetSeconds: number;
  method: 'timecode' | 'waveform';
  confidence: number;
}

/**
 * Compute the sync offset between a source video and a target audio file.
 *
 * Strategy:
 * 1. Try timecode metadata — instant, highest confidence.
 * 2. Try sampled waveform correlation across beginning/middle/end windows.
 * 3. Fall back to full-file waveform correlation only when sampled confidence is weak.
 *
 * Temp files are always cleaned up in the finally block.
 */
export async function computeSyncOffset(
  sourceVideoPath: string,
  targetAudioPath: string,
  ffmpegPath: string,
  ffprobePath: string,
  fpcalcPath: string,
): Promise<SyncResult> {
  const tempPcmFiles: string[] = [];

  try {
    // ── 1. Timecode path ──────────────────────────────────────────────────
    const [sourceTc, targetTc] = await Promise.all([
      extractTimecode(sourceVideoPath, ffprobePath),
      extractTimecode(targetAudioPath, ffprobePath),
    ]);

    if (sourceTc && targetTc) {
      const fps = sourceTc.fps; // use source fps as reference
      const offset = computeTimecodeOffset(sourceTc.timecode, targetTc.timecode, fps);
      if (offset !== null) {
        return { offsetSeconds: offset, method: 'timecode', confidence: 1.0 };
      }
    }

    // ── 2. Waveform cross-correlation ────────────────────────────────────
    const [sourceHasAudio, targetHasAudio] = await Promise.all([
      hasAudioStream(sourceVideoPath, ffprobePath),
      hasAudioStream(targetAudioPath, ffprobePath),
    ]);

    if (!sourceHasAudio) throw new Error('Source video has no audio stream');
    if (!targetHasAudio) throw new Error('Target audio file has no audio stream');

    const sampledCorrelation = await computeSampledWaveformSyncOffset(
      sourceVideoPath,
      targetAudioPath,
      ffmpegPath,
      ffprobePath,
      fpcalcPath,
      tempPcmFiles,
    );

    if (sampledCorrelation && sampledCorrelation.confidence >= FAST_SYNC_ACCEPT_CONFIDENCE) {
      console.log(
        `[audio-sync] Using sampled waveform result (confidence=${sampledCorrelation.confidence.toFixed(3)})`,
      );
      return {
        offsetSeconds: sampledCorrelation._offsetSeconds,
        method: 'waveform',
        confidence: sampledCorrelation.confidence,
      };
    }

    console.log(
      `[audio-sync] Falling back to full-file waveform sync${sampledCorrelation ? ` (sampled confidence=${sampledCorrelation.confidence.toFixed(3)})` : ''}`,
    );

    const [tempWavSource, tempWavTarget] = await Promise.all([
      extractAudioToTempPcm(sourceVideoPath, ffmpegPath),
      extractAudioToTempPcm(targetAudioPath, ffmpegPath),
    ]);
    tempPcmFiles.push(tempWavSource, tempWavTarget);

    const [sourcePcm, targetPcm] = await Promise.all([
      readPcmAsFloat32(tempWavSource),
      readPcmAsFloat32(tempWavTarget),
    ]);

    console.log(`[audio-sync] Source PCM: ${sourcePcm.length} samples (${(sourcePcm.length / SYNC_SAMPLE_RATE).toFixed(1)}s)`);
    console.log(`[audio-sync] Target PCM: ${targetPcm.length} samples (${(targetPcm.length / SYNC_SAMPLE_RATE).toFixed(1)}s)`);

    const correlation = crossCorrelatePcm(sourcePcm, targetPcm, SYNC_SAMPLE_RATE);

    return {
      offsetSeconds: correlation._offsetSeconds,
      method: 'waveform',
      confidence: correlation.confidence,
    };
  } finally {
    // Clean up temp PCM files and their parent directories
    const cleanupFile = async (p: string | null) => {
      if (!p) return;
      try {
        await unlink(p);
        await rmdir(path.dirname(p));
      } catch {
        // best-effort cleanup
      }
    };
    await Promise.all(tempPcmFiles.map((filePath) => cleanupFile(filePath)));
  }
}
