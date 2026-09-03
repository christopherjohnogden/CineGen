import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

/**
 * Files attached in the Studio composer — a clip, a still, a voice memo — are
 * references, and they have no Element behind them. The user reported a render
 * that ignored an attached video and image, so this pins the whole path from the
 * config the composer writes to the request Topview actually receives.
 */

const NODE_TYPE = 'topview-video-seedance-2-5';

const seedance = {
  id: 'topview/video/Seedance 2.5',
  nodeType: NODE_TYPE,
  name: 'Seedance 2.5',
  category: 'video',
  provider: 'topview',
  outputType: 'video',
  responseMapping: { path: 'url' },
  inputs: [
    { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
    { id: 'image_url', portType: 'media', label: 'References', required: false, falParam: 'reference_images', fieldType: 'port', multiple: true, mediaRole: 'image' },
    { id: 'extra_images', portType: 'media', label: 'More References', required: false, falParam: 'image_urls', fieldType: 'element-list', max: 30, mediaRole: 'image' },
    { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', default: '4', options: [{ value: '4', label: '4' }] },
    { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '720', options: [{ value: '720', label: '720' }] },
    { id: 'aspect_ratio', portType: 'text', label: 'Aspect', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '16:9', options: [{ value: '16:9', label: '16:9' }] },
  ],
} as unknown as ModelDefinition;

vi.mock('@/lib/fal/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fal/models')>();
  return {
    ...actual,
    getModelDefinition: (type: string) => (type === NODE_TYPE ? seedance : actual.getModelDefinition(type)),
  };
});

const { executeFromNode } = await import('@/lib/workflows/execute');

const submit = vi.fn();
const query = vi.fn();

function dispatch() {
  return {
    setNodeRunning: vi.fn(),
    setNodeResult: vi.fn(),
    addGeneration: vi.fn(),
    addAsset: vi.fn(),
    getElements: () => [],
  };
}

function soloNode(config: Record<string, unknown>): Node<WorkflowNodeData>[] {
  return [{
    id: 'solo-1',
    type: NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { type: NODE_TYPE, label: 'Seedance 2.5', config } as WorkflowNodeData,
  }];
}

const VIDEO = 'local-media://file/Users/chris/CINEGEN/media/game.mp4';
const SHEET = 'local-media://file/Users/chris/CINEGEN/media/character-sheet.png';

describe('files attached in the Studio composer', () => {
  beforeEach(() => {
    submit.mockReset().mockResolvedValue({ taskId: 't1', taskType: 'omni_reference' });
    query.mockReset().mockResolvedValue({
      taskId: 't1', taskType: 'omni_reference', status: 'success', url: 'https://api.topview.ai/s/out',
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { topview: { submit, query } },
    });
  });

  it('sends an attached clip and still to Topview as references, not as nothing at all', async () => {
    await executeFromNode(
      'solo-1',
      // Exactly the shape the composer writes for "References" mode with two
      // files attached from disk and no Elements selected.
      soloNode({
        prompt: 'Replace the player wearing 13 with the person in the character sheet.',
        extra_images: { elementIds: [], elementVariationIds: {}, urls: [VIDEO, SHEET] },
        duration: '4',
        resolution: '720',
        aspect_ratio: '16:9',
      }),
      [],
      dispatch(),
    );

    expect(submit).toHaveBeenCalledTimes(1);
    const request = submit.mock.calls[0][0] as { medias?: Array<{ value: string; role: string }> };
    // The clip must arrive as a video reference — classified as an image it would
    // be uploaded to the wrong Topview input and silently dropped.
    expect(request.medias).toEqual(expect.arrayContaining([
      { value: VIDEO, role: 'video' },
      { value: SHEET, role: 'image' },
    ]));
  });

  it('carries them on the plain reference port too', async () => {
    await executeFromNode(
      'solo-1',
      soloNode({
        prompt: 'Extend the shot.',
        image_url: { elementIds: [], elementVariationIds: {}, urls: [VIDEO] },
        duration: '4',
        resolution: '720',
        aspect_ratio: '16:9',
      }),
      [],
      dispatch(),
    );

    const request = submit.mock.calls[0][0] as { medias?: Array<{ value: string; role: string }> };
    expect(request.medias).toEqual([{ value: VIDEO, role: 'video' }]);
  });
});
