import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LAYER_PLACEMENT_GUIDES, type SceneContext } from '@/lib/sets/scene';

export interface PlacementGizmoOptions {
  ctx: SceneContext | null;
  orbit: OrbitControls | null;
  enabled: boolean;
  name: string;
  mode: 'translate' | 'rotate' | 'scale';
  space: 'local' | 'world';
  axes: { x: boolean; y: boolean; z: boolean; xz?: boolean };
  origin: THREE.Vector3;
  orientation: THREE.Quaternion;
  value: number;
  onChange: (position: THREE.Vector3, orientation: THREE.Quaternion, value: number, axis: string | null) => void;
}

/** Keep one live TransformControls instance throughout a drag. React updates
 * the saved placement, while the controller retains its pointer/axis state. */
export function usePlacementGizmo(options: PlacementGizmoOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const live = useRef<{ anchor: THREE.Object3D; controls: TransformControls } | null>(null);

  useEffect(() => {
    const { ctx, enabled } = options;
    if (!ctx || !enabled) return;
    const canvas = ctx.renderer.domElement;
    const anchor = new THREE.Object3D();
    anchor.name = options.name;
    anchor.position.copy(latest.current.origin);
    anchor.quaternion.copy(latest.current.orientation);
    ctx.scene.add(anchor);
    const controls = new TransformControls(ctx.camera, canvas);
    // Own capture-phase input so camera controls never begin a competing drag.
    controls.disconnect();
    controls.setMode(options.mode);
    controls.setSpace(options.space);
    controls.setSize(.85);
    controls.setColors(0xee737e, options.mode === 'rotate' || options.mode === 'scale' ? 0xd4a054 : 0x78aaf0, 0x98c980, 0xd4a054);
    controls.showX = options.axes.x;
    controls.showY = options.axes.y;
    controls.showZ = options.axes.z;
    controls.showXY = controls.showYZ = false;
    controls.showXZ = options.axes.xz ?? false;
    controls.showE = controls.showXYZE = false;
    controls.attach(anchor);
    const helper = controls.getHelper();
    helper.name = `${options.name} gizmo`;
    helper.traverse(node => {
      node.layers.set(LAYER_PLACEMENT_GUIDES); node.renderOrder = 10001;
      if (options.mode === 'rotate' && node.name === 'Y' && node instanceof THREE.Mesh
        && node.material instanceof THREE.MeshBasicMaterial && node.material.color.getHex() === 0xd4a054
        && node.geometry instanceof THREE.TorusGeometry) {
        // A complete horizontal ring makes the turntable action distinct from
        // the two half-rings used for tilt. Keep the stock Y picker radius.
        node.geometry.dispose();
        node.geometry = new THREE.TorusGeometry(.5, .006, 6, 96).rotateX(Math.PI / 2);
      }
    });
    const raycaster = controls.getRaycaster();
    const oldMask = raycaster.layers.mask;
    raycaster.layers.set(LAYER_PLACEMENT_GUIDES);
    ctx.scene.add(helper);
    live.current = { anchor, controls };
    let activePointer: number | null = null;
    let cameraState: { orbit: OrbitControls; enabled: boolean; damping: boolean } | null = null;
    const oldCursor = canvas.style.cursor;
    let dragValue = latest.current.value;

    // Three's pointer methods take normalized x/y despite the PointerEvent
    // declaration; this mirrors TransformControls' own getPointer helper.
    const pointer = (event: PointerEvent, button = event.button) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width * 2 - 1,
        y: 1 - (event.clientY - rect.top) / rect.height * 2, button } as PointerEvent;
    };
    const consume = (event: PointerEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const change = () => {
      const current = latest.current;
      const scale = controls.axis === 'Z' ? anchor.scale.z : controls.axis === 'Y' ? anchor.scale.y : anchor.scale.x;
      current.onChange(anchor.position.clone(), anchor.quaternion.clone(), dragValue * scale, controls.axis);
    };
    controls.addEventListener('objectChange', change);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || activePointer !== null) return;
      ctx.scene.updateMatrixWorld(true);
      controls.pointerHover(pointer(event));
      if (!controls.axis) return;
      dragValue = latest.current.value;
      anchor.scale.setScalar(1);
      controls.pointerDown(pointer(event));
      if (!controls.dragging) return;
      consume(event);
      activePointer = event.pointerId;
      const orbit = latest.current.orbit;
      if (orbit) {
        cameraState = { orbit, enabled: orbit.enabled, damping: orbit.enableDamping };
        orbit.enableDamping = false; orbit.update(); orbit.enabled = false;
      }
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const move = (event: PointerEvent) => {
      if (activePointer !== null) {
        if (event.pointerId !== activePointer) return;
        consume(event);
        controls.pointerMove(pointer(event, -1));
      } else if (event.buttons === 0) {
        ctx.scene.updateMatrixWorld(true);
        controls.pointerHover(pointer(event));
        canvas.style.cursor = controls.axis ? 'grab' : oldCursor;
      }
    };
    const end = (event?: PointerEvent) => {
      if (activePointer === null || (event && event.pointerId !== activePointer)) return;
      const id = activePointer; activePointer = null;
      controls.pointerUp({ button: 0 } as PointerEvent);
      anchor.scale.setScalar(1);
      anchor.position.copy(latest.current.origin);
      anchor.quaternion.copy(latest.current.orientation);
      if (cameraState) {
        cameraState.orbit.enabled = cameraState.enabled;
        cameraState.orbit.enableDamping = cameraState.damping;
        cameraState = null;
      }
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      canvas.style.cursor = oldCursor;
      if (event) consume(event);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') end(); };
    const blur = () => end();
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', end, true);
    canvas.addEventListener('lostpointercapture', end, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => {
      end();
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', end, true);
      canvas.removeEventListener('pointercancel', end, true);
      canvas.removeEventListener('lostpointercapture', end, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', blur);
      controls.removeEventListener('objectChange', change);
      controls.detach(); controls.dispose();
      raycaster.layers.mask = oldMask;
      ctx.scene.remove(anchor, helper);
      canvas.style.cursor = oldCursor;
      live.current = null;
    };
  }, [options.ctx, options.enabled, options.mode, options.name]);

  useEffect(() => {
    if (live.current && !live.current.controls.dragging) {
      live.current.anchor.position.copy(options.origin);
      live.current.anchor.quaternion.copy(options.orientation);
    }
  }, [options.origin, options.orientation]);
}
