import { useCallback, useRef } from 'react';
import type { TrackKind } from '@/types/timeline';

interface TimelineBottomBarProps {
  pxPerSecond: number;
  onZoomChange: (pps: number) => void;
  onAddTrack: (kind: TrackKind | TrackKind[]) => void;
  trackHeight: number;
  onTrackHeightChange: (h: number) => void;
  trackCount: number;
  sequenceDuration: number;
}

const MIN_PX = 0.4;
const MAX_PX = 300;
const MIN_TRACK_H = 30;
const MAX_TRACK_H = 200;

/* SVG icon helpers */
const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const PlusIcon = () => <Ico><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Ico>;
const WidthIcon = () => (
  <svg width="14" height="14" viewBox="0 0 3055.12 1638.97" fill="currentColor">
    <path d="m620.29 1206.41-337.86-336.49-50.61-50.39 50.61-50.44 337.86-336.48 100.24 100.84-215.65 214.8h2045.36l-215.64-214.8 100.27-100.84 337.87 336.48 50.57 50.44-50.57 50.39-337.87 336.49-100.27-100.84 215.64-214.8h-2045.36l215.65 214.8zm2292.25 432.57v-1638.97h142.58v1638.97zm-2912.54 0v-1638.97h142.58v1638.97z" />
  </svg>
);
const HeightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 218.02 406.39" fill="currentColor">
    <path d="m57.54 82.51 44.77-44.94 6.7-6.73 6.71 6.73 44.76 44.94-13.41 13.33-28.57-28.68v272.08l28.57-28.69 13.41 13.34-44.76 44.94-6.71 6.73-6.7-6.73-44.77-44.94 13.41-13.34 28.57 28.69v-272.08l-28.57 28.68zm-57.54 304.92h218.02v18.97h-218.02zm0-387.43h218.02v18.96h-218.02z" />
  </svg>
);

// Logarithmic zoom mapping: slider 0–1000 → MIN_PX–MAX_PX exponentially
const LOG_MIN = Math.log(MIN_PX);
const LOG_MAX = Math.log(MAX_PX);
const SLIDER_MAX = 1000;
function ppsToSlider(pps: number): number {
  return Math.round(((Math.log(pps) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * SLIDER_MAX);
}
function sliderToPps(val: number): number {
  return Math.exp(LOG_MIN + (val / SLIDER_MAX) * (LOG_MAX - LOG_MIN));
}

export function TimelineBottomBar({
  pxPerSecond,
  onZoomChange,
  onAddTrack,
  trackHeight,
  onTrackHeightChange,
  trackCount,
  sequenceDuration,
}: TimelineBottomBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFitZoom = useCallback(() => {
    const bar = containerRef.current;
    if (!bar || sequenceDuration <= 0) return;
    const timelineContent = bar.closest('.edit-tab__timeline-content');
    if (!timelineContent) return;
    const editor = timelineContent.querySelector('.timeline-editor');
    if (!editor) return;
    const availableWidth = editor.clientWidth - 100; // subtract label width
    const fitPps = Math.max(MIN_PX, Math.min(MAX_PX, availableWidth / sequenceDuration));
    onZoomChange(fitPps);
  }, [sequenceDuration, onZoomChange]);

  const handleFitTracks = useCallback(() => {
    const bar = containerRef.current;
    if (!bar) return;
    const timelineContent = bar.closest('.edit-tab__timeline-content');
    if (!timelineContent) return;
    const editor = timelineContent.querySelector('.timeline-editor');
    if (!editor || trackCount === 0) return;
    // Total height minus ruler (32px) and separator (4px)
    const availableHeight = editor.clientHeight - 36;
    const fitHeight = Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, Math.floor(availableHeight / trackCount)));
    onTrackHeightChange(fitHeight);
  }, [trackCount, onTrackHeightChange]);

  return (
    <div className="timeline-bottom-bar" ref={containerRef}>
      <div className="timeline-bottom-bar__left">
        <button
          className="timeline-bottom-bar__snap timeline-bottom-bar__snap--active"
          onClick={() => onAddTrack(['video', 'audio'])}
          title="Add Track"
        >
          <PlusIcon />
          <span>Add Track</span>
        </button>
      </div>
      <div className="timeline-bottom-bar__right">
        <button
          className="timeline-bottom-bar__zoom-btn"
          onClick={handleFitTracks}
          title="Fit tracks to view"
        >
          <HeightIcon />
        </button>
        <input
          type="range"
          className="timeline-bottom-bar__zoom-slider"
          min={MIN_TRACK_H}
          max={MAX_TRACK_H}
          value={trackHeight}
          onChange={(e) => onTrackHeightChange(Number(e.target.value))}
          onMouseUp={(e) => (e.target as HTMLElement).blur()}
          onKeyDown={(e) => { if (e.key.startsWith('Arrow')) e.preventDefault(); }}
        />
        <div className="timeline-bottom-bar__divider" />
        <button
          className="timeline-bottom-bar__zoom-btn"
          onClick={handleFitZoom}
          title="Fit timeline to view"
        >
          <WidthIcon />
        </button>
        <input
          type="range"
          className="timeline-bottom-bar__zoom-slider"
          min={0}
          max={SLIDER_MAX}
          step={1}
          value={ppsToSlider(pxPerSecond)}
          onChange={(e) => onZoomChange(sliderToPps(Number(e.target.value)))}
          onMouseUp={(e) => (e.target as HTMLElement).blur()}
          onKeyDown={(e) => { if (e.key.startsWith('Arrow')) e.preventDefault(); }}
        />
      </div>
    </div>
  );
}
