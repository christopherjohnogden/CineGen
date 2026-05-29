import { describe, expect, it } from 'vitest';
import { resolvePlacement, type PlacementTarget } from '@/lib/higgsfield/placement';
import type { Clip, Timeline } from '@/types/timeline';

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'startTime' | 'duration'>): Clip {
  return {
    assetId: 'a', name: over.id, trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
    flipH: false, flipV: false, keyframes: [], ...over,
  } as Clip;
}

function timeline(clips: Clip[]): Timeline {
  return {
    id: 't', name: 'T', tracks: [
      { id: 'V', name: 'V1', kind: 'video', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'A', name: 'A1', kind: 'audio', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
    clips, duration: 0, transitions: [], markers: [],
  };
}

describe('resolvePlacement', () => {
  const tl = timeline([
    clip({ id: 'c1', trackId: 'V', startTime: 0, duration: 5 }),
    clip({ id: 'c2', trackId: 'V', startTime: 5, duration: 5 }),
  ]);

  it('append: places after the last clip on the target track', () => {
    const target: PlacementTarget = { mode: 'append', trackId: 'V' };
    expect(resolvePlacement(tl, target)).toEqual({ trackId: 'V', startTime: 10 });
  });

  it('append: startTime 0 on an empty track', () => {
    const target: PlacementTarget = { mode: 'append', trackId: 'A' };
    expect(resolvePlacement(tl, target)).toEqual({ trackId: 'A', startTime: 0 });
  });

  it('insert_after: places right after the referenced clip ends', () => {
    const target: PlacementTarget = { mode: 'insert_after', clipId: 'c1' };
    expect(resolvePlacement(tl, target)).toEqual({ trackId: 'V', startTime: 5 });
  });

  it('replace: returns the referenced clip start + its id to remove', () => {
    const target: PlacementTarget = { mode: 'replace', clipId: 'c2' };
    expect(resolvePlacement(tl, target)).toEqual({ trackId: 'V', startTime: 5, replaceClipId: 'c2' });
  });

  it('explicit: passes through a given track + startTime', () => {
    const target: PlacementTarget = { mode: 'explicit', trackId: 'V', startTime: 3 };
    expect(resolvePlacement(tl, target)).toEqual({ trackId: 'V', startTime: 3 });
  });

  it('throws for insert_after/replace referencing a missing clip', () => {
    expect(() => resolvePlacement(tl, { mode: 'insert_after', clipId: 'nope' })).toThrow();
    expect(() => resolvePlacement(tl, { mode: 'replace', clipId: 'nope' })).toThrow();
  });

  it('throws for append on a missing track', () => {
    expect(() => resolvePlacement(tl, { mode: 'append', trackId: 'ZZ' })).toThrow();
  });
});
