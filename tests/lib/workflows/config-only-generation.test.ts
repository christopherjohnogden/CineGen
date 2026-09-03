import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { executeFromNode } from '@/lib/workflows/execute';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';

/**
 * A Studio generation is a single node with no incoming edges: its prompt,
 * frames, and Elements all live in its own config. These tests pin the executor
 * behaviour that makes that safe — each one guards a failure that costs money
 * and reports success.
 */

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
];

function dispatch() {
  return {
    setNodeRunning: vi.fn(),
    setNodeResult: vi.fn(),
    addGeneration: vi.fn(),
    addAsset: vi.fn(),
    getElements: () => elements,
  };
}

function soloNode(type: string, config: Record<string, unknown>): Node<WorkflowNodeData>[] {
  return [{
    id: 'solo-1',
    type,
    position: { x: 0, y: 0 },
    data: { type, label: type, config } as WorkflowNodeData,
  }];
}

describe('config-only Studio generations', () => {
  beforeEach(() => {
    run.mockReset().mockResolvedValue({ url: 'https://cdn.example/out.png' });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { higgsfield: { generate: run } },
    });
  });

  it('runs a node that has a prompt in config and no edges at all', async () => {
    await executeFromNode(
      'solo-1',
      soloNode('hf-gpt-image-2', { prompt: 'A lighthouse at dusk.' }),
      [],
      dispatch(),
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt_image_2',
      params: expect.objectContaining({ prompt: 'A lighthouse at dusk.' }),
    }));
  });

  it('expands Elements supplied through config, with no element node or edge', async () => {
    await executeFromNode(
      'solo-1',
      soloNode('hf-gpt-image-2', {
        prompt: 'Portrait of @Peter.',
        medias: { elementIds: ['el-peter'] },
      }),
      [],
      dispatch(),
    );

    // Same media payload the element-node edge path produces.
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      medias: [
        { value: 'local-media://peter-front.png', role: 'image' },
        { value: 'local-media://peter-profile.png', role: 'image' },
      ],
    }));
  });

  it('rewrites @mentions for Elements that arrived through config', async () => {
    await executeFromNode(
      'solo-1',
      soloNode('hf-gpt-image-2', {
        prompt: 'Portrait of @Peter.',
        medias: { elementIds: ['el-peter'] },
      }),
      [],
      dispatch(),
    );

    const params = run.mock.calls[0][0].params as Record<string, unknown>;
    expect(String(params.prompt)).not.toContain('@Peter');
  });

  it('carries files attached from disk alongside the Elements in one reference', async () => {
    await executeFromNode(
      'solo-1',
      soloNode('hf-gpt-image-2', {
        prompt: 'He walks out of the tunnel.',
        medias: {
          elementIds: ['el-peter'],
          // The Studio's "+" attaches straight from disk: no Element behind these.
          urls: ['local-media://file/Users/chris/Movies/run-cycle.mp4', 'local-media://file/Users/chris/Pictures/jersey.png'],
        },
      }),
      [],
      dispatch(),
    );

    const sent = run.mock.calls[0][0].params as Record<string, unknown>;
    const references = Object.values(sent).flat().map((value) => (
      value && typeof value === 'object' && 'value' in value ? (value as { value: string }).value : value
    )).filter((value): value is string => typeof value === 'string');
    expect(references).toContain('local-media://file/Users/chris/Movies/run-cycle.mp4');
    expect(references).toContain('local-media://file/Users/chris/Pictures/jersey.png');
    // The Element's own images still ride along.
    expect(references).toContain('local-media://peter-front.png');
  });

  it('still refuses a required input that config does not supply', async () => {
    const setNodeResult = vi.fn();
    await executeFromNode(
      'solo-1',
      soloNode('hf-gpt-image-2', {}),
      [],
      { ...dispatch(), setNodeResult },
    );

    expect(run).not.toHaveBeenCalled();
    expect(setNodeResult).toHaveBeenCalledWith('solo-1', expect.objectContaining({ status: 'error' }));
  });
});
