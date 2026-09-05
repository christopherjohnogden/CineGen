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
      if (action.type === 'SET_NODES') {
        state.nodes = action.nodes;
        state.spaces = state.spaces.map(s=>s.id===state.activeSpaceId?{...s,nodes:action.nodes}:s);
      }
      if (action.type === 'SET_EDGES') state.edges = action.edges;
      if (action.type === 'SET_ACTIVE_SPACE') {
        const target=state.spaces.find(s=>s.id===action.spaceId)!;
        state.activeSpaceId=target.id;state.nodes=target.nodes;state.edges=target.edges;
      }
      if (action.type === 'UPDATE_ELEMENT') state.elements=state.elements.map(e=>e.id===action.elementId?{...e,...action.updates}:e);
      if (action.type === 'SET_TIMELINE') state.timelines=state.timelines.map(t=>t.id===action.timelineId?action.timeline:t);
      if (action.type === 'ADD_TIMELINE') state.timelines=[...state.timelines,action.timeline];
      if (action.type === 'ADD_ASSET') state.assets=[...state.assets,action.asset];
      if (action.type === 'ADD_SPACE') state.spaces = [...state.spaces, action.space];
      if (action.type === 'ADD_ELEMENT') state.elements = [...state.elements, action.element];
      if (action.type === 'SET_DIRECTOR') state.director = action.director;
    },
    runNode,
    appAction: vi.fn(async () => ({ id: 'job-1', status: 'running' })),
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


describe('expanded MCP workflows', () => {
  it('requires explicit approval, links selected breakdown items, and reuses links on retry', async () => {
    const h=makeHost();
    await h.handlers.cinegen_load_script({text:SCRIPT});
    expect(h.state.director.autoSync).toBe(false);
    const id=h.state.director.breakdown[0].id;
    const before=h.state.elements.length;
    await expect(h.handlers.cinegen_approve_breakdown({itemIds:[id],approved:false})).rejects.toThrow();
    expect(h.state.elements).toHaveLength(before);
    await h.handlers.cinegen_approve_breakdown({itemIds:[id],approved:true});
    const linked=h.state.director.breakdown[0].elementId;
    expect(h.state.elements.some(e=>e.id===linked)).toBe(true);
    const count=h.state.elements.length;
    await h.handlers.cinegen_approve_breakdown({itemIds:[id],approved:true});
    expect(h.state.elements).toHaveLength(count);
    expect(h.state.director.breakdownApproved).toBe(true);
  });
  it('validates every requested breakdown item before creating anything', async () => {
    const h=makeHost();await h.handlers.cinegen_load_script({text:SCRIPT});
    const before=h.state.elements.length;
    await expect(h.handlers.cinegen_approve_breakdown({itemIds:[h.state.director.breakdown[0].id,'missing'],approved:true})).rejects.toThrow(/No breakdown/);
    expect(h.state.elements).toHaveLength(before);
  });
  it('allows reference images and variations to be edited and rejects broken default references', async () => {
    const h=makeHost();const id=h.state.elements[0].id;
    await h.handlers.cinegen_edit_element({elementId:id,patch:{images:[{id:'im1',url:'https://example.com/image.png',source:'generated',createdAt:''}]}});
    expect(h.state.elements[0].images).toHaveLength(1);
    await expect(h.handlers.cinegen_edit_element({elementId:id,patch:{activeVariationId:'missing'}})).rejects.toThrow(/No variation/);
    await expect(h.handlers.cinegen_edit_element({elementId:id,patch:{id:'replace-id'}})).rejects.toThrow(/Invalid arguments/);
  });
  it('reads full scripts, IDs and breakdown descriptions instead of only counts', async () => {
    const h=makeHost();await h.handlers.cinegen_load_script({text:SCRIPT});
    const result=await h.handlers.cinegen_read({section:'director'}) as typeof h.state.director;
    expect(result.sourceText).toBe(SCRIPT);expect(result.breakdown[0].id).toBeTruthy();
    const capabilities=await h.handlers.cinegen_capabilities({}) as {shotlistInstructions:string};
    expect(capabilities.shotlistInstructions).toContain('PROJECT INPUT');
  });
  it('generates into a specified Space and actually places the node on Canvas', async () => {
    const h=makeHost({spaces:[{id:'s1',name:'one',nodes:[],edges:[],createdAt:''},{id:'s2',name:'two',nodes:[],edges:[],createdAt:''}]});
    await h.handlers.cinegen_generate({prompt:'Wide shot',spaceId:'s2',view:'canvas'});
    expect(h.state.activeSpaceId).toBe('s2');
    expect(h.state.spaces[0].nodes).toHaveLength(0);
    expect(h.state.nodes.some(n=>n.data.config.__studioCanvasPlaced===true)).toBe(true);
    expect(h.state.edges.length).toBeGreaterThan(0);
    expect(h.runNode).toHaveBeenCalledTimes(1);
    expect(h.host.appAction).toHaveBeenCalledWith('view',{view:'canvas'});
  });
  it('does not overwrite another generation when starting multiple calls', async () => {
    const h=makeHost();
    await h.handlers.cinegen_generate({prompt:'one'});await h.handlers.cinegen_generate({prompt:'two'});
    expect(h.state.nodes).toHaveLength(2);
  });
  it('routes Director generation through the app pipeline instead of creating unrelated Space nodes', async () => {
    const h=makeHost();await h.handlers.cinegen_load_script({text:SCRIPT});
    const scene=h.state.director.scenes[0];
    await h.handlers.cinegen_set_shotlist({shotlist:JSON.stringify({scenes:[scene],clips:[{id:'1A',sceneId:scene.id,title:'Opening',seconds:10,subject:'Jordan',location:'Bunker',style:'',constraints:'',elementTags:[],beats:[{n:1,from:'00:00',to:'00:10',dur:10,text:'Jordan looks up.'}]}]})});
    expect(h.state.director.clips).toHaveLength(1);
    await h.handlers.cinegen_generate_shots({});
    expect(h.host.appAction).toHaveBeenCalledWith('director',{action:'generate',clipIds:[h.state.director.clips[0].id]});
    expect(h.runNode).not.toHaveBeenCalled();
  });
  it('rejects fields for the wrong Director target and unknown element links', async () => {
    const h=makeHost();await h.handlers.cinegen_load_script({text:SCRIPT});
    await expect(h.handlers.cinegen_edit_director({target:'show',patch:{elementId:'bad'}})).rejects.toThrow();
    await expect(h.handlers.cinegen_edit_director({target:'breakdown',id:h.state.director.breakdown[0].id,patch:{elementId:'bad'}})).rejects.toThrow(/No Element/);
    await h.handlers.cinegen_edit_director({target:'show',patch:{resolution:'1080p',generateAudio:true}});
    expect(h.state.director.resolution).toBe('1080p');
  });
  it('validates timelines before saving trims, speed, keyframes and markers', async () => {
    const h=makeHost();
    const timeline=await h.handlers.cinegen_timeline({action:'create',name:'Rough cut'}) as import('@/types/timeline').Timeline;
    const asset=await h.handlers.cinegen_asset({action:'add',patch:{name:'Take',type:'video',url:'https://example.com/take.mp4'}}) as {id:string};
    const edited=structuredClone(timeline);
    edited.clips=[{id:'c1',assetId:asset.id,trackId:timeline.tracks[0].id,name:'Take',startTime:3,duration:10,trimStart:1,trimEnd:1,speed:2,opacity:1,volume:.5,flipH:false,flipV:false,keyframes:[{time:0,property:'opacity',value:0}]}];
    edited.markers=[{id:'m1',time:3,color:'red',label:'Start'}];
    await h.handlers.cinegen_set_timeline({timeline:edited});
    expect(h.state.timelines[0].duration).toBe(7);
    const invalid=structuredClone(edited);invalid.clips[0].assetId='missing';
    await expect(h.handlers.cinegen_set_timeline({timeline:invalid})).rejects.toThrow(/No asset/);
    invalid.clips[0].assetId=asset.id;invalid.clips[0].trimStart=10;
    await expect(h.handlers.cinegen_set_timeline({timeline:invalid})).rejects.toThrow(/trims/);
    await expect(h.handlers.cinegen_asset({action:'delete',assetId:asset.id})).rejects.toThrow(/referenced/);
  });
  it('validates node IDs before deleting or running anything', async () => {
    const h=makeHost();await h.handlers.cinegen_generate({prompt:'one'});
    const id=h.state.nodes[0].id;
    await expect(h.handlers.cinegen_nodes({action:'delete',nodeIds:[id,'missing']})).rejects.toThrow(/No node/);
    expect(h.state.nodes).toHaveLength(1);
    await h.handlers.cinegen_nodes({action:'update',nodeIds:[id],config:{prompt:'Updated'},position:{x:50,y:60}});
    expect(h.state.nodes[0].data.config.prompt).toBe('Updated');
    expect(h.state.nodes[0].position).toEqual({x:50,y:60});
  });
  it('rejects malformed arguments and unknown properties on new tools', async () => {
    const h=makeHost();
    await expect(h.handlers.cinegen_read({section:'secrets'})).rejects.toThrow(/Invalid arguments/);
    await expect(h.handlers.cinegen_navigate({tab:'terminal'})).rejects.toThrow(/Invalid arguments/);
    await expect(h.handlers.cinegen_export({action:'start',fps:27})).rejects.toThrow(/Invalid arguments/);
  });
});
