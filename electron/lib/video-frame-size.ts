import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getFfmpegPath, getFfprobePath } from './ffmpeg-paths.js';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 20 * 1000;
const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1000;

export interface VideoFrameSize {
  width: number;
  height: number;
}

export interface VideoProbeSource {
  bytes: Buffer;
  format: string;
  filePath?: string;
}

export function parseVideoFrameSize(stdout: string): VideoFrameSize | undefined {
  const [width, height] = stdout.trim().split(/[x,\s]+/, 2).map((value) => Number.parseInt(value, 10));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

export function minimumEvenFrameSize(
  source: VideoFrameSize,
  minimumPixels: number,
): VideoFrameSize {
  if (source.width * source.height >= minimumPixels) return source;
  const scale = Math.sqrt(minimumPixels / (source.width * source.height));
  let width = Math.ceil((source.width * scale) / 2) * 2;
  let height = Math.ceil((source.height * scale) / 2) * 2;
  while (width * height < minimumPixels) {
    if (width / source.width <= height / source.height) width += 2;
    else height += 2;
  }
  return { width, height };
}

async function probeFile(filePath: string): Promise<VideoFrameSize | undefined> {
  const { stdout } = await execFileAsync(getFfprobePath(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x',
    filePath,
  ], { timeout: PROBE_TIMEOUT_MS });
  return parseVideoFrameSize(stdout);
}

/**
 * Reads the frame size of a video's first stream. Returns undefined when ffprobe cannot
 * report one, so callers fall back to letting the provider judge the file.
 */
export async function probeVideoFrameSize(source: VideoProbeSource): Promise<VideoFrameSize | undefined> {
  try {
    if (source.filePath) return await probeFile(source.filePath);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-probe-'));
    try {
      const scratch = path.join(dir, `reference.${source.format}`);
      await fs.writeFile(scratch, source.bytes);
      return await probeFile(scratch);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    return undefined;
  }
}

/**
 * Creates an H.264 MP4 compatibility copy at the requested dimensions. The source file is
 * never modified, and temporary files are removed after the encoded bytes are loaded.
 */
async function transcodeVideo(source: VideoProbeSource, videoFilter: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinegen-resize-'));
  try {
    const input = source.filePath ?? path.join(dir, `reference.${source.format}`);
    if (!source.filePath) await fs.writeFile(input, source.bytes);
    const output = path.join(dir, 'reference-upscaled.mp4');
    await execFileAsync(getFfmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', videoFilter,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      output,
    ], { timeout: TRANSCODE_TIMEOUT_MS });
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function transcodeVideoFrameSize(
  source: VideoProbeSource,
  target: VideoFrameSize,
): Promise<Buffer> {
  return transcodeVideo(source, `scale=${target.width}:${target.height}:flags=lanczos`);
}

/**
 * Compatibility fallback for inputs whose dimensions ffprobe cannot read. FFmpeg derives
 * the scale from decoded frame dimensions and never downscales an already compliant clip.
 */
export function transcodeVideoToMinimumPixels(
  source: VideoProbeSource,
  minimumPixels: number,
): Promise<Buffer> {
  const factor = `max(1,sqrt(${minimumPixels}/(iw*ih)))`;
  const width = `ceil(iw*${factor}/2)*2`;
  const height = `ceil(ih*${factor}/2)*2`;
  return transcodeVideo(source, `scale='${width}':'${height}':flags=lanczos`);
}
