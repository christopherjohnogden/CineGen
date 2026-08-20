import type { CoverageKind, DirectorScene, DirectorShow } from '@/types/director';
import { applyCoverageToScene, COVERAGE_KINDS, patchSceneCamera } from '@/lib/director/craft/coverage';
import { DirectorCameraMovePanel } from './director-camera-move';

interface DirectorSceneCoverageProps {
  show: DirectorShow;
  scene: DirectorScene;
  onChange: (show: DirectorShow) => void;
}

export function DirectorSceneCoverage({ show, scene, onChange }: DirectorSceneCoverageProps) {
  const selected = new Set(scene.coverage ?? []);

  const toggle = (id: CoverageKind) => {
    const next = selected.has(id)
      ? [...selected].filter((kind) => kind !== id)
      : [...selected, id];
    onChange(applyCoverageToScene(show, scene.id, next));
  };

  return (
    <div className="dcov-scene">
      <div className="dcov-chips">
        <span className="dsl-scenefield-label">Coverage</span>
        <div className="dgen-seg" role="group" aria-label="Scene coverage">
          {COVERAGE_KINDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`dgen-seg-btn${selected.has(entry.id) ? ' dgen-seg-btn--on' : ''}`}
              title={entry.hint}
              onClick={() => toggle(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <label className="dsl-scenefield" title="Who stays camera-left of whom. A reverse is a failed take.">
        <span className="dsl-scenefield-label">Line of action</span>
        <input
          value={scene.axis ?? ''}
          placeholder="@Peter camera-left of @Jordan"
          onChange={(event) => onChange(patchSceneCamera(show, scene.id, { axis: event.target.value }))}
        />
      </label>
      <DirectorCameraMovePanel
        value={scene.cameraMove}
        onChange={(cameraMove) => onChange(patchSceneCamera(show, scene.id, { cameraMove }))}
      />
    </div>
  );
}
