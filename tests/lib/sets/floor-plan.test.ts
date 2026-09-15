import { describe, expect, it } from 'vitest';
import { cameraFrustum, planBounds, toPlan } from '@/lib/sets/floor-plan';
import type { SetCamera } from '@/types/sets';

const camera = (position: [number, number, number], target: [number, number, number]) =>
  ({ position, target }) as Pick<SetCamera, 'position' | 'target'>;

describe('planBounds', () => {
  it('covers everything on the plan', () => {
    const bounds = planBounds(
      [{ x: -3, z: 1 }],
      [camera([5, 1.6, -2], [0, 1, 0])],
      [{ x: 0, z: 8 }],
    );
    expect(bounds.minX).toBeLessThanOrEqual(-3);
    expect(bounds.maxX).toBeGreaterThanOrEqual(5);
    expect(bounds.minZ).toBeLessThanOrEqual(-2);
    expect(bounds.maxZ).toBeGreaterThanOrEqual(8);
  });

  it('never returns a degenerate span, even for a single point', () => {
    const bounds = planBounds([{ x: 2, z: 2 }], []);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
    expect(bounds.maxZ - bounds.minZ).toBeGreaterThan(0);
  });

  it('has a usable default when the Set is completely empty', () => {
    const bounds = planBounds([], []);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
    expect(bounds.maxZ - bounds.minZ).toBeGreaterThan(0);
  });
});

describe('toPlan', () => {
  const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };

  it('maps the centre of the world to the centre of the plan', () => {
    const point = toPlan(0, 0, bounds, 100);
    expect(point.x).toBeCloseTo(50, 5);
    expect(point.y).toBeCloseTo(50, 5);
  });

  it('puts +Z down the page, which is what an overhead view shows', () => {
    expect(toPlan(0, 3, bounds, 100).y).toBeGreaterThan(toPlan(0, -3, bounds, 100).y);
  });

  it('puts +X to the right', () => {
    expect(toPlan(3, 0, bounds, 100).x).toBeGreaterThan(toPlan(-3, 0, bounds, 100).x);
  });

  it('does not stretch a non-square area', () => {
    // A wide, shallow room: the same world distance must be the same plan
    // distance on both axes, or the plan lies about the geometry.
    const wide = { minX: -20, maxX: 20, minZ: -2, maxZ: 2 };
    const dx = toPlan(10, 0, wide, 100).x - toPlan(0, 0, wide, 100).x;
    const dy = toPlan(0, 10, wide, 100).y - toPlan(0, 0, wide, 100).y;
    expect(dx).toBeCloseTo(dy, 5);
  });
});

describe('cameraFrustum', () => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

  it('starts at the camera and opens toward its target', () => {
    const wedge = cameraFrustum(camera([0, 1.6, 5], [0, 1.2, 0]), 60, bounds, 100);
    const apex = toPlan(0, 5, bounds, 100);
    expect(wedge.apex.x).toBeCloseTo(apex.x, 5);
    expect(wedge.apex.y).toBeCloseTo(apex.y, 5);
    // Looking from +Z toward the origin means looking up the page.
    expect((wedge.left.y + wedge.right.y) / 2).toBeLessThan(wedge.apex.y);
  });

  it('opens wider for a wider lens', () => {
    const spread = (fov: number) => {
      const wedge = cameraFrustum(camera([0, 1.6, 5], [0, 1.2, 0]), fov, bounds, 100);
      return Math.hypot(wedge.left.x - wedge.right.x, wedge.left.y - wedge.right.y);
    };
    expect(spread(90)).toBeGreaterThan(spread(30));
  });

  it('follows the camera round when it looks the other way', () => {
    const wedge = cameraFrustum(camera([0, 1.6, -5], [0, 1.2, 0]), 60, bounds, 100);
    // Looking from -Z toward the origin means looking down the page.
    expect((wedge.left.y + wedge.right.y) / 2).toBeGreaterThan(wedge.apex.y);
  });
});
