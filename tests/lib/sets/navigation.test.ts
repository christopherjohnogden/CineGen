import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { installTrackpadNavigation, lookCameraInPlace, rotateCameraInPlace } from '@/lib/sets/navigation';
import { normalizeProjectSets } from '@/lib/sets/normalize';
import { applyCamera } from '@/lib/sets/scene';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

function navigation() {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.01, 2000);
  camera.position.set(3, 2, 10);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(1, 1, 1);
  controls.minDistance = 0.05;
  controls.maxDistance = 100;
  controls.minPolarAngle = 0.0001;
  controls.maxPolarAngle = Math.PI - 0.0001;
  controls.update();
  const remove = installTrackpadNavigation(controls, canvas);
  cleanups.push(() => { remove(); controls.dispose(); });
  return { camera, controls, canvas, remove };
}

describe('trackpad navigation', () => {
  it('zooms smoothly with vertical swipes while preserving the pivot and direction', () => {
    const { camera, controls, canvas } = navigation();
    const target = controls.target.clone();
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const distance = camera.position.distanceTo(target);
    const event = new WheelEvent('wheel', { deltaY: -10, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance * Math.exp(-0.025), 8);
    expect(controls.target.equals(target)).toBe(true);
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)).toBeLessThan(1e-8);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 8);
  });

  it('moves the camera and pivot together for Shift-swipe panning', () => {
    const { camera, controls, canvas } = navigation();
    const position = camera.position.clone();
    const target = controls.target.clone();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 25, deltaY: 40, shiftKey: true }));
    const moved = camera.position.clone().sub(position);
    expect(moved.length()).toBeGreaterThan(0.1);
    expect(controls.target.clone().sub(target).distanceTo(moved)).toBeLessThan(1e-8);
  });

  it('does not treat a horizontal swipe as zoom', () => {
    const { camera, canvas } = navigation();
    const position = camera.position.clone();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 100 }));
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
  });

  it('normalizes wheel units and keeps pinch zoom within navigation limits', () => {
    const a = navigation(), b = navigation();
    a.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 2, deltaMode: 1 }));
    b.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 32 }));
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(1e-8);
    for (let i = 0; i < 30; i++) a.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, ctrlKey: true }));
    expect(a.camera.position.distanceTo(a.controls.target)).toBeCloseTo(a.controls.minDistance, 8);
  });

  it('leaves events alone while controls are disabled', () => {
    const { controls, canvas, camera } = navigation();
    controls.enabled = false;
    const position = camera.position.clone();
    const event = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(camera.position.equals(position)).toBe(true);
  });
});

describe('camera rotation rings and Look mode', () => {
  it('rolls around the viewing axis without moving or redirecting the camera', () => {
    const { camera, controls } = navigation();
    const position = camera.position.clone();
    const target = controls.target.clone();
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const before = camera.quaternion.clone();
    const expected = before.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(direction.clone().negate(), Math.PI / 2));
    rotateCameraInPlace(controls, 'roll', Math.PI / 2);
    controls.update();
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(controls.target.distanceTo(target)).toBeLessThan(1e-8);
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)).toBeLessThan(1e-8);
    expect(camera.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    rotateCameraInPlace(controls, 'roll', -Math.PI / 2);
    expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-6);
  });

  it('preserves ring rotation when a saved camera is normalized and restored', () => {
    const { camera, controls } = navigation();
    rotateCameraInPlace(controls, 'z', 0.4);
    const sets = normalizeProjectSets([{ cameras: [{
      position: camera.position.toArray(), target: controls.target.toArray(),
      up: camera.up.toArray(), focalMm: 35, aspect: '16:9',
    }] }]);
    const restored = new THREE.PerspectiveCamera();
    applyCamera(restored, sets[0].cameras[0]);
    expect(restored.position.distanceTo(camera.position)).toBeLessThan(1e-8);
    expect(restored.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-6);
  });

  it.each(['x', 'y', 'z'] as const)('rotates about %s without moving the camera or changing focus distance', (axis) => {
    const { camera, controls } = navigation();
    const position = camera.position.clone();
    const offset = controls.target.clone().sub(position);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), 0.2);
    rotateCameraInPlace(controls, axis, 0.2);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(controls.target.clone().sub(position).distanceTo(offset.applyQuaternion(rotation))).toBeLessThan(1e-8);
    expect(camera.up.distanceTo(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation))).toBeLessThan(1e-8);
  });

  it('looks left/right from a fixed position and preserves tilt', () => {
    const { camera, controls } = navigation();
    const position = camera.position.clone();
    const before = camera.getWorldDirection(new THREE.Vector3());
    lookCameraInPlace(controls, 50, 0);
    const after = camera.getWorldDirection(new THREE.Vector3());
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(after.y).toBeCloseTo(before.y, 8);
    expect(after.distanceTo(before)).toBeGreaterThan(0.1);
  });

  it('keeps a rolled camera stable on subsequent updates and looking gestures', () => {
    const { camera, controls } = navigation();
    rotateCameraInPlace(controls, 'z', 0.4);
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();
    controls.update();
    expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-6);
    lookCameraInPlace(controls, 20, 10);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });
});
