import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';
import {
  bindPromptMentionsToGraph,
  extractPromptTags,
  mentionKey,
  resolveElementsForPrompt,
} from '@/lib/llm/prompt-elements';

const peter: Element = {
  id: 'el-peter',
  name: 'Peter',
  type: 'character',
  description: '',
  images: [{ id: 'img', url: 'local-media://peter.png', createdAt: '', source: 'upload' }],
  createdAt: '',
  updatedAt: '',
};

const sofa: Element = {
  id: 'el-sofa',
  name: 'Leather Chesterfield Sofa',
  type: 'prop',
  description: '',
  images: [],
  createdAt: '',
  updatedAt: '',
};

function promptNode(prompt: string): Node<WorkflowNodeData> {
  return {
    id: 'prompt-1',
    type: 'prompt',
    position: { x: 280, y: 80 },
    data: { type: 'prompt', label: 'Prompt', config: { prompt } },
  };
}

function bananaNode(): Node<WorkflowNodeData> {
  return {
    id: 'nb-1',
    type: 'nano-banana-2',
    position: { x: 620, y: 80 },
    data: { type: 'nano-banana-2', label: 'Nano Banana 2', config: {} },
  };
}

describe('prompt element mentions', () => {
  it('matches Director tags to library names even when punctuation differs', () => {
    expect(extractPromptTags('@Peter sits on the @Leather-Chesterfield-Sofa')).toEqual([
      '@Peter',
      '@Leather-Chesterfield-Sofa',
    ]);
    expect(mentionKey('@Dr-Jordans-Office')).toBe(mentionKey("Dr. Jordan's Office"));
    expect(resolveElementsForPrompt(
      '@Peter on the @Leather-Chesterfield-Sofa',
      [peter, sofa],
      [],
      { requireStill: false },
    ).map((row) => row.id)).toEqual(['el-peter', 'el-sofa']);
    expect(resolveElementsForPrompt('@Peter on the @Sofa', [peter, sofa])).toEqual([peter]);
  });

  it('wires tagged stills into the image model media ports', () => {
    const bound = bindPromptMentionsToGraph({
      nodes: [promptNode('@Peter sits stiffly on the sofa'), bananaNode()],
      edges: [],
      promptNodeIds: ['prompt-1'],
      elements: [peter, sofa],
    });
    const elementNode = bound.nodes.find((node) => node.type === 'element');
    expect(elementNode?.data.config.elementIds).toEqual(['el-peter']);
    expect(bound.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'prompt-1', sourceHandle: 'text', target: 'nb-1', targetHandle: 'prompt' }),
      expect.objectContaining({
        source: elementNode?.id,
        sourceHandle: 'element',
        target: 'nb-1',
        targetHandle: 'image_url',
      }),
    ]));
  });
});
