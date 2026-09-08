import { mergeLiveWorkspace } from '@/lib/cloud/merge-project-update';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowSpace, WorkspaceState, ProjectTab } from '@/types/workspace';
import type { Asset, MediaFolder } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import type { WorkflowNodeData, WorkflowRun } from '@/types/workflow';
import type { ExportJob } from '@/types/export';
import type { Element, ElementFolder } from '@/types/elements';
import type { DirectorShow } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';
import { attachElementMentionToGraph } from '@/lib/llm/prompt-elements';
import { observeProviderBalance, type ProviderBalanceObservation } from '@/lib/providers/project-usage';
import { generateId, timestamp } from '@/lib/utils/ids';
import { syncCanvasVideosToStudio } from '@/lib/studio/canvas-import';
const LAYER_DECOMPOSE_CLOUD_CONFIG_VERSION = 2;
export type WorkspaceAction =
  | { type: 'SET_TAB'; tab: ProjectTab }
  | { type: 'SET_NODES'; nodes: Node<WorkflowNodeData>[] }
  | { type: 'SET_EDGES'; edges: Edge[] }
  | { type: 'ADD_SPACE'; space: WorkflowSpace }
  | { type: 'RENAME_SPACE'; spaceId: string; name: string }
  | { type: 'REMOVE_SPACE'; spaceId: string }
  | { type: 'CLOSE_SPACE'; spaceId: string }
  | { type: 'OPEN_SPACE'; spaceId: string }
  | { type: 'SET_ACTIVE_SPACE'; spaceId: string }
  | { type: 'ADD_ASSET'; asset: Asset }
  | { type: 'UPDATE_ASSET'; asset: Partial<Asset> & { id: string } }
  | { type: 'REMOVE_ASSET'; assetId: string }
  | { type: 'REMOVE_ASSETS'; assetIds: string[] }
  | { type: 'ADD_FOLDER'; folder: MediaFolder }
  | { type: 'UPDATE_FOLDER'; folder: Partial<MediaFolder> & { id: string } }
  | { type: 'REMOVE_FOLDER'; folderId: string }
  | { type: 'SET_TIMELINE'; timelineId: string; timeline: Timeline }
  | { type: 'ADD_TIMELINE'; timeline: Timeline }
  | { type: 'REMOVE_TIMELINE'; timelineId: string }
  | { type: 'CLOSE_TIMELINE'; timelineId: string }
  | { type: 'OPEN_TIMELINE'; timelineId: string }
  | { type: 'SET_ACTIVE_TIMELINE'; timelineId: string }
  | { type: 'SET_RUN_STATUS'; run: WorkflowRun | null }
  | { type: 'SET_NODE_RUNNING'; nodeId: string; running: boolean }
  | { type: 'SET_NODE_RESULT'; nodeId: string; result: WorkflowNodeData['result'] }
  | { type: 'ADD_GENERATION'; nodeId: string; url: string }
  | { type: 'ADD_EXPORT'; exportJob: ExportJob }
  | { type: 'UPDATE_EXPORT'; exportId: string; updates: Partial<ExportJob> }
  | { type: 'ADD_ELEMENT'; element: Element }
  | { type: 'UPDATE_ELEMENT'; elementId: string; updates: Partial<Element> }
  | { type: 'REMOVE_ELEMENT'; elementId: string }
  | { type: 'REMOVE_ELEMENTS'; elementIds: string[] }
  | { type: 'MOVE_ELEMENTS'; elementIds: string[]; folderId: string | undefined }
  | { type: 'ADD_ELEMENT_FOLDER'; folder: ElementFolder }
  | { type: 'UPDATE_ELEMENT_FOLDER'; folderId: string; updates: Partial<ElementFolder> }
  | { type: 'REMOVE_ELEMENT_FOLDER'; folderId: string }
  | { type: 'SET_ELEMENTS_LIBRARY'; elements: Element[]; elementFolders: ElementFolder[] }
  | { type: 'SET_DIRECTOR'; director: DirectorShow }
  | { type: 'OBSERVE_PROVIDER_USAGE'; observation: ProviderBalanceObservation }
  | { type: 'UPDATE_NODE_CONFIG'; nodeId: string; config: Record<string, unknown> }
  | { type: 'APPLY_ELEMENT_MENTION'; nodeId: string; elementId: string; config: Record<string, unknown> }
  | { type: 'HYDRATE'; payload: HydratePayload }
  | { type: 'SYNC_CLOUD_PROJECT'; payload: HydratePayload; base?: HydratePayload }
  | { type: 'UNDO' }
  | { type: 'REDO' };

interface HydratePayload {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  spaces: WorkflowSpace[];
  activeSpaceId: string;
  openSpaceIds: string[];
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  exports: ExportJob[];
  elements: Element[];
  elementFolders: ElementFolder[];
  director: DirectorShow;
  providerUsage: WorkspaceState['providerUsage'];
}

function normalizeWorkflowNodes(nodes: Node<WorkflowNodeData>[]): Node<WorkflowNodeData>[] {
  return nodes.map((node) => {
    if (node.data.type === 'shotPrompt' || node.type === 'shotPrompt') {
      node = {
        ...node,
        type: 'multiPrompt',
        data: {
          ...node.data,
          type: 'multiPrompt',
        },
      };
    }

    if (node.data.type !== 'layer-decompose-cloud') return node;

    const configVersion = Number(node.data.config.__layerDecomposeVersion ?? 1);
    const currentMaxMasks = Number(node.data.config.max_masks ?? 12);
    const nextConfig: Record<string, unknown> = {
      ...node.data.config,
      __layerDecomposeVersion: LAYER_DECOMPOSE_CLOUD_CONFIG_VERSION,
    };

    if (configVersion < LAYER_DECOMPOSE_CLOUD_CONFIG_VERSION && currentMaxMasks === 4) {
      nextConfig.max_masks = 12;
    }

    if (
      nextConfig.max_masks === node.data.config.max_masks
      && nextConfig.__layerDecomposeVersion === node.data.config.__layerDecomposeVersion
    ) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        config: nextConfig,
      },
    };
  });
}

export function sanitizeWorkflowNodes(nodes: Node<WorkflowNodeData>[]): Node<WorkflowNodeData>[] {
  return nodes.map((node) => ({
    ...node,
    selected: undefined,
    dragging: undefined,
  }));
}

export function createWorkflowSpace(name: string, nodes: Node<WorkflowNodeData>[] = [], edges: Edge[] = []): WorkflowSpace {
  return {
    id: generateId(),
    name,
    createdAt: timestamp(),
    nodes: normalizeWorkflowNodes(nodes),
    edges,
  };
}

function normalizeWorkflowSpaces(
  spaces: WorkflowSpace[],
  fallbackNodes: Node<WorkflowNodeData>[],
  fallbackEdges: Edge[],
): WorkflowSpace[] {
  if (spaces.length > 0) {
    return spaces.map((space) => ({
      ...space,
      createdAt: space.createdAt || timestamp(),
      nodes: normalizeWorkflowNodes(space.nodes ?? []),
      edges: space.edges ?? [],
    }));
  }
  return [createWorkflowSpace('Space 1', fallbackNodes, fallbackEdges)];
}

function updateActiveSpace(
  spaces: WorkflowSpace[],
  activeSpaceId: string,
  patch: Partial<Pick<WorkflowSpace, 'nodes' | 'edges' | 'name'>>,
): WorkflowSpace[] {
  return spaces.map((space) => (
    space.id === activeSpaceId
      ? { ...space, ...patch }
      : space
  ));
}

function resolveActiveSpace(
  spaces: WorkflowSpace[],
  activeSpaceId: string,
): WorkflowSpace {
  return spaces.find((space) => space.id === activeSpaceId) ?? spaces[0];
}

/* ------------------------------------------------------------------
   Reducer
   ------------------------------------------------------------------ */

const TAB_STORAGE_KEY = 'cinegen_active_tab';
const VALID_TABS = new Set(['elements', 'create', 'director', 'edit', 'llm', 'export']);

export function createInitialWorkspaceState(): WorkspaceState {
const defaultTimeline = createDefaultTimeline('Timeline 1');
const defaultSpace = createWorkflowSpace('Space 1');

return {
  activeTab: (() => {
    try {
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      if (saved && VALID_TABS.has(saved)) return saved as WorkspaceState['activeTab'];
    } catch {}
    return 'create';
  })(),
  nodes: defaultSpace.nodes,
  edges: defaultSpace.edges,
  spaces: [defaultSpace],
  activeSpaceId: defaultSpace.id,
  openSpaceIds: new Set([defaultSpace.id]),
  assets: [],
  mediaFolders: [],
  timelines: [defaultTimeline],
  activeTimelineId: defaultTimeline.id,
  openTimelineIds: new Set([defaultTimeline.id]),
  currentRun: null,
  runningNodeIds: new Set(),
  exports: [],
  elements: [],
  elementFolders: [],
  director: createEmptyDirectorShow(),
  providerUsage: {},
};

}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SYNC_CLOUD_PROJECT': {
      const remote = workspaceReducer(state, { type: 'HYDRATE', payload: action.payload });
      if (!action.base) return remote;
      const base = workspaceReducer(state, { type: 'HYDRATE', payload: action.base });
      const merged = mergeLiveWorkspace(base, state, remote);
      return workspaceReducer(state, { type: 'HYDRATE', payload: { ...action.payload, ...merged, openSpaceIds: [...merged.openSpaceIds] } });
    }
    case 'SET_TAB':
      try { localStorage.setItem(TAB_STORAGE_KEY, action.tab); } catch {}
      return { ...state, activeTab: action.tab };

    case 'SET_NODES': {
      const nodes = syncCanvasVideosToStudio(action.nodes, timestamp());
      return {
        ...state,
        nodes,
        spaces: updateActiveSpace(state.spaces, state.activeSpaceId, { nodes }),
      };
    }

    case 'UPDATE_NODE_CONFIG': {
      const nodes = syncCanvasVideosToStudio(state.nodes.map((n) =>
        n.id === action.nodeId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...action.config } } }
          : n,
      ), timestamp());
      return {
        ...state,
        nodes,
        spaces: updateActiveSpace(state.spaces, state.activeSpaceId, { nodes }),
      };
    }

    case 'APPLY_ELEMENT_MENTION': {
      const updatedNodes = state.nodes.map((node) => (
        node.id === action.nodeId
          ? { ...node, data: { ...node.data, config: { ...node.data.config, ...action.config } } }
          : node
      ));
      const bound = attachElementMentionToGraph({
        nodes: updatedNodes,
        edges: state.edges,
        promptNodeId: action.nodeId,
        elementId: action.elementId,
      });
      return {
        ...state,
        nodes: bound.nodes,
        edges: bound.edges,
        spaces: updateActiveSpace(state.spaces, state.activeSpaceId, {
          nodes: bound.nodes,
          edges: bound.edges,
        }),
      };
    }

    case 'SET_EDGES':
      return {
        ...state,
        edges: action.edges,
        spaces: updateActiveSpace(state.spaces, state.activeSpaceId, { edges: action.edges }),
      };

    case 'ADD_SPACE': {
      const openSpaceIds = new Set(state.openSpaceIds);
      openSpaceIds.add(action.space.id);
      return {
        ...state,
        spaces: [...state.spaces, action.space],
        activeSpaceId: action.space.id,
        openSpaceIds,
        nodes: action.space.nodes,
        edges: action.space.edges,
      };
    }

    case 'RENAME_SPACE': {
      return {
        ...state,
        spaces: state.spaces.map((space) =>
          space.id === action.spaceId ? { ...space, name: action.name } : space,
        ),
      };
    }

    case 'REMOVE_SPACE': {
      if (state.spaces.length <= 1) return state;
      const spaces = state.spaces.filter((space) => space.id !== action.spaceId);
      const nextActiveSpace = resolveActiveSpace(
        spaces,
        state.activeSpaceId === action.spaceId ? spaces[0]?.id ?? '' : state.activeSpaceId,
      );
      const openSpaceIds = new Set(state.openSpaceIds);
      openSpaceIds.delete(action.spaceId);
      if (!openSpaceIds.has(nextActiveSpace.id)) {
        openSpaceIds.add(nextActiveSpace.id);
      }
      return {
        ...state,
        spaces,
        activeSpaceId: nextActiveSpace.id,
        openSpaceIds,
        nodes: nextActiveSpace.nodes,
        edges: nextActiveSpace.edges,
      };
    }

    case 'CLOSE_SPACE': {
      const openSpaceIds = new Set(state.openSpaceIds);
      openSpaceIds.delete(action.spaceId);
      if (openSpaceIds.size === 0) {
        const fallback = state.spaces.find((space) => space.id !== action.spaceId) ?? state.spaces[0];
        if (fallback) openSpaceIds.add(fallback.id);
      }
      if (state.activeSpaceId !== action.spaceId) {
        return { ...state, openSpaceIds };
      }
      const nextActiveId = [...openSpaceIds][0] ?? state.spaces[0]?.id ?? state.activeSpaceId;
      const nextActiveSpace = resolveActiveSpace(state.spaces, nextActiveId);
      return {
        ...state,
        openSpaceIds,
        activeSpaceId: nextActiveSpace.id,
        nodes: nextActiveSpace.nodes,
        edges: nextActiveSpace.edges,
      };
    }

    case 'OPEN_SPACE': {
      const openSpaceIds = new Set(state.openSpaceIds);
      openSpaceIds.add(action.spaceId);
      const nextActiveSpace = resolveActiveSpace(state.spaces, action.spaceId);
      return {
        ...state,
        openSpaceIds,
        activeSpaceId: nextActiveSpace.id,
        nodes: nextActiveSpace.nodes,
        edges: nextActiveSpace.edges,
      };
    }

    case 'SET_ACTIVE_SPACE': {
      const openSpaceIds = new Set(state.openSpaceIds);
      openSpaceIds.add(action.spaceId);
      const nextActiveSpace = resolveActiveSpace(state.spaces, action.spaceId);
      return {
        ...state,
        openSpaceIds,
        activeSpaceId: nextActiveSpace.id,
        nodes: nextActiveSpace.nodes,
        edges: nextActiveSpace.edges,
      };
    }

    case 'ADD_ASSET':
      // A live request and its recovery poll can finish together. The same paid
      // take keeps one asset ID, so do not insert it twice.
      if (state.assets.some(asset => asset.id === action.asset.id)) return state;
      return { ...state, assets: [...state.assets, action.asset] };

    case 'UPDATE_ASSET':
      return { ...state, assets: state.assets.map((a) => {
        if (a.id !== action.asset.id) return a;
        const updated = { ...a, ...action.asset };
        // Deep-merge metadata so partial updates don't clobber existing keys
        if (action.asset.metadata && a.metadata) {
          updated.metadata = { ...a.metadata, ...action.asset.metadata };
        }
        return updated;
      }) };

    case 'REMOVE_ASSET':
      return { ...state, assets: state.assets.filter((a) => a.id !== action.assetId) };

    case 'REMOVE_ASSETS': {
      const removeSet = new Set(action.assetIds);
      return { ...state, assets: state.assets.filter((a) => !removeSet.has(a.id)) };
    }

    case 'ADD_FOLDER':
      return { ...state, mediaFolders: [...state.mediaFolders, action.folder] };

    case 'UPDATE_FOLDER':
      return { ...state, mediaFolders: state.mediaFolders.map((f) => f.id === action.folder.id ? { ...f, ...action.folder } : f) };

    case 'REMOVE_FOLDER':
      return {
        ...state,
        mediaFolders: state.mediaFolders.filter((f) => f.id !== action.folderId),
        assets: state.assets.map((a) => a.folderId === action.folderId ? { ...a, folderId: undefined } : a),
      };

    case 'SET_TIMELINE':
      return {
        ...state,
        timelines: state.timelines.map((tl) =>
          tl.id === action.timelineId ? action.timeline : tl,
        ),
      };

    case 'ADD_TIMELINE': {
      const openWithNew = new Set(state.openTimelineIds);
      openWithNew.add(action.timeline.id);
      return {
        ...state,
        timelines: [...state.timelines, action.timeline],
        activeTimelineId: action.timeline.id,
        openTimelineIds: openWithNew,
      };
    }

    case 'REMOVE_TIMELINE': {
      if (state.timelines.length <= 1) return state;
      const filtered = state.timelines.filter((tl) => tl.id !== action.timelineId);
      const nextOpen = new Set(state.openTimelineIds);
      nextOpen.delete(action.timelineId);
      return {
        ...state,
        timelines: filtered,
        openTimelineIds: nextOpen,
        activeTimelineId: state.activeTimelineId === action.timelineId
          ? filtered[0].id
          : state.activeTimelineId,
      };
    }

    case 'CLOSE_TIMELINE': {
      const open = new Set(state.openTimelineIds);
      open.delete(action.timelineId);
      if (open.size === 0) {
        // Always keep at least one tab open — pick the first timeline
        const fallback = state.timelines[0];
        if (fallback) open.add(fallback.id);
      }
      const newActive = state.activeTimelineId === action.timelineId
        ? [...open][0] ?? state.timelines[0]?.id ?? state.activeTimelineId
        : state.activeTimelineId;
      return { ...state, openTimelineIds: open, activeTimelineId: newActive };
    }

    case 'OPEN_TIMELINE': {
      const open = new Set(state.openTimelineIds);
      open.add(action.timelineId);
      return { ...state, openTimelineIds: open, activeTimelineId: action.timelineId };
    }

    case 'SET_ACTIVE_TIMELINE':
      return { ...state, activeTimelineId: action.timelineId };

    case 'SET_RUN_STATUS':
      return { ...state, currentRun: action.run };

    case 'SET_NODE_RUNNING': {
      const next = new Set(state.runningNodeIds);
      action.running ? next.add(action.nodeId) : next.delete(action.nodeId);
      return { ...state, runningNodeIds: next };
    }

    case 'SET_NODE_RESULT':
    case 'ADD_GENERATION': {
      const update = (nodes: Node<WorkflowNodeData>[]) => syncCanvasVideosToStudio(nodes.map(node => {
        if (node.id !== action.nodeId) return node;
        if (action.type === 'SET_NODE_RESULT') return { ...node, data: { ...node.data, result: action.result } };
        const generations = [...((node.data.generations as string[]) ?? []), action.url];
        return { ...node, data: { ...node.data, generations, activeGeneration: generations.length - 1 } };
      }), timestamp());
      // Jobs can finish after the user or MCP switches Spaces. Keep the result
      // with its original node instead of dropping it from the active canvas.
      const nodes = update(state.nodes);
      return { ...state, nodes, spaces: state.spaces.map(space => ({ ...space, nodes: space.id === state.activeSpaceId ? nodes : update(space.nodes) })) };
    }

    case 'ADD_EXPORT':
      return { ...state, exports: [...state.exports, action.exportJob] };

    case 'UPDATE_EXPORT':
      return {
        ...state,
        exports: state.exports.map((e) =>
          e.id === action.exportId ? { ...e, ...action.updates } : e,
        ),
      };

    case 'ADD_ELEMENT':
      return { ...state, elements: [...state.elements, action.element] };

    case 'UPDATE_ELEMENT':
      return {
        ...state,
        elements: state.elements.map((el) =>
          el.id === action.elementId ? { ...el, ...action.updates, updatedAt: new Date().toISOString() } : el,
        ),
      };

    case 'REMOVE_ELEMENT':
      return { ...state, elements: state.elements.filter((el) => el.id !== action.elementId) };

    case 'REMOVE_ELEMENTS': {
      const removeSet = new Set(action.elementIds);
      return { ...state, elements: state.elements.filter((el) => !removeSet.has(el.id)) };
    }

    case 'MOVE_ELEMENTS': {
      const idSet = new Set(action.elementIds);
      const now = new Date().toISOString();
      return {
        ...state,
        elements: state.elements.map((el) => (
          idSet.has(el.id) ? { ...el, folderId: action.folderId, updatedAt: now } : el
        )),
      };
    }

    case 'ADD_ELEMENT_FOLDER':
      return { ...state, elementFolders: [...state.elementFolders, action.folder] };

    case 'UPDATE_ELEMENT_FOLDER':
      return {
        ...state,
        elementFolders: state.elementFolders.map((f) => (
          f.id === action.folderId ? { ...f, ...action.updates } : f
        )),
      };

    case 'REMOVE_ELEMENT_FOLDER':
      return {
        ...state,
        elementFolders: state.elementFolders.filter((f) => f.id !== action.folderId),
        elements: state.elements.map((el) => (
          el.folderId === action.folderId ? { ...el, folderId: undefined } : el
        )),
      };

    case 'SET_ELEMENTS_LIBRARY':
      return {
        ...state,
        elements: action.elements,
        elementFolders: action.elementFolders,
      };

    case 'SET_DIRECTOR':
      return { ...state, director: action.director };

    case 'OBSERVE_PROVIDER_USAGE': {
      const providerUsage = observeProviderBalance(state.providerUsage, action.observation);
      return providerUsage === state.providerUsage ? state : { ...state, providerUsage };
    }

    case 'HYDRATE': {
      const hydratedTimelines = action.payload.timelines;
      const hydratedSpaces = normalizeWorkflowSpaces(action.payload.spaces, action.payload.nodes, action.payload.edges);
      const activeSpace = resolveActiveSpace(hydratedSpaces, action.payload.activeSpaceId);
      const openSpaceIds = new Set(
        action.payload.openSpaceIds.filter((spaceId) => hydratedSpaces.some((space) => space.id === spaceId)),
      );
      if (openSpaceIds.size === 0) {
        openSpaceIds.add(activeSpace.id);
      }
      return {
        ...state,
        nodes: activeSpace.nodes,
        edges: activeSpace.edges,
        spaces: hydratedSpaces,
        activeSpaceId: activeSpace.id,
        openSpaceIds,
        assets: action.payload.assets,
        mediaFolders: action.payload.mediaFolders,
        timelines: hydratedTimelines,
        activeTimelineId: action.payload.activeTimelineId,
        openTimelineIds: new Set(hydratedTimelines.map((tl: { id: string }) => tl.id)),
        exports: action.payload.exports,
        elements: action.payload.elements,
        elementFolders: action.payload.elementFolders ?? [],
        director: action.payload.director,
        providerUsage: action.payload.providerUsage,
      };
    }

    default:
      return state;
  }
}
