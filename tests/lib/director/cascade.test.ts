import { describe, expect, it } from 'vitest';
import { sceneHashes, diffScenes } from '@/lib/director/cascade';
import type { DirectorShow } from '@/types/director';

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
