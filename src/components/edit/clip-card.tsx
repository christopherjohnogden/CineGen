

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { Clip, ToolType, TrackKind } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { snapToHalfSecond } from '@/lib/editor/timeline-operations';
import { clipEffectiveDuration } from '@/types/timeline';
import { WaveformCanvas } from './waveform-canvas';
import { KeyframeTrack } from './keyframe-track';
import { FilmstripBackground } from './filmstrip-background';
import { toFileUrl } from '@/lib/utils/file-url';
import aiSvg from '@/assets/ai.svg';

interface ClipCardProps {
  clip: Clip;
  asset?: Asset;
  pixelsPerSecond: number;
  viewportLeftPx?: number;
  viewportWidthPx?: number;
  snapTime?: (time: number) => number;
  selected: boolean;
  trackColor?: string;
  onSelect?: (clipId: string, additive: boolean) => void;
  onTrim?: (clipId: string, trimStart: number, trimEnd: number, startTime?: number) => void;
  onRemove?: (clipId: string) => void;
  onMove?: (clipId: string, newStartTime: number, trackId?: string) => void;
  onMoveStart?: (clipId: string, startX: number, initStartTime: number, duplicate: boolean) => void;
  onTrimPreview?: (clipId: string, sourceTime: number) => void;
  onTrimPreviewEnd?: () => void;
  onMoveSnap?: (snapX: number | null) => void;
  snapMoveTime?: (time: number, clipId: string) => { time: number; snapped: boolean };
  trackHeight?: number;
  onClickGenerate?: (clipId: string) => void;
  activeTool?: ToolType;
  onAdvancedMouseDown?: (e: React.MouseEvent, clip: Clip, edge: 'left' | 'right' | 'body') => void;
  highlighted?: boolean;
  rippleAffected?: boolean;
  onUpdateClip?: (clipId: string, updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => void;
  onAddKeyframe?: (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => void;
  onMoveKeyframe?: (clipId: string, index: number, newTime: number) => void;
  onRemoveKeyframe?: (clipId: string, index: number) => void;
  onDoubleClick?: (clipId: string) => void;
  onExtendEdgeDown?: (clipId: string, edge: 'left' | 'right', e: React.PointerEvent) => void;
  trackKind?: TrackKind;
  onContextMenu?: (clipId: string, e: React.MouseEvent) => void;
}

const CLIP_RENDER_OVERSCAN_PX = 1200;
const AUDIO_GAIN_AREA_TOP_PX = 6;
const AUDIO_GAIN_HITBOX_HEIGHT_PX = 14;
const AUDIO_CLIP_MIN_VOLUME = 0;
const AUDIO_CLIP_MAX_VOLUME = 4;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const ClipCard = memo(function ClipCard({
  clip,
  asset,
  pixelsPerSecond,
  viewportLeftPx,
  viewportWidthPx,
  snapTime = snapToHalfSecond,
  selected,
  trackColor,
  onSelect,
  onTrim,
  onRemove,
  onMove,
  onMoveStart,
  onTrimPreview,
  onTrimPreviewEnd,
  onMoveSnap,
  snapMoveTime,
  trackHeight,
  onClickGenerate,
  activeTool,
  onAdvancedMouseDown,
  highlighted,
  rippleAffected,
  onUpdateClip,
  onAddKeyframe,
  onMoveKeyframe,
  onRemoveKeyframe,
  onDoubleClick,
  onExtendEdgeDown,
  trackKind,
  onContextMenu: onContextMenuProp,
}: ClipCardProps) {
  const actionRef = useRef<
    | { kind: 'trim'; side: 'left' | 'right'; startX: number; initTrimStart: number; initTrimEnd: number; initStartTime: number }
    | null
  >(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const gainDragPointerIdRef = useRef<number | null>(null);
  const [isGainDragging, setIsGainDragging] = useState(false);
  const [gainCursorPos, setGainCursorPos] = useState<{ x: number; y: number } | null>(null);

  const effectiveDuration = clipEffectiveDuration(clip);
  const clipWidth = effectiveDuration * pixelsPerSecond;
  const clipLeft = clip.startTime * pixelsPerSecond;
  const clipRight = clipLeft + clipWidth;
  const renderWindowStart = viewportLeftPx == null || viewportWidthPx == null
    ? clipLeft
    : Math.max(0, viewportLeftPx - CLIP_RENDER_OVERSCAN_PX);
  const renderWindowEnd = viewportLeftPx == null || viewportWidthPx == null
    ? clipRight
    : viewportLeftPx + viewportWidthPx + CLIP_RENDER_OVERSCAN_PX;
  const renderLeft = Math.max(clipLeft, renderWindowStart);
  const renderRight = Math.min(clipRight, renderWindowEnd);
  const renderWidth = Math.max(0, renderRight - renderLeft);
  const contentOffsetPx = Math.max(0, renderLeft - clipLeft);
  const showsLeftEdge = renderLeft <= clipLeft + 0.5;
  const showsRightEdge = renderRight >= clipRight - 0.5;
  if (renderWidth <= 0) return null;

  const isMissingAsset = !asset || asset.status === 'offline';
  const isAudioAsset = trackKind === 'audio' || (!isMissingAsset && asset?.type === 'audio');
  const isPendingMusic = !!(asset?.metadata?.pendingMusic);
  const isPendingFillGap = !!(asset?.metadata?.pendingFillGap);
  const isPendingExtend = !!(asset?.metadata?.pendingExtend);
  const isGenerating = !!(asset?.metadata?.generating);
  const isError = isMissingAsset || !!(asset?.metadata?.error);
  const processingJobs = Array.isArray(asset?.metadata?.processingJobs)
    ? (asset?.metadata?.processingJobs as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  const isFilmstripProcessing = processingJobs.includes('generate_filmstrip');
  const thumb = isAudioAsset ? undefined : toFileUrl(asset?.thumbnailUrl);
  const isVideo = trackKind !== 'audio' && (isMissingAsset || asset?.type === 'video');
  const typeClass = isVideo ? 'clip-card--video' : isAudioAsset ? 'clip-card--audio' : 'clip-card--image';
  const filmstrip = useMemo(
    () =>
      ((asset?.metadata?.filmstrip as string[] | undefined) ?? [])
        .map((frame) => toFileUrl(frame) || frame),
    [asset?.metadata?.filmstrip],
  );
  const filmstripUrl = toFileUrl(asset?.metadata?.filmstripUrl as string | undefined) || undefined;
  const waveform = (asset?.metadata?.waveform as number[] | undefined) ?? [];
  const waveformUrl = toFileUrl(asset?.metadata?.waveformPath as string | undefined) || undefined;
  const audioGainAreaHeight = Math.max(30, (trackHeight ?? 80) - 40);
  const gainLineNormalized = Math.max(
    0,
    Math.min(1, (clip.volume - AUDIO_CLIP_MIN_VOLUME) / (AUDIO_CLIP_MAX_VOLUME - AUDIO_CLIP_MIN_VOLUME)),
  );
  const gainLineTop = AUDIO_GAIN_AREA_TOP_PX + (1 - gainLineNormalized) * audioGainAreaHeight;
  const showGainLine = isAudioAsset && !!onUpdateClip && !isMissingAsset && !isError && !isGenerating;

  // Show fewer frames when zoomed out, more when zoomed in
  // Target ~80px per frame for good visual density
  const visibleFrames = useMemo(() => {
    if (filmstrip.length === 0) return [];
    const targetCount = Math.max(1, Math.floor(renderWidth / 80));
    if (targetCount >= filmstrip.length) return filmstrip;
    if (targetCount === 1) return [filmstrip[0]];
    const result: string[] = [];
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.round((i / (targetCount - 1)) * (filmstrip.length - 1));
      result.push(filmstrip[idx]);
    }
    return result;
  }, [filmstrip, renderWidth]);
  const placeholderFilmstripFrames = useMemo(() => {
    if (!isVideo || isMissingAsset || filmstripUrl || visibleFrames.length > 0 || !thumb) return [];
    const targetCount = Math.min(120, Math.max(1, Math.floor(renderWidth / 80)));
    return Array.from({ length: targetCount }, () => thumb);
  }, [filmstripUrl, isMissingAsset, isVideo, thumb, visibleFrames.length, renderWidth]);
  const showFilmstripPlaceholder =
    isVideo &&
    !isMissingAsset &&
    !isPendingMusic &&
    !isPendingFillGap &&
    !isPendingExtend &&
    !filmstripUrl &&
    visibleFrames.length === 0;
  const showFilmstripStatus = showFilmstripPlaceholder && isFilmstripProcessing;

  const handleTrimDown = useCallback(
    (side: 'left' | 'right') => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();

      // Extend tool: delegate to extend handler
      if (activeTool === 'extend') {
        onExtendEdgeDown?.(clip.id, side, e);
        return;
      }

      // Advanced tools or Shift key: delegate to hook
      if ((activeTool && ['ripple', 'roll', 'slip', 'slide'].includes(activeTool)) || e.shiftKey) {
        if (onAdvancedMouseDown) {
          onAdvancedMouseDown(e as unknown as React.MouseEvent, clip, side);
        }
        return;
      }

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      actionRef.current = {
        kind: 'trim',
        side,
        startX: e.clientX,
        initTrimStart: clip.trimStart,
        initTrimEnd: clip.trimEnd,
        initStartTime: clip.startTime,
      };
    },
    [clip, activeTool, onAdvancedMouseDown, onExtendEdgeDown],
  );

  const handleMoveDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).classList.contains('clip-card__trim-handle')) return;
      onSelect?.(clip.id, e.shiftKey || e.metaKey);

      // Advanced tools: delegate to hook
      if (activeTool && ['ripple', 'roll', 'slip', 'slide', 'trackForward'].includes(activeTool)) {
        if (onAdvancedMouseDown) {
          onAdvancedMouseDown(e as unknown as React.MouseEvent, clip, 'body');
        }
        return;
      }

      if (!onMove) return;
      e.preventDefault();

      // Move/duplicate is handled at the TimelineEditor level for smooth drag behavior.
      onMoveStart?.(clip.id, e.clientX, clip.startTime, e.altKey);
    },
    [clip, onSelect, onMove, onMoveStart, activeTool, onAdvancedMouseDown],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const action = actionRef.current;
      if (!action) return;

      const dx = e.clientX - action.startX;
      const dt = dx / pixelsPerSecond;

      if (action.kind === 'trim') {
        if (action.side === 'left') {
          const raw = Math.max(0, Math.min(action.initTrimStart + dt, clip.duration - clip.trimEnd - 0.1));
          let newTrimStart = snapTime(raw);
          let newStartTime = Math.max(0, action.initStartTime + (newTrimStart - action.initTrimStart));
          // Snap left edge to other clip edges
          if (snapMoveTime) {
            const result = snapMoveTime(newStartTime, clip.id);
            if (result.snapped) {
              const delta = result.time - newStartTime;
              newStartTime = result.time;
              newTrimStart = Math.max(0, newTrimStart + delta);
              onMoveSnap?.(result.time * pixelsPerSecond);
            } else {
              onMoveSnap?.(null);
            }
          }
          onTrim?.(clip.id, newTrimStart, clip.trimEnd, newStartTime);
          onTrimPreview?.(clip.id, newTrimStart);
        } else {
          const raw = Math.max(0, Math.min(action.initTrimEnd - dt, clip.duration - clip.trimStart - 0.1));
          let newTrimEnd = snapTime(raw);
          // Snap right edge to other clip edges
          if (snapMoveTime) {
            const rightEdge = clip.startTime + (clip.duration - clip.trimStart - newTrimEnd) / clip.speed;
            const result = snapMoveTime(rightEdge, clip.id);
            if (result.snapped) {
              newTrimEnd = Math.max(0, clip.duration - clip.trimStart - (result.time - clip.startTime) * clip.speed);
              onMoveSnap?.(result.time * pixelsPerSecond);
            } else {
              onMoveSnap?.(null);
            }
          }
          onTrim?.(clip.id, clip.trimStart, newTrimEnd);
          onTrimPreview?.(clip.id, clip.duration - newTrimEnd);
        }
      }
    },
    [clip.id, clip.duration, clip.trimStart, clip.trimEnd, pixelsPerSecond, snapTime, snapMoveTime, onTrim, onTrimPreview, onMoveSnap],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const action = actionRef.current;
    if (action?.kind === 'trim') {
      onTrimPreviewEnd?.();
      onMoveSnap?.(null);
    }
    actionRef.current = null;
  }, [onMoveSnap, onTrimPreviewEnd]);

  const volumeFromClientY = useCallback((clientY: number) => {
    const cardEl = cardRef.current;
    if (!cardEl) return clip.volume;
    const rect = cardEl.getBoundingClientRect();
    const top = rect.top + AUDIO_GAIN_AREA_TOP_PX;
    const bottom = top + audioGainAreaHeight;
    const usableHeight = Math.max(1, bottom - top);
    const normalized = 1 - ((clientY - top) / usableHeight);
    return Math.max(
      AUDIO_CLIP_MIN_VOLUME,
      Math.min(
        AUDIO_CLIP_MAX_VOLUME,
        AUDIO_CLIP_MIN_VOLUME + normalized * (AUDIO_CLIP_MAX_VOLUME - AUDIO_CLIP_MIN_VOLUME),
      ),
    );
  }, [audioGainAreaHeight, clip.volume]);

  const gainCursorFromEvent = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cardEl = cardRef.current;
    if (!cardEl) return null;
    const rect = cardEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleGainPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!showGainLine || !onUpdateClip) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(clip.id, e.shiftKey || e.metaKey);
    gainDragPointerIdRef.current = e.pointerId;
    setIsGainDragging(true);
    setGainCursorPos(gainCursorFromEvent(e));
    e.currentTarget.setPointerCapture(e.pointerId);
    onUpdateClip(clip.id, { volume: volumeFromClientY(e.clientY) });
  }, [clip.id, gainCursorFromEvent, onSelect, onUpdateClip, showGainLine, volumeFromClientY]);

  const handleGainPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!onUpdateClip || gainDragPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    setGainCursorPos(gainCursorFromEvent(e));
    onUpdateClip(clip.id, { volume: volumeFromClientY(e.clientY) });
  }, [clip.id, gainCursorFromEvent, onUpdateClip, volumeFromClientY]);

  const handleGainPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (gainDragPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    gainDragPointerIdRef.current = null;
    setIsGainDragging(false);
    setGainCursorPos(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <div
      ref={cardRef}
      className={`clip-card ${typeClass} ${selected ? 'clip-card--selected' : ''}${highlighted ? ' clip-card--track-forward-highlight' : ''}${rippleAffected ? ' clip-card--ripple-affected' : ''}${isPendingMusic || isPendingFillGap || isPendingExtend ? ' clip-card--pending-music' : ''}${isGenerating ? ' clip-card--generating' : ''}${isError ? ' clip-card--error' : ''}`}
      data-clip-id={clip.id}
      style={{ width: renderWidth, left: renderLeft, ...(trackColor && !selected && !isError ? { borderColor: trackColor } : {}) }}
      onPointerDown={handleMoveDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => onDoubleClick?.(clip.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenuProp?.(clip.id, e);
      }}
    >
      {(isPendingMusic || isPendingFillGap || isPendingExtend) && !isGenerating ? (
        <div className="clip-card__pending-music-bg">
          <button
            className="clip-card__pending-music-btn"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClickGenerate?.(clip.id);
            }}
          >
            {isPendingFillGap || isPendingExtend ? (
              <img src={aiSvg} alt="" className="clip-card__pending-ai-icon" aria-hidden="true" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
            )}
            <span>{isPendingFillGap ? 'Generate AI Fill' : isPendingExtend ? 'Generate Extension' : 'Click to Generate'}</span>
          </button>
        </div>
      ) : isGenerating ? (
        <div className="clip-card__generating">
          <div className="clip-card__generating-bars">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="clip-card__generating-bar" style={{ animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
        </div>
      ) : isMissingAsset ? (
        <div className="clip-card__missing-bg">
          <div className="clip-card__missing-status">
            <span className="clip-card__missing-status-dot" />
            <span>{asset ? 'Source Offline' : 'Media Lost'}</span>
          </div>
          <div className="clip-card__missing-message">
            {asset ? 'Broken link' : 'Deleted from media pool'}
          </div>
        </div>
      ) : isError ? (
        <div className="clip-card__audio-bg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
      ) : isVideo && filmstripUrl && asset?.duration ? (
        <FilmstripBackground
          filmstripUrl={filmstripUrl}
          assetDuration={asset.duration}
          trimStart={clip.trimStart}
          clipDuration={effectiveDuration}
          clipWidthPx={clipWidth}
          renderWidthPx={renderWidth}
          sourceOffsetPx={contentOffsetPx}
        />
      ) : isVideo && visibleFrames.length > 0 ? (
        <div className="clip-card__filmstrip" style={{ '--filmstrip-gap': visibleFrames.length <= 2 ? '2px' : '8px' } as React.CSSProperties}>
          {visibleFrames.map((frame, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={frame} alt="" className="clip-card__filmstrip-frame" draggable={false} />
          ))}
        </div>
      ) : isVideo && placeholderFilmstripFrames.length > 0 ? (
        <div className="clip-card__filmstrip clip-card__filmstrip--placeholder" style={{ '--filmstrip-gap': placeholderFilmstripFrames.length <= 2 ? '2px' : '8px' } as React.CSSProperties}>
          {placeholderFilmstripFrames.map((frame, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={frame} alt="" className="clip-card__filmstrip-frame" draggable={false} />
          ))}
        </div>
      ) : isVideo ? (
        <div className="clip-card__thumb clip-card__thumb--placeholder clip-card__thumb--empty" />
      ) : isAudioAsset ? (
        (waveform.length > 0 || waveformUrl) ? (
          <WaveformCanvas
            peaks={waveform}
            width={renderWidth}
            height={Math.max(30, (trackHeight ?? 80) - 40)}
            trimStart={clip.trimStart}
            trimEnd={clip.trimEnd}
            duration={clip.duration}
            amplitudeScale={clip.volume / AUDIO_CLIP_MAX_VOLUME}
            color={trackColor}
            peaksUrl={waveformUrl}
            sourceWidthPx={clipWidth}
            sourceOffsetPx={contentOffsetPx}
          />
        ) : (
          <div className="clip-card__audio-bg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" opacity="0.5"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
          </div>
        )
      ) : thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="clip-card__thumb" src={thumb} alt={clip.name} draggable={false} />
      ) : null}
      {showGainLine && (
        <div
          className={`clip-card__gain-hitbox${isGainDragging ? ' clip-card__gain-hitbox--dragging' : ''}`}
          style={{ top: gainLineTop - AUDIO_GAIN_HITBOX_HEIGHT_PX / 2 }}
          title={clip.volume <= 0 ? 'Gain -\u221EdB' : `Gain ${clip.volume >= 1 ? '+' : ''}${(20 * Math.log10(clip.volume)).toFixed(1)}dB`}
          onPointerDown={handleGainPointerDown}
          onPointerMove={handleGainPointerMove}
          onPointerUp={handleGainPointerUp}
          onPointerCancel={handleGainPointerUp}
        >
          <div className="clip-card__gain-line" />
          <div className="clip-card__gain-knob" />
        </div>
      )}
      {isGainDragging && gainCursorPos && (
        <div
          className="clip-card__gain-label"
          style={{ left: gainCursorPos.x + 14, top: gainCursorPos.y - 12 }}
        >
          {clip.volume <= 0 ? '-\u221EdB' : `${clip.volume >= 1 ? '+' : ''}${(20 * Math.log10(clip.volume)).toFixed(1)}dB`}
        </div>
      )}
      {showFilmstripStatus && (
        <>
          <div className="clip-card__filmstrip-shimmer" />
          <div className="clip-card__filmstrip-status">
            <span className="clip-card__filmstrip-status-dot" />
            <span>Generating filmstrip</span>
          </div>
        </>
      )}
      <div className="clip-card__overlay" style={trackColor && !isMissingAsset ? { background: `color-mix(in srgb, ${trackColor} 35%, black)` } : undefined}>
        <span className="clip-card__name">{isMissingAsset ? `Media Lost · ${clip.name}` : clip.name}</span>
        <span className="clip-card__duration">{formatDuration(effectiveDuration)}</span>
      </div>
      {showsRightEdge && (
        <button
          type="button"
          className="clip-card__delete"
          onPointerDown={(e) => {
            e.stopPropagation();
            onRemove?.(clip.id);
          }}
          title="Remove"
        >
          &times;
        </button>
      )}
      {showsLeftEdge && (
        <div
          className={`clip-card__trim-handle clip-card__trim-handle--left${activeTool === 'extend' ? ' clip-card__trim-handle--extend' : ''}`}
          onPointerDown={handleTrimDown('left')}
        />
      )}
      {showsRightEdge && (
        <div
          className={`clip-card__trim-handle clip-card__trim-handle--right${activeTool === 'extend' ? ' clip-card__trim-handle--extend' : ''}`}
          onPointerDown={handleTrimDown('right')}
        />
      )}
      {clip.keyframes.length > 0 && onMoveKeyframe && onRemoveKeyframe && (
        <KeyframeTrack
          clip={clip}
          pxPerSecond={pixelsPerSecond}
          onAddKeyframe={onAddKeyframe}
          onMoveKeyframe={onMoveKeyframe}
          onRemoveKeyframe={onRemoveKeyframe}
        />
      )}
    </div>
  );
});
