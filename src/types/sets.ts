/**
 * A Set is a real location captured as a Gaussian splat, used to frame shots
 * before generating them.
 *
 * The splat binary is never carried in here. `splatPath` is an absolute path on
 * the machine that imported it, served to the renderer through Electron's
 * `local-media` protocol. Project state is chunked and rewritten on every
 * debounced save, so a Set stays small: marks and cameras only.
 */

/** A named floor position an actor stand-in snaps to — "doorway", "booth 3". */
export interface SetMark {
  id: string;
  name: string;
  /** Metres, in the Set's own ground plane. */
  x: number;
  z: number;
  /** Radians. 0 faces -Z, matching three.js's default camera forward. */
  facing: number;
}

/**
 * A framing saved inside a Set. Self-contained on purpose: Director framings,
 * Canvas nodes and regenerate-from-camera all replay this record without
 * needing the viewer that produced it.
 */
export interface SetCamera {
  id: string;
  name: string;
  createdAt: string;
  /** Metres, world space. */
  position: [number, number, number];
  target: [number, number, number];
  focalMm: number;
  sensorWidthMm: number;
  sensorHeightMm: number;
  /** The output aspect this was framed against, e.g. '16:9', '2.39:1', '9:16'. */
  aspect: string;
  /** Degrees. Derived from focal + sensor, stored so a replay never recomputes it differently. */
  fovDiagonal: number;
  /** Metres from camera to the subject it was framed on, when there was one. */
  subjectDistance?: number;
}

export type SplatFormat = 'ply' | 'spz' | 'sog' | 'splat' | 'ksplat';

export interface ProjectSet {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Absolute, desktop-local. Absent on a Set opened where the file does not live. */
  splatPath?: string;
  splatFormat?: SplatFormat;
  /** A small orbit still, used as the library card's face. */
  thumbnailUrl?: string;
  /** Which axis the capture treats as up. Scans vary; the viewer corrects on load. */
  upAxis: 'y' | 'z';
  /**
   * Degrees of extra rotation applied after the up-axis preset.
   *
   * Scans come out of training at essentially arbitrary orientation — upside
   * down, mirrored, or yawed — and no preset covers every case, so this is the
   * trim the user dials in once per Set and never touches again.
   */
  rotationDeg?: [number, number, number];
  /** Multiplier taking the capture's units to metres. */
  scaleToMeters: number;
  marks: SetMark[];
  cameras: SetCamera[];
}
