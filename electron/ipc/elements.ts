import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function toFsPathFromLocalMediaUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'local-media:' || parsed.hostname !== 'file') return null;
    let decodedPath = decodeURIComponent(parsed.pathname);
    if (process.platform === 'win32' && decodedPath.startsWith('/')) {
      decodedPath = decodedPath.slice(1);
    }
    return path.normalize(decodedPath);
  } catch {
    return null;
  }
}

async function extractAudioForTranscription(inputPath: string): Promise<string> {
  const outputPath = path.join(
    os.tmpdir(),
    `cinegen-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`,
  );
  const ffmpegPath = getFfmpegPath();
  const args = [
    '-y',
    '-i', inputPath,
    '-vn',
    '-sn',
    '-dn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'aac',
    '-b:a', '96k',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });

  return outputPath;
}

export function registerElementHandlers(): void {
  ipcMain.handle(
    'elements:upload',
    async (_event, fileData: { buffer: ArrayBuffer; name: string; type: string }, apiKey?: string) => {
      if (!apiKey) throw new Error('No API key provided');

      fal.config({ credentials: apiKey });

      // Convert ArrayBuffer back to a File-like object for fal.storage.upload
      const blob = new Blob([fileData.buffer], { type: fileData.type });
      const file = new File([blob], fileData.name, { type: fileData.type });

      const url = await fal.storage.upload(file);
      return { url };
    },
  );

  ipcMain.handle(
    'elements:upload-transcription-source',
    async (_event, sourceUrl: string, apiKey?: string) => {
      if (!apiKey) throw new Error('No API key provided');

      const sourcePath = toFsPathFromLocalMediaUrl(sourceUrl);
      if (!sourcePath) {
        if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
          return { url: sourceUrl };
        }
        throw new Error('Transcription upload requires a local-media or remote URL source');
      }

      fal.config({ credentials: apiKey });

      const extractedPath = await extractAudioForTranscription(sourcePath);
      try {
        const buffer = await fs.readFile(extractedPath);
        const baseName = path.basename(sourcePath, path.extname(sourcePath));
        const fileName = `${baseName}.m4a`;
        const type = guessContentType(extractedPath);
        const blob = new Blob([buffer], { type });
        const file = new File([blob], fileName, { type });
        const url = await fal.storage.upload(file);
        return { url };
      } finally {
        await fs.unlink(extractedPath).catch(() => {});
      }
    },
  );

  ipcMain.handle(
    'elements:upload-media-source',
    async (_event, sourceUrl: string, apiKey?: string) => {
      if (!apiKey) throw new Error('No API key provided');

      fal.config({ credentials: apiKey });

      const sourcePath = toFsPathFromLocalMediaUrl(sourceUrl);
      if (sourcePath) {
        // Local file — read and upload
        const buffer = await fs.readFile(sourcePath);
        const fileName = path.basename(sourcePath);
        const type = guessContentType(sourcePath);
        const blob = new Blob([buffer], { type });
        const file = new File([blob], fileName, { type });
        const url = await fal.storage.upload(file);
        return { url };
      }

      if (sourceUrl.startsWith('data:')) {
        return { url: sourceUrl };
      }

      if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
        // Remote URL — download to temp file first, then re-upload to get a fresh fal.ai URL
        // This handles expired CDN URLs by re-uploading the content
        const os = await import('node:os');
        const fsSync = await import('node:fs');
        const ext = path.extname(new URL(sourceUrl).pathname) || '.mp4';
        const tmpPath = path.join(os.tmpdir(), `cinegen-upload-${Date.now()}${ext}`);

        // Try to download; if it fails (expired), throw a clear error
        try {
          const response = await fetch(sourceUrl);
          if (!response.ok) {
            throw new Error(`Remote file unavailable (HTTP ${response.status}). The URL may have expired. Try re-importing the asset.`);
          }
          const arrayBuffer = await response.arrayBuffer();
          await fs.writeFile(tmpPath, Buffer.from(arrayBuffer));
        } catch (downloadError) {
          throw new Error(
            downloadError instanceof Error
              ? downloadError.message
              : 'Failed to download remote media. The URL may have expired.'
          );
        }

        const buffer = await fs.readFile(tmpPath);
        const fileName = path.basename(tmpPath);
        const type = guessContentType(tmpPath);
        const blob = new Blob([buffer], { type });
        const file = new File([blob], fileName, { type });
        const url = await fal.storage.upload(file);
        // Clean up temp file
        await fs.unlink(tmpPath).catch(() => {});
        return { url };
      }

      throw new Error('Media upload requires a local-media, remote URL, or data URI source');
    },
  );
}
