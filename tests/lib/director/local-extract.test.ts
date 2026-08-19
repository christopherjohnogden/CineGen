import { describe, expect, it } from 'vitest';
import { extractFromProse, extractFromBeatSheet, dedupe } from '@/lib/director/local-extract';
import type { BeatSheet } from '@/lib/director/beatsheet';

const names = (items: { name: string }[]) => items.map((i) => i.name);
const of = (items: { kind: string; name: string }[], kind: string) =>
  items.filter((i) => i.kind === kind).map((i) => i.name);

describe('extractFromProse — the rule the user asked for', () => {
  it('treats a capitalized mid-sentence token as a character (a person name)', () => {
    const out = extractFromProse('a red car runs over Bryan.');
    expect(of(out, 'character')).toContain('Bryan');
  });

  it('classifies a noun phrase by its head noun, keeping modifiers', () => {
    const out = extractFromProse('a red car runs over Bryan.');
    expect(of(out, 'vehicle')).toContain('Red Car');
  });

  it('does not treat a sentence-initial capital as a name', () => {
    const out = extractFromProse('Across the field, a lone armored human warrior steps out.');
    expect(of(out, 'character')).not.toContain('Across');
  });

  it('never turns camera vocabulary into props', () => {
    const out = extractFromProse('Slow circular dolly around both fighters, camera at ground level.');
    expect(of(out, 'prop')).not.toContain('Camera');
  });

  it('handles plurals and quantified groups', () => {
    const out = extractFromProse('dozens of soldiers clashing in the haze behind it.');
    expect(of(out, 'character')).toContain('Soldiers');
  });
});

// The user's real beat sheet — this is the acceptance test.
const REAL: BeatSheet = {
  beats: [
    {
      id: 'b1', n: 1, location: 'EXT. DUSTY BATTLEFIELD PLAIN - DAY', mood: 'epic, thunderous',
      action: 'An alien warrior in bronze-and-chitin armor gallops a massive black horse across a dusty plain, dozens of soldiers clashing in the haze behind it.',
      shot: 'Low wide tracking shot alongside the horse, camera at ground level, dust kicking up into frame',
    },
    {
      id: 'b2', n: 2, location: 'EXT. DUSTY BATTLEFIELD PLAIN - DAY', mood: 'epic, thunderous, awe-inspiring',
      action: 'a red car runs over Bryan.',
      shot: 'Slow-motion low-angle shot, camera whipping around the rearing horse in a full circle, sun flaring behind the raised spear',
    },
    {
      id: 'b3', n: 3, location: 'EXT. DUSTY BATTLEFIELD PLAIN - DAY', mood: 'defiant, tense',
      action: 'Across the field, a lone armored human warrior steps out from the ranks, plants his shield, and points his sword toward the charging rider, refusing to break formation.',
      shot: 'Wide shot, warrior small against the approaching dust cloud, horizon line low',
    },
    {
      id: 'b4', n: 4, location: 'EXT. BATTLEFIELD CLEARING - DAY', mood: 'kinetic',
      action: 'The alien wheels the horse hard, leaps off mid-stride, and lands in a crouch, spear already spinning into a ready stance as the horse gallops off past the fighting.',
      shot: 'Slow-motion dismount shot, camera circling as boots hit dirt',
    },
    {
      id: 'b5', n: 5, location: 'EXT. BATTLEFIELD CLEARING - DAY', mood: 'charged, ritualistic',
      action: 'The two combatants circle each other in a widening ring of soldiers who pull back to watch, weapons raised, sizing each other up.',
      shot: 'Slow circular dolly around both fighters, alternating over-the-shoulder framing',
    },
  ],
};

describe('extractFromBeatSheet — acceptance on the real sheet', () => {
  const out = extractFromBeatSheet(REAL);

  it('gets both locations exactly, from the beat field (zero inference)', () => {
    expect(of(out, 'location')).toEqual([
      'EXT. DUSTY BATTLEFIELD PLAIN - DAY',
      'EXT. BATTLEFIELD CLEARING - DAY',
    ]);
  });

  it('finds Bryan and the red car — the edit that produced nothing before', () => {
    expect(of(out, 'character')).toContain('Bryan');
    expect(of(out, 'vehicle')).toContain('Red Car');
  });

  it('finds the people the LLM pass missed', () => {
    const chars = of(out, 'character');
    expect(chars).toContain('Soldiers');
    expect(chars).toContain('Combatants');
    expect(chars.some((c) => /warrior/i.test(c))).toBe(true);
  });

  it('keeps the alien and the human as two DIFFERENT characters', () => {
    const chars = of(out, 'character');
    expect(chars.some((c) => /alien/i.test(c))).toBe(true);
    expect(chars.some((c) => /human/i.test(c))).toBe(true);
    // they must not have been collapsed into one entry
    expect(chars.filter((c) => /warrior/i.test(c)).length).toBeGreaterThanOrEqual(2);
  });

  it('finds the worn/wielded props the LLM pass missed', () => {
    const props = of(out, 'prop');
    expect(props.some((p) => /armor/i.test(p))).toBe(true);
    expect(props).toContain('Shield');
    expect(props).toContain('Sword');
    expect(props.some((p) => /spear/i.test(p))).toBe(true);
  });

  it('does not invent props from camera language or clause breaks', () => {
    const props = of(out, 'prop');
    expect(props).not.toContain('Camera');
    expect(props).not.toContain('Crouch Spear'); // "lands in a crouch, spear ..."
    expect(props).not.toContain('Widening Ring'); // "a ring of soldiers" is not jewelry
  });

  it('finds the horse as a vehicle/mount', () => {
    expect(of(out, 'vehicle').some((v) => /horse/i.test(v))).toBe(true);
  });

  it('produces substantially more than the 4 items the LLM pass returned', () => {
    expect(out.length).toBeGreaterThanOrEqual(10);
  });

  it('has no duplicates', () => {
    const keys = out.map((i) => `${i.kind}:${i.name.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('dedupe', () => {
  it('keeps the richer name when one is a subset of the other', () => {
    const out = dedupe([
      { kind: 'vehicle', name: 'Horse', source: 'prose' },
      { kind: 'vehicle', name: 'Massive Black Horse', source: 'prose' },
    ]);
    expect(names(out)).toEqual(['Massive Black Horse']);
  });

  it('keeps entities with disjoint modifiers separate', () => {
    const out = dedupe([
      { kind: 'character', name: 'Alien Warrior', source: 'prose' },
      { kind: 'character', name: 'Armored Human Warrior', source: 'prose' },
    ]);
    expect(names(out)).toEqual(['Alien Warrior', 'Armored Human Warrior']);
  });

  it('never merges across kinds', () => {
    const out = dedupe([
      { kind: 'prop', name: 'Shield', source: 'prose' },
      { kind: 'character', name: 'Shield', source: 'prose' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.kind)).toEqual(['prop', 'character']);
  });
});
