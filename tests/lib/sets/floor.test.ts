import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { detectFloor, encodeFloor, floorFromControls, floorHeightAt, intersectFloor, resolveFloor, resolveFloorOrigin, resolveFloorOrientation, resolveFloorSize, startingStandInPosition, standInPosition, standInPlacement } from '@/lib/sets/floor';
import { buildMannequin, syncStandIns, type StandIn } from '@/lib/sets/scene';
import { normalizeProjectSets } from '@/lib/sets/normalize';

const standIn: StandIn = { id: 'actor', heightM: 1.8, pose: 'standing', x: 2, z: -3, facing: .7 };

describe('floor detection and placement', () => {
  it('keeps both movement axes attached on steep and vertical scan floors', () => {
    for (const y of [.03, .001, 0]) {
      const normal = new THREE.Vector3(0, y, 1).normalize();
      const floor = new THREE.Plane(normal, -.2);
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const origin = floor.coplanarPoint(new THREE.Vector3());
      for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
        const target = origin.clone().add(axis.applyQuaternion(rotation).multiplyScalar(2));
        const entry = { ...standIn, ...standInPlacement(target, floor) };
        const restored = normalizeProjectSets([{ standIns: [entry] }])[0].standIns![0];
        expect(standInPosition(restored, floor).distanceTo(target)).toBeLessThan(1e-7);
        const group = new THREE.Group();
        syncStandIns(group, [restored], floor);
        expect(group.children[0].position.distanceTo(target)).toBeLessThan(1e-7);
      }
    }
  });

  it('preserves rotation within the floor plane when saving, moving, and resizing', () => {
    const set = normalizeProjectSets([{ upAxis: 'z', rotationDeg: [12, 23, 4], scaleToMeters: 2 }])[0];
    const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, .8, -.2));
    const origin = new THREE.Vector3(2, -.5, -3);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    set.floorPlane = encodeFloor(plane, set, origin, 6, orientation);
    const restored = normalizeProjectSets(JSON.parse(JSON.stringify([set])))[0];
    expect(resolveFloorOrientation(restored).angleTo(orientation)).toBeLessThan(1e-7);
    const moved = origin.clone().addScalar(1);
    const movedPlane = plane.clone().setFromNormalAndCoplanarPoint(normal, moved);
    restored.floorPlane = encodeFloor(movedPlane, restored, moved, 3);
    expect(resolveFloorOrientation(restored).angleTo(orientation)).toBeLessThan(1e-7);
    expect(resolveFloorOrigin(restored).distanceTo(moved)).toBeLessThan(1e-8);
  });

  it('preserves a tilted floor pivot and guide size through saving and room calibration', () => {
    const set = normalizeProjectSets([{ upAxis: 'z', rotationDeg: [12, 23, 4], scaleToMeters: 2 }])[0];
    const origin = new THREE.Vector3(3, -.5, -4);
    const normal = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 1.3);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    set.floorPlane = encodeFloor(plane, set, origin, 6);
    const restored = normalizeProjectSets(JSON.parse(JSON.stringify([set])))[0];
    expect(resolveFloorOrigin(restored).distanceTo(origin)).toBeLessThan(1e-8);
    expect(resolveFloor(restored).normal.distanceTo(normal)).toBeLessThan(1e-8);
    expect(resolveFloorSize(restored)).toBe(6);
    expect(resolveFloorSize({ ...restored, scaleToMeters: 4 })).toBe(12);
    expect(restored.scaleToMeters).toBe(2);
  });

  it('discards invalid guide sizes and uses the sampled extent for older floors', () => {
    for (const size of [-1, 0, Infinity, 'large', undefined]) {
      const set = normalizeProjectSets([{ floorPlane: { normal: [0, 1, 0], constant: 0, size } }])[0];
      expect(set.floorPlane?.size).toBeUndefined();
      expect(resolveFloorSize(set, 7)).toBe(7);
    }
  });

  it('finds a sloped floor among walls, furniture, noise, and distant floaters', () => {
    const points: THREE.Vector3[] = [];
    for (let x = -5; x <= 5; x += .25) for (let z = -4; z <= 4; z += .25) {
      points.push(new THREE.Vector3(x, .05*x - .03*z - 1 + Math.sin(x*37+z*19)*.004, z));
      if (Math.abs(x) < 2 && Math.abs(z) < 2) points.push(new THREE.Vector3(x, .4, z));
    }
    for (let y = -1; y < 3; y += .1) for (let z = -4; z < 4; z += .1) points.push(new THREE.Vector3(5, y, z));
    points.push(new THREE.Vector3(900, -500, 1000), new THREE.Vector3(NaN, 0, 0));
    const floor = detectFloor(points, 1.6)!;
    expect(floor).not.toBeNull();
    expect(floorHeightAt(floor, 0, 0)).toBeCloseTo(-1, 2);
    expect(floorHeightAt(floor, 3, 2)).toBeCloseTo(-.91, 2);
  });

  it('does not invent a floor from an empty scan or a vertical wall', () => {
    expect(detectFloor([])).toBeNull();
    const wall = Array.from({ length: 500 }, (_, i) => new THREE.Vector3(1, i % 20, Math.floor(i / 20)));
    expect(detectFloor(wall)).toBeNull();
  });

  it('preserves an edited plane through persistence and scan rotation/scale', () => {
    const set = normalizeProjectSets([{ upAxis: 'z', scaleToMeters: 2, rotationDeg: [4, 8, 12] }])[0];
    const floor = floorFromControls(-.4, 8, -5);
    set.floorPlane = encodeFloor(floor, set);
    set.standIns = [standIn];
    const restored = normalizeProjectSets(JSON.parse(JSON.stringify([set])))[0];
    const plane = resolveFloor(restored);
    expect(plane.normal.distanceTo(floor.normal)).toBeLessThan(1e-8);
    expect(plane.constant).toBeCloseTo(floor.constant, 8);
    expect(restored.standIns).toEqual([standIn]);
    expect(resolveFloor({ ...restored, scaleToMeters: 4 }).constant).toBeCloseTo(floor.constant * 2, 8);
  });

  it('anchors the actual feet to zero and honors the mannequin height', () => {
    const mannequin = buildMannequin({ ...standIn, x: 0, z: 0, facing: 0 });
    const bounds = new THREE.Box3().setFromObject(mannequin);
    expect(bounds.min.y).toBeCloseTo(0, 8);
    expect(bounds.max.y).toBeCloseTo(1.8, 8);
  });

  it('persists horizontal floor translations and scales the gizmo origin with the scan', () => {
    const set = normalizeProjectSets([{ upAxis: 'z', rotationDeg: [12, 23, 4], scaleToMeters: 2 }])[0];
    const plane = floorFromControls(-.5, 0, 0);
    const origin = new THREE.Vector3(3, -.5, -4);
    set.floorPlane = encodeFloor(plane, set, origin);
    const restored = normalizeProjectSets(JSON.parse(JSON.stringify([set])))[0];
    expect(resolveFloorOrigin(restored).distanceTo(origin)).toBeLessThan(1e-8);
    expect(resolveFloorOrigin({ ...restored, scaleToMeters: 4 }).distanceTo(origin.clone().multiplyScalar(2))).toBeLessThan(1e-8);
    const movedOrigin = origin.clone().add(new THREE.Vector3(2, .3, -1));
    const movedPlane = plane.clone().setFromNormalAndCoplanarPoint(plane.normal, movedOrigin);
    restored.floorPlane = encodeFloor(movedPlane, restored, movedOrigin);
    expect(resolveFloorOrigin(restored).distanceTo(movedOrigin)).toBeLessThan(1e-8);
    expect(floorHeightAt(resolveFloor(restored), 0, 0)).toBeCloseTo(-.2, 8);
  });

  it('keeps mannequin vertices on or above the floor after moving on a slope', () => {
    const plane = floorFromControls(1, 12, -7);
    const group = new THREE.Group();
    syncStandIns(group, [standIn, { ...standIn, id: 'other', x: -4, z: 1 }], plane);
    group.updateMatrixWorld(true);
    let lowest = Infinity;
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const positions = node.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
        lowest = Math.min(lowest, plane.distanceToPoint(p));
      }
    });
    expect(lowest).toBeCloseTo(0, 6);
  });

  it('places ahead of a level camera and rejects intersections behind it', () => {
    const camera = new THREE.PerspectiveCamera(); camera.position.set(2, 1.6, 4); camera.lookAt(2, 1.6, 0);
    const floor = floorFromControls(0, 0, 0);
    expect(startingStandInPosition(camera, floor).distanceTo(new THREE.Vector3(2, 0, -1.6))).toBeLessThan(1e-8);
    expect(intersectFloor(new THREE.Ray(camera.position, new THREE.Vector3(0, 1, 0)), floor)).toBeNull();
  });

  it('drops malformed planes and placements on load', () => {
    const set = normalizeProjectSets([{ floorPlane: { normal: [0, 0, 0], constant: 0 }, standIns: [{ x: NaN, z: 1 }] }])[0];
    expect(set.floorPlane).toBeUndefined();
    expect(set.standIns).toEqual([]);
  });
});
