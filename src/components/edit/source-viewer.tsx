import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import type { Asset } from '@/types/project';
import type { Clip, ToolType } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import { formatTimecode } from './time-ruler';
import { toFileUrl } from '@/lib/utils/file-url';
import { useNativeVideoSurface } from './use-native-video-surface';
import { isHtmlOnlyAsset, resolveNativePlaybackSource } from '@/lib/editor/visual-playback-state';
import type { PlaybackProxyMode } from '@/lib/editor/playback-engine';
import { SourceViewerMaskTool } from './source-viewer-mask-tool';

interface SourceViewerProps {
  clip: Clip | null;
  asset: Asset | null;
  seekRequest?: { id: string; time: number } | null;
  onClose: () => void;
  onDropAssetId?: (assetId: string) => void;
  nativeVideoEnabled?: boolean;
  proxyMode?: PlaybackProxyMode;
  activeTool?: ToolType;
  onAcceptMaskedVideo?: (result: {
    url: string;
    outputKind: 'image' | 'video';
    promptCount: number;
    detectionThreshold: number;
    currentFrameIndex: number;
    sourceTimeSeconds: number;
    sourceWasTrimmed?: boolean;
  }) => Promise<void> | void;
}

/* Reusable SVG transport icons */
const Ico = ({ children, w = 14 }: { children: React.ReactNode; w?: number }) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const PlayIcon = () => <Ico><path d="M7 4l13 8-13 8V4z" fill="currentColor" stroke="none" /></Ico>;
const PauseIcon = () => <Ico><rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" /></Ico>;
const SkipBackIcon = () => <Ico><line x1="5" y1="4" x2="5" y2="20" /><polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none" /></Ico>;
const SkipForwardIcon = () => <Ico><line x1="19" y1="4" x2="19" y2="20" /><polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" /></Ico>;
const StepBackIcon = () => <Ico><polyline points="15 18 9 12 15 6" /></Ico>;
const StepForwardIcon = () => <Ico><polyline points="9 6 15 12 9 18" /></Ico>;

export function SourceViewer({
  clip,
  asset,
  seekRequest = null,
  onClose,
  onDropAssetId,
  nativeVideoEnabled = false,
  proxyMode = 'off',
  activeTool = 'select',
  onAcceptMaskedVideo,
}: SourceViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubDragging = useRef(false);
  const pendingSeekTime = useRef<number | null>(null);
  const [sourceTime, setSourceTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const maskToolEnabled = activeTool === 'mask' && !!asset && asset.type === 'video';
  const nativePlaybackEnabled = nativeVideoEnabled
    && !maskToolEnabled
    && !isHtmlOnlyAsset(asset)
    && !!asset
    && (asset.type === 'video' || asset.type === 'image');
  const surfaceAspectRatio = asset && asset.width && asset.height
    ? asset.width / asset.height
    : null;
  const { surfaceRef, surfaceVersion } = useNativeVideoSurface({
    surfaceId: 'source-viewer',
    enabled: nativePlaybackEnabled,
    destroyOnUnmount: false,
    fitAspectRatio: surfaceAspectRatio,
  });

  const effectiveDuration = clip ? clipEffectiveDuration(clip) : (asset?.duration ?? 0);

  void onClose;

  useEffect(() => {
    setSourceTime(0);
    setIsPlaying(false);
  }, [clip?.id, asset?.id]);

  useEffect(() => {
    if (!seekRequest) return;
    const clampedTime = Math.max(0, Math.min(seekRequest.time, effectiveDuration || seekRequest.time));
    setSourceTime(clampedTime);
    setIsPlaying(false);

    if (nativePlaybackEnabled) return;
    if (!videoRef.current) return;

    const offset = clip ? clip.trimStart : 0;
    videoRef.current.currentTime = offset + clampedTime;
  }, [clip, effectiveDuration, nativePlaybackEnabled, seekRequest]);

  useLayoutEffect(() => {
    if (!nativePlaybackEnabled || !asset) {
      window.electronAPI.nativeVideo.clearSurface('source-viewer');
      return;
    }
    window.electronAPI.nativeVideo.setSurfaceHidden({
      surfaceId: 'source-viewer',
      hidden: false,
    });
    window.electronAPI.nativeVideo.syncSurface({
      surfaceId: 'source-viewer',
      descriptors: [{
        id: clip?.id ?? asset.id,
        kind: asset.type === 'image' ? 'image' : 'video',
        source: resolveNativePlaybackSource(asset, proxyMode),
        currentTime: asset.type === 'video' ? (clip ? clip.trimStart : 0) + sourceTime : 0,
        rate: 1,
        opacity: 1,
        zIndex: 1,
        visible: true,
        playing: isPlaying && asset.type === 'video',
        muted: false,
        flipH: false,
        flipV: false,
      }],
    });
  }, [nativePlaybackEnabled, asset, clip, sourceTime, isPlaying, proxyMode, surfaceVersion]);

  useEffect(() => {
    if (!nativePlaybackEnabled || !asset || asset.type !== 'video' || !isPlaying) return undefined;
    let frameId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      let shouldContinue = true;
      setSourceTime((prev) => {
        const next = Math.min(effectiveDuration, prev + delta);
        if (next >= effectiveDuration) {
          shouldContinue = false;
          setIsPlaying(false);
          return effectiveDuration;
        }
        return next;
      });
      if (shouldContinue) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [nativePlaybackEnabled, asset, isPlaying, effectiveDuration]);

  const togglePlay = useCallback(() => {
    if (nativePlaybackEnabled) {
      if (asset?.type === 'image') return;
      setIsPlaying((prev) => !prev);
      return;
    }
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [asset?.type, isPlaying, nativePlaybackEnabled]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const offset = clip ? clip.trimStart : 0;
    const t = videoRef.current.currentTime - offset;
    setSourceTime(Math.max(0, t));
  }, [clip]);

  const stepFrame = useCallback((dir: 1 | -1) => {
    if (nativePlaybackEnabled) {
      setSourceTime((prev) => Math.max(0, Math.min(prev + dir * (1 / 24), effectiveDuration)));
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime += dir * (1 / 24);
  }, [effectiveDuration, nativePlaybackEnabled]);

  const goToStart = useCallback(() => {
    if (nativePlaybackEnabled) {
      setSourceTime(0);
      setIsPlaying(false);
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = clip ? clip.trimStart : 0;
  }, [clip, nativePlaybackEnabled]);

  const goToEnd = useCallback(() => {
    if (nativePlaybackEnabled) {
      setSourceTime(effectiveDuration);
      setIsPlaying(false);
      return;
    }
    if (!videoRef.current) return;
    const offset = clip ? clip.trimStart : 0;
    videoRef.current.currentTime = offset + effectiveDuration;
  }, [clip, effectiveDuration, nativePlaybackEnabled]);

  const scrubSeek = useCallback((clientX: number) => {
    if (!scrubRef.current || effectiveDuration <= 0) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newSourceTime = pct * effectiveDuration;
    setSourceTime(newSourceTime);
    if (nativePlaybackEnabled) return;
    if (videoRef.current) {
      const offset = clip ? clip.trimStart : 0;
      const targetTime = offset + newSourceTime;
      const el = videoRef.current;
      if (el.seeking) {
        pendingSeekTime.current = targetTime;
        if (!el.dataset.seekQueued) {
          el.dataset.seekQueued = '1';
          el.addEventListener('seeked', () => {
            delete el.dataset.seekQueued;
            const pending = pendingSeekTime.current;
            if (pending !== null) {
              pendingSeekTime.current = null;
              el.currentTime = pending;
            }
          }, { once: true });
        }
      } else {
        el.currentTime = targetTime;
      }
    }
  }, [clip, effectiveDuration, nativePlaybackEnabled]);

  const handleScrubDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    scrubDragging.current = true;
    scrubSeek(e.clientX);
    e.preventDefault();
  }, [scrubSeek]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!scrubDragging.current) return;
      scrubSeek(e.clientX);
    };
    const onUp = () => { scrubDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [scrubSeek]);

  const scrubProgress = effectiveDuration > 0 ? sourceTime / effectiveDuration : 0;

  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-asset-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    dragCounter.current = 0;
    setDragOver(false);
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    if (assetId && onDropAssetId) {
      e.preventDefault();
      onDropAssetId(assetId);
    }
  }, [onDropAssetId]);

  return (
    <div
      className={`source-viewer${dragOver ? ' source-viewer--drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="source-viewer__header">
        <span className="source-viewer__title">Clip Viewer</span>
      </div>
      {maskToolEnabled && asset && onAcceptMaskedVideo ? (
        <div className="source-viewer__mask-wrap">
          <SourceViewerMaskTool
            asset={asset}
            clip={clip}
            onAcceptMaskedVideo={onAcceptMaskedVideo}
          />
        </div>
      ) : (
        <>
          <div className="source-viewer__content">
            {asset ? (
              asset.type === 'video' ? (
                nativePlaybackEnabled ? (
                  <div
                    ref={surfaceRef}
                    className="source-viewer__video"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    className="source-viewer__video"
                    src={toFileUrl(asset.fileRef || asset.url)}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setIsPlaying(false)}
                  />
                )
              ) : asset.type === 'image' ? (
                nativePlaybackEnabled ? (
                  <div ref={surfaceRef} className="source-viewer__image" />
                ) : (
                  <img className="source-viewer__image" src={toFileUrl(asset.fileRef || asset.url)} alt={asset.name} />
                )
              ) : (
                <div className="source-viewer__audio-placeholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                  <span>{asset.name}</span>
                </div>
              )
            ) : (
              <div className="source-viewer__empty">Double-click a clip to view source</div>
            )}
          </div>
          <div className="viewer-scrubber" ref={scrubRef} onMouseDown={handleScrubDown}>
            <div className="viewer-scrubber__track">
              <div className="viewer-scrubber__fill" style={{ width: `${scrubProgress * 100}%` }} />
              <div className="viewer-scrubber__head" style={{ left: `${scrubProgress * 100}%` }} />
            </div>
          </div>
          <div className="source-viewer__transport">
            <span className="source-viewer__timecode source-viewer__timecode--current">
              {formatTimecode(sourceTime)}
            </span>
            <div className="source-viewer__controls">
              {asset && (
                <>
                  <button className="source-viewer__btn" onClick={goToStart} title="Go to start"><SkipBackIcon /></button>
                  <button className="source-viewer__btn" onClick={() => stepFrame(-1)} title="Step back"><StepBackIcon /></button>
                  <button className="source-viewer__btn source-viewer__btn--play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button className="source-viewer__btn" onClick={() => stepFrame(1)} title="Step forward"><StepForwardIcon /></button>
                  <button className="source-viewer__btn" onClick={goToEnd} title="Go to end"><SkipForwardIcon /></button>
                </>
              )}
            </div>
            <span className="source-viewer__timecode source-viewer__timecode--duration">
              {formatTimecode(effectiveDuration)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
