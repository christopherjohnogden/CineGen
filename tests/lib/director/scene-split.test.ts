import { describe, expect, it } from 'vitest';
import { parseHeading, splitScenes } from '@/lib/director/scene-split';
import { parseToScreenplay } from '@/lib/director/screenplay';

describe('parseHeading', () => {
  it('extracts INT/EXT, time-of-day and place', () => {
    expect(parseHeading("INT. DR. JORDAN'S OFFICE - DAY"))
      .toMatchObject({ intExt: 'INT', timeOfDay: 'DAY', place: "DR. JORDAN'S OFFICE" });
    expect(parseHeading('EXT. ALLEY - NIGHT')).toMatchObject({ intExt: 'EXT', timeOfDay: 'NIGHT' });
  });
  it('handles CONTINUOUS and missing time', () => {
    expect(parseHeading('INT. FOREST - CONTINUOUS').timeOfDay).toBe('CONTINUOUS');
    expect(parseHeading('INT. VOID').timeOfDay).toBeUndefined();
  });
  it('handles combined INT/EXT headings', () => {
    const r = parseHeading('INT/EXT. CAR - DAY');
    expect(r.intExt).toBe('INT/EXT');
    expect(r.timeOfDay).toBe('DAY');
    expect(r.place).toBe('CAR');
  });
});

describe('splitScenes', () => {
  it('splits on scene headings and carries heading metadata', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nA desk.\nEXT. ALLEY - NIGHT\nRain.");
    const scenes = splitScenes(doc);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ index: 0, intExt: 'INT', timeOfDay: 'DAY' });
    expect(scenes[1]).toMatchObject({ index: 1, intExt: 'EXT', timeOfDay: 'NIGHT' });
    expect(scenes[0].elements.map((e) => e.text)).toEqual(['INT. OFFICE - DAY', 'A desk.']);
  });
  it('puts pre-heading elements into an implicit scene 0', () => {
    const doc = parseToScreenplay('A cold open with no heading.');
    const scenes = splitScenes(doc);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toBe('');
  });
});
