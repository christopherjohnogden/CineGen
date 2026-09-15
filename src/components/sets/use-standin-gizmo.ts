import * as THREE from 'three';
import type { StandIn } from '@/lib/sets/scene';
import { standInPosition, standInPlacement } from '@/lib/sets/floor';
import { usePlacementGizmo, type PlacementGizmoOptions } from './use-placement-gizmo';

export type StandInGizmoMode = 'move' | 'rotate' | 'size';
interface Options extends Pick<PlacementGizmoOptions, 'ctx' | 'orbit' | 'enabled'> {
  floor: THREE.Plane;
  standIn?: StandIn;
  mode: StandInGizmoMode;
  onUpdate: (id: string, update: Partial<StandIn>) => void;
}

export function useStandInGizmo({ standIn, floor, mode, onUpdate, ...options }: Options): void {
  // Match syncStandIns exactly: floor alignment followed by the figure's facing.
  const up = floor.normal.clone();
  if (up.y < 0) up.negate();
  const floorRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  const orientation = floorRotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), standIn?.facing ?? 0));
  const origin = standIn ? standInPosition(standIn, floor) : new THREE.Vector3();
  usePlacementGizmo({ ...options, enabled: options.enabled && Boolean(standIn),
    name: `Stand-in ${standIn?.id ?? ''}`, origin, orientation,
    mode: mode === 'move' ? 'translate' : mode === 'rotate' ? 'rotate' : 'scale',
    space: 'local', axes: { x: mode === 'move', y: mode !== 'move', z: mode === 'move', xz: mode === 'move' },
    value: standIn?.heightM ?? 1.8,
    onChange: (position, rotation, height) => {
      if (!standIn) return;
      if (mode === 'move') onUpdate(standIn.id, standInPlacement(position, floor));
      else if (mode === 'size') {
        if (Number.isFinite(height)) onUpdate(standIn.id, { heightM: THREE.MathUtils.clamp(height, .01, 10) });
      } else {
        const relative = floorRotation.clone().invert().multiply(rotation);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(relative);
        onUpdate(standIn.id, { facing: THREE.MathUtils.euclideanModulo(Math.atan2(forward.x, forward.z), Math.PI * 2) });
      }
    },
  });
}
