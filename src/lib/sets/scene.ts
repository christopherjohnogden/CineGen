import * as THREE from 'three';
import { SparkRenderer, SplatMesh, modifiers, utils as sparkUtils } from '@sparkjsdev/spark';

import type { ProjectSet, SetCamera } from '@/types/sets';
import { FULL_FRAME, aspectRatio, verticalFov, type SensorSize } from './optics';

/**
 * The three.js scene behind the Set viewer.
 *
 * Splats and stand-in meshes live on separate layers so the four export passes
 * are the same scene rendered with different layers enabled, rather than four
 * scenes that could drift apart. Spark fuses splats into the normal three.js
 * pipeline, so a GLB mannequin occludes and is occluded correctly once
 * depth testing is on.
 */

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

export function syncStandIns(group: THREE.Group, standIns: StandIn[]): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
  }
  for (const standIn of standIns) group.add(buildMannequin(standIn));
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
  onSplatProgress?: (fraction: number) => void;
}

export async function createScene(options: CreateSceneOptions): Promise<SceneContext> {
  const { canvas, set, splatUrl } = options;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f11);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 2000);
  camera.position.set(0, 1.6, 4);
  camera.layers.enableAll();

  // depthWrite lets splats and mannequin meshes occlude each other correctly.
  const spark = new SparkRenderer({ renderer, depthTest: true, depthWrite: true });
  scene.add(spark);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 6, 4);
  scene.add(key);

  const standInGroup = new THREE.Group();
  scene.add(standInGroup);

  let splat: SplatMesh | null = null;
  if (splatUrl) {
    splat = new SplatMesh({ url: splatUrl, onLoad: () => options.onSplatProgress?.(1) });
    // Scans come out of training in arbitrary units and orientation.
    if (set.upAxis === 'z') splat.rotation.x = -Math.PI / 2;
    splat.scale.setScalar(set.scaleToMeters);
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
      syncStandIns(standInGroup, []);
      splat?.dispose?.();
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
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const restore = applyPassVisibility(ctx, kind);
  const depthRestore = kind === 'depth' ? applyDepthColor(ctx) : undefined;

  // In Spark 2.2 the offscreen viewpoint is a SparkRenderer configured with a
  // `target`, so a pass renders at the generation's exact output resolution
  // rather than whatever size the viewer happens to be on screen.
  const offscreen = new SparkRenderer({
    renderer: ctx.renderer,
    depthTest: true,
    depthWrite: true,
    target: { width, height, superXY: 2 },
  });
  ctx.scene.add(offscreen);

  try {
    const data = await offscreen.renderReadTarget({ scene: ctx.scene, camera: ctx.camera });
    return { data, width, height };
  } finally {
    ctx.scene.remove(offscreen);
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
