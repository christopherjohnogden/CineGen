import { materializeElementLooks } from '@/lib/elements/variations';
import { elementGenerationModelOptions } from '@/lib/elements/reference-generation';
import { EDIT_SCHEMAS, showPatch, scenePatch, clipPatch, breakdownPatch } from '../../../mcp/edit-schemas.mjs';
import type { McpHost, McpToolHandler } from './types';
import { McpToolError } from './types';
import { generateId, timestamp } from '@/lib/utils/ids';
import { createWorkflowNodeFromSpec } from '@/lib/llm/space-node-factory';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import { getModelDefinition } from '@/lib/fal/models';
import { placeStudioNodeOnCanvas, removeStudioNodeFromCanvas } from '@/lib/studio/canvas-placement';
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';
import { findMatchingElement } from '@/lib/director/breakdown';
import { clipEndTime } from '@/types/timeline';
import { setHeroTake, removeDirectorTake, updateDirectorTake } from '@/lib/director/director-state';
import type { DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import type { Asset } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import { storyboardPlan, upsertStoryboardFrame } from '@/lib/director/storyboard';
import { applyFraming, clearFramingBind } from '@/lib/director/framing-reserve';
import { claudeShotlistImportPrompt } from '@/lib/director/shotlist-import';
import { getDirectorAdapter, listDirectorAdapters } from '@/lib/director/video-adapter';

function found<T extends { id: string }>(items: T[], id: unknown, kind: string): T {
  const item = items.find((item) => item.id === id);
  if (!item) throw new McpToolError(`No ${kind} with ID "${String(id)}". Read the current project first.`);
  return item;
}
function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new McpToolError(`${name} is required.`);
  return value;
}
function uniqueIds(items: { id: string }[], kind: string) {
  if (new Set(items.map((x) => x.id)).size !== items.length) throw new McpToolError(`Duplicate ${kind} IDs.`);
}
export function createEditHandlers(host: McpHost): Record<string, McpToolHandler> {
  const state = () => host.getState();
  const app = (action: string, args: Record<string, unknown>) => {
    if (!host.appAction) throw new McpToolError('This host does not support app commands. Open CineGen Desktop.');
    return host.appAction(action, args);
  };
  const space = (id?: unknown) => {
    const s = state();
    const target = found(s.spaces, id ?? s.activeSpaceId, 'Space');
    return target.id === s.activeSpaceId ? { ...target, nodes: s.nodes, edges: s.edges } : target;
  };
  const activate = (id: string) => { host.dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: id }); };
  const raw: Record<string, McpToolHandler> = {
    async cinegen_capabilities() {
      return {
        directorAdapters: listDirectorAdapters().map(({ id, label, provider, modelId, capabilities }) => ({ id, label, provider, modelId, capabilities })),
        shotlistInstructions: claudeShotlistImportPrompt(state().director),
        storyboard: storyboardPlan(state().director).map(frame => ({ id: frame.id, clipId: frame.clip.id, beatN: frame.beat.n, prompt: frame.prompt })),
        workflow: 'Load script (disables automatic app LLM passes), write breakdown, review with user, approve selected item IDs to create linked Elements, add reference images, import shotlist, generate Director takes. Use one-off generation for Spaces.',
        limitations: ['Requires an open desktop project.', 'Account sign-in, credential entry and device setup remain app controls.', 'Exports have the same rendering capabilities and limitations as the app export engine.'],
      };
    },
    async cinegen_storyboard(a) {
      const show = state().director, plan = storyboardPlan(show);
      if (a.action === 'read') return plan;
      const frame = found(plan, a.frameId, 'storyboard frame');
      if (a.action === 'prompt') host.dispatch({ type: 'SET_DIRECTOR', director: upsertStoryboardFrame(show, frame, { prompt: required(a.prompt, 'prompt'), customPrompt: true }) });
      else {
        const asset = found(state().assets, a.assetId, 'asset'); if (asset.type !== 'image') throw new McpToolError('Storyboard frames require an image asset.');
        host.dispatch({ type: 'SET_DIRECTOR', director: upsertStoryboardFrame(show, frame, { imageUrl: asset.fileRef || asset.url, assetId: asset.id, status: 'ready', generatedAt: timestamp() }) });
      }
      return { frameId: frame.id, action: a.action };
    },
    async cinegen_framing(a) {
      const show = state().director, clip = found(show.clips, a.clipId, 'clip');
      if (a.action === 'apply') found(show.framingReserve ?? [], a.framingId, 'framing');
      const director = a.action === 'apply' ? applyFraming(show, clip.id, a.framingId as string, (a.scope as 'variant' | 'clip' | 'scene') ?? 'variant') : clearFramingBind(show, clip.id, clip.activeVariant);
      host.dispatch({ type: 'SET_DIRECTOR', director }); return { clipId: clip.id, action: a.action };
    },
    async cinegen_extract_media(a) { found(state().assets, a.assetId, 'asset'); return app('extract_media', a); },
    async cinegen_project(a) { return app('project', a); },
    async cinegen_element_models() { return elementGenerationModelOptions(); },
    async cinegen_build_element(a) { return app('build_element', a); },
    async cinegen_approve_element(a) { return app('approve_element', a); },
    async cinegen_read(a) {
      const s = state();
      switch (a.section) {
        case 'director': return s.director;
        case 'elements': return a.id ? materializeElementLooks(found(s.elements, a.id, 'Element')) : s.elements.map(materializeElementLooks);
        case 'spaces': return s.spaces.map((entry) => space(entry.id));
        case 'space': return space(a.id);
        case 'assets': return a.id ? found(s.assets, a.id, 'asset') : s.assets;
        case 'timelines': return a.id ? found(s.timelines, a.id, 'timeline') : s.timelines;
        case 'exports': return s.exports ?? [];
        case 'folders': return { media: s.mediaFolders ?? [], elements: s.elementFolders ?? [] };
      }
    },
    async cinegen_navigate(a) {
      if (a.spaceId) found(state().spaces, a.spaceId, 'Space');
      if (a.timelineId) found(state().timelines, a.timelineId, 'timeline');
      if (a.spaceId) activate(a.spaceId as string);
      if (a.timelineId) host.dispatch({ type: 'OPEN_TIMELINE', timelineId: a.timelineId as string });
      const tab = a.tab ?? (a.view || a.spaceId ? 'create' : a.timelineId ? 'edit' : undefined);
      if (tab) host.dispatch({ type: 'SET_TAB', tab: tab as 'create' });
      if (a.view) await app('view', a);
      return { tab, spaceId: state().activeSpaceId, timelineId: state().activeTimelineId, view: a.view };
    },
    async cinegen_edit_element(a) {
      const element = found(state().elements, a.elementId, 'Element');
      const patch = a.patch as Partial<Element>;
      if (patch.activeVariationId) found(patch.variations ?? materializeElementLooks(element).variations!, patch.activeVariationId, 'variation');
      let next = materializeElementLooks({ ...element, ...patch });
      if (patch.images && !patch.variations) {
        next = { ...next, images: patch.images, variations: next.variations!.map(look => look.id === next.activeVariationId ? { ...look, images: patch.images! } : look) };
      }
      uniqueIds(next.images, 'image'); uniqueIds(next.variations ?? [], 'variation');
      if (next.activeVariationId) found(next.variations ?? [], next.activeVariationId, 'variation');
      if (next.folderId) found(state().elementFolders ?? [], next.folderId, 'Element folder');
      if (patch.images || patch.variations) {
        next = await app('persist_element', { element: next }) as Element;
        const latest = found(state().elements, element.id, 'Element');
        if (JSON.stringify(latest) !== JSON.stringify(element)) throw new McpToolError('Element changed while saving references. Read it and retry.');
      }
      host.dispatch({ type: 'UPDATE_ELEMENT', elementId: element.id, updates: { ...next, updatedAt: timestamp() } });
      return { ...next, updatedAt: timestamp() };
    },
    async cinegen_delete_element(a) {
      const el = found(state().elements, a.elementId, 'Element');
      host.dispatch({ type: 'REMOVE_ELEMENT', elementId: el.id });
      host.dispatch({ type: 'SET_DIRECTOR', director: { ...state().director, breakdown: state().director.breakdown.map((x) => x.elementId === el.id ? { ...x, elementId: undefined } : x), scenes: state().director.scenes.map(x => ({ ...x, elementIds: x.elementIds.filter(id => id !== el.id) })) } });
      return { removed: el.id };
    },
    async cinegen_approve_breakdown(a) {
      const s = state();
      const ids = a.itemIds as string[];
      const items = ids.map(id => found(s.director.breakdown, id, 'breakdown item'));
      const elements = [...s.elements];
      const links = new Map<string, string>();
      const created: Element[] = [];
      for (const item of items) {
        let el = elements.find(e => e.id === item.elementId) ?? findMatchingElement(elements, item);
        if (!el) {
          el = { id: generateId(), name: item.name, type: item.kind, description: item.description, images: [], createdAt: timestamp(), updatedAt: timestamp() };
          elements.push(el); created.push(el);
        }
        links.set(item.id, el.id);
      }
      for (const element of created) host.dispatch({ type: 'ADD_ELEMENT', element });
      host.dispatch({ type: 'SET_DIRECTOR', director: { ...s.director, breakdownApproved: true, breakdown: s.director.breakdown.map(item => links.has(item.id) ? { ...item, elementId: links.get(item.id) } : item) } });
      return { created: created.map(e => ({ id: e.id, name: e.name })), linked: Object.fromEntries(links), approved: true };
    },
    async cinegen_edit_director(a) {
      const current = state().director;
      const schema = { show: showPatch, scene: scenePatch, clip: clipPatch, breakdown: breakdownPatch }[a.target as string];
      if (!schema) throw new McpToolError('Unknown Director target.');
      const result = schema.safeParse(a.patch);
      if (!result.success) throw new McpToolError(result.error.message);
      const patch = result.data;
      if (a.target === 'show') {
        if (patch.adapterId && getDirectorAdapter(patch.adapterId).id !== patch.adapterId) throw new McpToolError('Unknown Director adapter ID.');
        if (patch.selectedSceneId) found(current.scenes, patch.selectedSceneId, 'scene');
        if (patch.selectedClipId) found(current.clips, patch.selectedClipId, 'clip');
        if (patch.sourceText !== undefined) throw new McpToolError('Use cinegen_load_script to update script text and reconcile its scenes.');
        host.dispatch({ type: 'SET_DIRECTOR', director: { ...current, ...patch } as DirectorShow });
      } else {
        const key = { scene: 'scenes', clip: 'clips', breakdown: 'breakdown' }[a.target as string] as 'scenes' | 'clips' | 'breakdown';
        found(current[key] as { id: string }[], a.id, String(a.target));
        if (patch.sceneId) found(current.scenes, patch.sceneId, 'scene');
        if (patch.elementId) found(state().elements, patch.elementId, 'Element');
        if (patch.elementIds) for (const id of patch.elementIds) found(state().elements, id, 'Element');
        if (patch.elementTags) for (const tag of patch.elementTags) if (!current.breakdown.some(x => x.tag === tag)) throw new McpToolError(`Unknown breakdown tag ${tag}.`);
        if (patch.beats && new Set(patch.beats.map((x: { n: number }) => x.n)).size !== patch.beats.length) throw new McpToolError('Duplicate beat numbers.');
        let next = { ...current, [key]: current[key].map(x => x.id === a.id ? { ...x, ...patch } : x) } as DirectorShow;
        if (key === 'clips') next = { ...next, scenes: next.scenes.map(x => ({ ...x, clipIds: next.clips.filter(c => c.sceneId === x.id).map(c => c.id) })) };
        if (key === 'breakdown') next.breakdownApproved = false;
        host.dispatch({ type: 'SET_DIRECTOR', director: next });
      }
      return { updated: a.target, id: a.id };
    },
    async cinegen_delete_director_item(a) {
      const s = state().director;
      if (a.target === 'clip') {
        found(s.clips, a.id, 'clip');
        host.dispatch({ type: 'SET_DIRECTOR', director: { ...s, clips: s.clips.filter(x => x.id !== a.id), scenes: s.scenes.map(x => ({ ...x, clipIds: x.clipIds.filter(id => id !== a.id) })), storyboardFrames: s.storyboardFrames?.filter(x => x.clipId !== a.id), selectedClipId: s.selectedClipId === a.id ? undefined : s.selectedClipId } });
      } else {
        const item = found(s.breakdown, a.id, 'breakdown item');
        host.dispatch({ type: 'SET_DIRECTOR', director: { ...s, breakdown: s.breakdown.filter(x => x.id !== a.id), breakdownApproved: false, clips: s.clips.map(x => ({ ...x, elementTags: x.elementTags.filter(tag => tag !== item.tag) })) } });
      }
      return { removed: a.id };
    },
    async cinegen_take(a) {
      const s = state().director; const clip = found(s.clips, a.clipId, 'clip'); found(clip.takes, a.takeId, 'take');
      const next = a.action === 'hero' ? setHeroTake(s, clip.id, a.takeId as string) : a.action === 'remove' ? removeDirectorTake(s, clip.id, a.takeId as string) : updateDirectorTake(s, clip.id, a.takeId as string, { notes: required(a.notes, 'notes') });
      host.dispatch({ type: 'SET_DIRECTOR', director: next }); return { updated: a.takeId };
    },
    async cinegen_director_action(a) {
      const s = state().director;
      if (a.clipId) found(s.clips, a.clipId, 'clip');
      if (a.sceneId) found(s.scenes, a.sceneId, 'scene');
      if (a.clipIds) for (const id of a.clipIds as string[]) found(s.clips, id, 'clip');
      return app('director', a);
    },
    async cinegen_get_jobs(a) { return app('jobs', a); },
    async cinegen_space(a) {
      if (a.action === 'create') {
        const created = { id: generateId(), name: required(a.name, 'name'), createdAt: timestamp(), nodes: [], edges: [] };
        host.dispatch({ type: 'ADD_SPACE', space: created }); return created;
      }
      const target = space(a.spaceId);
      if (a.action === 'rename') host.dispatch({ type: 'RENAME_SPACE', spaceId: target.id, name: required(a.name, 'name') });
      if (a.action === 'delete') host.dispatch({ type: 'REMOVE_SPACE', spaceId: target.id });
      if (a.action === 'duplicate') {
        const copy = structuredClone(target); copy.id = generateId(); copy.name = (a.name as string) || `${target.name} copy`; copy.createdAt = timestamp();
        const ids = new Map(copy.nodes.map(n => [n.id, generateId()]));
        copy.nodes = copy.nodes.map(n => ({ ...n, id: ids.get(n.id)!, data: { ...n.data, config: { ...n.data.config, ...(Array.isArray(n.data.config.__studioPlacedInputIds) ? { __studioPlacedInputIds: n.data.config.__studioPlacedInputIds.map(id => ids.get(String(id))).filter(Boolean) } : {}) } } })); copy.edges = copy.edges.map(e => ({ ...e, id: generateId(), source: ids.get(e.source)!, target: ids.get(e.target)! }));
        host.dispatch({ type: 'ADD_SPACE', space: copy }); return copy;
      }
      return { spaceId: target.id, action: a.action };
    },
    async cinegen_list_node_types(a) {
      if (a.nodeType && !NODE_REGISTRY[a.nodeType as string]) throw new McpToolError('Unknown node type.');
      return Object.entries(NODE_REGISTRY).filter(([key]) => !a.nodeType || key === a.nodeType).map(([key, def]) => ({ nodeType: key, ...def, model: getModelDefinition(key) }));
    },
    async cinegen_nodes(a) {
      const target = space(a.spaceId); let nodes = target.nodes, edges = target.edges;
      const ids = a.nodeIds as string[] | undefined;
      if (a.action !== 'create' && !ids?.length) throw new McpToolError('nodeIds is required.');
      for (const id of ids ?? []) found(nodes, id, 'node');
      if (a.action === 'create') {
        const node = createWorkflowNodeFromSpec({ nodeType: required(a.nodeType, 'nodeType'), label: a.label as string, config: a.config as Record<string, unknown> }, a.position as { x: number, y: number } ?? { x: 200, y: nodes.length * 300 });
        nodes = [...nodes, node]; activate(target.id); host.dispatch({ type: 'SET_NODES', nodes }); return { nodeId: node.id };
      }
      if (a.action === 'update') nodes = nodes.map(node => ids!.includes(node.id) ? { ...node, position: (a.position as typeof node.position) ?? node.position, data: { ...node.data, label: (a.label as string) ?? node.data.label, config: { ...node.data.config, ...a.config as object } } } : node);
      if (a.action === 'delete') { nodes = nodes.filter(node => !ids!.includes(node.id)); edges = edges.filter(e => !ids!.includes(e.source) && !ids!.includes(e.target)); }
      if (a.action === 'place' || a.action === 'unplace') for (const id of ids!) {
        const result = a.action === 'place' ? placeStudioNodeOnCanvas(nodes, edges, id, state().assets) : removeStudioNodeFromCanvas(nodes, edges, id);
        nodes = result.nodes; edges = result.edges;
      }
      activate(target.id);
      if (a.action === 'run') { for (const id of ids!) host.runNode(id, nodes, edges); }
      else { host.dispatch({ type: 'SET_NODES', nodes }); host.dispatch({ type: 'SET_EDGES', edges }); }
      return { nodeIds: ids, action: a.action, spaceId: target.id };
    },
    async cinegen_connect(a) {
      const target = space(a.spaceId); let edges = target.edges;
      if (a.action === 'disconnect') { found(edges, a.edgeId, 'connection'); edges = edges.filter(e => e.id !== a.edgeId); }
      else {
        const source = found(target.nodes, a.source, 'source node'), dest = found(target.nodes, a.target, 'target node');
        if (source.id === dest.id) throw new McpToolError('A node cannot connect to itself.');
        const sourceHandle = required(a.sourceHandle, 'sourceHandle'), targetHandle = required(a.targetHandle, 'targetHandle');
        const output = NODE_REGISTRY[source.data.type]?.outputs.find(p => p.id === sourceHandle);
        const input = NODE_REGISTRY[dest.data.type]?.inputs.find(p => p.id === targetHandle || targetHandle.startsWith(`${p.id}_`));
        if (!output || !input) throw new McpToolError('Unknown connection port. Read cinegen_list_node_types.');
        const reachable = new Set([dest.id]);
        let changed = true;
        while (changed) { changed = false; for (const edge of edges) if (reachable.has(edge.source) && !reachable.has(edge.target)) { reachable.add(edge.target); changed = true; } }
        if (reachable.has(source.id)) throw new McpToolError('This connection would create a workflow cycle.');
        if (edges.some(e => e.source === source.id && e.target === dest.id && e.sourceHandle === sourceHandle && e.targetHandle === targetHandle)) return { edges };
        const edge = { id: generateId(), source: source.id, target: dest.id, sourceHandle, targetHandle }; edges = [...edges, edge];
      }
      activate(target.id); host.dispatch({ type: 'SET_EDGES', edges }); return { edges };
    },
    async cinegen_asset(a) {
      const patch = (a.patch ?? {}) as Partial<Asset>;
      if (patch.folderId) found(state().mediaFolders ?? [], patch.folderId, 'media folder');
      if (a.action === 'add') {
        if (!patch.type) throw new McpToolError('patch.type is required.');
        const asset = { ...patch, id: generateId(), name: required(patch.name, 'patch.name'), type: patch.type, url: required(patch.url ?? patch.fileRef, 'patch.url or patch.fileRef'), createdAt: timestamp() } as Asset;
        host.dispatch({ type: 'ADD_ASSET', asset }); return asset;
      }
      const asset = found(state().assets, a.assetId, 'asset');
      if (a.action === 'update') host.dispatch({ type: 'UPDATE_ASSET', asset: { ...patch, id: asset.id } });
      else {
        if (state().timelines.some(t => t.clips.some(c => c.assetId === asset.id)) || state().director.clips.some(c => c.takes.some(t => t.assetId === asset.id))) throw new McpToolError('Asset is referenced by a timeline or Director take. Remove those references first.');
        host.dispatch({ type: 'REMOVE_ASSET', assetId: asset.id });
      }
      return { assetId: asset.id, action: a.action };
    },
    async cinegen_folder(a) {
      const media = a.kind === 'media'; const folders = media ? state().mediaFolders ?? [] : state().elementFolders ?? [];
      if (a.parentId) { if (!media) throw new McpToolError('Element folders do not have parents.'); found(state().mediaFolders ?? [], a.parentId, 'parent folder'); }
      if (a.action === 'create') {
        const folder = { id: generateId(), name: required(a.name, 'name'), createdAt: timestamp(), ...(a.parentId ? { parentId: a.parentId as string } : {}) };
        host.dispatch(media ? { type: 'ADD_FOLDER', folder } : { type: 'ADD_ELEMENT_FOLDER', folder }); return folder;
      }
      const folder = found(folders, a.folderId, 'folder');
      if (a.parentId) {
        let parent = String(a.parentId); const seen = new Set([folder.id]);
        while (parent) { if (seen.has(parent)) throw new McpToolError('Folder hierarchy cannot contain a cycle.'); seen.add(parent); parent = (state().mediaFolders ?? []).find(f => f.id === parent)?.parentId ?? ''; }
      }
      if (a.action === 'delete') host.dispatch(media ? { type: 'REMOVE_FOLDER', folderId: folder.id } : { type: 'REMOVE_ELEMENT_FOLDER', folderId: folder.id });
      else { const updates = { ...(a.name ? { name: a.name as string } : {}), ...(a.parentId ? { parentId: a.parentId as string } : {}) }; host.dispatch(media ? { type: 'UPDATE_FOLDER', folder: { id: folder.id, ...updates } } : { type: 'UPDATE_ELEMENT_FOLDER', folderId: folder.id, updates }); }
      return { folderId: folder.id, action: a.action };
    },
    async cinegen_timeline(a) {
      if (a.action === 'create') { const timeline = createDefaultTimeline(required(a.name, 'name')); host.dispatch({ type: 'ADD_TIMELINE', timeline }); return timeline; }
      const target = found(state().timelines, a.timelineId ?? state().activeTimelineId, 'timeline');
      if (a.action === 'delete') host.dispatch({ type: 'REMOVE_TIMELINE', timelineId: target.id });
      if (a.action === 'rename') host.dispatch({ type: 'SET_TIMELINE', timelineId: target.id, timeline: { ...target, name: required(a.name, 'name') } });
      if (a.action === 'duplicate') { const timeline = structuredClone(target); timeline.id = generateId(); timeline.name = (a.name as string) || `${target.name} copy`; host.dispatch({ type: 'ADD_TIMELINE', timeline }); return timeline; }
      return { timelineId: target.id, action: a.action };
    },
    async cinegen_set_timeline(a) {
      const timeline = a.timeline as Timeline; found(state().timelines, timeline.id, 'timeline');
      uniqueIds(timeline.tracks, 'track'); uniqueIds(timeline.clips, 'clip'); uniqueIds(timeline.transitions, 'transition'); uniqueIds(timeline.markers, 'marker');
      for (const clip of timeline.clips) { found(timeline.tracks, clip.trackId, 'track'); found(state().assets, clip.assetId, 'asset'); if (clip.trimStart + clip.trimEnd >= clip.duration) throw new McpToolError('Clip trims must leave positive duration.'); for (const id of clip.linkedClipIds ?? []) found(timeline.clips, id, 'linked clip'); }
      for (const t of timeline.transitions) { found(timeline.clips, t.clipAId, 'transition clip'); if (t.clipBId) found(timeline.clips, t.clipBId, 'transition clip'); }
      timeline.duration = Math.max(0, ...timeline.clips.map(clipEndTime)); host.dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline }); return timeline;
    },
    async cinegen_export(a) { return app('export', a); },
    async cinegen_history(a) { host.dispatch({ type: a.action === 'undo' ? 'UNDO' : 'REDO' }); return { action: a.action }; },
  };
  return Object.fromEntries(Object.entries(raw).map(([name, handler]) => [name, async (args: Record<string, unknown>) => {
    const result = EDIT_SCHEMAS[name].safeParse(args);
    if (!result.success) throw new McpToolError(`Invalid arguments: ${result.error.message}`);
    return handler(result.data);
  }]));
}
