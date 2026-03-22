// src/components/edit/use-timeline-drag.ts
import { useCallback, useRef } from 'react';
import type { Timeline, Clip, ToolType } from '@/types/timeline';
import { clipEndTime } from '@/types/timeline';
import {
  moveClip,
  trimClip,
  splitClip,
  splitAllTracks,
  rippleTrim,
  rollTrim,
  slipClip,
  slideClip,
  trackSelectForward,
  clipsOnTrack,
} from '@/lib/editor/timeline-operations';

interface DragState {
  clipId: string;
  edge: 'left' | 'right' | 'body';
  startX: number;
  startTime: number;
  trackId: string;
}

interface UseTimelineDragOptions {
  tool: ToolType;
  timeline: Timeline;
  pxPerSecond: number;
  snapEnabled: boolean;
  currentTime: number;
  onUpdate: (timeline: Timeline) => void;
  onSelect: (ids: Set<string>) => void;
  onTrimPreview?: (clipId: string, sourceTime: number) => void;
  onTrimPreviewEnd?: () => void;
  onRipplePreview?: (clipId: string, affectedClipIds: string[], delta: number) => void;
  onRipplePreviewEnd?: () => void;
  onSlipPreview?: (clipId: string, sourceOffset: number) => void;
  onSlipPreviewEnd?: () => void;
  onSlidePreview?: (clipId: string, leftDelta: number, rightDelta: number) => void;
  onSlidePreviewEnd?: () => void;
  onTrackForwardHighlight?: (clipIds: string[]) => void;
  onTrackForwardHighlightEnd?: () => void;
}

export function useTimelineDrag({
  tool,
  timeline,
  pxPerSecond,
  snapEnabled,
  currentTime: _currentTime,
  onUpdate,
  onSelect,
  onTrimPreview,
  onTrimPreviewEnd,
  onRipplePreview,
  onRipplePreviewEnd,
  onSlipPreview,
  onSlipPreviewEnd,
  onSlidePreview,
  onSlidePreviewEnd,
  onTrackForwardHighlight,
  onTrackForwardHighlightEnd,
}: UseTimelineDragOptions) {
  const dragRef = useRef<DragState | null>(null);

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip, edge: 'left' | 'right' | 'body') => {
      e.stopPropagation();
      e.preventDefault();

      // Check if track is locked
      const track = timeline.tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return;

      if (tool === 'trackForward') {
        const ids = trackSelectForward(timeline, clip.id);
        onSelect(ids);
        onTrackForwardHighlight?.([...ids]);
      } else if (tool === 'blade') {
        // Blade on click — handled separately
        return;
      } else {
        // For all other tools, initiate drag
        dragRef.current = {
          clipId: clip.id,
          edge,
          startX: e.clientX,
          startTime: clip.startTime,
          trackId: clip.trackId,
        };
      }

      const handleMouseMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const deltaPx = me.clientX - dragRef.current.startX;
        const deltaSec = deltaPx / pxPerSecond;

        const clip = timeline.clips.find((c) => c.id === dragRef.current!.clipId);
        if (!clip) return;

        let updated: Timeline;

        const effectiveTool = me.shiftKey && (edge === 'left' || edge === 'right') ? 'ripple' : tool;

        switch (effectiveTool) {
          case 'select':
          case 'trackForward':
            if (edge === 'body') {
              updated = moveClip(timeline, clip.id, clip.trackId, dragRef.current.startTime + deltaSec);
            } else {
              // Basic trim
              const newTrimStart = edge === 'left' ? clip.trimStart + deltaSec : clip.trimStart;
              const newTrimEnd = edge === 'right' ? clip.trimEnd - deltaSec : clip.trimEnd;
              const newStartTime = edge === 'left' ? clip.startTime + deltaSec : clip.startTime;
              updated = trimClip(timeline, clip.id, newTrimStart, newTrimEnd, newStartTime);
            }
            break;
          case 'ripple': {
            const rippleEdge = edge === 'body' ? 'right' : edge;
            updated = rippleTrim(timeline, clip.id, rippleEdge, deltaSec);
            if (onRipplePreview) {
              const trackClips = clipsOnTrack(updated, clip.trackId);
              const idx = trackClips.findIndex((c) => c.id === clip.id);
              const affectedIds = trackClips.slice(idx + 1).map((c) => c.id);
              onRipplePreview(clip.id, affectedIds, deltaSec);
            }
            break;
          }
          case 'roll': {
            // Find adjacent clip for roll edit
            const trackClips = clipsOnTrack(timeline, clip.trackId);
            const idx = trackClips.findIndex((c) => c.id === clip.id);
            if (edge === 'right' && idx < trackClips.length - 1) {
              updated = rollTrim(timeline, clip.id, trackClips[idx + 1].id, deltaSec);
            } else if (edge === 'left' && idx > 0) {
              updated = rollTrim(timeline, trackClips[idx - 1].id, clip.id, -deltaSec);
            } else {
              updated = timeline;
            }
            break;
          }
          case 'slip':
            updated = slipClip(timeline, clip.id, deltaSec);
            onSlipPreview?.(clip.id, clip.trimStart + deltaSec);
            break;
          case 'slide': {
            updated = slideClip(timeline, clip.id, deltaSec);
            const trackClips = clipsOnTrack(timeline, clip.trackId);
            const sIdx = trackClips.findIndex((c) => c.id === clip.id);
            const leftN = sIdx > 0 ? trackClips[sIdx - 1] : null;
            const rightN = sIdx < trackClips.length - 1 ? trackClips[sIdx + 1] : null;
            if (leftN && rightN) {
              const updLeft = updated.clips.find((c) => c.id === leftN.id);
              const updRight = updated.clips.find((c) => c.id === rightN.id);
              onSlidePreview?.(
                clip.id,
                (updLeft?.trimEnd ?? leftN.trimEnd) - leftN.trimEnd,
                (updRight?.trimStart ?? rightN.trimStart) - rightN.trimStart,
              );
            }
            break;
          }
          default:
            updated = timeline;
        }

        onUpdate(updated);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onTrimPreviewEnd?.();
        onRipplePreviewEnd?.();
        onSlipPreviewEnd?.();
        onSlidePreviewEnd?.();
        onTrackForwardHighlightEnd?.();
      };

      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [
      tool,
      timeline,
      pxPerSecond,
      snapEnabled,
      onUpdate,
      onSelect,
      onTrimPreview,
      onTrimPreviewEnd,
      onRipplePreview,
      onRipplePreviewEnd,
      onSlipPreview,
      onSlipPreviewEnd,
      onSlidePreview,
      onSlidePreviewEnd,
      onTrackForwardHighlight,
      onTrackForwardHighlightEnd,
    ],
  );

  const handleBladeClick = useCallback(
    (trackId: string, time: number, shiftKey: boolean) => {
      if (tool !== 'blade') return;
      if (shiftKey) {
        onUpdate(splitAllTracks(timeline, time));
        return;
      }
      const track = timeline.tracks.find((t) => t.id === trackId);
      if (track?.locked) return;
      const clip = timeline.clips.find(
        (c) => c.trackId === trackId && c.startTime <= time && clipEndTime(c) > time,
      );
      if (clip) {
        onUpdate(splitClip(timeline, clip.id, time));
      }
    },
    [tool, timeline, onUpdate],
  );

  return { handleClipMouseDown, handleBladeClick };
}
