import { describe, expect, it } from 'vitest';
import { detectSceneAssets, highlightRuns, resolveSceneAssets } from '@/lib/director/scene-assets';
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
