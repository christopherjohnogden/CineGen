import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { intersectFloor, standInPosition } from '@/lib/sets/floor';
import { LAYER_PLACEMENT_GUIDES, LAYER_STANDIN, syncStandIns, type SceneContext, type StandIn } from '@/lib/sets/scene';
import { useFloorGizmo, type FloorGizmoMode } from './use-floor-gizmo';
import { useStandInGizmo, type StandInGizmoMode } from './use-standin-gizmo';

export type PlacementMode = 'floor' | 'pick-floor' | 'standin' | null;
interface Options {
  ctx: SceneContext | null;
  orbit: OrbitControls | null;
  floor: THREE.Plane;
  origin: THREE.Vector3;
  orientation: THREE.Quaternion;
  mode: PlacementMode;
  selectedId: string | null;
  standIns: StandIn[];
  size: number;
  gizmoMode: FloorGizmoMode;
  standInGizmoMode: StandInGizmoMode;
  onUpdateStandIn: (id: string, update: Partial<StandIn>) => void;
  onSize: (size: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, position: THREE.Vector3) => void;
  onFloor: (floor: THREE.Plane, origin?: THREE.Vector3, orientation?: THREE.Quaternion) => void;
  onMode: (mode: PlacementMode) => void;
  onMessage: (message: string) => void;
}

/** Editing handles belong to a viewport-only layer, excluded from all exports. */
export function usePlacementTools(options: Options): void {
  const latest = useRef(options);
  latest.current = options;
  const { ctx, floor, origin, orientation, mode, selectedId, standIns, size } = options;
  useFloorGizmo({ ...options, enabled: mode === 'floor' });
  useStandInGizmo({ ctx, orbit: options.orbit, floor, enabled: mode === 'standin',
    standIn: standIns.find(entry => entry.id === selectedId && entry.visible !== false), mode: options.standInGizmoMode, onUpdate: options.onUpdateStandIn });

  useEffect(() => {
    if (!ctx || (!mode && !selectedId)) return;
    const guides = new THREE.Group();
    guides.name = 'Placement guides';
    const selected = standIns.find(s => s.id === selectedId && s.visible !== false);
    const center = origin;
    const orient = orientation;
    if (mode === 'floor') {
      const grid = new THREE.GridHelper(size, 20, 0xd4a054, 0xd4a054);
      grid.position.copy(center);
      grid.quaternion.copy(orient);
      const material = grid.material as THREE.LineBasicMaterial;
      material.transparent = true; material.opacity = .5; material.depthTest = false; material.depthWrite = false;
      guides.add(grid);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: 0xd4a054, opacity: .08, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      plane.position.copy(center);
      plane.quaternion.copy(orient).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      guides.add(plane);
    }
    if (selected && mode !== 'floor' && mode !== 'pick-floor') {
      // Show the actual selected figure through the scan while placing it.
      // A lone feet ring stayed visible even when the entire figure was hidden.
      const selection = new THREE.Group();
      selection.name = 'Selected stand-in preview';
      syncStandIns(selection, [selected], floor);
      const oldMaterials = new Set<THREE.Material>();
      const highlight = new THREE.MeshStandardMaterial({ color: 0xb7bdc5, roughness: .75, metalness: .05,
        emissive: 0xd4a054, emissiveIntensity: .06, transparent: true, opacity: 1, depthTest: true, depthWrite: true });
      selection.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) oldMaterials.add(material);
        node.material = highlight;
        // Draw the selected human after the splat, with its own depth so the
        // face, fingers and limbs shade correctly instead of overlapping flat fills.
        node.onBeforeRender = renderer => renderer.clearDepth();
      });
      oldMaterials.forEach(material => material.dispose());
      guides.add(selection);
    }
    guides.traverse(node => { node.layers.set(LAYER_PLACEMENT_GUIDES); node.renderOrder = 10000; });
    ctx.scene.add(guides);
    return () => {
      ctx.scene.remove(guides);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      guides.traverse(node => {
        if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
          geometries.add(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
        }
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    };
  }, [ctx, floor, origin, orientation, mode, selectedId, standIns, size]);

  useEffect(() => {
    if (!ctx) return;
    const canvas = ctx.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    raycaster.layers.enable(LAYER_STANDIN);
    let drag: { pointer: number; id?: string; offset: THREE.Vector3; enabled: boolean; damping: boolean } | null = null;
    const ray = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ctx.scene.updateMatrixWorld(true);
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), ctx.camera);
      return raycaster.ray;
    };
    const consume = (event: PointerEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      const current = latest.current;
      // Floor translations are handled exclusively by the axis gizmo.
      if (current.mode === 'floor') return;
      const pointerRay = ray(event);
      if (current.mode === 'pick-floor') {
        consume(event);
        const hit = ctx.splat ? raycaster.intersectObject(ctx.splat)[0] : undefined;
        if (hit) {
          current.onFloor(current.floor.clone().setFromNormalAndCoplanarPoint(current.floor.normal, hit.point), hit.point);
          current.onMode('floor');
          current.onMessage('Floor moved to the selected surface. Adjust its tilt if needed.');
        } else current.onMessage('No scan surface at that point. Click a visible patch of floor.');
        return;
      }
      let id = current.selectedId;
      const offset = new THREE.Vector3();
      const point = intersectFloor(pointerRay, current.floor);
      let object: THREE.Object3D | undefined = raycaster.intersectObjects(ctx.standInGroup.children, true)[0]?.object;
      while (object && !object.userData.standInId) object = object.parent ?? undefined;
      if (object) {
        id = object.userData.standInId as string;
        const entry = current.standIns.find(s => s.id === id);
        if (entry && point) offset.copy(standInPosition(entry, current.floor)).sub(point);
        current.onSelect(id); current.onMode('standin');
        if (current.mode !== 'standin' || current.selectedId !== id) { consume(event); return; }
      } else if (current.mode !== 'standin' || !id) return;

      // Rotating/sizing must never fall through to moving on the floor.
      if (current.standInGizmoMode !== 'move') { consume(event); return; }

      consume(event);
      if (!point) { current.onMessage('Aim below the horizon to place on the floor.'); return; }
      drag = { pointer: event.pointerId,
        id: id ?? undefined, offset, enabled: current.orbit?.enabled ?? true, damping: current.orbit?.enableDamping ?? false };
      if (current.orbit) {
        current.orbit.enableDamping = false;
        current.orbit.update();
        current.orbit.enabled = false;
      }
      canvas.setPointerCapture(event.pointerId);
      if (id) current.onMove(id, point.clone().add(offset));
    };
    const onMove = (event: PointerEvent) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      consume(event);
      const current = latest.current;
      const point = intersectFloor(ray(event), current.floor);
      if (point && drag.id) current.onMove(drag.id, point.add(drag.offset));
    };
    const end = (event?: PointerEvent) => {
      if (!drag || (event && event.pointerId !== drag.pointer)) return;
      const old = drag; drag = null;
      if (latest.current.orbit) {
        latest.current.orbit.enabled = old.enabled;
        latest.current.orbit.enableDamping = old.damping;
      }
      if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
      if (event) consume(event);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { end(); latest.current.onMode(null); }
    };
    const blur = () => end();
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove, true);
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', end, true);
    canvas.addEventListener('lostpointercapture', end, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => {
      end();
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', end, true);
      canvas.removeEventListener('pointercancel', end, true);
      canvas.removeEventListener('lostpointercapture', end, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', blur);
    };
  }, [ctx, mode, selectedId, options.standInGizmoMode]);
}
