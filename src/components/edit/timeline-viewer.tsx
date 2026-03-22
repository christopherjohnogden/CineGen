import { useState, useCallback, useRef, useEffect } from 'react';
import type { Asset } from '@/types/project';
import { formatTimecode } from './time-ruler';
import { toFileUrl } from '@/lib/utils/file-url';
import type { PlaybackProxyMode } from '@/lib/editor/playback-engine';

interface TimelineViewerProps {
  videoContainerRef: (el: HTMLDivElement | null) => void;
  nativeSurfaceRef?: (el: HTMLDivElement | null) => void;
  nativeVideoEnabled?: boolean;
  activeAsset: Asset | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  proxyMode: PlaybackProxyMode;
  onProxyModeChange: (mode: PlaybackProxyMode) => void;
  sourceViewerVisible: boolean;
  onToggleSourceViewer: () => void;
  onDropAssetId?: (assetId: string) => void;
  inspectorVisible: boolean;
  onToggleInspector: () => void;
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

const FRAME_DURATION = 1 / 24;

export function TimelineViewer({
  videoContainerRef,
  nativeSurfaceRef,
  nativeVideoEnabled = false,
  activeAsset,
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSeek,
  proxyMode,
  onProxyModeChange,
  sourceViewerVisible,
  onToggleSourceViewer,
  onDropAssetId,
  inspectorVisible,
  onToggleInspector,
}: TimelineViewerProps) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubDragging = useRef(false);

  const stepFrame = useCallback((dir: 1 | -1) => {
    onSeek(Math.max(0, Math.min(currentTime + dir * FRAME_DURATION, duration)));
  }, [onSeek, currentTime, duration]);

  const goToStart = useCallback(() => onSeek(0), [onSeek]);
  const goToEnd = useCallback(() => onSeek(duration), [onSeek, duration]);
  const cycleProxyMode = useCallback(() => {
    if (proxyMode === 'off') onProxyModeChange('auto');
    else if (proxyMode === 'auto') onProxyModeChange('on');
    else onProxyModeChange('off');
  }, [proxyMode, onProxyModeChange]);

  const scrubSeek = useCallback((clientX: number) => {
    if (!scrubRef.current || duration <= 0) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  }, [duration, onSeek]);

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

  const scrubProgress = duration > 0 ? currentTime / duration : 0;

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
      className={`timeline-viewer${dragOver ? ' timeline-viewer--drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="timeline-viewer__header">
        <span className="timeline-viewer__title">Timeline Viewer</span>
        <button
          className={`timeline-viewer__source-toggle ${sourceViewerVisible ? 'timeline-viewer__source-toggle--active' : ''}`}
          onClick={onToggleSourceViewer}
          title={sourceViewerVisible ? 'Single viewer' : 'Dual viewer'}
        >
          <svg width="16" height="16" viewBox="0 0 32 32" fill="currentColor" clipRule="evenodd" fillRule="evenodd" strokeLinejoin="round" strokeMiterlimit={2}>
            <g transform="translate(-144)">
              <path d="m159 3v26c0 .552.448 1 1 1s1-.448 1-1v-26c0-.552-.448-1-1-1s-1 .448-1 1zm-2 2h-8c-.796 0-1.559.316-2.121.879-.563.562-.879 1.325-.879 2.121v16c0 .796.316 1.559.879 2.121.562.563 1.325.879 2.121.879h8zm6 0v22h8c.796 0 1.559-.316 2.121-.879.563-.562.879-1.325.879-2.121v-16c0-.796-.316-1.559-.879-2.121-.562-.563-1.325-.879-2.121-.879z"/>
            </g>
          </svg>
        </button>
        {!inspectorVisible && (
          <button
            className="timeline-viewer__source-toggle"
            onClick={onToggleInspector}
            title="Show inspector"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="m7.22 2.03v19.95a5.779 5.779 0 0 1 -3.09-1.03 4.264 4.264 0 0 1 -1.08-1.08 6.143 6.143 0 0 1 -1.05-3.68v-8.38c0-3.44 1.94-5.57 5.22-5.78zm14.78 5.78v8.38c0 3.64-2.17 5.81-5.81 5.81h-7.47v-20h7.47a6.143 6.143 0 0 1 3.68 1.05 4.264 4.264 0 0 1 1.08 1.08 6.143 6.143 0 0 1 1.05 3.68zm-8.525 4.19 2.025-2.029a.75.75 0 0 0 -1.06-1.061l-2.56 2.56a.749.749 0 0 0 0 1.06l2.56 2.56a.75.75 0 0 0 1.06-1.061z"/>
            </svg>
          </button>
        )}
      </div>
      <div className="timeline-viewer__content">
        {!activeAsset && (
          <span className="timeline-viewer__empty">No clip at playhead</span>
        )}
        <div
          ref={nativeVideoEnabled ? nativeSurfaceRef : videoContainerRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
        {!nativeVideoEnabled && activeAsset?.type === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={toFileUrl(activeAsset.fileRef || activeAsset.url)}
            alt={activeAsset.name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
            draggable={false}
          />
        )}
      </div>
      <div className="viewer-scrubber" ref={scrubRef} onMouseDown={handleScrubDown}>
        <div className="viewer-scrubber__track">
          <div className="viewer-scrubber__fill" style={{ width: `${scrubProgress * 100}%` }} />
          <div className="viewer-scrubber__head" style={{ left: `${scrubProgress * 100}%` }} />
        </div>
      </div>
      <div className="timeline-viewer__transport">
        <div className="timeline-viewer__transport-left">
          <span className="timeline-viewer__timecode timeline-viewer__timecode--current">
            {formatTimecode(currentTime)}
          </span>
          <button
            className={`timeline-viewer__source-toggle timeline-viewer__proxy-toggle timeline-viewer__proxy-toggle--${proxyMode}`}
            onClick={cycleProxyMode}
            title={
              proxyMode === 'off'
                ? 'Playback mode: Original files'
                : proxyMode === 'auto'
                  ? 'Playback mode: Auto (original first, switch to proxy if needed)'
                  : 'Playback mode: Proxy only'
            }
          >
            {proxyMode === 'off' ? 'Orig' : proxyMode === 'auto' ? 'Auto' : 'Proxy'}
          </button>
        </div>
        <div className="timeline-viewer__controls">
          <button className="timeline-viewer__btn" onClick={goToStart} title="Go to start"><SkipBackIcon /></button>
          <button className="timeline-viewer__btn" onClick={() => stepFrame(-1)} title="Step back"><StepBackIcon /></button>
          <button className="timeline-viewer__btn timeline-viewer__btn--play" onClick={onPlayPause} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="timeline-viewer__btn" onClick={() => stepFrame(1)} title="Step forward"><StepForwardIcon /></button>
          <button className="timeline-viewer__btn" onClick={goToEnd} title="Go to end"><SkipForwardIcon /></button>
        </div>
        <span className="timeline-viewer__timecode timeline-viewer__timecode--duration">
          {formatTimecode(duration)}
        </span>
      </div>
    </div>
  );
}
