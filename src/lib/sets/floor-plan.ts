import type { SetCamera, SetMark } from '@/types/sets';
import type { StandIn } from './scene';

/**
 * Overhead floor-plan geometry.
 *
 * Pure: takes world-space metres, returns SVG-space points. Kept apart from the
 * component so Scene Blocking (build step 5) can reuse the same projection for
 * a whole scene's worth of coverage rather than re-deriving it.
 *
 * World is three.js handed: +X right, +Z toward the viewer. On a plan seen from
 * above, +Z reads as *down* the page, so Z maps to SVG Y directly.
 */

export interface PlanBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlanPoint {
  x: number;
  y: number;
}

export interface PlanFrustum {
  apex: PlanPoint;
  left: PlanPoint;
  right: PlanPoint;
}

const MIN_SPAN = 4;

/** The area the plan has to cover, padded and never degenerate. */
export function planBounds(
  marks: Pick<SetMark, 'x' | 'z'>[],
  cameras: Pick<SetCamera, 'position'>[],
  standIns: Pick<StandIn, 'x' | 'z'>[] = [],
): PlanBounds {
  const xs = [...marks.map((m) => m.x), ...standIns.map((s) => s.x), ...cameras.map((c) => c.position[0])];
  const zs = [...marks.map((m) => m.z), ...standIns.map((s) => s.z), ...cameras.map((c) => c.position[2])];
  if (xs.length === 0) return { minX: -MIN_SPAN / 2, maxX: MIN_SPAN / 2, minZ: -MIN_SPAN / 2, maxZ: MIN_SPAN / 2 };

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minZ = Math.min(...zs);
  let maxZ = Math.max(...zs);

  // A single point, or a perfectly flat row, would divide by zero when scaled.
  if (maxX - minX < MIN_SPAN) {
    const mid = (maxX + minX) / 2;
    minX = mid - MIN_SPAN / 2;
    maxX = mid + MIN_SPAN / 2;
  }
  if (maxZ - minZ < MIN_SPAN) {
    const mid = (maxZ + minZ) / 2;
    minZ = mid - MIN_SPAN / 2;
    maxZ = mid + MIN_SPAN / 2;
  }

  const padX = (maxX - minX) * 0.12;
  const padZ = (maxZ - minZ) * 0.12;
  return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
}

/** Project a world point onto a square SVG viewBox, preserving aspect. */
export function toPlan(x: number, z: number, bounds: PlanBounds, size: number): PlanPoint {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const span = Math.max(spanX, spanZ);
  // Centre the smaller axis so the plan is not stretched.
  const offsetX = (span - spanX) / 2;
  const offsetZ = (span - spanZ) / 2;
  return {
    x: ((x - bounds.minX + offsetX) / span) * size,
    y: ((z - bounds.minZ + offsetZ) / span) * size,
  };
}

/**
 * The wedge a camera sees, as a triangle on the plan.
 *
 * Uses the horizontal field of view, since that is what the plan shows — a
 * vertical FOV here would draw a wedge the shot does not actually have.
 */
export function cameraFrustum(
  camera: Pick<SetCamera, 'position' | 'target'>,
  horizontalFovDeg: number,
  bounds: PlanBounds,
  size: number,
  reach = 6,
): PlanFrustum {
  const [cx, , cz] = camera.position;
  const [tx, , tz] = camera.target;

  const heading = Math.atan2(tx - cx, tz - cz);
  const half = (horizontalFovDeg * Math.PI) / 180 / 2;

  const point = (angle: number) => toPlan(cx + Math.sin(angle) * reach, cz + Math.cos(angle) * reach, bounds, size);

  return {
    apex: toPlan(cx, cz, bounds, size),
    left: point(heading - half),
    right: point(heading + half),
  };
}
