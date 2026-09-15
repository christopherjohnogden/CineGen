/**
 * Lens maths for the 3D Set viewer.
 *
 * The UI speaks in millimetres and sensor sizes because that is how a shot gets
 * framed. What reaches a prompt does not: `src/lib/director/craft/optics.ts`
 * holds this repo's doctrine — the model reads observable lens outcomes, never
 * camera metadata — so these numbers exist to drive a real three.js camera and
 * to pick a doctrine anchor, not to be written into a prompt.
 *
 * Pure module: no three.js import, so it unit-tests without a GL context.
 */

export interface SensorSize {
  widthMm: number;
  heightMm: number;
}

export const FULL_FRAME: SensorSize = { widthMm: 36, heightMm: 24 };

export const SENSOR_PRESETS: { id: string; label: string; size: SensorSize }[] = [
  { id: 'full-frame', label: 'Full frame (36×24)', size: FULL_FRAME },
  { id: 'super-35', label: 'Super 35 (24.89×18.66)', size: { widthMm: 24.89, heightMm: 18.66 } },
  { id: 'aps-c', label: 'APS-C (23.6×15.7)', size: { widthMm: 23.6, heightMm: 15.7 } },
  { id: 'm43', label: 'Micro 4/3 (17.3×13)', size: { widthMm: 17.3, heightMm: 13 } },
  { id: 'imax-65', label: 'IMAX 65mm (70.4×52.6)', size: { widthMm: 70.4, heightMm: 52.6 } },
];

/** The presets the brief names. Custom focal lengths are typed in alongside these. */
export const LENS_PRESETS = [24, 35, 50, 85];

const toDeg = (rad: number) => (rad * 180) / Math.PI;

function fovFor(extentMm: number, focalMm: number): number {
  const focal = Math.max(1e-3, focalMm);
  return toDeg(2 * Math.atan(extentMm / (2 * focal)));
}

/** Diagonal field of view in degrees — the measure the doctrine's anchor bank uses. */
export function diagonalFov(focalMm: number, sensor: SensorSize): number {
  return fovFor(Math.hypot(sensor.widthMm, sensor.heightMm), focalMm);
}

/** Vertical field of view in degrees — what a three.js PerspectiveCamera takes. */
export function verticalFov(focalMm: number, sensor: SensorSize): number {
  return fovFor(sensor.heightMm, focalMm);
}

export function horizontalFov(focalMm: number, sensor: SensorSize): number {
  return fovFor(sensor.widthMm, focalMm);
}

/**
 * Which shot size a framing actually is, from the fraction of a standing figure
 * the frame holds at this distance. Derived, not chosen, so the prompt can never
 * disagree with the render.
 */
export function shotSize(subjectHeightM: number, distanceM: number, verticalFovDeg: number): string {
  const distance = Math.max(0.05, distanceM);
  const frameHeightM = 2 * distance * Math.tan((verticalFovDeg * Math.PI) / 180 / 2);
  const coverage = frameHeightM / Math.max(0.1, subjectHeightM);

  if (coverage <= 0.22) return 'extreme close-up';
  if (coverage <= 0.45) return 'close-up';
  if (coverage <= 0.75) return 'medium close-up';
  if (coverage <= 1.15) return 'medium shot';
  if (coverage <= 1.7) return 'medium wide shot';
  if (coverage <= 3) return 'wide shot';
  if (coverage <= 7) return 'very wide shot';
  return 'extreme wide shot';
}

/** Camera height described against the subject, not in metres. */
export function heightDescriptor(cameraHeightM: number, subjectHeightM: number): string {
  const eye = Math.max(0.1, subjectHeightM) * 0.9;
  const ratio = cameraHeightM / eye;

  if (ratio <= 0.15) return 'camera at ground level';
  if (ratio <= 0.55) return 'low angle, camera well below eye level';
  if (ratio <= 0.85) return 'slightly low angle, camera below eye level';
  if (ratio <= 1.15) return 'camera at eye level';
  if (ratio <= 1.6) return 'slightly high angle, camera above eye level';
  if (ratio <= 2.6) return 'high angle, camera well above eye level';
  return 'looking down from high above';
}

/** Where the subject sits across the frame, in the thirds language a prompt can use. */
export function framePosition(normalisedX: number): string {
  if (!Number.isFinite(normalisedX)) return 'centre frame';
  if (normalisedX <= 0.22) return 'far left of frame';
  if (normalisedX <= 0.42) return 'left of frame';
  if (normalisedX < 0.58) return 'centre frame';
  if (normalisedX < 0.78) return 'right of frame';
  return 'far right of frame';
}

const DEFAULT_ASPECT = 16 / 9;

/**
 * Parse the aspect strings the generate panel offers. Topview also uses
 * 'adaptive', which has no fixed shape — the viewer needs a real number to build
 * a camera, so that and anything unparseable fall back rather than produce a
 * degenerate frustum.
 */
export function aspectRatio(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(value ?? '');
  if (!match) return DEFAULT_ASPECT;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return DEFAULT_ASPECT;
  return width / height;
}

/** Pixel dimensions for a render at a target long edge and aspect. */
export function renderSize(aspect: number, longEdge: number): { width: number; height: number } {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return aspect >= 1
    ? { width: even(longEdge), height: even(longEdge / aspect) }
    : { width: even(longEdge * aspect), height: even(longEdge) };
}
