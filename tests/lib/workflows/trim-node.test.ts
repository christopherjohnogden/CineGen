import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { executeFromNode } from '@/lib/workflows/execute';
import type { WorkflowNodeData } from '@/types/workflow';

const run = vi.fn();

function graph(trimConfig: Record<string, unknown>): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] } {
  return {
    nodes: [
      {
        id: 'file-1',
        type: 'filePicker',
        position: { x: 0, y: 0 },
        data: {
          type: 'filePicker',
          label: 'File Upload',
          config: { fileUrl: 'local-media://file/clips/source.mp4', fileType: 'video' },
        },
      },
      {
        id: 'trim-1',
        type: 'trim',
        position: { x: 300, y: 0 },
        data: { type: 'trim', label: 'Trim', config: trimConfig },
      },
      {
        id: 'model-1',
        type: 'hf-seedance-2-5',
        position: { x: 600, y: 0 },
        data: { type: 'hf-seedance-2-5', label: 'Seedance 2.5', config: { prompt: 'Go.' } },
      },
    ],
    edges: [
      { id: 'in', source: 'file-1', sourceHandle: 'media', target: 'trim-1', targetHandle: 'video' },
      { id: 'out', source: 'trim-1', sourceHandle: 'video', target: 'model-1', targetHandle: 'medias' },
    ],
  };
}

const dispatch = () => ({
  setNodeRunning: vi.fn(),
  setNodeResult: vi.fn(),
  addGeneration: vi.fn(),
  addAsset: vi.fn(),
  getElements: () => [],
});

/**
 * The Trim node sits between a source and a model, so what it emits is what gets
 * generated from. Emitting the untrimmed source after a trim was applied would
 * quietly spend a generation on the wrong footage.
 */
describe('trim node output', () => {
  beforeEach(() => {
    run.mockReset().mockResolvedValue({ url: 'https://cdn.example/out.mp4' });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { higgsfield: { generate: run } },
    });
  });

  it('sends the rendered trim downstream once one exists', async () => {
    const { nodes, edges } = graph({
      startSec: 10,
      endSec: 20,
      trimmedUrl: 'local-media://file/project/trim-abc.mp4',
      renderedStartSec: 10,
      renderedEndSec: 20,
    });

    await executeFromNode('model-1', nodes, edges, dispatch());

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      medias: [{ value: 'local-media://file/project/trim-abc.mp4', role: 'video' }],
    }));
  });

  /**
   * A Trim node dropped in but never applied must not break the graph — it
   * passes the source through, so the run still produces what it would have
   * without the node.
   */
  it('passes the source through when nothing has been trimmed yet', async () => {
    const { nodes, edges } = graph({ startSec: 0, endSec: 0, trimmedUrl: '' });

    await executeFromNode('model-1', nodes, edges, dispatch());

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      medias: [{ value: 'local-media://file/clips/source.mp4', role: 'video' }],
    }));
  });
});
