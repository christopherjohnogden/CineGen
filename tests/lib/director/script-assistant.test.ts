import { describe, expect, it } from 'vitest';
import { parseAssistantResponse, applyAssistantEdits, buildAssistantMessage } from '@/lib/director/script-assistant';
import { parseToScreenplay } from '@/lib/director/screenplay';

describe('parseAssistantResponse', () => {
  it('parses a JSON reply with edits', () => {
    const raw = JSON.stringify({ reply: 'Softened it.', edits: [{ op: 'replace', targetElementId: 'e1', elements: [{ id: 'e1', type: 'dialogue', text: 'New line.' }] }] });
    const res = parseAssistantResponse(raw);
    expect(res.reply).toBe('Softened it.');
    expect(res.edits).toHaveLength(1);
    expect(res.edits![0].op).toBe('replace');
  });
  it('falls back to a plain reply on malformed JSON', () => {
    const res = parseAssistantResponse('just some prose, no json here');
    expect(res.reply).toContain('just some prose');
    expect(res.edits).toBeUndefined();
  });
  it('extracts a fenced json block if present', () => {
    const res = parseAssistantResponse('Sure!\n```json\n{"reply":"ok","edits":[]}\n```');
    expect(res.reply).toBe('ok');
  });
});

describe('applyAssistantEdits', () => {
  const doc = parseToScreenplay('INT. OFFICE - DAY\nOld action.');
  it('replaces the target element', () => {
    const target = doc.elements[1].id;
    const next = applyAssistantEdits(doc, [{ op: 'replace', targetElementId: target, elements: [{ id: 'x', type: 'action', text: 'New action.' }] }]);
    expect(next.elements[1].text).toBe('New action.');
  });
  it('inserts after the target', () => {
    const target = doc.elements[0].id;
    const next = applyAssistantEdits(doc, [{ op: 'insert-after', targetElementId: target, elements: [{ id: 'y', type: 'action', text: 'Inserted.' }] }]);
    expect(next.elements[1].text).toBe('Inserted.');
  });
  it('deletes the target', () => {
    const target = doc.elements[1].id;
    const next = applyAssistantEdits(doc, [{ op: 'delete', targetElementId: target }]);
    expect(next.elements).toHaveLength(1);
  });
});

describe('buildAssistantMessage', () => {
  it('includes script text and the selection when provided', () => {
    const doc = parseToScreenplay('INT. OFFICE - DAY\nOld action.');
    const msg = buildAssistantMessage(doc, 'punch this up', { elementId: doc.elements[1].id });
    expect(msg).toMatch(/Old action\./);
    expect(msg).toMatch(new RegExp(doc.elements[1].id));
  });
});
