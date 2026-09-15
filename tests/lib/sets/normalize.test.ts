import { describe, expect, it } from 'vitest';
import { normalizeProjectSets } from '@/lib/sets/normalize';

describe('normalizeProjectSets', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeProjectSets(undefined)).toEqual([]);
    expect(normalizeProjectSets(null)).toEqual([]);
    expect(normalizeProjectSets('sets')).toEqual([]);
    expect(normalizeProjectSets({ 0: {} })).toEqual([]);
  });

  it('drops entries that cannot be a record', () => {
    expect(normalizeProjectSets([null, 3, 'x', [], undefined])).toEqual([]);
  });

  it('keeps a well-formed set intact', () => {
    const set = {
      id: 'set-1',
      name: 'Diner',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      splatPath: '/Users/chris/Scans/diner.ply',
      splatFormat: 'ply',
      upAxis: 'z',
      scaleToMeters: 0.5,
      marks: [{ id: 'm1', name: 'booth 3', x: 1.5, z: -2, facing: 1.57 }],
      cameras: [{
        id: 'c1', name: 'Wide', createdAt: '2026-09-02T10:00:00.000Z',
        position: [0, 1.6, 4], target: [0, 1.5, 0],
        focalMm: 35, sensorWidthMm: 36, sensorHeightMm: 24,
        aspect: '2.39:1', fovDiagonal: 63.4, subjectDistance: 4.1,
      }],
    };
    expect(normalizeProjectSets([set])[0]).toEqual(set);
  });

  it('mints an id and timestamps when they are missing', () => {
    const [set] = normalizeProjectSets([{ name: 'Rooftop' }]);
    expect(set.id).toMatch(/.+/);
    expect(set.name).toBe('Rooftop');
    expect(set.createdAt).toMatch(/^\d{4}-/);
    expect(set.updatedAt).toMatch(/^\d{4}-/);
  });

  it('gives every set a usable default so the viewer never divides by zero', () => {
    const [set] = normalizeProjectSets([{ id: 's', scaleToMeters: 0, upAxis: 'nonsense' }]);
    expect(set.scaleToMeters).toBe(1);
    expect(set.upAxis).toBe('y');
    expect(set.marks).toEqual([]);
    expect(set.cameras).toEqual([]);
    expect(set.name).toBe('Untitled Set');
  });

  it('discards marks and cameras with unusable geometry rather than passing NaN to three.js', () => {
    const [set] = normalizeProjectSets([{
      id: 's',
      marks: [
        { id: 'ok', name: 'door', x: 1, z: 2, facing: 0 },
        { id: 'bad', name: 'broken', x: 'left', z: 2, facing: 0 },
        { id: 'nan', name: 'nan', x: Number.NaN, z: 0, facing: 0 },
      ],
      cameras: [
        { id: 'cbad', name: 'short', position: [0, 1], target: [0, 0, 0], focalMm: 50 },
        { id: 'cok', name: 'fine', position: [0, 1, 2], target: [0, 1, 0], focalMm: 50 },
      ],
    }]);
    expect(set.marks.map((m) => m.id)).toEqual(['ok']);
    expect(set.cameras.map((c) => c.id)).toEqual(['cok']);
  });

  it('falls back to sane optics when a stored camera omits them', () => {
    const [set] = normalizeProjectSets([{
      id: 's',
      cameras: [{ id: 'c', position: [0, 0, 0], target: [0, 0, -1] }],
    }]);
    expect(set.cameras[0].focalMm).toBe(50);
    expect(set.cameras[0].sensorWidthMm).toBe(36);
    expect(set.cameras[0].sensorHeightMm).toBe(24);
    expect(set.cameras[0].aspect).toBe('16:9');
    expect(set.cameras[0].fovDiagonal).toBeGreaterThan(0);
  });

  it('drops an unrecognised splat format rather than handing it to the loader', () => {
    const [set] = normalizeProjectSets([{ id: 's', splatPath: '/x/y.exe', splatFormat: 'exe' }]);
    expect(set.splatFormat).toBeUndefined();
  });
});
