import type { Asset } from '@/types/project';

const PLACEHOLDER_NAME_PATTERNS = [
  /^generation failed$/i,
  /^generating\.{3}$/i,
  /^generating /i,
  /^generate music$/i,
  /^generate extension$/i,
  /^generate ai fill$/i,
];

export function isRemoteMediaUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function decodeLocalMediaUrl(url: string): string | null {
  if (!url.startsWith('local-media://file')) return null;
  return decodeURIComponent(url.replace(/^local-media:\/\/file/, ''));
}

export function isPlaceholderGenerationAsset(asset: Asset): boolean {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  if (metadata.generating === true) return true;
  if (typeof metadata.error === 'string' && metadata.error.trim()) return true;
  const normalized = asset.name.trim().toLowerCase();
  return PLACEHOLDER_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getAssetRemoteUrl(asset: Asset): string | undefined {
  const sourceUrl = asset.sourceUrl?.trim();
  if (sourceUrl && isRemoteMediaUrl(sourceUrl)) return sourceUrl;
  const url = asset.url?.trim();
  if (url && isRemoteMediaUrl(url)) return url;
  const fileRef = asset.fileRef?.trim();
  if (fileRef && isRemoteMediaUrl(fileRef)) return fileRef;
  return undefined;
}

/** True when a string looks like a resolvable local filesystem path (not a bare filename or blob/data URL). */
export function looksLikeLocalFilePath(pathStr: string): boolean {
  const trimmed = pathStr.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
  if (isRemoteMediaUrl(trimmed)) return false;
  if (trimmed.startsWith('local-media://file')) return true;
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  return trimmed.includes('/') || trimmed.includes('\\');
}

export function resolveExistingLocalPath(asset: Asset): string | null {
  const fileRef = asset.fileRef?.trim();
  if (fileRef && looksLikeLocalFilePath(fileRef)) {
    return fileRef;
  }
  const proxyRef = asset.proxyRef?.trim();
  if (proxyRef && looksLikeLocalFilePath(proxyRef)) {
    return proxyRef;
  }
  const fromUrl = asset.url ? decodeLocalMediaUrl(asset.url) : null;
  if (fromUrl) return fromUrl;
  const url = asset.url?.trim();
  if (url && looksLikeLocalFilePath(url)) {
    return url;
  }
  return null;
}

export function isGeneratedMediaPath(fileRef: string): boolean {
  const normalized = fileRef.replace(/\\/g, '/');
  return normalized.includes('/media/generated/');
}

/** True when the asset should be copied/downloaded into project media/generated. */
export function assetNeedsGeneratedPersist(asset: Asset): boolean {
  if (asset.type !== 'video' && asset.type !== 'audio' && asset.type !== 'image') return false;
  if (isPlaceholderGenerationAsset(asset)) return false;

  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  if (metadata.localPersistStatus === 'failed') return false;
  if (metadata.localPersistStatus === 'ready' && asset.fileRef?.trim() && isGeneratedMediaPath(asset.fileRef)) {
    return false;
  }

  const remoteUrl = getAssetRemoteUrl(asset);
  const localPath = resolveExistingLocalPath(asset);

  if (localPath && isGeneratedMediaPath(localPath)) return false;
  if (asset.fileRef?.trim() && isGeneratedMediaPath(asset.fileRef)) return false;

  if (remoteUrl) return true;
  if (localPath && !isGeneratedMediaPath(localPath)) return true;

  return false;
}

export function buildPersistedAssetUpdate(
  asset: Asset,
  params: { path: string; sourceUrl?: string; downloaded: boolean },
): Partial<Asset> {
  const remoteUrl = getAssetRemoteUrl(asset);
  return {
    fileRef: params.path,
    sourceUrl: params.sourceUrl ?? remoteUrl ?? asset.sourceUrl,
    status: 'processing',
    metadata: {
      ...(asset.metadata ?? {}),
      localPersistStatus: 'ready',
      localPersistDownloaded: params.downloaded,
      processingJobs: [
        'extract_metadata',
        ...(asset.type !== 'audio' ? ['generate_thumbnail'] : []),
        ...(asset.type === 'audio' || asset.type === 'video' ? ['compute_waveform'] : []),
        ...(asset.type === 'video' ? ['generate_filmstrip'] : []),
      ],
    },
  };
}
