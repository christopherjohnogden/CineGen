import { useAssetMediaBackfill } from './use-asset-media-backfill';
import { registerMcpCommands } from '@/lib/mcp/app-commands';

import { createContext, useContext, useReducer, useEffect, useRef, useCallback, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowSpace, WorkspaceState } from '@/types/workspace';
import type { ProjectTab } from '@/types/workspace';
import type { Asset, MediaFolder, ProjectSnapshot } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import type { WorkflowNodeData, WorkflowRun } from '@/types/workflow';
import type { ExportJob } from '@/types/export';
import type { Element, ElementFolder } from '@/types/elements';
import type { DirectorShow } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { directorFromSnapshot, directorFromWorkflow } from '@/lib/director/snapshot';
import { DirectorTab } from '@/components/director/director-tab';
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';
import { migrateSequenceToTimelines } from '@/lib/editor/timeline-migration';
import { TopTabs, type LlmCopilotNavStatus } from './top-tabs';
import { WorkspaceLoadingState } from './workspace-loading-state';
import { ElementsTab } from '@/components/elements/elements-tab';
import { CreateTab } from '@/components/create/create-tab';
import { EditTab } from '@/components/edit/edit-tab';
import { LLMTab } from '@/components/llm/llm-tab';
import { notifyCopilotResponseReady } from '@/lib/llm/copilot-notifications';
import { attachElementMentionToGraph } from '@/lib/llm/prompt-elements';
import {
  assetNeedsGeneratedPersist,
  buildPersistedAssetUpdate,
  getAssetRemoteUrl,
  resolveExistingLocalPath,
} from '@/lib/media/asset-local-storage';
import { ExportTab } from '@/components/export/export-tab';
import { SettingsPage } from '@/components/settings/settings-page';
import { AppToastHost, type AppToast } from '@/components/ui/app-toast';
import { AssistantDrawer } from '@/components/assistant/assistant-drawer';
import { VoiceDirectorOverlay } from '@/components/assistant/voice-director-overlay';
import {
  assetFromRow,
  folderFromRow,
  timelineFromRows,
  exportFromRow,
  assetToRow,
  trackToRow,
  clipToRow,
  transitionToRow,
} from '@/lib/db-converters';
import { mediaDebug, mediaDebugError } from '@/lib/debug/media-debug';
import { generateId, timestamp } from '@/lib/utils/ids';
import { loadAvailableProject, saveAvailableProject, watchCloudProject } from '@/lib/cloud/projects';
import { loadAvailableElementsLibrary, saveAvailableElementsLibrary } from '@/lib/cloud/elements';
import { setActiveFundingProject } from '@/lib/cloud/funding';
import { startOwnerFundingRelay } from '@/lib/cloud/funding-relay';
import {
  normalizeProjectProviderUsage,
  observeProviderBalance,
  type ProviderBalanceObservation,
} from '@/lib/providers/project-usage';
import {
  getVideoGenerationProvider,
  isVideoGenerationProvider,
  type VideoGenerationProvider,
} from '@/lib/utils/video-generation-provider';
import {
  getApiKey,
  getAutoVisualIndexingEnabled,
  getBackgroundVisionModel,
  getMaxConcurrentVisionJobs,
} from '@/lib/utils/api-key';
import { markWorkspaceSavePending } from './workspace-persistence';
import { useMcpBridge } from './use-mcp-bridge';

/* ------------------------------------------------------------------
   Actions
   ------------------------------------------------------------------ */

export { workspaceReducer } from '@/lib/mcp/workspace-state';
export type { WorkspaceAction } from '@/lib/mcp/workspace-state';
import { workspaceReducer, createInitialWorkspaceState, createWorkflowSpace, sanitizeWorkflowNodes, type WorkspaceAction } from '@/lib/mcp/workspace-state';

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

/* ------------------------------------------------------------------
   Undo / Redo History
   ------------------------------------------------------------------ */

const initialState = createInitialWorkspaceState();
const MAX_HISTORY = 50;
const UNDOABLE_ACTIONS: WorkspaceAction['type'][] = [
  'SET_NODES', 'SET_EDGES', 'UPDATE_NODE_CONFIG', 'APPLY_ELEMENT_MENTION',
  'ADD_SPACE', 'RENAME_SPACE', 'REMOVE_SPACE', 'CLOSE_SPACE', 'OPEN_SPACE', 'SET_ACTIVE_SPACE',
  'ADD_ASSET', 'UPDATE_ASSET', 'REMOVE_ASSET', 'REMOVE_ASSETS',
  'ADD_FOLDER', 'UPDATE_FOLDER', 'REMOVE_FOLDER',
  'SET_TIMELINE', 'ADD_TIMELINE', 'REMOVE_TIMELINE', 'CLOSE_TIMELINE', 'OPEN_TIMELINE',
  'ADD_ELEMENT', 'UPDATE_ELEMENT', 'REMOVE_ELEMENT', 'REMOVE_ELEMENTS',
  'MOVE_ELEMENTS', 'ADD_ELEMENT_FOLDER', 'UPDATE_ELEMENT_FOLDER', 'REMOVE_ELEMENT_FOLDER',
  'SET_DIRECTOR',
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
  if (action.type === 'HYDRATE' || action.type === 'SYNC_CLOUD_PROJECT') {
    return { current: workspaceReducer(history.current, action), past: [], future: [], lastPushTime: 0, lastPushType: null };
  }
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
const PROJECT_LOAD_TIMEOUT_MS = 30_000;
const DERIVE_JOB_TYPES = ['generate_thumbnail', 'compute_waveform', 'generate_filmstrip', 'generate_proxy'] as const;
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
  const liveStateRef = useRef(state);
  liveStateRef.current = state;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const savePendingRef = useRef(false);
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
  const persistInFlightRef = useRef(new Set<string>());
  const providerRefreshInFlightRef = useRef(new Set<VideoGenerationProvider>());
  const [llmJumpRequest, setLlmJumpRequest] = useState<LlmJumpRequest | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [hydrationComplete, setHydrationComplete] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const elementsLibraryReadyRef = useRef(false);
  const [openSkillBuilderSignal, setOpenSkillBuilderSignal] = useState(0);
  const [llmHasActiveSkill, setLlmHasActiveSkill] = useState(false);
  const [llmCopilotStatus, setLlmCopilotStatus] = useState<LlmCopilotNavStatus>({
    isThinking: false,
    hasUnreadResponse: false,
  });
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [voiceDirectorOpen, setVoiceDirectorOpen] = useState(false);

  useEffect(() => {
    if (!hydrationComplete) return;
    setActiveFundingProject(projectId);
    let disposed = false;
    let stopRelay = () => {};
    const restartRelay = async () => {
      stopRelay();
      stopRelay = () => {};
      try {
        const nextStop = await startOwnerFundingRelay(projectId);
        if (disposed) nextStop();
        else stopRelay = nextStop;
      } catch (error) {
        console.warn('[cloud] Owner funding relay is unavailable:', error);
      }
    };
    const onFundingChanged = (event: Event) => {
      const changedProjectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!changedProjectId || changedProjectId === projectId) void restartRelay();
    };
    void restartRelay();
    window.addEventListener('cinegen:funding-changed', onFundingChanged);
    return () => {
      disposed = true;
      stopRelay();
      setActiveFundingProject(null);
      window.removeEventListener('cinegen:funding-changed', onFundingChanged);
    };
  }, [hydrationComplete, projectId]);

  const wrappedDispatch = useCallback((action: WorkspaceAction) => {
    savePendingRef.current = markWorkspaceSavePending(savePendingRef.current, action.type);
    historyDispatch(action);
  }, []);

  const directorMounted = useRef(false);
  if (state.activeTab === 'director') directorMounted.current = true;

  // Lets an MCP client drive this workspace: the tools run against the same
  // state and dispatch the UI uses, so anything they create is simply there.
  const mcpHasRunningJobs = useMcpBridge(state, wrappedDispatch, { projectId, projectName: projectNameRef.current, ready: hydrationComplete && !hydrationError, reduce: (current, action) => workspaceReducer(current as WorkspaceState, action) });

  const toggleVoiceDirector = useCallback(() => {
    setAssistantOpen(false);
    setVoiceDirectorOpen((open) => !open);
  }, []);

  const applyVoiceDirector = useCallback((director: DirectorShow) => {
    wrappedDispatch({ type: 'SET_DIRECTOR', director });
  }, [wrappedDispatch]);

  const undoVoiceDirector = useCallback(() => {
    historyDispatch({ type: 'UNDO' });
  }, []);

  const handleTabChange = useCallback((tab: ProjectTab) => {
    if (tab === 'llm') {
      setLlmCopilotStatus((current) => ({ ...current, hasUnreadResponse: false }));
    }
    wrappedDispatch({ type: 'SET_TAB', tab });
  }, [wrappedDispatch]);

  const handleCopilotThinkingChange = useCallback((isThinking: boolean) => {
    setLlmCopilotStatus((current) => ({ ...current, isThinking }));
  }, []);

  const handleCopilotResponseReady = useCallback(() => {
    setLlmCopilotStatus((current) => ({ ...current, hasUnreadResponse: true }));
    setAppToast({
      id: crypto.randomUUID(),
      title: 'Copilot',
      message: 'Your response is ready in the LLM tab.',
      actionLabel: 'View',
    });
    notifyCopilotResponseReady();
  }, []);

  const handleCopilotToastAction = useCallback(() => {
    setAppToast(null);
    handleTabChange('llm');
  }, [handleTabChange]);

  const dismissCopilotToast = useCallback(() => {
    setAppToast(null);
  }, []);

  useEffect(() => {
    const handleCloudSyncError = (event: Event) => {
      const cause = (event as CustomEvent<unknown>).detail;
      const message = cause instanceof Error ? cause.message : 'This project could not be saved to the cloud.';
      setAppToast({
        id: `cloud-sync:${(cause as { scope?: string })?.scope ?? 'project'}`,
        title: message.includes('changed on another device') ? 'Newer cloud version found' : 'Cloud save paused',
        message,
      });
    };
    const handleRecovered = (event: Event) => {
      const { scope } = (event as CustomEvent<{ scope: string }>).detail;
      setAppToast(current => current?.id === `cloud-sync:${scope}` ? null : current);
    };
    window.addEventListener('cinegen:cloud-sync-error', handleCloudSyncError);
    window.addEventListener('cinegen:cloud-sync-recovered', handleRecovered);
    return () => {
      window.removeEventListener('cinegen:cloud-sync-error', handleCloudSyncError);
      window.removeEventListener('cinegen:cloud-sync-recovered', handleRecovered);
    };
  }, []);

  useEffect(() => {
    function handleSettingsChanged() {
      setSettingsVersion((value) => value + 1);
    }
    window.addEventListener('cinegen:settings-changed', handleSettingsChanged);
    return () => window.removeEventListener('cinegen:settings-changed', handleSettingsChanged);
  }, []);

  useEffect(() => {
    if (!hydrationComplete) return;
    let disposed = false;

    const refreshProvider = async (provider: VideoGenerationProvider) => {
      if (providerRefreshInFlightRef.current.has(provider)) return;
      providerRefreshInFlightRef.current.add(provider);
      try {
        let observation: ProviderBalanceObservation = { provider };
        if (provider === 'topview') {
          const status = await window.electronAPI.topview.accountStatus();
          observation = { provider, connected: status.connected, credits: status.credits };
        } else if (provider === 'higgsfield') {
          const status = await window.electronAPI.higgsfield.accountStatus();
          observation = { provider, connected: status.connected, credits: status.credits };
        } else if (provider === 'artlist') {
          const status = await window.electronAPI.artlist.accountStatus();
          observation = { provider, connected: status.connected };
        }
        if (!disposed) wrappedDispatch({ type: 'OBSERVE_PROVIDER_USAGE', observation });
      } catch {
        if (!disposed) {
          wrappedDispatch({
            type: 'OBSERVE_PROVIDER_USAGE',
            observation: { provider, connected: false },
          });
        }
      } finally {
        providerRefreshInFlightRef.current.delete(provider);
      }
    };

    const refreshCurrentProvider = () => void refreshProvider(getVideoGenerationProvider());
    const handleRefreshRequest = (event: Event) => {
      const requested = (event as CustomEvent<{ provider?: unknown }>).detail?.provider;
      void refreshProvider(isVideoGenerationProvider(requested) ? requested : getVideoGenerationProvider());
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshCurrentProvider();
    };

    refreshCurrentProvider();
    const interval = window.setInterval(refreshCurrentProvider, 60_000);
    window.addEventListener('cinegen:provider-usage-refresh', handleRefreshRequest);
    window.addEventListener('focus', refreshCurrentProvider);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('cinegen:provider-usage-refresh', handleRefreshRequest);
      window.removeEventListener('focus', refreshCurrentProvider);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hydrationComplete, projectId, settingsVersion, wrappedDispatch]);

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
    // Media jobs often finish in the same browser task. Keep the event-facing
    // ref ahead of React's next render so each completion removes its job from
    // the result of the previous completion instead of from a stale snapshot.
    assetsRef.current = assetsRef.current.map((entry) => (
      entry.id === assetId
        ? { ...entry, metadata: { ...(entry.metadata ?? {}), processingJobs: next } }
        : entry
    ));
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

  // Voice Director — available from every project tab while CineGen is focused.
  useEffect(() => {
    function handleVoiceShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'Space') return;
      event.preventDefault();
      toggleVoiceDirector();
    }
    window.addEventListener('keydown', handleVoiceShortcut);
    return () => window.removeEventListener('keydown', handleVoiceShortcut);
  }, [toggleVoiceDirector]);

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

  useAssetMediaBackfill(state.assets, projectId, deriveInFlightRef, wrappedDispatch, updateAssetProcessingJobs);

  const MAX_CONCURRENT_GENERATED_PERSIST = 3;

  // Download or copy AI-generated / remote assets into ~/Documents/CINEGEN/{project}/media/generated.
  useEffect(() => {
    if (!hydrationComplete) return;

    let activeCount = persistInFlightRef.current.size;
    for (const asset of state.assets) {
      if (activeCount >= MAX_CONCURRENT_GENERATED_PERSIST) break;
      if (!assetNeedsGeneratedPersist(asset)) continue;
      if (persistInFlightRef.current.has(asset.id)) continue;

      const remoteUrl = getAssetRemoteUrl(asset);
      const localPathHint = resolveExistingLocalPath(asset) ?? undefined;
      if (!remoteUrl && !localPathHint) continue;

      persistInFlightRef.current.add(asset.id);
      activeCount += 1;

      window.electronAPI.media.persistGeneratedAsset({
        projectId,
        assetId: asset.id,
        assetType: asset.type,
        remoteUrl,
        localPathHint,
      }).then((result) => {
        if (!('path' in result)) {
          const error = result.error || 'Generated asset could not be persisted.';
          console.warn(`[workspace] Skipped persist for generated asset ${asset.id}:`, error);
          wrappedDispatch({
            type: 'UPDATE_ASSET',
            asset: {
              id: asset.id,
              metadata: {
                ...(asset.metadata ?? {}),
                localPersistStatus: 'failed',
                localPersistError: error,
              },
            },
          });
          return;
        }
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: asset.id,
            ...buildPersistedAssetUpdate(asset, result),
          },
        });
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[workspace] Failed to persist generated asset ${asset.id}:`, message);
        wrappedDispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: asset.id,
            metadata: {
              ...(asset.metadata ?? {}),
              localPersistStatus: 'failed',
              localPersistError: message,
            },
          },
        });
      }).finally(() => {
        persistInFlightRef.current.delete(asset.id);
      });
    }
  }, [hydrationComplete, projectId, state.assets, wrappedDispatch]);

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
    const controller = new AbortController();
    let disposed = false;
    setHydrationComplete(false);
    setHydrationError(null);

    const handleHydrationError = (error: unknown) => {
      if (disposed) return;
      console.error('[workspace] Failed to load project:', error);
      setHydrationError(error instanceof Error ? error.message : 'The project data could not be restored.');
    };

    const loadProjectWithDeadline = <T,>(sqlite: boolean): Promise<T> => {
      const projectLoad = loadAvailableProject<T>(projectId, sqlite, controller.signal);
      return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          controller.abort();
          reject(new Error('The cloud project took too long to respond. Please try again.'));
        }, PROJECT_LOAD_TIMEOUT_MS);
        projectLoad.then(
          (value) => {
            window.clearTimeout(timeoutId);
            resolve(value);
          },
          (error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          },
        );
      });
    };

    const loadElementsLibraryAfterProject = () => {
      // The shared Elements library is useful across the whole team, but it is
      // not required to render the project. Loading it independently prevents
      // slow auth/storage initialization in mobile webviews from trapping the
      // entire workspace behind the project skeleton.
      void loadAvailableElementsLibrary({
        projectId,
        projectName: projectNameRef.current,
      }).then((library) => {
        if (disposed) return;
        historyDispatch({
          type: 'SET_ELEMENTS_LIBRARY',
          elements: library.elements,
          elementFolders: library.folders,
        });
        elementsLibraryReadyRef.current = true;
      }).catch((error) => {
        if (disposed) return;
        console.warn('[workspace] Elements library will retry on the next project open:', error);
        setAppToast({
          id: crypto.randomUUID(),
          title: 'Elements are still syncing',
          message: 'The project is ready. Reopen it to retry the shared Elements library.',
        });
      });
    };

    if (useSqlite) {
      // ---------- SQLite hydration path ----------
      loadProjectWithDeadline<Record<string, unknown>>(true)
        .then(async (raw) => {
          if (disposed) return;
          const dbState = raw;
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
          const providerUsage = normalizeProjectProviderUsage(workflowState.providerUsage);
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
          const exports = (dbState.exports as Record<string, unknown>[]).map(exportFromRow);
          const director = directorFromWorkflow(workflowState);
          historyDispatch({
            type: 'HYDRATE',
            payload: {
              nodes, edges, spaces, activeSpaceId, openSpaceIds, assets, mediaFolders, timelines, activeTimelineId, exports,
              elements: [],
              elementFolders: [],
              director,
              providerUsage,
            },
          });
          loadElementsLibraryAfterProject();
        })
        .catch(handleHydrationError)
        .finally(() => { if (!disposed) setHydrationComplete(true); });
    } else {
      // ---------- JSON file hydration path ----------
      loadProjectWithDeadline<ProjectSnapshot>(false)
        .then(async (snapshot) => {
          if (disposed) return;
          if (snapshot.project?.name) projectNameRef.current = snapshot.project.name;
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
          const providerUsage = normalizeProjectProviderUsage(snapshot.providerUsage);
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
          const mediaFolders = (snapshot.mediaFolders ?? []) as MediaFolder[];
          const director = directorFromSnapshot(snapshot);
          historyDispatch({
            type: 'HYDRATE',
            payload: {
              nodes, edges, spaces, activeSpaceId, openSpaceIds, assets, mediaFolders, timelines, activeTimelineId, exports,
              elements: [],
              elementFolders: [],
              director,
              providerUsage,
            },
          });
          loadElementsLibraryAfterProject();
        })
        .catch(handleHydrationError)
        .finally(() => { if (!disposed) setHydrationComplete(true); });
    }
    return () => { disposed = true; controller.abort(); };
  }, [projectId, useSqlite, loadAttempt]);

  useEffect(() => {
    if (!hydrationComplete || hydrationError) return;
    let disposed = false;
    let stop = () => {};
    const canApply = () => liveStateRef.current.runningNodeIds.size === 0;
    void watchCloudProject(projectId, canApply, (raw, base) => {
      if (disposed || !canApply()) return false;
      const current = liveStateRef.current;
      if (savePendingRef.current && !base) return false;
      const fromSnapshot = (raw: Record<string, unknown>) => {
        const workflow = (raw.workflow ?? {}) as Record<string, unknown>;
        const spaces = ((useSqlite ? workflow.spaces : raw.spaces) ?? []) as WorkflowSpace[];
        const activeSpaceId = spaces.some(space => space.id === current.activeSpaceId)
          ? current.activeSpaceId : String((useSqlite ? workflow.activeSpaceId : raw.activeSpaceId) ?? '');
        const timelines = useSqlite
          ? (raw.timelines as Array<Record<string, unknown> & { tracks: Record<string, unknown>[]; clips: Array<Record<string, unknown> & { keyframes?: Record<string, unknown>[] }>; transitions: Record<string, unknown>[] }>).map(tl => timelineFromRows(tl, tl.tracks, tl.clips, tl.transitions))
          : (migrateSequenceToTimelines(raw as unknown as ProjectSnapshot).timelines ?? []) as Timeline[];
        return {
          nodes: (workflow.nodes ?? []) as Node<WorkflowNodeData>[],
          edges: (workflow.edges ?? []) as Edge[],
          spaces, activeSpaceId,
          openSpaceIds: [...current.openSpaceIds],
          assets: useSqlite ? (raw.assets as Record<string, unknown>[]).map(assetFromRow) : (raw.assets ?? []) as Asset[],
          mediaFolders: useSqlite ? (raw.mediaFolders as Record<string, unknown>[]).map(folderFromRow) : (raw.mediaFolders ?? []) as MediaFolder[],
          timelines,
          activeTimelineId: timelines.some(tl => tl.id === current.activeTimelineId) ? current.activeTimelineId : timelines[0]?.id ?? '',
          exports: useSqlite ? (raw.exports as Record<string, unknown>[]).map(exportFromRow) : (raw.exports ?? []) as ExportJob[],
          elements: current.elements, elementFolders: current.elementFolders,
          director: useSqlite ? directorFromWorkflow(workflow) : directorFromSnapshot(raw as unknown as ProjectSnapshot),
          providerUsage: normalizeProjectProviderUsage(useSqlite ? workflow.providerUsage : raw.providerUsage),
        };
      };
      // Cancel a debounced closure containing the old workspace before advancing
      // the cloud revision. The merged render schedules its replacement save.
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      // Merge in the reducer so edits queued in this React batch are included.
      // Keep the dirty flag: failed/pending saves retry with the merged state.
      historyDispatch({ type: 'SYNC_CLOUD_PROJECT', payload: fromSnapshot(raw), base: base ? fromSnapshot(base) : undefined });
      return true;
    }).then(unsubscribe => { if (disposed) unsubscribe(); else stop = unsubscribe; })
      .catch(error => console.warn('[cloud] Could not start live project updates:', error));
    return () => { disposed = true; stop(); };
  }, [projectId, useSqlite, hydrationComplete, hydrationError]);

  const persistWorkspace = useCallback(async () => {
    if (!hydrationComplete || hydrationError) throw new Error('Project is not ready to save.');
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
          director: state.director,
          providerUsage: state.providerUsage,
        },
        elements: [],
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

      await saveAvailableProject(projectId, dbState, true);
    } else {
      // ---------- JSON file save path ----------
      await saveAvailableProject(projectId, {
        workflow: { nodes: serializableNodes, edges: state.edges },
        spaces: serializableSpaces,
        activeSpaceId: state.activeSpaceId,
        openSpaceIds: [...state.openSpaceIds],
        assets: state.assets,
        mediaFolders: state.mediaFolders,
        timelines: state.timelines,
        activeTimelineId: state.activeTimelineId,
        exports: state.exports,
        elements: [],
        director: state.director,
        providerUsage: state.providerUsage,
      }, false);
    }
  }, [state, hydrationComplete, hydrationError, projectId, useSqlite]);

  useEffect(() => {
    // A load attempt only means hydration was started — wait for the
    // project resolves. Saving on that flag alone lets a failed or timed-out
    // hydration write the empty initial state (and the 'Project' name default)
    // over the real cloud project. Only ever persist state we actually loaded.
    if (!hydrationComplete || hydrationError) return;
    if (!savePendingRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      // Consume the pending write only when the debounced save actually runs.
      // A UI-only state update (for example SET_NODE_RUNNING(false)) may render
      // before this timer fires; keeping the flag set lets that render reschedule
      // the same save instead of cancelling the completed generation result.
      savePendingRef.current = false;
      void persistWorkspace().catch((error) => {
        savePendingRef.current = true;
        console.error('[workspace] Failed to save project:', error);
      });
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
    state.director,
    state.providerUsage,
    hydrationComplete,
    hydrationError,
  ]);

  const librarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrationComplete || !elementsLibraryReadyRef.current) return;
    if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current);
    librarySaveTimerRef.current = setTimeout(() => {
      saveAvailableElementsLibrary({
        version: 1,
        folders: state.elementFolders,
        elements: state.elements,
      }, {
        projectId,
        projectName: projectNameRef.current,
      }).catch((err) => {
        console.error('[workspace] Failed to save elements library:', err);
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current);
    };
  }, [hydrationComplete, state.elements, state.elementFolders]);

  useEffect(() => registerMcpCommands({ save_project: async () => {
    if (mcpHasRunningJobs() || state.runningNodeIds.size || (state.director.jobStatus && !state.director.jobStatus.error)) throw new Error('Wait for the running generation or Director job before switching projects.');
    if (!hydrationComplete || hydrationError || !elementsLibraryReadyRef.current) throw new Error('Project is not ready to save.');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current);
    await persistWorkspace();
    await saveAvailableElementsLibrary({ version: 1, folders: state.elementFolders, elements: state.elements }, { projectId, projectName: projectNameRef.current });
    savePendingRef.current = false;
    return { saved: projectId };
  } }), [state, hydrationComplete, hydrationError, persistWorkspace, projectId, mcpHasRunningJobs]);

  return (
    <WorkspaceContext.Provider value={{ state, dispatch: wrappedDispatch, projectId }}>
      <TopTabs
        activeTab={state.activeTab}
        onTabChange={handleTabChange}
        onBackToHome={onBackToHome}
        showSkillsButton={state.activeTab === 'llm'}
        onOpenSkills={() => setOpenSkillBuilderSignal((value) => value + 1)}
        hasActiveSkill={llmHasActiveSkill}
        llmCopilotStatus={llmCopilotStatus}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => {
          setVoiceDirectorOpen(false);
          setAssistantOpen((open) => !open);
        }}
        voiceDirectorOpen={voiceDirectorOpen}
        onToggleVoiceDirector={toggleVoiceDirector}
      />
      <main className="workspace-content" aria-busy={!hydrationComplete}>
        {hydrationError ? (
          <WorkspaceLoadingState
            error={hydrationError}
            onRetry={() => { setHydrationComplete(false); setHydrationError(null); setLoadAttempt(attempt => attempt + 1); }}
            onBack={onBackToHome}
          />
        ) : !hydrationComplete ? (
          <WorkspaceLoadingState />
        ) : (
          <>
            {state.activeTab === 'elements' && <ElementsTab />}
            {state.activeTab === 'create' && <CreateTab />}
            {directorMounted.current && <div hidden={state.activeTab !== 'director'} style={state.activeTab === 'director' ? { display: 'contents' } : undefined}><DirectorTab /></div>}
            {state.activeTab === 'edit' && <EditTab llmJumpRequest={llmJumpRequest} />}
            <div className={`workspace-tab-panel${state.activeTab === 'llm' ? ' workspace-tab-panel--active' : ''}`}>
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
                openSkillBuilderSignal={openSkillBuilderSignal}
                onActiveSkillPresenceChange={setLlmHasActiveSkill}
                isTabActive={state.activeTab === 'llm'}
                onCopilotThinkingChange={handleCopilotThinkingChange}
                onCopilotResponseReadyWhileBackgrounded={handleCopilotResponseReady}
              />
            </div>
            {state.activeTab === 'export' && <ExportTab />}
            {state.activeTab === 'settings' && (
              <SettingsPage
                projectId={projectId}
                useSqlite={useSqlite}
                onBack={() => wrappedDispatch({ type: 'SET_TAB', tab: 'create' })}
              />
            )}
          </>
        )}
      </main>
      <AppToastHost
        toast={appToast}
        onDismiss={dismissCopilotToast}
        onAction={handleCopilotToastAction}
      />
      <AssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        projectId={projectId}
        state={state}
        dispatch={wrappedDispatch}
      />
      <VoiceDirectorOverlay
        open={voiceDirectorOpen}
        state={state}
        onClose={() => setVoiceDirectorOpen(false)}
        onApplyDirector={applyVoiceDirector}
        onUndo={undoVoiceDirector}
      />
    </WorkspaceContext.Provider>
  );
}
