import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';
vi.mock('@/lib/fal/models', () => ({ ALL_MODELS: {}, getModelDefinition: (type: string) => type === 'test-video'
  ? { id: 'video', nodeType: type, name: 'Video', category: 'video', outputType: 'video', inputs: [], responseMapping: { path: 'video.url' } }
  : undefined }));
import { canvasMedia, canvasPrompt, importCanvasMedia, studioFeedModel, syncCanvasVideosToStudio } from '@/lib/studio/canvas-import';
import { detachSelection, isPlacedOnCanvas, placeStudioNodeOnCanvas, visibleCanvasEdges } from '@/lib/studio/canvas-placement';

const now = '2026-09-07T03:00:00Z';
const node = (id: string, type: string, config: Record<string, unknown> = {}): Node<WorkflowNodeData> => ({ id, type,
  position: { x: 123, y: 456 }, data: { type, label: id, config } });

describe('Canvas to Studio', () => {
  it('keeps a running video available to Studio if its Canvas placement is removed before completion', () => {
    const running = node('render', 'test-video');
    running.data.result = { status: 'running' };
    const synced = syncCanvasVideosToStudio([running], now);
    expect(synced[0].data.config.__studioCanvasPlaced).toBe(true);
    expect(detachSelection(synced, [], [running.id]).nodes).toHaveLength(1);
    expect(syncCanvasVideosToStudio([node('empty-board', 'storyboarder', { shots: [null, {}] })], now)).toHaveLength(1);
  });
  it('automatically shares generated videos without duplicating, moving, or removing the Canvas node', () => {
    const video = { ...node('render', 'test-video'), data: { ...node('render', 'test-video').data,
      result: { status: 'complete' as const, url: 'https://media.test/render.mp4' }, generations: ['https://media.test/render.mp4'] } };
    const synced = syncCanvasVideosToStudio([video], now);
    expect(synced).toHaveLength(1);
    expect(synced[0].id).toBe(video.id);
    expect(synced[0].position).toEqual(video.position);
    expect(isPlacedOnCanvas(synced[0])).toBe(true);
    expect(studioFeedModel(synced[0])?.outputType).toBe('video');
    expect(syncCanvasVideosToStudio(synced, now)).toBe(synced);
    const prompt = node('prompt', 'prompt', { prompt: 'The original prompt' });
    const edges = [{ id: 'prompt-video', source: prompt.id, target: video.id, targetHandle: 'prompt' }];
    const removed = detachSelection([...synced, prompt], edges, [video.id]);
    expect(removed.nodes).toHaveLength(2);
    expect(isPlacedOnCanvas(removed.nodes[0])).toBe(false);
    expect(removed.nodes[0].data.result?.url).toBe(video.data.result.url);
    expect(removed.edges).toEqual(edges);
    expect(visibleCanvasEdges(removed.nodes, removed.edges)).toEqual([]);
    const reopened = placeStudioNodeOnCanvas(removed.nodes, removed.edges, video.id, []);
    expect(reopened.nodes).toHaveLength(2);
    expect(reopened.nodes[0].position).toEqual(video.position);
    expect(visibleCanvasEdges(reopened.nodes, reopened.edges)).toEqual(edges);
    expect(video.data.config.__studioGenerated).toBeUndefined();
  });

  it('archives board videos once and keeps previous takes when a shot is regenerated or cleared', () => {
    const board = node('board', 'storyboarder', { shots: [{ prompt: 'First shot', url: 'https://media.test/frame.png', videoUrl: 'https://media.test/take-1.mp4' }] });
    const first = syncCanvasVideosToStudio([board], now);
    expect(first).toHaveLength(2);
    expect(first[1].data.result?.url).toBe('https://media.test/take-1.mp4');
    expect(isPlacedOnCanvas(first[1])).toBe(false);
    expect(studioFeedModel(first[1])?.outputType).toBe('video');
    expect(syncCanvasVideosToStudio(first, now)).toBe(first);
    const next = syncCanvasVideosToStudio([{ ...board, data: { ...board.data, config: { shots: [{ videoUrl: 'https://media.test/take-2.mp4' }] } } }, first[1]], now);
    expect(next).toHaveLength(3);
    expect(syncCanvasVideosToStudio(next.slice(1), now)).toHaveLength(2);
  });

  it('sends desktop media as a saved Studio reference and distinguishes files with the same name', () => {
    const file = node('file', 'filePicker', { fileUrl: '/Users/test/a/photo.png', fileType: 'image', fileName: 'photo.png' });
    const media = canvasMedia(file);
    expect(media[0]).toMatchObject({ kind: 'image', url: 'local-media://file/Users/test/a/photo.png', name: 'photo.png' });
    expect(studioFeedModel(file)).toBeUndefined();
    const sent = importCanvasMedia([file], media, now, true);
    expect(sent).toHaveLength(2);
    expect(importCanvasMedia(sent, media, now, true)).toBe(sent);
    expect(studioFeedModel(sent[1])?.outputType).toBe('image');
    expect(sent[1].data.result?.url).toBe(media[0].url);
    const other = { ...media[0], url: 'local-media://file/Users/test/b/photo.png' };
    expect(importCanvasMedia(sent, [other], now, true)).toHaveLength(3);
  });

  it('respects removal from Studio until explicitly sent again', () => {
    const board = node('board', 'storyboarder', { shots: [{ videoUrl: 'https://media.test/take.mp4' }] });
    const sent = syncCanvasVideosToStudio([board], now);
    const hidden = [sent[0], { ...sent[1], data: { ...sent[1].data, config: { ...sent[1].data.config, __studioHiddenFromFeed: true } } }];
    expect(syncCanvasVideosToStudio(hidden, now)).toBe(hidden);
    const restored = importCanvasMedia(hidden, canvasMedia(board), now, true);
    expect(restored).toHaveLength(2);
    expect(restored[1].data.config.__studioHiddenFromFeed).toBe(false);
  });

  it('uses the visible version and recognizes signed legacy video URLs without a catalog entry', () => {
    const legacy = node('old', 'retired-video-model');
    legacy.data.generations = ['https://media.test/first.mp4?token=a', 'https://media.test/second.mp4?token=b'];
    legacy.data.activeGeneration = 0;
    expect(canvasMedia(legacy).map(media => media.url)).toEqual([legacy.data.generations[0]]);
    expect(studioFeedModel(legacy)?.outputType).toBe('video');
    expect(syncCanvasVideosToStudio([legacy], now)).toHaveLength(1);
  });

  it('reads prompt text and finished text outputs without using unrelated media inputs', () => {
    expect(canvasPrompt(node('prompt', 'prompt', { prompt: '  Wide shot.\nThen close up.  ' }))).toBe('Wide shot.\nThen close up.');
    const llm = node('llm', 'text-generator', { prompt: 'Write a prompt' });
    llm.data.result = { text: 'A finished cinematic prompt.' };
    expect(canvasPrompt(llm)).toBe('A finished cinematic prompt.');
    expect(canvasMedia(node('render', 'test-video', { image_url: 'https://media.test/input.png' }))).toEqual([]);
  });
});
