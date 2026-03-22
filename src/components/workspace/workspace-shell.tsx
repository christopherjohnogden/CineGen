
import { createContext, useContext, useReducer, useEffect, useRef, useCallback, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowSpace, WorkspaceState } from '@/types/workspace';
import type { ProjectTab } from '@/types/workspace';
import type { Asset, MediaFolder } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import type { WorkflowNodeData, WorkflowRun } from '@/types/workflow';
import type { ExportJob } from '@/types/export';
import type { Element } from '@/types/elements';
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';
import { migrateSequenceToTimelines } from '@/lib/editor/timeline-migration';
import { TopTabs } from './top-tabs';
import { ElementsTab } from '@/components/elements/elements-tab';
import { CreateTab } from '@/components/create/create-tab';
import { EditTab } from '@/components/edit/edit-tab';
import { LLMTab } from '@/components/llm/llm-tab';
import { ExportTab } from '@/components/export/export-tab';
import { SettingsPage } from '@/components/settings/settings-page';
import {
  assetFromRow,
  folderFromRow,
  timelineFromRows,
  elementFromRow,
  exportFromRow,
  assetToRow,
  trackToRow,
  clipToRow,
  transitionToRow,
} from '@/lib/db-converters';
import { mediaDebug, mediaDebugError } from '@/lib/debug/media-debug';
import { generateId, timestamp } from '@/lib/utils/ids';
import {
  getApiKey,
  getAutoVisualIndexingEnabled,
  getBackgroundVisionModel,
  getMaxConcurrentVisionJobs,
} from '@/lib/utils/api-key';

/* ------------------------------------------------------------------
   Actions
   ------------------------------------------------------------------ */

type WorkspaceAction =
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
  | { type: 'UPDATE_NODE_CONFIG'; nodeId: string; config: Record<string, unknown> }
  | { type: 'HYDRATE'; payload: HydratePayload }
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
}

interface LlmJumpRequest {
  id: string;
  type: 'asset' | 'timeline';
  time: number;
  assetId?: string;
  timelineId?: string;
}

interface TimelineMomentMatch {
  timelineId: string;
  timelineTime: number;
}

type VisualIndexState = 'queued' | 'analyzing' | 'ready' | 'failed' | 'missing';

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

export function getActiveTimeline(state: WorkspaceState): Timeline {
  return state.timelines.find((tl) => tl.id === state.activeTimelineId) ?? state.timelines[0];
}

const PROXY_CODEC_HINTS = ['prores', 'dnxhr', 'dnxhd', 'cfhd', 'cineform', 'rawvideo'];
const PROXY_SIZE_THRESHOLD_BYTES = 1_000_000_000;
const LAYER_DECOMPOSE_CLOUD_CONFIG_VERSION = 2;

function shouldGenerateProxyForAsset(asset: Pick<Asset, 'type' | 'width' | 'codec' | 'fileSize'>): boolean {
  if (asset.type !== 'video') return false;
  if ((asset.fileSize ?? 0) >= PROXY_SIZE_THRESHOLD_BYTES) return true;
  if ((asset.width ?? 0) > 1920) return true;
  const codec = (asset.codec ?? '').toLowerCase();
  return PROXY_CODEC_HINTS.some((hint) => codec.includes(hint));
}

function getAssetVisualIndexState(asset: Asset): VisualIndexState | undefined {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const explicit = metadata.llmVisualSummaryStatus;
  if (explicit === 'queued' || explicit === 'analyzing' || explicit === 'ready' || explicit === 'failed' || explicit === 'missing') {
    return explicit;
  }
  const summary = metadata.llmVisualSummary;
  if (!summary || typeof summary !== 'object') return undefined;
  const status = (summary as Record<string, unknown>).status;
  return status === 'queued' || status === 'analyzing' || status === 'ready' || status === 'failed' || status === 'missing'
    ? status
    : undefined;
}

function buildVisualFramePaths(asset: Asset): string[] {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const framePaths = Array.isArray(metadata.filmstrip)
    ? metadata.filmstrip.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const filmstripSprite = typeof metadata.filmstripUrl === 'string' && metadata.filmstripUrl.trim()
    ? metadata.filmstripUrl.trim()
    : undefined;
  const thumbnail = typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl.trim()
    ? asset.thumbnailUrl.trim()
    : undefined;
  const imageSource = asset.type === 'image' && typeof asset.fileRef === 'string' && asset.fileRef.trim()
    ? asset.fileRef.trim()
    : undefined;
  return [...new Set([
    ...framePaths,
    ...(filmstripSprite ? [filmstripSprite] : []),
    ...(thumbnail ? [thumbnail] : []),
    ...(imageSource ? [imageSource] : []),
  ])].slice(0, 6);
}

function findTimelineMomentForAssetSource(params: {
  assetId: string;
  sourceTime: number;
  timelines: Timeline[];
  activeTimelineId: string;
}): TimelineMomentMatch | null {
  const { assetId, sourceTime, timelines, activeTimelineId } = params;
  const epsilon = 0.05;

  const matchingClips = timelines.flatMap((timeline) => (
    timeline.clips.flatMap((clip): Array<{ timelineId: string; clip: Clip; timelineIndex: number }> => {
      if (clip.assetId !== assetId) return [];
      const sourceStart = clip.trimStart;
      const sourceEnd = Math.max(sourceStart, clip.duration - clip.trimEnd);
      if (sourceTime < sourceStart - epsilon || sourceTime > sourceEnd + epsilon) return [];
      return [{
        timelineId: timeline.id,
        clip,
        timelineIndex: timelines.findIndex((entry) => entry.id === timeline.id),
      }];
    })
  ));

  if (matchingClips.length === 0) return null;

  matchingClips.sort((a, b) => {
    const aActive = a.timelineId === activeTimelineId ? 1 : 0;
    const bActive = b.timelineId === activeTimelineId ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (a.timelineIndex !== b.timelineIndex) return a.timelineIndex - b.timelineIndex;
    return a.clip.startTime - b.clip.startTime;
  });

  const best = matchingClips[0];
  return {
    timelineId: best.timelineId,
    timelineTime: Math.max(0, best.clip.startTime + ((sourceTime - best.clip.trimStart) / Math.max(0.0001, best.clip.speed))),
  };
}

function normalizeWorkflowNodes(nodes: Node<WorkflowNodeData>[]): Node<WorkflowNodeData>[] {
  return nodes.map((node) => {
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

function sanitizeWorkflowNodes(nodes: Node<WorkflowNodeData>[]): Node<WorkflowNodeData>[] {
  return nodes.map((node) => ({
    ...node,
    selected: undefined,
    dragging: undefined,
  }));
}

function createWorkflowSpace(name: string, nodes: Node<WorkflowNodeData>[] = [], edges: Edge[] = []): WorkflowSpace {
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
const VALID_TABS = new Set(['elements', 'create', 'edit', 'llm', 'export']);

const defaultTimeline = createDefaultTimeline('Timeline 1');
const defaultSpace = createWorkflowSpace('Space 1');

const initialState: WorkspaceState = {
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
};

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SET_TAB':
      try { localStorage.setItem(TAB_STORAGE_KEY, action.tab); } catch {}
      return { ...state, activeTab: action.tab };

    case 'SET_NODES':
      return {
        ...state,
        nodes: action.nodes,
        spaces: updateActiveSpace(state.spaces, state.activeSpaceId, { nodes: action.nodes }),
      };

    case 'UPDATE_NODE_CONFIG':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId
            ? { ...n, data: { ...n.data, config: { ...n.data.config, ...action.config } } }
            : n,
        ),
        spaces: updateActiveSpace(
          state.spaces,
          state.activeSpaceId,
          {
            nodes: state.nodes.map((n) =>
              n.id === action.nodeId
                ? { ...n, data: { ...n.data, config: { ...n.data.config, ...action.config } } }
                : n,
            ),
          },
        ),
      };

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
      {
        const nodes = state.nodes.map((n) =>
          n.id === action.nodeId ? { ...n, data: { ...n.data, result: action.result } } : n,
        );
        return {
          ...state,
          nodes,
          spaces: updateActiveSpace(state.spaces, state.activeSpaceId, { nodes }),
        };
      }

    case 'ADD_GENERATION':
      {
        const nodes = state.nodes.map((n) => {
          if (n.id !== action.nodeId) return n;
          const prev = (n.data.generations as string[]) ?? [];
          const gens = [...prev, action.url];
          return { ...n, data: { ...n.data, generations: gens, activeGeneration: gens.length - 1 } };
        });
        return {
          ...state,
          nodes,
          spaces: updateActiveSpace(state.spaces, state.activeSpaceId, { nodes }),
        };
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
      };
    }

    default:
      return state;
  }
}

/* ------------------------------------------------------------------
   Undo / Redo History
   ------------------------------------------------------------------ */

const MAX_HISTORY = 50;
const UNDOABLE_ACTIONS: WorkspaceAction['type'][] = [
  'SET_NODES', 'SET_EDGES', 'UPDATE_NODE_CONFIG',
  'ADD_SPACE', 'RENAME_SPACE', 'REMOVE_SPACE', 'CLOSE_SPACE', 'OPEN_SPACE', 'SET_ACTIVE_SPACE',
  'ADD_ASSET', 'UPDATE_ASSET', 'REMOVE_ASSET', 'REMOVE_ASSETS',
  'ADD_FOLDER', 'UPDATE_FOLDER', 'REMOVE_FOLDER',
  'SET_TIMELINE', 'ADD_TIMELINE', 'REMOVE_TIMELINE', 'CLOSE_TIMELINE', 'OPEN_TIMELINE',
  'ADD_ELEMENT', 'UPDATE_ELEMENT', 'REMOVE_ELEMENT',
];

interface HistoryState {
  current: WorkspaceState;
  past: WorkspaceState[];
  future: WorkspaceState[];
  /** Timestamp of last undoable push — used to debounce rapid SET_NODES (drag) */
  lastPushTime: number;
  lastPushType: WorkspaceAction['type'] | null;
}

const DRAG_DEBOUNCE_MS = 300;

function historyReducer(history: HistoryState, action: WorkspaceAction): HistoryState {
  if (action.type === 'UNDO') {
    if (history.past.length === 0) return history;
    const prev = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      current: {
        ...prev,
        activeTab: history.current.activeTab,
        runningNodeIds: history.current.runningNodeIds,
        currentRun: history.current.currentRun,
      },
      future: [history.current, ...history.future].slice(0, MAX_HISTORY),
      lastPushTime: history.lastPushTime,
      lastPushType: history.lastPushType,
    };
  }

  if (action.type === 'REDO') {
    if (history.future.length === 0) return history;
    const next = history.future[0];
    return {
      past: [...history.past, history.current].slice(-MAX_HISTORY),
      current: {
        ...next,
        activeTab: history.current.activeTab,
        runningNodeIds: history.current.runningNodeIds,
        currentRun: history.current.currentRun,
      },
      future: history.future.slice(1),
      lastPushTime: history.lastPushTime,
      lastPushType: history.lastPushType,
    };
  }

  const next = workspaceReducer(history.current, action);

  if (UNDOABLE_ACTIONS.includes(action.type)) {
    const now = Date.now();
    // Debounce rapid dispatches during drag operations (node dragging, clip move/trim/roll)
    const isDrag =
      (action.type === 'SET_NODES' && history.lastPushType === 'SET_NODES' && now - history.lastPushTime < DRAG_DEBOUNCE_MS) ||
      (action.type === 'SET_TIMELINE' && history.lastPushType === 'SET_TIMELINE' && now - history.lastPushTime < DRAG_DEBOUNCE_MS);

    if (isDrag) {
      // Replace the current state without pushing to undo stack
      return { ...history, current: next };
    }

    return {
      past: [...history.past, history.current].slice(-MAX_HISTORY),
      current: next,
      future: [],
      lastPushTime: now,
      lastPushType: action.type,
    };
  }

  return { ...history, current: next };
}

/* ------------------------------------------------------------------
   Context
   ------------------------------------------------------------------ */

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
  projectId: string;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceShell');
  return ctx;
}

/* ------------------------------------------------------------------
   Persistence hooks
   ------------------------------------------------------------------ */

const SAVE_DEBOUNCE_MS = 500;
const STALE_DERIVE_JOB_MS = 15000;
const DERIVE_JOB_TYPES = ['generate_thumbnail', 'compute_waveform', 'generate_filmstrip', 'generate_proxy'] as const;
const PERSIST_ACTIONS: WorkspaceAction['type'][] = [
  'SET_NODES', 'SET_EDGES', 'UPDATE_NODE_CONFIG', 'ADD_SPACE', 'RENAME_SPACE', 'REMOVE_SPACE', 'CLOSE_SPACE', 'OPEN_SPACE', 'SET_ACTIVE_SPACE',
  'ADD_ASSET', 'UPDATE_ASSET', 'REMOVE_ASSET', 'REMOVE_ASSETS',
  'ADD_FOLDER', 'UPDATE_FOLDER', 'REMOVE_FOLDER',
  'SET_TIMELINE', 'ADD_TIMELINE', 'REMOVE_TIMELINE', 'CLOSE_TIMELINE', 'OPEN_TIMELINE', 'SET_ACTIVE_TIMELINE',
  'SET_NODE_RESULT', 'ADD_GENERATION', 'ADD_EXPORT', 'UPDATE_EXPORT',
  'ADD_ELEMENT', 'UPDATE_ELEMENT', 'REMOVE_ELEMENT',
  'UNDO', 'REDO',
];

/* ------------------------------------------------------------------
   Shell Component
   ------------------------------------------------------------------ */

export function WorkspaceShell({ projectId, useSqlite = false, onBackToHome }: { projectId: string; useSqlite?: boolean; onBackToHome: () => void }) {
  const [history, historyDispatch] = useReducer(historyReducer, {
    current: initialState,
    past: [],
    future: [],
    lastPushTime: 0,
    lastPushType: null,
  });
  const state = history.current;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);
  const lastActionRef = useRef<WorkspaceAction['type'] | null>(null);
  const projectNameRef = useRef('Project');
  const initialAssetIdsRef = useRef<Set<string> | null>(null);
  const visionInFlightRef = useRef<Set<string>>(new Set());
  const assetsRef = useRef(state.assets);
  assetsRef.current = state.assets;
  const timelinesRef = useRef(state.timelines);
  timelinesRef.current = state.timelines;
  const pendingMediaEventsRef = useRef(new Map<string, Array<{ jobType?: string; result: unknown }>>());
  const deriveRetryCountsRef = useRef(new Map<string, number>());
  const deriveInFlightRef = useRef(new Set<string>());
  const [llmJumpRequest, setLlmJumpRequest] = useState<LlmJumpRequest | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [hydrationComplete, setHydrationComplete] = useState(false);

  const wrappedDispatch = useCallback((action: WorkspaceAction) => {
    lastActionRef.current = action.type;
    historyDispatch(action);
  }, []);

  useEffect(() => {
    function handleSettingsChanged() {
      setSettingsVersion((value) => value + 1);
    }
    window.addEventListener('cinegen:settings-changed', handleSettingsChanged);
    return () => window.removeEventListener('cinegen:settings-changed', handleSettingsChanged);
  }, []);

  const handleCreateTimelineFromLlm = useCallback((timeline: Timeline) => {
    wrappedDispatch({ type: 'ADD_TIMELINE', timeline });
    wrappedDispatch({ type: 'SET_TAB', tab: 'edit' });
  }, [wrappedDispatch]);

  const handleOpenTimelineFromLlm = useCallback((timelineId: string) => {
    const exists = timelinesRef.current.some((timeline) => timeline.id === timelineId);
    if (!exists) return;
    wrappedDispatch({ type: 'SET_ACTIVE_TIMELINE', timelineId });
    wrappedDispatch({ type: 'SET_TAB', tab: 'edit' });
  }, [wrappedDispatch]);

  const handleNavigateToAssetCitation = useCallback((assetId: string, time: number) => {
    const timelineMatch = findTimelineMomentForAssetSource({
      assetId,
      sourceTime: time,
      timelines: timelinesRef.current,
      activeTimelineId: history.current.activeTimelineId,
    });

    if (timelineMatch) {
      setLlmJumpRequest({
        id: `llm-jump-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'timeline',
        timelineId: timelineMatch.timelineId,
        time: timelineMatch.timelineTime,
      });
      wrappedDispatch({ type: 'SET_ACTIVE_TIMELINE', timelineId: timelineMatch.timelineId });
      wrappedDispatch({ type: 'SET_TAB', tab: 'edit' });
      return;
    }

    setLlmJumpRequest({
      id: `llm-jump-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'asset',
      assetId,
      time,
    });
    wrappedDispatch({ type: 'SET_TAB', tab: 'edit' });
  }, [history.current.activeTimelineId, wrappedDispatch]);

  const handleNavigateToTimelineCitation = useCallback((timelineId: string, time: number) => {
    const exists = timelinesRef.current.some((timeline) => timeline.id === timelineId);
    if (!exists) return;
    setLlmJumpRequest({
      id: `llm-jump-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'timeline',
      timelineId,
      time,
    });
    wrappedDispatch({ type: 'SET_ACTIVE_TIMELINE', timelineId });
    wrappedDispatch({ type: 'SET_TAB', tab: 'edit' });
  }, [wrappedDispatch]);

  const handleUpdateAssetAnalysis = useCallback((assetId: string, metadata: Record<string, unknown>) => {
    wrappedDispatch({
      type: 'UPDATE_ASSET',
      asset: {
        id: assetId,
        metadata,
      },
    });
  }, [wrappedDispatch]);

  useEffect(() => {
    if (!hydrationComplete || initialAssetIdsRef.current !== null) return;
    initialAssetIdsRef.current = new Set(state.assets.map((asset) => asset.id));
  }, [hydrationComplete, state.assets]);

  const updateAssetProcessingJobs = useCallback((assetId: string, updater: (jobs: Set<string>) => void) => {
    const asset = assetsRef.current.find((entry) => entry.id === assetId);
    if (!asset) return;
    const currentJobs = Array.isArray(asset.metadata?.processingJobs)
      ? (asset.metadata.processingJobs as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    const nextJobs = new Set(currentJobs);
    updater(nextJobs);
    const next = [...nextJobs];
    const unchanged = currentJobs.length === next.length && currentJobs.every((job, index) => job === next[index]);
    if (unchanged) return;
    wrappedDispatch({
      type: 'UPDATE_ASSET',
      asset: { id: assetId, metadata: { processingJobs: next } },
    });
  }, [wrappedDispatch]);

  const isDeriveJobType = useCallback((jobType: string | undefined): jobType is typeof DERIVE_JOB_TYPES[number] => (
    Boolean(jobType && DERIVE_JOB_TYPES.includes(jobType as typeof DERIVE_JOB_TYPES[number]))
  ), []);

  // Cmd+Z / Cmd+Shift+Z
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      historyDispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const applyMediaJobResult = useCallback((assetId: string, jobType: string | undefined, result: unknown) => {
    if (jobType) {
      updateAssetProcessingJobs(assetId, (jobs) => {
        jobs.delete(jobType);
      });
    }

    if (jobType === 'extract_metadata') {
      const meta = result as {
        duration?: number; width?: number; height?: number;
        fps?: number; codec?: string; fileSize?: number;
      } | undefined;
      if (!meta) return;

      wrappedDispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: assetId,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          codec: meta.codec,
          fileSize: meta.fileSize,
          status: 'online' as const,
        },
      });

      // Fix clips that were created with the 5s default before metadata arrived
      if (meta.duration && meta.duration !== 5) {
        const currentTimelines = timelinesRef.current;
        for (const tl of currentTimelines) {
          const affectedClips = tl.clips.filter(
            (c) => c.assetId === assetId && c.duration === 5,
          );
          if (affectedClips.length > 0) {
            const updatedClips = tl.clips.map((c) =>
              c.assetId === assetId && c.duration === 5
                ? { ...c, duration: meta.duration! }
                : c,
            );
            wrappedDispatch({
              type: 'SET_TIMELINE',
              timelineId: tl.id,
              timeline: { ...tl, clips: updatedClips },
            });
          }
        }
      }
      return;
    }

    if (jobType === 'generate_thumbnail') {
      const thumbResult = result as { outputPath?: string } | undefined;
      if (!thumbResult?.outputPath) return;
      wrappedDispatch({
        type: 'UPDATE_ASSET',
        asset: { id: assetId, thumbnailUrl: thumbResult.outputPath },
      });
      return;
    }

    if (jobType === 'compute_waveform') {
      const waveResult = result as { peaks?: number[]; peaksPath?: string } | undefined;
      if (!waveResult?.peaks) return;
      const waveformMeta: Record<string, unknown> = { waveform: waveResult.peaks };
      if (waveResult.peaksPath) {
        waveformMeta.waveformPath = waveResult.peaksPath;
      }
      wrappedDispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: assetId,
          metadata: waveformMeta,
        },
      });
      return;
    }

    if (jobType === 'generate_filmstrip') {
      const filmResult = result as { outputPath?: string; frames?: string[] } | undefined;
      if (Array.isArray(filmResult?.frames) && filmResult.frames.length > 0) {
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: assetId,
            metadata: { filmstrip: filmResult.frames, filmstripUrl: undefined },
          },
        });
        return;
      }
      if (!filmResult?.outputPath) return;
      wrappedDispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: assetId,
          metadata: { filmstripUrl: filmResult.outputPath, filmstrip: undefined },
        },
      });
      return;
    }

    if (jobType === 'generate_proxy') {
      const proxyResult = result as { outputPath?: string } | undefined;
      if (!proxyResult?.outputPath) return;
      wrappedDispatch({
        type: 'UPDATE_ASSET',
        asset: { id: assetId, proxyRef: proxyResult.outputPath },
      });
    }
  }, [updateAssetProcessingJobs, wrappedDispatch]);

  const queueDeriveJobForAsset = useCallback((asset: Asset, jobType: 'generate_thumbnail' | 'compute_waveform' | 'generate_filmstrip') => {
    if (!asset.fileRef) return Promise.resolve();
    const deriveKey = `${asset.id}:${jobType}`;
    if (deriveInFlightRef.current.has(deriveKey)) return Promise.resolve();
    deriveInFlightRef.current.add(deriveKey);
    updateAssetProcessingJobs(asset.id, (jobs) => {
      jobs.add(jobType);
    });
    return window.electronAPI.media.queueProcessing({
      assetId: asset.id,
      projectId,
      inputPath: asset.fileRef,
      needsProxy: false,
      includeThumbnail: jobType === 'generate_thumbnail',
      includeWaveform: jobType === 'compute_waveform',
      includeFilmstrip: jobType === 'generate_filmstrip',
    }).catch((error) => {
      deriveInFlightRef.current.delete(deriveKey);
      throw error;
    });
  }, [projectId, updateAssetProcessingJobs]);

  // Listen for media worker completion/error events; queue early completions until the asset exists in state.
  useEffect(() => {
    const unsubComplete = window.electronAPI.media.onJobComplete((data) => {
      const { assetId, jobType, result } = data as {
        jobId: string; result: unknown; assetId?: string; jobType?: string;
      };
      if (!assetId) return;

      mediaDebug('media job complete', {
        assetId,
        jobType,
        result: (() => {
          if (!result || typeof result !== 'object') return result;
          const r = result as Record<string, unknown>;
          return {
            outputPath: r.outputPath,
            frames: Array.isArray(r.frames) ? r.frames.length : undefined,
            duration: r.duration,
            width: r.width,
            height: r.height,
            codec: r.codec,
            fileSize: r.fileSize,
            hasPeaks: Array.isArray(r.peaks) ? r.peaks.length : undefined,
          };
        })(),
      });

      const hasAsset = assetsRef.current.some((a) => a.id === assetId);
      if (!hasAsset) {
        const pending = pendingMediaEventsRef.current.get(assetId) ?? [];
        pending.push({ jobType, result });
        pendingMediaEventsRef.current.set(assetId, pending);
        return;
      }

      if (isDeriveJobType(jobType)) {
        deriveInFlightRef.current.delete(`${assetId}:${jobType}`);
        deriveRetryCountsRef.current.delete(`${assetId}:${jobType}`);
      }

      applyMediaJobResult(assetId, jobType, result);
    });

    const unsubError = window.electronAPI.media.onJobError((data) => {
      const { assetId, jobType, error } = data as {
        jobId: string; error: string; assetId?: string; jobType?: string;
      };
      if (!assetId || !jobType) return;
      if (isDeriveJobType(jobType)) {
        deriveInFlightRef.current.delete(`${assetId}:${jobType}`);
      }

      mediaDebugError('media job error', { assetId, jobType, error });
      console.error(`[workspace] Media job failed (${jobType}) for asset ${assetId}: ${error}`);
      if (jobType !== 'generate_thumbnail' && jobType !== 'compute_waveform' && jobType !== 'generate_filmstrip') {
        updateAssetProcessingJobs(assetId, (jobs) => {
          jobs.delete(jobType);
        });
        return;
      }

      const asset = assetsRef.current.find((a) => a.id === assetId);
      if (!asset?.fileRef) return;

      const retryKey = `${assetId}:${jobType}`;
      const attempts = deriveRetryCountsRef.current.get(retryKey) ?? 0;
      const maxRetries = 4;
      if (attempts >= maxRetries) {
        updateAssetProcessingJobs(assetId, (jobs) => {
          jobs.delete(jobType);
        });
        return;
      }
      deriveRetryCountsRef.current.set(retryKey, attempts + 1);

      const delayMs = 800 * (attempts + 1);
      setTimeout(() => {
        queueDeriveJobForAsset(asset, jobType)
          .catch((err) => {
            console.error('[workspace] Retry queueing failed:', err);
            updateAssetProcessingJobs(assetId, (jobs) => {
              jobs.delete(jobType);
            });
          });
      }, delayMs);
    });

    return () => {
      unsubComplete();
      unsubError();
    };
  }, [applyMediaJobResult, isDeriveJobType, queueDeriveJobForAsset, updateAssetProcessingJobs]);

  // Flush queued media updates once their assets are present.
  useEffect(() => {
    if (pendingMediaEventsRef.current.size === 0) return;
    const assetIds = new Set(state.assets.map((a) => a.id));

    for (const [assetId, events] of pendingMediaEventsRef.current.entries()) {
      if (!assetIds.has(assetId)) continue;
      pendingMediaEventsRef.current.delete(assetId);
      for (const ev of events) {
        applyMediaJobResult(assetId, ev.jobType, ev.result);
      }
    }
  }, [state.assets, applyMediaJobResult]);

  // Backfill missing derived media artifacts for existing assets (thumbnail/filmstrip/waveform).
  useEffect(() => {
    for (const asset of state.assets) {
      if (!asset.fileRef) continue;

      const md = (asset.metadata ?? {}) as Record<string, unknown>;
      const processingJobs = new Set(
        Array.isArray(md.processingJobs)
          ? md.processingJobs.filter((value): value is string => typeof value === 'string')
          : [],
      );
      const assetAgeMs = (() => {
        const createdAt = Date.parse(asset.createdAt ?? '');
        return Number.isFinite(createdAt) ? Date.now() - createdAt : Number.POSITIVE_INFINITY;
      })();
      const hasWaveform = Array.isArray(md.waveform) && md.waveform.length > 0;
      const waveformPointCount = Array.isArray(md.waveform) ? md.waveform.length : 0;
      const hasWaveformFile = typeof md.waveformPath === 'string' && md.waveformPath.length > 0;
      const hasFilmstripUrl = typeof md.filmstripUrl === 'string' && md.filmstripUrl.length > 0;
      const hasFilmstripFrames = Array.isArray(md.filmstrip) && md.filmstrip.length > 0;
      const hasLegacyWaveformSummary = hasWaveform && waveformPointCount <= 800;
      const hasThumbnail = typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl.length > 0;
      const hasProxy = typeof asset.proxyRef === 'string' && asset.proxyRef.length > 0;
      const needsThumbnail = asset.type !== 'audio' && !hasThumbnail;

      const pruneJobIfStale = (jobType: typeof DERIVE_JOB_TYPES[number], artifactReady: boolean) => {
        if (!processingJobs.has(jobType)) return;
        if (artifactReady) {
          processingJobs.delete(jobType);
          return;
        }
        const deriveKey = `${asset.id}:${jobType}`;
        if (deriveInFlightRef.current.has(deriveKey)) return;
        if (assetAgeMs <= STALE_DERIVE_JOB_MS) return;
        processingJobs.delete(jobType);
      };

      pruneJobIfStale('generate_thumbnail', hasThumbnail);
      pruneJobIfStale('compute_waveform', hasWaveformFile);
      pruneJobIfStale('generate_filmstrip', hasFilmstripUrl || hasFilmstripFrames);
      pruneJobIfStale('generate_proxy', hasProxy);

      const nextProcessingJobs = [...processingJobs];
      const prevProcessingJobs = Array.isArray(md.processingJobs)
        ? md.processingJobs.filter((value): value is string => typeof value === 'string')
        : [];
      const processingJobsChanged =
        prevProcessingJobs.length !== nextProcessingJobs.length
        || prevProcessingJobs.some((job, index) => job !== nextProcessingJobs[index]);
      if (processingJobsChanged) {
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: asset.id,
            metadata: { processingJobs: nextProcessingJobs },
          },
        });
      }

      const needsWaveform = (asset.type === 'video' || asset.type === 'audio') && (!hasWaveformFile || hasLegacyWaveformSummary);
      const needsFilmstrip = asset.type === 'video' && !(hasFilmstripUrl || hasFilmstripFrames);
      const needsProxy = shouldGenerateProxyForAsset(asset) && !asset.proxyRef;
      const queueThumbnail = needsThumbnail && !processingJobs.has('generate_thumbnail');
      const queueWaveform = needsWaveform && !processingJobs.has('compute_waveform');
      const queueFilmstrip = needsFilmstrip && !processingJobs.has('generate_filmstrip');
      const queueProxy = needsProxy && !processingJobs.has('generate_proxy');
      const jobsToQueue = [
        queueThumbnail ? 'generate_thumbnail' : null,
        queueWaveform ? 'compute_waveform' : null,
        queueFilmstrip ? 'generate_filmstrip' : null,
        queueProxy ? 'generate_proxy' : null,
      ].filter((value): value is string => Boolean(value));

      if (jobsToQueue.length === 0) continue;

      const queuedDeriveKeys = jobsToQueue.map((job) => `${asset.id}:${job}`);
      for (const deriveKey of queuedDeriveKeys) {
        deriveInFlightRef.current.add(deriveKey);
      }

      updateAssetProcessingJobs(asset.id, (jobs) => {
        for (const job of jobsToQueue) jobs.add(job);
      });

      window.electronAPI.media.queueProcessing({
        assetId: asset.id,
        projectId,
        inputPath: asset.fileRef,
        needsProxy: queueProxy,
        includeThumbnail: queueThumbnail,
        includeWaveform: queueWaveform,
        includeFilmstrip: queueFilmstrip,
      }).catch((err) => {
        console.error('[workspace] Backfill processing failed:', err);
        for (const deriveKey of queuedDeriveKeys) {
          deriveInFlightRef.current.delete(deriveKey);
        }
        updateAssetProcessingJobs(asset.id, (jobs) => {
          for (const job of jobsToQueue) jobs.delete(job);
        });
      });
    }
  }, [state.assets, projectId, updateAssetProcessingJobs]);

  useEffect(() => {
    const apiKey = getApiKey();
    const autoVisualIndexing = getAutoVisualIndexingEnabled();
    if (!hydrationComplete || !autoVisualIndexing || !apiKey) return;

    const maxConcurrent = getMaxConcurrentVisionJobs();
    const backgroundVisionModel = getBackgroundVisionModel();
    const startupAssetIds = initialAssetIdsRef.current ?? new Set<string>();
    const availableSlots = maxConcurrent - visionInFlightRef.current.size;
    if (availableSlots <= 0) return;

    const candidates = state.assets.filter((asset) => {
      if (asset.type !== 'video' && asset.type !== 'image') return false;
      if (visionInFlightRef.current.has(asset.id)) return false;

      const visualState = getAssetVisualIndexState(asset);
      if (visualState === 'ready' || visualState === 'analyzing' || visualState === 'failed' || visualState === 'missing') return false;

      const framePaths = buildVisualFramePaths(asset);
      if (framePaths.length === 0) return false;

      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      const processingJobs = Array.isArray(metadata.processingJobs)
        ? metadata.processingJobs.filter((value): value is string => typeof value === 'string')
        : [];
      const waitingOnFilmstrip = asset.type === 'video'
        && processingJobs.includes('generate_filmstrip')
        && !Array.isArray(metadata.filmstrip)
        && !(typeof metadata.filmstripUrl === 'string' && metadata.filmstripUrl.trim());
      if (waitingOnFilmstrip) return false;

      if (visualState === 'queued') return true;
      return startupAssetIds.has(asset.id) && visualState === undefined;
    }).slice(0, availableSlots);

    for (const asset of candidates) {
      const framePaths = buildVisualFramePaths(asset);
      if (framePaths.length === 0) continue;

      visionInFlightRef.current.add(asset.id);
      wrappedDispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: asset.id,
          metadata: {
            llmVisualSummary: undefined,
            llmVisualSummaryStatus: 'analyzing',
            llmVisualSummaryModel: backgroundVisionModel,
            llmIndexVersion: 1,
          },
        },
      });

      void window.electronAPI.vision.indexAsset({
        apiKey,
        assetId: asset.id,
        assetName: asset.name,
        framePaths,
        model: backgroundVisionModel,
      }).then((summary) => {
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: asset.id,
            metadata: {
              llmVisualSummary: summary,
              llmVisualSummaryStatus: summary.status,
              llmVisualSummaryModel: summary.model ?? backgroundVisionModel,
              llmIndexVersion: 1,
              llmIndexUpdatedAt: summary.updatedAt ?? new Date().toISOString(),
            },
          },
        });
      }).catch((error) => {
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: asset.id,
            metadata: {
              llmVisualSummary: {
                assetId: asset.id,
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                updatedAt: new Date().toISOString(),
                model: backgroundVisionModel,
              },
              llmVisualSummaryStatus: 'failed',
              llmVisualSummaryModel: backgroundVisionModel,
              llmIndexVersion: 1,
              llmIndexUpdatedAt: new Date().toISOString(),
            },
          },
        });
      }).finally(() => {
        visionInFlightRef.current.delete(asset.id);
        // NOTE: Do NOT call setSettingsVersion here — it's in the dependency
        // array and would create an infinite re-render loop. The state.assets
        // update from wrappedDispatch above is sufficient to re-trigger this
        // effect and pick up the next candidate.
      });
    }
  }, [hydrationComplete, projectId, settingsVersion, state.assets, wrappedDispatch]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    if (useSqlite) {
      // ---------- SQLite hydration path ----------
      window.electronAPI.db.loadProject(projectId)
        .then((raw) => {
          const dbState = raw as Record<string, unknown>;
          // Capture project name for save path
          const projectRow = dbState.project as Record<string, unknown> | undefined;
          if (projectRow?.name) projectNameRef.current = projectRow.name as string;

          const workflowState = ((dbState.workflow as Record<string, unknown>) ?? {}) as Record<string, unknown>;
          const nodes = (workflowState.nodes ?? []) as Node<WorkflowNodeData>[];
          const edges = (workflowState.edges ?? []) as Edge[];
          const spaces = Array.isArray(workflowState.spaces)
            ? workflowState.spaces.map((space, index) => {
                const record = space as Record<string, unknown>;
                return {
                  id: typeof record.id === 'string' ? record.id : generateId(),
                  name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : `Space ${index + 1}`,
                  createdAt: typeof record.createdAt === 'string'
                    ? record.createdAt
                    : typeof record.created_at === 'string'
                      ? record.created_at
                      : timestamp(),
                  nodes: Array.isArray(record.nodes) ? record.nodes as Node<WorkflowNodeData>[] : [],
                  edges: Array.isArray(record.edges) ? record.edges as Edge[] : [],
                } satisfies WorkflowSpace;
              })
            : [];
          const activeSpaceId = typeof workflowState.activeSpaceId === 'string' ? workflowState.activeSpaceId : '';
          const openSpaceIds = Array.isArray(workflowState.openSpaceIds)
            ? workflowState.openSpaceIds.filter((value): value is string => typeof value === 'string')
            : [];
          const assets = (dbState.assets as Record<string, unknown>[]).map(assetFromRow);
          const mediaFolders = (dbState.mediaFolders as Record<string, unknown>[]).map(folderFromRow);

          const rawTimelines = dbState.timelines as Array<
            Record<string, unknown> & {
              tracks: Record<string, unknown>[];
              clips: Array<Record<string, unknown> & { keyframes?: Record<string, unknown>[] }>;
              transitions: Record<string, unknown>[];
            }
          >;
          const timelines = rawTimelines.length > 0
            ? rawTimelines.map((tl) => timelineFromRows(tl, tl.tracks, tl.clips, tl.transitions))
            : [createDefaultTimeline('Timeline 1')];

          const activeTimelineId = (dbState.activeTimelineId as string) ?? timelines[0]?.id ?? '';
          const elements = (dbState.elements as Record<string, unknown>[]).map(elementFromRow);
          const exports = (dbState.exports as Record<string, unknown>[]).map(exportFromRow);

          if (nodes.length || edges.length || spaces.length || assets.length) {
            historyDispatch({
              type: 'HYDRATE',
              payload: { nodes, edges, spaces, activeSpaceId, openSpaceIds, assets, mediaFolders, timelines, activeTimelineId, exports, elements },
            });
          }
        })
        .catch(() => {})
        .finally(() => setHydrationComplete(true));
    } else {
      // ---------- JSON file hydration path ----------
      window.electronAPI.project.load(projectId)
        .then((snapshot) => {
          const nodes = (snapshot.workflow?.nodes ?? []) as Node<WorkflowNodeData>[];
          const edges = (snapshot.workflow?.edges ?? []) as Edge[];
          const spaces = Array.isArray(snapshot.spaces)
            ? snapshot.spaces.map((space, index) => ({
                id: typeof space.id === 'string' ? space.id : generateId(),
                name: typeof space.name === 'string' && space.name.trim() ? space.name.trim() : `Space ${index + 1}`,
                createdAt: typeof space.createdAt === 'string' ? space.createdAt : timestamp(),
                nodes: Array.isArray(space.nodes) ? space.nodes as Node<WorkflowNodeData>[] : [],
                edges: Array.isArray(space.edges) ? space.edges as Edge[] : [],
              }))
            : [];
          const activeSpaceId = typeof snapshot.activeSpaceId === 'string' ? snapshot.activeSpaceId : '';
          const openSpaceIds = Array.isArray(snapshot.openSpaceIds)
            ? snapshot.openSpaceIds.filter((value): value is string => typeof value === 'string')
            : [];
          const AUDIO_EXTS = /\.(mp3|wav|ogg|aac|m4a|flac|webm)(\?|$)/i;
          const rawAssets = (snapshot.assets ?? []) as Asset[];
          // Migrate: fix audio assets that were saved as 'image' before audio type support
          const assets = rawAssets.map((a) =>
            a.type === 'image' && AUDIO_EXTS.test(a.url) ? { ...a, type: 'audio' as const } : a,
          );
          const migrated = migrateSequenceToTimelines(snapshot);
          const timelines = (migrated.timelines ?? [createDefaultTimeline('Timeline 1')]) as Timeline[];
          const activeTimelineId = migrated.activeTimelineId ?? timelines[0]?.id ?? '';
          const exports = (snapshot.exports ?? []) as ExportJob[];
          const elements = (snapshot.elements ?? []) as Element[];
          const mediaFolders = (snapshot.mediaFolders ?? []) as MediaFolder[];

          if (nodes.length || edges.length || spaces.length || assets.length) {
            historyDispatch({
              type: 'HYDRATE',
              payload: { nodes, edges, spaces, activeSpaceId, openSpaceIds, assets, mediaFolders, timelines, activeTimelineId, exports, elements },
            });
          }
        })
        .catch(() => {})
        .finally(() => setHydrationComplete(true));
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (!lastActionRef.current || !PERSIST_ACTIONS.includes(lastActionRef.current)) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      const serializableNodes = sanitizeWorkflowNodes(state.nodes);
      const serializableSpaces = state.spaces.map((space) => ({
        ...space,
        nodes: sanitizeWorkflowNodes(space.id === state.activeSpaceId ? state.nodes : space.nodes),
        edges: space.id === state.activeSpaceId ? state.edges : space.edges,
      }));

      if (useSqlite) {
        // ---------- SQLite save path ----------
        const dbTimelines = state.timelines.map((tl) => ({
          id: tl.id,
          project_id: projectId,
          name: tl.name,
          duration: tl.duration,
          created_at: '',
          tracks: tl.tracks.map((track, idx) => trackToRow(track, tl.id, idx)),
          clips: tl.clips.map((clip) => {
            const clipRow = clipToRow(clip, tl.id);
            return {
              ...clipRow,
              created_at: '',
              keyframes: (clip.keyframes ?? []).map((kf) => ({
                id: '',
                clip_id: clip.id,
                time: kf.time,
                property: kf.property,
                value: kf.value,
              })),
            };
          }),
          transitions: tl.transitions.map((tr) => transitionToRow(tr, tl.id)),
          markers: JSON.stringify(tl.markers ?? []),
        }));

        const dbState = {
          project: { id: projectId, name: projectNameRef.current, created_at: '', updated_at: '', resolution_width: 1920, resolution_height: 1080, frame_rate: 24 },
          assets: state.assets.map((a) => assetToRow(a, projectId)),
          mediaFolders: state.mediaFolders.map((f) => ({
            id: f.id,
            project_id: projectId,
            name: f.name,
            parent_id: f.parentId ?? null,
            created_at: f.createdAt ?? '',
          })),
          timelines: dbTimelines,
          activeTimelineId: state.activeTimelineId,
          workflow: {
            nodes: serializableNodes,
            edges: state.edges,
            spaces: serializableSpaces,
            activeSpaceId: state.activeSpaceId,
            openSpaceIds: [...state.openSpaceIds],
          },
          elements: state.elements.map((el) => ({
            id: el.id,
            project_id: projectId,
            name: el.name,
            type: el.type,
            description: el.description ?? null,
            images: JSON.stringify(el.images ?? []),
            created_at: el.createdAt ?? '',
            updated_at: el.updatedAt ?? '',
          })),
          exports: state.exports.map((ex) => ({
            id: ex.id,
            project_id: projectId,
            status: ex.status,
            progress: ex.progress,
            preset: ex.preset ?? null,
            fps: ex.fps ?? null,
            output_path: ex.outputUrl ?? null,
            file_size: ex.fileSize ?? null,
            error: ex.error ?? null,
            created_at: ex.createdAt ?? '',
            completed_at: ex.completedAt ?? null,
          })),
        };

        window.electronAPI.db.saveProject(projectId, dbState).catch((err) => {
          console.error('[workspace] Failed to save project to SQLite:', err);
        });
      } else {
        // ---------- JSON file save path ----------
        window.electronAPI.project.save(projectId, {
          workflow: { nodes: serializableNodes, edges: state.edges },
          spaces: serializableSpaces,
          activeSpaceId: state.activeSpaceId,
          openSpaceIds: [...state.openSpaceIds],
          assets: state.assets,
          mediaFolders: state.mediaFolders,
          timelines: state.timelines,
          activeTimelineId: state.activeTimelineId,
          exports: state.exports,
          elements: state.elements,
        }).catch(() => {});
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    state.nodes,
    state.edges,
    state.spaces,
    state.activeSpaceId,
    state.openSpaceIds,
    state.assets,
    state.mediaFolders,
    state.timelines,
    state.activeTimelineId,
    state.exports,
    state.elements,
  ]);

  return (
    <WorkspaceContext.Provider value={{ state, dispatch: wrappedDispatch, projectId }}>
      <TopTabs
        activeTab={state.activeTab}
        onTabChange={(tab) => wrappedDispatch({ type: 'SET_TAB', tab })}
        onBackToHome={onBackToHome}
      />
      <main className="workspace-content">
        {state.activeTab === 'elements' && <ElementsTab />}
        {state.activeTab === 'create' && <CreateTab />}
        {state.activeTab === 'edit' && <EditTab llmJumpRequest={llmJumpRequest} />}
        {state.activeTab === 'llm' && (
          <LLMTab
            projectId={projectId}
            assets={state.assets}
            mediaFolders={state.mediaFolders}
            timelines={state.timelines}
            activeTimelineId={state.activeTimelineId}
            elements={state.elements}
            onCreateTimelineFromCut={handleCreateTimelineFromLlm}
            onOpenTimeline={handleOpenTimelineFromLlm}
            onNavigateToAssetCitation={handleNavigateToAssetCitation}
            onNavigateToTimelineCitation={handleNavigateToTimelineCitation}
            onUpdateAssetAnalysis={handleUpdateAssetAnalysis}
          />
        )}
        {state.activeTab === 'export' && <ExportTab />}
        {state.activeTab === 'settings' && (
          <SettingsPage onBack={() => wrappedDispatch({ type: 'SET_TAB', tab: 'create' })} />
        )}
      </main>
    </WorkspaceContext.Provider>
  );
}
