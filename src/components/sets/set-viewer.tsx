import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  applySetOrientation,
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
  /** Persist orientation trim back onto the Set. */
  onSetChange?: (updates: Partial<ProjectSet>) => void;
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
  onSetChange,
  handleRef,
}: SetViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<SceneContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [navMode, setNavMode] = useState<'orbit' | 'look'>('orbit');
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
        syncStandIns(ctx.standInGroup, standIns, set.groundY ?? 0);
        setStatus('ready');
        setMessage('');

        const loop = () => {
          if (disposed || !ctxRef.current) return;
          const live = ctxRef.current;
          controlsRef.current?.update();
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
  }, [set.id, splatUrl]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx) syncStandIns(ctx.standInGroup, standIns, set.groundY ?? 0);
  }, [standIns, set.groundY]);

  // Re-orienting must not rebuild the scene — reloading a 500MB scan on every
  // nudge of a rotation slider would make the trim unusable.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx?.splat) applySetOrientation(ctx.splat, set);
  }, [set.upAxis, set.rotationDeg, set.scaleToMeters, status]);

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

  // --- navigation ----------------------------------------------------------
  // OrbitControls rather than a hand-rolled orbit: it gives left-drag orbit,
  // right-drag (and two-finger) pan, wheel dolly, damping, and a movable target,
  // which is what makes a scan explorable instead of pinned to one spot.
  useEffect(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || status !== 'ready') return;

    const controls = new OrbitControls(ctx.camera, canvas);
    controls.target.set(0, 1.2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.9;
    controls.zoomSpeed = 0.9;
    controls.rotateSpeed = 0.8;
    // A scan can be centimetres or tens of metres across; clamping tightly here
    // is what made the old controls feel like they would not zoom.
    controls.minDistance = 0.05;
    controls.maxDistance = 2000;
    // Never let the camera reach the poles. At phi 0 or PI the azimuth becomes
    // degenerate and a horizontal drag stops turning the view at all, which
    // reads as "I cannot rotate left or right".
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI - 0.08;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('change', () => forceReadout((n) => n + 1));
    controlsRef.current = controls;

    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.removeEventListener('contextmenu', onContextMenu);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [status]);

  /**
   * Look mode: turn the camera in place instead of orbiting a point.
   *
   * Orbiting is the wrong verb once you are standing inside a scanned room —
   * you want to face a different wall, not swing around the middle of the
   * floor. This keeps OrbitControls in charge of pan and dolly and only takes
   * over rotation, moving the target around the camera rather than the camera
   * around the target, so the two modes stay consistent.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== 'ready' || navMode !== 'look') return;
    const controls = controlsRef.current;
    if (!controls) return;

    controls.enableRotate = false;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const ctx = ctxRef.current;
      const orbit = controlsRef.current;
      if (!ctx || !orbit) return;

      const offset = orbit.target.clone().sub(ctx.camera.position);
      const distance = offset.length();
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= (event.clientX - lastX) * 0.004;
      // Stop just short of straight up or down, for the same reason as above.
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + (event.clientY - lastY) * 0.004, 0.08, Math.PI - 0.08);
      spherical.radius = distance;

      orbit.target.copy(ctx.camera.position).add(new THREE.Vector3().setFromSpherical(spherical));
      orbit.update();
      lastX = event.clientX;
      lastY = event.clientY;
      forceReadout((n) => n + 1);
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      const live = controlsRef.current;
      if (live) live.enableRotate = true;
    };
  }, [navMode, status]);

  /** Put the camera where the whole scan is visible. */
  const frameScene = useCallback(() => {
    const ctx = ctxRef.current;
    const controls = controlsRef.current;
    if (!ctx || !controls) return;

    const box = new THREE.Box3();
    if (ctx.splat) box.expandByObject(ctx.splat);
    ctx.standInGroup.children.forEach((child) => box.expandByObject(child));
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 1, 0), new THREE.Vector3(6, 3, 6));

    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.5, size.length() / 2);
    const distance = radius / Math.tan((ctx.camera.fov * Math.PI) / 360);

    // Stand in the space at eye height and look level, rather than hovering at
    // the bounding box centre — which for a room is up near the ceiling and
    // gives a tilted, disorienting first view.
    const eye = Math.min(box.max.y, box.min.y + 1.6);
    controls.target.set(centre.x, eye, centre.z);
    ctx.camera.position.set(centre.x, eye, centre.z + distance);
    ctx.camera.near = Math.max(0.01, radius / 1000);
    ctx.camera.far = distance + radius * 8;
    ctx.camera.updateProjectionMatrix();
    controls.update();
    forceReadout((n) => n + 1);
  }, []);

  // WASD/QE fly, because orbiting alone cannot get inside a room.
  useEffect(() => {
    if (status !== 'ready') return;
    const held = new Set<string>();
    const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

    const isTyping = (target: EventTarget | null) => (
      target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    );
    const onDown = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!KEYS.has(key) || isTyping(event.target)) return;
      held.add(key);
    };
    const onUp = (event: globalThis.KeyboardEvent) => held.delete(event.key.toLowerCase());
    const onBlur = () => held.clear();

    let raf = 0;
    const step = () => {
      const ctx = ctxRef.current;
      const orbit = controlsRef.current;
      if (ctx && orbit && held.size) {
        // Scale the step to how far out we are, so flying feels the same in a
        // desk-sized capture and a street.
        const pace = Math.max(0.02, ctx.camera.position.distanceTo(orbit.target) * 0.02);
        const forward = new THREE.Vector3();
        ctx.camera.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(forward, ctx.camera.up).normalize();
        const move = new THREE.Vector3();
        if (held.has('w')) move.add(forward);
        if (held.has('s')) move.sub(forward);
        if (held.has('d')) move.add(right);
        if (held.has('a')) move.sub(right);
        if (held.has('e')) move.y += 1;
        if (held.has('q')) move.y -= 1;
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(pace);
          // Move the target too, or the camera swings round instead of advancing.
          ctx.camera.position.add(move);
          orbit.target.add(move);
          orbit.update();
          forceReadout((n) => n + 1);
        }
      }
      raf = requestAnimationFrame(step);
    };
    step();

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [status]);

  // --- readouts ------------------------------------------------------------
  const primary = standIns[0];
  const ctx = ctxRef.current;
  // Against the scan's floor, so the readout is an eye height rather than a
  // world coordinate that can read negative.
  const cameraHeight = (ctx?.camera.position.y ?? 1.6) - (set.groundY ?? 0);
  const subjectDistance = primary && ctx
    ? ctx.camera.position.distanceTo(new THREE.Vector3(primary.x, (set.groundY ?? 0) + primary.heightM * 0.5, primary.z))
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
  }, [primary, set.groundY]);

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
            <h4>Scan</h4>
            <div className="set-viewer__buttons">
              <button type="button" className="set-viewer__add" data-testid="set-viewer-frame" onClick={frameScene}>
                Frame scene
              </button>
              <button
                type="button"
                className="set-viewer__add"
                data-testid="set-viewer-ground"
                title="Treat the current camera height as 1.6m above the floor"
                onClick={() => {
                  const live = ctxRef.current;
                  if (live) onSetChange?.({ groundY: live.camera.position.y - 1.6 });
                }}
              >
                Set floor here
              </button>
              <button
                type="button"
                className="set-viewer__add"
                data-testid="set-viewer-flip"
                title="Turn the scan the right way up"
                onClick={() => {
                  const [x, y, z] = set.rotationDeg ?? [0, 0, 0];
                  onSetChange?.({ rotationDeg: [(x + 180) % 360, y, z] });
                }}
              >
                Flip upright
              </button>
            </div>
            <label className="set-viewer__row">
              Up axis
              <select
                aria-label="Up axis"
                value={set.upAxis}
                onChange={(event) => onSetChange?.({ upAxis: event.target.value === 'z' ? 'z' : 'y' })}
              >
                <option value="y">Y up</option>
                <option value="z">Z up</option>
              </select>
            </label>
            {(['Pitch', 'Yaw', 'Roll'] as const).map((label, axis) => {
              const rotation = set.rotationDeg ?? [0, 0, 0];
              return (
                <label className="set-viewer__row" key={label}>
                  {label}
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={rotation[axis]}
                    aria-label={`${label} degrees`}
                    onChange={(event) => {
                      const next: [number, number, number] = [...rotation] as [number, number, number];
                      next[axis] = Number(event.target.value);
                      onSetChange?.({ rotationDeg: next });
                    }}
                  />
                  <b>{Math.round(rotation[axis])}°</b>
                </label>
              );
            })}
            <label className="set-viewer__row">
              Scale
              <input
                type="number" min={0.01} max={100} step={0.01} value={set.scaleToMeters}
                aria-label="Metres per scan unit"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) onSetChange?.({ scaleToMeters: next });
                }}
              />
            </label>
            <div className="set-viewer__lenses" role="group" aria-label="Navigation mode">
              {(['orbit', 'look'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`set-viewer__lens${navMode === mode ? ' is-active' : ''}`}
                  data-testid={`set-viewer-nav-${mode}`}
                  aria-pressed={navMode === mode}
                  onClick={() => setNavMode(mode)}
                >
                  {mode === 'orbit' ? 'Orbit' : 'Look'}
                </button>
              ))}
            </div>
            <p className="set-viewer__hint">
              {navMode === 'orbit'
                ? 'Drag orbits the scene · right-drag pans · scroll zooms'
                : 'Drag turns the camera where it stands · right-drag pans · scroll zooms'}
              <br />WASD moves, Q/E down and up.
            </p>
          </div>

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
