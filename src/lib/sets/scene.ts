import * as THREE from 'three';
import { SparkRenderer, SplatMesh, modifiers, utils as sparkUtils, type SplatMeshOptions } from '@sparkjsdev/spark';

import type { ProjectSet, SetCamera } from '@/types/sets';
import { FULL_FRAME, aspectRatio, verticalFov, type SensorSize } from './optics';

/**
 * The three.js scene behind the Set viewer.
 *
 * Splats and stand-in meshes live on separate layers so the four export passes
 * are the same scene rendered with different layers enabled, rather than four
 * scenes that could drift apart. Spark fuses splats into the normal three.js
 * pipeline; opaque stand-ins render first and splats blend over them wherever
 * the splats pass the depth test.
 */

/**
 * Full-detail local scans. Transparent splats must not write depth: their
 * low-opacity edges would reject other splats before they can blend. Z sorting
 * matches conventional 3DGS training; radial sorting can change layer order.
 * Extended accumulation preserves the precision of the extended source data.
 */
export const SCAN_QUALITY = {
  depthTest: true,
  depthWrite: false,
  sortRadial: false,
  accumExtSplats: true,
  /** A local scan should render at full detail rather than stream. */
  enableLod: false,
  /** Preserve broad Gaussians that were trained to cover continuous surfaces. */
  maxPixelRadius: 1024,
} as const;

/** The knobs worth exposing, because the right value differs per capture. */
export interface ScanTuning {
  maxPixelRadius: number;
  preBlurAmount: number;
  blurAmount: number;
  maxStdDev: number;
  minAlpha: number;
}

export const DEFAULT_SCAN_TUNING: ScanTuning = {
  maxPixelRadius: SCAN_QUALITY.maxPixelRadius,
  // Spirula's standard 3DGS uses dilation WITHOUT opacity compensation.
  // Mip-trained scans instead use blurAmount with compensation.
  preBlurAmount: 0.3,
  blurAmount: 0,
  maxStdDev: 3.33,
  minAlpha: 1 / 255,
};

/** Apply tuning to a live renderer — these are plain mutable fields. */
export function applyScanTuning(spark: SparkRenderer, tuning: ScanTuning): void {
  spark.maxPixelRadius = tuning.maxPixelRadius;
  spark.preBlurAmount = tuning.preBlurAmount;
  spark.blurAmount = tuning.blurAmount;
  spark.maxStdDev = tuning.maxStdDev;
  spark.minAlpha = tuning.minAlpha;
}

/** Layer 0 is the splat environment, layer 1 the stand-ins. */
export const LAYER_ENVIRONMENT = 0;
export const LAYER_STANDIN = 1;

export type PoseId = 'standing' | 'sitting' | 'walking' | 'kneeling';

export interface StandIn {
  id: string;
  /** Metres, head to toe. */
  heightM: number;
  pose: PoseId;
  /** World position on the ground plane, metres. */
  x: number;
  z: number;
  /** Radians. */
  facing: number;
  /** Set when this stand-in was placed from a Character Element. */
  elementId?: string;
  label?: string;
}

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  spark: SparkRenderer;
  splat: SplatMesh | null;
  standInGroup: THREE.Group;
  dispose(): void;
}

/** A mannequin built from primitives — no external asset, no loader, no network. */
export function buildMannequin(standIn: StandIn): THREE.Group {
  const group = new THREE.Group();
  const h = Math.max(0.3, standIn.heightM);

  // Deliberately flat and untextured: this is a placement guide, and it has to
  // read as obviously synthetic in the stand-in pass so the model excludes it.
  const material = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85, metalness: 0 });

  const add = (geo: THREE.BufferGeometry, y: number, x = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.layers.set(LAYER_STANDIN);
    group.add(mesh);
    return mesh;
  };

  // Proportions as fractions of height, adjusted per pose.
  const seated = standIn.pose === 'sitting';
  const kneeling = standIn.pose === 'kneeling';
  const effective = seated ? h * 0.62 : kneeling ? h * 0.72 : h;

  const headR = h * 0.047;
  const torsoH = effective * 0.34;
  const legH = effective - torsoH - headR * 2;

  add(new THREE.CapsuleGeometry(h * 0.055, Math.max(0.05, legH * 0.5), 4, 8), legH * 0.5, -h * 0.045);
  add(new THREE.CapsuleGeometry(h * 0.055, Math.max(0.05, legH * 0.5), 4, 8), legH * 0.5, h * 0.045);
  add(new THREE.CapsuleGeometry(h * 0.1, torsoH * 0.6, 4, 10), legH + torsoH * 0.5);
  add(new THREE.SphereGeometry(headR, 14, 12), legH + torsoH + headR);
  // Arms — offset forward when walking so the silhouette reads as motion.
  const armZ = standIn.pose === 'walking' ? h * 0.06 : 0;
  add(new THREE.CapsuleGeometry(h * 0.032, torsoH * 0.55, 4, 8), legH + torsoH * 0.5, -h * 0.13, armZ);
  add(new THREE.CapsuleGeometry(h * 0.032, torsoH * 0.55, 4, 8), legH + torsoH * 0.5, h * 0.13, -armZ);

  group.position.set(standIn.x, 0, standIn.z);
  group.rotation.y = standIn.facing;
  group.userData.standInId = standIn.id;
  return group;
}

export function syncStandIns(group: THREE.Group, standIns: StandIn[], groundY = 0): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
  }
  // Mannequins are built standing on y=0, so the whole group rides the scan's
  // floor rather than the world origin.
  group.position.y = groundY;
  for (const standIn of standIns) group.add(buildMannequin(standIn));
}

/**
 * Orient a loaded scan.
 *
 * The up-axis preset is the coarse correction; `rotationDeg` is the per-Set trim
 * on top, because captures land at arbitrary orientation and no preset covers
 * upside-down, mirrored and yawed all at once.
 */
export function applySetOrientation(splat: SplatMesh, set: Pick<ProjectSet, 'upAxis' | 'rotationDeg' | 'scaleToMeters'>): void {
  const [x, y, z] = set.rotationDeg ?? [0, 0, 0];
  const base = set.upAxis === 'z' ? -Math.PI / 2 : 0;
  splat.rotation.set(base + THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
  splat.scale.setScalar(set.scaleToMeters > 0 ? set.scaleToMeters : 1);
}

/** Apply a saved camera record to a live three.js camera. */
export function applyCamera(
  camera: THREE.PerspectiveCamera,
  record: Pick<SetCamera, 'position' | 'target' | 'focalMm' | 'aspect'>,
  sensor: SensorSize = FULL_FRAME,
): void {
  camera.position.set(...record.position);
  camera.lookAt(new THREE.Vector3(...record.target));
  camera.fov = verticalFov(record.focalMm, sensor);
  camera.aspect = aspectRatio(record.aspect);
  camera.updateProjectionMatrix();
}

export interface CreateSceneOptions {
  canvas: HTMLCanvasElement;
  set: ProjectSet;
  /** Resolved to a fetchable url by the caller — local-media:// on desktop. */
  splatUrl?: string;
  /**
   * Build the splats procedurally instead of loading a file. Lets the viewer be
   * exercised end to end without a scan on disk, and leaves room for generated
   * environments later.
   */
  constructSplats?: SplatMeshOptions['constructSplats'];
  onSplatProgress?: (fraction: number) => void;
}

export async function createScene(options: CreateSceneOptions): Promise<SceneContext> {
  const { canvas, set, splatUrl } = options;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch (cause) {
    // A failed context can also follow a graphics-process crash or resource
    // exhaustion; do not claim that desktop acceleration is always disabled.
    const isDesktop = typeof window !== 'undefined' && Boolean(window.electronAPI);
    throw new Error(isDesktop
      ? 'The 3D viewer could not start the graphics renderer. Restart CineGen and reopen this scan.'
      : 'This browser could not open a WebGL context, which the 3D viewer needs.',
      { cause });
  }
  // Render at the display's real pixel density; a scan is judged on detail.
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f11);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 2000);
  camera.position.set(0, 1.6, 4);
  camera.layers.enableAll();

  const spark = new SparkRenderer({ renderer, ...SCAN_QUALITY, ...DEFAULT_SCAN_TUNING });
  scene.add(spark);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 6, 4);
  scene.add(key);

  const standInGroup = new THREE.Group();
  scene.add(standInGroup);

  let splat: SplatMesh | null = null;
  if (splatUrl || options.constructSplats) {
    splat = new SplatMesh({
      // Keep position/scale/color precision instead of the compact mobile format.
      // Procedural builders use Spark's PackedSplats construction API.
      extSplats: Boolean(splatUrl),
      lod: false,
      ...(splatUrl ? { url: splatUrl } : {}),
      ...(options.constructSplats ? { constructSplats: options.constructSplats } : {}),
      onLoad: () => options.onSplatProgress?.(1),
    });
    // Scans come out of training in arbitrary units and orientation.
    applySetOrientation(splat, set);
    splat.layers.set(LAYER_ENVIRONMENT);
    scene.add(splat);
    await splat.initialized;
  }

  return {
    scene,
    camera,
    renderer,
    spark,
    splat,
    standInGroup,
    dispose() {
      syncStandIns(standInGroup, [], 0);
      splat?.dispose?.();
      spark.dispose();
      scene.clear();
      renderer.dispose();
    },
  };
}

export type PassKind = 'plate' | 'composite' | 'depth' | 'standin';

/** Every pass Shape Shot can attach, in the reference-slot order the brief fixes. */
export const ALL_PASSES: PassKind[] = ['plate', 'composite', 'depth', 'standin'];

function applyPassVisibility(ctx: SceneContext, kind: PassKind): () => void {
  const { splat, standInGroup, camera } = ctx;
  const splatWasVisible = splat?.visible ?? false;
  const standInsWereVisible = standInGroup.visible;
  const maskWas = camera.layers.mask;

  if (kind === 'plate') {
    if (splat) splat.visible = true;
    standInGroup.visible = false;
  } else if (kind === 'standin') {
    if (splat) splat.visible = false;
    standInGroup.visible = true;
  } else {
    if (splat) splat.visible = true;
    standInGroup.visible = true;
  }

  return () => {
    if (splat) splat.visible = splatWasVisible;
    standInGroup.visible = standInsWereVisible;
    camera.layers.mask = maskWas;
  };
}

/**
 * Render one pass offscreen at an exact pixel size and return its RGBA bytes.
 *
 * Renders through an offscreen target rather than reading the on-screen canvas,
 * so a render is the generation's output resolution regardless of how large the
 * viewer happens to be on screen.
 */
export async function renderPass(
  ctx: SceneContext,
  kind: PassKind,
  width: number,
  height: number,
  tuning: ScanTuning = DEFAULT_SCAN_TUNING,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const restore = applyPassVisibility(ctx, kind);
  const depthRestore = kind === 'depth' ? applyDepthColor(ctx) : undefined;

  // In Spark 2.2 the offscreen viewpoint is a SparkRenderer configured with a
  // `target`, so a pass renders at the generation's exact output resolution
  // rather than whatever size the viewer happens to be on screen.
  // Same quality settings as the viewport, or an export would not match what
  // the user framed.
  const offscreen = new SparkRenderer({
    renderer: ctx.renderer,
    ...SCAN_QUALITY,
    autoUpdate: false,
    target: { width, height, superXY: 2 },
  });
  applyScanTuning(offscreen, tuning);
  // Only one Spark draw may contribute, otherwise transparent splats blend twice.
  const viewportVisible = ctx.spark.visible;
  ctx.spark.visible = false;
  ctx.scene.add(offscreen);

  try {
    // Sorting runs asynchronously. A fresh target must finish it before readback.
    ctx.scene.updateMatrixWorld(true);
    await offscreen.update({ scene: ctx.scene, camera: ctx.camera });
    const data = await offscreen.renderReadTarget({ scene: ctx.scene, camera: ctx.camera });
    return { data, width, height };
  } finally {
    ctx.scene.remove(offscreen);
    ctx.spark.visible = viewportVisible;
    offscreen.dispose();
    depthRestore?.();
    restore();
  }
}

/**
 * Recolour the scene by distance from camera.
 *
 * Spark ships a depth modifier for the splats; the stand-in meshes need the
 * equivalent, which is what MeshDepthMaterial already is. Both are keyed to the
 * same near/far window so the two halves of the map agree.
 */
export function applyDepthColor(ctx: SceneContext): () => void {
  const { splat, standInGroup, camera, scene } = ctx;
  const near = Math.max(0.1, camera.near);
  const far = Math.min(camera.far, 60);

  if (splat) modifiers.setDepthColor(splat, near, far, false);

  const previousOverride = scene.overrideMaterial;
  const previousBackground = scene.background;
  // Stand-ins and splats must share one depth encoding, so the meshes get a
  // matching linear-depth material rather than the scene's lit materials.
  const depthMaterial = new THREE.MeshDepthMaterial();
  standInGroup.traverse((node) => {
    if (node instanceof THREE.Mesh) node.userData.depthSwap = node.material;
  });
  standInGroup.traverse((node) => {
    if (node instanceof THREE.Mesh) node.material = depthMaterial;
  });
  scene.background = new THREE.Color(0x000000);

  return () => {
    standInGroup.traverse((node) => {
      if (node instanceof THREE.Mesh && node.userData.depthSwap) {
        node.material = node.userData.depthSwap as THREE.Material;
        delete node.userData.depthSwap;
      }
    });
    depthMaterial.dispose();
    scene.background = previousBackground;
    scene.overrideMaterial = previousOverride;
    // setDepthColor installs a *world* modifier and regenerates; clearing the
    // object modifier would undo nothing and leave the splat depth-coloured for
    // every later pass and for the live viewport.
    if (splat) {
      splat.worldModifier = undefined;
      splat.updateGenerator();
    }
  };
}

/** Pack RGBA bytes into a PNG blob, flipping GL's bottom-up rows. */
export async function rgbaToPngBlob(data: Uint8Array, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not open a 2D context to encode the render.');

  // GL reads bottom-up; Spark ships the flip so the encoding matches its own.
  const image = context.createImageData(width, height);
  image.data.set(sparkUtils.flipPixels(data, width, height));
  context.putImageData(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the render as a PNG.'))),
      'image/png',
    );
  });
}
