import { describe, expect, it } from 'vitest';
import {
  applyClickSelection,
  applyContextSelection,
  boxToRect,
  clampMenuPosition,
  deleteIdsForContext,
  idsIntersectingMarquee,
  isAdditiveClick,
  marqueeBox,
  mergeMarqueeHits,
  pruneSelection,
  rectsIntersect,
} from '@/lib/elements/selection';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('isAdditiveClick', () => {
  it('treats meta and ctrl as additive', () => {
    expect(isAdditiveClick({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe(true);
    expect(isAdditiveClick({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe(true);
    expect(isAdditiveClick({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe(false);
  });
});

describe('applyClickSelection', () => {
  it('plain click selects one and asks to open', () => {
    const result = applyClickSelection(ids, new Set(['a', 'b']), 'a', 'c', {
      metaKey: false, ctrlKey: false, shiftKey: false,
    });
    expect([...result.selected]).toEqual(['c']);
    expect(result.lastClicked).toBe('c');
    expect(result.shouldOpen).toBe(true);
  });

  it('cmd-click toggles membership without opening', () => {
    const added = applyClickSelection(ids, new Set(['a']), 'a', 'c', {
      metaKey: true, ctrlKey: false, shiftKey: false,
    });
    expect(added.selected.has('a')).toBe(true);
    expect(added.selected.has('c')).toBe(true);
    expect(added.shouldOpen).toBe(false);

    const removed = applyClickSelection(ids, new Set(['a', 'c']), 'c', 'c', {
      metaKey: true, ctrlKey: false, shiftKey: false,
    });
    expect(removed.selected.has('c')).toBe(false);
    expect(removed.selected.has('a')).toBe(true);
    expect(removed.shouldOpen).toBe(false);
  });

  it('shift-click selects a range from the last clicked card', () => {
    const result = applyClickSelection(ids, new Set(['a']), 'a', 'd', {
      metaKey: false, ctrlKey: false, shiftKey: true,
    });
    expect([...result.selected]).toEqual(['a', 'b', 'c', 'd']);
    expect(result.lastClicked).toBe('a');
    expect(result.shouldOpen).toBe(false);
  });

  it('shift+cmd-click adds the range to the existing selection', () => {
    const result = applyClickSelection(ids, new Set(['e']), 'b', 'd', {
      metaKey: true, ctrlKey: false, shiftKey: true,
    });
    expect(result.selected.has('e')).toBe(true);
    expect(result.selected.has('b')).toBe(true);
    expect(result.selected.has('c')).toBe(true);
    expect(result.selected.has('d')).toBe(true);
    expect(result.shouldOpen).toBe(false);
  });
});

describe('applyContextSelection', () => {
  it('keeps a multi-selection when right-clicking a selected card', () => {
    const selected = new Set(['a', 'b', 'c']);
    expect(applyContextSelection(selected, 'b')).toBe(selected);
  });

  it('replaces the selection when right-clicking an unselected card', () => {
    const next = applyContextSelection(new Set(['a', 'b']), 'd');
    expect([...next]).toEqual(['d']);
  });
});

describe('deleteIdsForContext', () => {
  it('deletes the whole selection when the context target is selected', () => {
    expect(deleteIdsForContext(new Set(['a', 'b', 'c']), 'b').sort()).toEqual(['a', 'b', 'c']);
  });

  it('deletes only the target when it is not in the selection', () => {
    expect(deleteIdsForContext(new Set(['a']), 'z')).toEqual(['z']);
  });

  it('deletes the selection when right-clicking empty space', () => {
    expect(deleteIdsForContext(new Set(['a', 'b']), null).sort()).toEqual(['a', 'b']);
  });
});

describe('pruneSelection', () => {
  it('drops ids that are no longer in the visible list', () => {
    const next = pruneSelection(new Set(['a', 'gone', 'c']), ['a', 'c']);
    expect([...next].sort()).toEqual(['a', 'c']);
  });

  it('returns the same set when nothing changed', () => {
    const selected = new Set(['a', 'b']);
    expect(pruneSelection(selected, ['a', 'b', 'c'])).toBe(selected);
  });
});

describe('marquee geometry', () => {
  it('builds a box from any drag direction', () => {
    expect(marqueeBox(10, 10, 4, 20)).toEqual({ left: 4, top: 10, width: 6, height: 10 });
  });

  it('intersects cards that overlap the marquee', () => {
    const hits = idsIntersectingMarquee(
      [
        { id: 'a', rect: { left: 0, top: 0, right: 10, bottom: 10 } },
        { id: 'b', rect: { left: 20, top: 0, right: 30, bottom: 10 } },
        { id: 'c', rect: { left: 8, top: 8, right: 18, bottom: 18 } },
      ],
      boxToRect({ left: 5, top: 5, width: 10, height: 10 }),
    );
    expect([...hits].sort()).toEqual(['a', 'c']);
  });

  it('does not count touching-only edges as hits', () => {
    expect(rectsIntersect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 10, top: 0, right: 20, bottom: 10 },
    )).toBe(false);
  });

  it('merges marquee hits onto a cmd-drag preselection', () => {
    const merged = mergeMarqueeHits(new Set(['keep']), new Set(['a', 'b']));
    expect(merged.has('keep')).toBe(true);
    expect(merged.has('a')).toBe(true);
    expect(merged.has('b')).toBe(true);
  });
});

describe('clampMenuPosition', () => {
  it('keeps the menu inside the viewport', () => {
    expect(clampMenuPosition(900, 700, 160, 40, 800, 600, 8)).toEqual({ x: 632, y: 552 });
    expect(clampMenuPosition(-20, -20, 160, 40, 800, 600, 8)).toEqual({ x: 8, y: 8 });
  });
});
