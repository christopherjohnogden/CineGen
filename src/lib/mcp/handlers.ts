import { createEditHandlers } from './edit-handlers';
import { placeStudioNodeOnCanvas } from '@/lib/studio/canvas-placement';
import type { Node } from '@xyflow/react';
import { getModelDefinition } from '@/lib/fal/models';
import { providerModelOptions, modelProviderLabel } from '@/lib/workflows/provider-model-options';
import { createWorkflowNodeFromSpec } from '@/lib/llm/space-node-factory';
import { buildSpaceFromTemplate, type SpacePrefill, type SpaceTemplateId } from '@/lib/llm/space-templates';
import { nextStudioSlot } from '@/lib/studio/layout';
import { promptFieldFor, referenceFieldFor, startFieldFor, endFieldFor } from '@/lib/studio/fields';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { localBreakdownForShow } from '@/lib/director/local-breakdown';
import { mergeBreakdownItems, mergeScenes } from '@/lib/director/breakdown';
import { applyClaudeShotlistImport, parseClaudeShotlistImport } from '@/lib/director/shotlist-import';
import { generateId, timestamp } from '@/lib/utils/ids';
import type { Element } from '@/types/elements';
import type { DirectorBreakdownItem } from '@/types/director';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';
import { McpToolError, type McpHost, type McpHostState, type McpToolHandler } from './types';

const DEFAULT_VIDEO_MODEL = 'Seedance 2.5';
const MAX_BATCH = 4;

// ---------------------------------------------------------------------------
// Argument helpers. Tool arguments arrive as untyped JSON from the model.
// ---------------------------------------------------------------------------

function str(args: Record<string, unknown>, key: string, required = false): string {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) throw new McpToolError(`"${key}" is required.`);
  return '';
}

/** Script text is taken verbatim: leading whitespace carries meaning in screenplay formats. */
function rawStr(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') throw new McpToolError(`"${key}" is required.`);
  return value;
}

function int(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function strList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
}

// ---------------------------------------------------------------------------
// Shared resolution
// ---------------------------------------------------------------------------

function modelOptionsFor(kind: 'video' | 'image'): Array<{ key: string; model: ModelDefinition }> {
  const categories: Array<ModelDefinition['category']> = kind === 'video' ? ['video'] : ['image', 'image-edit'];
  return providerModelOptions(categories).flatMap((option) => {
    const model = getModelDefinition(option.key);
    return model ? [{ key: option.key, model }] : [];
  });
}

/** Accepts a model name or a node type, case-insensitively, and says what exists when it misses. */
function resolveModel(kind: 'video' | 'image', requested: string): ModelDefinition {
  const options = modelOptionsFor(kind);
  if (options.length === 0) throw new McpToolError(`No ${kind} models are available. Connect a provider in Settings.`);

  const want = requested.trim().toLowerCase();
  if (want) {
    const match = options.find(({ key, model }) => (
      key.toLowerCase() === want || model.name.toLowerCase() === want
    )) ?? options.find(({ model }) => model.name.toLowerCase().includes(want));
    if (match) return match.model;
    const names = options.slice(0, 12).map(({ model }) => model.name).join(', ');
    throw new McpToolError(`No ${kind} model matches "${requested}". Available: ${names}.`);
  }

  const preferred = kind === 'video'
    ? options.find(({ model }) => model.name === DEFAULT_VIDEO_MODEL)
    : undefined;
  return (preferred ?? options[0]).model;
}

/** Element names to ids, reporting the ones that do not exist rather than dropping them. */
function resolveElements(state: McpHostState, names: string[]): string[] {
  if (names.length === 0) return [];
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const needle = name.replace(/^@/, '').replace(/[-_]/g, ' ').trim().toLowerCase();
    const match = state.elements.find((element) => element.name.trim().toLowerCase() === needle)
      ?? state.elements.find((element) => element.name.trim().toLowerCase().replace(/[-_]/g, ' ') === needle)
      ?? state.elements.find((element) => element.name.toLowerCase().includes(needle));
    if (match) ids.push(match.id);
    else missing.push(name);
  }
  if (missing.length > 0) {
    const known = state.elements.map((element) => element.name).join(', ') || 'none yet';
    throw new McpToolError(`No Element named ${missing.map((name) => `"${name}"`).join(', ')}. Existing Elements: ${known}.`);
  }
  return ids;
}

interface GenerationRequest {
  model: ModelDefinition;
  prompt: string;
  elementIds: string[];
  count: number;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  spaceId?: string;
  view?: string;
}

/**
 * Builds the nodes for one request and starts them.
 *
 * One generation is one node, carrying its settings in config — the same shape
 * the Studio composer produces, so these clips reuse, recreate and re-open on
 * the canvas like any other.
 */
function startGeneration(host: McpHost, request: GenerationRequest): string[] {
  const state = { ...host.getState() };
  const target = request.spaceId ? state.spaces.find(space => space.id === request.spaceId) : undefined;
  if (request.spaceId && !target) throw new McpToolError('Unknown destination Space.');
  if (target && target.id !== state.activeSpaceId) {
    state.nodes = target.nodes; state.edges = target.edges;
    host.dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: target.id });
  }
  const { model } = request;
  const promptField = promptFieldFor(model);
  if (!promptField) throw new McpToolError(`${model.name} does not take a text prompt.`);

  const config: Record<string, unknown> = {
    __studioGenerated: true,
    __studioCreatedAt: timestamp(),
    __studioOutputType: model.outputType,
    __studioPrompt: request.prompt,
    __studioPromptBody: request.prompt,
    [promptField.id]: request.prompt,
  };

  if (request.elementIds.length > 0) {
    const referenceField = referenceFieldFor(model);
    if (!referenceField) throw new McpToolError(`${model.name} does not take reference images. Pick a model that does, or drop the elements.`);
    config[referenceField.id] = { elementIds: request.elementIds, elementVariationIds: {} };
    config.__studioElementIds = request.elementIds;
    config.__studioElementNames = request.elementIds.map((id) => (
      state.elements.find((element) => element.id === id)?.name ?? ''
    ));
    config.__studioVideoMode = 'references';
  }

  // Only send a control the model actually advertises: a fixed-length model that
  // receives a duration rejects the job after the credits are committed.
  const setIfAccepted = (fieldId: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    if (!model.inputs.some((field) => field.id === fieldId)) return;
    config[fieldId] = String(value);
  };
  setIfAccepted('duration', request.durationSec);
  setIfAccepted('aspect_ratio', request.aspectRatio);
  setIfAccepted('resolution', request.resolution);

  const created: Node<WorkflowNodeData>[] = [];
  for (let index = 0; index < request.count; index += 1) {
    created.push(createWorkflowNodeFromSpec({
      nodeType: model.nodeType,
      label: model.name,
      config: {
        ...config,
        ...(request.count > 1 ? { __studioBatchIndex: index + 1, __studioBatchSize: request.count } : {}),
      },
    }, nextStudioSlot([...state.nodes, ...created])));
  }

  let nextNodes = [...state.nodes, ...created];
  let nextEdges = state.edges;
  if (request.view === 'canvas') for (const node of created) {
    const placed = placeStudioNodeOnCanvas(nextNodes, nextEdges, node.id, state.assets);
    nextNodes = placed.nodes; nextEdges = placed.edges;
  }
  host.dispatch({ type: 'SET_NODES', nodes: nextNodes });
  host.dispatch({ type: 'SET_EDGES', edges: nextEdges });
  for (const node of created) host.runNode(node.id, nextNodes, nextEdges);
  return created.map((node) => node.id);
}

function generationUrls(node: Node<WorkflowNodeData>): string[] {
  const generations = Array.isArray(node.data.generations)
    ? node.data.generations.filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    : [];
  const resultUrl = node.data.result?.url?.trim();
  if (generations.length === 0) return resultUrl ? [resultUrl] : [];
  if (resultUrl && !generations.includes(resultUrl)) return [...generations, resultUrl];
  return generations;
}

function describeGeneration(node: Node<WorkflowNodeData>) {
  const model = getModelDefinition(node.data.type);
  const urls = generationUrls(node);
  const status = node.data.result?.status === 'error'
    ? 'failed'
    : node.data.result?.status === 'running'
      ? 'running'
      : urls.length > 0 ? 'complete' : 'pending';
  const prompt = node.data.config.__studioPromptBody ?? node.data.config.__studioPrompt ?? node.data.config.prompt;
  return {
    nodeId: node.id,
    model: model?.name ?? node.data.type,
    kind: model?.outputType ?? 'video',
    status,
    url: urls[urls.length - 1] ?? null,
    prompt: typeof prompt === 'string' ? prompt : '',
    createdAt: typeof node.data.config.__studioCreatedAt === 'string' ? node.data.config.__studioCreatedAt : null,
    ...(node.data.result?.error ? { error: node.data.result.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function createMcpHandlers(host: McpHost): Record<string, McpToolHandler> {
  const state = () => host.getState();

  const handlers: Record<string, McpToolHandler> = {
    ...createEditHandlers(host),
    async cinegen_get_context() {
      const s = state();
      const director = s.director;
      const generationNodes = s.nodes.filter((node) => node.data.config.__studioGenerated || node.data.result);
      return {
        project: host.projectName ?? 'Untitled project',
        spaces: s.spaces.map((space) => ({
          id: space.id,
          name: space.name,
          nodeCount: space.nodes.length,
          active: space.id === s.activeSpaceId,
        })),
        elements: s.elements.map((element) => ({
          id: element.id,
          name: element.name,
          type: element.type,
          imageCount: element.images?.length ?? 0,
          description: element.description?.slice(0, 200) ?? '',
        })),
        timelines: s.timelines.map((timeline) => ({
          id: timeline.id,
          name: timeline.name,
          clipCount: timeline.clips.length,
          durationSec: Math.round(timeline.duration ?? 0),
        })),
        assetCount: s.assets.length,
        director: {
          hasScript: Boolean(director?.sourceText?.trim()),
          scriptChars: director?.sourceText?.length ?? 0,
          breakdownItems: director?.breakdown?.length ?? 0,
          scenes: (director?.scenes ?? []).map((scene) => ({
            id: scene.id,
            number: scene.number,
            label: scene.label,
            clipCount: (scene.clipIds ?? []).length,
          })),
          clipCount: director?.clips?.length ?? 0,
        },
        recentGenerations: generationNodes.slice(-5).reverse().map(describeGeneration),
      };
    },

    async cinegen_list_models(args) {
      const kind = str(args, 'kind') === 'image' ? 'image' : 'video';
      return {
        kind,
        models: modelOptionsFor(kind).map(({ key, model }) => ({
          name: model.name,
          nodeType: key,
          provider: modelProviderLabel(model),
          takesReferences: Boolean(referenceFieldFor(model)),
          takesFrames: Boolean(startFieldFor(model)),
          takesEndFrame: Boolean(endFieldFor(model)),
          durations: model.inputs.find((field) => field.id === 'duration')?.options?.map((option) => String(option.value)) ?? null,
          resolutions: model.inputs.find((field) => field.id === 'resolution')?.options?.map((option) => String(option.value)) ?? null,
        })),
      };
    },

    async cinegen_generate(args) {
      const prompt = str(args, 'prompt', true);
      const kind = str(args, 'kind') === 'image' ? 'image' : 'video';
      const model = resolveModel(kind, str(args, 'model'));
      const elementIds = resolveElements(state(), strList(args, 'elements'));
      const count = int(args, 'count', 1, 1, MAX_BATCH);
      const durationRaw = args.durationSec;

      const nodeIds = startGeneration(host, {
        model,
        prompt,
        elementIds,
        count,
        durationSec: typeof durationRaw === 'number' ? durationRaw : undefined,
        aspectRatio: str(args, 'aspectRatio') || undefined,
        resolution: str(args, 'resolution') || undefined,
        spaceId: str(args, 'spaceId') || undefined,
        view: str(args, 'view') || undefined,
      });

      if (args.view && host.appAction) {
        host.dispatch({ type: 'SET_TAB', tab: 'create' });
        await host.appAction('view', { view: args.view });
      }
      return {
        started: nodeIds.length,
        model: model.name,
        nodeIds,
        note: 'Generating. Call cinegen_get_generations in a minute or two for the results.',
      };
    },

    async cinegen_get_generations(args) {
      const limit = int(args, 'limit', 10, 1, 50);
      const nodes = state().nodes.filter((node) => node.data.config.__studioGenerated || node.data.result);
      return {
        generations: nodes.slice(-limit).reverse().map(describeGeneration),
      };
    },

    async cinegen_create_space(args) {
      const name = str(args, 'name', true);
      const template = (str(args, 'template') || 'multi-shot') as SpaceTemplateId;
      const prompts = strList(args, 'prompts');
      const elementIds = resolveElements(state(), strList(args, 'elements'));
      const scene = str(args, 'scene');

      const prefill: SpacePrefill = {
        ...(scene ? { scene } : {}),
        ...(prompts.length > 0 ? { prompts } : {}),
        ...(elementIds.length > 0 ? { elementIds } : {}),
      };
      const space = buildSpaceFromTemplate(name, template, prefill, state().elements);
      host.dispatch({ type: 'ADD_SPACE', space });
      host.dispatch({ type: 'SET_ACTIVE_SPACE', spaceId: space.id });
      return { spaceId: space.id, name: space.name, nodeCount: space.nodes.length, template };
    },

    async cinegen_create_element(args) {
      const name = str(args, 'name', true);
      const type = str(args, 'type') || 'character';
      if (!['character', 'location', 'prop', 'vehicle'].includes(type)) {
        throw new McpToolError(`"${type}" is not an Element type. Use character, location, prop or vehicle.`);
      }
      const imageUrl = str(args, 'imageUrl');
      const now = timestamp();
      const element: Element = {
        id: generateId(),
        name,
        type: type as Element['type'],
        description: str(args, 'description'),
        images: imageUrl ? [{ id: generateId(), url: imageUrl, createdAt: now, source: 'generated' }] : [],
        createdAt: now,
        updatedAt: now,
      };
      host.dispatch({ type: 'ADD_ELEMENT', element });
      return { elementId: element.id, name: element.name, type: element.type };
    },

    async cinegen_load_script(args) {
      const text = rawStr(args, 'text');
      const title = str(args, 'title');
      const current = state().director ?? createEmptyDirectorShow();
      const draft = { ...current, autoSync: false, breakdownApproved: false, sourceElements: undefined, sourceText: text, ...(title ? { title } : {}) };
      const parsed = localBreakdownForShow(draft);
      const director = {
        ...draft,
        breakdown: mergeBreakdownItems(current.breakdown ?? [], parsed.items, state().elements),
        scenes: mergeScenes(current.scenes ?? [], parsed.scenes),
      };
      host.dispatch({ type: 'SET_DIRECTOR', director });
      return {
        scenes: director.scenes.map((scene) => ({ id: scene.id, number: scene.number, label: scene.label, summary: scene.summary ?? '' })),
        breakdown: director.breakdown.map((item) => ({ name: item.name, kind: item.kind, description: item.description ?? '' })),
        note: 'This is the deterministic first pass. Send a better breakdown with cinegen_set_breakdown, then a shot list with cinegen_set_shotlist.',
      };
    },

    async cinegen_set_breakdown(args) {
      const raw = args.items;
      if (!Array.isArray(raw) || raw.length === 0) throw new McpToolError('"items" must be a non-empty array.');
      const incoming: DirectorBreakdownItem[] = raw.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const kind = typeof item.kind === 'string' ? item.kind : '';
        if (!name || !['character', 'location', 'prop', 'vehicle'].includes(kind)) return [];
        return [{
          id: generateId(),
          kind: kind as DirectorBreakdownItem['kind'],
          name,
          tag: name.toUpperCase().replace(/\s+/g, '-'),
          description: typeof item.description === 'string' ? item.description : '',
        }];
      });
      if (incoming.length === 0) throw new McpToolError('No usable items: each needs a name and a kind of character, location, prop or vehicle.');

      const current = state().director ?? createEmptyDirectorShow();
      const director = { ...current, breakdownApproved: false, breakdown: mergeBreakdownItems(current.breakdown ?? [], incoming, state().elements) };
      host.dispatch({ type: 'SET_DIRECTOR', director });
      return { breakdownItems: director.breakdown.length, applied: incoming.length };
    },

    async cinegen_set_shotlist(args) {
      const shotlist = str(args, 'shotlist', true);
      const current = state().director ?? createEmptyDirectorShow();
      if ((current.scenes ?? []).length === 0) {
        throw new McpToolError('Load a script first with cinegen_load_script: a shot list is imported against its scenes.');
      }
      const parsed = parseClaudeShotlistImport(shotlist, current);
      if (!parsed.ok) throw new McpToolError(`That shot list could not be read: ${parsed.errors.join(' ')}`);
      const director = applyClaudeShotlistImport(current, parsed.draft);
      host.dispatch({ type: 'SET_DIRECTOR', director });
      return {
        clips: director.clips.length,
        shots: director.clips.reduce((sum, clip) => sum + (clip.beats?.length ?? 0), 0),
        scenes: director.scenes.length,
      };
    },

    async cinegen_generate_shots(args) {
      const current = state().director ?? createEmptyDirectorShow();
      const clips = current.clips ?? [];
      if (clips.length === 0) throw new McpToolError('There is no shot list yet. Send one with cinegen_set_shotlist.');

      const wanted = strList(args, 'clipIds');
      const missing = wanted.filter(id => !clips.some(clip => clip.id === id));
      if (missing.length) throw new McpToolError(`Unknown clip IDs: ${missing.join(', ')}`);
      const limit = int(args, 'limit', 4, 1, 20);
      const selected = (wanted.length > 0
        ? clips.filter((clip) => wanted.includes(clip.id))
        : clips.filter((clip) => (clip.takes ?? []).length === 0)
      ).slice(0, limit);
      if (selected.length === 0) throw new McpToolError('No matching shots to generate. Every shot already has a take, or the ids did not match.');

      if (!host.appAction) throw new McpToolError('Director generation requires the CineGen desktop app.');
      return host.appAction('director', {
        action: 'generate', clipIds: selected.map(clip => clip.id),
        ...(str(args, 'model') ? { adapterId: str(args, 'model') } : {}),
      });
    },
  };

  return handlers;
}
