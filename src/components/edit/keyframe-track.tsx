import { useCallback, useRef, useState } from 'react';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';

interface KeyframeTrackProps {
  clip: Clip;
  pxPerSecond: number;
  onAddKeyframe?: (clipId: string, property: 'opacity' | 'volume', time: number, value: number) => void;
  onMoveKeyframe: (clipId: string, index: number, newTime: number) => void;
  onRemoveKeyframe: (clipId: string, index: number) => void;
}

export function KeyframeTrack({
  clip,
  pxPerSecond,
  onAddKeyframe,
  onMoveKeyframe,
  onRemoveKeyframe,
}: KeyframeTrackProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const dragRef = useRef<{ index: number; startX: number; startTime: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const effDuration = clipEffectiveDuration(clip);
  const trackWidth = effDuration * pxPerSecond;

  // Drag a diamond marker
  const handleMarkerPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setSelectedIndex(index);
      dragRef.current = {
        index,
        startX: e.clientX,
        startTime: clip.keyframes[index].time,
      };
    },
    [clip.keyframes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dt = dx / pxPerSecond;
      const newTime = Math.max(0, Math.min(effDuration, drag.startTime + dt));
      onMoveKeyframe(clip.id, drag.index, newTime);
    },
    [clip.id, pxPerSecond, effDuration, onMoveKeyframe],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Delete key removes selected keyframe
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        onRemoveKeyframe(clip.id, selectedIndex);
        setSelectedIndex(null);
      }
    },
    [clip.id, selectedIndex, onRemoveKeyframe],
  );

  return (
    <div
      ref={trackRef}
      className="keyframe-track"
      style={{ width: trackWidth }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {clip.keyframes.map((kf, i) => {
        const leftPercent = effDuration > 0
          ? (kf.time / effDuration) * 100
          : 0;
        return (
          <div
            key={`${kf.property}-${kf.time}-${i}`}
            className={`keyframe-track__marker keyframe-track__marker--${kf.property}${selectedIndex === i ? ' keyframe-track__marker--selected' : ''}`}
            style={{ left: `${leftPercent}%` }}
            onPointerDown={(e) => handleMarkerPointerDown(e, i)}
          />
        );
      })}
    </div>
  );
}
