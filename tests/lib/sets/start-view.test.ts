import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { estimateInteriorView, encodeStartView, resolveStartView } from '@/lib/sets/start-view';
import { normalizeProjectSets } from '@/lib/sets/normalize';

function room() {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const x = 10 + i / 2, z = 30 + j / 2, y = j * 0.2;
    points.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 4, z));
    points.push(new THREE.Vector3(10, y, z), new THREE.Vector3(20, y, z));
    points.push(new THREE.Vector3(x, y, 30), new THREE.Vector3(x, y, 40));
  }
  return points;
}

describe('Set starting views', () => {
  it('uses a clear interior capture origin instead of guessing meters for a small scan', () => {
    const points = room().map((p) => p.sub(new THREE.Vector3(15, 1.7, 35)).multiplyScalar(0.1));
    expect(estimateInteriorView(points).position).toEqual([0, 0, 0]);
  });

  it('starts inside a room away from the origin, at eye height, looking level', () => {
    const view = estimateInteriorView(room());
    expect(view.position[0]).toBeGreaterThan(12);
    expect(view.position[0]).toBeLessThan(18);
    expect(view.position[2]).toBeGreaterThan(32);
    expect(view.position[2]).toBeLessThan(38);
    expect(view.position[1]).toBeCloseTo(1.6);
    expect(view.target[1]).toBe(view.position[1]);
  });

  it('ignores sparse distant floaters and invalid samples', () => {
    const points = room();
    const original = estimateInteriorView(points);
    points.push(new THREE.Vector3(1e6, 1e6, 1e6), new THREE.Vector3(NaN, 0, 0));
    const view = estimateInteriorView(points);
    expect(new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(...original.position))).toBeLessThan(1);
  });

  it('moves away from furniture at the preferred center', () => {
    const points = room();
    const center = estimateInteriorView(points).position;
    for (let i = 0; i < 30; i++) points.push(new THREE.Vector3(center[0] + i / 100, 1.6, center[2]));
    const view = estimateInteriorView(points);
    expect(Math.hypot(view.position[0] - center[0], view.position[2] - center[2])).toBeGreaterThan(1);
  });

  it('has a finite fallback for empty and degenerate scans', () => {
    for (const points of [[], Array.from({ length: 10 }, () => new THREE.Vector3(3, 3, 3))]) {
      const view = estimateInteriorView(points);
      expect([...view.position, ...view.target].every(Number.isFinite)).toBe(true);
      expect(view.position).not.toEqual(view.target);
    }
  });

  it('saves and restores a pose relative to scan orientation and scale', () => {
    const mesh = new THREE.Object3D();
    mesh.rotation.z = 0.5;
    mesh.scale.setScalar(2);
    const world = { position: [4, 2, 3], target: [2, 2, 0], up: [0, 1, 0] } as const;
    const saved = encodeStartView({ position: [...world.position], target: [...world.target], up: [...world.up] }, mesh as SplatMesh);
    const [set] = normalizeProjectSets([{ startView: saved }]);
    const restored = resolveStartView(mesh as SplatMesh, set);
    expect(new THREE.Vector3(...restored.position).distanceTo(new THREE.Vector3(...world.position))).toBeLessThan(1e-8);
    mesh.position.x = 10;
    expect(resolveStartView(mesh as SplatMesh, set).position[0]).toBeCloseTo(14);
  });

  it('drops invalid saved poses when loading a project', () => {
    for (const startView of [{ position: [NaN, 0, 0], target: [1, 2, 3] }, { position: [1, 2, 3], target: [1, 2, 3] }]) {
      expect(normalizeProjectSets([{ startView }])[0].startView).toBeUndefined();
    }
  });
});
