import { Suspense, lazy, useCallback, useEffect, useRef, useMemo, useState } from 'react';

import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { ProjectSet, SplatFormat } from '@/types/sets';
import { generateId, timestamp } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import { FULL_FRAME, renderSize, aspectRatio, type SensorSize } from '@/lib/sets/optics';
import type { SetViewerHandle } from './set-viewer';
import { captureSetView, captureShapeShot, type SetSendOptions, type ShapeShotTarget } from '@/lib/sets/shape-shot';
import { readLastSet, writeLastSet, viewerSessionKey } from '@/lib/sets/viewer-session';
import '@/styles/sets-view.css';
import { SetSendDialog } from './set-send-dialog';

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

export function SetsView({ target, onSent }: { target?: ShapeShotTarget | null; onSent?: (destination?: 'studio' | 'canvas', nodeId?: string) => void } = {}) {
  const { state, dispatch, projectId } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(() => readLastSet(projectId));
  const [focalMm, setFocalMm] = useState(35);
  const [sensor, setSensor] = useState<SensorSize>(FULL_FRAME);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendOptions, setSendOptions] = useState<SetSendOptions>({ mode: 'view', includeStandIns: false, enhance: false, instructions: '' });
  const [destination, setDestination] = useState<'studio' | 'canvas'>('studio');
  useEffect(() => { writeLastSet(projectId, selectedId); }, [projectId, selectedId]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewFailures, setPreviewFailures] = useState<string[]>([]);
  const viewerRef = useRef<SetViewerHandle | null>(null);
  const previewRunning = useRef(false);
  const [previewTick, setPreviewTick] = useState(0);


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

  useEffect(() => {
    if (selectedId || previewRunning.current) return;
    const next = sets.find(entry => entry.splatPath && !entry.thumbnailUrl && !previewFailures.includes(entry.id));
    if (!next) return;
    let cancelled = false;
    previewRunning.current = true;
    import('@/lib/sets/thumbnail').then(module => module.createSetThumbnail(next)).then(thumbnailUrl => {
      if (!cancelled) dispatch({ type: 'UPDATE_SET', setId: next.id, updates: { thumbnailUrl } });
    }).catch(() => { if (!cancelled) setPreviewFailures(current => [...current, next.id]); })
      .finally(() => { previewRunning.current = false; setPreviewTick(tick => tick + 1); });
    return () => { cancelled = true; };
  }, [sets, selectedId, previewFailures, previewTick, dispatch]);

  const savePreview = async () => {
    const handle = viewerRef.current;
    if (!handle || !selected) return;
    const size = renderSize(aspectRatio(target?.aspect ?? '16:9'), 480);
    const { plate } = await handle.capture(['plate'], size.width, size.height);
    const { blobDataUrl } = await import('@/lib/sets/thumbnail');
    updateSelected({ thumbnailUrl: await blobDataUrl(plate) });
  };
  const back = async () => {
    setBusy(true);
    try { await savePreview(); } catch { /* A preview failure must not block navigation. */ }
    setBusy(false); setSelectedId(null); setError('');
  };
  const send = async () => {
    if (!target || !selected || !viewerRef.current) return;
    setBusy(true); setError('');
    try {
      const result = sendOptions.mode === 'view'
        ? await captureSetView(viewerRef.current, { setId: selected.id, width: target.width, height: target.height, maxReferences: target.viewMaxReferences ?? target.maxReferences, ...sendOptions })
        : await captureShapeShot(viewerRef.current, { setId: selected.id,
        width: target.width, height: target.height, maxReferences: target.maxReferences,
        focalMm, sensor, subject: selected.standIns?.find(entry => entry.visible !== false) });
      if (sendOptions.mode === 'passes') {
        if (sendOptions.enhance) result.promptBlock += ' Create a polished, photorealistic image. Repair scan artifacts and smeared surfaces while preserving the referenced angle, layout, materials, signage, and lighting direction.';
        if (sendOptions.instructions.trim()) result.promptBlock += `\n\n${sendOptions.instructions.trim()}`;
      }
      const nodeId = destination === 'canvas' ? await target.sendToCanvas!(result) : (await target.attach(result), undefined);
      updateSelected({ cameras: [...selected.cameras, result.camera] });
      try { await savePreview(); } catch { /* References are already attached. */ }
      setSendOpen(false);
      onSent?.(destination, nodeId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send this shot.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="sets-view" data-testid="sets-view">
      <header className="sets-view__bar">
        <div className="sets-view__identity">
          {selected && <button type="button" className="sets-view__back" disabled={busy} onClick={back}>← All sets</button>}
          <div><h2 className="sets-view__title">{selected?.name ?? 'Sets'}</h2>
          <p className="sets-view__subtitle">{selected ? 'Frame your next shot' : 'Your locations, ready for a new angle'}</p></div>
        </div>
        <div className="sets-view__actions">
          {selected && target && <span className="sets-view__destination">{target.label} · {target.width} × {target.height}</span>}
          {selected ? <button type="button" className="sets-view__import" disabled={busy}
            onClick={() => { setError(''); setSendOpen(true); }}>Send angle…</button>
            : <button type="button" className="sets-view__import" data-testid="sets-import" onClick={importSplat}>Import scan</button>}
        </div>
      </header>
      {error && !sendOpen && <p className="sets-view__error" role="alert">{error}</p>}
      {sendOpen && <SetSendDialog target={target} options={sendOptions} onOptions={setSendOptions}
        destination={destination} onDestination={setDestination} busy={busy} error={error}
        onClose={() => setSendOpen(false)} onSend={send} />}
      {selected ? <div className="sets-view__stage" aria-busy={busy}>
        <Suspense fallback={<p className="sets-view__loading">Loading the 3D viewer…</p>}>
          <SetViewer key={selected.id} sessionKey={viewerSessionKey(projectId, selected.id)} handleRef={viewerRef} set={selected} splatUrl={splatUrl}
            standIns={selected.standIns ?? []} onStandInsChange={standIns => updateSelected({ standIns })}
            aspect={target?.aspect ?? '16:9'} focalMm={focalMm} onFocalChange={setFocalMm}
            sensor={sensor} onSensorChange={setSensor} onSetChange={updateSelected} />
        </Suspense>
      </div> : sets.length === 0 ? <div className="sets-view__empty"><h3>Start with a location</h3>
        <p>Import a splat scan, frame an angle, and send the shot to Studio.</p></div>
        : <ul className="sets-view__gallery" aria-label="Sets">
          {sets.map(entry => <li key={entry.id}><button type="button" className="sets-view__card"
            data-testid={`sets-card-${entry.id}`} onClick={() => setSelectedId(entry.id)}>
            <div className="sets-view__preview">{entry.thumbnailUrl
              ? <img src={entry.thumbnailUrl} alt={`Preview of ${entry.name}`} />
              : <span>{!entry.splatPath ? 'Scan not on this machine' : previewFailures.includes(entry.id) ? 'Open set to create a preview' : 'Preparing preview…'}</span>}
              <span className="sets-view__open">Open set ↗</span>
            </div>
            <div className="sets-view__card-info"><span className="sets-view__card-name">{entry.name}</span>
              <span className="sets-view__card-meta">{entry.cameras.length} saved {entry.cameras.length === 1 ? 'angle' : 'angles'} · {entry.standIns?.length ?? 0} stand-ins</span></div>
          </button></li>)}
        </ul>}
    </div>
  );
}

export default SetsView;
