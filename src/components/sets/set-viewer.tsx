import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { readViewerSession, writeViewerSession } from '@/lib/sets/viewer-session';
import { ViewGizmo } from './view-gizmo';
import { FloorPlan } from './floor-plan';
import { installTrackpadNavigation, lookCameraInPlace, rotateCameraInPlace } from '@/lib/sets/navigation';
import { encodeStartView, resolveStartView } from '@/lib/sets/start-view';
import { loadPhotoStart } from '@/lib/sets/photo-start';
import { detectFloor, encodeFloor, floorControls, floorFromControls, floorHeightAt, resolveFloor, resolveFloorOrigin, resolveFloorOrientation, resolveFloorSize, sampleFloorPoints, startingStandInPosition, standInPosition, standInPlacement } from '@/lib/sets/floor';
import { usePlacementTools, type PlacementMode } from './use-placement-tools';
import type { FloorGizmoMode } from './use-floor-gizmo';
import type { StandInGizmoMode } from './use-standin-gizmo';

import type { ProjectSet, SetCamera, SetStartView, SetFloorPlane } from '@/types/sets';
import {
  FULL_FRAME,
  LENS_PRESETS,
  SENSOR_PRESETS,
  aspectRatio,
  diagonalFov,
  shotSize,
  verticalFov,
  type SensorSize,
} from '@/lib/sets/optics';
import {
  DEFAULT_SCAN_TUNING,
  applyCamera,
  applyScanTuning,
  applySetOrientation,
  createScene,
  renderPass,
  rgbaToPngBlob,
  syncStandIns,
  type PassKind,
  type SceneContext,
  type ScanTuning,
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
  cameraHeight(): number;
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
  sessionKey?: string;
}

const POSES: StandIn['pose'][] = ['standing', 'sitting', 'walking', 'kneeling'];

/** Explicit Show action only; placement and sizing must preserve the camera. */
function frameStandIn(ctx: SceneContext, orbit: OrbitControls, id: string): void {
  const figure = ctx.standInGroup.children.find(child => child.userData.standInId === id);
  if (!figure) return;
  const bounds = new THREE.Box3().setFromObject(figure);
  if (bounds.isEmpty()) return;
  ctx.camera.updateMatrixWorld(true);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  const vertical = THREE.MathUtils.degToRad(ctx.camera.fov / 2);
  const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * ctx.camera.aspect));
  const distance = radius / Math.sin(halfFov) * 1.2;
  const direction = ctx.camera.getWorldDirection(new THREE.Vector3());
  const damping = orbit.enableDamping;
  orbit.enableDamping = false; orbit.update();
  ctx.camera.position.copy(center).addScaledVector(direction, -distance);
  orbit.target.copy(center); orbit.update();
  orbit.enableDamping = damping;
}

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
  sessionKey,
}: SetViewerProps) {
  const [resume] = useState(() => readViewerSession(sessionKey));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelStateRef = useRef({ openSections: resume?.openSections ?? [], panelScroll: resume?.panelScroll ?? 0 });
  const saveSessionRef = useRef<() => void>(() => {});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<SceneContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [navMode, setNavMode] = useState<'orbit' | 'look' | 'pan'>(resume?.navMode ?? 'look');
  const [tuning, setTuning] = useState<ScanTuning>(resume?.tuning ?? DEFAULT_SCAN_TUNING);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [firstPhoto, setFirstPhoto] = useState<SetStartView | null>(null);
  const [floorOverride, setFloorOverride] = useState<SetFloorPlane | null>(null);
  const [placementMode, setPlacementMode] = useState<PlacementMode>(resume?.placementMode ?? null);
  const [selectedStandIn, setSelectedStandIn] = useState<string | null>(resume?.selectedStandIn ?? null);
  const [standInsOpen, setStandInsOpen] = useState(resume?.openSections?.includes('Stand-ins') ?? false);
  useEffect(() => { if (placementMode === 'standin') setStandInsOpen(true); }, [placementMode]);
  const [placementMessage, setPlacementMessage] = useState('');
  const [floorSize, setFloorSize] = useState(8);
  const [floorGizmoMode, setFloorGizmoMode] = useState<FloorGizmoMode>(resume?.floorGizmoMode ?? 'move');
  const [standInGizmoMode, setStandInGizmoMode] = useState<StandInGizmoMode>(resume?.standInGizmoMode ?? 'move');
  const guideSize = resolveFloorSize({ ...set, floorPlane: floorOverride ?? set.floorPlane }, floorSize);
  const [knownCameraHeight, setKnownCameraHeight] = useState(1.6);
  const [, forceReadout] = useState(0);
  const floor = useMemo(() => resolveFloor({ ...set, floorPlane: floorOverride ?? set.floorPlane }),
    [floorOverride, set.floorPlane, set.groundY, set.upAxis, set.rotationDeg, set.scaleToMeters]);

  const floorOrigin = useMemo(() => resolveFloorOrigin({ ...set, floorPlane: floorOverride ?? set.floorPlane }),
    [floorOverride, set.floorPlane, set.groundY, set.upAxis, set.rotationDeg, set.scaleToMeters]);

  const floorOrientation = useMemo(() => resolveFloorOrientation({ ...set, floorPlane: floorOverride ?? set.floorPlane }),
    [floorOverride, set.floorPlane, set.groundY, set.upAxis, set.rotationDeg, set.scaleToMeters]);

  const ratio = aspectRatio(aspect);

  // --- scene lifecycle -----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const abort = new AbortController();
    setFirstPhoto(null);
    setFloorOverride(null);
    setPlacementMode(resume?.placementMode ?? null);
    setSelectedStandIn(resume?.selectedStandIn ?? null);
    setPlacementMessage('');
    setStatus('loading');
    setMessage(splatUrl ? 'Loading scan…' : 'No scan imported yet.');

    Promise.all([createScene({ canvas, set, splatUrl }), loadPhotoStart(splatUrl, abort.signal)])
      .then(([ctx, photo]) => {
        if (disposed) { ctx.dispose(); return; }
        ctxRef.current = ctx;
        setFirstPhoto(photo);
        const points = sampleFloorPoints(ctx.splat);
        if (points.length) {
          const bounds = new THREE.Box3().setFromPoints(points);
          const extent = bounds.getSize(new THREE.Vector3());
          setFloorSize(Math.max(1, Math.min(40, Math.max(extent.x, extent.z))));
        }
        if (!set.floorPlane && set.groundY === undefined) {
          const start = resolveStartView(ctx.splat, set, false, photo);
          const detected = detectFloor(points, start.position[1]);
          if (detected) {
            const encoded = encodeFloor(detected, set, new THREE.Vector3(...start.target));
            setFloorOverride(encoded);
            onSetChange?.({ floorPlane: encoded, groundY: floorHeightAt(detected, 0, 0) });
            setPlacementMessage('Floor detected. Use Adjust floor to check its alignment.');
          } else if (ctx.splat) setPlacementMessage('No clear floor found. Use Auto-detect floor or adjust it manually.');
        }
        syncStandIns(ctx.standInGroup, standIns, resolveFloor(set));
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
      abort.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      saveSessionRef.current();
      ctxRef.current?.dispose();
      ctxRef.current = null;
    };
    // Rebuilding on a new scan or a new Set is intended; stand-ins sync separately.
  }, [set.id, splatUrl]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx) syncStandIns(ctx.standInGroup, standIns, floor);
  }, [standIns, floor, status]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx) applyScanTuning(ctx.spark, tuning);
  }, [tuning, status]);

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

    const start = resume?.camera ?? resolveStartView(ctx.splat, set, false, firstPhoto);
    ctx.camera.position.set(...start.position);
    ctx.camera.up.set(...(start.up ?? [0, 1, 0]));
    ctx.camera.near = 0.01;
    if (resume) { onFocalChange?.(resume.focalMm); onSensorChange?.(resume.sensor); }
    if (!resume && start.verticalFov !== undefined) {
      ctx.camera.fov = start.verticalFov;
      onFocalChange?.(sensor.heightMm / (2 * Math.tan(THREE.MathUtils.degToRad(start.verticalFov / 2))));
    }
    if (resume) ctx.camera.fov = verticalFov(resume.focalMm, resume.sensor);
    ctx.camera.updateProjectionMatrix();
    const controls = new OrbitControls(ctx.camera, canvas);
    controls.target.set(...start.target);
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
    controls.minPolarAngle = 0.0001;
    controls.maxPolarAngle = Math.PI - 0.0001;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const removeTrackpadNavigation = installTrackpadNavigation(controls, canvas);
    controls.addEventListener('change', () => forceReadout((n) => n + 1));
    controlsRef.current = controls;
    controls.update();

    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.removeEventListener('contextmenu', onContextMenu);
      removeTrackpadNavigation();
      controls.dispose();
      controlsRef.current = null;
    };
  }, [status]);

  useEffect(() => {
    const orbit = controlsRef.current;
    if (!orbit || status !== 'ready') return;
    // Clear old orbit momentum before switching to a stationary camera mode.
    orbit.enableDamping = false;
    orbit.update();
    orbit.enableDamping = navMode === 'orbit';
    orbit.mouseButtons.LEFT = navMode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }, [navMode, status]);

  saveSessionRef.current = () => {
    const live = ctxRef.current, orbit = controlsRef.current;
    if (!sessionKey || status !== 'ready' || !live || !orbit) return;
    const panel = panelRef.current;
    if (panel) panelStateRef.current = {
      openSections: Array.from(panel.querySelectorAll('details[open]')).map(section => section.querySelector('summary')?.firstChild?.textContent?.trim() ?? ''),
      panelScroll: panel.scrollTop,
    };
    writeViewerSession(sessionKey, {
      camera: { position: live.camera.position.toArray(), target: orbit.target.toArray(),
        up: live.camera.up.toArray(), verticalFov: live.camera.fov },
      focalMm, sensor, navMode, tuning, placementMode, selectedStandIn, floorGizmoMode, standInGizmoMode,
      ...panelStateRef.current,
    });
  };
  useEffect(() => {
    if (status !== 'ready' || !sessionKey) return;
    const panel = panelRef.current;
    if (resume && panel) {
      panel.querySelectorAll('details').forEach(section => {
        section.open = (resume.openSections ?? []).includes(section.querySelector('summary')?.firstChild?.textContent?.trim() ?? '');
      });
      panel.scrollTop = resume.panelScroll ?? 0;
    }
    const orbit = controlsRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = () => { clearTimeout(timer); timer = setTimeout(() => saveSessionRef.current(), 200); };
    const flush = () => saveSessionRef.current();
    orbit?.addEventListener('change', queue);
    panel?.addEventListener('toggle', flush, true);
    panel?.addEventListener('scroll', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer); flush();
      orbit?.removeEventListener('change', queue);
      panel?.removeEventListener('toggle', flush, true);
      panel?.removeEventListener('scroll', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [status, sessionKey]);
  useEffect(() => { saveSessionRef.current(); }, [focalMm, sensor, navMode, tuning, placementMode, selectedStandIn, floorGizmoMode, standInGizmoMode]);

  const goToStart = (automatic = false, photo?: SetStartView) => {
    const ctx = ctxRef.current, orbit = controlsRef.current;
    if (!ctx || !orbit) return;
    const view = resolveStartView(ctx.splat, photo ? { ...set, startView: photo } : set, automatic, firstPhoto);
    const damping = orbit.enableDamping;
    orbit.enableDamping = false;
    orbit.update();
    ctx.camera.position.set(...view.position);
    ctx.camera.up.set(...(view.up ?? [0, 1, 0]));
    if (view.verticalFov !== undefined) {
      ctx.camera.fov = view.verticalFov;
      ctx.camera.updateProjectionMatrix();
      onFocalChange?.(sensor.heightMm / (2 * Math.tan(THREE.MathUtils.degToRad(view.verticalFov / 2))));
    }
    orbit.target.set(...view.target);
    orbit.update();
    orbit.enableDamping = damping;
    setNavMode('look');
    forceReadout((n) => n + 1);
  };

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
      if (!controls.enabled || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const ctx = ctxRef.current;
      const orbit = controlsRef.current;
      if (!ctx || !orbit || !orbit.enabled) return;

      lookCameraInPlace(orbit, event.clientX - lastX, event.clientY - lastY);
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
    ctx.camera.up.set(0, 1, 0);
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
      if (!KEYS.has(key) || isTyping(event.target) || placementMode) return;
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
  }, [status, placementMode]);

  // --- readouts ------------------------------------------------------------
  const primary = standIns.find(entry => entry.visible !== false);
  const ctx = ctxRef.current;
  // Against the scan's floor, so the readout is an eye height rather than a
  // world coordinate that can read negative.
  const cameraHeight = floor.distanceToPoint(ctx?.camera.position ?? new THREE.Vector3(0, 1.6, 0));
  const subjectDistance = primary && ctx
    ? ctx.camera.position.distanceTo(standInPosition(primary, floor).addScaledVector(floor.normal, primary.heightM * .5))
    : undefined;
  const tilt = ctx
    ? THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(
      new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion).y, -1, 1,
    )))
    : 0;

  const subjectFrameX = useCallback((): number | undefined => {
    const live = ctxRef.current;
    if (!live || !primary) return undefined;
    const point = standInPosition(primary, floor).addScaledVector(floor.normal, primary.heightM * .5).project(live.camera);
    return (point.x + 1) / 2;
  }, [primary, floor]);

  useImperativeHandle(handleRef, (): SetViewerHandle => ({
    async capture(kinds, width, height) {
      const live = ctxRef.current;
      if (!live) throw new Error('The Set viewer is not ready yet.');
      const out: Record<string, Blob> = {};
      // Sequential on purpose — the passes share one scene and one GL context.
      for (const kind of kinds) {
        const { data } = await renderPass(live, kind, width, height, tuning);
        out[kind] = await rgbaToPngBlob(data, width, height);
      }
      return out;
    },
    readCamera(name) {
      const live = ctxRef.current;
      const position = live ? live.camera.position : new THREE.Vector3(0, 1.6, 4);
      const lookAt = controlsRef.current?.target
        ?? (live ? live.camera.getWorldDirection(new THREE.Vector3()).add(position) : new THREE.Vector3(0, 1.2, 0));
      return {
        id: generateId(),
        name,
        createdAt: new Date().toISOString(),
        position: [position.x, position.y, position.z],
        target: [lookAt.x, lookAt.y, lookAt.z],
        up: live ? [live.camera.up.x, live.camera.up.y, live.camera.up.z] : [0, 1, 0],
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
    cameraHeight: () => cameraHeight,
  }), [aspect, focalMm, sensor, subjectDistance, subjectFrameX, cameraHeight, tuning]);

  const updateStandIn = (id: string, updates: Partial<StandIn>) => {
    onStandInsChange?.(standIns.map(entry => {
      if (entry.id !== id) return entry;
      if (!updates.position && (updates.x !== undefined || updates.z !== undefined)) {
        const position = standInPosition(entry, floor);
        if (updates.x !== undefined) position.x = updates.x;
        if (updates.z !== undefined) position.z = updates.z;
        return { ...entry, ...updates, ...standInPlacement(position, floor) };
      }
      return { ...entry, ...updates };
    }));
  };

  const changeFloor = (plane: THREE.Plane, origin = floorOrigin, size = guideSize, orientation = floorOrientation) => {
    const encoded = encodeFloor(plane, set, origin, size, orientation);
    setFloorOverride(encoded);
    onSetChange?.({ floorPlane: encoded, groundY: floorHeightAt(plane, 0, 0) });
  };
  const detectCurrentFloor = () => {
    if (!ctx) return;
    const detected = detectFloor(sampleFloorPoints(ctx.splat), ctx.camera.position.y);
    if (detected) {
      changeFloor(detected, startingStandInPosition(ctx.camera, detected));
      setPlacementMode('floor');
      setPlacementMessage('Floor detected. Check the gold grid against the scan.');
    } else {
      setPlacementMode('floor');
      setPlacementMessage('No clear floor found. Pick a visible floor point or adjust the plane.');
    }
  };
  const beginFloorEdit = () => {
    if (ctx && !(floorOverride ?? set.floorPlane)?.origin) changeFloor(floor, startingStandInPosition(ctx.camera, floor));
    setPlacementMode('floor');
  };
  const floorValues = floorControls(floor);
  usePlacementTools({ ctx: status === 'ready' ? ctx : null, orbit: controlsRef.current, floor, origin: floorOrigin, mode: placementMode,
    selectedId: selectedStandIn, standIns, size: guideSize, gizmoMode: floorGizmoMode, orientation: floorOrientation,
    standInGizmoMode, onUpdateStandIn: updateStandIn,
    onSize: size => changeFloor(floor, floorOrigin, size),
    onSelect: setSelectedStandIn, onMove: (id, position) => updateStandIn(id, standInPlacement(position, floor)),
    onFloor: (plane, origin, orientation) => changeFloor(plane, origin, guideSize, orientation), onMode: setPlacementMode, onMessage: setPlacementMessage });

  const nudgeStandIn = (entry: StandIn, dx: number, dz: number) => {
    if (!ctx) return;
    const forward = ctx.camera.getWorldDirection(new THREE.Vector3());
    forward.addScaledVector(floor.normal, -forward.dot(floor.normal));
    if (forward.lengthSq() < .001) forward.set(0, 0, -1).applyQuaternion(floorOrientation);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, floor.normal).normalize();
    const delta = right.multiplyScalar(dx * .1).addScaledVector(forward, dz * .1);
    updateStandIn(entry.id, standInPlacement(standInPosition(entry, floor).add(delta), floor));
    setSelectedStandIn(entry.id);
  };
  const calibrateScale = () => {
    const orbit = controlsRef.current;
    if (!ctx || !orbit || !onSetChange || cameraHeight <= .001) return;
    const factor = knownCameraHeight / cameraHeight;
    const floorPlane = encodeFloor(floor, set, floorOrigin, guideSize, floorOrientation);
    const scaleToMeters = set.scaleToMeters * factor;
    const moved = standIns.map(entry => ({ ...entry, x: entry.x * factor, z: entry.z * factor,
      ...(entry.position ? { position: entry.position.map(value => value * factor) as [number, number, number] } : {}) }));
    // Keep the framing while converting the scan and its placements to meters.
    const damping = orbit.enableDamping;
    orbit.enableDamping = false; orbit.update();
    ctx.camera.position.multiplyScalar(factor); orbit.target.multiplyScalar(factor); orbit.update();
    orbit.enableDamping = damping;
    setFloorOverride(floorPlane);
    setFloorSize(size => size * factor);
    onStandInsChange?.(moved);
    onSetChange({ scaleToMeters, floorPlane, groundY: floorValues.height * factor, ...(set.standIns ? { standIns: moved } : {}) });
    setPlacementMessage(`Scale set using a camera height of ${knownCameraHeight.toFixed(2)} m.`);
  };

  return (
    <div className="set-viewer" data-testid="set-viewer">
      <div className="set-viewer__stage">
        <div
          className="set-viewer__frame"
          ref={frameRef}
          style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : 'auto', height: ratio >= 1 ? 'auto' : '100%' }}
        >
          <canvas className="set-viewer__canvas" data-placement={placementMode ?? undefined} ref={canvasRef} />
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
        {placementMode && <div className="set-viewer__placement-bar">
          <span>{placementMode === 'floor' ? 'Floor'
            : placementMode === 'pick-floor' ? 'Click a visible floor surface'
              : 'Stand-in'}</span>
          {placementMode === 'floor' && <div className="set-viewer__floor-modes" role="group" aria-label="Floor adjustment mode">
            {(['move', 'tilt', 'size'] as const).map(mode => <button type="button" key={mode}
              aria-pressed={floorGizmoMode === mode} onClick={() => setFloorGizmoMode(mode)}>
              {mode === 'move' ? 'Move' : mode === 'tilt' ? 'Tilt' : 'Size'}
            </button>)}
          </div>}
          {placementMode === 'standin' && <div className="set-viewer__floor-modes" role="group" aria-label="Stand-in adjustment mode">
            {(['move', 'rotate', 'size'] as const).map(mode => <button type="button" key={mode}
              aria-pressed={standInGizmoMode === mode} onClick={() => setStandInGizmoMode(mode)}>
              {mode === 'move' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Size'}
            </button>)}
          </div>}
          <button type="button" onClick={() => setPlacementMode(null)}>Done</button>
        </div>}
        {status === 'ready' && ctx && (
          <div className="set-viewer__navigation">
            <ViewGizmo quaternion={ctx.camera.quaternion} onRotate={(axis, radians) => {
              const orbit = controlsRef.current;
              if (orbit) rotateCameraInPlace(orbit, axis, radians);
            }} />
            <div className="set-viewer__nav-modes" role="group" aria-label="Navigation mode">
              {(['look', 'pan', 'orbit'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`set-viewer__lens${navMode === mode ? ' is-active' : ''}`}
                  data-testid={`set-viewer-nav-${mode}`}
                  aria-pressed={navMode === mode}
                  onClick={() => setNavMode(mode)}
                >
                  {mode === 'orbit' ? 'Orbit' : mode === 'pan' ? 'Pan' : 'Look'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {controls && (
        <div className="set-viewer__panel" ref={panelRef}>
          <details className="set-viewer__section" open>
            <summary>Lens</summary>
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
                value={Number(focalMm.toFixed(2))}
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
          </details>

          <details className="set-viewer__section">
            <summary>Saved angles <span>{set.cameras.length}</span></summary>
            {set.cameras.length === 0 && <p className="set-viewer__hint">Sending a shot to Studio saves its camera here.</p>}
            {set.cameras.map(camera => <button key={camera.id} type="button" className="set-viewer__add" disabled={status !== 'ready'}
              onClick={() => {
                const live = ctxRef.current, orbit = controlsRef.current;
                if (!live || !orbit) return;
                const damping = orbit.enableDamping; orbit.enableDamping = false; orbit.update();
                const savedSensor = { widthMm: camera.sensorWidthMm, heightMm: camera.sensorHeightMm, name: 'Saved sensor' };
                applyCamera(live.camera, { ...camera, aspect }, savedSensor);
                orbit.target.set(...camera.target); orbit.update(); orbit.enableDamping = damping;
                onFocalChange?.(camera.focalMm); onSensorChange?.(savedSensor);
                forceReadout(n => n + 1);
              }}>{camera.name}</button>)}
          </details>
          <details className="set-viewer__section" open={standInsOpen} onToggle={event => setStandInsOpen(event.currentTarget.open)}>
            <summary>Stand-ins <span>{standIns.length}</span></summary>
            {standIns.map((entry) => (
              <div className={`set-viewer__standin${selectedStandIn === entry.id ? ' is-selected' : ''}`} key={entry.id}>
                <div className="set-viewer__standin-head">
                  <span>{entry.label ?? 'Stand-in'}{entry.visible === false ? ' · Hidden' : ''}</span>
                  <button type="button" className="set-viewer__remove" disabled={!onStandInsChange}
                    aria-label={`${entry.visible === false ? 'Show' : 'Hide'} ${entry.label ?? 'stand-in'}`}
                    onClick={() => {
                      updateStandIn(entry.id, { visible: entry.visible === false });
                      if (entry.visible !== false && selectedStandIn === entry.id) { setSelectedStandIn(null); setPlacementMode(null); }
                    }}>{entry.visible === false ? 'Show' : 'Hide'}</button>
                  <button
                    type="button"
                    className="set-viewer__remove"
                    aria-label={`Remove ${entry.label ?? 'stand-in'}`}
                    onClick={() => {
                      onStandInsChange?.(standIns.filter((s) => s.id !== entry.id));
                      if (selectedStandIn === entry.id) { setSelectedStandIn(null); setPlacementMode(null); }
                    }}
                  >
                    Remove
                  </button>
                </div>
                <div className="set-viewer__standin-controls" hidden={entry.visible === false}>
                <div className="set-viewer__buttons">
                <button type="button" className="set-viewer__add" disabled={!onStandInsChange || status !== 'ready'}
                  aria-label={`Move ${entry.label ?? 'stand-in'}`}
                  aria-pressed={placementMode === 'standin' && selectedStandIn === entry.id}
                  onClick={() => { setSelectedStandIn(entry.id); setStandInGizmoMode('move'); setPlacementMode('standin'); }}>Move</button>
                <button type="button" className="set-viewer__add" disabled={status !== 'ready'} aria-label={`Focus ${entry.label ?? 'stand-in'}`}
                  onClick={() => {
                    setSelectedStandIn(entry.id); setPlacementMode('standin');
                    if (ctx && controlsRef.current) frameStandIn(ctx, controlsRef.current, entry.id);
                  }}>Focus</button>
                </div>
                <button type="button" className="set-viewer__add" disabled={!onStandInsChange || status !== 'ready'}
                  aria-label={`Center ${entry.label ?? 'stand-in'} on floor`} onClick={() => {
                    updateStandIn(entry.id, standInPlacement(floorOrigin, floor));
                    setSelectedStandIn(entry.id); setPlacementMode('standin');
                  }}>Center on floor</button>
                <div className="set-viewer__nudge" role="group" aria-label={`Move ${entry.label ?? 'stand-in'} in 10 cm steps`}>
                  {([['Left', -1, 0], ['Forward', 0, 1], ['Back', 0, -1], ['Right', 1, 0]] as const).map(([label, dx, dz]) => <button
                    key={label} type="button" className="set-viewer__add" disabled={!onStandInsChange || status !== 'ready'}
                    aria-label={`${entry.label ?? 'Stand-in'} ${label.toLowerCase()}`} onClick={() => nudgeStandIn(entry, dx, dz)}>{label}</button>)}
                </div>
                <div className="set-viewer__buttons">
                  {(['x', 'z'] as const).map(axis => <label className="set-viewer__row" key={axis}>{axis.toUpperCase()}
                    <input type="number" step={.1} value={Number(entry[axis].toFixed(3))} aria-label={`${entry.label ?? 'Stand-in'} ${axis} position`}
                      onChange={event => { const value = Number(event.target.value); if (event.target.value && Number.isFinite(value)) updateStandIn(entry.id, { [axis]: value }); }} />
                  </label>)}
                </div>
                <label className="set-viewer__row">
                  Height
                  <input
                    type="number" min={0.01} max={10} step={0.01} value={entry.heightM}
                    aria-label={`${entry.label ?? 'Stand-in'} height in metres`}
                    onChange={(event) => { const height = Number(event.target.value); if (Number.isFinite(height) && height > 0) updateStandIn(entry.id, { heightM: THREE.MathUtils.clamp(height, .01, 10) }); }}
                  />
                </label>
                <div className="set-viewer__buttons" role="group" aria-label={`Resize ${entry.label ?? 'stand-in'}`}>
                  <button type="button" className="set-viewer__add" disabled={!onStandInsChange || entry.heightM <= .01}
                    onClick={() => updateStandIn(entry.id, { heightM: Math.max(.01, Number((entry.heightM * .8).toFixed(4))) })}>Smaller</button>
                  <button type="button" className="set-viewer__add" disabled={!onStandInsChange || entry.heightM >= 10}
                    onClick={() => updateStandIn(entry.id, { heightM: Math.min(10, Number((entry.heightM * 1.25).toFixed(4))) })}>Larger</button>
                </div>
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
              </div>
            ))}
            <button
              type="button"
              className="set-viewer__add"
              data-testid="set-viewer-add-standin"
              disabled={!onStandInsChange || status !== 'ready'}
              onClick={() => {
                if (!ctx) return;
                const position = (floorOverride ?? set.floorPlane)?.origin ? floorOrigin : startingStandInPosition(ctx.camera, floor);
                const id = generateId();
                onStandInsChange?.([...standIns, { id, heightM: 1.8, pose: 'standing', ...standInPlacement(position, floor), facing: 0, label: `Stand-in ${standIns.length + 1}` }]);
                setSelectedStandIn(id); setPlacementMode('standin');
              }}
            >
              Add stand-in
            </button>
          </details>
          <details className="set-viewer__section" open={placementMode === 'floor' || placementMode === 'pick-floor' || undefined}>
            <summary>Floor</summary>
            <div className="set-viewer__buttons">
              <button type="button" className="set-viewer__add" disabled={status !== 'ready' || !ctx?.splat} onClick={detectCurrentFloor}>Auto-detect floor</button>
              <button type="button" className="set-viewer__add" disabled={status !== 'ready'} aria-pressed={placementMode === 'floor'} onClick={() => placementMode === 'floor' ? setPlacementMode(null) : beginFloorEdit()}>Adjust floor</button>
            </div>
            <p className="set-viewer__hint" role="status">{placementMessage || 'Stand-ins stay attached to this floor.'}</p>
            {cameraHeight > 0 && cameraHeight < .6 && <p className="set-viewer__hint">This scan may need scale calibration. Use a known camera height below to size the stand-ins.</p>}
            {onSetChange && <details className="set-viewer__scan-setup">
              <summary>Calibrate room scale</summary>
              <p className="set-viewer__hint">At a known camera position, enter its real height above the floor.</p>
              <label className="set-viewer__row">Camera height
                <input type="number" min={.1} max={20} step={.05} aria-label="Known camera height in meters" value={knownCameraHeight}
                  onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) setKnownCameraHeight(value); }} />
                <span>m</span>
              </label>
              <button type="button" className="set-viewer__add" disabled={status !== 'ready' || cameraHeight <= .001} onClick={calibrateScale}>Set room scale</button>
            </details>}
            {(placementMode === 'floor' || placementMode === 'pick-floor') && <>
              <button type="button" className="set-viewer__add" disabled={!ctx?.splat} aria-pressed={placementMode === 'pick-floor'} onClick={() => setPlacementMode(placementMode === 'pick-floor' ? 'floor' : 'pick-floor')}>Pick floor point</button>
              {(['height', 'pitch', 'roll'] as const).map(key => <label className="set-viewer__row" key={key}>
                {key === 'height' ? 'Height' : key === 'pitch' ? 'Tilt forward' : 'Tilt sideways'}
                <input type="number" aria-label={`Floor ${key}`} step={key === 'height' ? .01 : .5}
                  min={key === 'height' ? undefined : -89.9} max={key === 'height' ? undefined : 89.9}
                  value={Number(floorValues[key].toFixed(3))}
                  onChange={event => {
                    if (!event.target.value) return;
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    const next = { ...floorValues, [key]: key === 'height' ? value : THREE.MathUtils.clamp(value, -89.9, 89.9) };
                    const plane = floorFromControls(next.height, next.pitch, next.roll);
                    if (key !== 'height') plane.setFromNormalAndCoplanarPoint(plane.normal, floorOrigin);
                    changeFloor(plane);
                  }} />
                <span>{key === 'height' ? 'm' : '°'}</span>
              </label>)}
              <label className="set-viewer__row">Floor size
                <input type="number" aria-label="Floor guide size" min={.1} max={200} step={.1}
                  value={Number(guideSize.toFixed(3))} onChange={event => {
                    if (!event.target.value) return;
                    const size = Number(event.target.value);
                    if (Number.isFinite(size)) changeFloor(floor, floorOrigin, THREE.MathUtils.clamp(size, .1, 200));
                  }} /><span>m</span>
              </label>
              <p className="set-viewer__hint">Move: drag an arrow. Tilt: the gold ring spins the floor horizontally while keeping its slope; the other rings adjust tilt. Size: drag a square handle to resize the floor guide. Escape finishes editing.</p>
            </>}
          </details>

          <details className="set-viewer__section">
            <summary>Scan</summary>
            <div className="set-viewer__buttons">
              <button type="button" className="set-viewer__add" disabled={status !== 'ready'} onClick={() => goToStart()}>Go to start</button>
              {onSetChange && <button type="button" className="set-viewer__add" disabled={status !== 'ready'} onClick={() => {
                const live = ctxRef.current, orbit = controlsRef.current;
                if (!live || !orbit) return;
                onSetChange({ startView: encodeStartView({ position: live.camera.position.toArray(), target: orbit.target.toArray(), up: live.camera.up.toArray(), verticalFov: live.camera.fov }, live.splat) });
              }}>Save starting view</button>}
            </div>
            <p className="set-viewer__hint">{set.startView?.sourceImage ? `Starts at ${set.startView.sourceImage}.` : set.startView ? 'Opens at your saved starting view.' : firstPhoto ? `Starts at the first aligned photo: ${firstPhoto.sourceImage ?? 'original capture'}.` : 'Opens at an estimated viewpoint inside the scan.'}</p>
            {firstPhoto && <button type="button" className="set-viewer__add" disabled={status !== 'ready'} onClick={() => {
              goToStart(false, firstPhoto);
              onSetChange?.({ startView: firstPhoto });
            }}>Use first photo</button>}
            <button type="button" className="set-viewer__add" disabled={status !== 'ready'} onClick={() => {
              goToStart(true);
            }}>Find an inside view</button>
            <details className="set-viewer__scan-setup">
              <summary>Scan setup</summary>
              <p className="set-viewer__hint">Align and scale the scan in the scene.</p>
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
                    if (live) changeFloor(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(live.camera.position.y - 1.6)));
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
            </details>
          </details>

          <details className="set-viewer__section">
            <summary>Detail</summary>
            <label className="set-viewer__row">
              Scan filtering
              <select
                aria-label="Scan filtering"
                value={tuning.preBlurAmount > 0 ? 'standard' : 'mip'}
                onChange={(event) => setTuning((current) => ({
                  ...current,
                  preBlurAmount: event.target.value === 'standard' ? 0.3 : 0,
                  blurAmount: event.target.value === 'standard' ? 0 : 0.1,
                }))}
              >
                <option value="standard">Standard 3DGS (Spirula)</option>
                <option value="mip">Antialiased / Mip</option>
              </select>
            </label>
            <p className="set-viewer__hint">Match the scan’s training mode. Standard suits Spirula’s 3DGS exports.</p>
            {([
              ['Splat cap', 'maxPixelRadius', 128, 2048, 16, 'Maximum radius in pixels. Reducing it can shrink surfaces and open gaps.'],
              ['Extra smoothing', 'blurAmount', 0, 0.6, 0.05, 'Opacity-compensated smoothing. Standard 3DGS already has its training filter applied.'],
              ['Extent', 'maxStdDev', 2, 4, 0.01, 'Gaussian coverage. Reducing it cuts soft edges and can create patches.'],
              ['Min alpha', 'minAlpha', 0, 0.05, 0.001, 'Cull faint splats. Raising it removes overlap and can create patches.'],
            ] as const).map(([label, key, min, max, step, hint]) => (
              <label className="set-viewer__row" key={key} title={hint}>
                {label}
                <input
                  type="range" min={min} max={max} step={step}
                  value={tuning[key]}
                  aria-label={`${label}: ${hint}`}
                  onChange={(event) => setTuning((current) => ({ ...current, [key]: Number(event.target.value) }))}
                />
                <b>{tuning[key] >= 10 ? Math.round(tuning[key]) : tuning[key].toFixed(2)}</b>
              </label>
            ))}
            <button
              type="button"
              className="set-viewer__add"
              data-testid="set-viewer-reset-tuning"
              onClick={() => setTuning(DEFAULT_SCAN_TUNING)}
            >
              Reset detail
            </button>
          </details>

          <FloorPlan set={set} standIns={standIns} />

        </div>
      )}
    </div>
  );
}

export default SetViewer;
