import { describe, expect, it, vi } from 'vitest';
import { createDisplayHandlers, displayJobSnapshot, type DisplayPage } from '@/lib/mcp/display-handlers';
import { createInitialWorkspaceState, workspaceReducer } from '@/lib/mcp/workspace-state';
import { displayResult, displayUrl, previewUrl, DISPLAY_TOOLS } from '../../../mcp/display-tools.mjs';
import { readMediaResource, MEDIA_RESOURCE } from '../../../mcp/media-viewer.mjs';
const cloud = 'https://firebasestorage.googleapis.com/v0/b/cinegen/o/image.png?alt=media&token=sample';
const node = (id: string, kind = 'image', extra = {}) => ({ id, type: 'filePicker', position: { x: 0, y: 0 }, data: { type: 'filePicker', label: id, config: { fileUrl: cloud, fileType: kind, __studioMedia: true, __studioOutputType: kind, __studioCreatedAt: '2026-09-07T03:00:00Z' }, ...extra } });
function setup() {
  const state = createInitialWorkspaceState();
  state.activeSpaceId = 'a';
  state.nodes = [node('current', 'video') as any];
  state.spaces = [{ id: 'a', name: 'Active', nodes: [node('stale')], edges: [] }, { id: 'b', name: 'Other', nodes: [node('other')], edges: [] }] as any;
  const dispatch = vi.fn(), runNode = vi.fn();
  const handlers = createDisplayHandlers({ getState: () => state, dispatch, runNode });
  return { state, handlers, dispatch, runNode };
}
describe('MCP media displays', () => {
  it('reads every Space using the current active state, filters and paginates without changing anything', async () => {
    const { state, handlers, dispatch, runNode } = setup(), before = JSON.stringify(state);
    const all = await handlers.cinegen_show_generations({ limit: 1 }) as DisplayPage;
    expect(all.total).toBe(2); expect(all.hasMore).toBe(true);
    const next = await handlers.cinegen_show_generations({ limit: 1, offset: 1 }) as DisplayPage;
    expect(next.items[0].id).not.toBe(all.items[0].id);
    const videos = await handlers.cinegen_show_generations({ kind: 'video' }) as DisplayPage;
    expect(videos.items.map(item => item.nodeId)).toEqual(['current']);
    const other = await handlers.cinegen_show_generations({ spaceId: 'b' }) as DisplayPage;
    expect(other.items.map(item => item.nodeId)).toEqual(['other']);
    expect(JSON.stringify(state)).toBe(before); expect(dispatch).not.toHaveBeenCalled(); expect(runNode).not.toHaveBeenCalled();
  });
  it('renders saving distinctly, reads exact nodes, rejects invalid input, and does not expose local paths', async () => {
    const { state, handlers } = setup();
    state.nodes = [node('saving', 'image', { result: { status: 'running', progressStage: 'saving', error: 'Download failed' } }) as any,
      node('local', 'image', { config: { fileUrl: '/Users/person/private.png', fileType: 'image', __studioMedia: true, __studioOutputType: 'image' } }) as any];
    const shown = await handlers.cinegen_job_display({ nodeId: 'saving' }) as DisplayPage;
    expect(shown.items[0]).toMatchObject({ status: 'saving', error: 'Download failed' });
    const local = await handlers.cinegen_job_display({ nodeId: 'local' }) as DisplayPage;
    expect(local.items[0].url).toBeNull(); expect(JSON.stringify(local)).not.toContain('/Users/');
    expect(local.items[0].unavailableReason).toMatch(/Sync/);
    await expect(handlers.cinegen_show_generations({ limit: 999 })).rejects.toThrow(/Invalid display/);
    await expect(handlers.cinegen_job_display({})).rejects.toThrow();
    await expect(handlers.cinegen_job_display({ nodeId: 'missing' })).rejects.toThrow(/not found/);
  });
  it('shows Element looks, names, search results and missing-reference placeholders', async () => {
    const { state, handlers } = setup();
    state.elements = [{ id: 'hero', name: 'Hero', type: 'character', description: 'Lead character', images: [{ id: 'front', url: cloud, source: 'upload', createdAt: 'now' }], createdAt: 'now', updatedAt: 'now' },
      { id: 'set', name: 'The station', type: 'location', description: '', images: [], createdAt: 'now', updatedAt: 'now' }];
    const elements = await handlers.cinegen_show_reference_elements({ search: 'hero' }) as DisplayPage;
    expect(elements.items).toHaveLength(1); expect(elements.items[0]).toMatchObject({ elementId: 'hero', url: cloud, previewUrl: cloud });
    const empty = await handlers.cinegen_show_reference_elements({ elementIds: ['set'] }) as DisplayPage;
    expect(empty.items[0]).toMatchObject({ elementId: 'set', status: 'pending', url: null });
  });
  it('uses the durable job status and safe saved URL over a stale node', async () => {
    const { handlers } = setup();
    const existing = await handlers.cinegen_job_display({ nodeId: 'current' }) as DisplayPage;
    const snapshot = displayJobSnapshot({ projectId: 'project', requestId: 'job', nodeId: 'current', status: 'saving', url: null, error: 'Source unavailable' }, existing);
    expect(snapshot.items[0]).toMatchObject({ status: 'saving', url: null, previewUrl: null, kind: 'video', error: 'Source unavailable' });
    expect(snapshot.refresh.arguments).toEqual({ projectId: 'project', requestId: 'job' });
  });
  it('keeps a readable fallback and declares one real UI resource for all display tools', async () => {
    const { handlers } = setup();
    const data = await handlers.cinegen_show_generations({}) as DisplayPage;
    const result = displayResult(data);
    expect(result.structuredContent).toBe(data); expect(result.content[0].text).toContain('Open video');
    for (const tool of DISPLAY_TOOLS) {
      expect(tool._meta.ui.resourceUri).toBe(MEDIA_RESOURCE.uri);
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
    const resource = readMediaResource(MEDIA_RESOURCE.uri).contents[0];
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.text).toContain('ui/notifications/tool-result');
    expect(resource.text).toContain('window.openai');
    expect(resource.text).not.toContain('innerHTML');
    expect(() => readMediaResource('file:///etc/passwd')).toThrow();
    for (const url of ['file:///private/image.png', 'javascript:alert(1)', 'https://127.0.0.1/x', 'http://example.com/x', 'https://user:secret@example.com/x', 'local-media://file/private/image.png']) expect(displayUrl(url)).toBeNull();
    expect(displayUrl('https://example.com/public.png')).toBe('https://example.com/public.png');
    expect(previewUrl('https://example.com/public.png')).toBeNull();
    expect(previewUrl('https://fakefirebasestorage.googleapis.com/x')).toBeNull();
  });
  it('browses standalone assets, folders and Canvas uploads without exposing local paths', async () => {
    const { state, handlers } = setup();
    state.assets = [{ id: 'upload', name: 'Desktop interview', type: 'video', url: cloud, thumbnailUrl: cloud + '&preview=1', width: 1920, height: 1080, duration: 4.25, folderId: 'footage', createdAt: '2026-09-07' },
      { id: 'voice', name: 'Voice memo', type: 'audio', url: cloud + '&audio=1', createdAt: '2026-09-06' },
      { id: 'local', name: 'Local only', type: 'image', url: '/Users/person/private.png', thumbnailUrl: 'file:///private/thumb.jpg', createdAt: '' }];
    state.mediaFolders = [{ id: 'footage', name: 'Footage' }];
    state.nodes = [node('canvas', 'image', { config: { fileUrl: cloud + '&canvas=1', fileType: 'image', fileName: 'Canvas photo' } }) as any];
    const all = await handlers.cinegen_show_media({}) as DisplayPage;
    expect(all.total).toBe(4); expect(all.folders).toEqual([{ id: 'footage', name: 'Footage' }]);
    expect(all.items.find(item => item.assetId === 'upload')).toMatchObject({ width: 1920, duration: 4.25, thumbnailUrl: cloud + '&preview=1', folderName: 'Footage' });
    expect(JSON.stringify(all)).not.toMatch(/\/Users\/|file:\/\//);
    const audio = await handlers.cinegen_show_media({ kind: 'audio' }) as DisplayPage;
    expect(audio.items.map(item => item.assetId)).toEqual(['voice']);
    const filtered = await handlers.cinegen_show_media({ folderId: 'footage', search: 'interview' }) as DisplayPage;
    expect(filtered.total).toBe(1);
    // A file present in both sources is listed once.
    state.nodes[0].data.config.fileUrl = cloud;
    expect((await handlers.cinegen_show_media({}) as DisplayPage).total).toBe(3);
  });
  it('preserves exact batch order, requested historical takes, failures, and missing slots', async () => {
    const { state, handlers } = setup();
    state.nodes = [node('takes', 'image', { config: { __studioGenerated: true, __studioOutputType: 'image' }, generations: [cloud, cloud + '&take=2'], activeGeneration: 1,
      result: { status: 'error', url: cloud + '&take=2', error: 'Latest retry failed' } }) as any];
    const jobs = [{ nodeId: 'takes' }, { nodeId: 'missing' }, { nodeId: 'takes', generationIndex: 0 }, { nodeId: 'takes', generationIndex: 99 }];
    const batch = await handlers.cinegen_show_generation_batch({ jobs }) as DisplayPage;
    expect(batch.items.map(item => item.batchIndex)).toEqual([1, 2, 3, 4]);
    expect(batch.items.map(item => item.status)).toEqual(['failed', 'not_found', 'complete', 'not_found']);
    expect(batch.items[0].url).toBe(cloud + '&take=2'); expect(batch.items[2].url).toBe(cloud); expect(batch.items[2].generationIndex).toBe(0);
    expect(batch.allFound).toBe(false);
    const paged = await handlers.cinegen_show_generation_batch({ jobs, offset: 2, limit: 1 }) as DisplayPage;
    expect(paged.items[0].batchIndex).toBe(3); expect(paged.hasMore).toBe(true);
  });
  it('sends exact references into another Studio Space, persists on reload, and is idempotent', async () => {
    let state = createInitialWorkspaceState();
    state.spaces = [{ id: 'first', name: 'First', nodes: [], edges: [] }, { id: 'second', name: 'Second', nodes: [], edges: [] }]; state.activeSpaceId = 'first';
    state.assets = [{ id: 'upload', name: 'Interview', url: cloud, type: 'video', createdAt: 'now' }];
    const runNode = vi.fn();
    const handlers = createDisplayHandlers({ getState: () => state, dispatch: action => { state = workspaceReducer(state, action); }, runNode });
    const args = { itemIds: ['asset:upload'], spaceId: 'second' };
    const result = await handlers.cinegen_send_to_studio(args) as any;
    expect(result.generated).toBe(false); expect(state.activeSpaceId).toBe('first'); expect(state.nodes).toHaveLength(0);
    expect(state.spaces[1].nodes).toHaveLength(1); expect(state.spaces[1].nodes[0].data.config).toMatchObject({ fileUrl: cloud, __studioMedia: true, __studioGenerated: true });
    await handlers.cinegen_send_to_studio(args); expect(state.spaces[1].nodes).toHaveLength(1);
    const shown = await handlers.cinegen_show_generations({ spaceId: 'second' }) as DisplayPage;
    expect(shown.items[0].url).toBe(cloud); expect(runNode).not.toHaveBeenCalled();
    const before = JSON.stringify(state);
    await expect(handlers.cinegen_send_to_studio({ itemIds: ['asset:upload', 'forged-id'], spaceId: 'second' })).rejects.toThrow(/unavailable/);
    expect(JSON.stringify(state)).toBe(before);
    await expect(handlers.cinegen_send_to_studio({ ...args, url: 'https://evil.example/x' })).rejects.toThrow();
  });
  it('provides distinct film directions without generation, and returns complete reference identifiers', async () => {
    const { state, handlers, dispatch, runNode } = setup();
    const presets = await handlers.cinegen_show_film_presets({ limit: 24 }) as DisplayPage;
    expect(presets.total).toBe(12); expect(new Set(presets.items.map(item => item.diagram)).size).toBe(12);
    const camera = await handlers.cinegen_show_film_presets({ category: 'camera', search: 'orbit' }) as DisplayPage;
    expect(camera.items[0]).toMatchObject({ presetId: 'gentle-orbit', kind: 'preset', category: 'camera' });
    state.elements = [{ id: 'hero', name: 'Hero', type: 'character', description: 'Lead', images: [{ id: 'front', url: cloud, source: 'upload', createdAt: 'now' }], createdAt: 'now', updatedAt: 'now' }];
    const refs = await handlers.cinegen_show_reference_elements({ view: 'images' }) as DisplayPage;
    expect(refs.items[0].elementId).toBe('hero'); expect(refs.items[0].variationId).toBeTruthy(); expect(refs.items[0].imageId).toBe('front');
    expect(dispatch).not.toHaveBeenCalled(); expect(runNode).not.toHaveBeenCalled();
  });
  it('shows actual model input references and safe thumbnails alongside output metadata', async () => {
    const { state, handlers } = setup();
    const reference = cloud + '&reference=1';
    state.nodes = [{ id: 'generated', type: 'nano-banana-2', position: { x: 0, y: 0 }, data: { type: 'nano-banana-2', label: 'The doorway',
      config: { __studioGenerated: true, prompt: 'The doorway', image_url: reference, resolution: '2K', aspect_ratio: '16:9' }, result: { status: 'complete', url: cloud } } }];
    state.assets = [{ id: 'ref', name: 'Reference', type: 'image', url: reference, thumbnailUrl: '/local/thumb.jpg', createdAt: '' },
      { id: 'out', name: 'Output', type: 'image', url: cloud, thumbnailUrl: cloud + '&thumb=1', width: 1920, height: 1080, createdAt: '' }];
    const shown = await handlers.cinegen_job_display({ nodeId: 'generated' }) as DisplayPage;
    expect(shown.items[0]).toMatchObject({ thumbnailUrl: cloud + '&thumb=1', width: 1920, height: 1080, resolution: '2K', aspectRatio: '16:9' });
    expect(shown.items[0].references).toEqual([expect.objectContaining({ url: reference, previewUrl: reference })]);
    expect(JSON.stringify(shown)).not.toContain('/local/');
  });
  it('pages Element cards by Element and preserves the exact active look reference pack', async () => {
    const { state, handlers, dispatch } = setup();
    state.elements = Array.from({ length: 27 }, (_, i) => ({ id: `element-${i}`, name: `Vehicle ${i}`, type: 'vehicle', description: 'Vehicle reference',
      images: [], activeVariationId: 'weathered', variations: [
        { id: 'clean', name: 'Clean', kind: 'baseline', images: [{ id: 'clean-front', url: cloud + '&clean=1', source: 'upload', createdAt: 'now' }], createdAt: 'now', updatedAt: 'now' },
        { id: 'weathered', name: 'Weathered', kind: 'condition', images: ['front', 'side', 'back'].map(id => ({ id, url: cloud + '&view=' + id, source: 'upload', createdAt: 'now' })), createdAt: 'now', updatedAt: 'now' }],
      createdAt: 'now', updatedAt: 'now' })) as any;
    const first = await handlers.cinegen_show_reference_elements({}) as DisplayPage;
    expect(first.total).toBe(27); expect(first.items).toHaveLength(9); expect(first.hasMore).toBe(true);
    expect(first.items[0]).toMatchObject({ elementCard: true, elementType: 'vehicle', elementId: 'element-0', variationId: 'weathered', referenceCount: 3 });
    expect(first.items[0].references?.map(item => item.imageId)).toEqual(['front', 'side', 'back']);
    expect(first.items[0].references?.every(item => item.variationId === 'weathered')).toBe(true);
    expect(first.items[0].galleryImages?.map(image => image.imageId)).toEqual(['clean-front', 'front', 'side', 'back']);
    expect(first.items[0].galleryImages?.[0]).toMatchObject({ variationId: 'clean', variationName: 'Clean', url: cloud + '&clean=1' });
    const last = await handlers.cinegen_show_reference_elements({ offset: 18 }) as DisplayPage;
    expect(last.items).toHaveLength(9); expect(last.hasMore).toBe(false);
    expect(last.items[0].elementId).toBe('element-18');
    const images = await handlers.cinegen_show_reference_elements({ view: 'images', elementIds: ['element-0'] }) as DisplayPage;
    expect(images.total).toBe(4); expect(images.items.map(item => item.imageId)).toEqual(['clean-front', 'front', 'side', 'back']);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('keeps unavailable images in the Element gallery without leaking local paths or blocking the active look', async () => {
    const { state, handlers } = setup();
    state.elements = [{ id: 'vehicle', name: 'Vehicle', type: 'vehicle', description: '', images: [], activeVariationId: 'hero',
      variations: [{ id: 'hero', name: 'Hero', kind: 'baseline', images: [{ id: 'front', url: cloud, source: 'upload', createdAt: 'now' }], createdAt: 'now', updatedAt: 'now' },
        { id: 'old', name: 'Old look', kind: 'condition', images: [{ id: 'local', url: '/Users/private/reference.png', source: 'upload', createdAt: 'now' }], createdAt: 'now', updatedAt: 'now' }], createdAt: 'now', updatedAt: 'now' }] as any;
    const result = await handlers.cinegen_show_reference_elements({}) as DisplayPage;
    expect(result.items[0].status).toBe('complete');
    expect(result.items[0].references).toHaveLength(1);
    expect(result.items[0].galleryImages).toHaveLength(2);
    expect(result.items[0].galleryImages?.[1]).toMatchObject({ imageId: 'local', url: null, previewUrl: null });
    expect(JSON.stringify(result)).not.toContain('/Users/');
  });
});
