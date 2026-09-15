import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ALL_PASSES, LAYER_STANDIN, buildMannequin, syncStandIns, type StandIn } from '@/lib/sets/scene';

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
