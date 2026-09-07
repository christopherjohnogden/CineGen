import { describe, expect, it, vi } from 'vitest';
import { createDisplayHandlers, displayJobSnapshot, type DisplayPage } from '@/lib/mcp/display-handlers';
import { createInitialWorkspaceState } from '@/lib/mcp/workspace-state';
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
});
