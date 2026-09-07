import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
afterEach(() => vi.unstubAllGlobals());

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

it('uploads computer files placed directly on the canvas without media-bin assets', async () => {
  storage.metadata.mockRejectedValue({ code: 'storage/object-not-found' });
  storage.upload.mockResolvedValue({});
  const fetchMedia = vi.fn().mockResolvedValue(new Response('video bytes', { headers: { 'Content-Type': 'video/mp4' } }));
  vi.stubGlobal('fetch', fetchMedia);
  const source = 'local-media://file/Users/test/Downloads/My%20Video.mp4';
  const node = { id: 'local-video', data: { type: 'filePicker', config: { fileUrl: source, fileType: 'video', fileName: 'My Video.mp4' } } };
  const state = { workflow: { nodes: [node], spaces: [{ nodes: [node] }] }, reference: source };
  const saved = await prepareStateForCloudMedia(state, 'owner', 'canvas-upload') as typeof state;
  const url = saved.workflow.nodes[0].data.config.fileUrl;
  expect(url).toMatch(/^https:\/\/firebasestorage.googleapis.com\//);
  expect(saved.workflow.spaces[0].nodes[0].data.config.fileUrl).toBe(url);
  expect(saved.reference).toBe(url);
  expect(fetchMedia).toHaveBeenCalledExactlyOnceWith(source);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(state.workflow.nodes[0].data.config.fileUrl).toBe(source);
  expect(await prepareStateForCloudMedia(saved, 'owner', 'canvas-upload')).toEqual(saved);
  expect(storage.upload).toHaveBeenCalledTimes(1);
});

it('keeps failed canvas uploads available locally and reports the pending upload', async () => {
  storage.metadata.mockRejectedValue({ code: 'storage/unauthorized' });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const events: unknown[] = [];
  const onStatus = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener('cinegen:cloud-media-status', onStatus);
  const state = { assets: [], workflow: { spaces: [{ nodes: [{ id: 'pending-file', data: {
    type: 'filePicker', config: { fileUrl: 'blob:https://cinegen.example/upload', fileType: 'video' },
  } }] }] } };
  try {
    expect(await prepareStateForCloudMedia(state, 'owner', 'pending-canvas')).toEqual(state);
    expect(events.at(-1)).toEqual(expect.objectContaining({ status: 'waiting', total: 1, error: expect.any(String) }));
  } finally {
    window.removeEventListener('cinegen:cloud-media-status', onStatus);
    warn.mockRestore();
  }
});

it('saves files in inactive Spaces in JSON projects without confusing identical filenames', async () => {
  const node = (id: string, path: string) => ({ id, data: { type: 'filePicker', config: { fileUrl: path, fileName: 'clip.mp4', fileType: 'video' } } });
  const state = { workflow: { nodes: [] }, spaces: [{ nodes: [
    node('first-folder', 'local-media://file/Users/test/one/clip.mp4'),
    node('second-folder', 'local-media://file/Users/test/two/clip.mp4'),
  ] }] };
  const saved = await prepareStateForCloudMedia(state, 'owner', 'json-canvas') as typeof state;
  const urls = saved.spaces[0].nodes.map(n => n.data.config.fileUrl);
  expect(urls.every(url => url.startsWith('https://firebasestorage.googleapis.com/'))).toBe(true);
  expect(new Set(urls).size).toBe(2);
});
