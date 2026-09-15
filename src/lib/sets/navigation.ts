import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type RotationAxis = 'x' | 'y' | 'z' | 'roll';

/** Rotate the viewing direction and up vector around a world axis, keeping the
 * camera at the same point. Roll uses the viewing axis and leaves the target fixed. */
export function rotateCameraInPlace(controls: OrbitControls, axis: RotationAxis, radians: number): void {
  const camera = controls.object;
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  const direction = controls.target.clone().sub(camera.position);
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    axis === 'roll' ? direction.clone().negate().normalize()
      : new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), radians,
  );
  direction.applyQuaternion(rotation);
  camera.up.applyQuaternion(rotation).normalize();
  if (axis !== 'roll') controls.target.copy(camera.position).add(direction);
  controls.update();
  controls.enableDamping = damping;
}

export function lookCameraInPlace(controls: OrbitControls, dx: number, dy: number): void {
  const camera = controls.object;
  const toUp = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
  const direction = controls.target.clone().sub(camera.position).applyQuaternion(toUp);
  const spherical = new THREE.Spherical().setFromVector3(direction);
  spherical.theta -= dx * 0.004;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi + dy * 0.004, 0.08, Math.PI - 0.08);
  direction.setFromSpherical(spherical).applyQuaternion(toUp.invert());
  controls.target.copy(camera.position).add(direction);
  controls.update();
}

/** Trackpads expose swipes as wheel events, not touch contacts. */
export function installTrackpadNavigation(controls: OrbitControls, canvas: HTMLCanvasElement): () => void {
  const camera = controls.object as THREE.PerspectiveCamera;
  const onWheel = (event: WheelEvent) => {
    if (!controls.enabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    const distance = camera.position.distanceTo(controls.target);

    if (event.shiftKey && controls.enablePan) {
      // Translate camera and pivot together in the plane of the screen.
      const perPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, canvas.clientHeight);
      const move = new THREE.Vector3(-dx, dy, 0).applyQuaternion(camera.quaternion).multiplyScalar(perPixel);
      camera.position.add(move);
      controls.target.add(move);
    } else if (controls.enableZoom && dy !== 0) {
      // Preserve small swipe deltas; cap individual events to avoid large jumps.
      // Chromium reports a trackpad pinch as ctrl+wheel.
      const scale = Math.exp(THREE.MathUtils.clamp(dy * (event.ctrlKey ? 0.01 : 0.0025), -0.5, 0.5));
      const next = THREE.MathUtils.clamp(distance * scale, controls.minDistance, controls.maxDistance);
      camera.position.sub(controls.target).setLength(next).add(controls.target);
    }
    controls.update();
  };
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => canvas.removeEventListener('wheel', onWheel, true);
}
