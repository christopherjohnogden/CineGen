import type { DirectorActingTask, DirectorClip } from '@/types/director';
import { FOV_ANCHORS } from '@/lib/director/craft/optics';
import { weakSpatialWordsIn } from '@/lib/director/craft/blocking';
import {
  assignStagingFigures,
  bumpStagingVersion,
  emptyStagingMap,
  stagingDiagramPrompt,
} from '@/lib/director/staging-map';

const FOV_LABELS: Record<number, string> = {
  8: '8° super-telephoto — distant observation',
  18: '18° telephoto — tight emotional close-up',
  29: '29° short telephoto — portrait',
  47: '47° normal — documentary action',
  84: '84° wide — environmental action',
  107: '107° wide rectilinear — geography',
};

interface DirectorClipCraftProps {
  clip: DirectorClip;
  sceneLabel: string;
  aspectRatio: string;
  onPatch: (updater: (current: DirectorClip) => DirectorClip) => void;
}

export function DirectorClipCraft({ clip, sceneLabel, aspectRatio, onPatch }: DirectorClipCraftProps) {
  const weakWords = clip.blocking ? weakSpatialWordsIn(clip.blocking) : [];
  const taggedWithoutTask = clip.elementTags.filter(
    (tag) => !(clip.acting ?? []).some((task) => task.tag === tag),
  );

  const patchTask = (tag: string, patch: Partial<DirectorActingTask>) => {
    onPatch((current) => ({
      ...current,
      acting: (current.acting ?? []).map((task) => task.tag === tag ? { ...task, ...patch } : task),
    }));
  };

  return (
    <>
      <div>
        <label className="director-tab__label" htmlFor="director-blocking">Blocking</label>
        <textarea
          id="director-blocking"
          placeholder="Screen positions, body facing, gaze targets, depth, landmark contact, first-frame occupancy."
          value={clip.blocking ?? ''}
          onChange={(event) => onPatch((current) => ({ ...current, blocking: event.target.value }))}
        />
        {weakWords.length > 0 && (
          <p className="director-tab__warn">
            Vague proximity: {weakWords.join(', ')}. Anchor with contact instead — &ldquo;within 1 meter of the hood, one hand on it&rdquo;.
          </p>
        )}
      </div>

      <div>
        <label className="director-tab__label" htmlFor="director-fov">Lens</label>
        <select
          id="director-fov"
          value={clip.fov ?? ''}
          onChange={(event) => onPatch((current) => ({
            ...current,
            fov: event.target.value ? Number(event.target.value) : undefined,
          }))}
        >
          <option value="">No lens lock</option>
          {FOV_ANCHORS.map((fov) => (
            <option key={fov} value={fov}>{FOV_LABELS[fov]}</option>
          ))}
        </select>
      </div>

      <div>
        <span className="director-tab__label">Acting tasks</span>
        {(clip.acting ?? []).length === 0 && (
          <p className="director-tab__meta">None yet. A task is what the character does to the partner, not how they feel.</p>
        )}
        {(clip.acting ?? []).map((task) => (
          <div key={task.tag} className="director-tab__list">
            <div className="director-tab__row" style={{ alignItems: 'center' }}>
              <span className="director-tab__item-title">{task.tag}</span>
              <button
                type="button"
                className="director-tab__btn"
                onClick={() => onPatch((current) => ({
                  ...current,
                  acting: (current.acting ?? []).filter((entry) => entry.tag !== task.tag),
                }))}
              >
                Remove
              </button>
            </div>
            <input
              value={task.motive}
              placeholder="Motive — why HE pushes the scene's direction"
              onChange={(event) => patchTask(task.tag, { motive: event.target.value })}
            />
            <input
              value={task.goal}
              placeholder="Goal — his personal fight in this scene"
              onChange={(event) => patchTask(task.tag, { goal: event.target.value })}
            />
            <input
              value={task.obstacle}
              placeholder="Obstacle — what presses against the line"
              onChange={(event) => patchTask(task.tag, { obstacle: event.target.value })}
            />
            <input
              value={task.tactic}
              placeholder="Tactic — verbs at the partner, eye-work as action"
              onChange={(event) => patchTask(task.tag, { tactic: event.target.value })}
            />
          </div>
        ))}
        {taggedWithoutTask.length > 0 && (
          <div className="director-tab__row">
            {taggedWithoutTask.map((tag) => (
              <button
                key={tag}
                type="button"
                className="director-tab__btn"
                onClick={() => onPatch((current) => ({
                  ...current,
                  acting: [
                    ...(current.acting ?? []),
                    { tag, motive: '', goal: '', obstacle: '', tactic: '' },
                  ],
                }))}
              >
                + {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <StagingBlock clip={clip} sceneLabel={sceneLabel} aspectRatio={aspectRatio} onPatch={onPatch} />
    </>
  );
}

function StagingBlock({ clip, sceneLabel, aspectRatio, onPatch }: DirectorClipCraftProps) {
  const map = clip.staging;

  return (
    <div>
      <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12 }}>
        <input
          type="checkbox"
          checked={Boolean(map?.enabled)}
          onChange={(event) => onPatch((current) => {
            const base = current.staging ?? {
              ...emptyStagingMap('SHOW', sceneLabel),
              figures: assignStagingFigures(current.elementTags),
            };
            return { ...current, staging: { ...base, enabled: event.target.checked } };
          })}
        />
        Staging reference
      </label>

      {map?.enabled && (
        <div className="director-tab__list">
          <input
            value={map.stagingTag}
            placeholder="@staging_SHOW_scene_v1"
            onChange={(event) => onPatch((current) => current.staging
              ? { ...current, staging: { ...current.staging, stagingTag: event.target.value } }
              : current)}
          />
          <input
            value={map.locationTag}
            placeholder="@loc_SHOW_name_scene_v1"
            onChange={(event) => onPatch((current) => current.staging
              ? { ...current, staging: { ...current.staging, locationTag: event.target.value } }
              : current)}
          />
          {map.figures.map((figure) => (
            <div key={figure.letter} className="director-tab__row" style={{ alignItems: 'center' }}>
              <span className="director-tab__meta" style={{ minWidth: 96 }}>
                @{figure.letter} · {figure.color}
              </span>
              <input
                value={figure.position}
                placeholder="spot, pose, facing"
                onChange={(event) => onPatch((current) => current.staging
                  ? {
                    ...current,
                    staging: {
                      ...current.staging,
                      figures: current.staging.figures.map((entry) => entry.letter === figure.letter
                        ? { ...entry, position: event.target.value }
                        : entry),
                    },
                  }
                  : current)}
              />
            </div>
          ))}
          <div className="director-tab__row">
            <button
              type="button"
              className="director-tab__btn"
              onClick={() => void navigator.clipboard.writeText(stagingDiagramPrompt({
                figures: map.figures,
                aspectRatio,
              }))}
            >
              Copy diagram prompt
            </button>
            <button
              type="button"
              className="director-tab__btn"
              onClick={() => onPatch((current) => current.staging
                ? {
                  ...current,
                  staging: {
                    ...current.staging,
                    stagingTag: bumpStagingVersion(current.staging.stagingTag),
                    assetId: undefined,
                  },
                }
                : current)}
            >
              New version
            </button>
          </div>
          <p className="director-tab__meta">
            Generate the schematic from the copied prompt with your source frame attached, then attach it after the
            location and character references so those carry the style.
          </p>
        </div>
      )}
    </div>
  );
}
