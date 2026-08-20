import { describe, expect, it } from 'vitest';
import {
  parseToScreenplay, serializeScreenplay, nextElementType, typeAfterEnter, ELEMENT_CYCLE,
  scrubFdxChrome, trimFdxTrailer,
} from '@/lib/director/screenplay';

describe('parseToScreenplay', () => {
  it('classifies element types and assigns ids', () => {
    const doc = parseToScreenplay("INT. OFFICE - DAY\nA desk.\nMAYA\nHello.");
    expect(doc.elements.map((e) => e.type)).toEqual(['scene', 'action', 'character', 'dialogue']);
    expect(doc.elements.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
  });

  it('classifies parentheticals and transitions', () => {
    const doc = parseToScreenplay("DANE\n(quietly)\nRun.\n\nCUT TO:");
    const types = doc.elements.map((e) => e.type);
    expect(types).toContain('parenthetical');
    expect(types.at(-1)).toBe('transition');
  });
});

describe('Final Draft chrome trailer', () => {
  const script = 'EXT. FOREST - DAY\nJordan listens.\n\nCUT TO:';
  const trailer = `<ElementSettings Type="General">
<FontSpec AdornmentStyle="0" Font="Courier Final Draft" Size="12" Style=""/>
<ParagraphSpec Alignment="Left" Type="General"/>
<Behavior PaginateAs="General" ReturnKey="General"/>`;

  it('trimFdxTrailer drops settings after the script', () => {
    expect(trimFdxTrailer(`${script}\n${trailer}`)).toBe(script);
    expect(trimFdxTrailer(script)).toBe(script);
  });

  it('parseToScreenplay does not treat FontSpec as action', () => {
    const doc = parseToScreenplay(`${script}\n${trailer}`);
    const blob = serializeScreenplay(doc);
    expect(blob).toContain('CUT TO:');
    expect(blob).not.toMatch(/FontSpec|ElementSettings|Courier Final Draft/);
  });

  it('scrubFdxChrome drops trailing chrome elements', () => {
    const doc = parseToScreenplay(script);
    const dirty = [
      ...doc.elements,
      { id: 'x', type: 'action' as const, text: '<FontSpec AdornmentStyle="0" Font="Courier Final Draft" Size="12"/>' },
    ];
    expect(serializeScreenplay({ elements: scrubFdxChrome(dirty) })).toBe(serializeScreenplay(doc));
  });
});

describe('serializeScreenplay round-trips', () => {
  it('preserves text content through parse → serialize', () => {
    const src = "INT. OFFICE - DAY\nA desk.\nMAYA\nHello.";
    const round = serializeScreenplay(parseToScreenplay(src));
    // same visible lines, trimmed
    expect(round.split('\n').map((l) => l.trim()).filter(Boolean))
      .toEqual(src.split('\n').map((l) => l.trim()).filter(Boolean));
  });
});

describe('nextElementType', () => {
  it('cycles forward and backward through the union order', () => {
    expect(ELEMENT_CYCLE).toEqual(['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition']);
    expect(nextElementType('scene')).toBe('action');
    expect(nextElementType('transition')).toBe('scene');
    expect(nextElementType('scene', true)).toBe('transition');
  });
});

describe('typeAfterEnter', () => {
  it('character → dialogue, dialogue → dialogue, scene → action, action → action', () => {
    expect(typeAfterEnter('character')).toBe('dialogue');
    expect(typeAfterEnter('dialogue')).toBe('dialogue');
    expect(typeAfterEnter('scene')).toBe('action');
    expect(typeAfterEnter('action')).toBe('action');
    expect(typeAfterEnter('parenthetical')).toBe('dialogue');
    expect(typeAfterEnter('transition')).toBe('scene');
  });
});
