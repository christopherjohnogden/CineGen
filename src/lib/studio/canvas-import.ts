import type { Node } from '@xyflow/react';
import type { Element } from '@/types/elements';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';
import { getModelDefinition } from '@/lib/fal/models';
import { resolveElementNodeIds, resolveElementNodeVariationIds } from '@/lib/workflows/node-registry';
import { elementImagesForVariation } from '@/lib/elements/variations';
import { detectMediaTypeFromExt } from '@/lib/utils/media-file';
import { toFileUrl } from '@/lib/utils/file-url';
import { generateId } from '@/lib/utils/ids';
import { mediaSourceHash } from '@/lib/cloud/media-references';
import type { ComposerAttachment } from './draft';

type MediaKind = 'image' | 'video';
export interface CanvasMedia extends ComposerAttachment {
  kind: MediaKind;
  nodeId: string;
  key: string;
  prompt: string;
}
export interface StudioTransfer {
  id: string;
  spaceId: string | null;
  attachments: ComposerAttachment[];
  prompt?: string;
}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const mediaKind = (value: unknown): MediaKind | undefined => value === 'image' || value === 'video' ? value : undefined;
function inferMediaKind(value: unknown): MediaKind | undefined {
  const url = text(value);
  if (url.startsWith('data:image/')) return 'image';
  if (url.startsWith('data:video/')) return 'video';
  let path = url.split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { /* Keep malformed legacy paths readable. */ }
  return mediaKind(detectMediaTypeFromExt(path));
}

export function canvasPrompt(node: Node<WorkflowNodeData>): string {
  const config = node.data.config;
  if (node.data.type === 'prompt') return text(config.prompt);
  if ((node.data.type === 'multiPrompt' || node.data.type === 'shotPrompt') && Array.isArray(config.shots)) {
    return config.shots.map(shot => shot && typeof shot === 'object' ? text((shot as Record<string, unknown>).prompt) : '').filter(Boolean).join('\n\n');
  }
  return text(node.data.result?.text) || text(config.generatedPrompt) || text(config.prompt)
    || text(config.__studioPromptBody) || text(config.__studioPrompt);
}

/** Read actual outputs and uploaded files; never mistake a model's input image for its output. */
export function canvasMedia(node: Node<WorkflowNodeData>, elements: Element[] = []): CanvasMedia[] {
  const config = node.data.config;
  const model = getModelDefinition(node.data.type);
  const result: CanvasMedia[] = [];
  const add = (value: unknown, kind: MediaKind | undefined, key: string, name = node.data.label, prompt = canvasPrompt(node)) => {
    const url = toFileUrl(text(value));
    if (!url || !kind || result.some(item => item.url === url && item.kind === kind)) return;
    result.push({ id: `${node.id}:${key}:${mediaSourceHash(url)}`, nodeId: node.id, key, kind, url, name, prompt });
  };
  const outputKind = mediaKind(model?.outputType) || mediaKind(config.__studioOutputType);
  const urls = [...new Set([...(node.data.generations ?? []), node.data.result?.url].filter(Boolean))];
  const active = typeof node.data.activeGeneration === 'number' ? node.data.activeGeneration : urls.length - 1;
  const url = urls[Math.min(Math.max(active, 0), urls.length - 1)];
  add(url, outputKind || inferMediaKind(url), `output-${active}`);
  if (node.data.type === 'filePicker') {
    add(config.fileUrl, mediaKind(config.fileType) || inferMediaKind(config.fileName) || inferMediaKind(config.fileUrl), 'file', text(config.fileName) || node.data.label);
  }
  if (node.data.type === 'trim') add(config.trimmedUrl || config.sourceUrl, 'video', 'trim');
  if (node.data.type === 'element') {
    const variations = resolveElementNodeVariationIds(config);
    for (const id of resolveElementNodeIds(config)) {
      const element = elements.find(item => item.id === id);
      if (element) for (const image of elementImagesForVariation(element, variations[id])) add(image.url, 'image', image.id, element.name);
    }
  }
  for (const [index, layer] of (node.data.result?.layers ?? []).entries()) add(layer.url, 'image', `layer-${index}`, layer.name);
  if (node.data.type === 'storyboarder' || node.data.type === 'shotBoard') {
    for (const [index, raw] of (Array.isArray(config.shots) ? config.shots : []).entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const shot = raw as Record<string, unknown>;
      const name = `${node.data.label} · Shot ${index + 1}`;
      add(shot.url, 'image', `shot-${index}-image`, name, text(shot.prompt));
      add(shot.videoUrl, 'video', `shot-${index}-video`, name, text(shot.cameraPrompt) || text(shot.prompt));
    }
  }
  return result;
}

/** Uploaded media has no generation recipe, but uses the same viewer and reference actions. */
export function studioFeedModel(node: Node<WorkflowNodeData>): ModelDefinition | undefined {
  const model = getModelDefinition(node.data.type);
  if (model?.outputType === 'image' || model?.outputType === 'video') return model;
  if (!node.data.config.__studioMedia && (model || node.data.type === 'filePicker')) return undefined;
  const kind = mediaKind(node.data.config.__studioOutputType)
    || inferMediaKind(node.data.result?.url || node.data.generations?.at(-1));
  if (!kind) return undefined;
  return { id: `canvas-${kind}`, nodeType: node.data.type, name: text(node.data.config.fileName) || node.data.label,
    category: kind, outputType: kind, provider: 'local', inputs: [], description: 'Media sent from Canvas', responseMapping: { path: '' } };
}

export function isStudioMedia(node: Node<WorkflowNodeData>, model?: ModelDefinition): boolean {
  return Boolean(node.data.config.__studioMedia) || model?.id === 'canvas-image' || model?.id === 'canvas-video';
}

/** Keep a saved Studio copy when a Canvas file is replaced or a board is cleared. */
export function importCanvasMedia(nodes: Node<WorkflowNodeData>[], media: CanvasMedia[], now: string, restoreHidden = false): Node<WorkflowNodeData>[] {
  let retained = nodes;
  const additions: Node<WorkflowNodeData>[] = [];
  for (const item of media) {
    const source = nodes.find(node => node.id === item.nodeId);
    // Standard generation nodes already are Studio feed entries.
    if (source && studioFeedModel(source) && item.key.startsWith('output-')) {
      if (restoreHidden && !source.data.config.__studioGenerated) retained = retained.map(node => node.id === source.id
        ? { ...node, data: { ...node.data, config: { ...node.data.config, __studioGenerated: true,
          __studioCanvasPlaced: true, __studioCanvasOrigin: true, __studioCreatedAt: now, __studioOutputType: item.kind } } } : node);
      continue;
    }
    const existing = [...retained, ...additions].find(node => node.data.config.__studioSourceNodeId === item.nodeId
      && node.data.config.__studioSourceUrl === item.url && node.data.config.__studioOutputType === item.kind);
    if (existing) {
      if (restoreHidden && existing.data.config.__studioHiddenFromFeed) retained = retained.map(node => node.id === existing.id
        ? { ...node, data: { ...node.data, config: { ...node.data.config, __studioHiddenFromFeed: false } } } : node);
      continue;
    }
    additions.push({ id: generateId(), type: 'filePicker', position: { x: 80, y: 80 }, data: {
      type: 'filePicker', label: item.name, config: {
        fileUrl: item.url, fileType: item.kind, fileName: item.name,
        __studioGenerated: true, __studioMedia: true, __studioCreatedAt: now,
        __studioOutputType: item.kind, __studioPrompt: item.prompt,
        __studioSourceNodeId: item.nodeId, __studioSourceUrl: item.url,
      }, result: { url: item.url, status: 'complete' },
    } });
  }
  return additions.length ? [...retained, ...additions] : retained;
}

/** Boards and utility renderers store video outside normal model results. Archive it as soon as it arrives. */
export function syncCanvasVideosToStudio(nodes: Node<WorkflowNodeData>[], now: string): Node<WorkflowNodeData>[] {
  let changed = false;
  const retained = nodes.map(node => {
    if (node.data.config.__studioGenerated || studioFeedModel(node)?.outputType !== 'video'
      || !(node.data.result?.status === 'running' || node.data.result?.url || node.data.generations?.length)) return node;
    changed = true;
    return { ...node, data: { ...node.data, config: { ...node.data.config,
      __studioGenerated: true, __studioCanvasPlaced: true, __studioCanvasOrigin: true, __studioOutputType: 'video',
      __studioCreatedAt: node.data.config.__studioCreatedAt || (Number.isFinite(node.data.result?.progressStartedAt) ? new Date(node.data.result!.progressStartedAt!).toISOString() : now),
    } } };
  });
  const media = retained.filter(node => !node.data.config.__studioMedia && node.data.type !== 'filePicker')
    .flatMap(node => canvasMedia(node).filter(item => item.kind === 'video'));
  return importCanvasMedia(changed ? retained : nodes, media, now);
}
