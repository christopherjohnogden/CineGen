import { ipcMain, BrowserWindow } from 'electron';
import { Worker } from 'worker_threads';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import { getFfmpegPath, getFfprobePath, getFpcalcPath } from '../lib/ffmpeg-paths.js';
import type { MediaJob, WorkerMessageToMain } from '../workers/media-worker-types.js';
import { projectDir } from '../db/database.js';

let worker: Worker | null = null;
const pendingJobs = new Map<string, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();
/** Maps jobId → { assetId, jobType } so we can include context in forwarded events */
const jobMeta = new Map<string, { assetId: string; jobType: string }>();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

type SyncMediaJob = Extract<MediaJob, { type: 'sync_compute_offset' | 'sync_batch_match' }>;

function getWorkerPath(): string {
  // In dev: dist-electron/workers/media-worker.js
  // In production: worker must be outside app.asar
  let workerPath = path.join(moduleDir, 'workers', 'media-worker.js');
  if (workerPath.includes('app.asar')) {
    workerPath = workerPath.replace('app.asar', 'app.asar.unpacked');
  }
  return workerPath;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(getWorkerPath());

  worker.on('message', (msg: WorkerMessageToMain) => {
    switch (msg.type) {
      case 'ready':
        console.log('[media-worker] Worker ready');
        break;
      case 'job:progress':
        // Forward to all BrowserWindows
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('media:job-progress', { jobId: msg.jobId, progress: msg.progress });
        }
        break;
      case 'job:complete': {
        const meta = jobMeta.get(msg.jobId);
        // Forward to all BrowserWindows with asset context
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('media:job-complete', {
            jobId: msg.jobId,
            result: msg.result,
            assetId: meta?.assetId,
            jobType: meta?.jobType,
          });
        }
        jobMeta.delete(msg.jobId);
        // Resolve pending promise
        const pending = pendingJobs.get(msg.jobId);
        if (pending) {
          pending.resolve(msg.result);
          pendingJobs.delete(msg.jobId);
        }
        break;
      }
      case 'job:error': {
        const errMeta = jobMeta.get(msg.jobId);
        // Forward to all BrowserWindows
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('media:job-error', {
            jobId: msg.jobId,
            error: msg.error,
            assetId: errMeta?.assetId,
            jobType: errMeta?.jobType,
          });
        }
        jobMeta.delete(msg.jobId);
        const errorPending = pendingJobs.get(msg.jobId);
        if (errorPending) {
          errorPending.reject(new Error(msg.error));
          pendingJobs.delete(msg.jobId);
        }
        break;
      }
      case 'sync:batch-progress':
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('sync:batch-progress', {
            jobId: msg.jobId,
            completedPairs: msg.completedPairs,
            totalPairs: msg.totalPairs,
            currentVideoName: msg.currentVideoName,
            currentAudioName: msg.currentAudioName,
          });
        }
        break;
    }
  });

  worker.on('error', (err) => {
    console.error('[media-worker] Worker error:', err);
  });

  worker.on('exit', (code) => {
    console.log(`[media-worker] Worker exited with code ${code}`);
    worker = null;
    // Reject all pending jobs
    for (const [id, pending] of pendingJobs) {
      pending.reject(new Error('Worker exited'));
      pendingJobs.delete(id);
    }
  });

  // Send config with ffmpeg paths
  worker.postMessage({
    type: 'config',
    ffmpegPath: getFfmpegPath(),
    ffprobePath: getFfprobePath(),
    fpcalcPath: getFpcalcPath(),
  });

  return worker;
}

export function submitJob(job: MediaJob): Promise<unknown> {
  if (job.type === 'sync_compute_offset' || job.type === 'sync_batch_match') {
    return submitDedicatedSyncJob(job);
  }

  return new Promise((resolve, reject) => {
    pendingJobs.set(job.id, { resolve, reject });
    jobMeta.set(job.id, { assetId: job.assetId, jobType: job.type });
    const w = ensureWorker();
    w.postMessage({ type: 'job:submit', job });
  });
}

function submitDedicatedSyncJob(job: SyncMediaJob): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const syncWorker = new Worker(getWorkerPath());
    let settled = false;

    const cleanup = () => {
      syncWorker.removeAllListeners();
      void syncWorker.terminate().catch(() => {});
    };

    const settleResolve = (result: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    syncWorker.on('message', (msg: WorkerMessageToMain) => {
      switch (msg.type) {
        case 'ready':
          syncWorker.postMessage({ type: 'job:submit', job });
          break;
        case 'job:complete':
          if (msg.jobId === job.id) {
            settleResolve(msg.result);
          }
          break;
        case 'job:error':
          if (msg.jobId === job.id) {
            settleReject(new Error(msg.error));
          }
          break;
        case 'sync:batch-progress':
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('sync:batch-progress', {
              jobId: msg.jobId,
              completedPairs: msg.completedPairs,
              totalPairs: msg.totalPairs,
              currentVideoName: msg.currentVideoName,
              currentAudioName: msg.currentAudioName,
            });
          }
          break;
        case 'job:progress':
          break;
      }
    });

    syncWorker.on('error', (err) => {
      settleReject(err instanceof Error ? err : new Error(String(err)));
    });

    syncWorker.on('exit', (code) => {
      if (!settled && code !== 0) {
        settleReject(new Error(`Sync worker exited with code ${code}`));
      }
    });

    syncWorker.postMessage({
      type: 'config',
      ffmpegPath: getFfmpegPath(),
      ffprobePath: getFfprobePath(),
      fpcalcPath: getFpcalcPath(),
    });
  });
}

// Helper: detect asset type from file extension
function detectAssetType(filePath: string): 'video' | 'audio' | 'image' {
  const ext = path.extname(filePath).toLowerCase();
  const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf', '.m4v']);
  const AUDIO_EXTS = new Set(['.wav', '.mp3', '.aac', '.flac', '.ogg', '.m4a']);
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'image';
}

export function registerMediaImportHandlers(): void {
  // media:import — main import flow
  ipcMain.handle('media:import', async (_event, params: {
    filePaths: string[];
    projectId: string;
    mode: 'link' | 'copy';
  }) => {
    const { filePaths, projectId, mode } = params;
    const projDir = projectDir(projectId);
    const results: Array<{ assetId: string; jobId: string; filePath: string; type: 'video' | 'audio' | 'image' }> = [];
    const metadataPipelines: Array<{
      assetId: string;
      metadataJobId: string;
      inputPath: string;
      type: 'video' | 'audio' | 'image';
      projectDir: string;
    }> = [];

    for (const filePath of filePaths) {
      const assetId = crypto.randomUUID();
      let inputPath = filePath;

      // If copy mode, copy file to project media directory (async to avoid blocking main process)
      if (mode === 'copy') {
        const mediaDir = path.join(projDir, 'media', 'imported');
        await fsPromises.mkdir(mediaDir, { recursive: true });
        const destName = `${assetId}${path.extname(filePath)}`;
        const destPath = path.join(mediaDir, destName);
        await fsPromises.copyFile(filePath, destPath);
        inputPath = destPath;
      }

      const type = detectAssetType(filePath);
      const metadataJobId = crypto.randomUUID();
      metadataPipelines.push({
        assetId,
        metadataJobId,
        inputPath,
        type,
        projectDir: projDir,
      });

      results.push({ assetId, jobId: metadataJobId, filePath: inputPath, type });
    }

    // Start worker processing on next tick so renderer can add imported assets
    // before completion events begin arriving.
    setTimeout(() => {
      // Pass 1: metadata + thumbnails for every asset so the media pool fills in quickly.
      for (const pipeline of metadataPipelines) {
        const metadataJob: MediaJob = {
          id: pipeline.metadataJobId,
          type: 'extract_metadata',
          assetId: pipeline.assetId,
          inputPath: pipeline.inputPath,
          outputPath: '', // Not needed for metadata
          projectDir: pipeline.projectDir,
        };

        const cacheDir = path.join(pipeline.projectDir, '.cache');

        // Queue fast visual/audio derivations immediately so UI gets thumbnails and previews sooner.
        if (pipeline.type !== 'audio') {
          const thumbsDir = path.join(cacheDir, 'thumbnails');
          fs.mkdirSync(thumbsDir, { recursive: true });
          submitJob({
            id: crypto.randomUUID(),
            type: 'generate_thumbnail',
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(thumbsDir, `${pipeline.assetId}.jpg`),
            projectDir: pipeline.projectDir,
          }).catch((err) => console.error('[media-import] Thumbnail failed:', err));
        }
        submitJob(metadataJob).catch((err) => console.error('[media-import] Metadata extraction failed:', err));
      }

      // Pass 2: waveforms for every eligible asset.
      for (const pipeline of metadataPipelines) {
        const cacheDir = path.join(pipeline.projectDir, '.cache');
        if (pipeline.type === 'audio' || pipeline.type === 'video') {
          const waveformDir = path.join(cacheDir, 'waveforms');
          fs.mkdirSync(waveformDir, { recursive: true });
          submitJob({
            id: crypto.randomUUID(),
            type: 'compute_waveform',
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(waveformDir, `${pipeline.assetId}.json`),
            projectDir: pipeline.projectDir,
          }).catch((err) => console.error('[media-import] Waveform failed:', err));
        }
      }

      // Pass 3: filmstrips for video assets.
      for (const pipeline of metadataPipelines) {
        const cacheDir = path.join(pipeline.projectDir, '.cache');
        if (pipeline.type === 'video') {
          const filmstripDir = path.join(cacheDir, 'filmstrips');
          fs.mkdirSync(filmstripDir, { recursive: true });
          submitJob({
            id: crypto.randomUUID(),
            type: 'generate_filmstrip',
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(filmstripDir, `${pipeline.assetId}.jpg`),
            projectDir: pipeline.projectDir,
          }).catch((err) => console.error('[media-import] Filmstrip failed:', err));
        }
      }

      // Pass 4: proxies last so they never block fast UI artifacts for later imports.
      for (const pipeline of metadataPipelines) {
        const cacheDir = path.join(pipeline.projectDir, '.cache');
        if (pipeline.type === 'video') {
          const proxyDir = path.join(cacheDir, 'proxies');
          fs.mkdirSync(proxyDir, { recursive: true });
          submitJob({
            id: crypto.randomUUID(),
            type: 'generate_proxy',
            assetId: pipeline.assetId,
            inputPath: pipeline.inputPath,
            outputPath: path.join(proxyDir, `${pipeline.assetId}.mp4`),
            projectDir: pipeline.projectDir,
          }).catch((err) => console.error('[media-import] Proxy failed:', err));
        }
      }
    }, 0);

    return results;
  });

  // media:submit-job — submit an arbitrary job
  ipcMain.handle('media:submit-job', async (_event, job: MediaJob) => {
    return submitJob(job);
  });

  // media:cancel-job — cancel a job
  ipcMain.handle('media:cancel-job', async (_event, jobId: string) => {
    const w = worker;
    if (w) {
      w.postMessage({ type: 'job:cancel', jobId });
    }
    pendingJobs.delete(jobId);
    return { ok: true };
  });

  // media:extract-frame — extract a single frame from a video at a given time via ffmpeg
  ipcMain.handle('media:extract-frame', async (_event, params: {
    inputPath: string;
    timeSec: number;
  }): Promise<{ outputPath: string } | null> => {
    const { inputPath, timeSec } = params;
    const ffmpegPath = getFfmpegPath();
    const outputPath = path.join(os.tmpdir(), `cinegen-frame-${crypto.randomUUID()}.jpg`);

    return new Promise((resolve) => {
      const args = [
        '-y',
        '-ss', `${Math.max(0, timeSec)}`,
        '-i', inputPath,
        '-frames:v', '1',
        '-q:v', '2',
        outputPath,
      ];

      execFile(ffmpegPath, args, { timeout: 15000 }, (err, _stdout, _stderr) => {
        if (err || !fs.existsSync(outputPath)) {
          resolve(null);
          return;
        }
        resolve({ outputPath });
      });
    });
  });

  // media:extract-clip — extract a trimmed clip segment via ffmpeg for cloud tools
  ipcMain.handle('media:extract-clip', async (_event, params: {
    inputPath: string;
    startTimeSec: number;
    durationSec: number;
  }): Promise<{ outputPath: string } | null> => {
    const { inputPath, startTimeSec, durationSec } = params;
    const ffmpegPath = getFfmpegPath();
    const outputPath = path.join(os.tmpdir(), `cinegen-clip-${crypto.randomUUID()}.mp4`);
    const safeStart = Math.max(0, startTimeSec);
    const safeDuration = Math.max(0.1, durationSec);

    return new Promise((resolve) => {
      const args = [
        '-y',
        '-ss', `${safeStart}`,
        '-i', inputPath,
        '-t', `${safeDuration}`,
        '-map', '0:v:0',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputPath,
      ];

      execFile(ffmpegPath, args, { timeout: Math.max(120000, Math.ceil(safeDuration * 4000)) }, (err, _stdout, _stderr) => {
        if (err || !fs.existsSync(outputPath)) {
          resolve(null);
          return;
        }
        resolve({ outputPath });
      });
    });
  });

  // media:queue-processing — queue selected derived media jobs + optional proxy
  ipcMain.handle('media:queue-processing', async (_event, params: {
    assetId: string;
    projectId: string;
    inputPath: string;
    needsProxy?: boolean;
    includeThumbnail?: boolean;
    includeWaveform?: boolean;
    includeFilmstrip?: boolean;
  }) => {
    const {
      assetId,
      projectId,
      inputPath,
      needsProxy,
      includeThumbnail = false,
      includeWaveform = true,
      includeFilmstrip = true,
    } = params;
    const projDir = projectDir(projectId);
    const cacheDir = path.join(projDir, '.cache');

    if (includeThumbnail) {
      const thumbsDir = path.join(cacheDir, 'thumbnails');
      fs.mkdirSync(thumbsDir, { recursive: true });
      const thumbJob: MediaJob = {
        id: crypto.randomUUID(),
        type: 'generate_thumbnail',
        assetId,
        inputPath,
        outputPath: path.join(thumbsDir, `${assetId}.jpg`),
        projectDir: projDir,
      };
      submitJob(thumbJob).catch((err) => console.error('[media-import] Thumbnail failed:', err));
    }

    if (includeWaveform) {
      const waveformDir = path.join(cacheDir, 'waveforms');
      fs.mkdirSync(waveformDir, { recursive: true });
      const waveformJob: MediaJob = {
        id: crypto.randomUUID(),
        type: 'compute_waveform',
        assetId,
        inputPath,
        outputPath: path.join(waveformDir, `${assetId}.json`),
        projectDir: projDir,
      };
      submitJob(waveformJob).catch((err) => console.error('[media-import] Waveform failed:', err));
    }

    if (includeFilmstrip) {
      const filmstripDir = path.join(cacheDir, 'filmstrips');
      fs.mkdirSync(filmstripDir, { recursive: true });
      const filmstripJob: MediaJob = {
        id: crypto.randomUUID(),
        type: 'generate_filmstrip',
        assetId,
        inputPath,
        outputPath: path.join(filmstripDir, `${assetId}.jpg`),
        projectDir: projDir,
      };
      submitJob(filmstripJob).catch((err) => console.error('[media-import] Filmstrip failed:', err));
    }

    // Optionally queue proxy
    if (needsProxy) {
      const proxyDir = path.join(cacheDir, 'proxies');
      fs.mkdirSync(proxyDir, { recursive: true });
      const proxyJob: MediaJob = {
        id: crypto.randomUUID(),
        type: 'generate_proxy',
        assetId,
        inputPath,
        outputPath: path.join(proxyDir, `${assetId}.mp4`),
        projectDir: projDir,
      };
      submitJob(proxyJob).catch((err) => console.error('[media-import] Proxy failed:', err));
    }

    return { ok: true };
  });

  // Download a remote URL to the project's media/generated folder
  ipcMain.handle(
    'media:download-remote',
    async (_event, params: { url: string; projectId: string; assetId: string; ext?: string }) => {
      const { url, projectId, assetId, ext } = params;
      if (!url || !projectId) throw new Error('url and projectId are required');

      const projDir = projectDir(projectId);
      const mediaDir = path.join(projDir, 'media', 'generated');
      await fsPromises.mkdir(mediaDir, { recursive: true });

      const extension = ext || path.extname(new URL(url).pathname) || '.mp4';
      const destPath = path.join(mediaDir, `${assetId}${extension}`);

      // Download the file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download (HTTP ${response.status}). The URL may have expired.`);
      }
      const arrayBuffer = await response.arrayBuffer();
      await fsPromises.writeFile(destPath, Buffer.from(arrayBuffer));

      return { path: destPath };
    },
  );
}

export function terminateMediaWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
