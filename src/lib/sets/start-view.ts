import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { ProjectSet, SetStartView } from '@/types/sets';

/** Estimate an interior camera from splat centers, ignoring sparse outliers.
 * This is a room heuristic, not a reconstruction of walkable space. */
export function estimateInteriorView(points: THREE.Vector3[], groundY?: number): SetStartView {
  const finite = points.filter((p) => p.toArray().every(Number.isFinite));
  if (finite.length < 4) return { position: [0, 1.6, 0], target: [0, 1.6, -3], up: [0, 1, 0] };
  const quantile = (axis: 'x' | 'y' | 'z', fraction: number) => {
    const values = finite.map((p) => p[axis]).sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * fraction)];
  };
  const min = new THREE.Vector3(quantile('x', 0.03), quantile('y', 0.03), quantile('z', 0.03));
  const max = new THREE.Vector3(quantile('x', 0.97), quantile('y', 0.97), quantile('z', 0.97));
  const size = max.clone().sub(min), center = min.clone().add(max).multiplyScalar(0.5);
  const floor = groundY ?? min.y;
  const eye = THREE.MathUtils.clamp(floor + Math.min(1.6, size.y * 0.55), min.y + size.y * 0.15, max.y - size.y * 0.15);
  const preferred = new THREE.Vector3(center.x, eye, center.z + size.z * 0.18);
  const obstacles = finite.filter((p) => Math.abs(p.y - eye) < Math.max(0.25, size.y * 0.12));
  let position = preferred.clone(), best = -Infinity;
  // Search the central portion for clearance from walls and furniture. A small
  // center bias prevents a doorway or an unscanned corner winning by accident.
  for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++) {
    const candidate = new THREE.Vector3(min.x + size.x * (0.25 + x / 12), eye, min.z + size.z * (0.25 + z / 12));
    let clearance = Math.min(candidate.x - min.x, max.x - candidate.x, candidate.z - min.z, max.z - candidate.z);
    for (const p of obstacles) clearance = Math.min(clearance, Math.hypot(p.x - candidate.x, p.z - candidate.z));
    const score = clearance - candidate.distanceTo(preferred) * 0.25;
    if (score > best) { best = score; position = candidate; }
  }
  // Many trainers register the first capture near the origin. Prefer that
  // actual capture region when it is interior and clear of sampled surfaces,
  // especially for scans whose arbitrary units have not been calibrated yet.
  const origin = new THREE.Vector3(0, groundY === undefined ? 0 : eye, 0);
  const margin = size.clone().multiplyScalar(0.05);
  const interior = new THREE.Box3(min.clone().add(margin), max.clone().sub(margin));
  const clearance = Math.min(...finite.map((p) => p.distanceTo(origin)));
  if (interior.containsPoint(origin) && clearance > Math.min(size.x, size.y, size.z) * 0.1) position = origin;
  const distance = Math.max(0.5, Math.max(size.x, size.z) * 0.4);
  const direction = size.x > size.z * 1.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
  return { position: position.toArray(), target: position.clone().addScaledVector(direction, distance).toArray(), up: [0, 1, 0] };
}

function transformView(view: SetStartView, matrix: THREE.Matrix4): SetStartView {
  return {
    ...view,
    position: new THREE.Vector3(...view.position).applyMatrix4(matrix).toArray(),
    target: new THREE.Vector3(...view.target).applyMatrix4(matrix).toArray(),
    up: new THREE.Vector3(...(view.up ?? [0, 1, 0])).transformDirection(matrix).toArray(),
  };
}

/** Saved viewpoints use scan coordinates so orientation/scale edits move them
 * with the scan rather than stranding them back outside the room. */
export function encodeStartView(view: SetStartView, splat: SplatMesh | null): SetStartView {
  if (!splat) return view;
  splat.updateWorldMatrix(true, false);
  return transformView(view, splat.matrixWorld.clone().invert());
}

export function resolveStartView(splat: SplatMesh | null, set: ProjectSet, automatic = false, firstPhoto?: SetStartView | null): SetStartView {
  splat?.updateWorldMatrix(true, false);
  const preferred = set.startView ?? firstPhoto;
  if (preferred && !automatic) return splat ? transformView(preferred, splat.matrixWorld) : preferred;
  const source = splat?.extSplats ?? splat?.packedSplats;
  const points: THREE.Vector3[] = [];
  if (source && splat) {
    const count = source.getNumSplats(), stride = Math.max(1, Math.ceil(count / 8192));
    for (let i = 0; i < count; i += stride) {
      const item = source.getSplat(i);
      if (item.opacity >= 0.2) points.push(item.center.clone().applyMatrix4(splat.matrixWorld));
    }
  }
  return estimateInteriorView(points, set.groundY);
}
