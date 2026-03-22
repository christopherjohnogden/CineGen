import '@/styles/edit-tab.css';
import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { TimelineEditor } from './timeline-editor';
import { LeftPanel } from './left-panel';
import { SourceViewer } from './source-viewer';
import { TimelineViewer } from './timeline-viewer';
import { ToolSidebar } from './tool-sidebar';
import { TimelineTabs } from './timeline-tabs';
import { TimelineBottomBar } from './timeline-bottom-bar';
import { ResizeHandle } from './resize-handle';
import { ClipPropertiesPanel } from './clip-properties-panel';
import { useEditorLayout } from './use-editor-layout';
import { usePlaybackEngine } from './use-playback-engine';
import { useNativeVideoSurface } from './use-native-video-surface';
import { useNativeTimelineVideo } from './use-native-timeline-video';
import { isHtmlOnlyAsset } from '@/lib/editor/visual-playback-state';
import {
  calculateTimelineDuration,
  addTrack,
  createDefaultTimeline,
  updateClipProperties,
  addKeyframe,
  removeKeyframe,
} from '@/lib/editor/timeline-operations';
import type { PlaybackProxyMode } from '@/lib/editor/playback-engine';
import { generateId } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import { isMediaDebugEnabled, mediaDebug, mediaDebugError } from '@/lib/debug/media-debug';
import type { Asset } from '@/types/project';
import type { Clip, ToolType, TrackKind, Keyframe, TimelineMarker } from '@/types/timeline';

const PROXY_MODE_STORAGE_KEY = 'cinegen_proxy_mode';
const EDIT_VIEW_STORAGE_PREFIX = 'cinegen_edit_view_v1';

interface PersistedTimelineView {
  playhead: number;
  scrollLeft: number;
  vaSplit: number;
}

interface PersistedEditView {
  pxPerSecond: number;
  snapEnabled: boolean;
  trackHeight: number;
  timelineViews: Record<string, PersistedTimelineView>;
}

interface LlmJumpRequest {
  id: string;
  type: 'asset' | 'timeline';
  time: number;
  assetId?: string;
  timelineId?: string;
}

function defaultTimelineView(): PersistedTimelineView {
  return { playhead: 0, scrollLeft: 0, vaSplit: 0.5 };
}

function loadPersistedEditView(projectId: string): PersistedEditView {
  try {
    const raw = localStorage.getItem(`${EDIT_VIEW_STORAGE_PREFIX}:${projectId}`);
    if (!raw) {
      return {
        pxPerSecond: 50,
        snapEnabled: true,
        trackHeight: 80,
        timelineViews: {},
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedEditView>;
    return {
      pxPerSecond: Number.isFinite(parsed.pxPerSecond) ? Number(parsed.pxPerSecond) : 50,
      snapEnabled: typeof parsed.snapEnabled === 'boolean' ? parsed.snapEnabled : true,
      trackHeight: Number.isFinite(parsed.trackHeight) ? Number(parsed.trackHeight) : 80,
      timelineViews: parsed.timelineViews ?? {},
    };
  } catch {
    return {
      pxPerSecond: 50,
      snapEnabled: true,
      trackHeight: 80,
      timelineViews: {},
    };
  }
}

function persistEditView(projectId: string, view: PersistedEditView): void {
  try {
    localStorage.setItem(`${EDIT_VIEW_STORAGE_PREFIX}:${projectId}`, JSON.stringify(view));
  } catch {}
}

export function EditTab({ llmJumpRequest = null }: { llmJumpRequest?: LlmJumpRequest | null }) {
  const { state, dispatch, projectId } = useWorkspace();
  const { layout, setLayout } = useEditorLayout();

  const timeline = getActiveTimeline(state);
  const [initialPersistedView] = useState<PersistedEditView>(() => loadPersistedEditView(projectId));
  const persistedViewRef = useRef<PersistedEditView>(initialPersistedView);
  const persistTimerRef = useRef<number | null>(null);
  const [timelineView, setTimelineView] = useState<PersistedTimelineView>(() => (
    persistedViewRef.current.timelineViews[timeline.id] ?? defaultTimelineView()
  ));
  const schedulePersistEditView = useCallback(() => {
    if (persistTimerRef.current !== null) return;
    persistTimerRef.current = window.setTimeout(() => {
      persistEditView(projectId, persistedViewRef.current);
      persistTimerRef.current = null;
    }, 250);
  }, [projectId]);
  const updatePersistedTimelineView = useCallback((timelineId: string, patch: Partial<PersistedTimelineView>) => {
    const current = persistedViewRef.current.timelineViews[timelineId] ?? defaultTimelineView();
    persistedViewRef.current = {
      ...persistedViewRef.current,
      timelineViews: {
        ...persistedViewRef.current.timelineViews,
        [timelineId]: { ...current, ...patch },
      },
    };
    schedulePersistEditView();
  }, [schedulePersistEditView]);
  const [initialProxyMode] = useState<PlaybackProxyMode>(() => {
    try {
      const raw = localStorage.getItem(PROXY_MODE_STORAGE_KEY);
      if (raw === 'on' || raw === 'auto' || raw === 'off') return raw;
    } catch {}
    return 'auto';
  });
  const [nativeVideoAvailable, setNativeVideoAvailable] = useState(false);
  const proxyQueueInFlightRef = useRef(new Set<string>());

  const handleProxyFallbackRequest = useCallback((assetIds: string[]) => {
    for (const assetId of assetIds) {
      if (proxyQueueInFlightRef.current.has(assetId)) continue;
      const asset = state.assets.find((a) => a.id === assetId);
      if (!asset || asset.type !== 'video' || !asset.fileRef || asset.proxyRef) continue;

      proxyQueueInFlightRef.current.add(assetId);
      mediaDebug('queue proxy (auto fallback)', { assetId: asset.id, inputPath: asset.fileRef });
      window.electronAPI.media.queueProcessing({
        assetId: asset.id,
        projectId,
        inputPath: asset.fileRef,
        needsProxy: true,
        includeThumbnail: false,
        includeWaveform: false,
        includeFilmstrip: false,
      }).then(() => {
        mediaDebug('proxy queue submitted', { assetId: asset.id });
      }).catch((err) => {
        mediaDebugError('proxy queue failed', { assetId: asset.id, error: String(err) });
        console.error('[edit] Auto proxy queue failed:', err);
      }).finally(() => {
        setTimeout(() => {
          proxyQueueInFlightRef.current.delete(assetId);
        }, 30000);
      });
    }
  }, [projectId, state.assets]);

  useEffect(() => {
    for (const asset of state.assets) {
      if (asset.proxyRef) proxyQueueInFlightRef.current.delete(asset.id);
    }
  }, [state.assets]);

  // Playback engine (replaces inline RAF loop, video pool, audio mixer)
  const {
    currentTime,
    isPlaying,
    activeClips: engineActiveClips,
    proxyMode,
    setProxyMode,
    togglePlayPause,
    seek,
    setVideoContainer,
    setMetadataPreloadEnabled,
    handleSystemWake,
  } = usePlaybackEngine(timeline, state.assets, {
    initialProxyMode,
    onProxyFallbackRequest: handleProxyFallbackRequest,
  });

  const hasHtmlOnlyActiveVisuals = useMemo(() => engineActiveClips.some((entry) => (
    (entry.asset.type === 'video' || entry.asset.type === 'image') && isHtmlOnlyAsset(entry.asset)
  )), [engineActiveClips]);
  const timelineNativeVideoEnabled = nativeVideoAvailable && !hasHtmlOnlyActiveVisuals;

  useEffect(() => {
    setMetadataPreloadEnabled(!timelineNativeVideoEnabled);
  }, [timelineNativeVideoEnabled, setMetadataPreloadEnabled]);

  useEffect(() => {
    if (timelineNativeVideoEnabled) {
      setVideoContainer(null);
    }
  }, [timelineNativeVideoEnabled, setVideoContainer]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.nativeVideo.isAvailable()
      .then(({ available, error }) => {
        if (cancelled) return;
        setNativeVideoAvailable(available);
        console.log(`[native-video] renderer playback backend: ${available ? 'AVFoundation' : 'HTML video'}`);
        if (!available && error) {
          console.error('[native-video] unavailable:', error);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[native-video] availability check failed:', err);
        setNativeVideoAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PROXY_MODE_STORAGE_KEY, proxyMode);
    } catch {}
  }, [proxyMode]);

  useEffect(() => {
    return () => {
      window.electronAPI.nativeVideo.destroySurface('timeline-viewer');
      window.electronAPI.nativeVideo.destroySurface('source-viewer');
    };
  }, []);

  useEffect(() => {
    if (!isMediaDebugEnabled()) return;
    mediaDebug('media debug enabled', {
      proxyMode,
      tip: "disable with localStorage.setItem('cinegen_debug_media','0')",
    });
  }, [proxyMode]);

  // Derive visual/audio entries from engine's active clips
  const visualEntry = engineActiveClips.find(
    (e) => e.asset.type === 'video' || e.asset.type === 'image',
  ) ?? null;
  const activeClip = visualEntry?.clip ?? null;
  const activeAsset = visualEntry?.asset ?? null;
  const timelineAspectRatio = activeAsset && activeAsset.width && activeAsset.height
    ? activeAsset.width / activeAsset.height
    : null;
  const audioEntries = engineActiveClips.filter((e) => e.asset.type === 'audio');
  const {
    surfaceRef: timelineNativeSurfaceRef,
    syncRect: syncTimelineNativeSurfaceRect,
    surfaceVersion: timelineSurfaceVersion,
  } = useNativeVideoSurface({
    surfaceId: 'timeline-viewer',
    enabled: timelineNativeVideoEnabled,
    fitAspectRatio: timelineAspectRatio,
  });

  useEffect(() => {
    return window.electronAPI.app.onPowerEvent(({ type }) => {
      if (type !== 'resume' && type !== 'unlock-screen') return;
      handleSystemWake();
      syncTimelineNativeSurfaceRect();
    });
  }, [handleSystemWake, syncTimelineNativeSurfaceRect]);

  useNativeTimelineVideo({
    enabled: timelineNativeVideoEnabled,
    surfaceId: 'timeline-viewer',
    timeline,
    assets: state.assets,
    activeClips: engineActiveClips,
    currentTime,
    isPlaying,
    proxyMode,
    surfaceVersion: timelineSurfaceVersion,
  });

  useLayoutEffect(() => {
    if (!timelineNativeVideoEnabled) return;
    syncTimelineNativeSurfaceRect();
    const frameA = window.requestAnimationFrame(syncTimelineNativeSurfaceRect);
    const frameB = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(syncTimelineNativeSurfaceRect);
    });
    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [
    timelineNativeVideoEnabled,
    layout.sourceViewerVisible,
    layout.inspectorVisible,
    syncTimelineNativeSurfaceRect,
  ]);

  useEffect(() => {
    if (!nativeVideoAvailable || layout.sourceViewerVisible) return;
    window.electronAPI.nativeVideo.clearSurface('source-viewer');
    window.electronAPI.nativeVideo.setSurfaceHidden({
      surfaceId: 'source-viewer',
      hidden: true,
    });
  }, [layout.sourceViewerVisible, nativeVideoAvailable]);

  // Add padding past last clip so playhead can seek beyond
  const sequenceDuration = Math.max(timeline.duration + Math.max(10, timeline.duration * 0.5), 1);

  // Mute/solo for UI display only (dimming muted track headers)
  const mutedTrackIds = useMemo(() => {
    const hasSolo = timeline.tracks.some((t) => t.solo);
    const ids = new Set<string>();
    for (const track of timeline.tracks) {
      if (hasSolo ? !track.solo : track.muted) ids.add(track.id);
    }
    return ids;
  }, [timeline.tracks]);

  // Clip selection — auto-expand to include linked clips
  const [selectedClipIds, setSelectedClipIdsRaw] = useState<Set<string>>(new Set());
  const setSelectedClipIds = useCallback((ids: Set<string>) => {
    if (ids.size === 0) { setSelectedClipIdsRaw(ids); return; }
    const expanded = new Set(ids);
    for (const id of ids) {
      const clip = timeline.clips.find((c) => c.id === id);
      if (clip?.linkedClipIds) {
        for (const lid of clip.linkedClipIds) expanded.add(lid);
      }
    }
    setSelectedClipIdsRaw(expanded);
  }, [timeline.clips]);

  // Trim preview
  const [trimPreview, setTrimPreview] = useState<{ clipId: string; sourceTime: number } | null>(null);

  // Tool state
  const [activeTool, setActiveTool] = useState<ToolType>('select');

  // Source viewer clip (set on double-click)
  const [sourceViewerEntry, setSourceViewerEntry] = useState<{ clip: Clip | null; asset: Asset } | null>(null);
  const [sourceViewerSeekRequest, setSourceViewerSeekRequest] = useState<{ id: string; time: number } | null>(null);
  const handledLlmJumpRef = useRef<string | null>(null);

  const handleClipDoubleClick = useCallback((clipId: string) => {
    const clip = timeline.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const asset = state.assets.find((a) => a.id === clip.assetId);
    if (!asset) return;
    setSourceViewerEntry({ clip, asset });
    setLayout({ sourceViewerVisible: true });
  }, [timeline.clips, state.assets, setLayout]);

  const handleAssetDoubleClick = useCallback((asset: Asset) => {
    setSourceViewerEntry({ clip: null, asset });
    setLayout({ sourceViewerVisible: true });
  }, [setLayout]);

  // Zoom / snap / track height
  const [pxPerSecond, setPxPerSecond] = useState(() => persistedViewRef.current.pxPerSecond);
  const [snapEnabled, setSnapEnabled] = useState(() => persistedViewRef.current.snapEnabled);
  const [trackHeight, setTrackHeight] = useState(() => persistedViewRef.current.trackHeight);

  // Suppress unused for UI-only mutedTrackIds (consumed by track styling below)
  void mutedTrackIds;
  // Suppress unused for audioEntries (may be used by future sub-components)
  void audioEntries;

  const dragDurationProbeRef = useRef(new Set<string>());

  // Find the asset for a clip by ID (for trim preview)
  const trimPreviewAsset: Asset | null = useMemo(() => {
    if (!trimPreview) return null;
    const clip = timeline.clips.find((c) => c.id === trimPreview.clipId);
    if (clip) {
      return state.assets.find((a) => a.id === clip.assetId) ?? null;
    }
    return null;
  }, [trimPreview, timeline, state.assets]);

  const handleTrimPreview = useCallback((clipId: string, sourceTime: number) => {
    setTrimPreview({ clipId, sourceTime });
  }, []);

  const handleTrimPreviewEnd = useCallback(() => {
    setTrimPreview(null);
  }, []);

  useEffect(() => {
    persistedViewRef.current = {
      ...persistedViewRef.current,
      pxPerSecond,
      snapEnabled,
      trackHeight,
    };
    schedulePersistEditView();
  }, [pxPerSecond, snapEnabled, trackHeight, schedulePersistEditView]);

  useEffect(() => {
    const saved = persistedViewRef.current.timelineViews[timeline.id] ?? defaultTimelineView();
    setTimelineView(saved);
    const jumpTarget = llmJumpRequest?.type === 'timeline'
      && (!llmJumpRequest.timelineId || llmJumpRequest.timelineId === timeline.id)
      ? Math.max(0, llmJumpRequest.time)
      : null;
    const raf = window.requestAnimationFrame(() => {
      seek(jumpTarget ?? Math.max(0, saved.playhead));
    });
    return () => window.cancelAnimationFrame(raf);
  }, [llmJumpRequest, timeline.id, seek]);

  useEffect(() => {
    updatePersistedTimelineView(timeline.id, { playhead: Math.max(0, currentTime) });
  }, [timeline.id, currentTime, updatePersistedTimelineView]);

  useEffect(() => {
    if (!llmJumpRequest) return;
    if (handledLlmJumpRef.current === llmJumpRequest.id) return;

    if (llmJumpRequest.type === 'timeline') {
      if (llmJumpRequest.timelineId && llmJumpRequest.timelineId !== timeline.id) return;
      handledLlmJumpRef.current = llmJumpRequest.id;
      seek(Math.max(0, llmJumpRequest.time));
      return;
    }

    if (!llmJumpRequest.assetId) return;
    const asset = state.assets.find((entry) => entry.id === llmJumpRequest.assetId);
    if (!asset) return;
    handledLlmJumpRef.current = llmJumpRequest.id;
    setSourceViewerEntry({ clip: null, asset });
    setSourceViewerSeekRequest({
      id: llmJumpRequest.id,
      time: Math.max(0, llmJumpRequest.time),
    });
    setLayout({ sourceViewerVisible: true });
  }, [llmJumpRequest, seek, setLayout, state.assets, timeline.id]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      persistEditView(projectId, persistedViewRef.current);
    };
  }, [projectId]);

  const handleTimelineScrollPersist = useCallback((scrollLeft: number) => {
    setTimelineView((prev) => (prev.scrollLeft === scrollLeft ? prev : { ...prev, scrollLeft }));
    updatePersistedTimelineView(timeline.id, { scrollLeft: Math.max(0, scrollLeft) });
  }, [timeline.id, updatePersistedTimelineView]);

  const handleTimelineVaSplitPersist = useCallback((vaSplit: number) => {
    setTimelineView((prev) => (prev.vaSplit === vaSplit ? prev : { ...prev, vaSplit }));
    updatePersistedTimelineView(timeline.id, { vaSplit: Math.max(0.15, Math.min(0.85, vaSplit)) });
  }, [timeline.id, updatePersistedTimelineView]);

  // Spacebar / Arrow keys / Tool shortcuts
  useEffect(() => {
    const FRAME_DURATION = 1 / 24;
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(currentTime + FRAME_DURATION);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(currentTime - FRAME_DURATION, 0));
      } else if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
      } else if (e.key === 'a' || e.key === 'A') {
        setActiveTool('trackForward');
      } else if (e.key === 'b' || e.key === 'B') {
        setActiveTool('blade');
      } else if (e.key === 'y' || e.key === 'Y') {
        setActiveTool('slip');
      } else if (e.key === 'u' || e.key === 'U') {
        setActiveTool('slide');
      } else if (e.key === 'r' || e.key === 'R') {
        setActiveTool('ripple');
      } else if (e.key === 'n' || e.key === 'N') {
        setActiveTool('roll');
      } else if (e.key === 'g' || e.key === 'G') {
        setActiveTool('fillGap');
      } else if (e.key === 'e' || e.key === 'E') {
        setActiveTool('extend');
      } else if (e.key === 'x' || e.key === 'X') {
        setActiveTool('mask');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayPause, seek, currentTime, sequenceDuration]);

  // Delete selected clips
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (selectedClipIds.size === 0) return;
      e.preventDefault();
      setSelectedClipIds(new Set());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedClipIds]);

  // -------------------------
  // Timeline management
  // -------------------------

  const handleSwitchTimeline = useCallback((id: string) => {
    dispatch({ type: 'OPEN_TIMELINE', timelineId: id });
  }, [dispatch]);

  const handleCreateTimeline = useCallback(() => {
    const count = state.timelines.length + 1;
    const newTimeline = createDefaultTimeline(`Timeline ${count}`);
    dispatch({ type: 'ADD_TIMELINE', timeline: newTimeline });
  }, [dispatch, state.timelines.length]);

  const handleRenameTimeline = useCallback((id: string, name: string) => {
    const tl = state.timelines.find((t) => t.id === id);
    if (!tl) return;
    dispatch({ type: 'SET_TIMELINE', timelineId: id, timeline: { ...tl, name } });
  }, [dispatch, state.timelines]);

  const handleDuplicateTimeline = useCallback((id: string) => {
    const tl = state.timelines.find((t) => t.id === id);
    if (!tl) return;
    const copy = {
      ...tl,
      id: generateId(),
      name: `${tl.name} Copy`,
      tracks: tl.tracks.map((track) => ({ ...track, id: generateId() })),
      clips: tl.clips.map((clip) => ({ ...clip, id: generateId() })),
    };
    dispatch({ type: 'ADD_TIMELINE', timeline: copy });
  }, [dispatch, state.timelines]);

  const handleDeleteTimeline = useCallback((id: string) => {
    if (state.timelines.length <= 1) return;
    dispatch({ type: 'REMOVE_TIMELINE', timelineId: id });
  }, [dispatch, state.timelines.length]);

  const handleAddTrack = useCallback((kind: TrackKind | TrackKind[]) => {
    const kinds = Array.isArray(kind) ? kind : [kind];
    let updated = timeline;
    let pairedColor: string | undefined;
    for (const k of kinds) {
      updated = addTrack(updated, k, pairedColor);
      if (k === 'video' && kinds.length > 1) {
        // Use the video track's color for the paired audio track
        const lastTrack = updated.tracks.filter((t) => t.kind === 'video').at(-1);
        pairedColor = lastTrack?.color;
      }
    }
    dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
  }, [dispatch, timeline]);

  const handleAddMarker = useCallback(() => {
    const time = currentTime;
    if ((timeline.markers ?? []).some((m) => Math.abs(m.time - time) < 0.01)) return;
    const marker: TimelineMarker = {
      id: generateId(),
      time,
      color: '#f1c40f',
      label: '',
    };
    dispatch({
      type: 'SET_TIMELINE',
      timelineId: timeline.id,
      timeline: { ...timeline, markers: [...(timeline.markers ?? []), marker] },
    });
  }, [dispatch, timeline, currentTime]);

  // -------------------------
  // Drag asset — store reference for ghost preview on timeline
  // -------------------------

  const [draggingAsset, setDraggingAsset] = useState<Asset | null>(null);

  const ensureDurationForDrag = useCallback((asset: Asset) => {
    if ((asset.duration ?? 0) > 0) return;
    if (asset.type !== 'video' && asset.type !== 'audio') return;
    if (dragDurationProbeRef.current.has(asset.id)) return;

    const source = toFileUrl(asset.fileRef || asset.url);
    if (!source) return;

    dragDurationProbeRef.current.add(asset.id);

    const finalize = (duration?: number) => {
      dragDurationProbeRef.current.delete(asset.id);
      if (!duration || !Number.isFinite(duration) || duration <= 0) return;

      dispatch({
        type: 'UPDATE_ASSET',
        asset: { id: asset.id, duration, status: 'online' },
      });

      setDraggingAsset((prev) => (
        prev?.id === asset.id ? { ...prev, duration } : prev
      ));
    };

    if (asset.type === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = source;
      video.addEventListener('loadedmetadata', () => finalize(video.duration), { once: true });
      video.addEventListener('error', () => finalize(), { once: true });
      video.load();
    } else {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = source;
      audio.addEventListener('loadedmetadata', () => finalize(audio.duration), { once: true });
      audio.addEventListener('error', () => finalize(), { once: true });
      audio.load();
    }
  }, [dispatch]);

  const handleDragAsset = useCallback((asset: Asset) => {
    const fromState = state.assets.find((a) => a.id === asset.id);
    const latest = (() => {
      if (!fromState) return asset;
      const stateDuration = fromState.duration ?? 0;
      const incomingDuration = asset.duration ?? 0;
      if (incomingDuration > stateDuration) {
        return { ...fromState, ...asset, duration: incomingDuration };
      }
      return fromState;
    })();
    setDraggingAsset(latest);
    ensureDurationForDrag(latest);
  }, [state.assets, ensureDurationForDrag]);

  // Clear dragging asset on global dragend
  useEffect(() => {
    const onDragEnd = () => setDraggingAsset(null);
    window.addEventListener('dragend', onDragEnd);
    return () => window.removeEventListener('dragend', onDragEnd);
  }, []);

  // -------------------------
  // Layout resize handlers
  // -------------------------

  const handleLeftPanelResize = useCallback((delta: number) => {
    setLayout({ leftPanelWidth: layout.leftPanelWidth + delta });
  }, [layout.leftPanelWidth, setLayout]);

  const handleViewerTimelineSplitResize = useCallback((delta: number) => {
    const APPROX_HEIGHT = 600;
    setLayout({
      viewerTimelineSplit: layout.viewerTimelineSplit + delta / APPROX_HEIGHT,
    });
  }, [layout.viewerTimelineSplit, setLayout]);

  const handleTogglePanelMode = useCallback(() => {
    setLayout({ leftPanelMode: layout.leftPanelMode === 'full' ? 'compact' : 'full' });
  }, [layout.leftPanelMode, setLayout]);

  const handleCloseSourceViewer = useCallback(() => {
    setSourceViewerEntry(null);
    setSourceViewerSeekRequest(null);
    setLayout({ sourceViewerVisible: false });
  }, [setLayout]);

  const handleSourceDropAssetId = useCallback((assetId: string) => {
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset) return;
    setSourceViewerEntry({ clip: null, asset });
    setSourceViewerSeekRequest({ id: `source-drop-${assetId}`, time: 0 });
    setLayout({ sourceViewerVisible: true });
  }, [state.assets, setLayout]);

  const resolvedSourceViewerAsset = useMemo(() => {
    if (!sourceViewerEntry) return null;
    return state.assets.find((asset) => asset.id === sourceViewerEntry.asset.id) ?? null;
  }, [sourceViewerEntry, state.assets]);
  const sourceViewerNativeVideoEnabled = nativeVideoAvailable
    && activeTool !== 'mask'
    && !isHtmlOnlyAsset(resolvedSourceViewerAsset);

  useEffect(() => {
    if (activeTool !== 'mask') return;
    if (!layout.sourceViewerVisible) {
      setLayout({ sourceViewerVisible: true });
    }
    if (sourceViewerEntry?.asset.type === 'video') return;
    if (!activeClip || !activeAsset || activeAsset.type !== 'video') return;
    setSourceViewerEntry({ clip: activeClip, asset: activeAsset });
    setSourceViewerSeekRequest({
      id: `mask-open-${activeClip.id}`,
      time: Math.max(0, activeClip.trimStart),
    });
  }, [activeAsset, activeClip, activeTool, layout.sourceViewerVisible, setLayout, sourceViewerEntry]);

  const handleToggleSourceViewer = useCallback(() => {
    setLayout({ sourceViewerVisible: !layout.sourceViewerVisible });
  }, [layout.sourceViewerVisible, setLayout]);

  const handleAcceptMaskedVideo = useCallback(async ({
    url,
    outputKind,
    promptCount,
    detectionThreshold,
    currentFrameIndex,
    sourceTimeSeconds,
    sourceWasTrimmed = false,
  }: {
    url: string;
    outputKind: 'image' | 'video';
    promptCount: number;
    detectionThreshold: number;
    currentFrameIndex: number;
    sourceTimeSeconds: number;
    sourceWasTrimmed?: boolean;
  }) => {
    const sourceAsset = resolvedSourceViewerAsset;
    if (!sourceAsset) return;

    const baseName = sourceAsset.name.replace(/\.[^/.]+$/, '');
    const isFrameOutput = outputKind === 'image';
    const sourceClip = sourceViewerEntry?.clip ?? null;
    const frameDuration = sourceAsset.fps && Number.isFinite(sourceAsset.fps) && sourceAsset.fps > 0
      ? 1 / sourceAsset.fps
      : 1 / 30;
    const visibleClipDuration = sourceClip
      ? Math.max(0.1, (sourceClip.duration - sourceClip.trimStart - sourceClip.trimEnd) / Math.max(0.0001, sourceClip.speed || 1))
      : (sourceAsset.duration ?? 0);
    const maskedAsset: Asset = {
      id: generateId(),
      name: `${baseName} ${isFrameOutput ? 'Mask Frame' : 'Mask'}`,
      type: isFrameOutput ? 'image' : 'video',
      url,
      sourceUrl: url,
      thumbnailUrl: sourceAsset.thumbnailUrl ?? url,
      duration: isFrameOutput ? frameDuration : (sourceWasTrimmed ? visibleClipDuration : (sourceAsset.duration ?? sourceViewerEntry?.clip?.duration ?? 0)),
      width: sourceAsset.width,
      height: sourceAsset.height,
      fps: sourceAsset.fps,
      createdAt: new Date().toISOString(),
      status: 'online',
      metadata: {
        generatedBy: isFrameOutput ? 'sam3-local-frame-mask' : 'sam3-mask',
        sam3Mask: true,
        forceHtmlPlayback: true,
        transparentOverlay: true,
        sam3MaskMode: outputKind,
        sourceAssetId: sourceAsset.id,
        sourceClipId: sourceClip?.id ?? null,
        promptCount,
        detectionThreshold,
        sourceFrameIndex: currentFrameIndex,
        sourceTimeSeconds,
      },
    };

    dispatch({ type: 'ADD_ASSET', asset: maskedAsset });

    if (sourceClip) {
      let nextTimeline = timeline;
      let videoTracks = nextTimeline.tracks.filter((track) => track.kind === 'video');
      const sourceTrackIndex = videoTracks.findIndex((track) => track.id === sourceClip.trackId);
      let targetTrack = sourceTrackIndex >= 0 ? videoTracks[sourceTrackIndex + 1] : undefined;

      if (!targetTrack) {
        nextTimeline = addTrack(nextTimeline, 'video');
        videoTracks = nextTimeline.tracks.filter((track) => track.kind === 'video');
        targetTrack = videoTracks.at(-1);
      }

      if (targetTrack) {
        const safeSpeed = sourceClip.speed > 0 ? sourceClip.speed : 1;
        const clampedSourceTime = Math.max(
          sourceClip.trimStart,
          Math.min(sourceTimeSeconds, sourceClip.duration - sourceClip.trimEnd),
        );
        const frameStartTime = sourceClip.startTime + Math.max(0, (clampedSourceTime - sourceClip.trimStart) / safeSpeed);
        const maskedClip: Clip = {
          id: generateId(),
          assetId: maskedAsset.id,
          trackId: targetTrack.id,
          name: maskedAsset.name,
          startTime: isFrameOutput ? frameStartTime : sourceClip.startTime,
          duration: isFrameOutput ? frameDuration : (maskedAsset.duration || sourceClip.duration),
          trimStart: isFrameOutput || sourceWasTrimmed ? 0 : sourceClip.trimStart,
          trimEnd: isFrameOutput || sourceWasTrimmed ? 0 : sourceClip.trimEnd,
          speed: isFrameOutput ? 1 : sourceClip.speed,
          opacity: 1,
          volume: 0,
          flipH: sourceClip.flipH,
          flipV: sourceClip.flipV,
          keyframes: [],
        };

        nextTimeline = {
          ...nextTimeline,
          clips: [...nextTimeline.clips, maskedClip],
        };
        nextTimeline = {
          ...nextTimeline,
          duration: calculateTimelineDuration(nextTimeline),
        };

        dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: nextTimeline });
        setSelectedClipIds(new Set([maskedClip.id]));
      }
    }

    setSourceViewerEntry({ clip: null, asset: maskedAsset });
    setSourceViewerSeekRequest({ id: `mask-result-${maskedAsset.id}`, time: sourceViewerEntry?.clip?.trimStart ?? 0 });
    setActiveTool('select');
    setLayout({ sourceViewerVisible: true });
  }, [dispatch, resolvedSourceViewerAsset, setLayout, sourceViewerEntry, timeline]);

  // trimPreviewAsset is computed above and consumed
  // by TimelineEditor via closure or forwarded props in future tasks.
  // Suppress "assigned but never read" warnings.
  void trimPreviewAsset;

  // -------------------------
  // Right panel (clip properties)
  // -------------------------

  const selectedClip = useMemo(() => {
    if (selectedClipIds.size !== 1) return null;
    const clipId = [...selectedClipIds][0];
    return timeline.clips.find((c) => c.id === clipId) ?? null;
  }, [selectedClipIds, timeline.clips]);

  const selectedClipAsset = useMemo(() => {
    if (!selectedClip) return null;
    return state.assets.find((a) => a.id === selectedClip.assetId) ?? null;
  }, [selectedClip, state.assets]);

  const handleUpdateClipProps = useCallback(
    (clipId: string, updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => {
      const updated = updateClipProperties(timeline, clipId, updates);
      dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
    },
    [dispatch, timeline],
  );

  const handleAddKeyframe = useCallback(
    (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => {
      const kf: Keyframe = { time, property, value };
      const updated = addKeyframe(timeline, clipId, kf);
      dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
    },
    [dispatch, timeline],
  );

  const handleRemoveKeyframe = useCallback(
    (clipId: string, index: number) => {
      const updated = removeKeyframe(timeline, clipId, index);
      dispatch({ type: 'SET_TIMELINE', timelineId: timeline.id, timeline: updated });
    },
    [dispatch, timeline],
  );

  const handleRightPanelResize = useCallback((delta: number) => {
    setLayout({ rightPanelWidth: layout.rightPanelWidth - delta }); // subtract because dragging left makes panel wider
  }, [layout.rightPanelWidth, setLayout]);

  const handleToggleInspector = useCallback(() => {
    setLayout({ inspectorVisible: !layout.inspectorVisible });
  }, [layout.inspectorVisible, setLayout]);

  const handleCloseRightPanel = useCallback(() => {
    setLayout({ inspectorVisible: false });
  }, [setLayout]);

  const isCompact = layout.leftPanelMode === 'compact';

  return (
    <div
      className="edit-tab"
      data-panel-mode={isCompact ? 'compact' : 'full'}
      data-right-panel={layout.inspectorVisible ? 'true' : undefined}
      style={{
        '--left-panel-width': `${layout.leftPanelWidth}px`,
        '--right-panel-width': `${layout.rightPanelWidth}px`,
        '--viewer-split': `${Math.round(layout.viewerTimelineSplit * 100)}%`,
      } as React.CSSProperties}
    >
      {/* Left panel */}
      <LeftPanel
        assets={state.assets}
        mediaFolders={state.mediaFolders}
        timelines={state.timelines}
        activeTimelineId={state.activeTimelineId}
        onSwitchTimeline={handleSwitchTimeline}
        onDragAsset={handleDragAsset}
        panelMode={layout.leftPanelMode}
        onToggleMode={handleTogglePanelMode}
        onDeleteTimeline={handleDeleteTimeline}
        onAssetDoubleClick={handleAssetDoubleClick}
        onAddFolder={(folder) => dispatch({ type: 'ADD_FOLDER', folder })}
        onRemoveFolder={(folderId) => dispatch({ type: 'REMOVE_FOLDER', folderId })}
        onRenameFolder={(folderId, name) => dispatch({ type: 'UPDATE_FOLDER', folder: { id: folderId, name } })}
        onUpdateAsset={(asset) => dispatch({ type: 'UPDATE_ASSET', asset })}
        onRemoveAsset={(assetId) => dispatch({ type: 'REMOVE_ASSET', assetId })}
        onRemoveAssets={(assetIds) => dispatch({ type: 'REMOVE_ASSETS', assetIds })}
        projectId={projectId}
        onAddAsset={(asset) => dispatch({ type: 'ADD_ASSET', asset })}
        onAddTimeline={(timeline) => dispatch({ type: 'ADD_TIMELINE', timeline })}
      />
      <ResizeHandle
        direction="horizontal"
        onResize={handleLeftPanelResize}
        className="edit-tab__left-resize"
      />

      {/* Viewers */}
      <div className="edit-tab__viewers">
        {layout.sourceViewerVisible && (
          <>
            <SourceViewer
              clip={sourceViewerEntry?.clip ?? null}
              asset={resolvedSourceViewerAsset}
              seekRequest={sourceViewerSeekRequest}
              onClose={handleCloseSourceViewer}
              onDropAssetId={handleSourceDropAssetId}
              nativeVideoEnabled={sourceViewerNativeVideoEnabled}
              proxyMode={proxyMode}
              activeTool={activeTool}
              onAcceptMaskedVideo={handleAcceptMaskedVideo}
            />
            <div className="edit-tab__viewer-divider" />
          </>
        )}

        <TimelineViewer
          videoContainerRef={timelineNativeVideoEnabled ? (() => {}) : setVideoContainer}
          nativeSurfaceRef={timelineNativeSurfaceRef}
          nativeVideoEnabled={timelineNativeVideoEnabled}
          activeAsset={activeAsset}
          currentTime={currentTime}
          duration={sequenceDuration}
          isPlaying={isPlaying}
          onPlayPause={togglePlayPause}
          onSeek={seek}
          proxyMode={proxyMode}
          onProxyModeChange={setProxyMode}
          sourceViewerVisible={layout.sourceViewerVisible}
          onToggleSourceViewer={handleToggleSourceViewer}
          onDropAssetId={handleSourceDropAssetId}
          inspectorVisible={layout.inspectorVisible}
          onToggleInspector={handleToggleInspector}
        />
      </div>

      {/* Vertical resize handle between viewers and timeline area */}
      <ResizeHandle
        direction="vertical"
        onResize={handleViewerTimelineSplitResize}
        className="edit-tab__viewer-timeline-resize"
      />

      {/* Timeline area */}
      <div className="edit-tab__timeline-area">
        <ToolSidebar activeTool={activeTool} onToolChange={setActiveTool} />

        <div className="edit-tab__timeline-content">
          <TimelineTabs
            timelines={state.timelines.filter((tl) => state.openTimelineIds.has(tl.id))}
            activeTimelineId={state.activeTimelineId}
            onSwitch={handleSwitchTimeline}
            onCreate={handleCreateTimeline}
            onRename={handleRenameTimeline}
            onDuplicate={handleDuplicateTimeline}
            onDelete={handleDeleteTimeline}
            onAddTrack={handleAddTrack}
            snapEnabled={snapEnabled}
            onSnapToggle={() => setSnapEnabled((s) => !s)}
            onAddMarker={handleAddMarker}
          />

          {/* Timeline editor -- scrollable track area with integrated ruler */}
          <TimelineEditor
            currentTime={currentTime}
            isPlaying={isPlaying}
            sequenceDuration={sequenceDuration}
            pxPerSecond={pxPerSecond}
            initialScrollLeft={timelineView.scrollLeft}
            initialVaSplit={timelineView.vaSplit}
            snapEnabled={snapEnabled}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            trackHeight={trackHeight}
            onSeek={seek}
            onPlayPause={togglePlayPause}
            selectedClipIds={selectedClipIds}
            onSelectClips={setSelectedClipIds}
            onTrimPreview={handleTrimPreview}
            onTrimPreviewEnd={handleTrimPreviewEnd}
            onScroll={handleTimelineScrollPersist}
            onVaSplitChange={handleTimelineVaSplitPersist}
            onClipDoubleClick={handleClipDoubleClick}
            draggingAsset={draggingAsset}
            onZoomChange={setPxPerSecond}
          />

          <TimelineBottomBar
            pxPerSecond={pxPerSecond}
            onZoomChange={setPxPerSecond}
            onAddTrack={handleAddTrack}
            trackHeight={trackHeight}
            onTrackHeightChange={setTrackHeight}
            trackCount={timeline.tracks.length}
            sequenceDuration={sequenceDuration}
          />
        </div>
      </div>

      {/* Right panel: clip properties */}
      {layout.inspectorVisible && (
        <ResizeHandle
          direction="horizontal"
          onResize={handleRightPanelResize}
          className="edit-tab__right-resize"
        />
      )}
      {layout.inspectorVisible && (
        <ClipPropertiesPanel
          clip={selectedClip}
          asset={selectedClipAsset}
          onUpdateClip={handleUpdateClipProps}
          onAddKeyframe={handleAddKeyframe}
          onRemoveKeyframe={handleRemoveKeyframe}
          onClose={handleCloseRightPanel}
        />
      )}
    </div>
  );
}
