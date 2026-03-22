import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useWorkspace, getActiveTimeline } from '@/components/workspace/workspace-shell';
import { ClipCard } from '@/components/edit/clip-card';
import { TimelinePreview, type PreviewMode } from './timeline-preview';
import { useNativeVideoSurface } from '@/components/edit/use-native-video-surface';
import { useNativeTimelineVideo } from '@/components/edit/use-native-timeline-video';
import type { ActiveClipEntry } from '@/lib/editor/playback-engine';
import {
  trimClip,
  removeClip,
  moveClip,
  splitClip,
  duplicateClip,
  snapToHalfSecond,
  calculateTimelineDuration,
  clipsOnTrack,
} from '@/lib/editor/timeline-operations';
import type { Timeline } from '@/types/timeline';
import { clipEffectiveDuration, clipEndTime } from '@/types/timeline';

const DEFAULT_PX_PER_SECOND = 60;
const MIN_PX_PER_SECOND = 10;
const MAX_PX_PER_SECOND = 300;

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface CreateTimelineProps {
  open: boolean;
  onToggle: () => void;
  previewMode: PreviewMode;
  onPreviewModeChange: (mode: PreviewMode) => void;
}

export function CreateTimeline({ open, onToggle, previewMode, onPreviewModeChange }: CreateTimelineProps) {
  const { state, dispatch } = useWorkspace();
  const timeline = getActiveTimeline(state);
  const { assets } = state;
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'blade'>('select');
  const [bladeX, setBladeX] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ clipId: string; left: number } | null>(null);
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const v1Track = useMemo(() => timeline.tracks.find((t) => t.kind === 'video'), [timeline]);
  const v1TrackId = v1Track?.id;
  const v1Clips = useMemo(
    () => (v1TrackId ? clipsOnTrack(timeline, v1TrackId) : []),
    [timeline, v1TrackId],
  );
  const clipCount = v1Clips.length;
  // Ensure the timeline always fills the visible container width
  const containerWidth = trackRef.current?.clientWidth ?? 800;
  const minSeconds = Math.max(30, Math.ceil(containerWidth / pxPerSecond) + 5);
  const totalWidth = Math.max(timeline.duration, minSeconds) * pxPerSecond;
  const timelineDuration = useMemo(
    () => Math.max(calculateTimelineDuration(timeline), 1),
    [timeline],
  );

  const assetMap = useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets],
  );

  const rulerTicks = useMemo(() => {
    const ticks: { pos: number; label?: string; half?: boolean }[] = [];
    const totalSeconds = Math.ceil(Math.max(timeline.duration, minSeconds));

    // Choose major/minor tick intervals based on zoom level
    // pxPerStep should stay roughly 40-80px apart for readability
    let major: number;
    let minor: number | null;
    if (pxPerSecond >= 60) {
      major = 1; minor = 0.5;        // 1s labels, 0.5s minor
    } else if (pxPerSecond >= 30) {
      major = 2; minor = 1;           // 2s labels, 1s minor
    } else if (pxPerSecond >= 15) {
      major = 5; minor = 1;           // 5s labels, 1s minor
    } else if (pxPerSecond >= 8) {
      major = 10; minor = 5;          // 10s labels, 5s minor
    } else {
      major = 30; minor = 10;         // 30s labels, 10s minor
    }

    // Format label: use minutes once values reach 60s
    const formatLabel = (s: number) => {
      if (s >= 60) {
        const m = Math.floor(s / 60);
        const sec = Math.round(s % 60);
        return sec === 0 ? `${m}m` : `${m}:${String(sec).padStart(2, '0')}`;
      }
      return `${s}s`;
    };

    // Generate minor ticks
    const step = minor ?? major;
    const count = Math.ceil(totalSeconds / step);
    for (let i = 0; i <= count; i++) {
      const s = i * step;
      const pos = s * pxPerSecond;
      const isMajor = s % major === 0;
      ticks.push({
        pos,
        label: isMajor ? formatLabel(s) : undefined,
        half: !isMajor,
      });
    }
    return ticks;
  }, [timeline.duration, pxPerSecond, minSeconds]);

  const setTimeline = useCallback(
    (tl: Timeline) => {
      dispatch({ type: 'SET_TIMELINE', timelineId: tl.id, timeline: tl });
    },
    [dispatch],
  );

  const handleTrimClip = useCallback(
    (clipId: string, trimStart: number, trimEnd: number, startTime?: number) => {
      setTimeline(trimClip(timeline, clipId, trimStart, trimEnd, startTime));
    },
    [timeline, setTimeline],
  );

  const handleRemoveClip = useCallback(
    (clipId: string) => setTimeline(removeClip(timeline, clipId)),
    [timeline, setTimeline],
  );

  const handleMoveClip = useCallback(
    (clipId: string, newStartTime: number) => {
      if (!v1TrackId) return;
      setTimeline(moveClip(timeline, clipId, v1TrackId, newStartTime));
    },
    [v1TrackId, timeline, setTimeline],
  );

  const handleDuplicateClip = useCallback(
    (clipId: string, newStartTime: number) => {
      const result = duplicateClip(timeline, clipId, newStartTime);
      setTimeline(result.timeline);
      if (result.newClipId) setSelectedClipId(result.newClipId);
    },
    [timeline, setTimeline],
  );

  const handleDuplicateDrag = useCallback(
    (clipId: string, ghostLeft: number | null) => {
      setGhost(ghostLeft !== null ? { clipId, left: ghostLeft } : null);
    },
    [],
  );

  const handleBladeCutAt = useCallback((time: number) => {
    if (!v1TrackId) return;
    const clip = v1Clips.find(
      (c) => time > c.startTime && time < clipEndTime(c),
    );
    if (clip) {
      setTimeline(splitClip(timeline, clip.id, time));
    }
  }, [v1TrackId, v1Clips, timeline, setTimeline]);

  const getTimeFromPointer = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    const trackArea = (e.currentTarget as HTMLElement).closest('.create-timeline__track-area');
    if (!trackArea) return null;
    const rect = trackArea.getBoundingClientRect();
    const scrollContainer = trackArea.parentElement;
    const scrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;
    const x = e.clientX - rect.left + scrollLeft;
    return Math.max(0, x / pxPerSecond);
  }, [pxPerSecond]);

  const handleTrackMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'blade') {
        setBladeX(null);
        return;
      }
      const trackArea = e.currentTarget as HTMLElement;
      const rect = trackArea.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setBladeX(x);
    },
    [activeTool],
  );

  const handleTrackMouseLeave = useCallback(() => {
    setBladeX(null);
  }, []);

  const handleBladeClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'blade') return;
      const trackArea = e.currentTarget as HTMLElement;
      const rect = trackArea.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, x / pxPerSecond);
      handleBladeCutAt(time);
    },
    [activeTool, handleBladeCutAt, pxPerSecond],
  );

  const scrubRef = useRef(false);

  const seekFromEvent = useCallback((e: React.PointerEvent | React.MouseEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const scrollLeft = 'scrollLeft' in el ? el.scrollLeft : 0;
    const x = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, x / pxPerSecond);
    setCurrentTime(snapToHalfSecond(time));
  }, [pxPerSecond]);

  const handleRulerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      scrubRef.current = true;
      seekFromEvent(e, e.currentTarget as HTMLElement);
    },
    [seekFromEvent],
  );

  const handleRulerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubRef.current) return;
      seekFromEvent(e, e.currentTarget as HTMLElement);
    },
    [seekFromEvent],
  );

  const handleRulerPointerUp = useCallback((e: React.PointerEvent) => {
    scrubRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore if already released */
    }
  }, []);

  const handleTrackAreaPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as Element).closest('.clip-card')) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      scrubRef.current = true;
      seekFromEvent(e, e.currentTarget as HTMLElement);
    },
    [seekFromEvent],
  );

  const handleTrackAreaPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubRef.current) return;
      seekFromEvent(e, e.currentTarget as HTMLElement);
    },
    [seekFromEvent],
  );

  const handleTrackAreaPointerUp = useCallback((e: React.PointerEvent) => {
    scrubRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore if already released */
    }
  }, []);

  // Delete selected clip with Delete/Backspace key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!selectedClipId) return;
      e.preventDefault();
      handleRemoveClip(selectedClipId);
      setSelectedClipId(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, handleRemoveClip]);

  // Pinch / Cmd+scroll zoom — anchored to pointer position
  useEffect(() => {
    const container = trackRef.current;
    if (!container) return undefined;
    function handleWheel(e: WheelEvent) {
      const el = trackRef.current;
      if (!el) return;
      // Pinch gesture (ctrlKey set by trackpad pinch) or Cmd+scroll
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left + el.scrollLeft;

      setPxPerSecond((prev) => {
        const factor = 1 - e.deltaY * 0.01;
        const next = Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, prev * factor));
        // Adjust scroll so the time under the pointer stays in place
        const timeAtPointer = pointerX / prev;
        const newPointerX = timeAtPointer * next;
        el.scrollLeft += newPointerX - pointerX;
        return next;
      });
    }
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
    // Re-attach when timeline opens/closes since the scroll container is conditionally rendered
  }, [open]);

  useEffect(() => {
    if (!isPlaying) return;
    const tick = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      setCurrentTime((t) => {
        const next = t + dt;
        if (next >= timelineDuration) {
          setIsPlaying(false);
          return timelineDuration;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, timelineDuration]);

  const handlePlayPause = useCallback(() => {
    if (currentTime >= timelineDuration) setCurrentTime(0);
    setIsPlaying((p) => !p);
  }, [currentTime, timelineDuration]);

  const handleSkipToStart = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleSkipToEnd = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(timelineDuration);
  }, [timelineDuration]);

  const activeClip = useMemo(() => {
    if (!v1TrackId) return null;
    return v1Clips.find(
      (c) => currentTime >= c.startTime && currentTime < clipEndTime(c),
    ) ?? null;
  }, [v1TrackId, v1Clips, currentTime]);

  const activeAsset = activeClip ? assetMap.get(activeClip.assetId) : null;

  // Native video surface for preview
  const [nativeVideoAvailable, setNativeVideoAvailable] = useState(false);
  useEffect(() => {
    window.electronAPI.nativeVideo.isAvailable()
      .then(({ available }) => setNativeVideoAvailable(available))
      .catch(() => {});
  }, []);

  const { surfaceRef: previewSurfaceRef, surfaceVersion: previewSurfaceVersion } = useNativeVideoSurface({
    surfaceId: 'create-preview',
    enabled: nativeVideoAvailable,
  });

  const activeClipEntries = useMemo((): ActiveClipEntry[] => {
    if (!activeClip || !activeAsset) return [];
    return [{ clip: activeClip, asset: activeAsset }];
  }, [activeClip, activeAsset]);

  const previewVisible = nativeVideoAvailable && open && previewMode !== 'minimized';

  useNativeTimelineVideo({
    enabled: previewVisible,
    surfaceId: 'create-preview',
    timeline,
    assets,
    activeClips: activeClipEntries,
    currentTime,
    isPlaying,
    proxyMode: 'auto',
    surfaceVersion: previewSurfaceVersion,
  });

  // Hide native surface when timeline is closed or preview is minimized
  useEffect(() => {
    if (!nativeVideoAvailable) return;
    if (!previewVisible) {
      window.electronAPI.nativeVideo.setSurfaceHidden({ surfaceId: 'create-preview', hidden: true });
    }
  }, [nativeVideoAvailable, previewVisible]);

  const playheadLeft = currentTime * pxPerSecond;

  return (
    <div className={`create-timeline ${open ? 'create-timeline--open' : ''}`}>
      <div className="create-timeline__nubs">
        <button className="create-timeline__toggle" onClick={onToggle}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`create-timeline__chevron ${open ? 'create-timeline__chevron--open' : ''}`}
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
          <span>Timeline</span>
          {clipCount > 0 && (
            <span className="create-timeline__badge">{clipCount}</span>
          )}
        </button>
        {open && previewMode === 'minimized' && (
          <button
            className="create-timeline__preview-nub"
            onClick={() => onPreviewModeChange('pip')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <rect x="12" y="10" width="8" height="6" rx="1" ry="1" fill="currentColor" />
            </svg>
            <span>Preview</span>
          </button>
        )}
      </div>

      {open && v1Track && (
        <>
        <TimelinePreview
          asset={activeAsset}
          clip={activeClip}
          currentTime={currentTime}
          isPlaying={isPlaying}
          mode={previewMode}
          onModeChange={onPreviewModeChange}
          nativeSurfaceRef={previewSurfaceRef}
          nativeEnabled={previewVisible}
        />
        <div className="create-timeline__panel">
          <div className="create-timeline__toolbar">
            <span className="create-timeline__timecode">
              {formatTimecode(currentTime)} / {formatTimecode(timelineDuration)}
            </span>
            <div className="create-timeline__toolbar-controls">
              <button
                type="button"
                className="create-timeline__skip-btn"
                onClick={handleSkipToStart}
                title="Skip to start"
              >
                <svg width="12" height="12" viewBox="0 0 64 64" fill="currentColor">
                  <path d="m20.025 28.772c-1.03.753-1.638 1.952-1.638 3.228s.608 2.475 1.638 3.228c6.825 4.994 27.616 20.207 35.613 26.058 1.216.89 2.828 1.021 4.172.339 1.343-.681 2.19-2.06 2.19-3.567 0-10.879 0-41.237 0-52.116 0-1.507-.847-2.886-2.19-3.567-1.344-.682-2.956-.551-4.172.339z" />
                  <path d="m2 6v52c0 2.209 1.791 4 4 4h5c2.209 0 4-1.791 4-4v-52c0-2.209-1.791-4-4-4-1.488 0-3.512 0-5 0-2.209 0-4 1.791-4 4z" />
                </svg>
              </button>
              <button
                type="button"
                className="create-timeline__play-btn"
                onClick={handlePlayPause}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 512 512" fill="currentColor">
                    <path d="m22.4 256v-166.3c0-68.9 74.6-112 134.2-77.5l144.1 83.2 144.1 83.2c59.7 34.4 59.7 120.6 0 155l-144.1 83.2-144.1 83.2c-59.6 34.3-134.2-8.7-134.2-77.6z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="create-timeline__skip-btn"
                onClick={handleSkipToEnd}
                title="Skip to end"
              >
                <svg width="12" height="12" viewBox="0 0 32 32" fill="currentColor">
                  <path d="m1 4.8122v22.3756c0 1.6399 1.8195 2.6256 3.1931 1.7297l16.4446-10.7247c1.5838-1.0329 1.5838-3.3527 0-4.3856l-16.4446-10.7247c-1.3736-.8959-3.1931.0898-3.1931 1.7297z" />
                  <path d="m29.9845 29h-3.969c-.5609 0-1.0155-.4546-1.0155-1.0155v-23.969c0-.5609.4546-1.0155 1.0155-1.0155h3.969c.5609 0 1.0155.4546 1.0155 1.0155v23.969c0 .5609-.4546 1.0155-1.0155 1.0155z" />
                </svg>
              </button>
            </div>
            <div className="create-timeline__tool-controls">
              <button
                type="button"
                className={`create-timeline__tool-btn ${activeTool === 'select' ? 'create-timeline__tool-btn--active' : ''}`}
                onClick={() => setActiveTool('select')}
                title="Select (V)"
              >
                <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor">
                  <path d="m27 5.9905a1 1 0 0 1 -.707-1.6975l3-3a1 1 0 0 1 1.414 1.414l-3 3a.9977.9977 0 0 1 -.707.2835z" />
                  <path d="m29.9287 11h-1.9287a1 1 0 0 1 0-2h1.9287a1 1 0 0 1 0 2z" />
                  <path d="m22 5a1 1 0 0 1 -1-1v-1.9287a1 1 0 0 1 2 0v1.9287a1 1 0 0 1 -1 1z" />
                  <path d="m30 18.993a.9947.9947 0 0 1 -.707-.286l-3-3a1 1 0 0 1 1.414-1.414l3 3a1.0043 1.0043 0 0 1 -.707 1.7z" />
                  <path d="m17 5.9941a.9939.9939 0 0 1 -.707-.2871l-3-3a1 1 0 0 1 1.414-1.414l3 3a1.0047 1.0047 0 0 1 -.707 1.7011z" />
                  <path d="m23.3662 8.6343a2.1333 2.1333 0 0 0 -2.293-.49l-18.6855 7.1179a2.1559 2.1559 0 0 0 .1484 4.08l7.7061 2.312a.1551.1551 0 0 1 .1045.104l2.3115 7.7061a2.129 2.129 0 0 0 1.9863 1.5346 2.1654 2.1654 0 0 0 2.0938-1.3867l7.1181-18.686a2.13 2.13 0 0 0 -.4902-2.2919z" />
                </svg>
              </button>
              <button
                type="button"
                className={`create-timeline__tool-btn ${activeTool === 'blade' ? 'create-timeline__tool-btn--active' : ''}`}
                onClick={() => setActiveTool('blade')}
                title="Blade (B)"
              >
                <svg width="20" height="20" viewBox="0 0 43.35 43.35" fill="currentColor" clipRule="evenodd" fillRule="evenodd">
                  <path d="m2.741 29.7346c.4981 0 .9056-.4075.9056-.9056 0-.4981-.4075-.9056-.9056-.9056h-2.741v-12.4976h2.741c.4981 0 .9056-.4075.9056-.9056 0-.4981-.4075-.9056-.9056-.9056v-2.8859h37.8672v2.8859c-.4981 0-.9056.4075-.9056.9056 0 .4981.4075.9056.9056.9056h2.741v12.4976h-2.741c-.4981 0-.9056.4075-.9056.9056 0 .4981.4075.9056.9056.9056v2.8859h-37.8672zm1.5456-11.4048c.3745 0 .6937.9109.816 2.1881h2.0135l.1756-.2259.312-.4014c.1892-.2434.4545-.3731.7627-.3731.3083 0 .5735.1298.7627.3731l.312.4014.1756.2259h2.7411c.1224-1.2772.4415-2.1881.816-2.1881s.6936.9109.816 2.1881h5.4276.0001c.4204-.8188 1.2733-1.379 2.2571-1.379s1.8367.5602 2.2571 1.379h5.4277c.1223-1.2772.4415-2.1881.816-2.1881.3744 0 .6936.9109.816 2.1881h2.7411l.1756-.2259.312-.4014c.1891-.2433.4544-.3731.7626-.3731.3083 0 .5736.1297.7627.3731l.312.4014.1756.2259h2.0135.0001c.1223-1.2772.4415-2.1881.816-2.1881.4801 0 .8694 1.4975.8694 3.3448s-.3893 3.3448-.8694 3.3448c-.3745 0-.6937-.9109-.816-2.1881h-.0001-2.0135l-.1756.2259-.312.4013c-.1891.2434-.4544.3732-.7626.3732-.3083 0-.5736-.1298-.7627-.3731l-.3121-.4014-.1756-.2259h-2.741c-.1224 1.2772-.4416 2.1881-.816 2.1881-.3745 0-.6937-.9109-.816-2.1881h-5.4277c-.4204.8188-1.2733 1.379-2.2571 1.379s-1.8367-.5602-2.2572-1.379h-5.4276c-.1224 1.2772-.4415 2.1881-.816 2.1881s-.6936-.9109-.816-2.1881h-.0001-2.741l-.1756.2259-.312.4014c-.1892.2433-.4544.3731-.7627.3731-.3082 0-.5735-.1298-.7627-.3732l-.3119-.4013-.1756-.2259h-2.0136c-.1223 1.2772-.4415 2.1881-.816 2.1881-.4801 0-.8694-1.4975-.8694-3.3448s.3893-3.3448.8694-3.3448z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="create-timeline__scroll-container" ref={trackRef}>
            <div
              className="create-timeline__ruler"
              style={{ width: totalWidth }}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
              onPointerCancel={handleRulerPointerUp}
            >
              {rulerTicks.map((tick) => (
                <span
                  key={`${tick.pos}-${tick.half ? 'h' : 'f'}`}
                  className={`create-timeline__tick ${tick.half ? 'create-timeline__tick--half' : ''}`}
                  style={{ left: tick.pos }}
                >
                  {tick.label && (
                    <span className="create-timeline__tick-label">{tick.label}</span>
                  )}
                </span>
              ))}
              <div
                className="create-timeline__playhead-head"
                style={{ left: playheadLeft }}
              />
            </div>

            <div
              className={`create-timeline__track-area ${activeTool === 'blade' ? 'create-timeline__track-area--blade' : ''}`}
              onPointerDown={activeTool === 'select' ? handleTrackAreaPointerDown : undefined}
              onPointerMove={activeTool === 'select' ? handleTrackAreaPointerMove : undefined}
              onPointerUp={activeTool === 'select' ? handleTrackAreaPointerUp : undefined}
              onPointerCancel={activeTool === 'select' ? handleTrackAreaPointerUp : undefined}
              onMouseMove={handleTrackMouseMove}
              onMouseLeave={handleTrackMouseLeave}
              onClick={handleBladeClick}
            >
              <div
                className="create-timeline__playhead"
                style={{ left: playheadLeft }}
              />
              {bladeX !== null && (
                <div
                  className="create-timeline__blade-line"
                  style={{ left: bladeX }}
                />
              )}
              <div className="create-timeline__track">
                {v1Clips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    asset={assetMap.get(clip.assetId)}
                    pixelsPerSecond={pxPerSecond}
                    selected={activeTool === 'select' && selectedClipId === clip.id}
                    onSelect={activeTool === 'select' ? (id: string) => setSelectedClipId(id) : undefined}
                    onTrim={activeTool === 'select' ? handleTrimClip : undefined}
                    onRemove={activeTool === 'select' ? handleRemoveClip : undefined}
                    onMove={activeTool === 'select' ? handleMoveClip : undefined}
                    onDuplicate={activeTool === 'select' ? handleDuplicateClip : undefined}
                    onDuplicateDrag={activeTool === 'select' ? handleDuplicateDrag : undefined}
                  />
                ))}
                {ghost && (() => {
                  const srcClip = v1Clips.find((c) => c.id === ghost.clipId);
                  const srcAsset = srcClip ? assetMap.get(srcClip.assetId) : undefined;
                  if (!srcClip) return null;
                  const eff = clipEffectiveDuration(srcClip);
                  const w = Math.max(60, eff * pxPerSecond);
                  const isVid = srcAsset?.type === 'video';
                  const frames = (srcAsset?.metadata?.filmstrip as string[] | undefined) ?? [];
                  const thumbUrl = srcAsset?.thumbnailUrl || srcAsset?.url;
                  return (
                    <div
                      className={`clip-card clip-card__ghost ${isVid ? 'clip-card--video' : 'clip-card--image'}`}
                      style={{ width: w, left: ghost.left }}
                    >
                      {isVid && frames.length > 0 ? (
                        <div className="clip-card__filmstrip">
                          {frames.map((frame, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={frame} alt="" className="clip-card__filmstrip-frame" draggable={false} />
                          ))}
                        </div>
                      ) : thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="clip-card__thumb" src={thumbUrl} alt={srcClip.name} draggable={false} />
                      ) : null}
                      <div className="clip-card__overlay">
                        <span className="clip-card__name">{srcClip.name}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {clipCount === 0 && (
            <div className="create-timeline__empty">
              Use the + button on nodes to add clips
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
