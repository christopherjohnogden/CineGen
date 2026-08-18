import { describe, expect, it } from 'vitest';
import { parseFdx } from '@/lib/director/fdx-parser';
import { serializeScreenplay } from '@/lib/director/screenplay';

const FDX = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>A desk. </Text><Text>Maya sits.</Text></Paragraph>
    <Paragraph Type="Character"><Text>MAYA</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(quietly)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>It&#39;s me &amp; you.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="General"><Text>Some general note.</Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
  </Content>
</FinalDraft>`;

describe('parseFdx', () => {
  it('maps Paragraph Type attributes to element types', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements.map((e) => e.type)).toEqual([
      'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'action',
    ]);
  });

  it('concatenates multiple <Text> runs in one paragraph', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements[1].text).toBe('A desk. Maya sits.');
  });

  it('decodes XML entities', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements[4].text).toBe("It's me & you.");
  });

  it('maps unknown/General type to action', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements[6]).toMatchObject({ type: 'action', text: 'Some general note.' });
  });

  it('skips empty paragraphs and assigns ids', () => {
    const doc = parseFdx(FDX)!;
    // the trailing empty Action paragraph is skipped → 7 elements, not 8
    expect(doc.elements).toHaveLength(7);
    expect(doc.elements.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
  });

  it('returns null for malformed / non-FDX input', () => {
    expect(parseFdx('not xml at all')).toBeNull();
    expect(parseFdx('<FinalDraft></FinalDraft>')).toBeNull(); // no Paragraphs
    expect(parseFdx('')).toBeNull();
  });

  it('serializes to readable multi-line text', () => {
    const text = serializeScreenplay(parseFdx(FDX)!);
    expect(text).toMatch(/INT\. OFFICE - DAY/);
    expect(text).toMatch(/MAYA/);
    expect(text.split('\n').length).toBeGreaterThan(3);
  });
});
