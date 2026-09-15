import * as THREE from 'three';
import { usePlacementGizmo, type PlacementGizmoOptions } from './use-placement-gizmo';

export type FloorGizmoMode = 'move' | 'tilt' | 'size';
interface Options extends Pick<PlacementGizmoOptions, 'ctx' | 'orbit' | 'enabled' | 'origin' | 'orientation'> {
  floor: THREE.Plane;
  gizmoMode: FloorGizmoMode;
  size: number;
  onSize: (size: number) => void;
  onFloor: (floor: THREE.Plane, origin: THREE.Vector3, orientation?: THREE.Quaternion) => void;
}

export function useFloorGizmo(options: Options): void {
  usePlacementGizmo({ ...options, name: 'Floor adjustment',
    mode: options.gizmoMode === 'move' ? 'translate' : options.gizmoMode === 'tilt' ? 'rotate' : 'scale',
    space: options.gizmoMode === 'tilt' ? 'local' : 'world',
    axes: { x: true, y: options.gizmoMode !== 'size', z: true }, value: options.size,
    onChange: (origin, orientation, size, axis) => {
      if (options.gizmoMode === 'size') {
        if (Number.isFinite(size)) options.onSize(THREE.MathUtils.clamp(size, .1, 200));
        return;
      }
      const normal = options.gizmoMode === 'tilt' && axis !== 'Y'
        ? new THREE.Vector3(0, 1, 0).applyQuaternion(orientation).normalize() : options.floor.normal;
      options.onFloor(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), origin, orientation);
    },
  });
}
