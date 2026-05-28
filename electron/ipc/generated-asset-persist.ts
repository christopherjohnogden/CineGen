import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectDir } from '../db/database.js';
import { submitJob } from './media-import.js';
import type { MediaJob } from '../workers/media-worker-types.js';

export interface PersistGeneratedAssetParams {
  projectId: string;
  assetId: string;
  assetType: 'video' | 'audio' | 'image';
  remoteUrl?: string;
  localPathHint?: string;
  extension?: string;
}

export interface PersistGeneratedAssetSuccess {
  path: string;
  sourceUrl?: string;
  downloaded: boolean;
}

export interface PersistGeneratedAssetFailure {
  error: string;
}

export type PersistGeneratedAssetResult = PersistGeneratedAssetSuccess | PersistGeneratedAssetFailure;

export function isPersistGeneratedAssetFailure(
  result: PersistGeneratedAssetResult,
): result is PersistGeneratedAssetFailure {
  return 'error' in result;
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf', '.m4v']);
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.aac', '.flac', '.ogg', '.m4a']);

function detectAssetType(filePath: string, fallback: PersistGeneratedAssetParams['assetType']): 'video' | 'audio' | 'image' {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext) return 'image';
  return fallback;
}

function extensionForAsset(url: string | undefined, assetType: PersistGeneratedAssetParams['assetType']): string {
  if (url) {
    try {
      const ext = path.extname(new URL(url).pathname);
      if (ext && ext.length <= 8) return ext;
    } catch {
      const ext = path.extname(url);
      if (ext && ext.length <= 8) return ext;
    }
  }
  switch (assetType) {
    case 'video':
      return '.mp4';
    case 'audio':
      return '.mp3';
    default:
      return '.jpg';
  }
}

async function findExistingGeneratedAsset(mediaDir: string, assetId: string): Promise<string | null> {
  let entries: string[] = [];
  try {
    entries = await fsPromises.readdir(mediaDir);
  } catch {
    return null;
  }
  const match = entries.find((entry) => entry === assetId || entry.startsWith(`${assetId}.`));
  return match ? path.join(mediaDir, match) : null;
}

function decodeLocalMediaUrl(url: string): string | null {
  if (!url.startsWith('local-media://file')) return null;
  return decodeURIComponent(url.replace(/^local-media:\/\/file/, ''));
}

function resolveLocalPathHint(hint?: string): string | null {
  if (!hint?.trim()) return null;
  const trimmed = hint.trim();
  const decoded = decodeLocalMediaUrl(trimmed) ?? trimmed;
  return fs.existsSync(decoded) ? decoded : null;
}

async function copyIntoGenerated(sourcePath: string, destPath: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
  await fsPromises.copyFile(sourcePath, destPath);
}

export function queueAssetDerivationPipeline(params: {
  assetId: string;
  projectId: string;
  inputPath: string;
  type: 'video' | 'audio' | 'image';
}): string {
  const projDir = projectDir(params.projectId);
  const cacheDir = path.join(projDir, '.cache');
  const metadataJobId = crypto.randomUUID();

  const metadataJob: MediaJob = {
    id: metadataJobId,
    type: 'extract_metadata',
    assetId: params.assetId,
    inputPath: params.inputPath,
    outputPath: '',
    projectDir: projDir,
  };

  if (params.type !== 'audio') {
    const thumbsDir = path.join(cacheDir, 'thumbnails');
    fs.mkdirSync(thumbsDir, { recursive: true });
    submitJob({
      id: crypto.randomUUID(),
      type: 'generate_thumbnail',
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(thumbsDir, `${params.assetId}.jpg`),
      projectDir: projDir,
    }).catch((err) => console.error('[generated-asset-persist] Thumbnail failed:', err));
  }

  submitJob(metadataJob).catch((err) => console.error('[generated-asset-persist] Metadata failed:', err));

  if (params.type === 'audio' || params.type === 'video') {
    const waveformDir = path.join(cacheDir, 'waveforms');
    fs.mkdirSync(waveformDir, { recursive: true });
    submitJob({
      id: crypto.randomUUID(),
      type: 'compute_waveform',
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(waveformDir, `${params.assetId}.json`),
      projectDir: projDir,
    }).catch((err) => console.error('[generated-asset-persist] Waveform failed:', err));
  }

  if (params.type === 'video') {
    const filmstripDir = path.join(cacheDir, 'filmstrips');
    fs.mkdirSync(filmstripDir, { recursive: true });
    submitJob({
      id: crypto.randomUUID(),
      type: 'generate_filmstrip',
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(filmstripDir, `${params.assetId}.jpg`),
      projectDir: projDir,
    }).catch((err) => console.error('[generated-asset-persist] Filmstrip failed:', err));

    const proxyDir = path.join(cacheDir, 'proxies');
    fs.mkdirSync(proxyDir, { recursive: true });
    submitJob({
      id: crypto.randomUUID(),
      type: 'generate_proxy',
      assetId: params.assetId,
      inputPath: params.inputPath,
      outputPath: path.join(proxyDir, `${params.assetId}.mp4`),
      projectDir: projDir,
    }).catch((err) => console.error('[generated-asset-persist] Proxy failed:', err));
  }

  return metadataJobId;
}

export async function persistGeneratedAsset(
  params: PersistGeneratedAssetParams,
): Promise<PersistGeneratedAssetResult> {
  const { projectId, assetId, assetType } = params;
  if (!projectId || !assetId) {
    throw new Error('projectId and assetId are required.');
  }

  const projDir = projectDir(projectId);
  const mediaDir = path.join(projDir, 'media', 'generated');
  await fsPromises.mkdir(mediaDir, { recursive: true });

  const existing = await findExistingGeneratedAsset(mediaDir, assetId);
  if (existing) {
    queueAssetDerivationPipeline({
      assetId,
      projectId,
      inputPath: existing,
      type: detectAssetType(existing, assetType),
    });
    return {
      path: existing,
      sourceUrl: params.remoteUrl,
      downloaded: false,
    };
  }

  const extension = params.extension || extensionForAsset(params.remoteUrl ?? params.localPathHint, assetType);
  const destPath = path.join(mediaDir, `${assetId}${extension}`);

  const localSource = resolveLocalPathHint(params.localPathHint);
  if (localSource) {
    await copyIntoGenerated(localSource, destPath);
    queueAssetDerivationPipeline({
      assetId,
      projectId,
      inputPath: destPath,
      type: detectAssetType(destPath, assetType),
    });
    return {
      path: destPath,
      sourceUrl: params.remoteUrl,
      downloaded: false,
    };
  }

  const remoteUrl = params.remoteUrl?.trim();
  if (!remoteUrl) {
    return { error: 'No downloadable URL or local file path for this asset.' };
  }

  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download (HTTP ${response.status}). The URL may have expired.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fsPromises.writeFile(destPath, Buffer.from(arrayBuffer));

  queueAssetDerivationPipeline({
    assetId,
    projectId,
    inputPath: destPath,
    type: detectAssetType(destPath, assetType),
  });

  return {
    path: destPath,
    sourceUrl: remoteUrl,
    downloaded: true,
  };
}
