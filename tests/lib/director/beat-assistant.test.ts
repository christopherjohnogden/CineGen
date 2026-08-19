import { describe, expect, it } from 'vitest';
import { parseAssistantResponse, applyBeatEdits, buildBeatsheetMessage, type BeatEdit } from '@/lib/director/script-assistant';
import type { BeatSheet } from '@/lib/director/beatsheet';

const bs: BeatSheet = { beats: [
  { id: 'b1', n: 1, action: 'Old action.', location: 'INT. A', shot: '' },
  { id: 'b2', n: 2, action: 'Second.', location: 'EXT. B', shot: '' },
] };

describe('parseAssistantResponse beatEdits', () => {
  it('parses a reply with beatEdits', () => {
    const raw = JSON.stringify({ reply: 'Added a beat.', beatEdits: [
      { op: 'insert-after', targetBeatId: 'b1', beats: [{ id: 'n1', n: 0, action: 'New.', location: 'INT. C', shot: '' }] },
    ] });
    const res = parseAssistantResponse(raw);
    expect(res.reply).toBe('Added a beat.');
    expect(res.beatEdits).toHaveLength(1);
    expect(res.beatEdits![0].op).toBe('insert-after');
  });
  it('malformed → plain reply, no beatEdits', () => {
    const res = parseAssistantResponse('just prose');
    expect(res.beatEdits).toBeUndefined();
  });
});

describe('applyBeatEdits', () => {
  it('replaces a beat by id', () => {
    const next = applyBeatEdits(bs, [{ op: 'replace', targetBeatId: 'b1', beats: [{ id: 'b1', n: 1, action: 'New.', location: 'INT. A', shot: '' }] }]);
    expect(next.beats[0].action).toBe('New.');
  });
  it('inserts after and renumbers', () => {
    const next = applyBeatEdits(bs, [{ op: 'insert-after', targetBeatId: 'b1', beats: [{ id: 'x', n: 0, action: 'Ins.', location: 'INT. C', shot: '' }] }]);
    expect(next.beats.map((b) => b.n)).toEqual([1, 2, 3]);
    expect(next.beats[1].id).toBe('x');
  });
  it('deletes by id and renumbers', () => {
    const next = applyBeatEdits(bs, [{ op: 'delete', targetBeatId: 'b1' }]);
    expect(next.beats).toHaveLength(1);
    expect(next.beats[0].n).toBe(1);
  });
});

describe('buildBeatsheetMessage', () => {
  it('includes the beats and selection', () => {
    const msg = buildBeatsheetMessage(bs, 'punch up beat 1', { beatId: 'b1' });
    expect(msg).toMatch(/b1/);
    expect(msg).toMatch(/Old action\./);
    expect(msg).toMatch(/punch up beat 1/);
  });
});
