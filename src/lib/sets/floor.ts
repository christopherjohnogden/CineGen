import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { ProjectSet, SetFloorPlane, SetStandIn } from '@/types/sets';

type FloorSet = Pick<ProjectSet, 'upAxis' | 'rotationDeg' | 'scaleToMeters' | 'floorPlane' | 'groundY'>;

function scanMatrix(set: FloorSet): THREE.Matrix4 {
  const [x, y, z] = (set.rotationDeg ?? [0, 0, 0]).map(THREE.MathUtils.degToRad);
  return new THREE.Matrix4().compose(new THREE.Vector3(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x + (set.upAxis === 'z' ? -Math.PI / 2 : 0), y, z)),
    new THREE.Vector3().setScalar(set.scaleToMeters > 0 ? set.scaleToMeters : 1));
}

export function resolveFloor(set: FloorSet): THREE.Plane {
  if (!set.floorPlane) return new THREE.Plane(new THREE.Vector3(0, 1, 0), -(set.groundY ?? 0));
  const plane = new THREE.Plane(new THREE.Vector3(...set.floorPlane.normal), set.floorPlane.constant)
    .normalize().applyMatrix4(scanMatrix(set));
  if (plane.normal.y < 0) plane.negate();
  return plane;
}

export function resolveFloorOrigin(set: FloorSet): THREE.Vector3 {
  const plane = resolveFloor(set);
  return set.floorPlane?.origin
    ? plane.projectPoint(new THREE.Vector3(...set.floorPlane.origin).applyMatrix4(scanMatrix(set)), new THREE.Vector3())
    : plane.coplanarPoint(new THREE.Vector3());
}

export function resolveFloorSize(set: FloorSet, fallback = 8): number {
  return set.floorPlane?.size ? set.floorPlane.size * (set.scaleToMeters > 0 ? set.scaleToMeters : 1) : fallback;
}

export function resolveFloorOrientation(set: FloorSet): THREE.Quaternion {
  const normal = resolveFloor(set).normal;
  if (set.floorPlane?.xAxis) {
    const x = new THREE.Vector3(...set.floorPlane.xAxis).transformDirection(scanMatrix(set));
    x.addScaledVector(normal, -x.dot(normal));
    if (x.lengthSq() > 1e-8) {
      x.normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, normal, new THREE.Vector3().crossVectors(x, normal)));
    }
  }
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
}

export function encodeFloor(plane: THREE.Plane, set: FloorSet, origin?: THREE.Vector3, size?: number, orientation?: THREE.Quaternion): SetFloorPlane {
  const inverse = scanMatrix(set).invert();
  const local = plane.clone().applyMatrix4(inverse).normalize();
  return { normal: local.normal.toArray(), constant: local.constant,
    ...(orientation ? { xAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(orientation).transformDirection(inverse).toArray() }
      : set.floorPlane?.xAxis ? { xAxis: set.floorPlane.xAxis } : {}),
    ...(size !== undefined ? { size: size / (set.scaleToMeters > 0 ? set.scaleToMeters : 1) } : {}),
    ...(origin ? { origin: plane.projectPoint(origin, new THREE.Vector3()).applyMatrix4(inverse).toArray() } : {}) };
}

export function floorHeightAt(plane: THREE.Plane, x: number, z: number): number {
  return Math.abs(plane.normal.y) > 1e-8 ? -(plane.normal.x * x + plane.normal.z * z + plane.constant) / plane.normal.y : 0;
}

/** A scan's floor can be vertical in world coordinates. Preserve all three
 * coordinates rather than losing movement along an almost-world-Y axis. */
export function standInPosition(entry: Pick<SetStandIn, 'x' | 'z' | 'position'>, floor: THREE.Plane): THREE.Vector3 {
  const point = entry.position ? new THREE.Vector3(...entry.position)
    : new THREE.Vector3(entry.x, floorHeightAt(floor, entry.x, entry.z), entry.z);
  return floor.projectPoint(point, new THREE.Vector3());
}

export function standInPlacement(point: THREE.Vector3, floor: THREE.Plane): Pick<SetStandIn, 'x' | 'z' | 'position'> {
  const feet = floor.projectPoint(point, new THREE.Vector3());
  return { x: feet.x, z: feet.z, position: feet.toArray() };
}

export function floorFromControls(height: number, pitch: number, roll: number): THREE.Plane {
  const normal = new THREE.Vector3(-Math.tan(THREE.MathUtils.degToRad(roll)), 1, Math.tan(THREE.MathUtils.degToRad(pitch))).normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, height, 0));
}

export function floorControls(plane: THREE.Plane) {
  return { height: floorHeightAt(plane, 0, 0), pitch: THREE.MathUtils.radToDeg(Math.atan2(plane.normal.z, plane.normal.y)),
    roll: THREE.MathUtils.radToDeg(Math.atan2(-plane.normal.x, plane.normal.y)) };
}

export function sampleFloorPoints(splat: SplatMesh | null, limit = 12000): THREE.Vector3[] {
  const source = splat?.extSplats ?? splat?.packedSplats;
  if (!source || !splat) return [];
  splat.updateWorldMatrix(true, false);
  const points: THREE.Vector3[] = [];
  const count = source.getNumSplats(), stride = Math.max(1, Math.ceil(count / limit));
  for (let i = 0; i < count; i += stride) {
    const item = source.getSplat(i);
    if (item.opacity < 0.3) continue;
    const p = item.center.clone().applyMatrix4(splat.matrixWorld);
    if (p.toArray().every(Number.isFinite)) points.push(p);
  }
  return points;
}

/** RANSAC finds a broad, low, nearly horizontal surface. Furniture and sparse
 * floaters are rejected by orientation, height, area, and inlier coverage. */
export function detectFloor(points: THREE.Vector3[], cameraY?: number): THREE.Plane | null {
  const finite = points.filter(p => p.toArray().every(Number.isFinite));
  if (finite.length < 30) return null;
  const q = (axis: 'x' | 'y' | 'z', fraction: number) => {
    const sorted = finite.map(p => p[axis]).sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * fraction)];
  };
  const bounds = new THREE.Box3(new THREE.Vector3(q('x', .02), q('y', .02), q('z', .02)), new THREE.Vector3(q('x', .98), q('y', .98), q('z', .98)));
  const size = bounds.getSize(new THREE.Vector3());
  const tolerance = Math.max(0.002, Math.min(size.x, size.z) * .006);
  const top = Math.min(q('y', .6), cameraY === undefined ? Infinity : cameraY - tolerance * 2);
  const candidates = finite.filter(p => bounds.containsPoint(p) && p.y <= top);
  if (candidates.length < 30) return null;
  let seed = 137;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let best: THREE.Plane | null = null, bestScore = 0;
  for (let trial = 0; trial < 240; trial++) {
    const sample = () => candidates[Math.floor(random() * candidates.length)];
    const plane = new THREE.Plane().setFromCoplanarPoints(sample(), sample(), sample());
    if (!Number.isFinite(plane.constant) || plane.normal.lengthSq() < .5) continue;
    if (plane.normal.y < 0) plane.negate();
    if (plane.normal.y < .82) continue;
    let count = 0, sumY = 0;
    const coverage = new THREE.Box3();
    for (const p of candidates) if (Math.abs(plane.distanceToPoint(p)) <= tolerance) { count++; sumY += p.y; coverage.expandByPoint(p); }
    if (count < Math.max(25, candidates.length * .06)) continue;
    const span = coverage.getSize(new THREE.Vector3());
    if (span.x < size.x * .2 || span.z < size.z * .2) continue;
    const area = Math.min(1, span.x * span.z / Math.max(.001, size.x * size.z));
    const lowBias = 1 + .5 * (top - sumY / count) / Math.max(tolerance, top - bounds.min.y);
    const score = count * Math.sqrt(area) * lowBias;
    if (score > bestScore) { best = plane; bestScore = score; }
  }
  if (!best) return null;
  // Least-squares refinement of y = ax + bz + c over the winning inliers.
  const inliers = candidates.filter(p => Math.abs(best!.distanceToPoint(p)) <= tolerance);
  const mean = inliers.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(inliers.length);
  let xx = 0, zz = 0, xz = 0, xy = 0, zy = 0;
  for (const p of inliers) { const x = p.x - mean.x, y = p.y - mean.y, z = p.z - mean.z; xx += x*x; zz += z*z; xz += x*z; xy += x*y; zy += z*y; }
  const det = xx * zz - xz * xz;
  if (Math.abs(det) > 1e-10) {
    const a = (xy * zz - zy * xz) / det, b = (zy * xx - xy * xz) / det;
    best.setFromNormalAndCoplanarPoint(new THREE.Vector3(-a, 1, -b).normalize(), mean);
  }
  return best;
}

export function intersectFloor(ray: THREE.Ray, floor: THREE.Plane): THREE.Vector3 | null {
  const point = ray.intersectPlane(floor, new THREE.Vector3());
  return point && ray.origin.distanceTo(point) < 2000 ? point : null;
}

/** A level camera can miss the floor; place along its horizontal heading. */
export function startingStandInPosition(camera: THREE.Camera, floor: THREE.Plane): THREE.Vector3 {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const hit = intersectFloor(new THREE.Ray(camera.position.clone(), direction), floor);
  if (hit && camera.position.distanceTo(hit) <= 8) return hit;
  direction.y = 0;
  if (direction.lengthSq() < .001) direction.set(0, 0, -1);
  const height = Math.abs(camera.position.y - floorHeightAt(floor, camera.position.x, camera.position.z));
  // Leave enough room for the feet to appear in a typical 35–50 mm view.
  const point = camera.position.clone().addScaledVector(direction.normalize(), Math.max(.2, height * 3.5));
  point.y = floorHeightAt(floor, point.x, point.z);
  return point;
}
