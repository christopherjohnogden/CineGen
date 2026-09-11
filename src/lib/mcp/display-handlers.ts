import { z } from 'zod';
import { DISPLAY_TOOLS, DISPLAY_ACTION_TOOLS, displayUrl, previewUrl } from '../../../mcp/display-tools.mjs';
import { FILM_PRESETS } from '../../../mcp/film-presets.mjs';
import { canvasMedia, canvasPrompt, studioFeedModel } from '@/lib/studio/canvas-import';
import { materializeElementLooks, elementImagesForVariation } from '@/lib/elements/variations';
import { generateId } from '@/lib/utils/ids';
import type { Asset } from '@/types/project';
import type { McpHost, McpHostState, McpToolHandler } from './types';
import { McpToolError } from './types';

export interface DisplayItem {
  id: string; title: string; kind: 'image' | 'video' | 'audio' | 'preset'; status: string;
  url: string | null; previewUrl: string | null; prompt: string;
  thumbnailUrl?: string | null; posterUrl?: string | null;
  nodeId?: string; assetId?: string; elementId?: string; variationId?: string; imageId?: string;
  requestId?: string; spaceId?: string; spaceName?: string; folderId?: string; folderName?: string;
  model?: string; provider?: string; createdAt?: string; startedAt?: number; error?: string; unavailableReason?: string;
  width?: number; height?: number; duration?: number; resolution?: string; aspectRatio?: string;
  references?: { id: string; title: string; url: string | null; previewUrl: string | null; thumbnailUrl?: string | null; kind: string; elementId?: string; imageId?: string; variationId?: string }[];
  galleryImages?: DisplayItem[];
  elementCard?: boolean; elementType?: string; referenceCount?: number; variationName?: string;
  generationIndex?: number; batchIndex?: number; source?: string;
  presetId?: string; category?: string; subtitle?: string; diagram?: string; lens?: string;
}
export interface DisplayPage {
  title: string; mode: 'generations' | 'elements' | 'job' | 'media' | 'batch' | 'presets'; items: DisplayItem[];
  total: number; offset: number; limit: number; hasMore: boolean; allFound?: boolean;
  refresh: { name: string; arguments: Record<string, unknown> }; projectId?: string; projectUrl?: string;
  spaces?: { id: string; name: string }[]; folders?: { id: string; name: string }[]; activeSpaceId?: string;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function mediaFields(value: unknown, thumbnail?: unknown) {
  const url = displayUrl(value), thumb = previewUrl(thumbnail);
  return { url, previewUrl: previewUrl(url), thumbnailUrl: thumb,
    ...(!url && value ? { unavailableReason: 'This media is only available in CineGen. Sync or relink it to view it in chat.' } : {}) };
}
function dimensions(asset?: Asset, config: Record<string, unknown> = {}) {
  const width = positive(asset?.width ?? config.width), height = positive(asset?.height ?? config.height);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = width && height ? gcd(Math.round(width), Math.round(height)) : 1;
  return { width, height, duration: positive(asset?.duration ?? Number(config.duration ?? config.durationSec)),
    resolution: text(config.resolution), aspectRatio: text(config.aspect_ratio || config.aspectRatio) || (width && height ? `${Math.round(width) / divisor}:${Math.round(height) / divisor}` : undefined) };
}
function spacesFor(state: McpHostState) {
  return state.spaces.length ? state.spaces.map(space => space.id === state.activeSpaceId ? { ...space, nodes: state.nodes, edges: state.edges } : space)
    : [{ id: state.activeSpaceId, name: 'Space', nodes: state.nodes, edges: state.edges }];
}
function page(title: string, mode: DisplayPage['mode'], items: DisplayItem[], name: string, args: Record<string, unknown>, state: McpHostState): DisplayPage {
  const limit = mode === 'job' ? 1 : Number(args.limit ?? 9), offset = mode === 'job' ? 0 : Number(args.offset ?? 0);
  return { title, mode, items: items.slice(offset, offset + limit), total: items.length, offset, limit,
    hasMore: offset + limit < items.length, refresh: { name, arguments: args },
    spaces: spacesFor(state).filter(s => s.id).map(({ id, name }) => ({ id, name })), activeSpaceId: state.activeSpaceId,
    folders: (state.mediaFolders ?? []).map(({ id, name }) => ({ id, name })),
    ...(mode === 'batch' ? { allFound: items.every(item => item.status !== 'not_found') } : {}) };
}
function assetFor(state: McpHostState, url: unknown) {
  return state.assets.find(asset => asset.url === url || asset.sourceUrl === url || asset.fileRef === url);
}
function inputReferences(state: McpHostState, config: Record<string, unknown>, model: ReturnType<typeof studioFeedModel>, space: ReturnType<typeof spacesFor>[number], nodeId: string) {
  const references: NonNullable<DisplayItem['references']> = [];
  const add = (value: unknown, title: string, kind = 'image', id = title, elementId?: string) => {
    const url = displayUrl(value);
    if (!url || references.some(ref => ref.url === url)) return;
    const asset = assetFor(state, value);
    const thumbnailUrl = previewUrl(asset?.thumbnailUrl);
    references.push({ id, title, kind, url, previewUrl: thumbnailUrl || previewUrl(url), thumbnailUrl, elementId });
  };
  const visit = (value: unknown, title: string, kind: string) => {
    if (typeof value === 'string') add(value, title, kind);
    else if (Array.isArray(value)) value.forEach((entry, i) => visit(entry, `${title} ${i + 1}`, kind));
    else {
      const ref = record(value);
      for (const key of ['url', 'urls', 'images', 'image_urls', 'media']) if (ref[key]) visit(ref[key], title, kind);
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
  for (const field of model?.inputs ?? []) if (['image', 'video', 'audio', 'media'].includes(field.portType)) visit(config[field.id], field.label, field.portType === 'media' ? 'image' : field.portType);
  for (const edge of space.edges.filter(edge => edge.target === nodeId)) {
    const source = space.nodes.find(node => node.id === edge.source);
    if (source) for (const media of canvasMedia(source, state.elements)) add(media.url, media.name, media.kind, media.id);
  }
  return references.slice(0, 24);
}
function generationItems(state: McpHostState, args: Record<string, unknown>): DisplayItem[] {
  const spaces = spacesFor(state);
  if (args.spaceId && !spaces.some(space => space.id === args.spaceId)) throw new McpToolError('That Space was not found. Read the project context for its current ID.');
  const items: DisplayItem[] = [];
  for (const space of spaces) {
    if (args.spaceId && space.id !== args.spaceId) continue;
    for (const node of space.nodes) {
      if (Array.isArray(args.nodeIds) && !args.nodeIds.includes(node.id)) continue;
      if (!args.includeHidden && node.data.config.__studioHiddenFromFeed) continue;
      const model = studioFeedModel(node), config = node.data.config;
      const media = canvasMedia(node, state.elements);
      const versions = [...new Set([...(node.data.generations ?? []), node.data.result?.url].filter((url): url is string => Boolean(url)))];
      if (args.allTakes && versions.length > 1) {
        for (let index = 0; index < versions.length; index++) {
          const take = canvasMedia({ ...node, data: { ...node.data, activeGeneration: index } }, state.elements)[0];
          if (take && !media.some(output => output.id === take.id)) media.push(take);
        }
      }
      if (!model && !media.length) continue;
      const stage = node.data.result?.progressStage;
      const status = stage === 'saving' || stage === 'needs_attention' ? stage : node.data.result?.status === 'error' ? 'failed'
        : node.data.result?.status === 'running' ? 'running' : media.length ? 'complete' : 'pending';
      const outputs = media.length ? media : [{ id: node.id, key: '', name: node.data.label, kind: model?.outputType === 'image' ? 'image' as const : 'video' as const, url: null, prompt: canvasPrompt(node) }];
      for (const output of outputs) {
        if (args.kind && args.kind !== output.kind) continue;
        const asset = assetFor(state, output.url);
        const generationIndex = output.key.startsWith('output-') ? Number(output.key.slice(7)) : undefined;
        const historical = args.allTakes && generationIndex !== undefined && output.url !== node.data.result?.url;
        items.push({ id: output.id, nodeId: node.id, assetId: asset?.id, generationIndex,
          title: output.name || node.data.label || model?.name || 'Generation', kind: output.kind, status: historical ? 'complete' : status,
          ...mediaFields(output.url, asset?.thumbnailUrl || config.thumbnailUrl || config.posterUrl),
          ...dimensions(asset, config), prompt: output.prompt || canvasPrompt(node), model: model?.name,
          provider: model?.provider, spaceId: space.id, spaceName: space.name, references: inputReferences(state, config, model, space, node.id),
          source: node.data.type === 'filePicker' ? 'Canvas upload' : 'Generation',
          createdAt: text(config.__studioCreatedAt) || asset?.createdAt,
          startedAt: historical ? undefined : positive(node.data.result?.progressStartedAt),
          ...(!historical && node.data.result?.error ? { error: node.data.result.error } : {}) });
      }
    }
  }
  return items.reverse().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
function elementItems(state: McpHostState, args: Record<string, unknown>): DisplayItem[] {
  return state.elements.filter(element => (!Array.isArray(args.elementIds) || args.elementIds.includes(element.id))
    && (!args.type || args.type === element.type)
    && (!args.search || `${element.name} ${element.description}`.toLowerCase().includes(String(args.search).toLowerCase())))
    .flatMap<DisplayItem>(raw => {
      const element = materializeElementLooks(raw), seen = new Set<string>();
      const looks = element.variations?.length ? element.variations : [{ id: 'base', name: '', images: element.images }];
      const images = looks.flatMap(look => look.images.flatMap(image => {
        const key = `${look.id}:${image.url}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ id: `${element.id}:${look.id}:${image.id}`, elementId: element.id, variationId: look.id, variationName: look.name, imageId: image.id,
          title: `${element.name}${look.name ? ` · ${look.name}` : ''}`, kind: 'image' as const, status: 'complete', ...mediaFields(image.url, assetFor(state, image.url)?.thumbnailUrl),
          prompt: element.description, createdAt: image.createdAt, source: 'Element' }];
      }));
      return images.length ? images : [{ id: element.id, elementId: element.id, title: element.name, kind: 'image' as const, status: 'pending', url: null, previewUrl: null, prompt: element.description,
        unavailableReason: 'This Element has no reference images yet.' }];
    });
}
function elementCards(state: McpHostState, args: Record<string, unknown>): DisplayItem[] {
  const images = elementItems(state, args);
  return state.elements.filter(element => images.some(image => image.elementId === element.id)).map<DisplayItem>(raw => {
    const element = materializeElementLooks(raw), look = element.variations!.find(look => look.id === element.activeVariationId)!;
    const references = images.filter(image => image.elementId === element.id && image.variationId === look.id);
    const cover = references.find(image => image.previewUrl) ?? references.find(image => image.url);
    const ready = Boolean(cover) && references.every(image => image.url);
    return { id: `element:${element.id}:${look.id}`, title: element.name, kind: 'image', status: ready ? 'complete' : 'pending',
      ...mediaFields(cover?.url, cover?.thumbnailUrl), prompt: element.description, elementId: element.id,
      elementCard: true, elementType: element.type, variationId: look.id, variationName: look.name, referenceCount: references.length,
      // Browsing includes every saved look; the generation reference pack stays
      // scoped to the active look above, even while previewing another image.
      galleryImages: images.filter(image => image.elementId === element.id && image.imageId),
      references: references.map(image => ({ id: image.id, imageId: image.imageId, variationId: image.variationId, elementId: element.id,
        title: image.title, kind: image.kind, url: image.url, previewUrl: image.previewUrl })),
      ...(!ready ? { unavailableReason: references.length ? 'Sync this Element’s references in CineGen to use them in chat.' : 'This Element has no reference images yet.' } : {}) };
  });
}
function libraryItems(state: McpHostState, args: Record<string, unknown>): DisplayItem[] {
  const items: DisplayItem[] = state.assets.map(asset => ({ id: `asset:${asset.id}`, assetId: asset.id, title: asset.name, kind: asset.type,
    status: asset.status === 'processing' ? 'pending' : 'complete', ...mediaFields(displayUrl(asset.url) || asset.sourceUrl || asset.url, asset.thumbnailUrl),
    ...dimensions(asset, asset.metadata), prompt: text(asset.metadata?.prompt), createdAt: asset.createdAt,
    source: 'Asset library', folderId: asset.folderId, folderName: state.mediaFolders?.find(folder => folder.id === asset.folderId)?.name }));
  const known = new Set(state.assets.flatMap(asset => [asset.url, asset.sourceUrl]).filter(Boolean));
  for (const space of spacesFor(state)) for (const node of space.nodes.filter(node => node.data.type === 'filePicker' && !node.data.config.__studioMedia)) {
    for (const media of canvasMedia(node, state.elements)) {
      if (known.has(media.url)) continue;
      known.add(media.url);
      items.push({ id: media.id, nodeId: node.id, title: media.name, kind: media.kind, status: 'complete', ...mediaFields(media.url, node.data.config.thumbnailUrl),
        ...dimensions(undefined, node.data.config), prompt: media.prompt, createdAt: text(node.data.config.__studioCreatedAt), spaceId: space.id, spaceName: space.name, source: 'Canvas upload' });
    }
  }
  return items.filter(item => (!args.kind || item.kind === args.kind) && (!args.folderId || item.folderId === args.folderId)
    && (!Array.isArray(args.assetIds) || args.assetIds.includes(item.assetId))
    && (!args.search || `${item.title} ${item.prompt} ${item.folderName || ''}`.toLowerCase().includes(String(args.search).toLowerCase())))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function batchItems(state: McpHostState, jobs: Record<string, unknown>[]): DisplayItem[] {
  const candidates = generationItems(state, { allTakes: true, includeHidden: true });
  const current = generationItems(state, { includeHidden: true });
  return jobs.map((job, index) => {
    const item = typeof job.nodeId === 'string' ? (job.generationIndex === undefined ? current : candidates).find(item => item.nodeId === job.nodeId && (job.generationIndex === undefined || item.generationIndex === job.generationIndex)) : undefined;
    return item ? { ...item, id: `batch:${index}:${item.id}`, batchIndex: index + 1, requestId: text(job.requestId) || undefined }
      : { id: `batch:${index}`, batchIndex: index + 1, nodeId: text(job.nodeId) || undefined, requestId: text(job.requestId) || undefined,
        title: `Result ${index + 1}`, kind: 'image', status: 'not_found', url: null, previewUrl: null, prompt: '',
        error: job.requestId ? 'Durable request lookup requires the cloud MCP server.' : 'This node or take was not found in this project.' };
  });
}
export function createDisplayHandlers(host: McpHost): Record<string, McpToolHandler> {
  return Object.fromEntries([...DISPLAY_TOOLS, ...DISPLAY_ACTION_TOOLS].map(tool => [tool.name, async (input: Record<string, unknown>) => {
    const parsed = z.fromJSONSchema(tool.inputSchema as any).safeParse(input);
    if (!parsed.success) throw new McpToolError(`Invalid display arguments: ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
    const args = parsed.data as Record<string, unknown>, state = host.getState();
    if (tool.name === 'cinegen_send_to_studio') {
      const destination = spacesFor(state).find(space => space.id === args.spaceId);
      if (!destination?.id) throw new McpToolError('Choose an existing destination Space.');
      const candidates = [...libraryItems(state, {}), ...elementItems(state, {}), ...generationItems(state, { allTakes: true, includeHidden: true })];
      const selected = (args.itemIds as string[]).map(id => {
        // Batch IDs preserve a real underlying media ID; never accept client URLs.
        const canonical = id.replace(/^batch:\d+:/, '');
        const item = candidates.find(item => item.id === canonical);
        if (!item || !item.url || !['image', 'video'].includes(item.kind)) throw new McpToolError('A selected image/video is unavailable. Refresh the gallery and sync local files before sending to Studio.');
        return { ...item, url: item.url } as DisplayItem & { url: string };
      });
      let nodes = destination.nodes;
      const nodeIds: string[] = [];
      for (const item of selected) {
        const existing = nodes.find(node => (node.data.config.__studioSourceItemId === item.id && node.data.config.fileUrl === item.url)
          || (node.data.config.__studioGenerated && (node.data.result?.url === item.url || node.data.config.fileUrl === item.url)));
        if (existing) {
          nodeIds.push(existing.id);
          if (existing.data.config.__studioHiddenFromFeed) nodes = nodes.map(node => node.id === existing.id ? { ...node, data: { ...node.data, config: { ...node.data.config, __studioHiddenFromFeed: false } } } : node);
          continue;
        }
        const id = generateId(); nodeIds.push(id);
        nodes = [...nodes, { id, type: 'filePicker', position: { x: 80, y: 80 }, data: { type: 'filePicker', label: item.title,
          config: { fileUrl: item.url, fileType: item.kind, fileName: item.title, __studioGenerated: true, __studioMedia: true,
            __studioCreatedAt: new Date().toISOString(), __studioOutputType: item.kind, __studioPrompt: item.prompt,
            __studioSourceItemId: item.id, __studioSourceNodeId: item.nodeId, __studioSourceUrl: item.url },
          result: { url: item.url, status: 'complete' } } }];
      }
      if (nodes !== destination.nodes) {
        if (destination.id !== state.activeSpaceId) host.dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: destination.id });
        host.dispatch({ type: 'SET_NODES', nodes });
        if (state.activeSpaceId && destination.id !== state.activeSpaceId) host.dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: state.activeSpaceId });
      }
      return { sent: selected.length, nodeIds, spaceId: destination.id, spaceName: destination.name, generated: false, note: 'Available in the Studio feed as references. No generation started.' };
    }
    if (tool.name === 'cinegen_show_media') return page('Media library', 'media', libraryItems(state, args), tool.name, args, state);
    if (tool.name === 'cinegen_show_film_presets') {
      const items = FILM_PRESETS.filter(preset => (!args.category || preset.category === args.category)
        && (!args.search || `${preset.title} ${preset.prompt}`.toLowerCase().includes(String(args.search).toLowerCase())))
        .map(preset => ({ ...preset, presetId: preset.id, kind: 'preset' as const, status: 'complete', url: null, previewUrl: null }));
      return page('Film presets', 'presets', items, tool.name, args, state);
    }
    if (tool.name === 'cinegen_show_generation_batch') return page('Batch review', 'batch', batchItems(state, args.jobs as Record<string, unknown>[]), tool.name, args, state);
    if (tool.name === 'cinegen_show_reference_elements') return page('Reference Elements', 'elements', args.view === 'images' ? elementItems(state, args) : elementCards(state, args), tool.name, args, state);
    if (tool.name === 'cinegen_job_display') {
      if (!args.nodeId) throw new McpToolError('Use nodeId to view this result on desktop. requestId lookup is available on the cloud MCP server.');
      const items = generationItems(state, { ...args, nodeIds: [args.nodeId], includeHidden: true });
      if (!items.length) throw new McpToolError('That generation was not found. Read the current generations for its nodeId.');
      return page(items[0].title, 'job', items.slice(0, 1), tool.name, args, state);
    }
    return page('Generations', 'generations', generationItems(state, args), tool.name, args, state);
  }]));
}

/** Durable status is authoritative; this never calls the save-retry endpoint. */
export function displayJobSnapshot(job: Record<string, unknown>, existing?: DisplayPage): DisplayPage {
  const base = existing?.items[0];
  const item: DisplayItem = { id: text(job.nodeId) || text(job.requestId), title: base?.title || 'Generation', kind: base?.kind || (job.kind === 'video' ? 'video' : 'image'),
    prompt: base?.prompt || '', ...base, nodeId: text(job.nodeId), requestId: text(job.requestId),
    status: text(job.status), ...mediaFields(job.url, job.url ? base?.thumbnailUrl : undefined), createdAt: text(job.createdAt),
    startedAt: positive(Date.parse(text(job.createdAt))) ?? base?.startedAt, provider: text(job.provider),
    error: text(job.error) || undefined, unavailableReason: job.status === 'not_found' ? 'This job was not found.' : undefined };
  const args = { projectId: job.projectId, requestId: job.requestId };
  return { ...existing, title: item.title, mode: 'job', items: [item], total: 1, offset: 0, limit: 1, hasMore: false, refresh: { name: 'cinegen_job_display', arguments: args } };
}
