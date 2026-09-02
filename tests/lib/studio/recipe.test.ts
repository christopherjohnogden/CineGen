import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { resolveStudioRecipe } from '@/lib/studio/recipe';
import type { Asset } from '@/types/project';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

const model = {
  nodeType: 'video-one',
  outputType: 'video',
  inputs: [
    { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
    { id: 'image_url', portType: 'image', label: 'References', required: false, falParam: 'reference_images', fieldType: 'port', multiple: true, mediaRole: 'image' },
    { id: 'start_frame', portType: 'image', label: 'Start Frame', required: false, falParam: 'image_url', fieldType: 'port', mediaRole: 'start_image' },
    { id: 'end_frame', portType: 'image', label: 'End Frame', required: false, falParam: 'end_frame_url', fieldType: 'port', mediaRole: 'end_image' },
    { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', options: [{ value: '5', label: '5' }, { value: '10', label: '10' }] },
    { id: 'generate_audio', portType: 'number', label: 'Audio', required: false, falParam: 'generate_audio', fieldType: 'toggle' },
  ],
} as unknown as ModelDefinition;

const assets: Asset[] = [
  { id: 'asset-start', name: 'first.png', type: 'image', url: '/media/first.png', createdAt: '' } as Asset,
  { id: 'asset-end', name: 'last.png', type: 'image', url: '/media/last.png', createdAt: '' } as Asset,
];

function node(id: string, type: string, config: Record<string, unknown>): Node<WorkflowNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { type, label: type, config } as WorkflowNodeData };
}

describe('resolveStudioRecipe', () => {
  it('recovers everything from a generation built on the canvas, not the Studio', () => {
    // No __studio* keys anywhere: prompt, Elements and frames live on upstream nodes.
    const nodes = [
      node('p', 'prompt', { prompt: 'Push in on the monster as it roars.' }),
      node('e', 'element', { elementIds: ['el-sky', 'el-cave'], elementVariationIds: { 'el-sky': 'v2' } }),
      node('f1', 'filePicker', { fileUrl: '/media/first.png' }),
      node('f2', 'filePicker', { fileUrl: '/media/last.png' }),
      node('m', 'video-one', { duration: '10', generate_audio: true }),
    ];
    const edges: Edge[] = [
      { id: '1', source: 'p', target: 'm', sourceHandle: 'text', targetHandle: 'prompt' },
      { id: '2', source: 'e', target: 'm', sourceHandle: 'element', targetHandle: 'image_url' },
      { id: '3', source: 'f1', target: 'm', sourceHandle: 'media', targetHandle: 'start_frame' },
      { id: '4', source: 'f2', target: 'm', sourceHandle: 'media', targetHandle: 'end_frame' },
    ];

    const recipe = resolveStudioRecipe(nodes[4], model, nodes, edges, assets);

    expect(recipe.prompt).toBe('Push in on the monster as it roars.');
    expect(recipe.elementIds).toEqual(['el-sky', 'el-cave']);
    expect(recipe.elementVariationIds).toEqual({ 'el-sky': 'v2' });
    expect(recipe.startAssetId).toBe('asset-start');
    expect(recipe.endAssetId).toBe('asset-end');
    expect(recipe.controls).toEqual({ duration: '10', generate_audio: true });
    // Elements attached means the composer should open in References mode.
    expect(recipe.videoMode).toBe('references');
  });

  it('prefers the authored prompt over the composed one so a preset suffix is not re-appended', () => {
    const only = [node('m', 'video-one', {
      prompt: 'A wide shot. Cinematic anamorphic lensing.',
      __studioPromptBody: 'A wide shot.',
      __studioPresetId: 'builtin-cinematic',
      __studioElementIds: ['el-sky'],
      __studioElementNames: ['Sky Diver'],
      __studioStartAssetId: 'asset-start',
      __studioVideoMode: 'frames',
    })];

    const recipe = resolveStudioRecipe(only[0], model, only, [], assets);

    expect(recipe.prompt).toBe('A wide shot.');
    expect(recipe.presetId).toBe('builtin-cinematic');
    expect(recipe.elementIds).toEqual(['el-sky']);
    expect(recipe.elementNames).toEqual(['Sky Diver']);
    expect(recipe.startAssetId).toBe('asset-start');
    // An explicit stored mode wins over inference from attached Elements.
    expect(recipe.videoMode).toBe('frames');
  });

  it('lets a live edge override a stale config value', () => {
    // The node's own config says one prompt; a wired Prompt node says another.
    // The wired one is what would execute, so it is what gets reused.
    const nodes = [
      node('p', 'prompt', { prompt: 'The wired prompt.' }),
      node('m', 'video-one', { prompt: 'The stale config prompt.' }),
    ];
    const edges: Edge[] = [{ id: '1', source: 'p', target: 'm', sourceHandle: 'text', targetHandle: 'prompt' }];

    expect(resolveStudioRecipe(nodes[1], model, nodes, edges, assets).prompt).toBe('The wired prompt.');
  });

  it('reads a one-node Studio generation that carries an ElementRef in config', () => {
    const only = [node('m', 'video-one', {
      prompt: 'Held on the diver.',
      image_url: { elementIds: ['el-sky'], elementVariationIds: {} },
      start_frame: '/media/first.png',
    })];

    const recipe = resolveStudioRecipe(only[0], model, only, [], assets);

    expect(recipe.prompt).toBe('Held on the diver.');
    expect(recipe.elementIds).toEqual(['el-sky']);
    expect(recipe.startAssetId).toBe('asset-start');
  });
});
