import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectSet, SetCamera } from '@/types/sets';
import type { StandIn } from '@/lib/sets/scene';
import { FULL_FRAME, aspectRatio, renderSize, type SensorSize } from '@/lib/sets/optics';
import { toFileUrl } from '@/lib/utils/file-url';
import type { SetViewerHandle } from './set-viewer';
import '@/styles/shape-shot.css';

const SetViewer = lazy(() => import('./set-viewer').then((m) => ({ default: m.SetViewer })));

export type { ShapeShotResult } from '@/lib/sets/shape-shot';
import { captureShapeShot, passesWithinBudget, type ShapeShotResult } from '@/lib/sets/shape-shot';
export { passesWithinBudget } from '@/lib/sets/shape-shot';

export interface ShapeShotModalProps {
  sets: ProjectSet[];
  /** Orientation trim dialled in here sticks to the Set. */
  onSetChange?: (setId: string, updates: Partial<ProjectSet>) => void;
  /** Output aspect of the pending generation, so renders match the shot. */
  aspect: string;
  /** Long edge in pixels for the renders. */
  longEdge?: number;
  outputSize?: { width: number; height: number };
  /** Elements the user can pull a stand-in height from. */
  onClose: () => void;
  onAttach: (result: ShapeShotResult) => void | Promise<void>;
  onSaveCamera?: (setId: string, camera: SetCamera) => void;
  /** Drop depth first, then the stand-in pass, when slots are tight. */
  maxReferences?: number;
}

export function ShapeShotModal({
  sets,
  aspect,
  longEdge = 1280,
  outputSize,
  onClose,
  onAttach,
  onSaveCamera,
  onSetChange,
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
  const [standIns, setStandIns] = useState<StandIn[]>([]);
  const [focalMm, setFocalMm] = useState(35);
  const [sensor, setSensor] = useState<SensorSize>(FULL_FRAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const viewerRef = useRef<SetViewerHandle | null>(null);

  const set = useMemo(() => usable.find((entry) => entry.id === setId) ?? null, [usable, setId]);

  useEffect(() => { setStandIns(set?.standIns ?? []); }, [setId]);

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
      const { width, height } = outputSize ?? renderSize(aspectRatio(aspect), longEdge);
      const result = await captureShapeShot(handle, { setId: set.id, width, height,
        maxReferences, focalMm, sensor, subject: standIns.find(entry => entry.visible !== false) });
      await onAttach(result);
      onSaveCamera?.(set.id, result.camera);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not render this shot.');
      setBusy(false);
    }
  }, [aspect, outputSize, focalMm, longEdge, maxReferences, onAttach, onClose, onSaveCamera, sensor, set, standIns]);

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
                  onSetChange={(updates) => onSetChange?.(set.id, updates)}
                />
              </Suspense>
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
            disabled={!set || busy || maxReferences < 2}
          >
            {busy ? 'Rendering…' : 'Attach'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ShapeShotModal;
