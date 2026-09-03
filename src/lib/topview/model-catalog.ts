import type { ModelDefinition, ModelInputField } from '@/types/workflow';

export type TopviewCatalogOutput = 'image' | 'video' | 'audio';

export interface TopviewGenerationCatalogConfig {
  outputType: TopviewCatalogOutput;
  taskType: string;
  catalogType?: string;
  config: unknown;
}

export interface TopviewGenerationCatalog {
  configs: TopviewGenerationCatalogConfig[];
  tools?: string[];
  toolSchemas?: Record<string, unknown>;
  fetchedAt?: string;
}

type CatalogModel = {
  displayName: string;
  submitModel?: string;
  outputType: TopviewCatalogOutput;
  catalogType?: string;
  taskTypes: Set<string>;
  options: Map<string, unknown[]>;
  defaults: Record<string, unknown>;
  /** Fields the live catalog says this model accepts, however it advertises them. */
  accepts: Set<string>;
  /** True when Topview described this model. Offline fallbacks keep the generic controls. */
  live?: boolean;
  nativeAudio?: boolean;
};

const FALLBACK_IMAGE_MODELS = [
  'GPT Image 2',
  'Nano Banana 2',
  'Nano Banana 2 Lite',
  'Nano Banana Pro',
  'Nano Banana',
  'Seedream 5.0 Pro',
  'Seedream 5.0 Lite',
  'Seedream 4.5',
  'Seedream 4.0',
  'Kling V3 Omni',
  'Grok Image Quality',
  'Grok Image',
  'Reve Image Remix',
  'Kontext-Pro',
  'Imagen 4',
] as const;

const FALLBACK_VIDEO_MODELS = [
  'Seedance 2.5',
  'Standard',
  'Fast',
  'Seedance 2.0 Mini',
  'Seedance 1.5 Pro',
  'Seedance 1.0 Pro Fast',
  'Seedance 1.0 Pro',
  'Kling O3',
  'Kling V3',
  'Kling O3 Reference-to-Video',
  'Kling 2.6',
  'Kling 2.5 Turbo Pro',
  'Kling 2.5 Turbo Std',
  'Veo 3.1',
  'Veo 3.1 Fast',
  'Vidu Q3 Pro',
  'Vidu Q2 Reference to Video',
  'Wan 2.6',
  'Gemini Omni Flash',
  'Happy Horse 1.1',
  'MiniMax-Hailuo-2.3',
  'MiniMax-Hailuo-2.3-Fast',
  'Topview Pro',
  'Topview Plus',
  'Topview Best',
] as const;

const FALLBACK_AUDIO_MODELS = [
  { displayName: 'Topview Music', catalogType: 'music' },
  { displayName: 'Minimax Music 2.6', catalogType: 'music' },
  { displayName: 'Qwen3 TTS', catalogType: 'voice' },
  { displayName: 'Seed Audio 1.0', catalogType: 'audio' },
] as const;

const DEFAULT_IMAGE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const DEFAULT_IMAGE_RESOLUTIONS = ['1K', '2K', '4K'];
const DEFAULT_VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const DEFAULT_VIDEO_RESOLUTIONS = ['720', '1080'];
const DEFAULT_VIDEO_DURATIONS = Array.from({ length: 27 }, (_, index) => String(index + 4));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectRecords(value: unknown, output: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRecords(entry, output));
  } else if (isRecord(value)) {
    output.push(value);
    Object.values(value).forEach((entry) => collectRecords(entry, output));
  }
  return output;
}

function modelRecords(value: unknown): Array<Record<string, unknown>> {
  for (const record of collectRecords(value)) {
    if (Array.isArray(record.models)) return record.models.filter(isRecord);
  }
  return [];
}

function optionValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.value ?? value.id ?? value.name ?? value.label;
}

function optionValues(model: Record<string, unknown>, field: string): unknown[] {
  const options = model.submitParameterOptions;
  const entry = isRecord(options)
    ? options[field]
    : Array.isArray(options)
      ? options.find((candidate) => isRecord(candidate) && (
          candidate.name === field || candidate.key === field || candidate.field === field
        ))
      : undefined;
  const raw = Array.isArray(entry)
    ? entry
    : isRecord(entry)
      ? ['values', 'options', 'enum', 'allowedValues']
          .map((key) => entry[key])
          .find(Array.isArray) ?? []
      : [];
  return raw.map(optionValue).filter((entry) => entry !== undefined && entry !== null);
}

function uniqueValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeCatalog(catalog?: TopviewGenerationCatalog | null): CatalogModel[] {
  const merged = new Map<string, CatalogModel>();
  for (const entry of catalog?.configs ?? []) {
    if (entry.outputType !== 'image' && entry.outputType !== 'video' && entry.outputType !== 'audio') continue;
    for (const model of modelRecords(entry.config)) {
      const displayName = String(
        model.displayName ?? model.name ?? model.submitModel ?? model.backendModelCode ?? '',
      ).trim();
      if (!displayName) continue;
      const key = `${entry.outputType}:${displayName.toLowerCase()}`;
      const existing = merged.get(key) ?? {
        displayName,
        submitModel: typeof model.submitModel === 'string' ? model.submitModel : undefined,
        outputType: entry.outputType,
        catalogType: entry.catalogType ?? entry.taskType,
        taskTypes: new Set<string>(),
        options: new Map<string, unknown[]>(),
        defaults: {},
        accepts: new Set<string>(),
        live: true,
      };
      existing.catalogType ??= entry.catalogType ?? entry.taskType;
      existing.taskTypes.add(entry.taskType);
      if (typeof model.submitModel === 'string') existing.submitModel = model.submitModel;
      if (isRecord(model.defaultSubmitParameters)) {
        existing.defaults = { ...existing.defaults, ...model.defaultSubmitParameters };
      }
      if (model.nativeAudio === true || model.supportsNativeAudio === true) existing.nativeAudio = true;
      if (model.nativeAudio === false || model.supportsNativeAudio === false) existing.nativeAudio ??= false;
      for (const field of requiredFields(model)) existing.accepts.add(field);
      for (const field of Object.keys(isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {})) {
        existing.accepts.add(field);
      }
      for (const field of ['aspectRatio', 'resolution', 'duration', 'quality', 'sound']) {
        const values = optionValues(model, field);
        if (!values.length) continue;
        existing.accepts.add(field);
        existing.options.set(field, uniqueValues([...(existing.options.get(field) ?? []), ...values]));
      }
      merged.set(key, existing);
    }
  }
  return [...merged.values()];
}

export function topviewModelSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function isSeedance2ModelName(value: unknown): boolean {
  return typeof value === 'string' && topviewModelSlug(value).includes('seedance-2');
}

function selectOptions(values: unknown[], fallback: string[]): Array<{ value: string; label: string }> {
  const resolved = values.length ? values : fallback;
  return uniqueValues(resolved).map((value) => ({ value: String(value), label: String(value) }));
}

function requiredFields(model: Record<string, unknown>): string[] {
  const required = model.requiredSubmitFields;
  if (isRecord(required)) {
    return Object.entries(required).filter(([, value]) => value !== false).map(([field]) => field);
  }
  if (!Array.isArray(required)) return [];
  return required.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (!isRecord(entry)) return [];
    const name = entry.name ?? entry.key ?? entry.field;
    return typeof name === 'string' ? [name] : [];
  });
}

/**
 * Topview rejects — and in some flows silently drops — any submit field the chosen
 * model does not advertise. A live catalog entry that never mentions `duration`
 * genuinely has no duration, so the control must disappear rather than fall back to
 * a generic list the submit will refuse. Offline fallbacks keep the generic list.
 */
function fieldOptions(
  model: CatalogModel,
  field: string,
  fallback: string[],
): Array<{ value: string; label: string }> {
  const values = model.options.get(field) ?? [];
  if (values.length) return selectOptions(values, []);
  if (model.live && !model.accepts.has(field)) return [];
  return selectOptions([], fallback);
}

function preferredDefault(values: Array<{ value: string }>, preferred: string, fallback?: unknown): string {
  const fromConfig = fallback === undefined ? '' : String(fallback);
  if (fromConfig && values.some((entry) => entry.value === fromConfig)) return fromConfig;
  if (values.some((entry) => entry.value === preferred)) return preferred;
  return values[0]?.value ?? preferred;
}

function imageDefinition(model: CatalogModel): ModelDefinition {
  const ratios = fieldOptions(model, 'aspectRatio', DEFAULT_IMAGE_RATIOS);
  const resolutions = fieldOptions(model, 'resolution', DEFAULT_IMAGE_RESOLUTIONS);
  const quality = fieldOptions(model, 'quality', []);
  const supportsText = model.taskTypes.size === 0 || model.taskTypes.has('text_to_image');
  const supportsEdit = model.taskTypes.size === 0 || model.taskTypes.has('image_edit');
  const inputs: ModelInputField[] = [
    { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
  ];
  if (supportsEdit) {
    inputs.push(
      { id: 'image_url', portType: 'image', label: 'Media', required: false, falParam: 'image_url', fieldType: 'port', multiple: true, mediaRole: 'image' },
      { id: 'extra_images', portType: 'image', label: 'Reference', required: false, falParam: 'image_urls', fieldType: 'element-list', max: 15 },
    );
  }
  if (ratios.length) inputs.push({
    id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false,
    falParam: 'aspect_ratio', fieldType: 'select',
    default: preferredDefault(ratios, '16:9', model.defaults.aspectRatio), options: ratios,
  });
  if (resolutions.length) inputs.push({
    id: 'resolution', portType: 'text', label: 'Resolution', required: false,
    falParam: 'resolution', fieldType: 'select',
    default: preferredDefault(resolutions, '2K', model.defaults.resolution), options: resolutions,
  });
  if (quality.length) inputs.push({
    id: 'quality', portType: 'text', label: 'Quality', required: false,
    falParam: 'quality', fieldType: 'select',
    default: preferredDefault(quality, 'medium', model.defaults.quality), options: quality,
  });
  return {
    id: `topview/image/${model.submitModel ?? model.displayName}`,
    nodeType: `topview-image-${topviewModelSlug(model.displayName)}`,
    name: model.displayName,
    category: supportsText ? 'image' : 'image-edit',
    description: supportsText && supportsEdit
      ? 'Topview image generation and editing'
      : supportsEdit ? 'Topview image editing' : 'Topview text-to-image generation',
    outputType: 'image',
    provider: 'topview',
    responseMapping: { path: 'url' },
    inputs,
  };
}

function videoDefinition(model: CatalogModel): ModelDefinition {
  const ratios = fieldOptions(model, 'aspectRatio', DEFAULT_VIDEO_RATIOS);
  const resolutions = fieldOptions(model, 'resolution', DEFAULT_VIDEO_RESOLUTIONS);
  const durations = fieldOptions(model, 'duration', DEFAULT_VIDEO_DURATIONS);
  const soundValues = model.options.get('sound') ?? [];
  const supportsAudio = model.nativeAudio === true || soundValues.some((value) => String(value).toLowerCase() === 'on');
  const supportsOmniReference = model.taskTypes.size === 0 || model.taskTypes.has('omni_reference');
  const supportsImageToVideo = model.taskTypes.size === 0 || model.taskTypes.has('image_to_video');
  const taskLabels = [...model.taskTypes].map((task) => task.replaceAll('_', ' ')).join(' · ');
  const inputs: ModelInputField[] = [
    { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
  ];
  if (supportsOmniReference) {
    inputs.push(
      // Keep the historical handle ID so existing Spaces connections migrate in place.
      // Its payload is now explicitly reference media instead of a stack of start frames.
      // Omni-reference accepts stills, clips and audio: the submit builder sorts
      // them into inputImages / inputVideos / inputAudios by role. A 'media' port
      // is what lets a video output connect on the canvas without a false warning.
      { id: 'image_url', portType: 'media', label: 'References', required: false, falParam: 'reference_images', fieldType: 'port', multiple: true, mediaRole: 'image' },
      { id: 'extra_images', portType: 'media', label: 'More References', required: false, falParam: 'image_urls', fieldType: 'element-list', max: 30, mediaRole: 'image' },
    );
  } else if (supportsImageToVideo) {
    // Models without omni-reference retain the legacy image_url handle as their start frame.
    inputs.push({ id: 'image_url', portType: 'image', label: 'Start Frame', required: false, falParam: 'image_url', fieldType: 'port', mediaRole: 'start_image' });
  }
  if (supportsImageToVideo && supportsOmniReference) {
    inputs.push(
      { id: 'start_frame', portType: 'image', label: 'Start Frame', required: false, falParam: 'image_url', fieldType: 'port', mediaRole: 'start_image' },
      { id: 'end_frame', portType: 'image', label: 'End Frame', required: false, falParam: 'end_frame_url', fieldType: 'port', mediaRole: 'end_image' },
    );
  }
  if (durations.length) inputs.push({
    id: 'duration', portType: 'number', label: 'Duration', required: false,
    falParam: 'duration', fieldType: 'select',
    default: Number(preferredDefault(durations, '5', model.defaults.duration)), options: durations,
  });
  if (ratios.length) inputs.push({
    id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false,
    falParam: 'aspect_ratio', fieldType: 'select',
    default: preferredDefault(ratios, '16:9', model.defaults.aspectRatio), options: ratios,
  });
  if (resolutions.length) inputs.push({
    id: 'resolution', portType: 'text', label: 'Resolution', required: false,
    falParam: 'resolution', fieldType: 'select',
    default: preferredDefault(resolutions, '720', model.defaults.resolution), options: resolutions,
  });
  if (supportsAudio) inputs.push({
    id: 'generate_audio', portType: 'number', label: 'Generate Audio', required: false,
    falParam: 'generate_audio', fieldType: 'toggle',
    default: String(model.defaults.sound ?? 'on').toLowerCase() !== 'off',
  });
  return {
    id: `topview/video/${model.submitModel ?? model.displayName}`,
    nodeType: `topview-video-${topviewModelSlug(model.displayName)}`,
    name: model.displayName,
    category: 'video',
    description: `Topview video generation${supportsAudio ? ' with native audio' : ''}${taskLabels ? ` · ${taskLabels}` : ''}`,
    outputType: 'video',
    provider: 'topview',
    responseMapping: { path: 'url' },
    inputs,
  };
}

function audioDefinition(model: CatalogModel): ModelDefinition {
  const kind = model.catalogType === 'music' ? 'music' : model.catalogType === 'voice' ? 'voice' : 'audio';
  const inputs: ModelInputField[] = [
    {
      id: 'prompt', portType: 'text', label: kind === 'music' ? 'Lyrics / Prompt' : 'Text', required: true,
      falParam: 'prompt', fieldType: 'port',
    },
  ];
  if (kind === 'music') {
    inputs.push(
      { id: 'styles', portType: 'text', label: 'Music Style', required: false, falParam: 'styles', fieldType: 'textarea', default: '' },
      { id: 'instrumental', portType: 'number', label: 'Instrumental', required: false, falParam: 'instrumental', fieldType: 'toggle', default: false },
      { id: 'reference_audio', portType: 'audio', label: 'Reference Audio', required: false, falParam: 'reference_audio', fieldType: 'port', mediaRole: 'audio' },
    );
  } else if (kind === 'voice') {
    inputs.push(
      { id: 'voice_id', portType: 'text', label: 'Topview Voice ID', required: true, falParam: 'voice_id', fieldType: 'text', default: '', placeholder: 'Choose a voice ID from Topview' },
      { id: 'voice_speed', portType: 'number', label: 'Voice Speed', required: false, falParam: 'voice_speed', fieldType: 'range', default: 1, min: 0.8, max: 1.2, step: 0.05 },
      { id: 'emotion', portType: 'text', label: 'Emotion', required: false, falParam: 'emotion', fieldType: 'select', default: 'neutral', options: ['neutral', 'happy', 'surprised', 'angry', 'sad', 'fearful', 'disgusted'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) },
    );
  } else {
    inputs.push(
      { id: 'reference_audio', portType: 'audio', label: 'Reference Audio', required: true, falParam: 'reference_audio', fieldType: 'port', mediaRole: 'audio' },
      { id: 'emotion_text', portType: 'text', label: 'Emotion Direction', required: false, falParam: 'emotion_text', fieldType: 'text', default: '' },
    );
  }
  return {
    id: `topview/audio/${model.submitModel ?? model.displayName}`,
    nodeType: `topview-audio-${topviewModelSlug(model.displayName)}`,
    name: model.displayName,
    category: 'audio',
    description: kind === 'music'
      ? 'Topview AI music generation'
      : kind === 'voice' ? 'Topview text-to-speech' : 'Topview reference-guided audio generation',
    outputType: 'audio',
    provider: 'topview',
    responseMapping: { path: 'url' },
    inputs,
  };
}

function fallbackModels(): CatalogModel[] {
  return [
    ...FALLBACK_IMAGE_MODELS.map((displayName) => ({
      displayName,
      outputType: 'image' as const,
      taskTypes: new Set(['text_to_image', 'image_edit']),
      options: new Map<string, unknown[]>(),
      defaults: {},
      accepts: new Set<string>(),
    })),
    ...FALLBACK_VIDEO_MODELS.map((displayName) => ({
      displayName,
      outputType: 'video' as const,
      taskTypes: new Set(['text_to_video', 'image_to_video', 'omni_reference']),
      options: new Map<string, unknown[]>(),
      defaults: {},
      accepts: new Set<string>(),
      nativeAudio: ['Seedance 2.5', 'Standard', 'Fast', 'Kling O3', 'Kling V3', 'Veo 3.1', 'Veo 3.1 Fast', 'Vidu Q3 Pro', 'Wan 2.6', 'Happy Horse 1.1'].includes(displayName),
    })),
    ...FALLBACK_AUDIO_MODELS.map(({ displayName, catalogType }) => ({
      displayName,
      outputType: 'audio' as const,
      catalogType,
      taskTypes: new Set([catalogType]),
      options: new Map<string, unknown[]>(),
      defaults: {},
      accepts: new Set<string>(),
    })),
  ];
}

export function buildTopviewModelRegistry(catalog?: TopviewGenerationCatalog | null): Record<string, ModelDefinition> {
  const live = mergeCatalog(catalog);
  const source = live.length ? live : fallbackModels();
  return Object.fromEntries(source.map((model) => {
    const definition = model.outputType === 'image'
      ? imageDefinition(model)
      : model.outputType === 'video' ? videoDefinition(model) : audioDefinition(model);
    return [definition.nodeType, definition];
  }));
}

export function topviewRequestedModel(model: ModelDefinition, configured?: unknown): string {
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const prefix = `topview/${model.outputType}/`;
  return model.id.startsWith(prefix) ? model.id.slice(prefix.length) : 'auto';
}
