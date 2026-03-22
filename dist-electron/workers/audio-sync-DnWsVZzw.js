import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const execFileAsync = promisify(execFile);
function parseTimecode(tc, fps) {
  const match = tc.match(/^(\d{2}):(\d{2}):(\d{2})([;:])(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  const separator = match[4];
  const f = parseInt(match[5], 10);
  const isDropFrame = separator === ";";
  if (isDropFrame) {
    const roundFps = Math.round(fps);
    const dropFrames = Math.round(fps * 0.066666);
    const totalMinutes = 60 * h + m;
    const frameNumber = roundFps * 3600 * h + roundFps * 60 * m + roundFps * s + f - dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
    return frameNumber;
  } else {
    return Math.round((h * 3600 + m * 60 + s) * fps) + f;
  }
}
function computeTimecodeOffset(sourceTc, targetTc, fps) {
  const sourceFrames = parseTimecode(sourceTc, fps);
  const targetFrames = parseTimecode(targetTc, fps);
  if (sourceFrames === null || targetFrames === null) return null;
  return (targetFrames - sourceFrames) / fps;
}
const FP_INDEX_TO_SECONDS = 0.1238;
function popcount32(n) {
  n = n >>> 0;
  n = n - (n >>> 1 & 1431655765);
  n = (n & 858993459) + (n >>> 2 & 858993459);
  return (n + (n >>> 4) & 252645135) * 16843009 >>> 24;
}
function crossCorrelateFingerprints(source, target, maxOffsetSeconds = 120) {
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
    confidence: Math.max(0, bestScore)
  };
}
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from(
    { length: m + 1 },
    (_, i) => Array.from({ length: n + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0)
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
function stemOf(file) {
  const name = path.basename(file);
  const ext = path.extname(name);
  if (ext === "" && name.startsWith(".")) return "";
  return path.basename(name, ext);
}
function scoreFilenameSimilarity(fileA, fileB) {
  const baseA = stemOf(fileA).toLowerCase();
  const baseB = stemOf(fileB).toLowerCase();
  if (baseA.length === 0 && baseB.length === 0) return 1;
  const dist = levenshteinDistance(baseA, baseB);
  const maxLen = Math.max(baseA.length, baseB.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}
async function extractTimecode(filePath, ffprobePath) {
  var _a, _b, _c;
  let stdout;
  try {
    const result = await execFileAsync(ffprobePath, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ]);
    stdout = result.stdout;
  } catch {
    return null;
  }
  let probe;
  try {
    probe = JSON.parse(stdout);
  } catch {
    return null;
  }
  let fps = 24;
  const videoStream = (_a = probe.streams) == null ? void 0 : _a.find((s) => s.codec_type === "video");
  if (videoStream == null ? void 0 : videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
    if (den && den > 0) fps = num / den;
  }
  const formatTags = ((_b = probe.format) == null ? void 0 : _b.tags) ?? {};
  const tcFromFormat = formatTags["timecode"] ?? formatTags["com.apple.quicktime.timecode"] ?? null;
  if (tcFromFormat) return { timecode: tcFromFormat, fps };
  for (const stream of probe.streams ?? []) {
    const tc = (_c = stream.tags) == null ? void 0 : _c["timecode"];
    if (tc) return { timecode: tc, fps };
  }
  return null;
}
async function hasAudioStream(filePath, ffprobePath) {
  var _a;
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-select_streams",
      "a",
      filePath
    ]);
    const probe = JSON.parse(stdout);
    return (((_a = probe.streams) == null ? void 0 : _a.length) ?? 0) > 0;
  } catch {
    return false;
  }
}
async function extractFingerprint(filePath, fpcalcPath) {
  const { stdout } = await execFileAsync(fpcalcPath, ["-raw", "-length", "300", filePath], {
    maxBuffer: 10 * 1024 * 1024
  });
  const match = stdout.match(/FINGERPRINT=([^\n]+)/);
  if (!match) throw new Error("fpcalc: no FINGERPRINT in output");
  return match[1].split(",").map((v) => {
    const parsed = parseInt(v.trim(), 10);
    if (isNaN(parsed)) throw new Error(`fpcalc: invalid fingerprint value "${v}"`);
    return parsed;
  });
}
const SYNC_SAMPLE_RATE = 8e3;
const SYNC_MAX_DURATION = 600;
async function extractAudioToTempPcm(inputPath, ffmpegPath) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cinegen-sync-"));
  const pcmPath = path.join(tmpDir, "audio.raw");
  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-t",
    String(SYNC_MAX_DURATION),
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(SYNC_SAMPLE_RATE),
    "-ac",
    "1",
    "-f",
    "s16le",
    // raw PCM, no WAV header
    pcmPath
  ]);
  return pcmPath;
}
async function readPcmAsFloat32(filePath) {
  const buf = await readFile(filePath);
  const int16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const float = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float[i] = int16[i] / 32768;
  }
  return float;
}
function crossCorrelatePcm(source, target, sampleRate, maxOffsetSeconds = 120) {
  const windowSamples = Math.floor(sampleRate * 0.05);
  const sourceEnergy = computeEnergyProfile(source, windowSamples);
  const targetEnergy = computeEnergyProfile(target, windowSamples);
  const maxShift = Math.min(
    Math.ceil(maxOffsetSeconds / 0.05),
    Math.max(sourceEnergy.length, targetEnergy.length) - 1
  );
  let bestOffset = 0;
  let bestCorrelation = -Infinity;
  let selfCorrelation = 0;
  for (let i = 0; i < sourceEnergy.length; i++) {
    selfCorrelation += sourceEnergy[i] * sourceEnergy[i];
  }
  if (selfCorrelation === 0) selfCorrelation = 1;
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let correlation = 0;
    let count = 0;
    for (let i = 0; i < sourceEnergy.length; i++) {
      const j = i + shift;
      if (j < 0 || j >= targetEnergy.length) continue;
      correlation += sourceEnergy[i] * targetEnergy[j];
      count++;
    }
    if (count < 10) continue;
    const normalized = correlation / selfCorrelation;
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestOffset = shift;
    }
  }
  const offsetSeconds = bestOffset * 0.05;
  const confidence = Math.min(1, Math.max(0, bestCorrelation));
  return {
    offsetIndex: Math.round(offsetSeconds / FP_INDEX_TO_SECONDS),
    // keep compatible
    confidence
  };
}
function computeEnergyProfile(samples, windowSize) {
  const numWindows = Math.floor(samples.length / windowSize);
  const energy = new Float64Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    energy[w] = Math.sqrt(sum / windowSize);
  }
  return energy;
}
async function computeBatchMatch(videoAssets, audioAssets, ffmpegPath, ffprobePath, fpcalcPath, onProgress) {
  const pairs = [];
  const usedAudioIds = /* @__PURE__ */ new Set();
  const totalPairs = videoAssets.length;
  for (let vi = 0; vi < videoAssets.length; vi++) {
    const video = videoAssets[vi];
    const candidates = audioAssets.filter((a) => !usedAudioIds.has(a.id)).map((a) => ({
      audio: a,
      nameScore: scoreFilenameSimilarity(video.name, a.name)
    })).sort((a, b) => b.nameScore - a.nameScore);
    let matched = false;
    for (const candidate of candidates) {
      onProgress == null ? void 0 : onProgress({
        completedPairs: vi,
        totalPairs,
        currentVideoName: video.name,
        currentAudioName: candidate.audio.name
      });
      try {
        const syncResult = await computeSyncOffset(
          video.filePath,
          candidate.audio.filePath,
          ffmpegPath,
          ffprobePath,
          fpcalcPath
        );
        if (syncResult.confidence >= 0.4) {
          pairs.push({
            videoAssetId: video.id,
            audioAssetId: candidate.audio.id,
            offsetSeconds: syncResult.offsetSeconds,
            matchMethod: syncResult.method,
            nameScore: candidate.nameScore,
            waveformScore: syncResult.confidence
          });
          usedAudioIds.add(candidate.audio.id);
          matched = true;
          break;
        }
      } catch {
        continue;
      }
    }
  }
  const matchedVideoIds = new Set(pairs.map((p) => p.videoAssetId));
  const unmatchedVideos = videoAssets.filter((v) => !matchedVideoIds.has(v.id)).map((v) => v.id);
  const unmatchedAudio = audioAssets.filter((a) => !usedAudioIds.has(a.id)).map((a) => a.id);
  onProgress == null ? void 0 : onProgress({ completedPairs: totalPairs, totalPairs, currentVideoName: "", currentAudioName: "" });
  return { pairs, unmatchedVideos, unmatchedAudio };
}
async function computeSyncOffset(sourceVideoPath, targetAudioPath, ffmpegPath, ffprobePath, fpcalcPath) {
  let tempWavSource = null;
  let tempWavTarget = null;
  try {
    const [sourceTc, targetTc] = await Promise.all([
      extractTimecode(sourceVideoPath, ffprobePath),
      extractTimecode(targetAudioPath, ffprobePath)
    ]);
    if (sourceTc && targetTc) {
      const fps = sourceTc.fps;
      const offset = computeTimecodeOffset(sourceTc.timecode, targetTc.timecode, fps);
      if (offset !== null) {
        return { offsetSeconds: offset, method: "timecode", confidence: 1 };
      }
    }
    const [sourceHasAudio, targetHasAudio] = await Promise.all([
      hasAudioStream(sourceVideoPath, ffprobePath),
      hasAudioStream(targetAudioPath, ffprobePath)
    ]);
    if (!sourceHasAudio) throw new Error("Source video has no audio stream");
    if (!targetHasAudio) throw new Error("Target audio file has no audio stream");
    [tempWavSource, tempWavTarget] = await Promise.all([
      extractAudioToTempPcm(sourceVideoPath, ffmpegPath),
      extractAudioToTempPcm(targetAudioPath, ffmpegPath)
    ]);
    const [sourcePcm, targetPcm] = await Promise.all([
      readPcmAsFloat32(tempWavSource),
      readPcmAsFloat32(targetWavTarget)
    ]);
    const correlation = crossCorrelatePcm(sourcePcm, targetPcm, SYNC_SAMPLE_RATE);
    const offsetSeconds = correlation.offsetIndex * FP_INDEX_TO_SECONDS;
    return {
      offsetSeconds,
      method: "waveform",
      confidence: correlation.confidence
    };
  } finally {
    const cleanupFile = async (p) => {
      if (!p) return;
      try {
        await unlink(p);
        await rmdir(path.dirname(p));
      } catch {
      }
    };
    await Promise.all([cleanupFile(tempWavSource), cleanupFile(tempWavTarget)]);
  }
}
export {
  FP_INDEX_TO_SECONDS,
  computeBatchMatch,
  computeSyncOffset,
  computeTimecodeOffset,
  crossCorrelateFingerprints,
  crossCorrelatePcm,
  extractAudioToTempPcm,
  extractFingerprint,
  extractTimecode,
  hasAudioStream,
  levenshteinDistance,
  parseTimecode,
  popcount32,
  readPcmAsFloat32,
  scoreFilenameSimilarity
};
