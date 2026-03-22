import type { NodeTypeDefinition, PortDefinition } from '@/types/workflow';
import { ALL_MODELS } from '@/lib/fal/models';

const UTILITY_NODES: Record<string, NodeTypeDefinition> = {
  prompt: {
    type: 'prompt',
    label: 'Prompt',
    category: 'utility',
    inputs: [],
    outputs: [{ id: 'text', type: 'text', label: 'text' }],
    defaultData: { prompt: '' },
  },
  assetOutput: {
    type: 'assetOutput',
    label: 'Asset Output',
    category: 'utility',
    inputs: [
      { id: 'image', type: 'image', label: 'image' },
      { id: 'video', type: 'video', label: 'video' },
    ],
    outputs: [],
    defaultData: { name: 'Untitled' },
  },
  shotPrompt: {
    type: 'shotPrompt',
    label: 'Shot Prompt',
    category: 'utility',
    inputs: [],
    outputs: [{ id: 'multi_prompt', type: 'multi_prompt', label: 'multi_prompt' }],
    defaultData: { shots: [{ prompt: '', duration: 5 }] },
  },
  element: {
    type: 'element',
    label: 'Element',
    category: 'utility',
    inputs: [],
    outputs: [{ id: 'element', type: 'image', label: 'element' }],
    defaultData: { elementId: '' },
  },
  compositionPlan: {
    type: 'compositionPlan',
    label: 'Composition Plan',
    category: 'utility',
    inputs: [],
    outputs: [{ id: 'composition_plan', type: 'composition_plan', label: 'plan' }],
    defaultData: {
      positiveGlobalStyles: '',
      negativeGlobalStyles: '',
      sections: [{ name: 'intro', positiveStyles: '', negativeStyles: '', durationMs: 15000, lines: '' }],
    },
  },
  musicPrompt: {
    type: 'musicPrompt',
    label: 'Music Prompt',
    category: 'utility',
    inputs: [{ id: 'video', type: 'video', label: 'video' }],
    outputs: [{ id: 'text', type: 'text', label: 'prompt' }],
    defaultData: {
      style: '',
      genre: '',
      mood: '',
      tempo: '',
      additionalNotes: '',
      generatedPrompt: '',
    },
  },
  filePicker: {
    type: 'filePicker',
    label: 'File Upload',
    category: 'utility',
    inputs: [],
    outputs: [
      { id: 'media', type: 'media', label: 'output' },
    ],
    defaultData: { fileUrl: '', fileType: '' },
  },
  shotBoard: {
    type: 'shotBoard',
    label: 'Shot Ideas',
    category: 'utility',
    inputs: [
      { id: 'image', type: 'image', label: 'Image' },
      { id: 'text', type: 'text', label: 'Prompt' },
    ],
    outputs: [],
    defaultData: {
      selectedModel: 'nano-banana-2',
      shots: [
        { prompt: 'Establishing wide shot - full scene, character in context', url: null, status: 'idle' },
        { prompt: 'Full body shot, straight-on', url: null, status: 'idle' },
        { prompt: 'Full body shot, low angle looking up', url: null, status: 'idle' },
        { prompt: 'Medium shot waist-up, front', url: null, status: 'idle' },
        { prompt: 'Medium shot waist-up, side profile', url: null, status: 'idle' },
        { prompt: 'Medium shot waist-up, over-the-shoulder angle', url: null, status: 'idle' },
        { prompt: 'Close-up portrait, front', url: null, status: 'idle' },
        { prompt: 'Close-up portrait, 3/4 turn', url: null, status: 'idle' },
        { prompt: 'Extreme close-up, eyes and expression', url: null, status: 'idle' },
      ],
    },
  },
  storyboarder: {
    type: 'storyboarder',
    label: 'Storyboarder',
    category: 'utility',
    inputs: [
      { id: 'image', type: 'image', label: 'Image' },
      { id: 'text', type: 'text', label: 'Scene' },
    ],
    outputs: [],
    defaultData: {
      selectedModel: 'nano-banana-2',
      selectedLlm: 'google/gemini-2.5-flash',
      shotCount: 9,
      shots: [],
    },
  },
};

function buildModelNodeDefinitions(): Record<string, NodeTypeDefinition> {
  const defs: Record<string, NodeTypeDefinition> = {};

  for (const model of Object.values(ALL_MODELS)) {
    const inputs: PortDefinition[] = model.inputs
      .filter((f) => f.fieldType === 'port')
      .map((f) => ({ id: f.id, type: f.portType, label: f.label }));

    const outputs: PortDefinition[] = [
      { id: model.outputType, type: model.outputType, label: model.outputType },
    ];

    const defaultData: Record<string, unknown> = { __modelId: model.id };
    for (const field of model.inputs) {
      if (field.default !== undefined) {
        defaultData[field.id] = field.default;
      }
    }
    if (model.nodeType === 'layer-decompose-cloud') {
      defaultData.__layerDecomposeVersion = 2;
    }

    defs[model.nodeType] = {
      type: model.nodeType,
      label: model.name,
      category: model.category,
      inputs,
      outputs,
      defaultData,
      isModel: true,
    };
  }

  return defs;
}

export const NODE_REGISTRY: Record<string, NodeTypeDefinition> = {
  ...UTILITY_NODES,
  ...buildModelNodeDefinitions(),
};

export const CATEGORY_COLORS: Record<string, string> = {
  utility: 'var(--port-number)',
  text: 'var(--port-text)',
  image: 'var(--port-image)',
  video: 'var(--port-video)',
  'image-edit': 'var(--port-config)',
  audio: 'var(--port-audio)',
};

export const PORT_COLORS: Record<string, string> = {
  text: 'var(--port-text)',
  image: 'var(--port-image)',
  video: 'var(--port-video)',
  audio: 'var(--port-audio)',
  number: 'var(--port-number)',
  config: 'var(--port-config)',
  model: 'var(--port-model)',
  multi_prompt: 'var(--port-multi-prompt)',
  composition_plan: 'var(--port-audio)',
  media: 'var(--accent)',
};
