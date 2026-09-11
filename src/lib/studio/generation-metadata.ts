import type { Edge, Node } from '@xyflow/react';
import type { Asset } from '@/types/project';
import type { Element } from '@/types/elements';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';
import { canvasMedia, canvasPrompt } from './canvas-import';
import { resolveStudioRecipe } from './recipe';
import { elementImagesForVariation } from '@/lib/elements/variations';
import { displayUrl, previewUrl } from '../../../mcp/display-tools.mjs';

export interface GenerationReference {
  id: string; title: string; kind: string; url: string | null; previewUrl: string | null;
  thumbnailUrl?: string | null; assetId?: string; elementId?: string; imageId?: string; variationId?: string;
}
type ReferenceState = { assets: Asset[]; elements: Element[] };
type ReferenceSpace = { nodes: Node<WorkflowNodeData>[]; edges: Edge[] };
const text = (value: unknown) => typeof value === 'string' ? value : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function assetFor(state: ReferenceState, url: unknown) {
  return typeof url === 'string' && url ? state.assets.find(asset => asset.url === url || asset.sourceUrl === url || asset.fileRef === url) : undefined;
}
export function generationInputReferences(state: ReferenceState, config: Record<string, unknown>, model: ModelDefinition | undefined, space: ReferenceSpace, nodeId: string) {
  const references: GenerationReference[] = [];
  const add = (value: unknown, title: string, kind = 'image', id = title, elementId?: string) => {
    const asset = assetFor(state, value);
    const url = displayUrl(value) || displayUrl(asset?.sourceUrl) || displayUrl(asset?.url);
    if (!url && !asset) return;
    if (references.some(ref => url ? ref.url === url : ref.assetId === asset?.id)) return;
    const thumbnailUrl = previewUrl(asset?.thumbnailUrl);
    references.push({ id, title: asset?.name || title, kind: asset?.type || kind, assetId: asset?.id, url, previewUrl: thumbnailUrl || previewUrl(url), thumbnailUrl, elementId });
  };
  const visit = (value: unknown, title: string, kind: string) => {
    if (typeof value === 'string') add(value, title, kind);
    else if (Array.isArray(value)) value.forEach((entry, i) => visit(entry, `${title} ${i + 1}`, kind));
    else {
      const ref = record(value);
      const referenceKind = ['image', 'video', 'audio'].includes(text(ref.kind)) ? text(ref.kind) : kind;
      for (const key of ['url', 'urls', 'images', 'image_urls', 'media']) if (ref[key]) visit(ref[key], title, referenceKind);
      const variations = record(ref.elementVariationIds);
      for (const id of Array.isArray(ref.assetIds) ? ref.assetIds : []) {
        const asset = state.assets.find(asset => asset.id === id);
        if (asset) add(asset.url, asset.name, asset.type, asset.id);
      }
      for (const id of Array.isArray(ref.elementIds) ? ref.elementIds : []) {
        const element = state.elements.find(e => e.id === id);
        if (element) for (const image of elementImagesForVariation(element, text(variations[element.id]) || undefined)) add(image.url, element.name, 'image', image.id, element.id);
      }
    }
  };
  for (const field of model?.inputs ?? []) if (['image', 'video', 'audio', 'media'].includes(field.portType)) {
    const wired = space.edges.some(edge => edge.target === nodeId && (edge.targetHandle === field.id || edge.targetHandle?.startsWith(`${field.id}_`)));
    if (!wired) visit(config[field.id], field.label, field.portType === 'media' ? 'image' : field.portType);
  }
  for (const edge of space.edges.filter(edge => edge.target === nodeId)) {
    const field = model?.inputs.find(input => input.id === edge.targetHandle || edge.targetHandle?.startsWith(`${input.id}_`));
    if (field && !['image', 'video', 'audio', 'media'].includes(field.portType)) continue;
    const source = space.nodes.find(node => node.id === edge.source);
    if (source) {
      for (const media of canvasMedia(source, state.elements)) add(media.url, media.name, media.kind, media.id);
      const audioUrl = source.data.config.fileUrl || source.data.result?.url;
      if (source.data.config.fileType === 'audio' || assetFor(state, audioUrl)?.type === 'audio') add(audioUrl, source.data.label, 'audio', source.id);
    }
  }
  return references.slice(0, 24);
}
/** Store the recipe on the asset as well as its editable Canvas node. */
export function captureGenerationMetadata(node: Node<WorkflowNodeData>, model: ModelDefinition, space: ReferenceSpace, state: ReferenceState, outputUrl: string) {
  return {
    version: 1 as const, sourceNodeId: node.id, outputUrl,
    prompt: resolveStudioRecipe(node, model, space.nodes, space.edges, state.assets).prompt || canvasPrompt(node),
    model: model.name, provider: model.provider ?? 'fal',
    resolution: text(node.data.config.resolution), aspectRatio: text(node.data.config.aspect_ratio || node.data.config.aspectRatio),
    references: generationInputReferences(state, node.data.config, model, space, node.id),
  };
}

/** Metadata is caller-controlled; only return safe, explicit reference fields. */
export function savedGenerationReferences(value: unknown, assets: Asset[]): GenerationReference[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((raw, index) => {
    const ref = record(raw), asset = assets.find(asset => asset.id === ref.assetId);
    const kind = text(ref.kind) || asset?.type;
    if (!kind || !['image', 'video', 'audio'].includes(kind)) return [];
    const url = displayUrl(ref.url) || displayUrl(asset?.sourceUrl) || displayUrl(asset?.url);
    const thumbnailUrl = previewUrl(ref.thumbnailUrl || asset?.thumbnailUrl);
    return [{ id: text(ref.id) || asset?.id || `reference-${index + 1}`, title: text(ref.title) || asset?.name || `Reference ${index + 1}`,
      kind, assetId: asset?.id, url, previewUrl: previewUrl(ref.previewUrl) || previewUrl(url), thumbnailUrl,
      elementId: text(ref.elementId) || undefined, imageId: text(ref.imageId) || undefined, variationId: text(ref.variationId) || undefined }];
  });
}
