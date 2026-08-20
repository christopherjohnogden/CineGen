import catalogJson from './model-catalog.generated.json';
import type { ModelDefinition, ModelInputField, PortType } from '@/types/workflow';

export type HiggsfieldSchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'null';
export type HiggsfieldCatalogOutputType = 'image' | 'video' | 'audio' | 'text' | '3d';

export interface HiggsfieldParamSchema {
  name: string;
  type: HiggsfieldSchemaType;
  default: unknown;
  required: boolean;
  enum?: string[];
}

export interface HiggsfieldModelSchema {
  display_name: string;
  job_set_type: string;
  type: HiggsfieldCatalogOutputType;
  params: HiggsfieldParamSchema[];
}

interface HiggsfieldCatalogFile {
  schemaVersion: number;
  cli: { version: string; commit: string; builtAt: string | null };
  models: HiggsfieldModelSchema[];
}

export const HIGGSFIELD_CATALOG = catalogJson as HiggsfieldCatalogFile;
export const HIGGSFIELD_MODEL_SCHEMAS = HIGGSFIELD_CATALOG.models;

const LEGACY_NODE_TYPES: Record<string, string> = {
  text2image_soul_v2: 'hf-soul-v2',
  nano_banana_2: 'hf-nano-banana-pro',
  gpt_image_2: 'hf-gpt-image-2',
  seedance_2_0: 'hf-seedance-2',
  kling3_0: 'hf-kling-3',
  veo3_1: 'hf-veo-3-1',
};

const SINGLE_IMAGE_PARAMS = new Set([
  'input_image',
  'ref_image',
  'sketch',
  'texture_image_url',
]);

const MULTI_IMAGE_PARAMS = new Set(['input_images']);
const SINGLE_VIDEO_PARAMS = new Set(['input_video', 'video']);
const SINGLE_AUDIO_PARAMS = new Set(['input_audio']);

function humanize(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function nodeTypeFor(modelId: string): string {
  return LEGACY_NODE_TYPES[modelId] ?? `hf-${modelId.replaceAll('_', '-')}`;
}

function outputTypeFor(type: HiggsfieldCatalogOutputType): ModelDefinition['outputType'] {
  return type === '3d' ? 'model3d' : type;
}

function mediaFieldFor(
  model: HiggsfieldModelSchema,
  param: HiggsfieldParamSchema,
): ModelInputField | undefined {
  let portType: PortType | undefined;
  let mediaRole: ModelInputField['mediaRole'];
  let multiple = false;

  if (SINGLE_IMAGE_PARAMS.has(param.name)) {
    portType = 'image';
    mediaRole = model.type === 'video' && param.name === 'input_image' ? 'start_image' : 'image';
  } else if (MULTI_IMAGE_PARAMS.has(param.name)) {
    portType = 'image';
    mediaRole = 'image';
    multiple = true;
  } else if (SINGLE_VIDEO_PARAMS.has(param.name)) {
    portType = 'video';
    mediaRole = 'video';
  } else if (SINGLE_AUDIO_PARAMS.has(param.name)) {
    portType = 'audio';
    mediaRole = 'audio';
  } else if (param.name === 'model_url') {
    portType = 'model3d';
  } else if (param.name === 'urls') {
    portType = 'media';
    multiple = true;
  } else if (param.name === 'medias') {
    multiple = true;
    if (model.type === 'image' || model.type === '3d') {
      portType = 'image';
      mediaRole = 'image';
    } else if (model.type === 'text') {
      portType = 'video';
      mediaRole = 'video';
    } else {
      portType = 'media';
    }
  }

  if (!portType) return undefined;
  return {
    id: param.name,
    portType,
    label: humanize(param.name),
    required: param.required,
    falParam: param.name,
    fieldType: 'port',
    schemaType: param.type,
    multiple,
    mediaRole,
    ...(param.default !== undefined ? { default: param.default } : {}),
  };
}

function inputFieldFor(model: HiggsfieldModelSchema, param: HiggsfieldParamSchema): ModelInputField {
  const mediaField = mediaFieldFor(model, param);
  if (mediaField) return mediaField;

  const base = {
    id: param.name,
    portType: 'config' as PortType,
    label: humanize(param.name),
    required: param.required,
    falParam: param.name,
    schemaType: param.type,
    ...(param.default !== undefined ? { default: param.default } : {}),
  };

  if (param.type === 'string') {
    if (param.enum?.length) {
      return {
        ...base,
        portType: 'text',
        fieldType: 'select',
        options: param.enum.map((value) => ({ value, label: value })),
      };
    }
    if (/(^|_)prompt$/.test(param.name) || param.name === 'instruction') {
      return { ...base, portType: 'text', fieldType: 'port' };
    }
    return { ...base, portType: 'text', fieldType: 'text' };
  }
  if (param.type === 'integer' || param.type === 'number') {
    return { ...base, portType: 'number', fieldType: 'number' };
  }
  if (param.type === 'boolean') {
    return { ...base, fieldType: 'toggle' };
  }
  return {
    ...base,
    fieldType: 'json',
    placeholder: param.type === 'array' ? '[]' : param.type === 'object' ? '{}' : 'null',
  };
}

function compatibilityMediaFieldsFor(
  model: HiggsfieldModelSchema,
  param: HiggsfieldParamSchema,
): ModelInputField[] {
  const make = (
    id: string,
    label: string,
    portType: PortType,
    mediaRole: NonNullable<ModelInputField['mediaRole']>,
    multiple = false,
  ): ModelInputField => ({
    id,
    portType,
    label,
    required: false,
    falParam: param.name,
    fieldType: 'port',
    schemaType: param.type,
    mediaRole,
    multiple,
  });

  if (model.job_set_type === 'text2image_soul_v2' && param.name === 'medias') {
    return [make('image_url', 'Reference Image', 'image', 'image')];
  }
  if (model.job_set_type === 'nano_banana_2' && param.name === 'input_images') {
    return [make('image_url', 'Reference Images', 'image', 'image', true)];
  }
  if (model.job_set_type === 'gpt_image_2' && param.name === 'medias') {
    return [make('image_url', 'Reference Images', 'image', 'image', true)];
  }
  if (model.job_set_type === 'seedance_2_0' && param.name === 'medias') {
    return [
      make('start_image_url', 'First Frame', 'image', 'start_image'),
      make('end_image_url', 'Last Frame', 'image', 'end_image'),
      make('image_references', 'Image References', 'image', 'image', true),
      make('video_references', 'Video References', 'video', 'video', true),
      make('audio_references', 'Audio References', 'audio', 'audio', true),
    ];
  }
  if (model.job_set_type === 'kling3_0' && param.name === 'medias') {
    return [
      make('start_image_url', 'First Frame', 'image', 'start_image'),
      make('end_image_url', 'Last Frame', 'image', 'end_image'),
    ];
  }
  if (model.job_set_type === 'veo3_1' && param.name === 'input_image') {
    return [make('start_image_url', 'First Frame', 'image', 'start_image')];
  }
  return [];
}

/** Catalog params are alphabetized; surface the main prompt as the first input/port. */
const PROMPT_FIELD_PRIORITY = ['prompt', 'user_prompt', 'instruction'];

function promotePromptFirst(inputs: ModelInputField[]): ModelInputField[] {
  for (const id of PROMPT_FIELD_PRIORITY) {
    const index = inputs.findIndex((field) => field.id === id);
    if (index > 0) return [inputs[index], ...inputs.slice(0, index), ...inputs.slice(index + 1)];
    if (index === 0) return inputs;
  }
  return inputs;
}

export function buildHiggsfieldModelRegistry(
  schemas: readonly HiggsfieldModelSchema[] = HIGGSFIELD_MODEL_SCHEMAS,
): Record<string, ModelDefinition> {
  const registry: Record<string, ModelDefinition> = {};
  for (const model of schemas) {
    const nodeType = nodeTypeFor(model.job_set_type);
    const outputType = outputTypeFor(model.type);
    if (registry[nodeType]) throw new Error(`Duplicate Higgsfield node type: ${nodeType}`);
    registry[nodeType] = {
      id: model.job_set_type,
      nodeType,
      name: model.display_name,
      category: outputType,
      description: `Higgsfield ${model.type.toUpperCase()} model`,
      inputs: promotePromptFirst(model.params.flatMap((param) => [
        inputFieldFor(model, param),
        ...compatibilityMediaFieldsFor(model, param),
      ])),
      outputType,
      outputs: [{ id: outputType, portType: outputType, label: outputType === 'model3d' ? '3D Model' : humanize(outputType) }],
      provider: 'higgsfield',
      responseMapping: { path: outputType === 'text' ? 'text' : 'output.url' },
    };
  }
  return registry;
}

export const HIGGSFIELD_MODEL_REGISTRY = buildHiggsfieldModelRegistry();

export function getHiggsfieldSchema(modelId: string): HiggsfieldModelSchema | undefined {
  return HIGGSFIELD_MODEL_SCHEMAS.find((model) => model.job_set_type === modelId);
}

/** Drop CLI flags the live model schema does not list. Unknown models pass through unchanged. */
export function pickKnownHiggsfieldParams(
  modelId: string,
  params: Record<string, unknown> | undefined,
  schemas: readonly HiggsfieldModelSchema[] = HIGGSFIELD_MODEL_SCHEMAS,
): Record<string, unknown> | undefined {
  if (!params) return params;
  const schema = schemas.find((model) => model.job_set_type === modelId);
  if (!schema) return params;
  const known = new Set(schema.params.map((param) => param.name));
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (known.has(key)) next[key] = value;
  }
  return next;
}
