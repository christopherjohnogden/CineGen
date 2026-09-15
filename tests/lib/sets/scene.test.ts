import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ALL_PASSES, LAYER_STANDIN, applyDepthColor, buildMannequin, syncStandIns, type StandIn } from '@/lib/sets/scene';

function standIn(overrides: Partial<StandIn> = {}): StandIn {
  return { id: 'a', heightM: 1.8, pose: 'standing', x: 0, z: 0, facing: 0, ...overrides };
}

describe('buildMannequin', () => {
  it('places the figure at its mark, facing its rotation', () => {
    const group = buildMannequin(standIn({ x: 2.5, z: -1.25, facing: Math.PI / 2 }));
    expect(group.position.x).toBe(2.5);
    expect(group.position.z).toBe(-1.25);
    expect(group.position.y).toBe(0);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  });

  it('puts every part on the stand-in layer so the passes can isolate it', () => {
    const group = buildMannequin(standIn());
    const meshes: THREE.Mesh[] = [];
    group.traverse((node) => { if (node instanceof THREE.Mesh) meshes.push(node); });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.layers.isEnabled(LAYER_STANDIN)).toBe(true);
    }
  });

  it('scales with the figure, so a child is not an adult', () => {
    const box = (height: number) => new THREE.Box3()
      .setFromObject(buildMannequin(standIn({ heightM: height })))
      .getSize(new THREE.Vector3()).y;
    const child = box(1.2);
    const adult = box(1.9);
    expect(adult).toBeGreaterThan(child);
    // Roughly proportional — the head sphere adds a little over the nominal height.
    expect(adult / child).toBeCloseTo(1.9 / 1.2, 1);
  });

  it('makes a seated figure shorter than a standing one of the same height', () => {
    const height = (pose: StandIn['pose']) => new THREE.Box3()
      .setFromObject(buildMannequin(standIn({ pose })))
      .getSize(new THREE.Vector3()).y;
    expect(height('sitting')).toBeLessThan(height('standing'));
    expect(height('kneeling')).toBeLessThan(height('standing'));
  });

  it('carries its id so a click in the viewer can resolve back to the stand-in', () => {
    expect(buildMannequin(standIn({ id: 'booth-3' })).userData.standInId).toBe('booth-3');
  });

  it('supports tiny figures for scans with uncalibrated units, without a hidden minimum', () => {
    const figure = buildMannequin(standIn({ heightM: .04 }));
    const bounds = new THREE.Box3().setFromObject(figure);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y).toBeCloseTo(.04, 6);
  });

  it('anchors every human pose at the soles and uses the detailed mesh', () => {
    for (const pose of ['standing', 'walking', 'sitting', 'kneeling'] as const) {
      const figure = buildMannequin(standIn({ pose }));
      expect(new THREE.Box3().setFromObject(figure).min.y).toBeCloseTo(0, 6);
      const mesh = figure.children[0] as THREE.Mesh;
      expect(mesh.geometry.index!.count).toBeGreaterThan(30000);
    }
  });
});

describe('syncStandIns', () => {
  it('replaces the group contents and disposes what it removed', () => {
    const group = new THREE.Group();
    syncStandIns(group, [standIn({ id: 'a' }), standIn({ id: 'b', x: 1 })]);
    expect(group.children).toHaveLength(2);

    syncStandIns(group, [standIn({ id: 'c' })]);
    expect(group.children).toHaveLength(1);
    expect(group.children[0].userData.standInId).toBe('c');

    syncStandIns(group, []);
    expect(group.children).toHaveLength(0);
  });
});

describe('ALL_PASSES', () => {
  it('is in the reference-slot order the attach mapping fixes', () => {
    // Ref1 plate, Ref2 composite, Ref3 depth, Ref4 stand-in.
    expect(ALL_PASSES).toEqual(['plate', 'composite', 'depth', 'standin']);
  });
});

describe('applyDepthColor', () => {
  // Spark's setDepthColor installs a *world* modifier and regenerates. Undoing
  // it means clearing that same field and regenerating again — clearing the
  // object modifier instead silently leaves the splat depth-coloured for every
  // later pass and for the live viewport.
  function fakeContext() {
    const splat = {
      enableWorldToView: false,
      worldModifier: undefined as unknown,
      objectModifier: undefined as unknown,
      context: { worldToView: {} },
      generatorUpdates: 0,
      updateGenerator() { this.generatorUpdates += 1; },
    };
    const standInGroup = new THREE.Group();
    standInGroup.add(buildMannequin(standIn()));
    const scene = new THREE.Scene();
    scene.add(standInGroup);
    return {
      scene,
      standInGroup,
      splat,
      camera: new THREE.PerspectiveCamera(50, 1.78, 0.1, 1000),
    };
  }

  it('recolours the splat and puts it back exactly as it was', () => {
    const ctx = fakeContext();
    const restore = applyDepthColor(ctx as never);

    expect(ctx.splat.worldModifier).toBeDefined();
    expect(ctx.splat.generatorUpdates).toBe(1);

    restore();

    expect(ctx.splat.worldModifier).toBeUndefined();
    // A second regenerate is what actually makes the clear take effect.
    expect(ctx.splat.generatorUpdates).toBe(2);
  });

  it('swaps the stand-in materials for depth and restores the originals', () => {
    const ctx = fakeContext();
    const meshes: THREE.Mesh[] = [];
    ctx.standInGroup.traverse((node) => { if (node instanceof THREE.Mesh) meshes.push(node); });
    const original = meshes.map((mesh) => mesh.material);

    const restore = applyDepthColor(ctx as never);
    for (const mesh of meshes) expect(mesh.material).toBeInstanceOf(THREE.MeshDepthMaterial);

    restore();
    meshes.forEach((mesh, index) => expect(mesh.material).toBe(original[index]));
  });

  it('restores the scene background', () => {
    const ctx = fakeContext();
    const background = new THREE.Color(0x0e0f11);
    ctx.scene.background = background;

    const restore = applyDepthColor(ctx as never);
    restore();

    expect(ctx.scene.background).toBe(background);
  });
});
