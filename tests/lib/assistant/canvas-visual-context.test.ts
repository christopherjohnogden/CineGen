import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';
import { canvasVisualSources, prepareCanvasVisualContext, videoSampleTimes } from '@/lib/assistant/canvas-visual-context';

const file = (id: string, type = 'image'): Node<WorkflowNodeData> => ({ id, type: 'filePicker', position: { x: 0, y: 0 },
  data: { type: 'filePicker', label: id, config: { fileUrl: `https://media.example/${id}`, fileType: type } } });

describe('Canvas visual context', () => {
  it('attaches all four input images with stable node labels, even for follow-up questions', async () => {
    const nodes = ['one', 'two', 'three', 'four'].map(id => file(id));
    const capture = vi.fn(async (source) => [{ label: source.label, dataUrl: `data:image/jpeg;base64,${source.nodeId}` }]);
    const result = await prepareCanvasVisualContext(nodes, [], 'Can you open them?', [], capture);
    expect(result.images).toHaveLength(4);
    expect(result.context).toContain('Attached image 4: four [node four]');
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it('prioritizes selected prompt inputs and reports omitted nodes', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => file(`image-${i}`));
    nodes.push({ id: 'prompt', type: 'prompt', selected: true, position: { x: 0, y: 0 }, data: { type: 'prompt', label: 'Prompt', config: {} } });
    const result = canvasVisualSources(nodes, [{ id: 'edge', source: 'image-7', target: 'prompt' }], 'What about this?');
    expect(result.sources[0].nodeId).toBe('image-7');
    expect(result.sources).toHaveLength(6);
    expect(result.omitted).toHaveLength(2);
  });

  it('includes the four recent image inputs when older uploads and results fill a mixed canvas', () => {
    const oldImages = Array.from({ length: 7 }, (_, i) => file(`old-${i}`));
    const screenshots = Array.from({ length: 4 }, (_, i) => file(`screenshot-${i}`));
    const generated = { ...file('result'), data: { type: 'custom-video', label: 'Result', config: {}, result: { url: 'https://media.example/result.mp4' } } };
    const nodes = [file('old-video', 'video'), ...oldImages, ...screenshots, generated];
    const result = canvasVisualSources(nodes, [], 'Can you see the 4 images input on the canvas?');
    expect(result.sources).toHaveLength(6);
    for (const node of screenshots) expect(result.sources.some(source => source.nodeId === node.id)).toBe(true);
    expect(result.sources.every(source => source.mediaType === 'image')).toBe(true);
    expect(result.omitted.some(source => source.nodeId === 'result')).toBe(true);
    expect(nodes[0].id).toBe('old-video');
  });

  it('keeps an explicitly selected input ahead of newer matching uploads', () => {
    const old = { ...file('selected'), selected: true };
    const newer = Array.from({ length: 8 }, (_, i) => file(`new-${i}`));
    const result = canvasVisualSources([old, ...newer], [], 'Describe these image inputs');
    expect(result.sources[0].nodeId).toBe('selected');
    expect(result.sources[1].nodeId).toBe('new-7');
  });

  it('prioritizes video inputs when the question asks about uploaded clips', () => {
    const nodes = [...Array.from({ length: 7 }, (_, i) => file(`image-${i}`)), file('clip', 'video')];
    expect(canvasVisualSources(nodes, [], 'What happens in the uploaded clip?').sources[0].nodeId).toBe('clip');
  });

  it('handles local inputs, generated results and audio without inventing images', () => {
    const local = file('desktop'); local.data.config.fileUrl = '/Users/test/My Image.png';
    const generated = { ...file('generated'), data: { type: 'custom-video', label: 'Generated clip', config: {}, result: { url: 'https://media.example/clip.mp4?token=x' } } };
    const result = canvasVisualSources([local, generated, file('voice', 'audio')], [], 'Describe the canvas');
    expect(result.sources.map(source => source.mediaType)).toEqual(['image', 'video']);
    expect(result.sources[0].url).toBe('local-media://file/Users/test/My%20Image.png');
  });

  it('keeps successful previews when another file fails and states video limitations', async () => {
    const result = await prepareCanvasVisualContext([file('good'), file('missing')], [], 'Describe both', [], async source => {
      if (source.nodeId === 'missing') throw new Error('403');
      return [{ label: source.label, dataUrl: 'data:image/jpeg;base64,good' }];
    });
    expect(result.images).toHaveLength(1);
    expect(result.context).toContain('missing [node missing]: preview unavailable');
    expect(result.context).toContain('sampled still frames only');
    expect(result.context).toContain('not instructions');
  });

  it('samples start, middle and end within the video duration', () => {
    expect(videoSampleTimes(10)).toEqual([0, 5, 9.9]);
    expect(videoSampleTimes(0.05).every(time => time < 0.05)).toBe(true);
    expect(() => videoSampleTimes(Infinity)).toThrow();
  });
});
