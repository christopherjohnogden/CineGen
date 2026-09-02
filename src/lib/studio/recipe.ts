import type { Edge, Node } from '@xyflow/react';
import { toFileUrl } from '@/lib/utils/file-url';
import type { Asset } from '@/types/project';
import type { ModelDefinition, ModelInputField, WorkflowNodeData } from '@/types/workflow';

/**
 * Everything a generation ran with, recovered from wherever it lives.
 *
 * A Studio-made node keeps `__studio*` mirrors of its recipe. A canvas-made node
 * has none of those — its prompt is on an upstream Prompt node, its Elements on
 * an Element node, its frames on filePicker nodes, all reachable only by edge.
 * Reading the mirrors alone meant "reuse" silently dropped the prompt, the
 * references, and the frames for every video built on the canvas.
 *
 * Precedence is the executor's own: a live edge wins, then the node's config,
 * then the mirror. So the recipe is what would actually run, not a snapshot.
 */
export interface StudioRecipe {
  prompt: string;
  elementIds: string[];
  /** Parallel to elementIds. Lets a re-created element be recovered by name when its id is gone. */
  elementNames: string[];
  elementVariationIds: Record<string, string>;
  startAssetId: string;
  endAssetId: string;
  videoMode: 'frames' | 'references';
  controls: Record<string, string | number | boolean>;
  presetId?: string;
}

const CONTROL_FIELD_TYPES = new Set<ModelInputField['fieldType']>(['select', 'number', 'range', 'toggle']);

// Copied from node-registry rather than imported: that module builds the whole
// node registry at import time by walking ALL_MODELS, and this file must stay a
// side-effect-free leaf so the composer (and its tests) can load it cheaply.
function elementIdsFrom(config: Record<string, unknown> | undefined): string[] {
  const raw = config?.elementIds;
  if (Array.isArray(raw)) {
    const ids = raw.filter((id): id is string => typeof id === 'string' && id !== '');
    if (ids.length > 0) return ids;
  }
  const legacy = config?.elementId;
  return typeof legacy === 'string' && legacy ? [legacy] : [];
}

function elementVariationIdsFrom(config: Record<string, unknown> | undefined): Record<string, string> {
  const raw = config?.elementVariationIds;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => (
      Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1])
    )),
  );
}

function isImageField(field: ModelInputField): boolean {
  if (field.fieldType !== 'port' && field.fieldType !== 'element-list') return false;
  if (field.portType === 'image') return true;
  if (field.portType !== 'media') return false;
  return field.mediaRole === 'image'
    || field.mediaRole === 'start_image'
    || field.mediaRole === 'end_image'
    || /image|frame|photo|reference/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function isStartField(field: ModelInputField): boolean {
  if (!isImageField(field)) return false;
  if (field.mediaRole === 'start_image') return true;
  return /(^|[_\s-])(start|first)([_\s-]|$)/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function isEndField(field: ModelInputField): boolean {
  if (!isImageField(field)) return false;
  if (field.mediaRole === 'end_image') return true;
  return /(^|[_\s-])(end|last)([_\s-]|$)/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function promptField(model: ModelDefinition): ModelInputField | undefined {
  const isPrompt = (field: ModelInputField) => field.fieldType === 'port'
    && field.portType === 'text'
    && /prompt|text/i.test(`${field.id} ${field.falParam} ${field.label}`);
  return model.inputs.find((field) => isPrompt(field) && field.id === 'prompt') ?? model.inputs.find(isPrompt);
}

function incomingSources(
  node: Node<WorkflowNodeData>,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  targetHandle?: (handle: string | null | undefined) => boolean,
): Node<WorkflowNodeData>[] {
  return edges
    .filter((edge) => edge.target === node.id && (!targetHandle || targetHandle(edge.targetHandle)))
    .flatMap((edge) => {
      const source = nodes.find((candidate) => candidate.id === edge.source);
      return source ? [source] : [];
    });
}

/** The asset whose file URL a node's config or an upstream filePicker points at. */
function assetForUrl(url: unknown, assets: Asset[]): string {
  if (typeof url !== 'string' || !url.trim()) return '';
  const wanted = url.trim();
  const match = assets.find((asset) => (
    toFileUrl(asset.fileRef || asset.url) === wanted
    || asset.url === wanted
    || asset.fileRef === wanted
  ));
  return match?.id ?? '';
}

export function resolveStudioRecipe(
  node: Node<WorkflowNodeData>,
  model: ModelDefinition,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  assets: Asset[],
): StudioRecipe {
  const config = node.data.config;

  // Prompt: wired Prompt node, then this node's own field, then the mirrors.
  // The authored body beats the composed prompt so a preset suffix is not
  // baked in and re-appended on the next run.
  let prompt = '';
  const field = promptField(model);
  if (field) {
    const wired = incomingSources(node, nodes, edges, (handle) => handle === field.id)
      .map((source) => source.data.config.prompt)
      .find((value): value is string => typeof value === 'string' && value.trim() !== '');
    if (wired) prompt = wired.trim();
    else if (typeof config[field.id] === 'string' && (config[field.id] as string).trim()) {
      prompt = (config[field.id] as string).trim();
    }
  }
  if (typeof config.__studioPromptBody === 'string' && config.__studioPromptBody.trim()) {
    prompt = config.__studioPromptBody.trim();
  } else if (!prompt && typeof config.__studioPrompt === 'string') {
    prompt = config.__studioPrompt.trim();
  }

  // Elements: mirror, then a config ElementRef on any reference field, then
  // every upstream Element node.
  let elementIds: string[] = [];
  let elementNames: string[] = [];
  let elementVariationIds: Record<string, string> = {};
  const mirrored = config.__studioElementIds;
  if (Array.isArray(mirrored) && mirrored.length) {
    elementIds = mirrored.filter((id): id is string => typeof id === 'string');
    const mirroredNames = config.__studioElementNames;
    if (Array.isArray(mirroredNames)) {
      elementNames = mirroredNames.filter((name): name is string => typeof name === 'string');
    }
    const mirroredVariations = config.__studioElementVariationIds;
    if (mirroredVariations && typeof mirroredVariations === 'object') {
      elementVariationIds = mirroredVariations as Record<string, string>;
    }
  } else {
    for (const input of model.inputs) {
      const value = config[input.id];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const ids = elementIdsFrom(value as Record<string, unknown>);
        if (ids.length) {
          elementIds = ids;
          elementVariationIds = elementVariationIdsFrom(value as Record<string, unknown>);
          break;
        }
      }
    }
    if (!elementIds.length) {
      for (const source of incomingSources(node, nodes, edges)) {
        if (source.data.type !== 'element') continue;
        elementIds.push(...elementIdsFrom(source.data.config));
        Object.assign(elementVariationIds, elementVariationIdsFrom(source.data.config));
      }
      elementIds = [...new Set(elementIds)];
    }
  }

  // Frames: mirror, then the field's own config URL, then an upstream filePicker.
  const frame = (pick: (field: ModelInputField) => boolean, mirrorKey: string): string => {
    const mirror = config[mirrorKey];
    if (typeof mirror === 'string' && mirror) return mirror;
    const target = model.inputs.find(pick);
    if (!target) return '';
    const own = assetForUrl(config[target.id], assets);
    if (own) return own;
    const upstream = incomingSources(node, nodes, edges, (handle) => handle === target.id)
      .find((source) => source.data.type === 'filePicker');
    return assetForUrl(upstream?.data.config.fileUrl, assets);
  };
  const startAssetId = frame(isStartField, '__studioStartAssetId');
  const endAssetId = frame(isEndField, '__studioEndAssetId');

  const storedMode = config.__studioVideoMode;
  const videoMode: StudioRecipe['videoMode'] = storedMode === 'frames' || storedMode === 'references'
    ? storedMode
    : elementIds.length ? 'references' : 'frames';

  const controls: StudioRecipe['controls'] = {};
  for (const input of model.inputs) {
    if (!CONTROL_FIELD_TYPES.has(input.fieldType)) continue;
    const value = config[input.id];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      controls[input.id] = value;
    }
  }

  return {
    prompt,
    elementIds,
    elementNames,
    elementVariationIds,
    startAssetId,
    endAssetId,
    videoMode,
    controls,
    ...(typeof config.__studioPresetId === 'string' ? { presetId: config.__studioPresetId } : {}),
  };
}
