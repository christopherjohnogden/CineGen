import { z } from 'zod';
import { DISPLAY_TOOLS, displayUrl, previewUrl } from '../../../mcp/display-tools.mjs';
import { canvasMedia, canvasPrompt, studioFeedModel } from '@/lib/studio/canvas-import';
import { materializeElementLooks } from '@/lib/elements/variations';
import type { McpHost, McpHostState, McpToolHandler } from './types';
import { McpToolError } from './types';

export interface DisplayItem {
  id: string; title: string; kind: 'image' | 'video'; status: string;
  url: string | null; previewUrl: string | null; prompt: string;
  nodeId?: string; elementId?: string; requestId?: string; spaceId?: string; spaceName?: string;
  model?: string; provider?: string; createdAt?: string; error?: string; unavailableReason?: string;
}
export interface DisplayPage {
  title: string; mode: 'generations' | 'elements' | 'job'; items: DisplayItem[];
  total: number; offset: number; limit: number; hasMore: boolean;
  refresh: { name: string; arguments: Record<string, unknown> }; projectId?: string; projectUrl?: string;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
function mediaFields(value: unknown) {
  const url = displayUrl(value);
  return { url, previewUrl: previewUrl(url), ...(!url && value ? { unavailableReason: 'This media is only available in CineGen. Sync or relink it to view it in chat.' } : {}) };
}
function page(title: string, mode: DisplayPage['mode'], items: DisplayItem[], name: string, args: Record<string, unknown>): DisplayPage {
  const limit = mode === 'job' ? 1 : Number(args.limit ?? 12);
  const offset = mode === 'job' ? 0 : Number(args.offset ?? 0);
  return { title, mode, items: items.slice(offset, offset + limit), total: items.length, offset, limit,
    hasMore: offset + limit < items.length, refresh: { name, arguments: args } };
}
function generationItems(state: McpHostState, args: Record<string, unknown>): DisplayItem[] {
  const spaces = state.spaces.length ? state.spaces.map(space => space.id === state.activeSpaceId ? { ...space, nodes: state.nodes } : space)
    : [{ id: state.activeSpaceId, name: 'Space', nodes: state.nodes }];
  if (args.spaceId && !spaces.some(space => space.id === args.spaceId)) throw new McpToolError('That Space was not found. Read the project context for its current ID.');
  const items: DisplayItem[] = [];
  for (const space of spaces) {
    if (args.spaceId && space.id !== args.spaceId) continue;
    for (const node of space.nodes) {
      if (Array.isArray(args.nodeIds) && !args.nodeIds.includes(node.id)) continue;
      if (node.data.config.__studioHiddenFromFeed) continue;
      const model = studioFeedModel(node);
      // References and imported media belong in the gallery too, but plain prompts don't.
      const media = canvasMedia(node, state.elements);
      if (!model && !media.length) continue;
      const stage = node.data.result?.progressStage;
      const status = stage === 'saving' || stage === 'needs_attention' ? stage
        : node.data.result?.status === 'error' ? 'failed'
        : node.data.result?.status === 'running' ? 'running'
        : media.length ? 'complete' : 'pending';
      const outputs = media.length ? media : [{ id: node.id, name: node.data.label, kind: model?.outputType === 'image' ? 'image' as const : 'video' as const, url: null, prompt: canvasPrompt(node) }];
      for (const output of outputs) {
        if (args.kind && args.kind !== output.kind) continue;
        items.push({ id: output.id, nodeId: node.id, title: output.name || node.data.label || model?.name || 'Generation', kind: output.kind, status,
          ...mediaFields(output.url), prompt: output.prompt || canvasPrompt(node), model: model?.name,
          provider: model?.provider, spaceId: space.id, spaceName: space.name,
          createdAt: text(node.data.config.__studioCreatedAt), ...(node.data.result?.error ? { error: node.data.result.error } : {}) });
      }
    }
  }
  return items.reverse().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function createDisplayHandlers(host: McpHost): Record<string, McpToolHandler> {
  return Object.fromEntries(DISPLAY_TOOLS.map(tool => [tool.name, async (input: Record<string, unknown>) => {
    const parsed = z.fromJSONSchema(tool.inputSchema as any).safeParse(input);
    if (!parsed.success) throw new McpToolError(`Invalid display arguments: ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
    const args = parsed.data as Record<string, unknown>, state = host.getState();
    if (tool.name === 'cinegen_show_reference_elements') {
      const selected = state.elements.filter(element => (!Array.isArray(args.elementIds) || args.elementIds.includes(element.id))
        && (!args.type || args.type === element.type)
        && (!args.search || `${element.name} ${element.description}`.toLowerCase().includes(String(args.search).toLowerCase())));
      const items = selected.flatMap<DisplayItem>(raw => {
        const element = materializeElementLooks(raw), seen = new Set<string>();
        const looks = element.variations?.length ? element.variations : [{ id: 'base', name: '', images: element.images }];
        const images = looks.flatMap(look => look.images.flatMap(image => {
          const key = `${look.id}:${image.url}`;
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ id: `${element.id}:${look.id}:${image.id}`, elementId: element.id,
            title: `${element.name}${look.name ? ` · ${look.name}` : ''}`, kind: 'image' as const, status: 'complete', ...mediaFields(image.url),
            prompt: element.description, createdAt: image.createdAt }];
        }));
        return images.length ? images : [{ id: element.id, elementId: element.id, title: element.name, kind: 'image' as const, status: 'pending', url: null, previewUrl: null, prompt: element.description,
          unavailableReason: 'This Element has no reference images yet.' }];
      });
      return page('Reference Elements', 'elements', items, tool.name, args);
    }
    if (tool.name === 'cinegen_job_display') {
      if (!args.nodeId) throw new McpToolError('Use nodeId to view this result on desktop. requestId lookup is available on the cloud MCP server.');
      const items = generationItems(state, { ...args, nodeIds: [args.nodeId] });
      if (!items.length) throw new McpToolError('That generation was not found. Read the current generations for its nodeId.');
      return page(items[0].title, 'job', items.slice(0, 1), tool.name, args);
    }
    return page('Generations', 'generations', generationItems(state, args), tool.name, args);
  }]));
}

/** Durable status is authoritative for a requestId; this does not call the save-retry endpoint. */
export function displayJobSnapshot(job: Record<string, unknown>, existing?: DisplayPage): DisplayPage {
  const base = existing?.items[0];
  const item: DisplayItem = { id: text(job.nodeId) || text(job.requestId), title: base?.title || 'Generation', kind: base?.kind || (job.kind === 'video' ? 'video' : 'image'),
    prompt: base?.prompt || '', ...base, nodeId: text(job.nodeId), requestId: text(job.requestId),
    status: text(job.status), ...mediaFields(job.url), createdAt: text(job.createdAt), provider: text(job.provider),
    error: text(job.error) || undefined, unavailableReason: job.status === 'not_found' ? 'This job was not found.' : undefined };
  const args = { projectId: job.projectId, requestId: job.requestId };
  return { title: item.title, mode: 'job', items: [item], total: 1, offset: 0, limit: 1, hasMore: false, refresh: { name: 'cinegen_job_display', arguments: args } };
}
