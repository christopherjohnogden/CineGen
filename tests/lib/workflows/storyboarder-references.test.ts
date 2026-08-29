import { describe, expect, it } from 'vitest';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import {
  collectStoryboarderReferences,
  selectStoryboarderReferences,
  storyboarderImagePrompt,
  storyboarderReferenceLimit,
} from '@/lib/workflows/storyboarder-references';
import type { Element } from '@/types/elements';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

const elements: Element[] = [
  {
    id: 'character-1', name: 'Peter', type: 'character', description: '',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    images: [
      { id: 'p1', url: 'https://cdn.example/peter-front.png', createdAt: '2026-01-01', source: 'upload' },
      { id: 'p2', url: 'https://cdn.example/peter-profile.png', createdAt: '2026-01-01', source: 'upload' },
    ],
  },
  {
    id: 'location-1', name: "Jordan's Office", type: 'location', description: '',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    images: [
      { id: 'l1', url: 'https://cdn.example/office-wide.png', createdAt: '2026-01-01', source: 'upload' },
      { id: 'l2', url: 'https://cdn.example/office-desk.png', createdAt: '2026-01-01', source: 'upload' },
    ],
  },
];

function source(data: Partial<WorkflowNodeData>): WorkflowNodeData {
  return {
    type: 'filePicker',
    label: 'Reference',
    config: {},
    ...data,
  };
}

describe('Storyboarder references', () => {
  it('expands a stacked Element node and gives every element a primary image before alternate views', () => {
    const references = collectStoryboarderReferences([
      source({
        type: 'element',
        config: { elementIds: ['character-1', 'location-1'] },
      }),
    ], elements, 'content');

    expect(references.map((reference) => [reference.label, reference.url])).toEqual([
      ["Jordan's Office", 'https://cdn.example/office-wide.png'],
      ['Peter', 'https://cdn.example/peter-front.png'],
      ["Jordan's Office", 'https://cdn.example/office-desk.png'],
      ['Peter', 'https://cdn.example/peter-profile.png'],
    ]);
  });

  it('collects uploaded and generated images as independent references', () => {
    const references = collectStoryboarderReferences([
      source({ label: 'Movie still', config: { fileUrl: 'file:///style-a.png' } }),
      source({ label: 'Generated frame', result: { url: 'https://cdn.example/frame.png' } }),
    ], elements, 'style');

    expect(references).toMatchObject([
      { label: 'Movie still', url: 'file:///style-a.png', kind: 'style' },
      { label: 'Generated frame', url: 'https://cdn.example/frame.png', kind: 'style' },
    ]);
  });

  it('reserves room for style images without dropping every continuity reference', () => {
    const content = collectStoryboarderReferences([
      source({ type: 'element', config: { elementIds: ['character-1', 'location-1'] } }),
    ], elements, 'content');
    const style = collectStoryboarderReferences([
      source({ label: 'Film still', config: { fileUrl: 'file:///film-still.png' } }),
    ], elements, 'style');

    const selected = selectStoryboarderReferences(content, style, 3);
    expect(selected.map((reference) => reference.kind)).toEqual(['content', 'content', 'style']);
    expect(selected.map((reference) => reference.label)).toEqual(["Jordan's Office", 'Peter', 'Film still']);
  });

  it('binds content and style pictures to different jobs in every frame prompt', () => {
    const prompt = storyboarderImagePrompt('Peter opens the black book.', [
      { url: 'location.png', kind: 'content', label: "Jordan's Office", elementType: 'location' },
      { url: 'peter.png', kind: 'content', label: 'Peter', elementType: 'character' },
      { url: 'style.png', kind: 'style', label: '1970s film still' },
    ], 'A restrained 1970s conspiracy thriller with warm tungsten light.');

    expect(prompt).toContain('Picture 1: location "Jordan\'s Office"');
    expect(prompt).toContain('Picture 2: character "Peter"');
    expect(prompt).toContain('Picture 3: style reference "1970s film still"');
    expect(prompt).toContain('Borrow only its lighting, color science, contrast, lens character, texture, composition language, and atmosphere');
    expect(prompt).toContain('Do not render labels');
  });

  it('advertises multi-reference inputs on the Storyboarder node and allows 16 Topview references', () => {
    expect(NODE_REGISTRY.storyboarder.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'image', label: 'References', multiple: true }),
      expect.objectContaining({ id: 'style', label: 'Style', multiple: true }),
    ]));

    const topviewModel = {
      id: 'topview/image/GPT Image 2', nodeType: 'topview-image-gpt-image-2', name: 'GPT Image 2',
      category: 'image', description: '', outputType: 'image', provider: 'topview',
      inputs: [], responseMapping: { path: 'url' },
    } satisfies ModelDefinition;
    expect(storyboarderReferenceLimit(topviewModel)).toBe(16);
  });
});
