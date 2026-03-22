/**
 * Media Worker Thread
 *
 * Runs in a Node.js worker_threads context (no Electron APIs).
 * Processes ffmpeg / ffprobe jobs submitted by the main process via
 * parentPort messages.  Maintains a priority queue and limits
 * concurrency to MAX_CONCURRENT simultaneous jobs.
 */

import { parentPort } from 'worker_threads';
import { spawn } from 'child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  MediaJob,
  StandardMediaJob,
  MainMessageToWorker,
  WorkerMessageToMain,
  MediaMetadata,
} from './media-worker-types.js';
import { JOB_PRIORITY } from './media-worker-types.js';

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_JOBS = 3;
const MAX_CONCURRENCY_COST = 2;
const JOB_COST: Record<MediaJob['type'], number> = {
  extract_metadata: 0,
  generate_thumbnail: 1,
  compute_waveform: 1,
  generate_filmstrip: 1,
  generate_proxy: 2,
  sync_compute_offset: 2,
  sync_batch_match: 2,
};
const LIGHT_FFMPEG_THREADS = '1';
const PROXY_FFMPEG_THREADS = '2';
const THUMBNAIL_FALLBACK_OFFSET_SECONDS = 0.1;
const FILMSTRIP_FRAME_COUNT = 18;
const FILMSTRIP_FRAME_WIDTH = 160;
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf', '.m4v']);

let ffmpegPath = '';
let ffprobePath = '';
let fpcalcPath = '';

/** Priority-sorted queue of jobs waiting to run. */
const queue: MediaJob[] = [];

/** Currently running jobs, keyed by job id. */
const activeJobs = new Map<
  string,
  { process?: ReturnType<typeof spawn>; job: MediaJob }
>();

interface NativeMediaAddon {
  generateThumbnail: (
    sourcePath: string,
    outputPath: string,
    normalizedPosition?: number,
  ) => string;
  generateFilmstripFrames: (
    sourcePath: string,
    outputDir: string,
    prefix: string,
    frameCount: number,
    frameWidth: number,
  ) => string[];
}

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveNativeAddonPath(): string | null {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, 'native', 'cinegen_avfoundation.node')
      : null,
    path.resolve(process.cwd(), 'native', 'avfoundation', 'build', 'Release', 'cinegen_avfoundation.node'),
    path.resolve(moduleDir, '../../native/avfoundation/build/Release/cinegen_avfoundation.node'),
    path.resolve(moduleDir, '../native/avfoundation/build/Release/cinegen_avfoundation.node'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

let nativeAddon: NativeMediaAddon | null = null;
if (process.platform === 'darwin') {
  const addonPath = resolveNativeAddonPath();
  if (addonPath) {
    try {
      nativeAddon = require(addonPath) as NativeMediaAddon;
      console.log('[media-worker] AVFoundation addon loaded:', addonPath);
    } catch (error) {
      console.error('[media-worker] Failed to load AVFoundation addon:', error);
    }
  } else {
    console.warn('[media-worker] AVFoundation addon not found, falling back to ffmpeg');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a typed message back to the main process. */
function send(msg: WorkerMessageToMain): void {
  parentPort?.postMessage(msg);
}

/** Insert a job into the queue respecting priority order. */
function enqueue(job: MediaJob): void {
  const priority = JOB_PRIORITY[job.type];
  const idx = queue.findIndex((q) => JOB_PRIORITY[q.type] > priority);
  if (idx === -1) {
    queue.push(job);
  } else {
    queue.splice(idx, 0, job);
  }
}

/** Drain the queue while staying under the current background work budget. */
function processQueue(): void {
  while (activeJobs.size < MAX_CONCURRENT_JOBS && queue.length > 0) {
    const activeCost = Array.from(activeJobs.values()).reduce(
      (sum, active) => sum + JOB_COST[active.job.type],
      0,
    );
    const nextIndex = queue.findIndex(
      (queuedJob) => activeCost + JOB_COST[queuedJob.type] <= MAX_CONCURRENCY_COST,
    );
    if (nextIndex === -1) break;
    const [job] = queue.splice(nextIndex, 1);
    runJob(job);
  }
}

// ---------------------------------------------------------------------------
// Spawn helper — collects stdout / stderr from a child process
// ---------------------------------------------------------------------------

interface SpawnResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

function spawnAsync(
  bin: string,
  args: string[],
  jobId: string,
): { promise: Promise<SpawnResult>; child: ReturnType<typeof spawn> } {
  const child = spawn(bin, args);
  const stdoutChunks: Buffer[] = [];
  let stderr = '';

  const promise = new Promise<SpawnResult>((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr, code });
    });
  });

  return { promise, child };
}

function isVideoInput(inputPath: string): boolean {
  return VIDEO_EXTS.has(path.extname(inputPath).toLowerCase());
}

async function probeDuration(job: StandardMediaJob): Promise<number> {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    job.inputPath,
  ];

  const { promise, child } = spawnAsync(ffprobePath, args, job.id);
  activeJobs.set(job.id, { process: child, job });
  const { stdout, code } = await promise;
  if (code !== 0) {
    throw new Error(`ffprobe exited with code ${code}`);
  }

  try {
    const parsed = JSON.parse(stdout.toString()) as { format?: { duration?: string } };
    return parseFloat(parsed.format?.duration ?? '0') || 0;
  } catch {
    throw new Error('Failed to parse ffprobe duration');
  }
}

// ---------------------------------------------------------------------------
// Job implementations
// ---------------------------------------------------------------------------

/**
 * extract_metadata — spawn ffprobe with JSON output, parse into MediaMetadata.
 */
async function extractMetadata(job: StandardMediaJob): Promise<MediaMetadata> {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    job.inputPath,
  ];

  const { promise, child } = spawnAsync(ffprobePath, args, job.id);
  activeJobs.set(job.id, { process: child, job });

  const { stdout, code } = await promise;

  if (code !== 0) {
    throw new Error(`ffprobe exited with code ${code}`);
  }

  let parsed: {
    format?: {
      duration?: string;
      size?: string;
      bit_rate?: string;
    };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      channels?: number;
    }>;
  };

  try {
    parsed = JSON.parse(stdout.toString());
  } catch {
    throw new Error('Failed to parse ffprobe JSON output');
  }

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  // Parse frame-rate fraction like "30000/1001"
  let fps = 0;
  if (videoStream?.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      fps = den !== 0 ? num / den : 0;
    } else {
      fps = parseFloat(parts[0]) || 0;
    }
  }

  const metadata: MediaMetadata = {
    duration: parseFloat(parsed.format?.duration ?? '0'),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: Math.round(fps * 100) / 100,
    codec: videoStream?.codec_name ?? '',
    fileSize: parseInt(parsed.format?.size ?? '0', 10),
    bitrate: parseInt(parsed.format?.bit_rate ?? '0', 10),
    audioChannels: audioStream?.channels ?? 0,
    audioCodec: audioStream?.codec_name ?? '',
  };

  return metadata;
}

/**
 * generate_thumbnail — extract a midpoint JPEG frame for video, or a quick early frame fallback.
 */
async function generateThumbnail(job: StandardMediaJob): Promise<{ outputPath: string }> {
  if (nativeAddon && isVideoInput(job.inputPath)) {
    activeJobs.set(job.id, { job });
    try {
      nativeAddon.generateThumbnail(job.inputPath, job.outputPath, 0.5);
      return { outputPath: job.outputPath };
    } finally {
      activeJobs.delete(job.id);
    }
  }

  let seekTime = THUMBNAIL_FALLBACK_OFFSET_SECONDS;
  try {
    const duration = await probeDuration(job);
    if (duration > 0) {
      seekTime = Math.max(0, duration * 0.5);
    }
  } catch {
    // Fall back to a quick early frame if probing fails.
  }

  const args = [
    '-y',
    '-threads', LIGHT_FFMPEG_THREADS,
    '-ss', `${seekTime}`,
    '-i', job.inputPath,
    '-frames:v', '1',
    '-q:v', '2',
    job.outputPath,
  ];

  const { promise, child } = spawnAsync(ffmpegPath, args, job.id);
  activeJobs.set(job.id, { process: child, job });

  const { code, stderr } = await promise;

  if (code !== 0) {
    throw new Error(`ffmpeg thumbnail exited with code ${code}: ${stderr}`);
  }

  return { outputPath: job.outputPath };
}

/**
 * compute_waveform — pipe raw PCM f32le mono 8 kHz, compute high-res peaks.
 * Writes full peaks to outputPath JSON file for streaming access.
 * Returns a downsampled summary for inline metadata storage.
 */
async function computeWaveform(job: StandardMediaJob): Promise<{ peaks: number[]; peaksPath: string }> {
  const args = [
    '-threads', LIGHT_FFMPEG_THREADS,
    '-i', job.inputPath,
    '-vn',
    '-f', 'f32le',
    '-ac', '1',
    '-ar', '8000',
    'pipe:1',
  ];

  const child = spawn(ffmpegPath, args);
  activeJobs.set(job.id, { process: child, job });

  const pcmChunks: Buffer[] = [];

  const promise = new Promise<Buffer>((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => pcmChunks.push(chunk));
    child.stderr?.on('data', () => {
      /* consume stderr so the pipe doesn't stall */
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg waveform exited with code ${code}`));
      } else {
        resolve(Buffer.concat(pcmChunks));
      }
    });
  });

  const pcmBuffer = await promise;

  // PCM is float32 little-endian (4 bytes per sample)
  const sampleCount = Math.floor(pcmBuffer.length / 4);
  // High-res: ~500 peaks/sec at 8kHz, no cap — written to file
  const durationSec = sampleCount / 8000;
  const TARGET_PEAKS = Math.max(2000, Math.round(durationSec * 500));
  const samplesPerPeak = Math.max(1, Math.floor(sampleCount / TARGET_PEAKS));
  const rawPeaks: number[] = [];

  for (let i = 0; i < sampleCount; i += samplesPerPeak) {
    let peak = 0;
    const end = Math.min(i + samplesPerPeak, sampleCount);
    for (let j = i; j < end; j++) {
      const val = Math.abs(pcmBuffer.readFloatLE(j * 4));
      if (val > peak) peak = val;
    }
    rawPeaks.push(peak);
  }

  const globalMax = rawPeaks.reduce((max, value) => (value > max ? value : max), 0.01);
  const peaks = rawPeaks.map((value) => Math.round((value / globalMax) * 1000) / 1000);

  // Write full peaks to file
  fs.mkdirSync(path.dirname(job.outputPath), { recursive: true });
  fs.writeFileSync(job.outputPath, JSON.stringify(peaks));

  // Return a denser inline summary so long clips still look usable before the
  // full waveform JSON is loaded into the renderer.
  const inlineSummaryTarget = Math.max(1200, Math.min(4096, Math.round(durationSec * 24)));
  let summaryPeaks = peaks;
  if (peaks.length > inlineSummaryTarget) {
    const binSize = peaks.length / inlineSummaryTarget;
    summaryPeaks = [];
    for (let i = 0; i < inlineSummaryTarget; i++) {
      const start = Math.floor(i * binSize);
      const end = Math.min(Math.floor((i + 1) * binSize), peaks.length);
      let max = 0;
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        const value = peaks[j];
        sum += value;
        count++;
        if (value > max) max = value;
      }
      const mean = count > 0 ? sum / count : 0;
      summaryPeaks.push(Math.round((mean * 0.72 + max * 0.28) * 1000) / 1000);
    }
  }

  return { peaks: summaryPeaks, peaksPath: job.outputPath };
}

/**
 * generate_filmstrip — use AVFoundation frames on macOS, fall back to an ffmpeg tile sprite elsewhere.
 */
async function generateFilmstrip(job: StandardMediaJob): Promise<{ outputPath?: string; frames?: string[] }> {
  if (nativeAddon && isVideoInput(job.inputPath)) {
    activeJobs.set(job.id, { job });
    try {
      const frames = nativeAddon.generateFilmstripFrames(
        job.inputPath,
        path.dirname(job.outputPath),
        path.basename(job.outputPath, path.extname(job.outputPath)),
        FILMSTRIP_FRAME_COUNT,
        FILMSTRIP_FRAME_WIDTH,
      );
      return { frames };
    } finally {
      activeJobs.delete(job.id);
    }
  }

  const duration = await probeDuration(job);

  if (duration <= 0) {
    throw new Error('Cannot generate filmstrip: duration is 0');
  }

  // Step 2: Generate filmstrip sprite sheet (cap at 120 frames to avoid excessive width)
  const MAX_FILMSTRIP_FRAMES = 120;
  const N = Math.min(Math.ceil(duration), MAX_FILMSTRIP_FRAMES);
  const sampleRate = duration / N;
  const filterComplex = `fps=1/${Math.max(1, Math.floor(sampleRate))},scale=160:-2,tile=${N}x1`;
  const ffmpegArgs = [
    '-y',
    '-threads', LIGHT_FFMPEG_THREADS,
    '-i', job.inputPath,
    '-vf', filterComplex,
    '-frames:v', '1',
    job.outputPath,
  ];

  const ffmpegChild = spawn(ffmpegPath, ffmpegArgs);
  activeJobs.set(job.id, { process: ffmpegChild, job });

  const ffmpegResult = await new Promise<SpawnResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    ffmpegChild.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    ffmpegChild.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpegChild.on('error', (err) => reject(err));
    ffmpegChild.on('close', (code) => {
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr, code });
    });
  });

  if (ffmpegResult.code !== 0) {
    throw new Error(
      `ffmpeg filmstrip exited with code ${ffmpegResult.code}: ${ffmpegResult.stderr}`,
    );
  }

  return { outputPath: job.outputPath };
}

/**
 * generate_proxy — transcode to 960-wide H.264, report progress via
 * time= pattern in ffmpeg stderr.
 */
async function generateProxy(job: StandardMediaJob): Promise<{ outputPath: string }> {
  // Step 1: Probe duration for progress calculation
  const probeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    job.inputPath,
  ];

  const { promise: probeProm, child: probeChild } = spawnAsync(
    ffprobePath,
    probeArgs,
    job.id,
  );
  activeJobs.set(job.id, { process: probeChild, job });

  const probeResult = await probeProm;

  let totalDuration = 0;
  try {
    const probeJson = JSON.parse(probeResult.stdout.toString());
    totalDuration = parseFloat(probeJson.format?.duration ?? '0');
  } catch {
    // If we can't determine duration we still proceed, just no progress reports
  }

  const runProxyEncode = async (videoArgs: string[]): Promise<SpawnResult> => {
    const ffmpegArgs = [
      '-y',
      '-threads', PROXY_FFMPEG_THREADS,
      '-i', job.inputPath,
      '-vf', 'scale=960:-2',
      ...videoArgs,
      '-c:a', 'aac',
      '-b:a', '128k',
      job.outputPath,
    ];

    const ffmpegChild = spawn(ffmpegPath, ffmpegArgs);
    activeJobs.set(job.id, { process: ffmpegChild, job });

    return new Promise<SpawnResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      let stderr = '';

      ffmpegChild.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      ffmpegChild.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;

        if (totalDuration > 0) {
          const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            const centis = parseInt(timeMatch[4], 10);
            const currentTime = hours * 3600 + minutes * 60 + seconds + centis / 100;
            const progress = Math.min(
              Math.round((currentTime / totalDuration) * 100),
              100,
            );
            send({ type: 'job:progress', jobId: job.id, progress });
          }
        }
      });

      ffmpegChild.on('error', (err) => reject(err));
      ffmpegChild.on('close', (code) => {
        resolve({ stdout: Buffer.concat(stdoutChunks), stderr, code });
      });
    });
  };

  const preferredVideoArgs = process.platform === 'darwin'
    ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '5M', '-maxrate', '8M']
    : ['-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast'];

  let result = await runProxyEncode(preferredVideoArgs);
  if (result.code !== 0 && process.platform === 'darwin') {
    result = await runProxyEncode(['-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast']);
  }

  if (result.code !== 0) {
    throw new Error(`ffmpeg proxy exited with code ${result.code}: ${result.stderr}`);
  }

  return { outputPath: job.outputPath };
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

async function runJob(job: MediaJob): Promise<void> {
  try {
    let result: unknown;

    switch (job.type) {
      case 'extract_metadata':
        result = await extractMetadata(job);
        break;
      case 'generate_thumbnail':
        result = await generateThumbnail(job);
        break;
      case 'compute_waveform':
        result = await computeWaveform(job);
        break;
      case 'generate_filmstrip':
        result = await generateFilmstrip(job);
        break;
      case 'generate_proxy':
        result = await generateProxy(job);
        break;
      case 'sync_compute_offset': {
        const { computeSyncOffset } = await import('./audio-sync.js');
        result = await computeSyncOffset(
          job.sourceFilePath,
          job.targetFilePath,
          ffmpegPath,
          ffprobePath,
          fpcalcPath,
        );
        break;
      }
      case 'sync_batch_match': {
        const { computeBatchMatch } = await import('./audio-sync.js');
        result = await computeBatchMatch(
          job.videoAssets,
          job.audioAssets,
          ffmpegPath,
          ffprobePath,
          fpcalcPath,
          (progress) => {
            send({
              type: 'sync:batch-progress',
              jobId: job.id,
              ...progress,
            });
          },
        );
        break;
      }
    }

    activeJobs.delete(job.id);
    send({ type: 'job:complete', jobId: job.id, result });
  } catch (err) {
    activeJobs.delete(job.id);
    send({
      type: 'job:error',
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  processQueue();
}

// ---------------------------------------------------------------------------
// Message handler — receive commands from the main process
// ---------------------------------------------------------------------------

parentPort?.on('message', (msg: MainMessageToWorker) => {
  switch (msg.type) {
    case 'config':
      ffmpegPath = msg.ffmpegPath;
      ffprobePath = msg.ffprobePath;
      fpcalcPath = msg.fpcalcPath;
      send({ type: 'ready' });
      break;

    case 'job:submit':
      enqueue(msg.job);
      processQueue();
      break;

    case 'job:cancel': {
      // Try to remove from queue first
      const queueIdx = queue.findIndex((j) => j.id === msg.jobId);
      if (queueIdx !== -1) {
        queue.splice(queueIdx, 1);
        send({ type: 'job:error', jobId: msg.jobId, error: 'Cancelled' });
        break;
      }

      // If running, kill the child process
      const active = activeJobs.get(msg.jobId);
      if (active) {
        active.process?.kill('SIGTERM');
        activeJobs.delete(msg.jobId);
        send({ type: 'job:error', jobId: msg.jobId, error: 'Cancelled' });
        processQueue();
      }
      break;
    }
  }
});
