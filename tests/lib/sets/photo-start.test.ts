import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { loadPhotoStart, parsePhotoStart } from '@/lib/sets/photo-start';
import { resolveStartView } from '@/lib/sets/start-view';
import { normalizeProjectSets } from '@/lib/sets/normalize';

const metadata = {
  format: 'cinegen-start-view', version: 1, coordinates: 'splat-local',
  position: [1, 2, 3], target: [1, 2, 2], up: [0, 1, 0], verticalFov: 48, sourceImage: 'frame-00002.jpg',
};
afterEach(() => vi.unstubAllGlobals());

describe('original photo starting view', () => {
  it('moves the photo pose with the scan and preserves the lens angle', () => {
    const photo = parsePhotoStart(metadata)!;
    const set = normalizeProjectSets([{}])[0];
    const mesh = new THREE.Object3D();
    mesh.rotation.z = Math.PI / 2;
    mesh.scale.setScalar(2);
    const view = resolveStartView(mesh as unknown as SplatMesh, set, false, photo);
    expect(new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(-4, 2, 6))).toBeLessThan(1e-8);
    expect(new THREE.Vector3(...view.up!).distanceTo(new THREE.Vector3(-1, 0, 0))).toBeLessThan(1e-8);
    expect(view.verticalFov).toBe(48);
    expect(view.sourceImage).toBe('frame-00002.jpg');
  });

  it('prioritizes a saved view and retains photo information across project reloads', () => {
    const photo = parsePhotoStart(metadata)!;
    const set = normalizeProjectSets([{ startView: { ...photo, position: [4, 5, 6] } }])[0];
    expect(resolveStartView(null, set, false, photo)).toEqual(set.startView);
    expect(set.startView?.verticalFov).toBe(48);
    expect(set.startView?.sourceImage).toBe(metadata.sourceImage);
    expect(resolveStartView(null, set, true, photo).position).toEqual([0, 1.6, 0]);
  });

  it.each([
    { format: 'unknown' }, { coordinates: 'world' }, { version: 2 },
    { position: [NaN, 0, 0] }, { target: [1, 2, 3] }, { up: [0, 0, 0] },
    { up: [0, 0, 1] }, { verticalFov: Infinity }, { verticalFov: 180 },
  ])('rejects invalid or ambiguous metadata: %j', (invalid) => {
    expect(parsePhotoStart({ ...metadata, ...invalid })).toBeNull();
  });

  it('loads only the matching named companion and tolerates missing metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => metadata });
    vi.stubGlobal('fetch', fetcher);
    expect(await loadPhotoStart('local-media://file/my%20scans/Room.ply')).toEqual(parsePhotoStart(metadata));
    expect(fetcher.mock.calls[0][0]).toBe('local-media://file/my%20scans/Room.start-view.json');
    fetcher.mockResolvedValue({ ok: false });
    expect(await loadPhotoStart('local-media://file/Other.ply')).toBeNull();
    fetcher.mockRejectedValue(new Error('Missing file'));
    expect(await loadPhotoStart('local-media://file/Other.ply')).toBeNull();
  });
});
