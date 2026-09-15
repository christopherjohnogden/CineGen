import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectSet, SetCamera } from '@/types/sets';
import type { StandIn } from '@/lib/sets/scene';
import { ALL_PASSES, type PassKind } from '@/lib/sets/scene';
import { FULL_FRAME, aspectRatio, renderSize, type SensorSize } from '@/lib/sets/optics';
import { buildCameraPrompt, REFERENCE_TAGS } from '@/lib/sets/camera-prompt';
import { toFileUrl } from '@/lib/utils/file-url';
import { generateId } from '@/lib/utils/ids';
import type { SetViewerHandle } from './set-viewer';
import { FloorPlan } from './floor-plan';
import '@/styles/shape-shot.css';

const SetViewer = lazy(() => import('./set-viewer').then((m) => ({ default: m.SetViewer })));

/** The files and text an attach hands back to the composer, in slot order. */
export interface ShapeShotResult {
  files: File[];
  /** Per-slot tags plus the camera block, already assembled. */
  promptBlock: string;
  camera: SetCamera;
  setId: string;
}

export interface ShapeShotModalProps {
  sets: ProjectSet[];
  /** Output aspect of the pending generation, so renders match the shot. */
  aspect: string;
  /** Long edge in pixels for the renders. */
  longEdge?: number;
  /** Elements the user can pull a stand-in height from. */
  onClose: () => void;
  onAttach: (result: ShapeShotResult) => void | Promise<void>;
  onSaveCamera?: (setId: string, camera: SetCamera) => void;
  /** Drop depth first, then the stand-in pass, when slots are tight. */
  maxReferences?: number;
}

const PASS_FILENAMES: Record<PassKind, string> = {
  plate: 'shape-shot-plate.png',
  composite: 'shape-shot-composite.png',
  depth: 'shape-shot-depth.png',
  standin: 'shape-shot-standin.png',
};

/**
 * Which passes survive a reference-slot budget.
 *
 * The brief fixes the order: depth goes first, then the stand-in pass. The
 * plate and the composite always stay — without the plate the model invents the
 * environment, and without the composite it invents the framing.
 */
export function passesWithinBudget(budget: number): PassKind[] {
  if (budget >= 4) return [...ALL_PASSES];
  if (budget === 3) return ['plate', 'composite', 'standin'];
  return ['plate', 'composite'];
}

export function ShapeShotModal({
  sets,
  aspect,
  longEdge = 1280,
  onClose,
  onAttach,
  onSaveCamera,
  maxReferences = 4,
}: ShapeShotModalProps) {
  const usable = useMemo(() => sets.filter((set) => Boolean(set.splatPath)), [sets]);
  const [setId, setSetId] = useState<string | null>(() => {
    try {
      const last = window.localStorage.getItem('cinegen_shape_shot_last_set');
      if (last && usable.some((set) => set.id === last)) return last;
    } catch { /* falls through to the first Set */ }
    return usable[0]?.id ?? null;
  });
  const [standIns, setStandIns] = useState<StandIn[]>([
    { id: generateId(), heightM: 1.8, pose: 'standing', x: 0, z: 0, facing: Math.PI, label: 'Stand-in 1' },
  ]);
  const [focalMm, setFocalMm] = useState(35);
  const [sensor, setSensor] = useState<SensorSize>(FULL_FRAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const viewerRef = useRef<SetViewerHandle | null>(null);

  const set = useMemo(() => usable.find((entry) => entry.id === setId) ?? null, [usable, setId]);

  useEffect(() => {
    if (!setId) return;
    try { window.localStorage.setItem('cinegen_shape_shot_last_set', setId); } catch { /* preference only */ }
  }, [setId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const attach = useCallback(async () => {
    const handle = viewerRef.current;
    if (!handle || !set) return;
    setBusy(true);
    setError('');
    try {
      const kinds = passesWithinBudget(maxReferences);
      const { width, height } = renderSize(aspectRatio(aspect), longEdge);
      const blobs = await handle.capture(kinds, width, height);

      const files = kinds.map((kind) => new File([blobs[kind]], PASS_FILENAMES[kind], { type: 'image/png' }));

      const camera = handle.readCamera(`Shape Shot ${new Date().toLocaleString()}`);
      const prompt = buildCameraPrompt({
        focalMm,
        sensor,
        cameraHeightM: camera.position[1],
        subjectDistanceM: handle.subjectDistance(),
        subjectFrameX: handle.subjectFrameX(),
        subject: standIns[0],
      });

      // Slot tags first, in reference order, then the camera block. The tags
      // name @imageN, so they must match the order the files are attached in.
      const tags = kinds.map((kind) => REFERENCE_TAGS[kind]).join(' ');
      onSaveCamera?.(set.id, camera);
      await onAttach({
        files,
        promptBlock: `${tags} ${prompt.block}`.replace(/\s+/g, ' ').trim(),
        camera,
        setId: set.id,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not render this shot.');
      setBusy(false);
    }
  }, [aspect, focalMm, longEdge, maxReferences, onAttach, onClose, onSaveCamera, sensor, set, standIns]);

  return (
    <div className="shape-shot" role="dialog" aria-modal="true" aria-label="Shape Shot" data-testid="shape-shot">
      <div className="shape-shot__panel">
        <header className="shape-shot__head">
          <h2>Shape Shot</h2>
          <select
            aria-label="Set"
            value={setId ?? ''}
            data-testid="shape-shot-set"
            onChange={(event) => setSetId(event.target.value || null)}
          >
            {usable.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          <button type="button" className="shape-shot__close" onClick={onClose} aria-label="Close Shape Shot">✕</button>
        </header>

        {error && <p className="shape-shot__error" role="alert">{error}</p>}

        <div className="shape-shot__body">
          {set ? (
            <>
              <Suspense fallback={<p className="shape-shot__loading">Loading the 3D viewer…</p>}>
                <SetViewer
                  handleRef={viewerRef}
                  set={set}
                  splatUrl={set.splatPath ? toFileUrl(set.splatPath) : undefined}
                  standIns={standIns}
                  onStandInsChange={setStandIns}
                  aspect={aspect}
                  focalMm={focalMm}
                  onFocalChange={setFocalMm}
                  sensor={sensor}
                  onSensorChange={setSensor}
                />
              </Suspense>
              <FloorPlan set={set} standIns={standIns} />
            </>
          ) : (
            <p className="shape-shot__loading">
              No Sets with a scan on this machine. Import one in Spaces → Sets first.
            </p>
          )}
        </div>

        <footer className="shape-shot__foot">
          <span className="shape-shot__hint">
            {passesWithinBudget(maxReferences).length} references + camera description
          </span>
          <button type="button" className="shape-shot__cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="shape-shot__attach"
            data-testid="shape-shot-attach"
            onClick={attach}
            disabled={!set || busy}
          >
            {busy ? 'Rendering…' : 'Attach'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ShapeShotModal;
