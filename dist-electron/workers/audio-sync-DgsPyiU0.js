import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const execFileAsync = promisify(execFile);
const FINGERPRINT_SAMPLE_RATE = 16e3;
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
    confidence: Math.max(0, bestScore),
    _offsetSeconds: bestOffset * FP_INDEX_TO_SECONDS
  };
}
function searchFingerprintAnchor(anchor, search) {
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
    _offsetSeconds: bestOffset * FP_INDEX_TO_SECONDS
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
async function extractFingerprint(filePath, fpcalcPath, lengthSeconds = 300) {
  const safeLength = !Number.isFinite(lengthSeconds) || lengthSeconds < 0 ? 300 : Math.round(lengthSeconds);
  const { stdout } = await execFileAsync(fpcalcPath, ["-raw", "-length", String(safeLength), filePath], {
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
const FAST_SYNC_WINDOW_SECONDS = 20;
const FAST_SYNC_MIN_PAIR_CONFIDENCE = 0.4;
const FAST_SYNC_ACCEPT_CONFIDENCE = 0.55;
async function extractMediaDuration(filePath, ffprobePath) {
  var _a;
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      filePath
    ]);
    const probe = JSON.parse(stdout);
    const duration = Number((_a = probe.format) == null ? void 0 : _a.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}
function buildAnalysisWindows(durationSeconds, windowSeconds = FAST_SYNC_WINDOW_SECONDS) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const clipWindow = Math.min(windowSeconds, durationSeconds);
  const maxStart = Math.max(0, durationSeconds - clipWindow);
  const candidates = [
    { label: "start", startSeconds: 0, durationSeconds: clipWindow },
    {
      label: "middle",
      startSeconds: Math.max(0, durationSeconds / 2 - clipWindow / 2),
      durationSeconds: clipWindow
    },
    { label: "end", startSeconds: maxStart, durationSeconds: clipWindow }
  ];
  const dedupeThreshold = Math.max(1, clipWindow * 0.1);
  const windows = [];
  for (const candidate of candidates) {
    const startSeconds = Math.max(0, Math.min(candidate.startSeconds, maxStart));
    if (windows.some((window) => Math.abs(window.startSeconds - startSeconds) < dedupeThreshold)) {
      continue;
    }
    windows.push({
      label: candidate.label,
      startSeconds,
      durationSeconds: Math.min(clipWindow, durationSeconds - startSeconds)
    });
  }
  return windows;
}
function summarizeOffsetVotes(votes, label) {
  if (votes.length === 0) {
    console.log(`[audio-sync] ${label}: no valid matches found`);
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  }
  console.log(`[audio-sync] ${label} votes:`, votes.map(
    (vote) => `${vote.label}: offset=${vote.offsetSeconds.toFixed(2)}s conf=${vote.confidence.toFixed(3)}`
  ).join(" | "));
  votes.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  let bestGroup = [];
  let bestGroupScore = -Infinity;
  for (let i = 0; i < votes.length; i++) {
    const group = [votes[i]];
    for (let j = i + 1; j < votes.length; j++) {
      if (Math.abs(votes[j].offsetSeconds - votes[i].offsetSeconds) < 1.5) {
        group.push(votes[j]);
      }
    }
    const avgConfidence2 = group.reduce((sum, vote) => sum + vote.confidence, 0) / group.length;
    const score = group.length * avgConfidence2;
    if (score > bestGroupScore) {
      bestGroupScore = score;
      bestGroup = group;
    }
  }
  const totalConfidence = bestGroup.reduce((sum, vote) => sum + vote.confidence, 0);
  const weightedOffset = bestGroup.reduce((sum, vote) => sum + vote.offsetSeconds * vote.confidence, 0) / totalConfidence;
  const avgConfidence = totalConfidence / bestGroup.length;
  console.log(
    `[audio-sync] ${label} result: offset=${weightedOffset.toFixed(3)}s confidence=${avgConfidence.toFixed(3)} (${bestGroup.length}/${votes.length} votes agreed)`
  );
  return {
    offsetIndex: 0,
    confidence: Math.min(1, avgConfidence),
    _offsetSeconds: weightedOffset
  };
}
async function extractAudioToTempPcm(inputPath, ffmpegPath, options = {}) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cinegen-sync-"));
  const pcmPath = path.join(tmpDir, "audio.raw");
  const args = [
    "-y"
  ];
  if (typeof options.startSeconds === "number" && options.startSeconds > 0) {
    args.push("-ss", options.startSeconds.toFixed(3));
  }
  args.push("-i", inputPath);
  if (typeof options.durationSeconds === "number" && options.durationSeconds > 0) {
    args.push("-t", options.durationSeconds.toFixed(3));
  }
  args.push(
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(SYNC_SAMPLE_RATE),
    "-ac",
    "1",
    "-f",
    "s16le",
    pcmPath
  );
  await execFileAsync(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 });
  return pcmPath;
}
async function extractAudioToTempWav(inputPath, ffmpegPath, options = {}) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cinegen-sync-"));
  const wavPath = path.join(tmpDir, "audio.wav");
  const args = ["-y"];
  if (typeof options.startSeconds === "number" && options.startSeconds > 0) {
    args.push("-ss", options.startSeconds.toFixed(3));
  }
  args.push("-i", inputPath);
  if (typeof options.durationSeconds === "number" && options.durationSeconds > 0) {
    args.push("-t", options.durationSeconds.toFixed(3));
  }
  args.push(
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(FINGERPRINT_SAMPLE_RATE),
    "-ac",
    "1",
    wavPath
  );
  await execFileAsync(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 });
  return wavPath;
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
function crossCorrelatePcm(source, target, sampleRate) {
  const coarseStep = Math.floor(sampleRate * 0.25);
  const fineStep = Math.floor(sampleRate * 0.01);
  const shorter = source.length <= target.length ? source : target;
  const longer = source.length <= target.length ? target : source;
  const flipped = source.length > target.length;
  console.log(`[audio-sync] Anchor file: ${(shorter.length / sampleRate).toFixed(1)}s, Search file: ${(longer.length / sampleRate).toFixed(1)}s${flipped ? " (flipped)" : ""}`);
  const skipEdge = Math.min(5 * sampleRate, Math.floor(shorter.length * 0.05));
  const usableLen = shorter.length - 2 * skipEdge;
  const desiredAnchorSamples = 10 * sampleRate;
  const minAnchorSamples = Math.max(1, Math.floor(sampleRate * 2));
  const anchorSamples = Math.max(
    Math.min(desiredAnchorSamples, usableLen),
    Math.min(minAnchorSamples, usableLen)
  );
  const numAnchors = Math.min(6, Math.max(1, Math.floor(usableLen / Math.max(1, anchorSamples))));
  if (usableLen <= 0 || anchorSamples <= 0 || longer.length < anchorSamples) {
    return { offsetIndex: 0, confidence: 0, _offsetSeconds: 0 };
  }
  const anchorSpacing = Math.floor((usableLen - anchorSamples) / Math.max(1, numAnchors - 1));
  const votes = [];
  for (let a = 0; a < numAnchors; a++) {
    const anchorStart = skipEdge + a * anchorSpacing;
    const anchorEnd = Math.min(anchorStart + anchorSamples, shorter.length);
    const anchor = shorter.subarray(anchorStart, anchorEnd);
    const anchorLen = anchor.length;
    if (anchorLen < anchorSamples * 0.5) continue;
    let aSum = 0, aSum2 = 0;
    for (let i = 0; i < anchorLen; i++) {
      aSum += anchor[i];
      aSum2 += anchor[i] * anchor[i];
    }
    const aMean = aSum / anchorLen;
    const aVar = aSum2 / anchorLen - aMean * aMean;
    if (aVar < 1e-10) continue;
    const computeNCC = (pos) => {
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
    const searchEnd = longer.length - anchorLen;
    let bestNCC = -Infinity;
    let bestPos = 0;
    for (let pos = 0; pos <= searchEnd; pos += coarseStep) {
      const ncc = computeNCC(pos);
      if (ncc > bestNCC) {
        bestNCC = ncc;
        bestPos = pos;
      }
    }
    const fineStart = Math.max(0, bestPos - coarseStep * 2);
    const fineEnd = Math.min(searchEnd, bestPos + coarseStep * 2);
    for (let pos = fineStart; pos <= fineEnd; pos += fineStep) {
      const ncc = computeNCC(pos);
      if (ncc > bestNCC) {
        bestNCC = ncc;
        bestPos = pos;
      }
    }
    if (bestNCC > 0.15) {
      const rawOffset = (bestPos - anchorStart) / sampleRate;
      const finalOffset = flipped ? rawOffset : -rawOffset;
      votes.push({ offsetSeconds: finalOffset, confidence: bestNCC, label: `a${a}` });
    }
  }
  return summarizeOffsetVotes(votes, "PCM anchor");
}
async function extractFingerprintWindows(inputPath, ffmpegPath, fpcalcPath, windows, tempFiles) {
  return Promise.all(
    windows.map(async (window) => {
      const wavPath = await extractAudioToTempWav(inputPath, ffmpegPath, {
        startSeconds: window.startSeconds,
        durationSeconds: window.durationSeconds
      });
      tempFiles.push(wavPath);
      const fingerprint = await extractFingerprint(wavPath, fpcalcPath);
      return { ...window, fingerprint };
    })
  );
}
async function computeSampledWaveformSyncOffset(sourceVideoPath, targetAudioPath, ffmpegPath, ffprobePath, fpcalcPath, tempFiles) {
  const [sourceDuration, targetDuration] = await Promise.all([
    extractMediaDuration(sourceVideoPath, ffprobePath),
    extractMediaDuration(targetAudioPath, ffprobePath)
  ]);
  if (!sourceDuration || !targetDuration) {
    console.log("[audio-sync] Sampled pass skipped: missing duration metadata");
    return null;
  }
  const sourceIsShorter = sourceDuration <= targetDuration;
  const anchorPath = sourceIsShorter ? sourceVideoPath : targetAudioPath;
  const searchPath = sourceIsShorter ? targetAudioPath : sourceVideoPath;
  const anchorWindows = buildAnalysisWindows(Math.min(sourceDuration, targetDuration));
  if (anchorWindows.length === 0) {
    console.log("[audio-sync] Sampled pass skipped: no analysis windows");
    return null;
  }
  console.log(
    `[audio-sync] Sampled fingerprint pass: ${anchorWindows.length} anchor windows against full ${sourceIsShorter ? "target" : "source"} fingerprint`
  );
  const [anchorFingerprintWindows, searchFingerprint] = await Promise.all([
    extractFingerprintWindows(anchorPath, ffmpegPath, fpcalcPath, anchorWindows, tempFiles),
    extractFingerprint(searchPath, fpcalcPath, 0)
  ]);
  const votes = [];
  for (const anchorWindow of anchorFingerprintWindows) {
    const correlation = searchFingerprintAnchor(anchorWindow.fingerprint, searchFingerprint);
    if (correlation.confidence < FAST_SYNC_MIN_PAIR_CONFIDENCE) continue;
    const rawOffset = correlation._offsetSeconds - anchorWindow.startSeconds;
    const finalOffset = sourceIsShorter ? -rawOffset : rawOffset;
    votes.push({
      offsetSeconds: finalOffset,
      confidence: correlation.confidence,
      label: anchorWindow.label
    });
  }
  return summarizeOffsetVotes(votes, "Sampled fingerprint");
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
  const tempPcmFiles = [];
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
    const sampledCorrelation = await computeSampledWaveformSyncOffset(
      sourceVideoPath,
      targetAudioPath,
      ffmpegPath,
      ffprobePath,
      fpcalcPath,
      tempPcmFiles
    );
    if (sampledCorrelation && sampledCorrelation.confidence >= FAST_SYNC_ACCEPT_CONFIDENCE) {
      console.log(
        `[audio-sync] Using sampled waveform result (confidence=${sampledCorrelation.confidence.toFixed(3)})`
      );
      return {
        offsetSeconds: sampledCorrelation._offsetSeconds,
        method: "waveform",
        confidence: sampledCorrelation.confidence
      };
    }
    console.log(
      `[audio-sync] Falling back to full-file waveform sync${sampledCorrelation ? ` (sampled confidence=${sampledCorrelation.confidence.toFixed(3)})` : ""}`
    );
    const [tempWavSource, tempWavTarget] = await Promise.all([
      extractAudioToTempPcm(sourceVideoPath, ffmpegPath),
      extractAudioToTempPcm(targetAudioPath, ffmpegPath)
    ]);
    tempPcmFiles.push(tempWavSource, tempWavTarget);
    const [sourcePcm, targetPcm] = await Promise.all([
      readPcmAsFloat32(tempWavSource),
      readPcmAsFloat32(tempWavTarget)
    ]);
    console.log(`[audio-sync] Source PCM: ${sourcePcm.length} samples (${(sourcePcm.length / SYNC_SAMPLE_RATE).toFixed(1)}s)`);
    console.log(`[audio-sync] Target PCM: ${targetPcm.length} samples (${(targetPcm.length / SYNC_SAMPLE_RATE).toFixed(1)}s)`);
    const correlation = crossCorrelatePcm(sourcePcm, targetPcm, SYNC_SAMPLE_RATE);
    return {
      offsetSeconds: correlation._offsetSeconds,
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
    await Promise.all(tempPcmFiles.map((filePath) => cleanupFile(filePath)));
  }
}
export {
  FP_INDEX_TO_SECONDS,
  buildAnalysisWindows,
  computeBatchMatch,
  computeSyncOffset,
  computeTimecodeOffset,
  crossCorrelateFingerprints,
  crossCorrelatePcm,
  extractAudioToTempPcm,
  extractAudioToTempWav,
  extractFingerprint,
  extractMediaDuration,
  extractTimecode,
  hasAudioStream,
  levenshteinDistance,
  parseTimecode,
  popcount32,
  readPcmAsFloat32,
  scoreFilenameSimilarity,
  searchFingerprintAnchor
};
