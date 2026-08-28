import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { Element } from '@/types/elements';
import type { WorkflowNodeData } from '@/types/workflow';
import {
  attachElementMentionToGraph,
  bindPromptMentionsToGraph,
  extractPromptTags,
  mentionKey,
  reconcilePromptMentionConnections,
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

const jordan: Element = {
  id: 'el-jordan',
  name: 'Dr. Jordan',
  type: 'character',
  description: '',
  images: [{ id: 'img-jordan', url: 'local-media://jordan.png', createdAt: '', source: 'upload' }],
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

function higgsfieldNode(): Node<WorkflowNodeData> {
  return {
    id: 'hf-1',
    type: 'hf-gpt-image-2',
    position: { x: 620, y: 80 },
    data: { type: 'hf-gpt-image-2', label: 'GPT Image 2', config: {} },
  };
}

function qwenNode(): Node<WorkflowNodeData> {
  return {
    id: 'qwen-1',
    type: 'runpod-qwen-image-edit-session',
    position: { x: 620, y: 80 },
    data: { type: 'runpod-qwen-image-edit-session', label: 'Qwen Image Edit Session', config: {} },
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
        targetHandle: 'extra_images_0',
      }),
    ]));
    expect(bound.nodes.find((node) => node.id === 'nb-1')?.data.config._elementCount).toBe(1);
  });

  it('stacks repeated picker selections in one element node wired once to medias', () => {
    const prompt = promptNode('Close up on @Peter');
    const model = higgsfieldNode();
    const promptEdge = {
      id: 'prompt-edge',
      source: prompt.id,
      sourceHandle: 'text',
      target: model.id,
      targetHandle: 'prompt',
    };
    const first = attachElementMentionToGraph({
      nodes: [prompt, model],
      edges: [promptEdge],
      promptNodeId: prompt.id,
      elementId: peter.id,
    });
    const second = attachElementMentionToGraph({
      nodes: first.nodes,
      edges: first.edges,
      promptNodeId: prompt.id,
      elementId: jordan.id,
    });
    const duplicate = attachElementMentionToGraph({
      nodes: second.nodes,
      edges: second.edges,
      promptNodeId: prompt.id,
      elementId: peter.id,
    });

    const elementNodes = duplicate.nodes.filter((node) => node.type === 'element');
    expect(elementNodes).toHaveLength(1);
    expect(elementNodes[0].data.config.elementIds).toEqual(['el-peter', 'el-jordan']);
    expect(duplicate.edges.filter((edge) => (
      edge.source === elementNodes[0].id
      && edge.target === model.id
      && edge.targetHandle === 'medias'
    ))).toHaveLength(1);
  });

  it('wires Qwen mentions to its required Image socket and keeps multiple picks stacked', () => {
    const prompt = promptNode('Close up on @Peter');
    const model = qwenNode();
    const first = attachElementMentionToGraph({
      nodes: [prompt, model],
      edges: [],
      promptNodeId: prompt.id,
      elementId: peter.id,
    });
    const second = attachElementMentionToGraph({
      nodes: first.nodes,
      edges: first.edges,
      promptNodeId: prompt.id,
      elementId: jordan.id,
    });
    const elementNodes = second.nodes.filter((node) => node.type === 'element');

    expect(elementNodes).toHaveLength(1);
    expect(elementNodes[0].data.config.elementIds).toEqual(['el-peter', 'el-jordan']);
    expect(second.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: elementNodes[0].id,
        sourceHandle: 'element',
        target: model.id,
        targetHandle: 'image_url',
      }),
    ]));
    expect(second.edges.some((edge) => edge.targetHandle === 'extra_images_0')).toBe(false);
  });

  it('connects the shared element node when the model is wired after the mention', () => {
    const prompt = promptNode('@Peter waits');
    const selected = attachElementMentionToGraph({
      nodes: [prompt],
      edges: [],
      promptNodeId: prompt.id,
      elementId: peter.id,
    });
    const model = higgsfieldNode();
    const connected = reconcilePromptMentionConnections({
      nodes: [...selected.nodes, model],
      edges: [{
        id: 'prompt-edge',
        source: prompt.id,
        sourceHandle: 'text',
        target: model.id,
        targetHandle: 'prompt',
      }],
      promptNodeId: prompt.id,
    });
    const elementNode = connected.nodes.find((node) => node.type === 'element');

    expect(connected.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: elementNode?.id,
        sourceHandle: 'element',
        target: model.id,
        targetHandle: 'medias',
      }),
    ]));
  });
});
