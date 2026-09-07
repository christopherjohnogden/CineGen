import { mediaSourceHash as shortHash, restoreCloudMediaReferences } from './media-references';
import {
  getDownloadURL,
  getMetadata,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { toFileUrl } from '@/lib/utils/file-url';
import { cloudStorage } from './firebase';
import type { ElementsLibrary, ElementImage } from '@/types/elements';

const STORAGE_HOST = 'firebasestorage.googleapis.com';
const RETRY_DELAY_MS = 5 * 60 * 1000;
const uploadedUrls = new Map<string, string>();
let pausedUntil = 0;

type MediaStatus = {
  status: 'uploading' | 'ready' | 'waiting';
  completed?: number;
  total?: number;
  error?: string;
};

function emitStatus(detail: MediaStatus): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cinegen:cloud-media-status', { detail }));
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return '';
}

function isFirebaseMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === STORAGE_HOST || url.hostname.endsWith('.firebasestorage.app');
  } catch {
    return false;
  }
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || fallback;
}

function sourceFileName(source: string, assetName: string): string {
  try {
    const pathname = new URL(source).pathname;
    const name = decodeURIComponent(pathname.split('/').pop() ?? '');
    if (name && name.includes('.')) return safeSegment(name, 'media');
  } catch {
    const name = source.replace(/\\/g, '/').split('/').pop() ?? '';
    if (name && name.includes('.')) return safeSegment(name, 'media');
  }
  return safeSegment(assetName, 'media');
}

function contentTypeFor(record: Record<string, unknown>, source: string): string | undefined {
  const explicit = firstString(record, ['mimeType', 'mime_type', 'contentType', 'content_type']);
  if (explicit.includes('/')) return explicit;
  const extension = source.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
  const known: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  };
  return extension ? known[extension] : undefined;
}

function fetchableSource(source: string): string {
  if (source.startsWith('file://')) {
    try { return toFileUrl(decodeURIComponent(new URL(source).pathname)); } catch { return source; }
  }
  if (source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) return toFileUrl(source);
  return source;
}

function storageUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /bucket.*not.*found|storage\/bucket-not-found|storage\/unknown|HTTP 404/i.test(message);
}

async function uploadSource(params: {
  uid: string;
  projectId: string;
  asset: Record<string, unknown>;
  source: string;
  role: 'original' | 'thumbnail';
}): Promise<string> {
  if (isFirebaseMediaUrl(params.source)) return params.source;
  const assetId = safeSegment(stringValue(params.asset.id), 'asset');
  const assetName = firstString(params.asset, ['name', 'title']) || assetId;
  const fingerprint = [
    params.source,
    stringValue(params.asset.checksum),
    stringValue(params.asset.fileSize ?? params.asset.file_size),
    stringValue(params.asset.createdAt ?? params.asset.created_at),
  ].join('|');
  const cacheKey = `${params.uid}:${params.projectId}:${assetId}:${params.role}:${fingerprint}`;
  const cached = uploadedUrls.get(cacheKey);
  if (cached) return cached;

  const fileName = sourceFileName(params.source, assetName);
  const objectPath = `users/${params.uid}/projects/${safeSegment(params.projectId, 'project')}/media/${assetId}/${params.role}-${shortHash(fingerprint)}-${fileName}`;
  const objectRef = ref(cloudStorage, objectPath);

  try {
    await getMetadata(objectRef);
  } catch (error) {
    const code = stringValue((error as { code?: unknown })?.code);
    if (code !== 'storage/object-not-found') throw error;
    let response: Response;
    try {
      response = await fetch(fetchableSource(params.source));
    } catch (cause) {
      throw new Error(`Could not read “${assetName}” for cloud upload. Its media source may be unavailable or blocking downloads. Relink or replace this media, then save again.`, { cause });
    }
    if (!response.ok) throw new Error(`Could not read ${assetName} for cloud upload (HTTP ${response.status}).`);
    const blob = await response.blob();
    await uploadBytes(objectRef, blob, {
      contentType: contentTypeFor(params.asset, params.source) ?? (blob.type || undefined),
      customMetadata: { projectId: params.projectId, assetId, role: params.role },
    });
  }

  const downloadUrl = await getDownloadURL(objectRef);
  uploadedUrls.set(cacheKey, downloadUrl);
  return downloadUrl;
}

function sanitizeLocalFields(asset: Record<string, unknown>): void {
  for (const key of ['fileRef', 'file_ref', 'originalPath', 'original_path', 'proxyRef', 'proxy_ref']) {
    delete asset[key];
  }
}

async function syncAsset(
  uid: string,
  projectId: string,
  asset: Record<string, unknown>,
): Promise<void> {
  const source = firstString(asset, [
    'sourceUrl', 'source_url', 'url', 'fileRef', 'file_ref', 'originalPath', 'original_path',
  ]);
  if (!source) return;

  const remoteSource = await uploadSource({ uid, projectId, asset, source, role: 'original' });
  if ('source_url' in asset) asset.source_url = remoteSource;
  else asset.sourceUrl = remoteSource;
  asset.url = remoteSource;
  sanitizeLocalFields(asset);

  const thumbnail = firstString(asset, ['thumbnailUrl', 'thumbnail_url']);
  let remoteThumbnail = thumbnail;
  if (thumbnail && thumbnail !== source && !isFirebaseMediaUrl(thumbnail)) {
    remoteThumbnail = await uploadSource({ uid, projectId, asset, source: thumbnail, role: 'thumbnail' });
  } else if (!thumbnail && stringValue(asset.type) === 'image') {
    remoteThumbnail = remoteSource;
  }
  if (remoteThumbnail) {
    if ('thumbnail_url' in asset) asset.thumbnail_url = remoteThumbnail;
    else asset.thumbnailUrl = remoteThumbnail;
  }
}

/** Canvas uploads can exist only in file-picker config, outside the media bin. */
function canvasMediaAssets(state: Record<string, unknown>, assets: Record<string, unknown>[]): Record<string, unknown>[] {
  const workflow = state.workflow as { nodes?: unknown; spaces?: unknown[] } | undefined;
  const groups = [
    workflow,
    ...(Array.isArray(workflow?.spaces) ? workflow.spaces : []),
    ...(Array.isArray(state.spaces) ? state.spaces : []),
  ];
  const seen = new Set(assets.map(asset => firstString(asset, [
    'sourceUrl', 'source_url', 'url', 'fileRef', 'file_ref', 'originalPath', 'original_path',
  ])));
  const files: Record<string, unknown>[] = [];
  for (const group of groups) {
    const nodes = (group as { nodes?: unknown } | null)?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      if (node?.data?.type !== 'filePicker' || !stringValue(node.id)) continue;
      const config = node.data.config;
      const source = stringValue(config?.fileUrl);
      if (!source || seen.has(source) || isFirebaseMediaUrl(source)) continue;
      seen.add(source);
      files.push({
        id: `canvas-${node.id}`,
        name: stringValue(config.fileName) || stringValue(node.data.label) || 'Canvas media',
        sourceUrl: source,
        type: stringValue(config.fileType),
      });
    }
  }
  return files;
}

export async function prepareStateForCloudMedia(
  state: unknown,
  uid: string,
  projectId: string,
): Promise<unknown> {
  const cloned = restoreCloudMediaReferences(JSON.parse(JSON.stringify(state ?? {}))) as Record<string, unknown>;
  const assets = Array.isArray(cloned.assets)
    ? cloned.assets.filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === 'object')
    : [];
  const media = [...assets, ...canvasMediaAssets(cloned, assets)];
  if (media.length === 0 || Date.now() < pausedUntil) return cloned;

  emitStatus({ status: 'uploading', completed: 0, total: media.length });
  let completed = 0;
  let failed = 0;
  const savedSources = new Map<string, string>();
  for (const asset of media) {
    const original = firstString(asset, ['sourceUrl', 'source_url', 'url', 'fileRef', 'file_ref', 'originalPath', 'original_path']);
    try {
      await syncAsset(uid, projectId, asset);
    } catch (error) {
      failed += 1;
      if (storageUnavailable(error)) {
        pausedUntil = Date.now() + RETRY_DELAY_MS;
        emitStatus({ status: 'waiting', error: 'Cloud Storage is not active yet.' });
        break;
      }
      console.warn('[cloud] Media upload failed:', error);
    } finally {
      // An original may be saved even if its separate thumbnail upload fails.
      const saved = firstString(asset, ['sourceUrl', 'source_url', 'url']);
      if (original && saved !== original && isFirebaseMediaUrl(saved)) savedSources.set(original, saved);
      completed += 1;
      emitStatus({ status: 'uploading', completed, total: media.length });
    }
  }
  emitStatus(failed > 0
    ? { status: 'waiting', completed, total: media.length, error: `${failed} media file${failed === 1 ? '' : 's'} still need to upload.` }
    : { status: 'ready', completed, total: media.length });
  // Generation cards and graph inputs must use the same durable copy as the asset.
  const replaceSavedSources = (value: unknown): unknown => {
    if (typeof value === 'string') return savedSources.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replaceSavedSources);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceSavedSources(item)]));
    return value;
  };
  return restoreCloudMediaReferences(replaceSavedSources(cloned));
}

/**
 * Upload every Elements-library reference that only exists on the current
 * device/server. The returned library contains durable Firebase URLs, so the
 * same character sheet can render on desktop, localhost, and hosted web.
 */
export async function prepareElementsLibraryForCloudMedia(
  library: ElementsLibrary,
  uid: string,
  projectId: string,
): Promise<ElementsLibrary> {
  const cloned = JSON.parse(JSON.stringify(library)) as ElementsLibrary;
  const references: Array<{
    image: ElementImage;
    elementId: string;
    elementName: string;
    variationId?: string;
  }> = [];
  for (const element of cloned.elements) {
    for (const image of element.images) {
      references.push({ image, elementId: element.id, elementName: element.name });
    }
    for (const variation of element.variations ?? []) {
      for (const image of variation.images) {
        references.push({
          image,
          elementId: element.id,
          elementName: element.name,
          variationId: variation.id,
        });
      }
    }
  }
  if (!references.length) return cloned;

  emitStatus({ status: 'uploading', completed: 0, total: references.length });
  let completed = 0;
  const remoteBySource = new Map<string, string>();
  for (const reference of references) {
    if (!isFirebaseMediaUrl(reference.image.url)) {
      const source = reference.image.url;
      const alreadyUploaded = remoteBySource.get(source);
      if (alreadyUploaded) {
        reference.image.url = alreadyUploaded;
      } else {
        const role = reference.variationId ? `look-${reference.variationId}` : 'reference';
        reference.image.url = await uploadSource({
          uid,
          projectId,
          asset: {
            id: `${reference.elementId}-${role}-${reference.image.id}`,
            name: `${reference.elementName}-${reference.image.id}`,
            createdAt: reference.image.createdAt,
          },
          source,
          role: 'original',
        });
        remoteBySource.set(source, reference.image.url);
      }
    }
    completed += 1;
    emitStatus({ status: 'uploading', completed, total: references.length });
  }
  emitStatus({ status: 'ready', completed, total: references.length });
  return cloned;
}
