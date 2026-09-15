import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import * as THREE from 'three';

import type { ProjectSet, SetCamera } from '@/types/sets';
import {
  FULL_FRAME,
  LENS_PRESETS,
  SENSOR_PRESETS,
  aspectRatio,
  diagonalFov,
  heightDescriptor,
  shotSize,
  verticalFov,
  type SensorSize,
} from '@/lib/sets/optics';
import {
  applyCamera,
  createScene,
  renderPass,
  rgbaToPngBlob,
  syncStandIns,
  type PassKind,
  type SceneContext,
  type StandIn,
} from '@/lib/sets/scene';
import { generateId } from '@/lib/utils/ids';
import '@/styles/set-viewer.css';

/**
 * The 3D Set viewer.
 *
 * One component serves both hosts: the Sets library (browse and edit a Set) and
 * the Shape Shot modal (frame a shot and attach it). The camera and stand-ins
 * are props with change callbacks rather than internal state, so a third host —
 * Director's "Frame in 3D", a Canvas node — mounts it without a rewrite.
 *
 * Everything three.js lives behind a ref and a single effect. This module is
 * only ever reached through a dynamic import so that three + Spark stay out of
 * the main bundle.
 */

export interface SetViewerHandle {
  /** Render the requested passes at an exact pixel size. */
  capture(kinds: PassKind[], width: number, height: number): Promise<Record<string, Blob>>;
  /** The live camera as a persistable record. */
  readCamera(name: string): SetCamera;
  /** Where the primary subject sits across the frame, 0..1, if there is one. */
  subjectFrameX(): number | undefined;
  subjectDistance(): number | undefined;
}

export interface SetViewerProps {
  set: ProjectSet;
  splatUrl?: string;
  standIns: StandIn[];
  onStandInsChange?: (standIns: StandIn[]) => void;
  /** Output aspect, e.g. '16:9'. The stage letterboxes to it. */
  aspect?: string;
  focalMm: number;
  onFocalChange?: (focalMm: number) => void;
  sensor?: SensorSize;
  onSensorChange?: (sensor: SensorSize) => void;
  showThirds?: boolean;
  /** Hide the side panel when the host supplies its own controls. */
  controls?: boolean;
  handleRef?: Ref<SetViewerHandle>;
}

const POSES: StandIn['pose'][] = ['standing', 'sitting', 'walking', 'kneeling'];

export function SetViewer({
  set,
  splatUrl,
  standIns,
  onStandInsChange,
  aspect = '16:9',
  focalMm,
  onFocalChange,
  sensor = FULL_FRAME,
  onSensorChange,
  showThirds = true,
  controls = true,
  handleRef,
}: SetViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<SceneContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [, forceReadout] = useState(0);

  const ratio = aspectRatio(aspect);

  // --- scene lifecycle -----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    setStatus('loading');
    setMessage(splatUrl ? 'Loading scan…' : 'No scan imported yet.');

    createScene({ canvas, set, splatUrl })
      .then((ctx) => {
        if (disposed) { ctx.dispose(); return; }
        ctxRef.current = ctx;
        syncStandIns(ctx.standInGroup, standIns);
        setStatus('ready');
        setMessage('');

        const loop = () => {
          if (disposed || !ctxRef.current) return;
          const live = ctxRef.current;
          live.renderer.render(live.scene, live.camera);
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Could not open this scan.');
      });

    return () => {
      disposed = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      ctxRef.current?.dispose();
      ctxRef.current = null;
    };
    // Rebuilding on a new scan or a new Set is intended; stand-ins sync separately.
  }, [set.id, splatUrl, set.upAxis, set.scaleToMeters]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx) syncStandIns(ctx.standInGroup, standIns);
  }, [standIns]);

  // --- camera --------------------------------------------------------------
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.camera.fov = verticalFov(focalMm, sensor);
    ctx.camera.aspect = ratio;
    ctx.camera.updateProjectionMatrix();
    forceReadout((n) => n + 1);
  }, [focalMm, sensor, ratio, status]);

  // --- resize the drawing buffer to the letterboxed frame ------------------
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const resize = () => {
      const ctx = ctxRef.current;
      const rect = frame.getBoundingClientRect();
      if (!ctx || rect.width < 2 || rect.height < 2) return;
      ctx.renderer.setSize(rect.width, rect.height, false);
      ctx.camera.aspect = ratio;
      ctx.camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ratio, status]);

  // --- orbit / dolly -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== 'ready') return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const target = new THREE.Vector3(0, 1.2, 0);

    const orbit = (dx: number, dy: number) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const offset = ctx.camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.005;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.005, 0.05, Math.PI - 0.05);
      ctx.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));
      ctx.camera.lookAt(target);
      forceReadout((n) => n + 1);
    };

    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      orbit(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const ctx = ctxRef.current;
      if (!ctx) return;
      const offset = ctx.camera.position.clone().sub(target);
      offset.multiplyScalar(event.deltaY > 0 ? 1.1 : 0.9);
      if (offset.length() > 0.2 && offset.length() < 500) {
        ctx.camera.position.copy(target).add(offset);
        ctx.camera.lookAt(target);
        forceReadout((n) => n + 1);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [status]);

  // --- readouts ------------------------------------------------------------
  const primary = standIns[0];
  const ctx = ctxRef.current;
  const cameraHeight = ctx?.camera.position.y ?? 1.6;
  const subjectDistance = primary && ctx
    ? ctx.camera.position.distanceTo(new THREE.Vector3(primary.x, primary.heightM * 0.5, primary.z))
    : undefined;
  const tilt = ctx
    ? THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(
      new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion).y, -1, 1,
    )))
    : 0;

  const subjectFrameX = useCallback((): number | undefined => {
    const live = ctxRef.current;
    if (!live || !primary) return undefined;
    const point = new THREE.Vector3(primary.x, primary.heightM * 0.5, primary.z).project(live.camera);
    return (point.x + 1) / 2;
  }, [primary]);

  useImperativeHandle(handleRef, (): SetViewerHandle => ({
    async capture(kinds, width, height) {
      const live = ctxRef.current;
      if (!live) throw new Error('The Set viewer is not ready yet.');
      const out: Record<string, Blob> = {};
      // Sequential on purpose — the passes share one scene and one GL context.
      for (const kind of kinds) {
        const { data } = await renderPass(live, kind, width, height);
        out[kind] = await rgbaToPngBlob(data, width, height);
      }
      return out;
    },
    readCamera(name) {
      const live = ctxRef.current;
      const position = live ? live.camera.position : new THREE.Vector3(0, 1.6, 4);
      const lookAt = new THREE.Vector3(0, 1.2, 0);
      return {
        id: generateId(),
        name,
        createdAt: new Date().toISOString(),
        position: [position.x, position.y, position.z],
        target: [lookAt.x, lookAt.y, lookAt.z],
        focalMm,
        sensorWidthMm: sensor.widthMm,
        sensorHeightMm: sensor.heightMm,
        aspect,
        fovDiagonal: diagonalFov(focalMm, sensor),
        ...(subjectDistance !== undefined ? { subjectDistance } : {}),
      };
    },
    subjectFrameX,
    subjectDistance: () => subjectDistance,
  }), [aspect, focalMm, sensor, subjectDistance, subjectFrameX]);

  const updateStandIn = (id: string, updates: Partial<StandIn>) => {
    onStandInsChange?.(standIns.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)));
  };

  return (
    <div className="set-viewer" data-testid="set-viewer">
      <div className="set-viewer__stage">
        <div
          className="set-viewer__frame"
          ref={frameRef}
          style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : 'auto', height: ratio >= 1 ? 'auto' : '100%' }}
        >
          <canvas className="set-viewer__canvas" ref={canvasRef} />
          {showThirds && (
            <svg className="set-viewer__overlay set-viewer__thirds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="33.33" y1="0" x2="33.33" y2="100" vectorEffect="non-scaling-stroke" />
              <line x1="66.66" y1="0" x2="66.66" y2="100" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="33.33" x2="100" y2="33.33" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="66.66" x2="100" y2="66.66" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {status === 'ready' && (
            <div className="set-viewer__readout" data-testid="set-viewer-readout">
              <span>Height <b>{cameraHeight.toFixed(2)}m</b></span>
              <span>Tilt <b>{tilt.toFixed(0)}°</b></span>
              {subjectDistance !== undefined && <span>Subject <b>{subjectDistance.toFixed(1)}m</b></span>}
              {primary && (
                <span>{shotSize(primary.heightM, subjectDistance ?? 4, verticalFov(focalMm, sensor))}</span>
              )}
            </div>
          )}
          {status !== 'ready' && (
            <p className="set-viewer__status" role="status">{message}</p>
          )}
        </div>
      </div>

      {controls && (
        <div className="set-viewer__panel">
          <div className="set-viewer__group">
            <h4>Lens</h4>
            <div className="set-viewer__lenses">
              {LENS_PRESETS.map((mm) => (
                <button
                  key={mm}
                  type="button"
                  className={`set-viewer__lens${focalMm === mm ? ' is-active' : ''}`}
                  data-testid={`set-viewer-lens-${mm}`}
                  onClick={() => onFocalChange?.(mm)}
                >
                  {mm}mm
                </button>
              ))}
            </div>
            <label className="set-viewer__row">
              Custom
              <input
                type="number"
                min={8}
                max={600}
                step={1}
                value={focalMm}
                aria-label="Focal length in millimetres"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) onFocalChange?.(next);
                }}
              />
            </label>
            <label className="set-viewer__row">
              Sensor
              <select
                aria-label="Sensor size"
                value={SENSOR_PRESETS.find((p) => p.size.widthMm === sensor.widthMm)?.id ?? 'full-frame'}
                onChange={(event) => {
                  const found = SENSOR_PRESETS.find((p) => p.id === event.target.value);
                  if (found) onSensorChange?.(found.size);
                }}
              >
                {SENSOR_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            <p className="set-viewer__row">{diagonalFov(focalMm, sensor).toFixed(0)}° diagonal field of view</p>
          </div>

          <div className="set-viewer__group">
            <h4>Stand-ins</h4>
            {standIns.map((entry) => (
              <div className="set-viewer__standin" key={entry.id}>
                <div className="set-viewer__standin-head">
                  <span>{entry.label ?? 'Stand-in'}</span>
                  <button
                    type="button"
                    className="set-viewer__remove"
                    aria-label={`Remove ${entry.label ?? 'stand-in'}`}
                    onClick={() => onStandInsChange?.(standIns.filter((s) => s.id !== entry.id))}
                  >
                    Remove
                  </button>
                </div>
                <label className="set-viewer__row">
                  Height
                  <input
                    type="number" min={0.5} max={2.5} step={0.01} value={entry.heightM}
                    aria-label={`${entry.label ?? 'Stand-in'} height in metres`}
                    onChange={(event) => updateStandIn(entry.id, { heightM: Number(event.target.value) || 1.8 })}
                  />
                </label>
                <label className="set-viewer__row">
                  Pose
                  <select
                    value={entry.pose}
                    aria-label={`${entry.label ?? 'Stand-in'} pose`}
                    onChange={(event) => updateStandIn(entry.id, { pose: event.target.value as StandIn['pose'] })}
                  >
                    {POSES.map((pose) => <option key={pose} value={pose}>{pose}</option>)}
                  </select>
                </label>
                <label className="set-viewer__row">
                  Facing
                  <input
                    type="range" min={0} max={360} step={1}
                    value={Math.round((entry.facing * 180) / Math.PI)}
                    aria-label={`${entry.label ?? 'Stand-in'} facing`}
                    onChange={(event) => updateStandIn(entry.id, { facing: (Number(event.target.value) * Math.PI) / 180 })}
                  />
                </label>
                {set.marks.length > 0 && (
                  <label className="set-viewer__row">
                    Mark
                    <select
                      aria-label={`Snap ${entry.label ?? 'stand-in'} to a mark`}
                      value=""
                      onChange={(event) => {
                        const mark = set.marks.find((m) => m.id === event.target.value);
                        if (mark) updateStandIn(entry.id, { x: mark.x, z: mark.z, facing: mark.facing });
                      }}
                    >
                      <option value="">Snap to…</option>
                      {set.marks.map((mark) => <option key={mark.id} value={mark.id}>{mark.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            ))}
            <button
              type="button"
              className="set-viewer__add"
              data-testid="set-viewer-add-standin"
              onClick={() => onStandInsChange?.([
                ...standIns,
                { id: generateId(), heightM: 1.8, pose: 'standing', x: 0, z: 0, facing: 0, label: `Stand-in ${standIns.length + 1}` },
              ])}
            >
              Add stand-in
            </button>
          </div>

          <div className="set-viewer__group">
            <h4>Camera</h4>
            <p className="set-viewer__row">{heightDescriptor(cameraHeight, primary?.heightM ?? 1.8)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SetViewer;
