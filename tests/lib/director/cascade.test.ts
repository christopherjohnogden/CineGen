import { describe, expect, it } from 'vitest';
import { sceneHashes, diffScenes, scenesForKeys, pruneRemovedScenes } from '@/lib/director/cascade';
import type { DirectorShow, DirectorScene, DirectorBreakdownItem, DirectorClip } from '@/types/director';

const show = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SCRIPT_A = 'INT. OFFICE - DAY\nDr. Jordan enters.\n\nEXT. STREET - NIGHT\nHe walks.';
const SCRIPT_B = 'INT. OFFICE - DAY\nDr. Jordan enters and sits.\n\nEXT. STREET - NIGHT\nHe walks.';

describe('sceneHashes (screenplay)', () => {
  it('one hash per scene, stable across an identical re-read', () => {
    const h1 = sceneHashes(show({ sourceText: SCRIPT_A }));
    const h2 = sceneHashes(show({ sourceText: SCRIPT_A }));
    expect(h1.size).toBe(2);
    expect([...h1.entries()]).toEqual([...h2.entries()]);
  });

  it('changes only the edited scene hash', () => {
    const a = sceneHashes(show({ sourceText: SCRIPT_A }));
    const b = sceneHashes(show({ sourceText: SCRIPT_B }));
    const keys = [...a.keys()];
    expect(a.get(keys[0])).not.toBe(b.get(keys[0])); // scene 1 edited
    expect(a.get(keys[1])).toBe(b.get(keys[1]));       // scene 2 unchanged
  });

  it('gives duplicate headings distinct keys', () => {
    const dup = 'INT. OFFICE - DAY\nA.\n\nINT. OFFICE - DAY\nB.';
    expect(sceneHashes(show({ sourceText: dup })).size).toBe(2);
  });
});

describe('diffScenes', () => {
  it('detects add, change, and remove', () => {
    const prev = sceneHashes(show({ sourceText: SCRIPT_A }));
    const next = sceneHashes(show({ sourceText: SCRIPT_B }));
    const d = diffScenes(prev, next);
    expect(d.changed).toHaveLength(1);
    expect(d.removed).toHaveLength(0);
  });

  it('a pure reorder yields no changed scenes', () => {
    const one = 'INT. A - DAY\nx.\n\nINT. B - DAY\ny.';
    const swapped = 'INT. B - DAY\ny.\n\nINT. A - DAY\nx.';
    const d = diffScenes(sceneHashes(show({ sourceText: one })), sceneHashes(show({ sourceText: swapped })));
    expect(d.changed).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('detects a genuine removal when a scene is dropped', () => {
    const prev = sceneHashes(show({ sourceText: SCRIPT_A }));
    const oneSceneOnly = 'INT. OFFICE - DAY\nDr. Jordan enters.';
    const next = sceneHashes(show({ sourceText: oneSceneOnly }));
    const removedKey = [...prev.keys()].find((k) => !next.has(k))!;
    const d = diffScenes(prev, next);
    expect(d.removed).toContain(removedKey);
  });

  it('detects a genuine addition when a scene is introduced', () => {
    const oneSceneOnly = 'INT. OFFICE - DAY\nDr. Jordan enters.';
    const prev = sceneHashes(show({ sourceText: oneSceneOnly }));
    const next = sceneHashes(show({ sourceText: SCRIPT_A }));
    const addedKey = [...next.keys()].find((k) => !prev.has(k))!;
    const d = diffScenes(prev, next);
    expect(d.changed).toContain(addedKey);
  });

  it('a reorder of duplicate-heading scenes (same heading, different bodies) yields no changes', () => {
    const before = 'INT. OFFICE - DAY\nA.\n\nINT. OFFICE - DAY\nB.';
    const after = 'INT. OFFICE - DAY\nB.\n\nINT. OFFICE - DAY\nA.';
    const d = diffScenes(sceneHashes(show({ sourceText: before })), sceneHashes(show({ sourceText: after })));
    expect(d.changed).toEqual([]);
  });
});

describe('scenesForKeys', () => {
  it('returns the DirectorScene entries for the given keys, in scene order', () => {
    const s = show({
      sourceText: SCRIPT_A,
      scenes: [
        { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
        { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
      ] as DirectorScene[],
    });
    const keys = [...sceneHashes(s).keys()]; // ['INT. OFFICE - DAY', 'EXT. STREET - NIGHT']
    expect(scenesForKeys(s, [keys[1]]).map((x) => x.id)).toEqual(['s2']);
  });

  it('returns [] for beatsheet docKind', () => {
    const s = show({ docKind: 'beatsheet', sourceText: SCRIPT_A });
    expect(scenesForKeys(s, ['beat:1'])).toEqual([]);
  });

  it('round-trips duplicate-heading keys taken from sceneHashes to the correct scene ids, even though the content-stable #n suffix does not match document order', () => {
    // Two scenes share a base heading. sceneHashes assigns the #n suffix by
    // sorting the group's bodies by hash — NOT by document position — so the
    // scene appearing first in the document is not necessarily key "BASE"
    // (n===0). scenesForKeys must derive keys the same content-stable way,
    // or this round-trip breaks.
    const dup = 'INT. OFFICE - DAY\nA.\n\nINT. OFFICE - DAY\nB.';
    const s = show({
      sourceText: dup,
      scenes: [
        { id: 'first', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
        { id: 'second', number: 2, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
      ] as DirectorScene[],
    });
    const keys = [...sceneHashes(s).keys()];
    expect(keys).toHaveLength(2);

    // Every key from sceneHashes must resolve to exactly one scene, and the
    // two keys together must resolve to both scenes (order-independent check
    // guards against a hard-coded positional mapping).
    const resolvedIds = keys.map((k) => scenesForKeys(s, [k]).map((x) => x.id));
    expect(resolvedIds.every((ids) => ids.length === 1)).toBe(true);
    expect(new Set(resolvedIds.flat())).toEqual(new Set(['first', 'second']));

    // Passing both keys returns both scenes, in show.scenes order.
    expect(scenesForKeys(s, keys).map((x) => x.id)).toEqual(['first', 'second']);
  });

  it('resolves by label, not by index, when show.scenes order/length diverges from a fresh parse of sourceText (post-breakdown edit)', () => {
    // Simulates the real-world case scenesForKeys exists for: the user edits
    // the script (sourceText changes) but show.scenes is LLM-authored and not
    // re-derived from sourceText, so it can be in a different order (or have
    // a different length) than a fresh parse would produce.
    const s = show({
      sourceText: SCRIPT_A, // parses to [OFFICE, STREET] in that document order
      scenes: [
        // show.scenes is in the OPPOSITE order from a fresh parse of sourceText,
        // and also carries an extra stale scene a fresh parse would not produce.
        { id: 'street-scene', number: 1, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
        { id: 'office-scene', number: 2, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
        { id: 'stale-scene', number: 3, label: 'INT. GARAGE - DAY', summary: '', elementIds: [], clipIds: [] },
      ] as DirectorScene[],
    });

    // A naive index-zip would pair derived[0] ('INT. OFFICE - DAY', from the
    // fresh parse) with show.scenes[0] (id 'street-scene'), which is wrong.
    const result = scenesForKeys(s, ['INT. OFFICE - DAY']);
    expect(result.map((x) => x.id)).toEqual(['office-scene']);

    const result2 = scenesForKeys(s, ['EXT. STREET - NIGHT']);
    expect(result2.map((x) => x.id)).toEqual(['street-scene']);

    // Order of the returned scenes still follows show.scenes order, not derived/parse order.
    const both = scenesForKeys(s, ['INT. OFFICE - DAY', 'EXT. STREET - NIGHT']);
    expect(both.map((x) => x.id)).toEqual(['street-scene', 'office-scene']);
  });
});

const item = (o: Partial<DirectorBreakdownItem>): DirectorBreakdownItem =>
  ({ id: o.name!, kind: 'character', name: 'x', tag: '@x', description: '', ...o });

describe('pruneRemovedScenes', () => {
  it('drops clips whose scene is gone and items no surviving scene references', () => {
    const prevShow = show({
      sourceText: 'INT. OFFICE - DAY\nDr. Jordan enters.\n\nEXT. STREET - NIGHT\nThe Taxi waits.',
      breakdown: [item({ name: 'Dr. Jordan', tag: '@Dr-Jordan' }), item({ name: 'Taxi', tag: '@Taxi', kind: 'vehicle' })],
      scenes: [
        { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
        { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
      ] as never,
      clips: [{ id: 'c1', sceneId: 's1', beats: [] }, { id: 'c2', sceneId: 's2', beats: [] }] as DirectorClip[],
    });
    // next: scene 2 removed
    const nextShow = { ...prevShow,
      sourceText: 'INT. OFFICE - DAY\nDr. Jordan enters.',
      scenes: [prevShow.scenes[0]],
    };
    const pruned = pruneRemovedScenes(prevShow, nextShow);
    expect(pruned.clips.map((c) => c.id)).toEqual(['c1']);       // c2 dropped (scene gone)
    expect(pruned.breakdown.map((b) => b.tag)).toEqual(['@Dr-Jordan']); // Taxi unreferenced now
  });

  it('keeps an item a surviving scene override still lists even if not in text', () => {
    const prevShow = show({
      sourceText: 'INT. OFFICE - DAY\nDr. Jordan enters.',
      breakdown: [item({ name: 'Hidden Prop', tag: '@Hidden-Prop', kind: 'prop' })],
      scenes: [{ id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] }] as never,
      clips: [],
      sceneAssetOverrides: { 0: { added: ['@Hidden-Prop'], removed: [] } },
    });
    const pruned = pruneRemovedScenes(prevShow, prevShow);
    expect(pruned.breakdown.map((b) => b.tag)).toEqual(['@Hidden-Prop']);
  });
});
