import { describe, expect, it } from 'vitest';
import { parseScreenplay } from '@/lib/director/script-format';

describe('parseScreenplay', () => {
  it('detects scene headings and increments sceneIndex', () => {
    const lines = parseScreenplay('INT. ROOFTOP — NIGHT\n\nEXT. ALLEY — DAY');
    const headings = lines.filter((l) => l.type === 'scene-heading');
    expect(headings).toHaveLength(2);
    expect(headings[0].sceneIndex).toBe(0);
    expect(headings[1].sceneIndex).toBe(1);
  });

  it('classifies a character cue and the dialogue block after it', () => {
    const lines = parseScreenplay('MAYA\nThey are already inside.\n\nRain falls.');
    expect(lines[0]).toMatchObject({ type: 'character', text: 'MAYA' });
    expect(lines[1]).toMatchObject({ type: 'dialogue', text: 'They are already inside.' });
    expect(lines[3]).toMatchObject({ type: 'action', text: 'Rain falls.' });
  });

  it('classifies parentheticals inside a dialogue block', () => {
    const lines = parseScreenplay('DANE\n(quietly)\nWhere is the case?');
    expect(lines[1]).toMatchObject({ type: 'parenthetical', text: '(quietly)' });
    expect(lines[2]).toMatchObject({ type: 'dialogue' });
  });

  it('classifies transitions', () => {
    const lines = parseScreenplay('She runs.\n\nCUT TO:');
    expect(lines.at(-1)).toMatchObject({ type: 'transition', text: 'CUT TO:' });
  });

  it('treats a long all-caps line as action, not a character cue', () => {
    const long = 'THIS IS A VERY LONG ALL CAPS SENTENCE THAT IS CLEARLY NOT A NAME';
    const lines = parseScreenplay(long);
    expect(lines[0].type).toBe('action');
  });

  it('falls back to action for plain prose', () => {
    const lines = parseScreenplay('Just a plain idea about two thieves.');
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('action');
  });
});
