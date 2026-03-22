import { ipcMain, BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';

interface ExportParams {
  preset?: 'draft' | 'standard' | 'high';
  fps?: number;
  outputPath?: string;
  // Timeline data for rendering
  clips: Array<{
    inputPath: string;
    startTime: number;
    duration: number;
    trimStart: number;
    speed: number;
    volume: number;
    type: 'video' | 'audio' | 'image';
  }>;
  totalDuration: number;
}

interface ExportJob {
  id: string;
  status: 'queued' | 'rendering' | 'complete' | 'failed';
  progress: number;
  preset: string;
  fps: number;
  outputUrl?: string;
  fileSize?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const PRESETS = {
  draft: { crf: 28, scale: 0.5 },
  standard: { crf: 20, scale: 1 },
  high: { crf: 16, scale: 1 },
} as const;

const exportJobs = new Map<string, ExportJob>();
const activeProcesses = new Map<string, ChildProcess>();

function broadcastProgress(jobId: string, progress: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('export:progress', { jobId, progress });
  }
}

function parseTimeProgress(line: string, totalDuration: number): number | null {
  // ffmpeg outputs: time=00:01:23.45
  const match = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  const frac = parseInt(match[4], 10) / 100;
  const currentTime = hours * 3600 + mins * 60 + secs + frac;
  return totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
}

async function renderWithFfmpeg(jobId: string, params: ExportParams): Promise<void> {
  const job = exportJobs.get(jobId);
  if (!job) return;

  const ffmpegPath = getFfmpegPath();
  const preset = PRESETS[params.preset || 'standard'] || PRESETS.standard;
  const fps = params.fps || 30;
  const outputPath = params.outputPath || path.join(process.cwd(), `export_${jobId}.mp4`);

  // Update job status
  exportJobs.set(jobId, { ...job, status: 'rendering' });

  // Filter to only video/image clips with valid paths
  const videoClips = params.clips.filter(
    (c) => (c.type === 'video' || c.type === 'image') && c.inputPath,
  );

  if (videoClips.length === 0) {
    exportJobs.set(jobId, { ...job, status: 'failed', error: 'No video clips to export' });
    return;
  }

  // Build ffmpeg args for sequential concat
  const args: string[] = [];

  // Input files with trim
  for (const clip of videoClips) {
    if (clip.trimStart > 0) {
      args.push('-ss', String(clip.trimStart));
    }
    args.push('-t', String(clip.duration / (clip.speed || 1)));
    args.push('-i', clip.inputPath);
  }

  // Filter complex for concat
  const filterParts: string[] = [];
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const speed = clip.speed || 1;
    const volume = clip.volume ?? 1;

    // Video processing
    const videoFilters: string[] = [];

    // Speed adjustment
    if (speed !== 1) {
      videoFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
    }

    // Scale for draft preset
    if (preset.scale !== 1) {
      videoFilters.push(`scale=iw*${preset.scale}:ih*${preset.scale}`);
    }

    // FPS
    videoFilters.push(`fps=${fps}`);

    filterParts.push(`[${i}:v]${videoFilters.join(',')}[v${i}]`);

    // Audio processing — images and silent videos won't have audio streams,
    // so generate silence with anullsrc instead of referencing [i:a].
    const clipDuration = clip.duration / (speed || 1);
    if (clip.type === 'image') {
      // Images have no audio — generate silence
      filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clipDuration.toFixed(4)}[a${i}]`);
    } else {
      const audioFilters: string[] = [];
      if (speed !== 1) {
        audioFilters.push(`atempo=${speed}`);
      }
      if (volume !== 1) {
        audioFilters.push(`volume=${volume}`);
      }
      if (audioFilters.length > 0) {
        filterParts.push(`[${i}:a]${audioFilters.join(',')}[a${i}]`);
      } else {
        filterParts.push(`[${i}:a]anull[a${i}]`);
      }
    }
  }

  // Concat
  const vInputs = videoClips.map((_, i) => `[v${i}]`).join('');
  const aInputs = videoClips.map((_, i) => `[a${i}]`).join('');
  filterParts.push(
    `${vInputs}${aInputs}concat=n=${videoClips.length}:v=1:a=1[outv][outa]`,
  );

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[outv]', '-map', '[outa]');

  // Encoding settings
  args.push('-c:v', 'libx264', '-crf', String(preset.crf), '-preset', 'fast');
  args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-y', outputPath);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    activeProcesses.set(jobId, proc);

    let stderrBuffer = '';

    proc.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      // Parse progress from the latest line
      const lines = stderrBuffer.split('\r');
      const lastLine = lines[lines.length - 1] || lines[lines.length - 2];
      if (lastLine) {
        const progress = parseTimeProgress(lastLine, params.totalDuration);
        if (progress !== null) {
          const updatedJob = exportJobs.get(jobId);
          if (updatedJob) {
            exportJobs.set(jobId, { ...updatedJob, progress });
            broadcastProgress(jobId, progress);
          }
        }
      }
      // Keep only last 2KB of stderr to avoid memory issues
      if (stderrBuffer.length > 2048) {
        stderrBuffer = stderrBuffer.slice(-1024);
      }
    });

    proc.on('close', (code) => {
      activeProcesses.delete(jobId);
      const finalJob = exportJobs.get(jobId);
      if (!finalJob) {
        resolve();
        return;
      }

      if (code === 0) {
        let fileSize: number | undefined;
        try {
          fileSize = fs.statSync(outputPath).size;
        } catch {
          // file size is optional
        }
        exportJobs.set(jobId, {
          ...finalJob,
          status: 'complete',
          progress: 100,
          outputUrl: outputPath,
          fileSize,
          completedAt: new Date().toISOString(),
        });
      } else {
        exportJobs.set(jobId, {
          ...finalJob,
          status: 'failed',
          error: `ffmpeg exited with code ${code}`,
        });
      }
      resolve();
    });

    proc.on('error', (err) => {
      activeProcesses.delete(jobId);
      const errJob = exportJobs.get(jobId);
      if (errJob) {
        exportJobs.set(jobId, { ...errJob, status: 'failed', error: err.message });
      }
      reject(err);
    });
  });
}

export function registerExportHandlers(): void {
  ipcMain.handle('export:start', async (_event, params: ExportParams) => {
    const { preset = 'standard', fps = 30 } = params;
    const job: ExportJob = {
      id: crypto.randomUUID(),
      status: 'queued',
      progress: 0,
      preset,
      fps,
      createdAt: new Date().toISOString(),
    };

    exportJobs.set(job.id, job);

    // Start rendering in the background (don't await)
    renderWithFfmpeg(job.id, params).catch((err) => {
      console.error('[export] Render failed:', err);
    });

    return job;
  });

  ipcMain.handle('export:poll', async (_event, id: string) => {
    const job = exportJobs.get(id);
    if (!job) throw new Error('Export not found');
    return job;
  });

  ipcMain.handle('export:cancel', async (_event, id: string) => {
    const proc = activeProcesses.get(id);
    if (proc) {
      proc.kill('SIGTERM');
      activeProcesses.delete(id);
    }
    const job = exportJobs.get(id);
    if (job) {
      exportJobs.set(id, { ...job, status: 'failed', error: 'Cancelled by user' });
      // Clean up partial output file
      if (job.outputUrl) {
        try {
          fs.unlinkSync(job.outputUrl);
        } catch {
          // partial file may not exist
        }
      }
    }
    return { ok: true };
  });
}
