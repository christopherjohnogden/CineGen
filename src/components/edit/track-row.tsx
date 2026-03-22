

import { useCallback, useState, useRef, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Track, Clip, Transition, ToolType } from '@/types/timeline';
import { clipEndTime } from '@/types/timeline';
import { TRACK_COLORS, DEFAULT_VIDEO_COLOR, DEFAULT_AUDIO_COLOR } from '@/types/timeline';
import type { Asset } from '@/types/project';
import { ClipCard } from './clip-card';
import { TransitionOverlay } from './transition-overlay';

interface TrackRowProps {
  track: Track;
  clips: Clip[];
  assets: Asset[];
  pixelsPerSecond: number;
  viewportLeftPx?: number;
  viewportWidthPx?: number;
  snapTime: (time: number) => number;
  selectedClipIds: Set<string>;
  onSelectClip: (clipId: string, additive: boolean) => void;
  onTrimClip: (clipId: string, trimStart: number, trimEnd: number, startTime?: number) => void;
  onTrimPreview: (clipId: string, sourceTime: number) => void;
  onTrimPreviewEnd: () => void;
  onRemoveClip: (clipId: string) => void;
  onDropAsset: (trackId: string, assetId: string, startTime: number) => void;
  onMoveClip: (clipId: string, trackId: string, startTime: number) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onToggleLock: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onSetTrackColor: (trackId: string, color: string | undefined) => void;
  onDeleteEmptyTracks: () => void;
  onMoveSnap: (snapX: number | null) => void;
  snapMoveTime: (time: number, clipId: string) => { time: number; snapped: boolean };
  trackHeight: number;
  hasEmptyTracks: boolean;
  onClickGenerate?: (clipId: string) => void;
  activeTool?: ToolType;
  onClipMouseDown?: (e: React.MouseEvent, clip: Clip, edge: 'left' | 'right' | 'body') => void;
  rippleAffectedIds?: Set<string>;
  trackForwardHighlightIds?: Set<string>;
  transitions?: Transition[];
  allClips?: Clip[];
  onRemoveTransition?: (transitionId: string) => void;
  onUpdateClip?: (clipId: string, updates: Partial<Pick<Clip, 'speed' | 'opacity' | 'volume' | 'flipH' | 'flipV'>>) => void;
  onAddKeyframe?: (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => void;
  onMoveKeyframe?: (clipId: string, index: number, newTime: number) => void;
  onRemoveKeyframe?: (clipId: string, index: number) => void;
  onClipDoubleClick?: (clipId: string) => void;
  onMoveStart?: (clipId: string, startX: number, initStartTime: number, duplicate: boolean) => void;
  onExtendEdgeDown?: (clipId: string, edge: 'left' | 'right', e: React.PointerEvent) => void;
  onClipContextMenu?: (clipId: string, e: React.MouseEvent) => void;
}

export const TrackRow = memo(function TrackRow({
  track,
  clips,
  assets,
  pixelsPerSecond,
  viewportLeftPx,
  viewportWidthPx,
  snapTime,
  selectedClipIds,
  onSelectClip,
  onTrimClip,
  onTrimPreview,
  onTrimPreviewEnd,
  onRemoveClip,
  onDropAsset,
  onMoveClip,
  onRenameTrack,
  onToggleLock,
  onToggleMute,
  onToggleSolo,
  onSetTrackColor,
  onDeleteEmptyTracks,
  onMoveSnap,
  snapMoveTime,
  trackHeight,
  hasEmptyTracks,
  onClickGenerate,
  activeTool,
  onClipMouseDown,
  rippleAffectedIds,
  trackForwardHighlightIds,
  transitions,
  allClips,
  onRemoveTransition,
  onUpdateClip,
  onAddKeyframe,
  onMoveKeyframe,
  onRemoveKeyframe,
  onClipDoubleClick,
  onMoveStart,
  onExtendEdgeDown,
  onClipContextMenu,
}: TrackRowProps) {
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const visibleClips = useMemo(() => {
    if (
      viewportLeftPx == null
      || viewportWidthPx == null
      || !Number.isFinite(viewportLeftPx)
      || !Number.isFinite(viewportWidthPx)
      || viewportWidthPx <= 0
    ) {
      return clips;
    }

    const viewportStartSec = Math.max(0, viewportLeftPx / pixelsPerSecond);
    const viewportEndSec = Math.max(viewportStartSec, (viewportLeftPx + viewportWidthPx) / pixelsPerSecond);
    const bufferSec = Math.max(2, 600 / Math.max(pixelsPerSecond, 0.1));

    return clips.filter((clip) => (
      clip.startTime < viewportEndSec + bufferSec
      && clipEndTime(clip) > viewportStartSec - bufferSec
    ));
  }, [clips, pixelsPerSecond, viewportLeftPx, viewportWidthPx]);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(track.name);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [colorSubOpen, setColorSubOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const dragEnterCount = useRef(0);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== track.name) {
      onRenameTrack(track.id, trimmed);
    } else {
      setEditValue(track.name);
    }
    setEditing(false);
  }, [editValue, track.id, track.name, onRenameTrack]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (track.locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [track.locked]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (track.locked) return;
    if (!e.dataTransfer.types.includes('application/x-asset-id') && !e.dataTransfer.types.includes('application/x-clip-id')) return;
    e.preventDefault();
    dragEnterCount.current++;
  }, [track.locked]);

  const handleDragLeave = useCallback(() => {
    dragEnterCount.current--;
    if (dragEnterCount.current <= 0) {
      dragEnterCount.current = 0;
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragEnterCount.current = 0;
      if (track.locked) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const startTime = snapTime(Math.max(0, x / pixelsPerSecond));

      const assetId = e.dataTransfer.getData('application/x-asset-id');
      if (assetId) {
        onDropAsset(track.id, assetId, startTime);
        return;
      }

      const clipId = e.dataTransfer.getData('application/x-clip-id');
      if (clipId) {
        onMoveClip(clipId, track.id, startTime);
      }
    },
    [track.id, track.locked, pixelsPerSecond, snapTime, onDropAsset, onMoveClip],
  );

  const handleMoveClipPointer = useCallback(
    (clipId: string, newStartTime: number, targetTrackId?: string) => {
      // Pass through special __new_video__/__new_audio__ signals for new track creation
      const resolvedTrackId = targetTrackId ?? track.id;
      onMoveClip(clipId, resolvedTrackId, newStartTime);
    },
    [track.id, onMoveClip],
  );

  const trackColor = track.color;
  const defaultColor = track.kind === 'video' ? DEFAULT_VIDEO_COLOR : DEFAULT_AUDIO_COLOR;
  const displayColor = trackColor || defaultColor;

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
    setColorSubOpen(false);
  }, []);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setColorSubOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setColorSubOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  return (
    <div
      className="track-row"
      data-track-id={track.id}
      data-track-kind={track.kind}
      data-locked={track.locked || undefined}
      style={{ height: trackHeight, ...(trackColor ? { '--track-color': trackColor } : {}) } as React.CSSProperties}
    >
      <div
        className="track-row__label"
        style={{ background: `linear-gradient(135deg, ${displayColor}22, ${displayColor}0d), var(--bg-raised)` }}
        onDoubleClick={() => {
          if (track.locked) return;
          setEditValue(track.name);
          setEditing(true);
          requestAnimationFrame(() => inputRef.current?.select());
        }}
        onContextMenu={handleContextMenu}
      >
        <div className="track-row__label-top">
          {editing ? (
            <input
              ref={inputRef}
              className="track-row__label-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditValue(track.name); setEditing(false); }
              }}
              autoFocus
            />
          ) : (
            <span className="track-row__label-text">{track.name}</span>
          )}
          <div className="track-row__label-controls">
            <button
              type="button"
              className={`track-row__lock-btn${track.locked ? ' track-row__lock-btn--active' : ''}`}
              title={track.locked ? 'Unlock track' : 'Lock track'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleLock(track.id); }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {track.locked ? (
                  <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></>
                ) : (
                  <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 019.9-1" /></>
                )}
              </svg>
            </button>
            <button
              type="button"
              className={`track-row__mute-btn${track.muted ? ' track-row__mute-btn--active' : ''}`}
              title={track.muted ? 'Unmute' : 'Mute'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleMute(track.id); }}
            >M</button>
            <button
              type="button"
              className={`track-row__solo-btn${track.solo ? ' track-row__solo-btn--active' : ''}`}
              title={track.solo ? 'Unsolo' : 'Solo'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleSolo(track.id); }}
            >S</button>
          </div>
        </div>
      </div>
      <div className="track-row__clips" onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <div className="track-row__drop-zone" />
        {visibleClips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            asset={assetMap.get(clip.assetId)}
            pixelsPerSecond={pixelsPerSecond}
            viewportLeftPx={viewportLeftPx}
            viewportWidthPx={viewportWidthPx}
            snapTime={snapTime}
            selected={selectedClipIds.has(clip.id)}
            trackColor={trackColor}
            onSelect={onSelectClip}
            onTrim={onTrimClip}
            onTrimPreview={onTrimPreview}
            onTrimPreviewEnd={onTrimPreviewEnd}
            onRemove={onRemoveClip}
            onMove={handleMoveClipPointer}
            onMoveSnap={onMoveSnap}
            snapMoveTime={snapMoveTime}
            trackHeight={trackHeight}
            onClickGenerate={onClickGenerate}
            activeTool={activeTool}
            onAdvancedMouseDown={onClipMouseDown}
            highlighted={trackForwardHighlightIds?.has(clip.id) || false}
            rippleAffected={rippleAffectedIds?.has(clip.id) || false}
            onUpdateClip={onUpdateClip}
            onAddKeyframe={onAddKeyframe}
            onMoveKeyframe={onMoveKeyframe}
            onRemoveKeyframe={onRemoveKeyframe}
            onDoubleClick={onClipDoubleClick}
            onMoveStart={onMoveStart}
            onExtendEdgeDown={onExtendEdgeDown}
            trackKind={track.kind}
            onContextMenu={onClipContextMenu}
          />
        ))}
        {transitions && allClips && onRemoveTransition && transitions.map((t) => {
          const clipA = allClips.find((c) => c.id === t.clipAId);
          const clipB = t.clipBId ? allClips.find((c) => c.id === t.clipBId) : undefined;
          if (!clipA) return null;
          return (
            <TransitionOverlay
              key={t.id}
              transition={t}
              clipA={clipA}
              clipB={clipB}
              pxPerSecond={pixelsPerSecond}
              onRemove={onRemoveTransition}
            />
          );
        })}
      </div>

      {/* Context menu — portaled to body so it's never clipped by overflow */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          className="track-ctx"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Rename */}
          <button
            className="track-ctx__item"
            onClick={() => {
              setContextMenu(null);
              setEditValue(track.name);
              setEditing(true);
              requestAnimationFrame(() => inputRef.current?.select());
            }}
          >
            <svg className="track-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2.5l4 4-9 9H1.5v-3z" />
            </svg>
            Rename Track
          </button>

          <div className="track-ctx__sep" />

          {/* Track Color — hover to expand */}
          <div
            className={`track-ctx__submenu-wrap${colorSubOpen ? ' track-ctx__submenu-wrap--open' : ''}`}
            onMouseEnter={() => setColorSubOpen(true)}
            onMouseLeave={() => setColorSubOpen(false)}
          >
            <button className="track-ctx__item track-ctx__item--has-sub" onClick={() => setColorSubOpen((v) => !v)}>
              <span
                className="track-ctx__color-dot"
                style={{ background: displayColor }}
              />
              <span style={{ flex: 1 }}>Track Color</span>
              <svg className="track-ctx__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
            {colorSubOpen && (
              <div className="track-ctx__sub">
                <div className="track-ctx__color-grid">
                  {TRACK_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`track-ctx__color-swatch${displayColor === c ? ' track-ctx__color-swatch--active' : ''}`}
                      style={{ background: c }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetTrackColor(track.id, c === defaultColor ? undefined : c);
                        setContextMenu(null);
                        setColorSubOpen(false);
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="track-ctx__color-custom"
                  onClick={(e) => { e.stopPropagation(); colorInputRef.current?.click(); }}
                >
                  Custom...
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  className="track-ctx__color-native"
                  value={displayColor}
                  onChange={(e) => {
                    onSetTrackColor(track.id, e.target.value);
                    setContextMenu(null);
                    setColorSubOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          <div className="track-ctx__sep" />

          {/* Delete Empty Tracks */}
          <button
            className={`track-ctx__item track-ctx__item--danger${!hasEmptyTracks ? ' track-ctx__item--disabled' : ''}`}
            disabled={!hasEmptyTracks}
            onClick={() => {
              setContextMenu(null);
              onDeleteEmptyTracks();
            }}
          >
            <svg className="track-ctx__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8.5a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5V4" />
            </svg>
            Delete Empty Tracks
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
});
