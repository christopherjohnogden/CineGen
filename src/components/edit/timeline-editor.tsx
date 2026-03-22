

import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { TrackRow } from './track-row';
import { formatTimecode } from './time-ruler';
import { MusicGenerationPopup } from './music-generation-popup';
import { FillGapModal } from './fill-gap-modal';
import { ExtendModal } from './extend-modal';
import { useTimelineDrag } from './use-timeline-drag';
import {
  removeClip,
  trimClip,
  moveClip,
  duplicateClips,
  snapToHalfSecond,
  addClipToTrack,
  addTrack,
  removeTrack,
  removeTransition,
  addKeyframe,
  moveKeyframe,
  removeKeyframe,
  updateClipProperties,
  syncClips,
  linkClips,
  unlinkClips,
  getLinkedIds,
} from '@/lib/editor/timeline-operations';
import { SyncAudioDialog } from './sync-audio-dialog';
import { extractWaveformPeaks } from '@/lib/editor/waveform';
import { generateId } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import aiSvg from '@/assets/ai.svg';
import linkSvg from '@/assets/link.svg';
import unlinkSvg from '@/assets/unlink.svg';
import type { Timeline, Clip as TimelineClip, ToolType, Keyframe, TimelineMarker } from '@/types/timeline';
import type { Asset } from '@/types/project';
import type { WorkflowNodeData } from '@/types/workflow';
import { clipEffectiveDuration, clipEndTime, DEFAULT_VIDEO_COLOR, DEFAULT_AUDIO_COLOR } from '@/types/timeline';

const LABEL_WIDTH = 150;
const FPS = 24; // assumed frame rate for snap-to-frame grid

const DEFAULT_TRACK_HEIGHT = 80;


interface TimelineEditorProps {
  currentTime: number;
  isPlaying: boolean;
  sequenceDuration: number;
  pxPerSecond: number;
  initialScrollLeft?: number;
  initialVaSplit?: number;
  snapEnabled: boolean;
  activeTool: ToolType;
  onToolChange?: (tool: ToolType) => void;
  trackHeight: number;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  selectedClipIds: Set<string>;
  onSelectClips: (ids: Set<string>) => void;
  onTrimPreview?: (clipId: string, sourceTime: number) => void;
  onTrimPreviewEnd?: () => void;
  onScroll?: (scrollLeft: number) => void;
  onVaSplitChange?: (split: number) => void;
  onClipDoubleClick?: (clipId: string) => void;
  draggingAsset?: Asset | null;
  onZoomChange?: (pps: number) => void;
}

export function TimelineEditor({
  currentTime,
  isPlaying: _isPlaying,
  sequenceDuration,
  pxPerSecond,
  initialScrollLeft = 0,
  initialVaSplit = 0.5,
  snapEnabled,
  activeTool,
  onToolChange,
  trackHeight: trackHeightProp,
  onSeek: _onSeek,
  onPlayPause: _onPlayPause,
  selectedClipIds,
  onSelectClips,
  onTrimPreview,
  onTrimPreviewEnd,
  onScroll,
  onVaSplitChange,
  onClipDoubleClick,
  draggingAsset,
  onZoomChange,
}: TimelineEditorProps) {
  const { state, dispatch, projectId } = useWorkspace();
  const timeline = getActiveTimeline(state);
  const { assets } = state;

  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const editorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackHeight = trackHeightProp;
  const [bladeX, setBladeX] = useState<number | null>(null);
  const [rulerScrollLeft, setRulerScrollLeft] = useState(0);

  // VA split: fraction of available space allocated to video tracks (0.2–0.8)
  const [vaSplit, setVaSplit] = useState(initialVaSplit);

  // Music tool state
  const [musicRange, setMusicRange] = useState<{ left: number; width: number; trackId: string | null; trackTop: number; trackHeight: number } | null>(null);
  const [musicPopup, setMusicPopup] = useState<{ startTime: number; endTime: number; trackId: string; anchorX: number; anchorY: number } | null>(null);
  const [generatingClipIds, setGeneratingClipIds] = useState<Set<string>>(new Set());
  const [pendingMusicClipId, setPendingMusicClipId] = useState<string | null>(null);
  const musicDragRef = useRef<{ trackId: string; startTime: number; trackTop: number; trackH: number; clipsRect: DOMRect } | null>(null);
  const [musicSnapX, setMusicSnapX] = useState<number | null>(null);
  const [fillGapPreview, setFillGapPreview] = useState<{ trackId: string; startTime: number; endTime: number; trackTop: number; trackHeight: number } | null>(null);
  const [fillGapModalClipId, setFillGapModalClipId] = useState<string | null>(null);

  // Extend tool state
  const [extendDrag, setExtendDrag] = useState<{
    sourceClipId: string;
    trackId: string;
    direction: 'before' | 'after';
    anchorTime: number;
    currentTime: number;
    trackTop: number;
    trackHeight: number;
  } | null>(null);
  const [extendModalClipId, setExtendModalClipId] = useState<string | null>(null);
  const extendDragRef = useRef<typeof extendDrag>(null);

  // Ghost preview state for drag-from-media-pool
  const [ghostInfo, setGhostInfo] = useState<{ trackId: string; leftPx: number; trackTop: number } | null>(null);
  const ghostDragCount = useRef(0);

  // Clip context menu state
  const [clipCtxMenu, setClipCtxMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);
  const [spacesSubOpen, setSpacesSubOpen] = useState<'frame' | 'clip' | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncDialogVideoClipId, setSyncDialogVideoClipId] = useState<string | null>(null);
  const [syncDialogAudioClipId, setSyncDialogAudioClipId] = useState<string | null>(null);
  const clipCtxMenuRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<{ clips: TimelineClip[]; mode: 'copy' | 'cut' } | null>(null);

  // Marker state
  const [markerCtxMenu, setMarkerCtxMenu] = useState<{ markerId: string; x: number; y: number } | null>(null);
  const markerCtxMenuRef = useRef<HTMLDivElement>(null);
  const markerDragRef = useRef<{ markerId: string; startX: number; startTime: number } | null>(null);

  const SNAP_THRESHOLD_PX = 10;

  /** Snap a time to the nearest clip edge on any track (for music tool drag & hover). */
  const snapTimeToClipEdges = useCallback((raw: number): number => {
    const tl = timelineRef.current;
    const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecondRef.current;
    let closest = raw;
    let minDist = thresholdSec;
    for (const clip of tl.clips) {
      const effDur = clipEffectiveDuration(clip);
      for (const edge of [clip.startTime, clip.startTime + effDur]) {
        const dist = Math.abs(raw - edge);
        if (dist < minDist) {
          minDist = dist;
          closest = edge;
        }
      }
    }
    return closest;
  }, []);

  /** Find a gap between two adjacent clips on a video track that contains a given time. */
  const findFillGapAtTime = useCallback((trackId: string, time: number): { startTime: number; endTime: number } | null => {
    const tl = timelineRef.current;
    const track = tl.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'video' || track.locked) return null;

    const clips = tl.clips
      .filter((c) => c.trackId === trackId)
      .sort((a, b) => a.startTime - b.startTime);

    if (clips.length < 2) return null;

    for (let i = 0; i < clips.length - 1; i += 1) {
      const left = clips[i];
      const right = clips[i + 1];
      const gapStart = left.startTime + clipEffectiveDuration(left);
      const gapEnd = right.startTime;
      if (gapEnd - gapStart <= 1 / FPS) continue;
      if (time >= gapStart && time <= gapEnd) {
        return { startTime: gapStart, endTime: gapEnd };
      }
    }
    return null;
  }, []);

  const isSpaceEmpty = useCallback((trackId: string, startTime: number, endTime: number, excludeClipId?: string): boolean => {
    const tl = timelineRef.current;
    return !tl.clips.some((c) => {
      if (c.trackId !== trackId) return false;
      if (c.id === excludeClipId) return false;
      const cs = c.startTime;
      const ce = clipEndTime(c);
      return cs < endTime && ce > startTime;
    });
  }, []);

  const handleExtendEdgeDown = useCallback((
    clipId: string,
    edge: 'left' | 'right',
    e: React.PointerEvent,
    trackId: string,
    trackTop: number,
    trackHeight: number,
  ) => {
    const tl = timelineRef.current;
    const sourceClip = tl.clips.find((c) => c.id === clipId);
    if (!sourceClip) return;

    const direction: 'before' | 'after' = edge === 'left' ? 'before' : 'after';
    const anchorTime = direction === 'before' ? sourceClip.startTime : clipEndTime(sourceClip);

    // Check adjacent space (0.5s probe)
    const PROBE_SEC = 0.5;
    const probeStart = direction === 'before' ? anchorTime - PROBE_SEC : anchorTime;
    const probeEnd = direction === 'before' ? anchorTime : anchorTime + PROBE_SEC;
    if (!isSpaceEmpty(trackId, probeStart, probeEnd, clipId)) return;

    const newDrag = {
      sourceClipId: clipId,
      trackId,
      direction,
      anchorTime,
      currentTime: anchorTime,
      trackTop,
      trackHeight,
    };
    setExtendDrag(newDrag);
    extendDragRef.current = newDrag;

    // Capture pointer on the tracks area so move/up events are received
    const tracksEl = tracksRef.current;
    if (tracksEl) {
      tracksEl.setPointerCapture(e.pointerId);
    }
  }, [isSpaceEmpty]);

  // Dispatch helpers that operate on the flat Timeline model
  const setTimeline = useCallback(
    (tl: Timeline) => {
      dispatch({ type: 'SET_TIMELINE', timelineId: tl.id, timeline: tl });
    },
    [dispatch],
  );

  const pxPerSecondRef = useRef(pxPerSecond);
  const prevPxPerSecondRef = useRef(pxPerSecond);
  pxPerSecondRef.current = pxPerSecond;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const trackHeightRef = useRef(trackHeight);
  trackHeightRef.current = trackHeight;

  // Zoom-to-playhead: when pxPerSecond changes, keep the playhead centered
  // in the clip viewport so wheel/pinch zoom feels anchored to the playhead.
  useLayoutEffect(() => {
    const prev = prevPxPerSecondRef.current;
    if (prev === pxPerSecond) return;
    prevPxPerSecondRef.current = pxPerSecond;

    const ruler = scrollRef.current;
    if (!ruler) return;

    const clipViewportW = Math.max(1, ruler.clientWidth - LABEL_WIDTH);
    const playheadNew = currentTimeRef.current * pxPerSecond;
    const newScroll = Math.max(0, playheadNew - clipViewportW / 2);
    ruler.scrollLeft = newScroll;

    // Sync other scroll containers
    const targets = [videoScrollRef.current, audioScrollRef.current];
    for (const t of targets) {
      if (t) t.scrollLeft = newScroll;
    }
    setRulerScrollLeft(newScroll);
  }, [pxPerSecond]);

  /** Snap to half-second grid when enabled, otherwise snap to frame grid */
  const snapTime = useCallback((time: number) => {
    if (snapEnabled) return snapToHalfSecond(time);
    return Math.round(time * FPS) / FPS; // snap to nearest frame
  }, [snapEnabled]);

  // Move-snap: snap a clip's start/end time to other clips' edges during drag
  const [moveSnapX, setMoveSnapX] = useState<number | null>(null);

  // Seek-snap: snap playhead to clip edges during ruler scrubbing
  const [seekSnapX, setSeekSnapX] = useState<number | null>(null);

  // Visual feedback state for advanced tools
  const [ripplePreview, setRipplePreview] = useState<{ clipId: string; affectedIds: string[]; delta: number } | null>(null);
  const [slipPreview, setSlipPreview] = useState<{ clipId: string; sourceOffset: number } | null>(null);
  const [slidePreview, setSlidePreview] = useState<{ clipId: string; leftDelta: number; rightDelta: number } | null>(null);
  const [trackForwardHighlight, setTrackForwardHighlight] = useState<string[] | null>(null);

  const handleMoveSnap = useCallback((snapX: number | null) => {
    setMoveSnapX(snapX !== null ? snapX + LABEL_WIDTH : null);
  }, []);

  /** Snap a time to any other clip's edge (excluding the clip being moved). Returns snapped time + whether it snapped. */
  const snapMoveTime = useCallback((time: number, movingClipId: string): { time: number; snapped: boolean } => {
    const tl = timelineRef.current;
    const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecondRef.current;
    let closest = time;
    let minDist = thresholdSec;
    let didSnap = false;

    // Snap to playhead (uses ref to avoid recreating callback on every frame)
    const playheadDist = Math.abs(time - currentTimeRef.current);
    if (playheadDist < minDist) {
      minDist = playheadDist;
      closest = currentTimeRef.current;
      didSnap = true;
    }

    // Snap to other clip edges
    for (const clip of tl.clips) {
      if (clip.id === movingClipId) continue;
      const effDur = clipEffectiveDuration(clip);
      const edges = [clip.startTime, clip.startTime + effDur];
      for (const edge of edges) {
        const dist = Math.abs(time - edge);
        if (dist < minDist) {
          minDist = dist;
          closest = edge;
          didSnap = true;
        }
      }
    }
    return { time: closest, snapped: didSnap };
  }, []);

  // useTimelineDrag hook — handles advanced tool mouse interactions
  const { handleClipMouseDown, handleBladeClick: hookBladeClick } = useTimelineDrag({
    tool: activeTool,
    timeline,
    pxPerSecond,
    snapEnabled,
    currentTime,
    onUpdate: setTimeline,
    onSelect: onSelectClips,
    onTrimPreview,
    onTrimPreviewEnd,
    onRipplePreview: (clipId, affectedIds, delta) => setRipplePreview({ clipId, affectedIds, delta }),
    onRipplePreviewEnd: () => setRipplePreview(null),
    onSlipPreview: (clipId, sourceOffset) => setSlipPreview({ clipId, sourceOffset }),
    onSlipPreviewEnd: () => setSlipPreview(null),
    onSlidePreview: (clipId, leftDelta, rightDelta) => setSlidePreview({ clipId, leftDelta, rightDelta }),
    onSlidePreviewEnd: () => setSlidePreview(null),
    onTrackForwardHighlight: (ids) => setTrackForwardHighlight(ids),
    onTrackForwardHighlightEnd: () => setTrackForwardHighlight(null),
  });

  const rippleAffectedSet = useMemo(
    () => new Set(ripplePreview?.affectedIds ?? []),
    [ripplePreview?.affectedIds],
  );
  const trackForwardHighlightSet = useMemo(
    () => new Set(trackForwardHighlight ?? []),
    [trackForwardHighlight],
  );

  // Marquee selection — ref is source of truth for handlers, state drives render
  const marqueeRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const marqueeAdditiveRef = useRef(false);

  const [containerWidth, setContainerWidth] = useState(800);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const viewportSeconds = Math.ceil(containerWidth / pxPerSecond);
  const clipViewportWidth = Math.max(0, containerWidth - LABEL_WIDTH);
  // Always extend the ruler well past the content so you can scroll and place clips freely
  const totalSeconds = Math.max(3600, sequenceDuration + viewportSeconds * 2, viewportSeconds + 5);
  const totalWidth = totalSeconds * pxPerSecond;

  useEffect(() => {
    setVaSplit(initialVaSplit);
  }, [initialVaSplit]);

  useEffect(() => {
    onVaSplitChange?.(vaSplit);
  }, [vaSplit, onVaSplitChange]);

  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const selectedClipIdsRef = useRef(selectedClipIds);
  selectedClipIdsRef.current = selectedClipIds;
  const pendingDurationProbeRef = useRef(new Set<string>());

  const probeAssetDuration = useCallback((asset: Asset) => {
    if ((asset.duration ?? 0) > 0) return;
    if (asset.type !== 'video' && asset.type !== 'audio') return;
    if (pendingDurationProbeRef.current.has(asset.id)) return;

    const source = toFileUrl(asset.fileRef || asset.url);
    if (!source) return;

    pendingDurationProbeRef.current.add(asset.id);

    const finalize = (duration?: number) => {
      pendingDurationProbeRef.current.delete(asset.id);
      if (!duration || !Number.isFinite(duration) || duration <= 0) return;

      dispatch({
        type: 'UPDATE_ASSET',
        asset: { id: asset.id, duration },
      });

      const tl = timelineRef.current;
      let didUpdate = false;
      const updatedClips = tl.clips.map((c) => {
        if (c.assetId === asset.id && c.duration === 5) {
          didUpdate = true;
          return { ...c, duration };
        }
        return c;
      });

      if (didUpdate) {
        setTimeline({ ...tl, clips: updatedClips });
      }
    };

    if (asset.type === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = source;

      video.addEventListener('loadedmetadata', () => {
        finalize(video.duration);
      }, { once: true });
      video.addEventListener('error', () => {
        finalize();
      }, { once: true });
      video.load();
    } else {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = source;
      audio.addEventListener('loadedmetadata', () => {
        finalize(audio.duration);
      }, { once: true });
      audio.addEventListener('error', () => {
        finalize();
      }, { once: true });
      audio.load();
    }
  }, [dispatch, setTimeline]);

  const handleDropAsset = useCallback(
    (trackId: string, assetId: string, startTime: number) => {
      const asset = assetsRef.current.find((a) => a.id === assetId);
      if (!asset) return;
      const snappedStart = snapTime(startTime);
      const tl = timelineRef.current;
      const targetTrack = tl.tracks.find((t) => t.id === trackId);

      // Audio assets must go on audio tracks — redirect if dropped on a video track
      if (asset.type === 'audio' && targetTrack && targetTrack.kind === 'video') {
        const audioTrack = tl.tracks.find((t) => t.kind === 'audio');
        if (audioTrack) {
          setTimeline(addClipToTrack(tl, audioTrack.id, asset, snappedStart));
        } else {
          // Create an audio track via addClipToTrack on the first audio track it finds/creates
          const withAudioTrack = addTrack(tl, 'audio');
          const newAudioTrack = withAudioTrack.tracks.find((t) => t.kind === 'audio');
          if (newAudioTrack) {
            setTimeline(addClipToTrack(withAudioTrack, newAudioTrack.id, asset, snappedStart));
          }
        }
        probeAssetDuration(asset);
        return;
      }

      setTimeline(addClipToTrack(tl, trackId, asset, snappedStart));
      probeAssetDuration(asset);
    },
    [setTimeline, snapTime, probeAssetDuration],
  );

  // Throttled move to avoid re-rendering on every pointer pixel
  const moveRafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ clipId: string; trackId: string; startTime: number } | null>(null);

  // --- Document-level move drag (lifted here so it survives cross-track re-renders) ---
  const moveDragRef = useRef<{
    clipId: string;
    startX: number;
    initStartTime: number;
    // IDs of temporarily created tracks (created on drag-above, removed on drag-back-down)
    tempTrackIds: string[];
    duplicate: boolean;
    duplicatedClipIds: string[] | null;
  } | null>(null);

  const getDragMoverIds = useCallback((tl: Timeline, clipIds: string[], preferredClipId?: string): string[] => {
    const requestedIds = [...new Set(clipIds)];
    const requestedIdSet = new Set(requestedIds);
    const visited = new Set<string>();
    const moverIds: string[] = [];

    for (const id of requestedIds) {
      if (visited.has(id)) continue;
      const clip = tl.clips.find((c) => c.id === id);
      if (!clip) continue;

      const linkedIds = clip.linkedClipIds ?? [];
      const linkedInRequest = linkedIds.filter((lid) => requestedIdSet.has(lid));
      if (linkedInRequest.length > 0) {
        // If the preferred clip is one of our linked clips and we're not it, skip us
        if (preferredClipId && linkedInRequest.includes(preferredClipId) && id !== preferredClipId) {
          continue;
        }
        moverIds.push(id);
        visited.add(id);
        for (const lid of linkedInRequest) visited.add(lid);
        continue;
      }

      moverIds.push(id);
      visited.add(id);
    }

    return moverIds;
  }, []);

  const applyGroupedMove = useCallback(
    (
      tl: Timeline,
      moverIds: string[],
      anchorClipId: string,
      targetTrackId: string,
      startTime: number,
      allowTrackChange: boolean,
    ): Timeline => {
      if (moverIds.length === 0) return tl;

      const resolvedAnchorId = moverIds.includes(anchorClipId) ? anchorClipId : moverIds[0];
      const anchorClip = tl.clips.find((c) => c.id === resolvedAnchorId);
      if (!anchorClip) return tl;

      if (moverIds.length === 1) {
        return moveClip(tl, resolvedAnchorId, targetTrackId, startTime);
      }

      const delta = startTime - anchorClip.startTime;
      let nextTl = tl;
      for (const id of moverIds) {
        const clip = nextTl.clips.find((c) => c.id === id);
        if (!clip) continue;
        nextTl = moveClip(
          nextTl,
          id,
          allowTrackChange && id === resolvedAnchorId ? targetTrackId : clip.trackId,
          Math.max(0, clip.startTime + delta),
        );
      }
      return nextTl;
    },
    [],
  );

  const handleMoveClip = useCallback(
    (clipId: string, trackId: string, startTime: number) => {
      pendingMoveRef.current = { clipId, trackId, startTime };
      if (moveRafRef.current) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const pending = pendingMoveRef.current;
        if (pending) {
          pendingMoveRef.current = null;
          let tl = timelineRef.current;
          const selected = selectedClipIdsRef.current;

          if (selected.size > 1 && selected.has(pending.clipId)) {
            tl = applyGroupedMove(
              tl,
              getDragMoverIds(tl, [...selected], pending.clipId),
              pending.clipId,
              pending.trackId,
              pending.startTime,
              false,
            );
          } else {
            tl = moveClip(tl, pending.clipId, pending.trackId, pending.startTime);
          }
          setTimeline(tl);
        }
      });
    },
    [applyGroupedMove, getDragMoverIds, setTimeline],
  );

  // Clean up pending RAF on unmount
  useEffect(() => {
    return () => {
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  // Called by ClipCard on pointerdown for a move — starts the document-level drag
  const handleMoveStart = useCallback(
    (clipId: string, startX: number, initStartTime: number, duplicate: boolean) => {
      moveDragRef.current = { clipId, startX, initStartTime, tempTrackIds: [], duplicate, duplicatedClipIds: null };
    },
    [],
  );

  // Refs for values used in document-level drag (avoid stale closures)
  const snapTimeRef = useRef(snapTime);
  snapTimeRef.current = snapTime;
  const snapMoveTimeRef = useRef(snapMoveTime);
  snapMoveTimeRef.current = snapMoveTime;
  const handleMoveClipRef = useRef(handleMoveClip);
  handleMoveClipRef.current = handleMoveClip;
  const setTimelineRef = useRef(setTimeline);
  setTimelineRef.current = setTimeline;

  // Document-level pointermove/pointerup for smooth cross-track clip dragging.
  // This lives in TimelineEditor so it survives ClipCard unmount/remount across tracks.
  useEffect(() => {
    const handleDocPointerMove = (e: PointerEvent) => {
      const drag = moveDragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const pps = pxPerSecondRef.current;
      const raw = Math.max(0, drag.initStartTime + dx / pps);
      const _snapTime = snapTimeRef.current;
      const _snapMoveTime = snapMoveTimeRef.current;

      // Hide all clip-cards briefly so elementFromPoint sees through them
      const allCards = document.querySelectorAll('.clip-card');
      const prevStyles: { el: HTMLElement; val: string }[] = [];
      allCards.forEach((c) => {
        const htmlEl = c as HTMLElement;
        prevStyles.push({ el: htmlEl, val: htmlEl.style.pointerEvents });
        htmlEl.style.pointerEvents = 'none';
      });
      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      prevStyles.forEach(({ el: htmlEl, val }) => { htmlEl.style.pointerEvents = val; });

      const trackRow = elUnder?.closest('[data-track-id]');
      let targetTrackId = trackRow?.getAttribute('data-track-id') ?? undefined;
      let wantsNewTrack = false;
      let newTrackKind: 'video' | 'audio' = 'video';

      // Detect drag beyond the outermost track in the section
      if (!trackRow) {
        // Look for the tracks container — cursor may be in the empty gap above/below tracks
        // so also check scroll parent and section parent
        const tracksContainer = elUnder?.closest('.timeline-editor__tracks')
          ?? elUnder?.closest('.timeline-editor__scroll--tracks')?.querySelector('.timeline-editor__tracks')
          ?? elUnder?.closest('.timeline-editor__va-section')?.querySelector('.timeline-editor__tracks');
        if (tracksContainer) {
          const section = tracksContainer.closest('.timeline-editor__va-section');
          const isVideoSection = section?.classList.contains('timeline-editor__va-section--video');
          const allRows = tracksContainer.querySelectorAll('[data-track-id]');
          if (allRows.length > 0) {
            if (isVideoSection) {
              // Video tracks are rendered in reverse (top of DOM = highest track number)
              // New track = drag above the first row in DOM (visually topmost)
              const topRow = allRows[0];
              const topRect = topRow.getBoundingClientRect();
              if (e.clientY < topRect.top) {
                wantsNewTrack = true;
                newTrackKind = 'video';
              }
            } else {
              // Audio tracks: new track = drag below the last row in DOM
              const bottomRow = allRows[allRows.length - 1];
              const bottomRect = bottomRow.getBoundingClientRect();
              if (e.clientY > bottomRect.bottom) {
                wantsNewTrack = true;
                newTrackKind = 'audio';
              }
            }
          }
        }
      }

      let tl = timelineRef.current;
      if (drag.duplicate && !drag.duplicatedClipIds) {
        if (Math.abs(dx) < 2) return;

        const selected = selectedClipIdsRef.current;
        const sourceClipIds = selected.size > 1 && selected.has(drag.clipId)
          ? [...selected]
          : [drag.clipId];

        if (sourceClipIds.length === 1) {
          const linkedSourceIds = tl.clips.find((c) => c.id === drag.clipId)?.linkedClipIds ?? [];
          for (const lid of linkedSourceIds) sourceClipIds.push(lid);
        }

        const duplicated = duplicateClips(tl, sourceClipIds, drag.clipId);
        if (!duplicated.draggedCopyId || duplicated.newClipIds.length === 0) return;

        drag.clipId = duplicated.draggedCopyId;
        drag.duplicatedClipIds = duplicated.newClipIds;
        tl = duplicated.timeline;
        setTimelineRef.current(tl);
        timelineRef.current = tl;
        onSelectClips(new Set(duplicated.newClipIds));
      }

      const duplicateMoverIds = drag.duplicatedClipIds
        ? getDragMoverIds(tl, drag.duplicatedClipIds, drag.clipId)
        : null;
      const isDuplicateGroupDrag = !!duplicateMoverIds && duplicateMoverIds.length > 1;

      if (!isDuplicateGroupDrag && wantsNewTrack && drag.tempTrackIds.length === 0) {
        // Create temp track(s) and move clip immediately (synchronous, no RAF)
        tl = addTrack(tl, newTrackKind);
        const newTrack = tl.tracks.filter((t) => t.kind === newTrackKind).at(-1);
        if (newTrack) {
          drag.tempTrackIds.push(newTrack.id);
          // Also create paired track if clip is linked
          const clipForLink = tl.clips.find((c) => c.id === drag.clipId);
          if (clipForLink?.linkedClipIds?.length) {
            const otherKind = newTrackKind === 'video' ? 'audio' as const : 'video' as const;
            tl = addTrack(tl, otherKind);
            const pairedTrack = tl.tracks.filter((t) => t.kind === otherKind).at(-1);
            if (pairedTrack) drag.tempTrackIds.push(pairedTrack.id);
          }
          // Move clip to the new track synchronously
          tl = moveClip(tl, drag.clipId, newTrack.id, _snapTime(raw));
          setTimelineRef.current(tl);
          timelineRef.current = tl;
        }
        // Skip the RAF-throttled move below — we already moved synchronously
        return;
      } else if (!isDuplicateGroupDrag && (wantsNewTrack || (targetTrackId && drag.tempTrackIds.includes(targetTrackId))) && drag.tempTrackIds.length > 0) {
        // Already on temp track (or still above) — just do normal move targeting the temp track
        targetTrackId = drag.tempTrackIds[0];
      } else if (!isDuplicateGroupDrag && !wantsNewTrack && drag.tempTrackIds.length > 0 && !(targetTrackId && drag.tempTrackIds.includes(targetTrackId))) {
        // User dragged back down to a non-temp track — move clip off temp tracks, then remove them
        // Flush any pending RAF move first so timeline state is current
        if (moveRafRef.current) {
          cancelAnimationFrame(moveRafRef.current);
          moveRafRef.current = null;
        }
        const pending = pendingMoveRef.current;
        if (pending) {
          tl = moveClip(tl, pending.clipId, pending.trackId, pending.startTime);
          pendingMoveRef.current = null;
        }

        // Find where the clip currently is
        const clipNow = tl.clips.find((c) => c.id === drag.clipId);
        // Determine the target track to move back to
        const fallbackTrackId = targetTrackId ?? '';
        if (clipNow && fallbackTrackId) {
          // Move the clip (and its linked pair) off the temp tracks
          tl = moveClip(tl, drag.clipId, fallbackTrackId, clipNow.startTime);
        }
        // Now remove the (now empty) temp tracks
        for (const id of drag.tempTrackIds) {
          tl = removeTrack(tl, id);
        }
        drag.tempTrackIds = [];
        setTimelineRef.current(tl);
        timelineRef.current = tl;
      }

      // Resolve target track — fall back to clip's current track
      const resolvedTrackId = targetTrackId ?? (tl.clips.find((c) => c.id === drag.clipId)?.trackId ?? '');
      const applyDuplicateDragMove = (nextStartTime: number) => {
        if (!drag.duplicatedClipIds) return;
        const moverIds = getDragMoverIds(tl, drag.duplicatedClipIds, drag.clipId);
        tl = applyGroupedMove(
          tl,
          moverIds,
          drag.clipId,
          resolvedTrackId,
          nextStartTime,
          moverIds.length === 1,
        );
        setTimelineRef.current(tl);
        timelineRef.current = tl;
      };

      // Snap to clip edges, then fall back to grid snap
      const clip = tl.clips.find((c) => c.id === drag.clipId);
      if (_snapMoveTime && clip) {
        const effDur = clipEffectiveDuration(clip);
        const endResult = _snapMoveTime(raw + effDur, drag.clipId);
        const startResult = _snapMoveTime(raw, drag.clipId);
        if (endResult.snapped) {
          const snappedStart = endResult.time - effDur;
          if (drag.duplicatedClipIds) applyDuplicateDragMove(Math.max(0, snappedStart));
          else handleMoveClipRef.current(drag.clipId, resolvedTrackId, Math.max(0, snappedStart));
          setMoveSnapX(endResult.time * pps + LABEL_WIDTH);
        } else if (startResult.snapped) {
          if (drag.duplicatedClipIds) applyDuplicateDragMove(startResult.time);
          else handleMoveClipRef.current(drag.clipId, resolvedTrackId, startResult.time);
          setMoveSnapX(startResult.time * pps + LABEL_WIDTH);
        } else {
          if (drag.duplicatedClipIds) applyDuplicateDragMove(_snapTime(raw));
          else handleMoveClipRef.current(drag.clipId, resolvedTrackId, _snapTime(raw));
          setMoveSnapX(null);
        }
      } else {
        if (drag.duplicatedClipIds) applyDuplicateDragMove(_snapTime(raw));
        else handleMoveClipRef.current(drag.clipId, resolvedTrackId, _snapTime(raw));
        setMoveSnapX(null);
      }
    };

    const handleDocPointerUp = () => {
      const drag = moveDragRef.current;
      if (!drag) return;
      moveDragRef.current = null;
      setMoveSnapX(null);
      // Temp tracks stay if the user released above — they're already real tracks now.
      // If user dragged back down, they were already removed during pointermove.
    };

    document.addEventListener('pointermove', handleDocPointerMove);
    document.addEventListener('pointerup', handleDocPointerUp);
    return () => {
      document.removeEventListener('pointermove', handleDocPointerMove);
      document.removeEventListener('pointerup', handleDocPointerUp);
    };
  }, []);

  // Throttled trim
  const trimRafRef = useRef<number | null>(null);
  const pendingTrimRef = useRef<{ clipId: string; trimStart: number; trimEnd: number; startTime?: number } | null>(null);

  const handleTrimClip = useCallback(
    (clipId: string, trimStart: number, trimEnd: number, startTime?: number) => {
      pendingTrimRef.current = { clipId, trimStart, trimEnd, startTime };
      if (trimRafRef.current) return;
      trimRafRef.current = requestAnimationFrame(() => {
        trimRafRef.current = null;
        const pending = pendingTrimRef.current;
        if (pending) {
          pendingTrimRef.current = null;
          setTimeline(trimClip(timelineRef.current, pending.clipId, pending.trimStart, pending.trimEnd, pending.startTime));
        }
      });
    },
    [setTimeline],
  );

  useEffect(() => {
    return () => {
      if (trimRafRef.current) cancelAnimationFrame(trimRafRef.current);
    };
  }, []);

  const handleRemoveClip = useCallback(
    (clipId: string) => setTimeline(removeClip(timelineRef.current, clipId)),
    [setTimeline],
  );

  const handleRemoveTransition = useCallback(
    (transitionId: string) => setTimeline(removeTransition(timelineRef.current, transitionId)),
    [setTimeline],
  );

  const handleUpdateClipProps = useCallback(
    (clipId: string, updates: Partial<Pick<TimelineClip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => {
      setTimeline(updateClipProperties(timelineRef.current, clipId, updates));
    },
    [setTimeline],
  );

  const handleAddKeyframe = useCallback(
    (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => {
      const kf: Keyframe = { time, property, value };
      setTimeline(addKeyframe(timelineRef.current, clipId, kf));
    },
    [setTimeline],
  );

  const handleMoveKeyframe = useCallback(
    (clipId: string, index: number, newTime: number) => {
      setTimeline(moveKeyframe(timelineRef.current, clipId, index, newTime));
    },
    [setTimeline],
  );

  const handleRemoveKeyframe = useCallback(
    (clipId: string, index: number) => {
      setTimeline(removeKeyframe(timelineRef.current, clipId, index));
    },
    [setTimeline],
  );

  // ── Clip context menu handlers ──

  const handleClipContextMenu = useCallback(
    (clipId: string, e: React.MouseEvent) => {
      // Select the clip if not already selected (standard NLE behavior)
      if (!selectedClipIdsRef.current.has(clipId)) {
        onSelectClips(new Set([clipId]));
      }
      setClipCtxMenu({ clipId, x: e.clientX, y: e.clientY });
      setSpacesSubOpen(null);
    },
    [onSelectClips],
  );

  const closeClipCtxMenu = useCallback(() => {
    setClipCtxMenu(null);
    setSpacesSubOpen(null);
  }, []);

  // Close clip context menu on outside click or Escape
  useEffect(() => {
    if (!clipCtxMenu) return;
    const handleClick = (e: PointerEvent) => {
      if (clipCtxMenuRef.current && !clipCtxMenuRef.current.contains(e.target as Node)) {
        closeClipCtxMenu();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeClipCtxMenu();
    };
    document.addEventListener('pointerdown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [clipCtxMenu, closeClipCtxMenu]);

  // Adjust context menu position to stay within viewport
  useLayoutEffect(() => {
    if (!clipCtxMenu) return;
    const el = clipCtxMenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let { x, y } = clipCtxMenu;
    if (rect.bottom > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad;
    }
    if (rect.right > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad;
    }
    if (x !== clipCtxMenu.x || y !== clipCtxMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [clipCtxMenu]);

  const handleClipCopy = useCallback(() => {
    const selected = selectedClipIdsRef.current;
    if (selected.size === 0) return;
    const tl = timelineRef.current;
    const clips = tl.clips.filter((c) => selected.has(c.id));
    clipboardRef.current = { clips, mode: 'copy' };
    closeClipCtxMenu();
  }, [closeClipCtxMenu]);

  const handleClipCut = useCallback(() => {
    const selected = selectedClipIdsRef.current;
    if (selected.size === 0) return;
    const tl = timelineRef.current;
    const clips = tl.clips.filter((c) => selected.has(c.id));
    clipboardRef.current = { clips, mode: 'cut' };
    // Remove clips from timeline
    let updated = tl;
    for (const c of clips) {
      updated = removeClip(updated, c.id);
    }
    setTimeline(updated);
    onSelectClips(new Set());
    closeClipCtxMenu();
  }, [setTimeline, onSelectClips, closeClipCtxMenu]);

  const handleClipPaste = useCallback(() => {
    const cb = clipboardRef.current;
    if (!cb || cb.clips.length === 0) return;
    const tl = timelineRef.current;
    const pasteTime = currentTimeRef.current;
    // Find the earliest clip start to calculate offset
    const earliest = Math.min(...cb.clips.map((c) => c.startTime));
    const newIds: string[] = [];
    let updated = tl;
    for (const clip of cb.clips) {
      const newId = generateId();
      newIds.push(newId);
      updated = {
        ...updated,
        clips: [
          ...updated.clips,
          {
            ...clip,
            id: newId,
            startTime: pasteTime + (clip.startTime - earliest),
          },
        ],
      };
    }
    setTimeline(updated);
    onSelectClips(new Set(newIds));
    // After cut-paste, switch clipboard to copy mode so it can be pasted again
    if (cb.mode === 'cut') {
      clipboardRef.current = { clips: cb.clips.map((c, i) => ({ ...c, id: newIds[i] })), mode: 'copy' };
    }
    closeClipCtxMenu();
  }, [setTimeline, onSelectClips, closeClipCtxMenu]);

  const handleClipDelete = useCallback(() => {
    const selected = selectedClipIdsRef.current;
    if (selected.size === 0) return;
    let tl = timelineRef.current;
    for (const id of selected) {
      tl = removeClip(tl, id);
    }
    setTimeline(tl);
    onSelectClips(new Set());
    closeClipCtxMenu();
  }, [setTimeline, onSelectClips, closeClipCtxMenu]);

  const handleClearKeyframes = useCallback(() => {
    const ctxClipId = clipCtxMenu?.clipId;
    if (!ctxClipId) return;
    const tl = timelineRef.current;
    setTimeline({
      ...tl,
      clips: tl.clips.map((c) =>
        c.id === ctxClipId ? { ...c, keyframes: [] } : c,
      ),
    });
    closeClipCtxMenu();
  }, [clipCtxMenu, setTimeline, closeClipCtxMenu]);

  const hasVideoInSelection = useMemo(() => {
    return Array.from(selectedClipIds).some((id) => {
      const clip = timeline.clips.find((c) => c.id === id);
      const track = timeline.tracks.find((t) => t.id === clip?.trackId);
      return track?.kind === 'video';
    });
  }, [selectedClipIds, timeline]);

  const hasAudioInSelection = useMemo(() => {
    // Check if selection contains an audio clip that's NOT linked to a selected video
    // (i.e., an external audio clip the user explicitly selected)
    const selectedVideos = Array.from(selectedClipIds)
      .map((id) => timeline.clips.find((c) => c.id === id))
      .filter((c): c is typeof timeline.clips[number] => {
        const track = timeline.tracks.find((t) => t.id === c?.trackId);
        return track?.kind === 'video';
      });
    const linkedToSelectedVideos = new Set(selectedVideos.flatMap((v) => v.linkedClipIds ?? []));

    return Array.from(selectedClipIds).some((id) => {
      const clip = timeline.clips.find((c) => c.id === id);
      const track = timeline.tracks.find((t) => t.id === clip?.trackId);
      return track?.kind === 'audio' && !linkedToSelectedVideos.has(id);
    });
  }, [selectedClipIds, timeline]);

  const handleSyncAudio = useCallback(() => {
    if (!clipCtxMenu) return;
    const rightClickedClipId = clipCtxMenu.clipId;
    setClipCtxMenu(null);

    // Gather all selected clips + the right-clicked clip
    const allIds = new Set(selectedClipIds);
    allIds.add(rightClickedClipId);

    const allClips = Array.from(allIds)
      .map((id) => timeline.clips.find((c) => c.id === id))
      .filter(Boolean) as typeof timeline.clips;

    const videoClips = allClips.filter((c) => {
      const track = timeline.tracks.find((t) => t.id === c.trackId);
      return track?.kind === 'video';
    });
    // Filter out audio clips that are already linked to one of the selected videos
    // (these are scratch audio — not the external audio the user wants to sync)
    const linkedToVideo = new Set(videoClips.flatMap((v) => v.linkedClipIds ?? []));
    const audioClips = allClips.filter((c) => {
      const track = timeline.tracks.find((t) => t.id === c.trackId);
      return track?.kind === 'audio' && !linkedToVideo.has(c.id);
    });

    if (videoClips.length === 1 && audioClips.length === 1) {
      // Case A: one video + one audio — direct sync
      setSyncDialogVideoClipId(videoClips[0].id);
      setSyncDialogAudioClipId(audioClips[0].id);
      setSyncDialogOpen(true);
    } else if (videoClips.length >= 1 && audioClips.length > 1) {
      // Multiple audio clips — use the right-clicked clip to determine intent
      const rightClickedClip = timeline.clips.find((c) => c.id === rightClickedClipId);
      const rightClickedTrack = timeline.tracks.find((t) => t.id === rightClickedClip?.trackId);

      if (rightClickedTrack?.kind === 'audio') {
        // Right-clicked on audio: pair it with the first video
        setSyncDialogVideoClipId(videoClips[0].id);
        setSyncDialogAudioClipId(rightClickedClipId);
        setSyncDialogOpen(true);
      } else {
        // Right-clicked on video: open picker to choose which audio
        setSyncDialogVideoClipId(videoClips[0].id);
        setSyncDialogAudioClipId(null);
        setSyncDialogOpen(true);
      }
    } else if (videoClips.length >= 1) {
      // Case B: only video — open picker
      setSyncDialogVideoClipId(videoClips[0].id);
      setSyncDialogAudioClipId(null);
      setSyncDialogOpen(true);
    }
  }, [clipCtxMenu, selectedClipIds, timeline]);

  // Compute link/unlink state for context menu
  const linkUnlinkState = useMemo(() => {
    const allIds = new Set(selectedClipIds);
    if (clipCtxMenu) allIds.add(clipCtxMenu.clipId);

    const allClips = Array.from(allIds)
      .map((id) => timeline.clips.find((c) => c.id === id))
      .filter(Boolean) as typeof timeline.clips;

    const videoClips = allClips.filter((c) => {
      const track = timeline.tracks.find((t) => t.id === c.trackId);
      return track?.kind === 'video';
    });
    const audioClips = allClips.filter((c) => {
      const track = timeline.tracks.find((t) => t.id === c.trackId);
      return track?.kind === 'audio';
    });

    if (videoClips.length === 1 && audioClips.length >= 1) {
      const video = videoClips[0];
      const videoLinkedIds = new Set(video.linkedClipIds ?? []);
      const unlinkable = audioClips.filter((a) => videoLinkedIds.has(a.id));
      const linkable = audioClips.filter((a) => !videoLinkedIds.has(a.id));
      // Show Link if any are unlinked, otherwise show Unlink
      const showLink = linkable.length > 0;
      return { canLink: showLink, canUnlink: !showLink && unlinkable.length > 0, videoId: video.id, linkableIds: linkable.map((a) => a.id), unlinkableIds: unlinkable.map((a) => a.id) };
    }
    return { canLink: false, canUnlink: false };
  }, [clipCtxMenu, selectedClipIds, timeline]);

  const handleLinkAudio = useCallback(() => {
    if (!linkUnlinkState.canLink || !linkUnlinkState.videoId) return;
    setClipCtxMenu(null);
    let tl = timeline;
    for (const audioId of linkUnlinkState.linkableIds!) {
      tl = linkClips(tl, linkUnlinkState.videoId, audioId);
    }
    setTimeline(tl);
  }, [linkUnlinkState, timeline, setTimeline]);

  const handleUnlinkAudio = useCallback(() => {
    if (!linkUnlinkState.canUnlink || !linkUnlinkState.videoId) return;
    setClipCtxMenu(null);
    let tl = timeline;
    for (const audioId of linkUnlinkState.unlinkableIds!) {
      tl = unlinkClips(tl, linkUnlinkState.videoId, audioId);
    }
    setTimeline(tl);
  }, [linkUnlinkState, timeline, setTimeline]);

  /** Add a filePicker node to a target space with the given media info. */
  const addMediaNodeToSpace = useCallback(
    (spaceId: string, opts: { fileUrl: string; fileType: 'image' | 'video' | 'audio'; fileName: string; thumbnailUrl?: string }) => {
      const targetSpace = state.spaces.find((s) => s.id === spaceId);
      if (!targetSpace) return;

      const config: Record<string, unknown> = { fileUrl: opts.fileUrl, fileType: opts.fileType, fileName: opts.fileName };
      if (opts.thumbnailUrl) config.thumbnailUrl = opts.thumbnailUrl;

      const nodeId = generateId();
      const newNode = {
        id: nodeId,
        type: 'filePicker',
        className: 'cinegen-node-highlight',
        position: { x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 },
        data: {
          type: 'filePicker',
          label: opts.fileName,
          config,
        } as WorkflowNodeData,
      };

      dispatch({ type: 'OPEN_SPACE', spaceId });
      dispatch({ type: 'SET_ACTIVE_SPACE', spaceId });
      dispatch({ type: 'SET_NODES', nodes: [...targetSpace.nodes, newNode] });
      dispatch({ type: 'SET_TAB', tab: 'create' });

      // Remove the highlight class after animation completes
      setTimeout(() => {
        dispatch({
          type: 'SET_NODES',
          nodes: [...targetSpace.nodes, newNode].map((n) =>
            n.id === nodeId ? { ...n, className: undefined } : n,
          ),
        });
      }, 2200);
    },
    [state.spaces, dispatch],
  );

  const handleSendFrameToSpace = useCallback(
    (spaceId: string) => {
      // Find the topmost video clip at the current playhead time
      const tl = timelineRef.current;
      const time = currentTimeRef.current;
      const vTracks = tl.tracks.filter((t) => t.kind === 'video');
      let frameAsset: Asset | undefined;
      let frameClip: TimelineClip | undefined;
      for (const track of vTracks) {
        const clip = tl.clips.find(
          (c) =>
            c.trackId === track.id &&
            c.startTime <= time &&
            c.startTime + clipEffectiveDuration(c) > time,
        );
        if (clip) {
          frameAsset = assetsRef.current.find((a) => a.id === clip.assetId);
          if (frameAsset) { frameClip = clip; break; }
        }
      }
      if (!frameAsset) {
        closeClipCtxMenu();
        return;
      }

      const fileUrl = toFileUrl(frameAsset.fileRef || frameAsset.url || frameAsset.thumbnailUrl);
      if (!fileUrl) { closeClipCtxMenu(); return; }

      // For images, send directly
      if (frameAsset.type === 'image') {
        addMediaNodeToSpace(spaceId, {
          fileUrl,
          fileType: 'image',
          fileName: frameAsset.name ?? 'Frame',
        });
        closeClipCtxMenu();
        return;
      }

      // For video, extract the exact frame at the playhead via ffmpeg
      closeClipCtxMenu();
      const inputPath = frameAsset.fileRef || frameAsset.url || '';
      const sourceTime = frameClip
        ? frameClip.trimStart + (time - frameClip.startTime) * frameClip.speed
        : time;

      window.electronAPI.media.extractFrame({ inputPath, timeSec: sourceTime }).then(
        (result: { outputPath: string } | null) => {
          if (result?.outputPath) {
            addMediaNodeToSpace(spaceId, {
              fileUrl: toFileUrl(result.outputPath),
              fileType: 'image',
              fileName: `${frameAsset!.name ?? 'Frame'} — frame`,
            });
          } else {
            // Fallback: use asset thumbnail
            const thumbUrl = toFileUrl(frameAsset!.thumbnailUrl);
            if (thumbUrl) {
              addMediaNodeToSpace(spaceId, {
                fileUrl: thumbUrl,
                fileType: 'image',
                fileName: `${frameAsset!.name ?? 'Frame'} — frame`,
              });
            }
          }
        },
      );
    },
    [addMediaNodeToSpace, closeClipCtxMenu],
  );

  const handleSendClipToSpace = useCallback(
    (spaceId: string) => {
      const ctxClipId = clipCtxMenu?.clipId;
      if (!ctxClipId) return;
      const tl = timelineRef.current;
      const clip = tl.clips.find((c) => c.id === ctxClipId);
      if (!clip) { closeClipCtxMenu(); return; }
      const clipAsset = assetsRef.current.find((a) => a.id === clip.assetId);
      if (!clipAsset) { closeClipCtxMenu(); return; }
      const fileUrl = toFileUrl(clipAsset.fileRef || clipAsset.url || clipAsset.thumbnailUrl);
      if (!fileUrl) { closeClipCtxMenu(); return; }
      const assetType = clipAsset.type ?? '';
      const fileType: 'image' | 'video' | 'audio' = assetType === 'video' ? 'video' : assetType === 'audio' ? 'audio' : 'image';
      const thumbUrl = assetType === 'video' ? toFileUrl(clipAsset.thumbnailUrl) : undefined;
      addMediaNodeToSpace(spaceId, {
        fileUrl,
        fileType,
        fileName: clipAsset.name ?? clip.name,
        thumbnailUrl: thumbUrl || undefined,
      });
      closeClipCtxMenu();
    },
    [clipCtxMenu, addMediaNodeToSpace, closeClipCtxMenu],
  );

  // ── Marker handlers ──

  const handleAddMarker = useCallback(() => {
    const tl = timelineRef.current;
    const time = currentTimeRef.current;
    // Don't add duplicate marker at same time
    if ((tl.markers ?? []).some((m) => Math.abs(m.time - time) < 0.01)) return;
    const marker: TimelineMarker = {
      id: generateId(),
      time,
      color: '#f1c40f',
      label: '',
    };
    setTimeline({ ...tl, markers: [...(tl.markers ?? []), marker] });
  }, [setTimeline]);

  const handleRemoveMarker = useCallback((markerId: string) => {
    const tl = timelineRef.current;
    setTimeline({ ...tl, markers: (tl.markers ?? []).filter((m) => m.id !== markerId) });
    setMarkerCtxMenu(null);
  }, [setTimeline]);

  const handleMoveMarker = useCallback((markerId: string, newTime: number) => {
    const tl = timelineRef.current;
    setTimeline({
      ...tl,
      markers: (tl.markers ?? []).map((m) =>
        m.id === markerId ? { ...m, time: Math.max(0, newTime) } : m,
      ),
    });
  }, [setTimeline]);

  const handleMarkerContextMenu = useCallback((markerId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMarkerCtxMenu({ markerId, x: e.clientX, y: e.clientY });
  }, []);

  // Close marker context menu on outside click or Escape
  useEffect(() => {
    if (!markerCtxMenu) return;
    const handleClick = (e: PointerEvent) => {
      if (markerCtxMenuRef.current && !markerCtxMenuRef.current.contains(e.target as Node)) {
        setMarkerCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMarkerCtxMenu(null);
    };
    document.addEventListener('pointerdown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [markerCtxMenu]);

  const handleMarkerPointerDown = useCallback((markerId: string, e: React.PointerEvent) => {
    if (e.button === 2) return; // right-click handled by context menu
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const tl = timelineRef.current;
    const marker = (tl.markers ?? []).find((m) => m.id === markerId);
    if (!marker) return;
    markerDragRef.current = { markerId, startX: e.clientX, startTime: marker.time };
  }, []);

  const handleMarkerPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = markerDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dt = dx / pxPerSecondRef.current;
    const newTime = Math.max(0, drag.startTime + dt);
    handleMoveMarker(drag.markerId, newTime);
  }, [handleMoveMarker]);

  const handleMarkerPointerUp = useCallback(() => {
    markerDragRef.current = null;
  }, []);

  // "M" keyboard shortcut to add marker
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'm' && e.key !== 'M') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      handleAddMarker();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddMarker]);

  const handleRenameTrack = useCallback(
    (trackId: string, name: string) => {
      const tl = timelineRef.current;
      setTimeline({
        ...tl,
        tracks: tl.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)),
      });
    },
    [setTimeline],
  );

  const handleToggleLock = useCallback(
    (trackId: string) => {
      const tl = timelineRef.current;
      setTimeline({
        ...tl,
        tracks: tl.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
      });
    },
    [setTimeline],
  );

  const handleToggleMute = useCallback(
    (trackId: string) => {
      const tl = timelineRef.current;
      setTimeline({
        ...tl,
        tracks: tl.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
      });
    },
    [setTimeline],
  );

  const handleToggleSolo = useCallback(
    (trackId: string) => {
      const tl = timelineRef.current;
      setTimeline({
        ...tl,
        tracks: tl.tracks.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t)),
      });
    },
    [setTimeline],
  );

  const handleSetTrackColor = useCallback(
    (trackId: string, color: string | undefined) => {
      const tl = timelineRef.current;
      const track = tl.tracks.find((t) => t.id === trackId);
      if (!track) return;
      // Find the paired track (same index, opposite kind)
      const sameKind = tl.tracks.filter((t) => t.kind === track.kind);
      const idx = sameKind.findIndex((t) => t.id === trackId);
      const otherKind = track.kind === 'video' ? 'audio' : 'video';
      const otherKindTracks = tl.tracks.filter((t) => t.kind === otherKind);
      const pairedTrackId = idx >= 0 && idx < otherKindTracks.length ? otherKindTracks[idx].id : undefined;
      const applyColor = color ?? track.color;
      setTimeline({
        ...tl,
        tracks: tl.tracks.map((t) =>
          t.id === trackId || t.id === pairedTrackId ? { ...t, color: applyColor } : t
        ),
      });
    },
    [setTimeline],
  );

  const handleDeleteEmptyTracks = useCallback(() => {
    const tl = timelineRef.current;
    const emptyIds = tl.tracks
      .filter((t) => !tl.clips.some((c) => c.trackId === t.id))
      .map((t) => t.id);
    let updated = tl;
    for (const id of emptyIds) {
      updated = { ...updated, tracks: updated.tracks.filter((t) => t.id !== id) };
    }
    setTimeline(updated);
  }, [setTimeline]);

  const hasEmptyTracks = useMemo(
    () => timeline.tracks.some((t) => !timeline.clips.some((c) => c.trackId === t.id)) && timeline.tracks.length > 1,
    [timeline],
  );

  // Handle clip selection (single or additive)
  const handleSelectClip = useCallback(
    (clipId: string, additive: boolean) => {
      if (additive) {
        const next = new Set(selectedClipIds);
        if (next.has(clipId)) next.delete(clipId);
        else next.add(clipId);
        onSelectClips(next);
      } else if (selectedClipIds.has(clipId)) {
        // Clicking an already-selected clip without modifier keeps the group
        // (so you can drag multiple clips together)
      } else {
        onSelectClips(new Set([clipId]));
      }
    },
    [selectedClipIds, onSelectClips],
  );

  // Track area: marquee selection + click to deselect
  const tracksRef = useRef<HTMLDivElement>(null);
  const trackSurfaceRef = useRef<HTMLDivElement>(null);

  const handleTrackAreaPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as Element).closest('.clip-card, .track-row__label')) return;
      const tracksEl = tracksRef.current;
      if (!tracksEl) return;

      if (activeTool === 'blade') return;

      if (activeTool === 'fillGap') {
        e.preventDefault();
        return;
      }

      // Music tool: drag to define a time range on an audio track only
      if (activeTool === 'music') {
        const trackEl = (e.target as HTMLElement).closest('[data-track-id]') as HTMLElement | null;
        if (!trackEl) return;
        const trackId = trackEl.getAttribute('data-track-id');
        if (!trackId) return;
        const track = timelineRef.current.tracks.find((t) => t.id === trackId);
        if (!track || track.kind !== 'audio') return;
        const clipsEl = trackEl.querySelector('.track-row__clips') as HTMLElement | null;
        if (!clipsEl) return;
        const clipsRect = clipsEl.getBoundingClientRect();
        const x = e.clientX - clipsRect.left;
        const rawStart = Math.max(0, x / pxPerSecondRef.current);
        // Snap start time to nearby clip edges
        const startTime = snapTimeToClipEdges(rawStart);
        const containerEl = trackEl.closest('.timeline-editor__tracks') as HTMLElement | null;
        const trackTop = containerEl ? trackEl.getBoundingClientRect().top - containerEl.getBoundingClientRect().top : 0;
        const trackH = trackEl.getBoundingClientRect().height;
        musicDragRef.current = { trackId, startTime, trackTop, trackH, clipsRect };
        const snappedX = startTime * pxPerSecondRef.current;
        setMusicSnapX(startTime !== rawStart ? snappedX + LABEL_WIDTH : null);
        setMusicRange({ left: snappedX + LABEL_WIDTH, width: 0, trackId, trackTop, trackHeight: trackH });
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      const additive = e.shiftKey || e.metaKey;
      if (!additive) onSelectClips(new Set());
      marqueeAdditiveRef.current = additive;

      const surfaceEl = trackSurfaceRef.current ?? tracksEl;
      const rect = surfaceEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const m = { startX: x, startY: y, currentX: x, currentY: y };
      marqueeRef.current = m;
      setMarquee(m);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onSelectClips, activeTool],
  );

  const handleTrackAreaPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (activeTool === 'extend' && extendDragRef.current) {
        const drag = extendDragRef.current;
        const tracksEl = tracksRef.current;
        if (!tracksEl) return;
        const rect = tracksEl.getBoundingClientRect();
        const x = e.clientX - rect.left - LABEL_WIDTH;
        const rawTime = Math.max(0, x / pxPerSecondRef.current);
        let currentTime: number;
        if (drag.direction === 'before') {
          currentTime = Math.max(drag.anchorTime - 10, Math.min(drag.anchorTime, rawTime));
        } else {
          currentTime = Math.min(drag.anchorTime + 10, Math.max(drag.anchorTime, rawTime));
        }
        setExtendDrag({ ...drag, currentTime });
        extendDragRef.current = { ...drag, currentTime };
        return;
      }

      // Music tool drag — snap current edge to clip edges
      const md = musicDragRef.current;
      if (md) {
        const x = e.clientX - md.clipsRect.left;
        const rawTime = Math.max(0, x / pxPerSecondRef.current);
        const snappedTime = snapTimeToClipEdges(rawTime);
        const didSnap = snappedTime !== rawTime;
        const leftTime = Math.min(md.startTime, snappedTime);
        const rightTime = Math.max(md.startTime, snappedTime);
        setMusicSnapX(didSnap ? snappedTime * pxPerSecondRef.current + LABEL_WIDTH : null);
        setMusicRange({
          left: leftTime * pxPerSecondRef.current + LABEL_WIDTH,
          width: (rightTime - leftTime) * pxPerSecondRef.current,
          trackId: md.trackId,
          trackTop: md.trackTop,
          trackHeight: md.trackH,
        });
        return;
      }

      const cur = marqueeRef.current;
      if (!cur) return;
      const surfaceEl = trackSurfaceRef.current ?? tracksRef.current;
      if (!surfaceEl) return;
      const rect = surfaceEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const next = { ...cur, currentX: x, currentY: y };
      marqueeRef.current = next;
      setMarquee(next);
    },
    [activeTool],
  );

  const handleAcceptExtend = useCallback((drag: {
    sourceClipId: string;
    trackId: string;
    direction: 'before' | 'after';
    anchorTime: number;
    currentTime: number;
  }) => {
    const duration = Math.abs(drag.currentTime - drag.anchorTime);
    if (duration < 0.1) return;

    const startTime = drag.direction === 'before'
      ? Math.max(0, drag.anchorTime - duration)
      : drag.anchorTime;

    if (!isSpaceEmpty(drag.trackId, startTime, startTime + duration, undefined)) return;

    const assetId = generateId();
    const clipId = generateId();

    const placeholderAsset: Asset = {
      id: assetId,
      name: 'Generate Extension',
      type: 'video',
      url: '',
      duration,
      createdAt: new Date().toISOString(),
      status: 'online',
      metadata: {
        pendingExtend: true,
        extendDirection: drag.direction,
        extendSourceClipId: drag.sourceClipId,
        generating: false,
      },
    };
    dispatch({ type: 'ADD_ASSET', asset: placeholderAsset });

    const tl = timelineRef.current;
    const newClip: TimelineClip = {
      id: clipId,
      assetId,
      trackId: drag.trackId,
      name: 'Generate Extension',
      startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
    };
    setTimeline({ ...tl, clips: [...tl.clips, newClip] });
    onSelectClips(new Set([clipId]));
    onToolChange?.('select');
  }, [dispatch, isSpaceEmpty, onSelectClips, onToolChange, setTimeline]);

  const handleTrackAreaPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (extendDragRef.current) {
        const drag = extendDragRef.current;
        const duration = Math.abs(drag.currentTime - drag.anchorTime);
        if (duration >= 0.1) {
          handleAcceptExtend(drag);
        }
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        setExtendDrag(null);
        extendDragRef.current = null;
        return;
      }

      // Music tool: finish drag → open popup
      const md = musicDragRef.current;
      if (md) {
        musicDragRef.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* already released */ }
        setMusicSnapX(null);
        const x = e.clientX - md.clipsRect.left;
        const rawEnd = Math.max(0, x / pxPerSecondRef.current);
        const snappedEnd = snapTimeToClipEdges(rawEnd);
        const startT = Math.min(md.startTime, snappedEnd);
        const endT = Math.max(md.startTime, snappedEnd);
        if (endT - startT < 0.5) {
          // Too short — cancel
          setMusicRange(null);
          return;
        }
        // Create a pending placeholder clip — user can trim/extend before generating
        const assetId = generateId();
        const clipId = generateId();
        const durationSec = endT - startT;
        // Give asset a large duration so the clip can be freely extended in both directions
        const maxAssetDur = 3600;
        const trimStartPad = Math.min(startT, (maxAssetDur - durationSec) / 2);
        const trimEndPad = maxAssetDur - durationSec - trimStartPad;
        const placeholderAsset = {
          id: assetId,
          name: 'Generate Music',
          type: 'audio' as const,
          url: '',
          duration: maxAssetDur,
          createdAt: new Date().toISOString(),
          metadata: { pendingMusic: true },
        };
        dispatch({ type: 'ADD_ASSET', asset: placeholderAsset });
        const tl = timelineRef.current;
        const newClip: TimelineClip = {
          id: clipId,
          assetId,
          trackId: md.trackId,
          startTime: startT,
          duration: maxAssetDur,
          trimStart: trimStartPad,
          trimEnd: trimEndPad,
          speed: 1,
          opacity: 1,
          volume: 1,
          flipH: false,
          flipV: false,
          keyframes: [],
          name: 'Generate Music',
        };
        setTimeline({ ...tl, clips: [...tl.clips, newClip] });
        setMusicRange(null);
        onToolChange?.('select');
        return;
      }

      const cur = marqueeRef.current;
      if (!cur) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* already released */ }

      // Compute marquee rect
      const mx1 = Math.min(cur.startX, cur.currentX);
      const mx2 = Math.max(cur.startX, cur.currentX);
      const my1 = Math.min(cur.startY, cur.currentY);
      const my2 = Math.max(cur.startY, cur.currentY);

      // Only do hit-test if dragged at least a few pixels
      if (mx2 - mx1 > 3 || my2 - my1 > 3) {
        const hits = new Set(marqueeAdditiveRef.current ? selectedClipIdsRef.current : []);
        const tl = timelineRef.current;
        const pps = pxPerSecondRef.current;
        const surfaceEl = trackSurfaceRef.current ?? tracksRef.current;
        const surfaceRect = surfaceEl?.getBoundingClientRect();
        const trackRows = surfaceEl?.querySelectorAll<HTMLElement>('.track-row[data-track-id]') ?? [];

        trackRows.forEach((row) => {
          const trackId = row.getAttribute('data-track-id');
          if (!trackId || !surfaceRect) return;
          const rowRect = row.getBoundingClientRect();
          const trackTop = rowRect.top - surfaceRect.top;
          const trackBottom = rowRect.bottom - surfaceRect.top;
          if (my2 < trackTop || my1 > trackBottom) return;
          const trackClips = tl.clips.filter((c) => c.trackId === trackId);
          for (const clip of trackClips) {
            const effDur = clipEffectiveDuration(clip);
            const clipLeft = clip.startTime * pps + LABEL_WIDTH;
            const clipRight = clipLeft + effDur * pps;
            if (mx2 >= clipLeft && mx1 <= clipRight) {
              hits.add(clip.id);
            }
          }
        });
        onSelectClips(hits);
      }

      marqueeRef.current = null;
      setMarquee(null);
    },
    [onSelectClips, handleAcceptExtend],
  );

  // Synchronized horizontal scroll across ruler + video + audio sections
  const videoScrollRef = useRef<HTMLDivElement>(null);
  const audioScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);
  const initializedVideoScrollKeyRef = useRef<string | null>(null);

  const syncScroll = useCallback((source: HTMLDivElement) => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    const left = source.scrollLeft;
    const targets = [scrollRef.current, videoScrollRef.current, audioScrollRef.current];
    for (const t of targets) {
      if (t && t !== source) t.scrollLeft = left;
    }
    setRulerScrollLeft(left);
    onScroll?.(left);
    isSyncingScroll.current = false;
  }, [onScroll]);

  const handleRulerScroll = useCallback(() => {
    if (scrollRef.current) syncScroll(scrollRef.current);
  }, [syncScroll]);

  const handleVideoScroll = useCallback(() => {
    if (videoScrollRef.current) syncScroll(videoScrollRef.current);
  }, [syncScroll]);

  const handleAudioScroll = useCallback(() => {
    if (audioScrollRef.current) syncScroll(audioScrollRef.current);
  }, [syncScroll]);

  // Single-section fallback scroll handler (when only video or only audio tracks exist)
  const handleSingleScroll = useCallback(() => {
    if (videoScrollRef.current) syncScroll(videoScrollRef.current);
  }, [syncScroll]);

  useLayoutEffect(() => {
    const left = Math.max(0, initialScrollLeft);
    const targets = [scrollRef.current, videoScrollRef.current, audioScrollRef.current];
    for (const t of targets) {
      if (t) t.scrollLeft = left;
    }
    setRulerScrollLeft(left);
  }, [timeline.id]);

  // Handle default pinch zoom plus Option+vertical scroll zoom (anchored on the
  // playhead), and forward horizontal scroll on track containers (which use
  // overflow-x:hidden to avoid scrollbar under labels).
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const pendingZoomPpsRef = useRef<number | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  useEffect(() => {
    const ruler = scrollRef.current;
    const trackContainers = [videoScrollRef.current, audioScrollRef.current];
    const allContainers = [ruler, ...trackContainers];
    const flushZoom = () => {
      zoomRafRef.current = null;
      const nextPps = pendingZoomPpsRef.current;
      pendingZoomPpsRef.current = null;
      if (nextPps != null) {
        onZoomChangeRef.current?.(nextPps);
      }
    };
    function handleWheel(e: WheelEvent) {
      const isPinchZoomGesture = e.ctrlKey || e.metaKey;
      const isOptionScrollZoomGesture = e.altKey && Math.abs(e.deltaY) > Math.abs(e.deltaX);
      const isZoomGesture = isPinchZoomGesture || isOptionScrollZoomGesture;
      if (isZoomGesture) {
        e.preventDefault();
        // Batch zoom updates to animation frames so long timelines don't rerender
        // dozens of times per pinch gesture.
        const intensity = Math.min(Math.abs(e.deltaY), 50) / 100; // cap to avoid jumps
        const factor = e.deltaY > 0 ? 1 - intensity : 1 + intensity;
        const basePps = pendingZoomPpsRef.current ?? pxPerSecondRef.current;
        pendingZoomPpsRef.current = Math.max(0.4, Math.min(300, basePps * factor));
        if (zoomRafRef.current == null) {
          zoomRafRef.current = requestAnimationFrame(flushZoom);
        }
        return;
      }
      // Forward horizontal scroll from track containers to ruler (which syncs all)
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (dx && ruler && trackContainers.includes(e.currentTarget as HTMLDivElement)) {
        e.preventDefault();
        ruler.scrollLeft += dx;
      }
    }
    for (const c of allContainers) {
      c?.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (zoomRafRef.current != null) {
        cancelAnimationFrame(zoomRafRef.current);
        zoomRafRef.current = null;
      }
      pendingZoomPpsRef.current = null;
      for (const c of allContainers) {
        c?.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);

  // Keep video tracks anchored to bottom (V1 near divider) when track height changes
  useLayoutEffect(() => {
    const el = videoScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [trackHeight]);

  // Default video section scroll to the bottom so V1 is fully visible on first open/layout change.
  useLayoutEffect(() => {
    const el = videoScrollRef.current;
    if (!el) return;
    const videoTrackCount = timeline.tracks.filter((track) => track.kind === 'video').length;
    const audioTrackCount = timeline.tracks.filter((track) => track.kind === 'audio').length;
    const layoutKey = `${timeline.id}:${videoTrackCount}:${videoTrackCount > 0 && audioTrackCount > 0 ? 'split' : 'single'}`;
    if (initializedVideoScrollKeyRef.current === layoutKey) return;
    initializedVideoScrollKeyRef.current = layoutKey;
    const scrollToBottom = () => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    };
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [timeline.id, timeline.tracks]);

  // Delete selected clips
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (selectedClipIds.size === 0) return;
      e.preventDefault();
      let tl = timelineRef.current;
      for (const id of selectedClipIds) {
        tl = removeClip(tl, id);
      }
      setTimeline(tl);
      onSelectClips(new Set());
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, setTimeline, onSelectClips]);

  // Cmd+L to toggle link/unlink audio
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'l') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (linkUnlinkState.canLink) {
        e.preventDefault();
        handleLinkAudio();
      } else if (linkUnlinkState.canUnlink) {
        e.preventDefault();
        handleUnlinkAudio();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [linkUnlinkState, handleLinkAudio, handleUnlinkAudio]);

  // Blade tool handlers
  const handleBladeClickWrapper = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'blade') return;
      const surfaceEl = trackSurfaceRef.current;
      if (!surfaceEl) return;
      // Calculate time from click position relative to the track area
      const trackArea = e.currentTarget as HTMLElement;
      const rect = trackArea.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const time = Math.max(0, x / pxPerSecond);
      // Find which track was clicked
      const trackEls = surfaceEl.querySelectorAll('[data-track-id]');
      let targetTrackId = '';
      for (const el of trackEls) {
        const tRect = el.getBoundingClientRect();
        if (e.clientY >= tRect.top && e.clientY <= tRect.bottom) {
          targetTrackId = el.getAttribute('data-track-id') ?? '';
          break;
        }
      }
      if (targetTrackId) {
        hookBladeClick(targetTrackId, time, e.shiftKey);
      }
    },
    [activeTool, pxPerSecond, hookBladeClick],
  );

  const handleBladeMove = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === 'blade') {
        const surfaceEl = trackSurfaceRef.current;
        if (!surfaceEl) return;
        const rect = surfaceEl.getBoundingClientRect();
        setBladeX(e.clientX - rect.left);
      } else {
        setBladeX(null);
      }

      if (activeTool === 'fillGap') {
        const trackRows = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.track-row[data-track-id]');
        let trackEl: HTMLElement | null = null;
        for (const row of trackRows) {
          const rect = row.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            trackEl = row;
            break;
          }
        }
        if (!trackEl) {
          setFillGapPreview(null);
          setMusicSnapX(null);
          return;
        }

        const trackId = trackEl.getAttribute('data-track-id');
        if (!trackId) {
          setFillGapPreview(null);
          setMusicSnapX(null);
          return;
        }

        const clipsEl = trackEl.querySelector('.track-row__clips') as HTMLElement | null;
        if (!clipsEl) {
          setFillGapPreview(null);
          setMusicSnapX(null);
          return;
        }

        const clipsRect = clipsEl.getBoundingClientRect();
        const x = e.clientX - clipsRect.left;
        if (x < 0 || x > clipsRect.width) {
          setFillGapPreview(null);
          setMusicSnapX(null);
          return;
        }
        const time = Math.max(0, x / pxPerSecondRef.current);
        const gap = findFillGapAtTime(trackId, time);

        if (!gap) {
          setFillGapPreview(null);
          setMusicSnapX(null);
          return;
        }

        const containerEl = trackEl.closest('.timeline-editor__tracks') as HTMLElement | null;
        const trackTop = containerEl ? trackEl.getBoundingClientRect().top - containerEl.getBoundingClientRect().top : 0;
        const trackH = trackEl.getBoundingClientRect().height;
        setFillGapPreview((prev) => {
          if (
            prev
            && prev.trackId === trackId
            && Math.abs(prev.startTime - gap.startTime) < 0.0001
            && Math.abs(prev.endTime - gap.endTime) < 0.0001
            && Math.abs(prev.trackTop - trackTop) < 0.5
            && Math.abs(prev.trackHeight - trackH) < 0.5
          ) {
            return prev;
          }
          return {
            trackId,
            startTime: gap.startTime,
            endTime: gap.endTime,
            trackTop,
            trackHeight: trackH,
          };
        });
        setMusicSnapX(null);
        return;
      }

      // Music tool: show snap line on hover (only when not actively dragging)
      if (activeTool === 'music' && !musicDragRef.current) {
        const trackEl = (e.target as HTMLElement).closest('[data-track-kind="audio"]') as HTMLElement | null;
        if (trackEl) {
          const clipsEl = trackEl.querySelector('.track-row__clips') as HTMLElement | null;
          if (clipsEl) {
            const clipsRect = clipsEl.getBoundingClientRect();
            const x = e.clientX - clipsRect.left;
            const rawTime = Math.max(0, x / pxPerSecondRef.current);
            const snapped = snapTimeToClipEdges(rawTime);
            if (snapped !== rawTime) {
              setMusicSnapX(snapped * pxPerSecondRef.current + LABEL_WIDTH);
            } else {
              setMusicSnapX(null);
            }
          }
        } else {
          setMusicSnapX(null);
        }
      } else if (activeTool !== 'music') {
        setMusicSnapX(null);
      }
    },
    [activeTool, findFillGapAtTime, snapTimeToClipEdges],
  );

  const handleBladeLeave = useCallback(() => {
    setBladeX(null);
    setMusicSnapX(null);
    setFillGapPreview(null);
  }, []);

  useEffect(() => {
    if (activeTool !== 'fillGap') {
      setFillGapPreview(null);
    }
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'extend') {
      setExtendDrag(null);
      extendDragRef.current = null;
    }
  }, [activeTool]);

  const handleAcceptFillGap = useCallback(() => {
    if (!fillGapPreview) return;
    const confirmed = findFillGapAtTime(
      fillGapPreview.trackId,
      fillGapPreview.startTime + (fillGapPreview.endTime - fillGapPreview.startTime) / 2,
    );
    if (!confirmed) {
      setFillGapPreview(null);
      return;
    }

    const duration = Math.max(1 / FPS, confirmed.endTime - confirmed.startTime);
    const assetId = generateId();
    const clipId = generateId();

    const placeholderAsset: Asset = {
      id: assetId,
      name: 'Generate AI Fill',
      type: 'video',
      url: '',
      duration,
      createdAt: new Date().toISOString(),
      status: 'online',
      metadata: { fillGap: true, pendingFillGap: true },
    };
    dispatch({ type: 'ADD_ASSET', asset: placeholderAsset });

    const tl = timelineRef.current;
    const newClip: TimelineClip = {
      id: clipId,
      assetId,
      trackId: fillGapPreview.trackId,
      name: 'Generate AI Fill',
      startTime: confirmed.startTime,
      duration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
    };
    setTimeline({ ...tl, clips: [...tl.clips, newClip] });
    onSelectClips(new Set([clipId]));
    setFillGapPreview(null);
    onToolChange?.('select');
  }, [dispatch, fillGapPreview, findFillGapAtTime, onSelectClips, onToolChange, setTimeline]);

  // VA separator drag — controls how vertical space is split between video and audio sections
  const vaSplitRef = useRef(vaSplit);
  vaSplitRef.current = vaSplit;

  const handleSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = editorRef.current;
    if (!container) return;
    const containerHeight = container.clientHeight - 32; // subtract ruler height
    let startY = e.clientY;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      startY = ev.clientY;
      const splitDelta = delta / containerHeight;
      const next = Math.max(0.15, Math.min(0.85, vaSplitRef.current + splitDelta));
      setVaSplit(next);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Click "Generate" on a pending clip.
  // Pending music opens the music popup; pending fill-gap opens the fill-gap modal.
  const handleClickGenerateClip = useCallback(
    (clipId: string) => {
      const tl = timelineRef.current;
      const foundClip = tl.clips.find((c) => c.id === clipId);
      if (!foundClip) return;
      const foundAsset = assets.find((a) => a.id === foundClip.assetId);

      if (foundAsset?.metadata?.pendingFillGap) {
        setFillGapModalClipId(clipId);
        return;
      }

      if (foundAsset?.metadata?.pendingExtend) {
        const sourceClipId = foundAsset.metadata.extendSourceClipId as string | undefined;
        const sourceClip = sourceClipId ? tl.clips.find((c) => c.id === sourceClipId) : null;
        if (!sourceClip) {
          dispatch({ type: 'UPDATE_ASSET', asset: { id: foundClip.assetId, metadata: { pendingExtend: true, generating: false } } });
          return;
        }
        setExtendModalClipId(clipId);
        return;
      }

      const effDuration = clipEffectiveDuration(foundClip);
      setPendingMusicClipId(clipId);

      // Find the clip element to anchor the popup to its right edge
      const clipEl = document.querySelector(`[data-clip-id="${clipId}"]`);
      let anchorX = window.innerWidth / 2;
      let anchorY = window.innerHeight / 2;
      if (clipEl) {
        const rect = clipEl.getBoundingClientRect();
        anchorX = rect.right;
        anchorY = rect.bottom;
      }

      setMusicPopup({
        startTime: foundClip.startTime,
        endTime: foundClip.startTime + effDuration,
        trackId: foundClip.trackId,
        anchorX,
        anchorY,
      });
    },
    [assets, dispatch],
  );

  const handleCloseFillGapModal = useCallback(() => {
    setFillGapModalClipId(null);
  }, []);

  const handleFillGapStartGeneration = useCallback(
    (clipId: string, generationPromise: Promise<{ url: string; durationSec: number }>, label: string) => {
      const tl = timelineRef.current;
      const foundClip = tl.clips.find((c) => c.id === clipId);
      if (!foundClip) return;
      const assetId = foundClip.assetId;

      // Transition to generating state
      dispatch({
        type: 'UPDATE_ASSET',
        asset: { id: assetId, name: 'Generating...', metadata: { pendingFillGap: false, generating: true } },
      });
      setTimeline({
        ...tl,
        clips: tl.clips.map((c) => c.id === clipId ? { ...c, name: 'Generating...' } : c),
      });

      setGeneratingClipIds((prev) => new Set(prev).add(clipId));

      generationPromise.then(({ url, durationSec: actualDuration }) => {
        dispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: assetId,
            name: label,
            url,
            duration: actualDuration,
            metadata: { generating: false, fillGap: true },
          },
        });
        const curTl = timelineRef.current;
        setTimeline({
          ...curTl,
          clips: curTl.clips.map((c) =>
            c.id === clipId ? { ...c, name: label, duration: actualDuration } : c,
          ),
        });
        setGeneratingClipIds((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
      }).catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        dispatch({
          type: 'UPDATE_ASSET',
          asset: { id: assetId, name: 'Generation Failed', metadata: { generating: false, error: true } },
        });
        setGeneratingClipIds((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
      });
    },
    [dispatch, setTimeline],
  );

  const handleCloseExtendModal = useCallback(() => {
    setExtendModalClipId(null);
  }, []);

  const handleExtendStartGeneration = useCallback(
    (clipId: string, generationPromise: Promise<{ url: string; durationSec: number }>, label: string) => {
      const tl = timelineRef.current;
      const foundClip = tl.clips.find((c) => c.id === clipId);
      if (!foundClip) return;
      const assetId = foundClip.assetId;

      dispatch({
        type: 'UPDATE_ASSET',
        asset: { id: assetId, name: 'Generating...', metadata: { pendingExtend: false, generating: true } },
      });
      setTimeline({
        ...tl,
        clips: tl.clips.map((c) => c.id === clipId ? { ...c, name: 'Generating...' } : c),
      });
      setGeneratingClipIds((prev) => new Set(prev).add(clipId));

      generationPromise.then(({ url, durationSec: actualDuration }) => {
        dispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: assetId,
            name: label,
            url,
            duration: actualDuration,
            metadata: { generating: false, extend: true },
          },
        });
        const curTl = timelineRef.current;
        setTimeline({
          ...curTl,
          clips: curTl.clips.map((c) =>
            c.id === clipId ? { ...c, name: label, duration: actualDuration } : c,
          ),
        });
        setGeneratingClipIds((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
      }).catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        dispatch({
          type: 'UPDATE_ASSET',
          asset: { id: assetId, name: 'Generation Failed', metadata: { generating: false, pendingExtend: true, error: true } },
        });
        setGeneratingClipIds((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
      });
    },
    [dispatch, setTimeline],
  );

  // Music tool: create placeholder clip on target track then run generation
  const handleMusicStartGeneration = useCallback(
    (generationPromise: Promise<{ url: string; durationSec: number }>, label: string) => {
      const popup = musicPopup;
      if (!popup) return;

      const durationSec = popup.endTime - popup.startTime;
      const existingClipId = pendingMusicClipId;
      let assetId: string;
      let clipId: string;

      if (existingClipId) {
        // Reuse existing pending clip — find its assetId and update to generating state
        clipId = existingClipId;
        const tl = timelineRef.current;
        const foundClip = tl.clips.find((c) => c.id === existingClipId);
        assetId = foundClip?.assetId || generateId();
        // Update asset to generating state (clear pendingMusic, set real duration)
        dispatch({
          type: 'UPDATE_ASSET',
          asset: { id: assetId, name: 'Generating Music...', duration: durationSec, metadata: { pendingMusic: false, generating: true } },
        });
        // Update clip: reset trims and set duration to the effective range
        const updTl = timelineRef.current;
        setTimeline({
          ...updTl,
          clips: updTl.clips.map((c) =>
            c.id === clipId ? { ...c, name: 'Generating Music...', duration: durationSec, trimStart: 0, trimEnd: 0 } : c,
          ),
        });
        setPendingMusicClipId(null);
      } else {
        // Create new placeholder asset + clip (legacy path, shouldn't normally happen)
        assetId = generateId();
        clipId = generateId();
        const placeholderAsset = {
          id: assetId,
          name: 'Generating Music...',
          type: 'audio' as const,
          url: '',
          duration: durationSec,
          createdAt: new Date().toISOString(),
          metadata: { generating: true },
        };
        dispatch({ type: 'ADD_ASSET', asset: placeholderAsset });
        const tl = timelineRef.current;
        const newClip: TimelineClip = {
          id: clipId,
          assetId,
          trackId: popup.trackId,
          startTime: popup.startTime,
          duration: durationSec,
          trimStart: 0,
          trimEnd: 0,
          speed: 1,
          opacity: 1,
          volume: 1,
          flipH: false,
          flipV: false,
          keyframes: [],
          name: 'Generating Music...',
        };
        setTimeline({ ...tl, clips: [...tl.clips, newClip] });
      }

      // Version the label if duplicates exist
      const existingNames = state.assets
        .filter((a) => !a.metadata?.pendingMusic)
        .map((a) => a.name);
      let versionedLabel = label;
      if (existingNames.includes(label)) {
        let v = 2;
        while (existingNames.includes(`${label} v${v}`)) v++;
        versionedLabel = `${label} v${v}`;
      }
      // Replace label in the generating names and store for completion
      const finalLabel = versionedLabel;

      // Track generating state for animation
      setGeneratingClipIds((prev) => new Set(prev).add(clipId));

      // Close popup and clear range
      setMusicPopup(null);
      setMusicRange(null);

      // Run generation in background
      generationPromise.then(({ url, durationSec: actualDuration }) => {
        // Update asset with real data
        dispatch({
          type: 'UPDATE_ASSET',
          asset: {
            id: assetId,
            name: finalLabel,
            url,
            duration: actualDuration,
            metadata: { generating: false },
          },
        });

        // Update clip duration if API returned a different length
        const curTl = timelineRef.current;
        setTimeline({
          ...curTl,
          clips: curTl.clips.map((c) =>
            c.id === clipId ? { ...c, name: finalLabel, duration: actualDuration } : c,
          ),
        });

        setGeneratingClipIds((prev) => {
          const next = new Set(prev);
          next.delete(clipId);
          return next;
        });

        // Extract waveform in background
        extractWaveformPeaks(url).then((peaks) => {
          dispatch({ type: 'UPDATE_ASSET', asset: { id: assetId, metadata: { waveform: peaks } } });
        }).catch(() => {});
      }).catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        // On failure, update the placeholder to show error state
        dispatch({
          type: 'UPDATE_ASSET',
          asset: { id: assetId, name: 'Generation Failed', metadata: { generating: false, error: true } },
        });
        setGeneratingClipIds((prev) => {
          const next = new Set(prev);
          next.delete(clipId);
          return next;
        });
      });
    },
    [dispatch, musicPopup, pendingMusicClipId, setTimeline],
  );

  // All clips paired with their assets (for music popup video analysis)
  const allClipsWithAssets = useMemo(() => {
    const result: { clip: TimelineClip; asset: import('@/types/project').Asset }[] = [];
    for (const clip of timeline.clips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (asset) {
        result.push({ clip, asset });
      }
    }
    return result;
  }, [timeline.clips, assets]);

  const playheadLeft = currentTime * pxPerSecond;

  // generatingClipIds is managed internally for future animation use
  void generatingClipIds;

  // Ruler tick generation — 4-tier hierarchy: major (labeled), mid, minor, micro
  const rulerIsDragging = useRef(false);

  // Determine intervals based on zoom level
  let majorInterval: number;  // labeled ticks
  let midInterval: number;    // prominent unlabeled ticks
  let minorInterval: number;  // small ticks
  let microInterval: number;  // finest subdivision

  if (pxPerSecond >= 200) {
    majorInterval = 1; midInterval = 0.5; minorInterval = 0.25; microInterval = 1 / 24;
  } else if (pxPerSecond >= 100) {
    majorInterval = 1; midInterval = 0.5; minorInterval = 0.25; microInterval = 0.125;
  } else if (pxPerSecond >= 60) {
    majorInterval = 5; midInterval = 1; minorInterval = 0.5; microInterval = 0.25;
  } else if (pxPerSecond >= 30) {
    majorInterval = 5; midInterval = 1; minorInterval = 0.5; microInterval = 0.5;
  } else if (pxPerSecond >= 15) {
    majorInterval = 10; midInterval = 5; minorInterval = 1; microInterval = 1;
  } else if (pxPerSecond >= 5) {
    majorInterval = 30; midInterval = 10; minorInterval = 5; microInterval = 5;
  } else if (pxPerSecond >= 2) {
    majorInterval = 60; midInterval = 30; minorInterval = 10; microInterval = 10;
  } else if (pxPerSecond >= 0.8) {
    majorInterval = 300; midInterval = 60; minorInterval = 30; microInterval = 30;
  } else {
    majorInterval = 600; midInterval = 300; minorInterval = 60; microInterval = 60;
  }

  // Virtualized ruler ticks — only render ticks visible in the current viewport + buffer
  const visibleStart = Math.max(0, (rulerScrollLeft - LABEL_WIDTH) / pxPerSecond);
  const visibleEnd = visibleStart + viewportSeconds + 2;
  const tickStart = Math.max(0, Math.floor(visibleStart / microInterval) * microInterval);
  const tickEnd = Math.min(totalSeconds, Math.ceil(visibleEnd / microInterval) * microInterval + microInterval);

  type TickLevel = 'major' | 'mid' | 'minor' | 'micro';
  const rulerTicks: { time: number; level: TickLevel }[] = [];
  const eps = microInterval * 0.01;
  for (let t = tickStart; t <= tickEnd; t += microInterval) {
    const rounded = Math.round(t * 1000) / 1000;
    let level: TickLevel;
    if (Math.abs(rounded % majorInterval) < eps || Math.abs(rounded % majorInterval - majorInterval) < eps) {
      level = 'major';
    } else if (Math.abs(rounded % midInterval) < eps || Math.abs(rounded % midInterval - midInterval) < eps) {
      level = 'mid';
    } else if (Math.abs(rounded % minorInterval) < eps || Math.abs(rounded % minorInterval - minorInterval) < eps) {
      level = 'minor';
    } else {
      level = 'micro';
    }
    rulerTicks.push({ time: rounded, level });
  }

  const rulerXToTime = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - LABEL_WIDTH;
    return Math.max(0, x / pxPerSecond);
  }, [pxPerSecond]);

  /** Snap a raw time to the nearest clip edge. Returns snapped time + snap indicator X (or null). */
  const snapSeekToEdge = useCallback((raw: number): number => {
    const tl = timelineRef.current;
    const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecondRef.current;
    let closest = raw;
    let minDist = thresholdSec;
    let didSnap = false;
    for (const clip of tl.clips) {
      const effDur = clipEffectiveDuration(clip);
      for (const edge of [clip.startTime, clip.startTime + effDur]) {
        const dist = Math.abs(raw - edge);
        if (dist < minDist) {
          minDist = dist;
          closest = edge;
          didSnap = true;
        }
      }
    }
    setSeekSnapX(didSnap ? closest * pxPerSecondRef.current + LABEL_WIDTH : null);
    return closest;
  }, []);

  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    rulerIsDragging.current = true;
    _onSeek(snapSeekToEdge(rulerXToTime(e.clientX)));
    e.preventDefault();
  }, [rulerXToTime, _onSeek, snapSeekToEdge]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!rulerIsDragging.current) return;
      _onSeek(snapSeekToEdge(rulerXToTime(e.clientX)));
    };
    const onUp = () => {
      rulerIsDragging.current = false;
      setSeekSnapX(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [rulerXToTime, _onSeek, snapSeekToEdge]);

  // Ghost clip drag handlers — capture drag events on the track area to show/hide ghost previews
  const handleGhostDragOver = useCallback((e: React.DragEvent) => {
    if (!draggingAsset) return;
    // Find which track the cursor is over
    const trackEl = (e.target as HTMLElement).closest('[data-track-id]') as HTMLElement | null;
    if (!trackEl) return;
    const trackId = trackEl.getAttribute('data-track-id');
    if (!trackId) return;
    const clipsEl = trackEl.querySelector('.track-row__clips');
    if (!clipsEl) return;
    const rect = clipsEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Get track's top offset relative to the tracks container
    const container = trackEl.closest('.timeline-editor__tracks') as HTMLElement | null;
    const trackTop = container ? trackEl.getBoundingClientRect().top - container.getBoundingClientRect().top : 0;
    setGhostInfo({ trackId, leftPx: Math.max(0, x), trackTop });
  }, [draggingAsset]);

  const handleGhostDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    ghostDragCount.current++;
  }, []);

  const handleGhostDragLeave = useCallback(() => {
    ghostDragCount.current--;
    if (ghostDragCount.current <= 0) {
      ghostDragCount.current = 0;
      setGhostInfo(null);
    }
  }, []);

  const handleGhostDrop = useCallback(() => {
    ghostDragCount.current = 0;
    setGhostInfo(null);
  }, []);

  // Compute video / audio tracks
  const videoTracks = useMemo(() => timeline.tracks.filter((t) => t.kind === 'video'), [timeline.tracks]);
  const audioTracks = useMemo(() => timeline.tracks.filter((t) => t.kind === 'audio'), [timeline.tracks]);
  const hasBothKinds = videoTracks.length > 0 && audioTracks.length > 0;

  const renderTrack = (track: typeof timeline.tracks[0]) => {
    const trackTransitions = (timeline.transitions ?? []).filter((t) => {
      const clipA = timeline.clips.find((c) => c.id === t.clipAId);
      return clipA?.trackId === track.id;
    });
    return (
      <TrackRow
        key={track.id}
        track={track}
        clips={timeline.clips.filter((c) => c.trackId === track.id)}
        assets={assets}
        pixelsPerSecond={pxPerSecond}
        viewportLeftPx={rulerScrollLeft}
        viewportWidthPx={clipViewportWidth}
        snapTime={snapTime}
        selectedClipIds={selectedClipIds}
        onSelectClip={handleSelectClip}
        onTrimClip={handleTrimClip}
        onTrimPreview={onTrimPreview ?? (() => {})}
        onTrimPreviewEnd={onTrimPreviewEnd ?? (() => {})}
        onRemoveClip={handleRemoveClip}
        onDropAsset={handleDropAsset}
        onMoveClip={handleMoveClip}
        onRenameTrack={handleRenameTrack}
        onToggleLock={handleToggleLock}
        onToggleMute={handleToggleMute}
        onToggleSolo={handleToggleSolo}
        onSetTrackColor={handleSetTrackColor}
        onDeleteEmptyTracks={handleDeleteEmptyTracks}
        onMoveSnap={handleMoveSnap}
        snapMoveTime={snapMoveTime}
        trackHeight={trackHeight}
        hasEmptyTracks={hasEmptyTracks}
        onClickGenerate={handleClickGenerateClip}
        activeTool={activeTool}
        onClipMouseDown={handleClipMouseDown}
        rippleAffectedIds={rippleAffectedSet}
        trackForwardHighlightIds={trackForwardHighlightSet}
        transitions={trackTransitions}
        allClips={timeline.clips}
        onRemoveTransition={handleRemoveTransition}
        onUpdateClip={handleUpdateClipProps}
        onAddKeyframe={handleAddKeyframe}
        onMoveKeyframe={handleMoveKeyframe}
        onRemoveKeyframe={handleRemoveKeyframe}
        onClipDoubleClick={onClipDoubleClick}
        onMoveStart={handleMoveStart}
        onClipContextMenu={handleClipContextMenu}
        onExtendEdgeDown={(clipId, edge, e) => {
          const row = (e.target as HTMLElement).closest('.track-row[data-track-id]') as HTMLElement | null;
          const tracksEl = tracksRef.current;
          if (!row || !tracksEl) return;
          const rowRect = row.getBoundingClientRect();
          const tracksRect = tracksEl.getBoundingClientRect();
          handleExtendEdgeDown(
            clipId,
            edge,
            e,
            track.id,
            rowRect.top - tracksRect.top,
            rowRect.height,
          );
        }}
      />
    );
  };

  // Ghost clip rendering for drag preview
  const renderGhostClips = (sectionTracks: typeof timeline.tracks) => {
    if (!ghostInfo || !draggingAsset) return null;
    const ghostDuration = draggingAsset.duration ?? 5;
    const ghostWidth = Math.max(60, ghostDuration * pxPerSecond);
    const ghostLeftPx = ghostInfo.leftPx + LABEL_WIDTH;
    const isVideo = draggingAsset.type === 'video';
    const filmstrip = (draggingAsset.metadata?.filmstrip as string[] | undefined) ?? [];
    const waveform = (draggingAsset.metadata?.waveform as number[] | undefined) ?? [];
    const thumb = toFileUrl(draggingAsset.thumbnailUrl);

    const hoveredTrack = timeline.tracks.find((t) => t.id === ghostInfo.trackId);
    const ghosts: React.ReactNode[] = [];
    const assetIsAudio = draggingAsset.type === 'audio';

    // If audio asset is hovered over a video track, redirect ghost to the first audio track
    const redirectToAudioTrack = assetIsAudio && hoveredTrack?.kind === 'video';
    const effectiveTrack = redirectToAudioTrack
      ? (audioTracks[0] ?? hoveredTrack)
      : hoveredTrack;
    const effectiveTrackIdx = effectiveTrack ? sectionTracks.findIndex((t) => t.id === effectiveTrack.id) : -1;
    const effectiveTop = redirectToAudioTrack && effectiveTrackIdx >= 0
      ? effectiveTrackIdx * trackHeight
      : ghostInfo.trackTop;

    // Primary ghost: render on effective track if it's in this section
    const effectiveInSection = effectiveTrack ? sectionTracks.some((t) => t.id === effectiveTrack.id) : false;
    if (effectiveInSection && effectiveTrack) {
      const top = effectiveTop + 8;
      const height = trackHeight - 16;
      const trackColor = effectiveTrack.color || (effectiveTrack.kind === 'video' ? DEFAULT_VIDEO_COLOR : DEFAULT_AUDIO_COLOR);

      ghosts.push(
        <div
          key="ghost-primary"
          className={`track-row__ghost-clip ${isVideo ? 'track-row__ghost-clip--video' : assetIsAudio ? 'track-row__ghost-clip--audio' : 'track-row__ghost-clip--image'}`}
          style={{ left: ghostLeftPx, width: ghostWidth, top, height, borderColor: trackColor }}
        >
          {isVideo && filmstrip.length > 0 ? (
            <div className="track-row__ghost-filmstrip">
              {filmstrip.slice(0, Math.max(1, Math.floor(ghostWidth / 80))).map((frame, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={frame} alt="" className="track-row__ghost-filmstrip-frame" draggable={false} />
              ))}
            </div>
          ) : assetIsAudio ? (
            waveform.length > 0 ? (
              <div className="track-row__ghost-waveform" style={{ '--ghost-track-color': trackColor } as React.CSSProperties} />
            ) : (
              <div className="track-row__ghost-audio-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.5"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
              </div>
            )
          ) : thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="track-row__ghost-thumb" src={thumb} alt="" draggable={false} />
          ) : null}
          <div className="track-row__ghost-overlay">
            <span className="track-row__ghost-name">{draggingAsset.name}</span>
          </div>
        </div>,
      );
    }

    // Paired audio ghost: for video assets dragged onto a video track,
    // show the audio counterpart on the matching audio track in this section
    if (isVideo && hoveredTrack?.kind === 'video') {
      const videoTrackIdx = videoTracks.findIndex((t) => t.id === ghostInfo.trackId);
      if (videoTrackIdx >= 0 && videoTrackIdx < audioTracks.length) {
        const audioTrack = audioTracks[videoTrackIdx];
        const audioIdx = sectionTracks.findIndex((t) => t.id === audioTrack.id);
        if (audioIdx >= 0) {
          const top = audioIdx * trackHeight + 8;
          const height = trackHeight - 16;
          const aTrackColor = audioTrack.color || DEFAULT_AUDIO_COLOR;
          ghosts.push(
            <div
              key="ghost-audio"
              className="track-row__ghost-clip track-row__ghost-clip--audio"
              style={{ left: ghostLeftPx, width: ghostWidth, top, height, borderColor: aTrackColor }}
            >
              {waveform.length > 0 ? (
                <div className="track-row__ghost-waveform" style={{ '--ghost-track-color': aTrackColor } as React.CSSProperties} />
              ) : (
                <div className="track-row__ghost-audio-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.5"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
                </div>
              )}
              <div className="track-row__ghost-overlay">
                <span className="track-row__ghost-name">{draggingAsset.name} (audio)</span>
              </div>
            </div>,
          );
        }
      }
    }

    return ghosts.length > 0 ? <>{ghosts}</> : null;
  };

  // Shared track content (overlays like blade, snap lines, marquee — playhead is rendered globally)
  const trackOverlays = (
    <>
      {ripplePreview && (() => {
        const clip = timeline.clips.find((c) => c.id === ripplePreview.clipId);
        if (!clip) return null;
        const effDur = clipEffectiveDuration(clip);
        const indicatorTime = ripplePreview.delta > 0
          ? clip.startTime + effDur
          : clip.startTime;
        const indicatorLeft = indicatorTime * pxPerSecond + LABEL_WIDTH;
        return (
          <div
            className={`timeline-editor__ripple-indicator${ripplePreview.delta < 0 ? ' timeline-editor__ripple-indicator--negative' : ''}`}
            style={{ left: indicatorLeft }}
          />
        );
      })()}
      {slipPreview && (() => {
        const clip = timeline.clips.find((c) => c.id === slipPreview.clipId);
        if (!clip) return null;
        const effDur = clipEffectiveDuration(clip);
        const clipCenterX = (clip.startTime + effDur / 2) * pxPerSecond + LABEL_WIDTH;
        const trackIdx = timeline.tracks.findIndex((t) => t.id === clip.trackId);
        if (trackIdx < 0) return null;
        return (
          <div
            className="timeline-editor__slip-badge"
            style={{ left: clipCenterX, top: trackIdx * trackHeight }}
          >
            Slip: {slipPreview.sourceOffset >= 0 ? '+' : ''}{slipPreview.sourceOffset.toFixed(2)}s
          </div>
        );
      })()}
      {slidePreview && (() => {
        const clip = timeline.clips.find((c) => c.id === slidePreview.clipId);
        if (!clip) return null;
        const effDur = clipEffectiveDuration(clip);
        const clipCenterX = (clip.startTime + effDur / 2) * pxPerSecond + LABEL_WIDTH;
        const trackIdx = timeline.tracks.findIndex((t) => t.id === clip.trackId);
        if (trackIdx < 0) return null;
        return (
          <div
            className="timeline-editor__slide-badge"
            style={{ left: clipCenterX, top: trackIdx * trackHeight }}
          >
            L: {slidePreview.leftDelta >= 0 ? '+' : ''}{slidePreview.leftDelta.toFixed(2)}s | R: {slidePreview.rightDelta >= 0 ? '+' : ''}{slidePreview.rightDelta.toFixed(2)}s
          </div>
        );
      })()}
      {moveSnapX !== null && (
        <div className="timeline-editor__move-snap-line" style={{ left: moveSnapX }} />
      )}
      {seekSnapX !== null && (
        <div className="timeline-editor__seek-snap-line" style={{ left: seekSnapX }} />
      )}
    </>
  );

  // Music overlays — only rendered in the audio section
  const musicOverlays = (
    <>
      {musicRange && (
        <div className="timeline-editor__music-range" style={{ left: musicRange.left, width: musicRange.width, top: musicRange.trackTop, height: musicRange.trackHeight }} />
      )}
      {musicSnapX !== null && (
        <div className="timeline-editor__music-snap-line" style={{ left: musicSnapX }} />
      )}
    </>
  );

  const renderFillGapPreview = (sectionTracks: typeof timeline.tracks) => {
    if (!fillGapPreview) return null;
    if (!sectionTracks.some((t) => t.id === fillGapPreview.trackId)) return null;
    const width = (fillGapPreview.endTime - fillGapPreview.startTime) * pxPerSecond;
    if (width <= 1) return null;

    return (
      <button
        type="button"
        className="timeline-editor__fill-gap-preview"
        style={{
          left: fillGapPreview.startTime * pxPerSecond + LABEL_WIDTH,
          width,
          top: fillGapPreview.trackTop + 8,
          height: fillGapPreview.trackHeight - 16,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleAcceptFillGap();
        }}
        title="Click to fill this gap"
      >
        <span className="timeline-editor__fill-gap-preview-label">
          <img src={aiSvg} alt="" className="timeline-editor__fill-gap-preview-ai-icon" aria-hidden="true" />
          Fill Gap
        </span>
      </button>
    );
  };

  const renderExtendPreview = (sectionTracks: typeof timeline.tracks) => {
    if (!extendDrag) return null;
    if (!sectionTracks.some((t) => t.id === extendDrag.trackId)) return null;
    const duration = Math.abs(extendDrag.currentTime - extendDrag.anchorTime);
    if (duration < 0.01) return null;

    const startTime = extendDrag.direction === 'before'
      ? extendDrag.anchorTime - duration
      : extendDrag.anchorTime;
    const width = duration * pxPerSecond;
    if (width <= 1) return null;

    return (
      <div
        className="timeline-editor__extend-preview"
        style={{
          left: startTime * pxPerSecond + LABEL_WIDTH,
          width,
          top: extendDrag.trackTop + 8,
          height: extendDrag.trackHeight - 16,
          pointerEvents: 'none',
        }}
      >
        <span className="timeline-editor__extend-preview-label">
          {Math.round(duration * 10) / 10}s
        </span>
      </div>
    );
  };

  const renderMarquee = () => {
    if (!marquee) return null;
    const x = Math.min(marquee.startX, marquee.currentX);
    const y = Math.min(marquee.startY, marquee.currentY);
    const w = Math.abs(marquee.currentX - marquee.startX);
    const h = Math.abs(marquee.currentY - marquee.startY);
    return <div className="timeline-editor__marquee" style={{ left: x, top: y, width: w, height: h }} />;
  };

  const trackAreaClass = `timeline-editor__tracks${activeTool === 'blade' ? ' timeline-editor__tracks--blade' : activeTool !== 'select' ? ` timeline-editor__tracks--${activeTool}` : ''}`;
  const trackAreaHandlers = {
    onPointerDown: handleTrackAreaPointerDown,
    onPointerMove: handleTrackAreaPointerMove,
    onPointerUp: handleTrackAreaPointerUp,
    onPointerCancel: handleTrackAreaPointerUp,
    onClick: handleBladeClickWrapper,
    onMouseMove: handleBladeMove,
    onMouseLeave: handleBladeLeave,
    onDragOver: handleGhostDragOver,
    onDragEnter: handleGhostDragEnter,
    onDragLeave: handleGhostDragLeave,
    onDrop: handleGhostDrop,
  };

  const fillGapModalClip = fillGapModalClipId
    ? timeline.clips.find((c) => c.id === fillGapModalClipId) ?? null
    : null;
  const fillGapModalAsset = fillGapModalClip
    ? assets.find((a) => a.id === fillGapModalClip.assetId) ?? null
    : null;

  const extendModalClip = extendModalClipId
    ? timeline.clips.find((c) => c.id === extendModalClipId) ?? null
    : null;
  const extendModalAsset = extendModalClip
    ? assets.find((a) => a.id === extendModalClip.assetId) ?? null
    : null;
  const extendModalSourceClipId = extendModalAsset?.metadata?.extendSourceClipId as string | undefined;
  const extendModalSourceClip = extendModalSourceClipId
    ? timeline.clips.find((c) => c.id === extendModalSourceClipId) ?? null
    : null;
  const extendModalSourceAsset = extendModalSourceClip
    ? assets.find((a) => a.id === extendModalSourceClip.assetId) ?? null
    : null;

  return (
    <div className="timeline-editor" ref={editorRef}>
      {/* Ruler row — sticky, shared across both sections */}
      <div className="timeline-editor__ruler-wrapper">
        <div className="timeline-editor__scroll timeline-editor__scroll--ruler" ref={scrollRef} onScroll={handleRulerScroll}>
          <div className="timeline-editor__ruler-row" style={{ minWidth: totalWidth + LABEL_WIDTH }}>
            <div className="timeline-editor__ruler-spacer">
              <span className="timeline-editor__timecode-display">{formatTimecode(currentTime)}</span>
            </div>
            <div
              className="timeline-editor__ruler"
              onMouseDown={handleRulerMouseDown}
              onPointerMove={handleMarkerPointerMove}
              onPointerUp={handleMarkerPointerUp}
            >
              {rulerTicks.map(({ time, level }) => (
                <div
                  key={time}
                  className={`timeline-editor__ruler-tick timeline-editor__ruler-tick--${level}`}
                  style={{ left: time * pxPerSecond }}
                >
                  {level === 'major' && <span className="timeline-editor__ruler-label">{formatTimecode(time)}</span>}
                </div>
              ))}
              {/* Timeline markers */}
              {(timeline.markers ?? []).map((marker) => (
                <div
                  key={marker.id}
                  className="timeline-editor__marker"
                  style={{ left: marker.time * pxPerSecond, '--marker-color': marker.color } as React.CSSProperties}
                  onPointerDown={(e) => handleMarkerPointerDown(marker.id, e)}
                  onContextMenu={(e) => handleMarkerContextMenu(marker.id, e)}
                  title={marker.label || formatTimecode(marker.time)}
                >
                  <svg className="timeline-editor__marker-flag" width="10" height="14" viewBox="0 0 10 14">
                    <path d="M1 0v14M1 0h8l-2.5 4L9 8H1" fill="var(--marker-color)" stroke="var(--marker-color)" strokeWidth="0.5" />
                  </svg>
                </div>
              ))}
              <div className="timeline-editor__playhead-head" style={{ left: playheadLeft }} />
            </div>
          </div>
        </div>
      </div>

      {/* Global playhead — spans across all sections including divider */}
      <div className="timeline-editor__playhead-clip" style={{ left: LABEL_WIDTH }}>
        <div className="timeline-editor__playhead--global" style={{ left: playheadLeft - rulerScrollLeft }} />
      </div>

      <div className="timeline-editor__track-surface" ref={trackSurfaceRef}>
        {/* Blade line — rendered at surface level to span across all sections */}
        {activeTool === 'blade' && bladeX !== null && (
          <div className="timeline-editor__blade-line" style={{ left: bladeX }} />
        )}
        {/* Track sections — split into video and audio with draggable separator */}
        {hasBothKinds ? (
          <>
            <div className="timeline-editor__va-section timeline-editor__va-section--video" style={{ flex: `${vaSplit} 1 0%` }}>
              <div className="timeline-editor__scroll timeline-editor__scroll--tracks" ref={videoScrollRef} onScroll={handleVideoScroll}>
                <div
                  ref={tracksRef}
                  className={trackAreaClass}
                  style={{ minWidth: totalWidth + LABEL_WIDTH }}
                  {...trackAreaHandlers}
                >
                  {trackOverlays}
                  {[...videoTracks].reverse().map(renderTrack)}
                  {renderGhostClips(videoTracks)}
                  {renderFillGapPreview(videoTracks)}
                  {renderExtendPreview(videoTracks)}
                </div>
              </div>
            </div>
            <div
              className="edit-tab__va-separator edit-tab__va-separator--draggable"
              onMouseDown={handleSeparatorMouseDown}
              onDoubleClick={() => setVaSplit(0.5)}
            />
            <div className="timeline-editor__va-section" style={{ flex: `${1 - vaSplit} 1 0%` }}>
              <div className="timeline-editor__scroll timeline-editor__scroll--tracks" ref={audioScrollRef} onScroll={handleAudioScroll}>
                <div
                  className={trackAreaClass}
                  style={{ minWidth: totalWidth + LABEL_WIDTH }}
                  {...trackAreaHandlers}
                >
                  {trackOverlays}
                  {musicOverlays}
                  {audioTracks.map(renderTrack)}
                  {renderGhostClips(audioTracks)}
                  {renderFillGapPreview(audioTracks)}
                  {renderExtendPreview(audioTracks)}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="timeline-editor__va-section timeline-editor__va-section--video" style={{ flex: 1 }}>
            <div className="timeline-editor__scroll timeline-editor__scroll--tracks" ref={videoScrollRef} onScroll={handleSingleScroll}>
              <div
                ref={tracksRef}
                className={trackAreaClass}
                style={{ minWidth: totalWidth + LABEL_WIDTH }}
                {...trackAreaHandlers}
              >
                {trackOverlays}
                {musicOverlays}
                {[...videoTracks].reverse().map(renderTrack)}
                {audioTracks.map(renderTrack)}
                {renderGhostClips([...videoTracks, ...audioTracks])}
                {renderFillGapPreview([...videoTracks, ...audioTracks])}
                {renderExtendPreview([...videoTracks, ...audioTracks])}
              </div>
            </div>
          </div>
        )}
        {renderMarquee()}
      </div>

      {musicPopup && (
        <MusicGenerationPopup
          startTime={musicPopup.startTime}
          endTime={musicPopup.endTime}
          anchorX={musicPopup.anchorX}
          anchorY={musicPopup.anchorY}
          videoClips={allClipsWithAssets}
          onStartGeneration={handleMusicStartGeneration}
          onClose={() => { setMusicPopup(null); setMusicRange(null); setPendingMusicClipId(null); }}
        />
      )}

      {fillGapModalClip && fillGapModalAsset && (
        <FillGapModal
          clip={fillGapModalClip}
          asset={fillGapModalAsset}
          trackClips={timeline.clips.filter((c) => c.trackId === fillGapModalClip.trackId)}
          assets={assets}
          onStartGeneration={handleFillGapStartGeneration}
          onClose={handleCloseFillGapModal}
        />
      )}

      {extendModalClip && extendModalAsset && extendModalSourceClip && extendModalSourceAsset && (
        <ExtendModal
          clip={extendModalClip}
          asset={extendModalAsset}
          sourceClip={extendModalSourceClip}
          sourceAsset={extendModalSourceAsset}
          onStartGeneration={handleExtendStartGeneration}
          onClose={handleCloseExtendModal}
        />
      )}

      {/* Clip context menu — portaled to body */}
      {clipCtxMenu && createPortal(
        <div
          ref={clipCtxMenuRef}
          className="clip-ctx"
          style={{ top: clipCtxMenu.y, left: clipCtxMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="clip-ctx__item" onClick={handleClipCut}>
            <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="5" r="2.5" /><circle cx="5" cy="11" r="2.5" /><path d="M14 2L7.3 8M14 14L7.3 8" />
            </svg>
            Cut
            <span className="clip-ctx__shortcut">⌘X</span>
          </button>
          <button className="clip-ctx__item" onClick={handleClipCopy}>
            <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M2 11V2.5A.5.5 0 012.5 2H11" />
            </svg>
            Copy
            <span className="clip-ctx__shortcut">⌘C</span>
          </button>
          <button
            className={`clip-ctx__item${!clipboardRef.current ? ' clip-ctx__item--disabled' : ''}`}
            disabled={!clipboardRef.current}
            onClick={handleClipPaste}
          >
            <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="1" width="10" height="14" rx="1.5" /><path d="M6 1V0M10 1V0M6 4h4" />
            </svg>
            Paste
            <span className="clip-ctx__shortcut">⌘V</span>
          </button>

          <div className="clip-ctx__sep" />
          <button
            className={`clip-ctx__item ${hasVideoInSelection ? '' : 'clip-ctx__item--disabled'}`}
            onClick={handleSyncAudio}
            disabled={!hasVideoInSelection}
          >
            Sync Audio{hasVideoInSelection && !hasAudioInSelection ? '...' : ''}
          </button>
          {linkUnlinkState.canLink && (
            <button className="clip-ctx__item" onClick={handleLinkAudio}>
              <img src={linkSvg} alt="" className="clip-ctx__icon clip-ctx__icon--img" aria-hidden="true" />
              Link Audio
              <span className="clip-ctx__shortcut">{'\u2318'}L</span>
            </button>
          )}
          {linkUnlinkState.canUnlink && (
            <button className="clip-ctx__item" onClick={handleUnlinkAudio}>
              <img src={unlinkSvg} alt="" className="clip-ctx__icon clip-ctx__icon--img" aria-hidden="true" />
              Unlink Audio
              <span className="clip-ctx__shortcut">{'\u2318'}L</span>
            </button>
          )}

          <div className="clip-ctx__sep" />

          <button className="clip-ctx__item clip-ctx__item--danger" onClick={handleClipDelete}>
            <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8.5a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5V4" />
            </svg>
            Delete
            <span className="clip-ctx__shortcut">⌫</span>
          </button>
          {(() => {
            const clip = timeline.clips.find((c) => c.id === clipCtxMenu?.clipId);
            return clip && clip.keyframes.length > 0 ? (
              <button className="clip-ctx__item" onClick={handleClearKeyframes}>
                <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 2l12 12M5 8l3-3 3 3" />
                </svg>
                Clear Keyframes
              </button>
            ) : null;
          })()}

          <div className="clip-ctx__sep" />

          {/* Send Frame to Spaces */}
          <div
            className="clip-ctx__submenu-wrap"
            onMouseEnter={() => setSpacesSubOpen('frame')}
            onMouseLeave={() => { if (spacesSubOpen === 'frame') setSpacesSubOpen(null); }}
          >
            <button className={`clip-ctx__item clip-ctx__item--has-sub`} onClick={() => {
              if (state.spaces.length === 1) {
                handleSendFrameToSpace(state.spaces[0].id);
              } else {
                setSpacesSubOpen(spacesSubOpen === 'frame' ? null : 'frame');
              }
            }}>
              <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="14" height="10" rx="2" /><path d="M8 6v4M6 8h4" />
              </svg>
              <span style={{ flex: 1 }}>Send Frame to Spaces</span>
              {state.spaces.length > 1 && (
                <svg className="clip-ctx__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4l4 4-4 4" />
                </svg>
              )}
            </button>
            {spacesSubOpen === 'frame' && state.spaces.length > 1 && (
              <div className="clip-ctx__sub">
                {state.spaces.map((space) => (
                  <button
                    key={space.id}
                    className={`clip-ctx__item${space.id === state.activeSpaceId ? ' clip-ctx__item--active' : ''}`}
                    onClick={() => handleSendFrameToSpace(space.id)}
                  >
                    {space.name}
                    {space.id === state.activeSpaceId && <span className="clip-ctx__badge">Active</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Send Clip to Spaces */}
          <div
            className="clip-ctx__submenu-wrap"
            onMouseEnter={() => setSpacesSubOpen('clip')}
            onMouseLeave={() => { if (spacesSubOpen === 'clip') setSpacesSubOpen(null); }}
          >
            <button className={`clip-ctx__item clip-ctx__item--has-sub`} onClick={() => {
              if (state.spaces.length === 1) {
                handleSendClipToSpace(state.spaces[0].id);
              } else {
                setSpacesSubOpen(spacesSubOpen === 'clip' ? null : 'clip');
              }
            }}>
              <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h12v2H2zM2 7h12v6H2z" /><path d="M8 9v2M7 10h2" />
              </svg>
              <span style={{ flex: 1 }}>Send Clip to Spaces</span>
              {state.spaces.length > 1 && (
                <svg className="clip-ctx__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4l4 4-4 4" />
                </svg>
              )}
            </button>
            {spacesSubOpen === 'clip' && state.spaces.length > 1 && (
              <div className="clip-ctx__sub">
                {state.spaces.map((space) => (
                  <button
                    key={space.id}
                    className={`clip-ctx__item${space.id === state.activeSpaceId ? ' clip-ctx__item--active' : ''}`}
                    onClick={() => handleSendClipToSpace(space.id)}
                  >
                    {space.name}
                    {space.id === state.activeSpaceId && <span className="clip-ctx__badge">Active</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Marker context menu — portaled to body */}
      {markerCtxMenu && createPortal(
        <div
          ref={markerCtxMenuRef}
          className="clip-ctx"
          style={{ top: markerCtxMenu.y, left: markerCtxMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="clip-ctx__item clip-ctx__item--danger" onClick={() => handleRemoveMarker(markerCtxMenu.markerId)}>
            <svg className="clip-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8.5a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5V4" />
            </svg>
            Delete Marker
          </button>
        </div>,
        document.body,
      )}

      {syncDialogOpen && syncDialogVideoClipId && timeline && (
        <SyncAudioDialog
          open={syncDialogOpen}
          onClose={() => {
            setSyncDialogOpen(false);
            setSyncDialogVideoClipId(null);
            setSyncDialogAudioClipId(null);
          }}
          onSync={(audioClipId, audioAssetId, offsetSeconds, scratchMode) => {
            if (audioClipId) {
              // Case A: audio clip already on timeline
              const updated = syncClips(timeline, syncDialogVideoClipId!, audioClipId, offsetSeconds, scratchMode);
              setTimeline(updated);
            } else if (audioAssetId) {
              // Case B: find existing clip with this asset on timeline, or add new one
              const existingAudioClip = timeline.clips.find((c) => c.assetId === audioAssetId);
              if (existingAudioClip) {
                // Audio is already on the timeline — just move it to sync position
                const updated = syncClips(timeline, syncDialogVideoClipId!, existingAudioClip.id, offsetSeconds, scratchMode);
                setTimeline(updated);
              } else {
                // Audio not on timeline yet — add it then sync
                const asset = assets.find((a) => a.id === audioAssetId);
                if (asset) {
                  const audioTrack = timeline.tracks.find((t) => t.kind === 'audio' && !t.locked);
                  if (audioTrack) {
                    let updated = addClipToTrack(timeline, audioTrack.id, asset, 0);
                    const newAudioClip = updated.clips.filter((c) => c.trackId === audioTrack.id).pop();
                    if (newAudioClip) {
                      updated = syncClips(updated, syncDialogVideoClipId!, newAudioClip.id, offsetSeconds, scratchMode);
                    }
                    setTimeline(updated);
                  }
                }
              }
            }
            setSyncDialogOpen(false);
            setSyncDialogVideoClipId(null);
            setSyncDialogAudioClipId(null);
          }}
          videoClipId={syncDialogVideoClipId}
          audioClipId={syncDialogAudioClipId}
          timeline={timeline}
          assets={assets}
          projectId={projectId}
        />
      )}
    </div>
  );
}
