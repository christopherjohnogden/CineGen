import { useCallback } from 'react';
import type { Transition, Clip } from '@/types/timeline';
import { clipEndTime } from '@/types/timeline';

interface TransitionOverlayProps {
  transition: Transition;
  clipA: Clip;
  clipB?: Clip;
  pxPerSecond: number;
  onRemove: (transitionId: string) => void;
}

const TYPE_LABELS: Record<Transition['type'], string> = {
  dissolve: '\u2194',      // ↔
  fadeToBlack: '\u25C0',   // ◀
  fadeFromBlack: '\u25B6', // ▶
};

export function TransitionOverlay({
  transition,
  clipA,
  clipB,
  pxPerSecond,
  onRemove,
}: TransitionOverlayProps) {
  const width = transition.duration * pxPerSecond;

  let left: number;
  if (transition.type === 'dissolve' && clipB) {
    // Dissolve: positioned at the overlap region [clipB.startTime, clipEndTime(clipA)]
    left = clipB.startTime * pxPerSecond;
  } else if (transition.type === 'fadeFromBlack') {
    // Fade from black: starts at clipA's start
    left = clipA.startTime * pxPerSecond;
  } else {
    // Fade to black: ends at clipA's end
    left = (clipEndTime(clipA) - transition.duration) * pxPerSecond;
  }

  const handleRemove = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      onRemove(transition.id);
    },
    [transition.id, onRemove],
  );

  return (
    <div
      className={`transition-overlay transition-overlay--${transition.type}`}
      style={{ left, width: Math.max(8, width) }}
    >
      <span className="transition-overlay__icon">
        {TYPE_LABELS[transition.type]}
      </span>
      <button
        type="button"
        className="transition-overlay__remove"
        onPointerDown={handleRemove}
        title="Remove transition"
      >
        &times;
      </button>
    </div>
  );
}
