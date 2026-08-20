import { describe, expect, it } from 'vitest';
import type { DirectorBreakdownItem, DirectorScene, DirectorShow } from '@/types/director';
import { extractFromScreenplay, characterFromCue } from '@/lib/director/local-extract';
import { localBreakdownForShow } from '@/lib/director/local-breakdown';
import { addMissingItems, mergeScenes, reconcileAutoItems } from '@/lib/director/breakdown';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';

const SCRIPT = [
  'INT. OFFICE - DAY',
  'Dr Jordan enters carrying a leather bag. A red car idles outside the window.',
  '',
  'JORDAN (V.O.)',
  'We are out of time.',
  '',
  'EXT. STREET - NIGHT',
  'He sprints past dozens of soldiers toward the battlefield.',
].join('\n');

const show = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: { filmRefs: [], moodBoards: [], notes: '' },
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], llmProvider: 'claude-code', ...over,
} as DirectorShow);

const item = (over: Partial<DirectorBreakdownItem>): DirectorBreakdownItem => ({
  id: 'i1', kind: 'character', name: 'Jordan', tag: '@Jordan', description: '', ...over,
});

const scene = (over: Partial<DirectorScene>): DirectorScene => ({
  id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [], ...over,
});

describe('characterFromCue', () => {
  it('strips V.O./CONT\'D parentheticals and title-cases', () => {
    expect(characterFromCue('JORDAN (V.O.)')).toBe('Jordan');
    expect(characterFromCue("SARAH (CONT'D)")).toBe('Sarah');
  });
  it('rejects junk cues', () => {
    expect(characterFromCue('(beat)')).toBeUndefined();
    expect(characterFromCue('  ')).toBeUndefined();
  });
});

describe('extractFromScreenplay', () => {
  const scenes = splitScenes(parseToScreenplay(SCRIPT));
  const out = extractFromScreenplay(scenes);
  const of = (kind: string) => out.filter((i) => i.kind === kind).map((i) => i.name);

  it('takes locations straight off the headings with INT/EXT and time', () => {
    expect(of('location')).toEqual(['Office', 'Street']);
    const office = out.find((i) => i.name === 'Office');
    expect(office?.intExt).toBe('INT');
    expect(office?.timeOfDay).toBe('DAY');
  });
  it('does not subset-merge distinct locations', () => {
    const twoScenes = splitScenes(parseToScreenplay('EXT. BATTLEFIELD - DAY\nDust.\n\nEXT. BATTLEFIELD CLEARING - DAY\nMore dust.'));
    const locs = extractFromScreenplay(twoScenes).filter((i) => i.kind === 'location').map((i) => i.name);
    expect(locs).toEqual(['Battlefield', 'Battlefield Clearing']);
  });
  it('takes speaking characters straight off dialogue cues', () => {
    expect(of('character')).toContain('Jordan');
  });
  it('finds prose characters, props and vehicles', () => {
    expect(of('character')).toContain('Soldiers');
    expect(of('prop').some((p) => /bag/i.test(p))).toBe(true);
    expect(of('vehicle')).toContain('Red Car');
  });
});

describe('localBreakdownForShow', () => {
  it('yields tagged items and heading-labelled scenes for a screenplay', () => {
    const out = localBreakdownForShow(show({ sourceText: SCRIPT }));
    expect(out.scenes.map((s) => s.label)).toEqual(['INT. OFFICE - DAY', 'EXT. STREET - NIGHT']);
    expect(out.scenes[0].summary).toMatch(/Dr Jordan enters/);
    const jordan = out.items.find((i) => i.name === 'Jordan');
    expect(jordan?.tag).toBe('@Jordan');
  });
  it('returns nothing for an empty show', () => {
    expect(localBreakdownForShow(show({}))).toEqual({ items: [], scenes: [] });
  });
});

describe('addMissingItems', () => {
  it('adds only new items and never touches existing ones', () => {
    const existing = [item({ description: 'LLM-written rich description' })];
    const out = addMissingItems(existing, [
      item({ id: 'x', name: 'Jordan', tag: '@Jordan', description: '' }),
      item({ id: 'y', name: 'Sword', tag: '@Sword', kind: 'prop' }),
    ], []);
    expect(out).toHaveLength(2);
    expect(out[0].description).toBe('LLM-written rich description');
    expect(out[1].name).toBe('Sword');
  });
  it('treats a word-subset of a same-kind existing name as already present', () => {
    const existing = [item({ name: 'Massive Black Horse', tag: '@Massive-Black-Horse', kind: 'vehicle' })];
    const out = addMissingItems(existing, [item({ id: 'x', name: 'Horse', tag: '@Horse', kind: 'vehicle' })], []);
    expect(out).toBe(existing); // same reference — no-change guard
  });
});

describe('reconcileAutoItems', () => {
  it('removes an auto item the script no longer yields', () => {
    const existing = [item({ auto: true, name: 'Sword', tag: '@Sword', kind: 'prop' })];
    expect(reconcileAutoItems(existing, [])).toEqual([]);
  });
  it('keeps an auto item that is linked or enriched', () => {
    const linked = [item({ auto: true, name: 'Sword', tag: '@Sword', kind: 'prop', elementId: 'e1' })];
    expect(reconcileAutoItems(linked, [])).toBe(linked);
    const enriched = [item({ auto: true, actingProfile: 'stoic' })];
    expect(reconcileAutoItems(enriched, [])).toBe(enriched);
  });
  it('never removes manual or LLM items', () => {
    const manual = [item({ name: 'Red Bandana', tag: '@Red-Bandana', kind: 'prop' })];
    expect(reconcileAutoItems(manual, [])).toBe(manual);
  });
  it('drops a legacy verb-prefixed artifact when the clean item is freshly extracted', () => {
    const stale = item({ id: 'bad', name: 'Drives Green Sofa', tag: '@Drives-Green-Sofa', kind: 'prop' });
    const fresh = item({ id: 'good', name: 'Green Sofa', tag: '@Green-Sofa', kind: 'prop', auto: true });
    const reconciled = reconcileAutoItems([stale], [fresh]);
    expect(reconciled).toEqual([]);
    // ...and the clean item is no longer blocked by the subset match
    const out = addMissingItems(reconciled, [fresh], []);
    expect(out.map((i) => i.name)).toEqual(['Green Sofa']);
  });
});

describe('mergeScenes', () => {
  it('preserves ids and written summaries on an authoritative re-parse', () => {
    const existing = [scene({ id: 'keep', summary: 'LLM one-liner', event: 'the standoff' })];
    const incoming = [scene({ id: 'fresh', summary: 'auto summary' })];
    const out = mergeScenes(existing, incoming, { authoritative: true });
    expect(out[0].id).toBe('keep');
    expect(out[0].summary).toBe('LLM one-liner');
    expect(out[0].event).toBe('the standoff');
  });
  it('matches LLM-era labels by number and adopts fresh summaries on LLM merges', () => {
    const existing = [scene({ id: 'keep', label: 'INT. OFFICE - DAY', summary: '' })];
    const incoming = [scene({ id: 'llm', label: 'SCENE 1 — ARRIVAL', number: 1, summary: 'Jordan arrives.' })];
    const out = mergeScenes(existing, incoming);
    expect(out[0].id).toBe('keep');
    expect(out[0].label).toBe('INT. OFFICE - DAY'); // heading label kept
    expect(out[0].summary).toBe('Jordan arrives.');
  });
  it('never drops scenes missing from a partial (scoped) result', () => {
    const existing = [
      scene({ id: 'a', label: 'INT. OFFICE - DAY', number: 1 }),
      scene({ id: 'b', label: 'EXT. STREET - NIGHT', number: 2 }),
    ];
    const out = mergeScenes(existing, [scene({ id: 'x', label: 'EXT. STREET - NIGHT', number: 2, summary: 'He runs.' })]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out[1].summary).toBe('He runs.');
  });
  it('returns the same reference when nothing changed', () => {
    const existing = [scene({ summary: 'kept' })];
    const out = mergeScenes(existing, [scene({ id: 'other', summary: '' })], { authoritative: true });
    expect(out).toBe(existing);
  });
});
