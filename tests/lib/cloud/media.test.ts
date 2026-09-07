import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ metadata: vi.fn(), download: vi.fn(), upload: vi.fn() }));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => path,
  getMetadata: (...args: unknown[]) => storage.metadata(...args),
  getDownloadURL: (...args: unknown[]) => storage.download(...args),
  uploadBytes: (...args: unknown[]) => storage.upload(...args),
}));
vi.mock('@/lib/cloud/firebase', () => ({ cloudStorage: {} }));
import { prepareStateForCloudMedia } from '@/lib/cloud/media';

beforeEach(() => {
  vi.clearAllMocks();
  storage.metadata.mockResolvedValue({});
  storage.download.mockImplementation(async (path: string) =>
    `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(path)}?alt=media&token=test`);
});

it('uses saved copies in Studio results, generation history, and references even with duplicate assets', async () => {
  const original = 'https://api.topview.ai/s/video';
  const state = {
    assets: [{ id: 'copy-a', source_url: original }, { id: 'copy-b', source_url: original }],
    workflow: { nodes: [{ result: { url: original }, generations: [{ url: original }], config: { refs: [original] } }] },
    other: 'https://api.topview.ai/s/another-video',
  };
  const saved = await prepareStateForCloudMedia(state, 'owner', 'duplicate-video') as typeof state;
  const url = saved.workflow.nodes[0].result.url;
  expect(url).toMatch(/^https:\/\/firebasestorage.googleapis.com\//);
  expect(saved.assets.map(asset => asset.source_url)).toContain(url);
  expect(saved.workflow.nodes[0].generations[0].url).toBe(url);
  expect(saved.workflow.nodes[0].config.refs).toEqual([url]);
  expect(saved.other).toBe(state.other);
  expect(state.assets[0].source_url).toBe(original);
  expect(storage.upload).not.toHaveBeenCalled();
});

it('keeps the original reference when its cloud copy cannot be saved', async () => {
  storage.metadata.mockRejectedValue({ code: 'storage/unauthorized' });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const source = 'https://api.topview.ai/s/unsaved-video';
  const state = { assets: [{ id: 'unsaved', sourceUrl: source }], result: { url: source } };
  try {
    expect(await prepareStateForCloudMedia(state, 'owner', 'failed-video')).toEqual(state);
    expect(storage.download).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

it('uses an uploaded original even when its thumbnail fails to save', async () => {
  storage.metadata.mockImplementation(async (path: string) => {
    if (path.split('/').at(-1)?.startsWith('thumbnail-')) throw { code: 'storage/unauthorized' };
    return {};
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const original = 'https://api.topview.ai/s/thumbnail-failure-video';
  const state = {
    assets: [{ id: 'with-thumbnail', sourceUrl: original, thumbnailUrl: 'https://example.test/thumbnail.jpg' }],
    result: { url: original },
  };
  try {
    const saved = await prepareStateForCloudMedia(state, 'owner', 'thumbnail-failure') as typeof state;
    expect(saved.result.url).toBe(saved.assets[0].sourceUrl);
    expect(saved.result.url).toMatch(/^https:\/\/firebasestorage.googleapis.com\//);
    expect(saved.assets[0].thumbnailUrl).toBe(state.assets[0].thumbnailUrl);
  } finally {
    warn.mockRestore();
  }
});
