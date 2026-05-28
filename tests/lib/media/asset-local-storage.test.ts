import { describe, expect, it } from 'vitest';
import type { Asset } from '@/types/project';
import {
  assetNeedsGeneratedPersist,
  decodeLocalMediaUrl,
  getAssetRemoteUrl,
  isGeneratedMediaPath,
  looksLikeLocalFilePath,
  resolveExistingLocalPath,
} from '@/lib/media/asset-local-storage';

const baseAsset: Asset = {
  id: 'asset-1',
  name: 'Storyboard shot',
  type: 'video',
  url: 'https://cdn.example.com/output.mp4',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('asset-local-storage', () => {
  it('detects remote URLs', () => {
    expect(getAssetRemoteUrl(baseAsset)).toBe('https://cdn.example.com/output.mp4');
  });

  it('needs persist for remote-only assets', () => {
    expect(assetNeedsGeneratedPersist(baseAsset)).toBe(true);
  });

  it('skips assets already in media/generated', () => {
    expect(assetNeedsGeneratedPersist({
      ...baseAsset,
      fileRef: '/Users/me/Documents/CINEGEN/proj-1/media/generated/asset-1.mp4',
      sourceUrl: baseAsset.url,
      metadata: { localPersistStatus: 'ready' },
    })).toBe(false);
  });

  it('decodes local-media URLs', () => {
    expect(decodeLocalMediaUrl('local-media://file/tmp/render.mp4')).toBe('/tmp/render.mp4');
  });

  it('detects generated media paths', () => {
    expect(isGeneratedMediaPath('/Users/me/Documents/CINEGEN/p1/media/generated/a.mp4')).toBe(true);
  });

  it('skips bare filenames and blob URLs as local paths', () => {
    expect(looksLikeLocalFilePath('clip.mp4')).toBe(false);
    expect(looksLikeLocalFilePath('blob:abc')).toBe(false);
    expect(looksLikeLocalFilePath('/tmp/render.mp4')).toBe(true);
    expect(looksLikeLocalFilePath('media/imported/clip.mp4')).toBe(true);
  });

  it('does not persist when only a stale local fileRef exists', () => {
    expect(assetNeedsGeneratedPersist({
      ...baseAsset,
      url: '',
      sourceUrl: undefined,
      fileRef: '/missing/import/clip.mp4',
    })).toBe(true);

    expect(assetNeedsGeneratedPersist({
      ...baseAsset,
      url: '',
      sourceUrl: undefined,
      fileRef: 'clip.mp4',
    })).toBe(false);
  });

  it('uses remote URL stored on fileRef', () => {
    expect(getAssetRemoteUrl({
      ...baseAsset,
      url: '',
      sourceUrl: undefined,
      fileRef: 'https://cdn.example.com/from-file-ref.mp4',
    })).toBe('https://cdn.example.com/from-file-ref.mp4');
  });

  it('resolveExistingLocalPath ignores bare filenames', () => {
    expect(resolveExistingLocalPath({
      ...baseAsset,
      fileRef: 'clip.mp4',
    })).toBe(null);
  });
});
