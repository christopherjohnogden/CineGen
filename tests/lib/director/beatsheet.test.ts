import { describe, expect, it } from 'vitest';
import { emptyBeatSheet, renumberBeats, serializeBeatSheet, type Beat } from '@/lib/director/beatsheet';

const beat = (over: Partial<Beat>): Beat => ({ id: over.id ?? 'b', n: over.n ?? 1, action: '', location: '', shot: '', ...over });

describe('emptyBeatSheet', () => {
  it('is a beat sheet with no beats', () => {
    expect(emptyBeatSheet()).toEqual({ beats: [] });
  });
});

describe('renumberBeats', () => {
  it('assigns sequential n from 1', () => {
    const out = renumberBeats([beat({ id: 'a', n: 5 }), beat({ id: 'b', n: 9 }), beat({ id: 'c', n: 2 })]);
    expect(out.map((b) => b.n)).toEqual([1, 2, 3]);
    expect(out.map((b) => b.id)).toEqual(['a', 'b', 'c']); // order preserved, only n changes
  });
});

describe('serializeBeatSheet', () => {
  it('emits a labeled block per beat with location, duration, mood, action, shot', () => {
    const bs = { beats: [beat({
      id: 'a', n: 1, action: 'She returns the wallet.', location: 'INT. ALLEY', shot: 'Handheld medium.', duration: 12, mood: 'tense',
    })] };
    const text = serializeBeatSheet(bs);
    expect(text).toMatch(/BEAT 1 — INT\. ALLEY \(12s, tense\)/);
    expect(text).toMatch(/Action: She returns the wallet\./);
    expect(text).toMatch(/Shot: Handheld medium\./);
  });

  it('omits empty optional fields and empty lines', () => {
    const bs = { beats: [beat({ id: 'a', n: 1, action: 'A city wakes.', location: 'EXT. CITY' })] };
    const text = serializeBeatSheet(bs);
    expect(text).toMatch(/BEAT 1 — EXT\. CITY$/m);   // no "(…)" when no duration/mood
    expect(text).not.toMatch(/Shot:/);               // no empty Shot line
  });

  it('skips beats whose fields are all empty', () => {
    const bs = { beats: [beat({ id: 'a', n: 1 }), beat({ id: 'b', n: 2, action: 'Real.' })] };
    const text = serializeBeatSheet(bs);
    expect(text).toMatch(/Action: Real\./);
    expect(text).not.toMatch(/BEAT 1/); // the all-empty beat is skipped
  });
});
