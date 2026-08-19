import { describe, expect, it } from 'vitest';
import { applyManualTag, detectSceneAssets, highlightRuns, resolveSceneAssets } from '@/lib/director/scene-assets';
import type { DirectorBreakdownItem, DirectorShow } from '@/types/director';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';

const bd = (over: Partial<DirectorBreakdownItem>): DirectorBreakdownItem => ({
  id: over.id ?? over.name!, kind: 'prop', name: 'x', tag: '@x', description: '', ...over,
});
const BREAKDOWN: DirectorBreakdownItem[] = [
  bd({ name: 'Dr. Jordan', tag: '@Dr-Jordan', kind: 'character' }),
  bd({ name: 'Chesterfield Sofa', tag: '@Chesterfield-Sofa', kind: 'prop' }),
  bd({ name: 'Sofa', tag: '@Sofa', kind: 'prop' }),
];

describe('highlightRuns', () => {
  it('produces non-overlapping, longest-first typed runs (no nesting)', () => {
    const runs = highlightRuns('DR. JORDAN sits on the Chesterfield Sofa.', BREAKDOWN);
    const marked = runs.filter((r) => r.kind);
    expect(marked.map((r) => r.text)).toEqual(['DR. JORDAN', 'Chesterfield Sofa']);
    expect(marked[0].kind).toBe('character');
    expect(marked[1].kind).toBe('prop');
    // reconstruct original text exactly
    expect(runs.map((r) => r.text).join('')).toBe('DR. JORDAN sits on the Chesterfield Sofa.');
  });
});

describe('detectSceneAssets', () => {
  it('finds breakdown items present in the scene text', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nDr. Jordan sits on the Chesterfield Sofa.");
    const scene = splitScenes(doc)[0];
    const names = detectSceneAssets(scene, BREAKDOWN).map((h) => h.name);
    expect(names).toContain('Dr. Jordan');
    expect(names).toContain('Chesterfield Sofa');
  });
});

describe('applyManualTag', () => {
  it('creates a new breakdown item from a selected span', () => {
    const res = applyManualTag([], 'prop', '  curved  energy-spear ');
    expect(res).not.toBeNull();
    expect(res!.name).toBe('curved energy-spear'); // whitespace normalized
    expect(res!.tag).toBe('@curved-energy-spear');
    expect(res!.breakdown).toHaveLength(1);
    expect(res!.breakdown[0]).toMatchObject({ kind: 'prop', name: 'curved energy-spear', tag: '@curved-energy-spear', description: '' });
    expect(res!.breakdown[0].id).toBeTruthy();
  });

  it('re-kinds an existing item with the same tag instead of duplicating', () => {
    const res = applyManualTag(BREAKDOWN, 'vehicle', 'Sofa');
    expect(res!.breakdown).toHaveLength(BREAKDOWN.length); // no new item
    expect(res!.breakdown.find((b) => b.tag === '@Sofa')!.kind).toBe('vehicle');
  });

  it('is a no-op (same array) when the tag and kind already match', () => {
    const res = applyManualTag(BREAKDOWN, 'prop', 'Sofa');
    expect(res!.breakdown).toBe(BREAKDOWN); // reference unchanged → caller skips onChange
  });

  it('returns null for an empty/whitespace selection', () => {
    expect(applyManualTag(BREAKDOWN, 'prop', '   ')).toBeNull();
  });
});

describe('resolveSceneAssets merges auto + ai + manual', () => {
  it('adds AI suggestions and manual adds, drops manual removes', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nDr. Jordan enters.");
    const scene = splitScenes(doc)[0];
    const show = {
      sceneAssetSuggestions: { 0: ['@Chesterfield-Sofa'] },
      sceneAssetOverrides: { 0: { added: ['@Sofa'], removed: ['@Dr-Jordan'] } },
    } as unknown as DirectorShow;
    const resolved = resolveSceneAssets(show, 0, BREAKDOWN, scene);
    const tags = resolved.map((r) => r.item.tag);
    expect(tags).toContain('@Chesterfield-Sofa'); // ai
    expect(tags).toContain('@Sofa');              // manual add
    expect(tags).not.toContain('@Dr-Jordan');     // manual remove wins
  });
});
