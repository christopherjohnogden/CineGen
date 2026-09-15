import { describe, expect, it } from 'vitest';
import { passesWithinBudget } from '@/components/sets/shape-shot-modal';
import { REFERENCE_TAGS } from '@/lib/sets/camera-prompt';
import { ALL_PASSES } from '@/lib/sets/scene';

describe('passesWithinBudget', () => {
  it('ships all four when there is room', () => {
    expect(passesWithinBudget(4)).toEqual(['plate', 'composite', 'depth', 'standin']);
    expect(passesWithinBudget(9)).toEqual(ALL_PASSES);
  });

  it('drops the depth map first', () => {
    // The brief is explicit about the order things are given up in.
    expect(passesWithinBudget(3)).toEqual(['plate', 'composite', 'standin']);
  });

  it('drops the stand-in pass second', () => {
    expect(passesWithinBudget(2)).toEqual(['plate', 'composite']);
  });

  it('never gives up the plate or the composite', () => {
    for (const budget of [0, 1, 2, 3, 4]) {
      const passes = passesWithinBudget(budget);
      expect(passes).toContain('plate');
      expect(passes).toContain('composite');
    }
  });

  it('keeps the plate first and the composite second at every budget', () => {
    // Slot order is what makes the @imageN tags name the right reference.
    for (const budget of [2, 3, 4]) {
      expect(passesWithinBudget(budget)[0]).toBe('plate');
      expect(passesWithinBudget(budget)[1]).toBe('composite');
    }
  });

  it('has a tag for every pass it can emit', () => {
    for (const pass of ALL_PASSES) {
      expect(REFERENCE_TAGS[pass]).toBeTruthy();
    }
  });

  it('numbers the tags to match the attach order', () => {
    const tags = passesWithinBudget(4).map((pass) => REFERENCE_TAGS[pass]);
    expect(tags[0]).toContain('@image1');
    expect(tags[1]).toContain('@image2');
    expect(tags[2]).toContain('@image3');
    expect(tags[3]).toContain('@image4');
  });
});
