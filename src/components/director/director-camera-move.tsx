import type { CameraMoveId, DirectorCameraMove, ShotSize } from '@/types/director';
import {
  CAMERA_MOVES, emptyCameraMove, filmicMoveFor, intensityAdverb, resolveCameraMove,
} from '@/lib/director/craft/coverage';

interface DirectorCameraMovePanelProps {
  value?: DirectorCameraMove;
  inherited?: DirectorCameraMove;
  sizeHint?: ShotSize;
  onChange: (next: DirectorCameraMove) => void;
}

export function DirectorCameraMovePanel({
  value,
  inherited,
  sizeHint,
  onChange,
}: DirectorCameraMovePanelProps) {
  const plan = value ?? inherited ?? emptyCameraMove();
  const usingScene = !value && Boolean(inherited);
  const preview = resolveCameraMove({ beat: sizeHint ? { size: sizeHint } : undefined, clip: plan });
  const filmicId = plan.move !== 'locked' ? plan.move : filmicMoveFor(plan.intensity, sizeHint);
  const filmicLabel = CAMERA_MOVES.find((entry) => entry.id === filmicId)?.label;

  const setMove = (move: CameraMoveId) => {
    onChange({
      move,
      intensity: move === 'locked' ? plan.intensity : Math.max(plan.intensity, 40),
    });
  };

  return (
    <div className="dcov-move">
      <span className="dsl-scenefield-label">Camera movement</span>
      <p className="director-tab__meta">
        {usingScene
          ? 'Inheriting the scene plan. Pick a move to override this clip.'
          : 'Locked off unless you ask for a move — or push Life if the frame feels static.'}
      </p>
      <div className="dgen-seg dcov-moves" role="group" aria-label="Camera move">
        {CAMERA_MOVES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`dgen-seg-btn${plan.move === entry.id ? ' dgen-seg-btn--on' : ''}${plan.move === 'locked' && plan.intensity > 0 && entry.id === filmicId ? ' dgen-seg-btn--hint' : ''}`}
            onClick={() => setMove(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <label className="dcov-life">
        <span className="dsl-scenefield-label">Life</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={plan.intensity}
          onChange={(event) => onChange({
            move: plan.move,
            intensity: Number(event.target.value),
          })}
        />
        <span className="director-tab__meta">
          {plan.intensity === 0 ? 'Locked' : `${intensityAdverb(plan.intensity) || 'filmic'} · ${filmicLabel}`}
        </span>
      </label>
      {!preview.locked && <p className="director-tab__ok">{preview.line}</p>}
    </div>
  );
}
