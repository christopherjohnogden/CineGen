import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';
import type { Element } from '@/types/elements';

const models = vi.hoisted(() => {
  const prompt = { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' };
  const references = { id: 'image_url', portType: 'image', label: 'References', required: false, falParam: 'reference_images', fieldType: 'port', multiple: true, mediaRole: 'image' };
  return ({
  'topview-video-seedance-2-5': {
    id: 'seedance', nodeType: 'topview-video-seedance-2-5', name: 'Seedance 2.5', category: 'video',
    provider: 'topview', outputType: 'video', responseMapping: { path: 'video.url' },
    inputs: [
      { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
      { id: 'image_url', portType: 'image', label: 'References', required: false, falParam: 'reference_images', fieldType: 'port', multiple: true, mediaRole: 'image' },
      { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', options: [{ value: '5', label: '5' }, { value: '10', label: '10' }] },
      { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', options: [{ value: '720p', label: '720p' }] },
    ],
  },
  // A fixed-length model: it publishes no duration at all.
  'topview-video-omni': {
    id: 'omni', nodeType: 'topview-video-omni', name: 'Gemini Omni Flash', category: 'video',
    provider: 'topview', outputType: 'video', responseMapping: { path: 'video.url' },
    inputs: [prompt, references],
  },
  'topview-image-seedream': {
    id: 'seedream', nodeType: 'topview-image-seedream', name: 'Seedream 4.5', category: 'image',
    provider: 'topview', outputType: 'image', responseMapping: { path: 'images[0].url' },
    inputs: [prompt],
  },
}) as unknown as Record<string, ModelDefinition>;
});

// node-registry builds its definitions from ALL_MODELS at import time, so the
// mock has to stand in for the whole catalogue, not just the lookup.
vi.mock('@/lib/fal/models', () => ({
  ALL_MODELS: models,
  getModelDefinition: (nodeType: string) => models[nodeType],
  getAllModelNodeTypes: () => Object.keys(models),
  getModelsByProvider: () => [],
  installTopviewModelCatalog: () => {},
}));
vi.mock('@/lib/workflows/provider-model-options', () => ({
  modelProviderLabel: () => 'Topview AI',
  providerModelOptions: (categories: string[]) => (categories.includes('video')
    ? [{ key: 'topview-video-omni', label: 'Topview AI · Gemini Omni Flash' }, { key: 'topview-video-seedance-2-5', label: 'Topview AI · Seedance 2.5' }]
    : [{ key: 'topview-image-seedream', label: 'Topview AI · Seedream 4.5' }]),
}));
vi.mock('@/lib/llm/space-node-factory', () => ({
  createWorkflowNodeFromSpec: (spec: { nodeType: string; label: string; config: Record<string, unknown> }, position: { x: number; y: number }) => ({
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: spec.nodeType,
    position,
    data: { type: spec.nodeType, label: spec.label, config: spec.config },
  }),
}));

import { createMcpHandlers } from '@/lib/mcp/handlers';
import { McpToolError, type McpAction, type McpHostState } from '@/lib/mcp/types';
import { createEmptyDirectorShow } from '@/lib/director/create-show';

const SCRIPT = `INT. UNDERGROUND BUNKER - NIGHT

A single bulb sways. DR JORDAN kneels beside a cracked console.

DR JORDAN
The readings are wrong.

He lifts a GEIGER COUNTER and listens.

EXT. BIRCH FOREST - DAY

PETER runs between the trunks.
`;

function element(name: string, type: Element['type'] = 'character'): Element {
  return { id: `el-${name.toLowerCase()}`, name, type, description: '', images: [], createdAt: '', updatedAt: '' };
}

function makeHost(overrides: Partial<McpHostState> = {}) {
  const state: McpHostState = {
    nodes: [], edges: [], spaces: [{ id: 's1', name: 'Space 1', createdAt: '', nodes: [], edges: [] }],
    activeSpaceId: 's1', elements: [element('Hazmat'), element('Birch Forest', 'location')],
    assets: [], timelines: [], activeTimelineId: '', director: createEmptyDirectorShow(),
    ...overrides,
  };
  const actions: McpAction[] = [];
  const runNode = vi.fn();
  const host = {
    getState: () => state,
    dispatch: (action: McpAction) => {
      actions.push(action);
      // Mirror the reducer closely enough that sequential tool calls see their own writes.
      if (action.type === 'SET_NODES') state.nodes = action.nodes;
      if (action.type === 'ADD_SPACE') state.spaces = [...state.spaces, action.space];
      if (action.type === 'ADD_ELEMENT') state.elements = [...state.elements, action.element];
      if (action.type === 'SET_DIRECTOR') state.director = action.director;
    },
    runNode,
    projectName: 'Subconscious Mind',
  };
  return { host, state, actions, runNode, handlers: createMcpHandlers(host) };
}

describe('MCP tools', () => {
  let harness: ReturnType<typeof makeHost>;
  beforeEach(() => { harness = makeHost(); });

  it('reports the project so the model can act on real names and ids', async () => {
    const context = await harness.handlers.cinegen_get_context({}) as Record<string, unknown>;
    expect(context.project).toBe('Subconscious Mind');
    expect(context.spaces).toEqual([{ id: 's1', name: 'Space 1', nodeCount: 0, active: true }]);
    expect((context.elements as Array<{ name: string }>).map((e) => e.name)).toEqual(['Hazmat', 'Birch Forest']);
    expect((context.director as { hasScript: boolean }).hasScript).toBe(false);
  });

  it('generates one node per version and starts each one', async () => {
    const result = await harness.handlers.cinegen_generate({
      prompt: 'Close on the hazmat suit, slow push in.',
      count: 3,
      durationSec: 10,
    }) as { started: number; model: string; nodeIds: string[] };

    expect(result.started).toBe(3);
    expect(result.model).toBe('Seedance 2.5');
    expect(harness.runNode).toHaveBeenCalledTimes(3);

    const nodes = harness.state.nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes[0].data.config.prompt).toBe('Close on the hazmat suit, slow push in.');
    expect(nodes[0].data.config.duration).toBe('10');
    expect(nodes[0].data.config.__studioGenerated).toBe(true);
    expect(nodes.map((node) => node.data.config.__studioBatchIndex)).toEqual([1, 2, 3]);
  });

  it('never sends a duration to a model that does not publish one', async () => {
    await harness.handlers.cinegen_generate({ prompt: 'A wide shot.', model: 'Gemini Omni Flash', durationSec: 8 });
    const config = harness.state.nodes[0].data.config;
    expect(config.duration).toBeUndefined();
    expect(config.resolution).toBeUndefined();
  });

  it('attaches Elements by name and refuses one that does not exist', async () => {
    await harness.handlers.cinegen_generate({ prompt: 'Hold on him.', elements: ['Hazmat'] });
    const config = harness.state.nodes[0].data.config;
    expect(config.image_url).toEqual({ elementIds: ['el-hazmat'], elementVariationIds: {} });
    expect(config.__studioElementNames).toEqual(['Hazmat']);

    await expect(harness.handlers.cinegen_generate({ prompt: 'x', elements: ['Sky Diver'] }))
      .rejects.toThrow(/No Element named "Sky Diver".*Hazmat/s);
  });

  it('names the models that do exist when asked for one that does not', async () => {
    await expect(harness.handlers.cinegen_generate({ prompt: 'x', model: 'Sora 9' }))
      .rejects.toThrow(/No video model matches "Sora 9".*Seedance 2\.5/s);
  });

  it('picks an image model for image work', async () => {
    const result = await harness.handlers.cinegen_generate({ prompt: 'A poster.', kind: 'image' }) as { model: string };
    expect(result.model).toBe('Seedream 4.5');
    expect(harness.state.nodes[0].type).toBe('topview-image-seedream');
  });

  it('lists what each model accepts so the model can choose one', async () => {
    const listed = await harness.handlers.cinegen_list_models({ kind: 'video' }) as { models: Array<Record<string, unknown>> };
    const seedance = listed.models.find((entry) => entry.name === 'Seedance 2.5');
    expect(seedance).toMatchObject({ provider: 'Topview AI', takesReferences: true, durations: ['5', '10'] });
    const omni = listed.models.find((entry) => entry.name === 'Gemini Omni Flash');
    expect(omni?.durations).toBeNull();
  });

  it('reports generations with their status and media', async () => {
    const done = {
      id: 'n1', type: 'topview-video-seedance-2-5', position: { x: 0, y: 0 },
      data: {
        type: 'topview-video-seedance-2-5', label: 'Seedance 2.5',
        config: { __studioGenerated: true, __studioPromptBody: 'Push in.' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      },
    } as unknown as Node<WorkflowNodeData>;
    harness = makeHost({ nodes: [done] });

    const result = await harness.handlers.cinegen_get_generations({}) as { generations: Array<Record<string, unknown>> };
    expect(result.generations[0]).toMatchObject({
      nodeId: 'n1', model: 'Seedance 2.5', kind: 'video', status: 'complete',
      url: 'https://media.example/a.mp4', prompt: 'Push in.',
    });
  });

  it('breaks a script into scenes and a first-pass breakdown', async () => {
    const result = await harness.handlers.cinegen_load_script({ text: SCRIPT }) as {
      scenes: Array<{ label: string }>; breakdown: Array<{ name: string; kind: string }>;
    };

    expect(result.scenes.map((scene) => scene.label)).toEqual([
      'INT. UNDERGROUND BUNKER - NIGHT',
      'EXT. BIRCH FOREST - DAY',
    ]);
    const names = result.breakdown.map((item) => item.name.toUpperCase());
    expect(names).toContain('DR JORDAN');
    expect(harness.state.director.sourceText).toBe(SCRIPT);
  });

  it('merges a better breakdown over the deterministic one', async () => {
    await harness.handlers.cinegen_load_script({ text: SCRIPT });
    await harness.handlers.cinegen_set_breakdown({
      items: [{ name: 'DR JORDAN', kind: 'character', description: 'Late forties, wire-rimmed glasses, cardigan.' }],
    });
    const jordan = harness.state.director.breakdown.find((item) => item.name.toUpperCase() === 'DR JORDAN');
    expect(jordan?.description).toBe('Late forties, wire-rimmed glasses, cardigan.');
  });

  it('rejects a breakdown with no usable items', async () => {
    await expect(harness.handlers.cinegen_set_breakdown({ items: [{ name: 'X', kind: 'spaceship' }] }))
      .rejects.toThrow(/name and a kind/);
    await expect(harness.handlers.cinegen_set_breakdown({ items: [] })).rejects.toThrow(/non-empty array/);
  });

  it('asks for a script before a shot list, and for a shot list before generating shots', async () => {
    await expect(harness.handlers.cinegen_set_shotlist({ shotlist: '{}' }))
      .rejects.toThrow(/Load a script first/);
    await expect(harness.handlers.cinegen_generate_shots({}))
      .rejects.toThrow(/no shot list yet/i);
  });

  it('explains an unreadable shot list instead of failing silently', async () => {
    await harness.handlers.cinegen_load_script({ text: SCRIPT });
    await expect(harness.handlers.cinegen_set_shotlist({ shotlist: 'not json at all' }))
      .rejects.toThrow(McpToolError);
  });

  it('creates a Space from a template and makes it active', async () => {
    const result = await harness.handlers.cinegen_create_space({
      name: 'Opening sequence',
      template: 'multi-shot',
      prompts: ['Wide on the bunker.', 'Close on the counter.'],
    }) as { spaceId: string; nodeCount: number };

    expect(result.nodeCount).toBeGreaterThan(0);
    expect(harness.state.spaces.map((space) => space.name)).toContain('Opening sequence');
    expect(harness.actions.some((action) => action.type === 'SET_ACTIVE_SPACE' && action.spaceId === result.spaceId)).toBe(true);
  });

  it('creates an Element that later generations can reference by name', async () => {
    const created = await harness.handlers.cinegen_create_element({
      name: 'Peter', type: 'character', description: 'Nine years old, navy hoodie.',
      imageUrl: 'https://media.example/peter.png',
    }) as { elementId: string };

    const element = harness.state.elements.find((entry) => entry.id === created.elementId);
    expect(element).toMatchObject({ name: 'Peter', type: 'character' });
    expect(element?.images[0].url).toBe('https://media.example/peter.png');

    await harness.handlers.cinegen_generate({ prompt: 'Peter runs.', elements: ['Peter'] });
    expect(harness.state.nodes[0].data.config.__studioElementNames).toEqual(['Peter']);
  });

  it('rejects an Element type it cannot store', async () => {
    await expect(harness.handlers.cinegen_create_element({ name: 'Rain', type: 'weather' }))
      .rejects.toThrow(/character, location, prop or vehicle/);
  });

  it('requires a prompt', async () => {
    await expect(harness.handlers.cinegen_generate({})).rejects.toThrow(/"prompt" is required/);
  });
});
