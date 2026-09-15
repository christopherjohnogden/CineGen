import { Suspense, lazy, useCallback, useMemo, useState } from 'react';

import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { ProjectSet, SplatFormat } from '@/types/sets';
import { generateId, timestamp } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import type { StandIn } from '@/lib/sets/scene';
import { FULL_FRAME, type SensorSize } from '@/lib/sets/optics';
import { FloorPlan } from './floor-plan';
import '@/styles/sets-view.css';

// three + Spark are ~17MB unpacked and none of the three Vite configs has a
// chunking strategy, so the viewer is only ever reached through a dynamic
// import. Nothing 3D belongs in the main bundle.
const SetViewer = lazy(() => import('./set-viewer').then((m) => ({ default: m.SetViewer })));

const SPLAT_EXTENSIONS: Record<string, SplatFormat> = {
  ply: 'ply', spz: 'spz', sog: 'sog', splat: 'splat', ksplat: 'ksplat',
};

export function splatFormatFor(path: string): SplatFormat | undefined {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return SPLAT_EXTENSIONS[extension];
}

export function SetsView() {
  const { state, dispatch } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [standIns, setStandIns] = useState<StandIn[]>([]);
  const [focalMm, setFocalMm] = useState(35);
  const [sensor, setSensor] = useState<SensorSize>(FULL_FRAME);
  const [error, setError] = useState('');

  const sets = state.sets;
  const selected = useMemo(() => sets.find((set) => set.id === selectedId) ?? null, [sets, selectedId]);

  const importSplat = useCallback(async () => {
    setError('');
    const picker = window.electronAPI?.dialog?.showOpen;
    if (!picker) {
      setError('Importing a scan needs the desktop app. Sets made elsewhere still open here.');
      return;
    }
    try {
      const picked = await picker({
        filters: [{ name: 'Gaussian splats', extensions: ['ply', 'spz', 'sog', 'splat', 'ksplat'] }],
        properties: ['openFile'],
      });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path || typeof path !== 'string') return;

      const format = splatFormatFor(path);
      if (!format) {
        setError('That file is not a splat scan CineGen can read.');
        return;
      }
      const now = timestamp();
      const set: ProjectSet = {
        id: generateId(),
        name: path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled Set',
        createdAt: now,
        updatedAt: now,
        // Desktop-local by design: the binary is never copied or uploaded.
        splatPath: path,
        splatFormat: format,
        upAxis: 'y',
        scaleToMeters: 1,
        marks: [],
        cameras: [],
      };
      dispatch({ type: 'ADD_SET', set });
      setSelectedId(set.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import that scan.');
    }
  }, [dispatch]);

  const splatUrl = selected?.splatPath ? toFileUrl(selected.splatPath) : undefined;

  /** Orientation trim is per-Set and sticky: dial it in once, never again. */
  const updateSelected = useCallback((updates: Partial<ProjectSet>) => {
    if (!selectedId) return;
    dispatch({ type: 'UPDATE_SET', setId: selectedId, updates: { ...updates, updatedAt: timestamp() } });
  }, [dispatch, selectedId]);

  return (
    <div className="sets-view" data-testid="sets-view">
      <header className="sets-view__bar">
        <h2 className="sets-view__title">Sets</h2>
        <button type="button" className="sets-view__import" data-testid="sets-import" onClick={importSplat}>
          Import scan
        </button>
      </header>

      {error && <p className="sets-view__error" role="alert">{error}</p>}

      {sets.length === 0 ? (
        <div className="sets-view__empty">
          <p>No Sets yet.</p>
          <p>Import a Gaussian splat scan of a location to frame shots inside it.</p>
        </div>
      ) : (
        <div className="sets-view__body">
          <ul className="sets-view__list">
            {sets.map((set) => (
              <li key={set.id}>
                <button
                  type="button"
                  className={`sets-view__card${set.id === selectedId ? ' is-active' : ''}`}
                  data-testid={`sets-card-${set.id}`}
                  onClick={() => setSelectedId(set.id)}
                >
                  <span className="sets-view__card-name">{set.name}</span>
                  <span className="sets-view__card-meta">
                    {set.marks.length} {set.marks.length === 1 ? 'mark' : 'marks'}
                    {' · '}
                    {set.cameras.length} {set.cameras.length === 1 ? 'camera' : 'cameras'}
                  </span>
                  {!set.splatPath && <span className="sets-view__card-warn">Scan not on this machine</span>}
                </button>
              </li>
            ))}
          </ul>

          <div className="sets-view__stage">
            {selected ? (
              <>
                <Suspense fallback={<p className="sets-view__loading">Loading the 3D viewer…</p>}>
                  <SetViewer
                    set={selected}
                    splatUrl={splatUrl}
                    standIns={standIns}
                    onStandInsChange={setStandIns}
                    focalMm={focalMm}
                    onFocalChange={setFocalMm}
                    sensor={sensor}
                    onSensorChange={setSensor}
                    onSetChange={updateSelected}
                  />
                </Suspense>
                <FloorPlan set={selected} standIns={standIns} />
              </>
            ) : (
              <p className="sets-view__loading">Pick a Set to open it.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SetsView;
