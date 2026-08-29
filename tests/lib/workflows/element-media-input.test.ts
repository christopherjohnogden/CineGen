import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { executeFromNode } from '@/lib/workflows/execute';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';

const run = vi.fn();

const elements: Element[] = [
  {
    id: 'el-peter',
    name: 'Peter',
    type: 'character',
    description: '',
    images: [
      { id: 'p1', url: 'local-media://peter-front.png', createdAt: '', source: 'upload' },
      { id: 'p2', url: 'local-media://peter-profile.png', createdAt: '', source: 'upload' },
    ],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'el-jordan',
    name: 'Dr. Jordan',
    type: 'character',
    description: '',
    images: [
      { id: 'j1', url: 'local-media://jordan-front.png', createdAt: '', source: 'upload' },
    ],
    createdAt: '',
    updatedAt: '',
  },
];

const nodes: Node<WorkflowNodeData>[] = [
  {
    id: 'prompt-1',
    type: 'prompt',
    position: { x: 0, y: 0 },
    data: { type: 'prompt', label: 'Prompt', config: { prompt: '@Peter and @Dr. Jordan' } },
  },
  {
    id: 'elements-1',
    type: 'element',
    position: { x: 0, y: 300 },
    data: { type: 'element', label: 'Element References', config: { elementIds: ['el-peter', 'el-jordan'] } },
  },
  {
    id: 'model-1',
    type: 'hf-gpt-image-2',
    position: { x: 500, y: 0 },
    data: { type: 'hf-gpt-image-2', label: 'GPT Image 2', config: {} },
  },
];

const edges: Edge[] = [
  { id: 'prompt-edge', source: 'prompt-1', sourceHandle: 'text', target: 'model-1', targetHandle: 'prompt' },
  { id: 'element-edge', source: 'elements-1', sourceHandle: 'element', target: 'model-1', targetHandle: 'medias' },
];

describe('stacked Element media inputs', () => {
  beforeEach(() => {
    run.mockReset().mockResolvedValue({ url: 'https://cdn.example/generated.png' });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { higgsfield: { generate: run } },
    });
  });

  it('passes every image from every selected element through a Higgsfield image medias input', async () => {
    await executeFromNode('model-1', nodes, edges, {
      setNodeRunning: vi.fn(),
      setNodeResult: vi.fn(),
      addGeneration: vi.fn(),
      addAsset: vi.fn(),
      getElements: () => elements,
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt_image_2',
      outputType: 'image',
      medias: [
        { value: 'local-media://peter-front.png', role: 'image' },
        { value: 'local-media://peter-profile.png', role: 'image' },
        { value: 'local-media://jordan-front.png', role: 'image' },
      ],
      params: expect.objectContaining({
        higgsfield_media_inputs: [
          { value: 'local-media://peter-front.png', role: 'image' },
          { value: 'local-media://peter-profile.png', role: 'image' },
          { value: 'local-media://jordan-front.png', role: 'image' },
        ],
      }),
      wait: true,
    }));
  });

  it('preserves the complete stack for Seedance 2.5 compatibility medias', async () => {
    const seedanceNodes = nodes.map((node) => (
      node.id === 'model-1'
        ? {
            ...node,
            type: 'hf-seedance-2-5',
            data: { type: 'hf-seedance-2-5', label: 'Seedance 2.5', config: {} },
          }
        : node
    ));

    await executeFromNode('model-1', seedanceNodes, edges, {
      setNodeRunning: vi.fn(),
      setNodeResult: vi.fn(),
      addGeneration: vi.fn(),
      addAsset: vi.fn(),
      getElements: () => elements,
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      model: 'seedance_2_5',
      outputType: 'video',
      medias: [
        { value: 'local-media://peter-front.png', role: 'image' },
        { value: 'local-media://peter-profile.png', role: 'image' },
        { value: 'local-media://jordan-front.png', role: 'image' },
      ],
      params: expect.objectContaining({
        medias: [
          'local-media://peter-front.png',
          'local-media://peter-profile.png',
          'local-media://jordan-front.png',
        ],
      }),
      wait: true,
    }));
  });

  it('coalesces repeated clicks while the same node is already running', async () => {
    let finish: ((value: { url: string }) => void) | undefined;
    run.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const dispatch = {
      setNodeRunning: vi.fn(),
      setNodeResult: vi.fn(),
      addGeneration: vi.fn(),
      addAsset: vi.fn(),
      getElements: () => elements,
    };

    const first = executeFromNode('model-1', nodes, edges, dispatch);
    const second = executeFromNode('model-1', nodes, edges, dispatch);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    finish?.({ url: 'https://cdn.example/generated.png' });
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledOnce();
  });
});
