import { describe, expect, it } from 'vitest';
import {
  formatScriptQuote, quoteFromElementRange, quotePreview, readScriptQuote, resolveScriptQuote,
} from '@/lib/director/script-selection';

describe('formatScriptQuote', () => {
  it('joins slices with newlines and drops empties', () => {
    expect(formatScriptQuote([
      { id: 'a', text: 'He waits.' },
      { id: 'b', text: '' },
      { id: 'c', text: 'The door opens.' },
    ])).toEqual({
      text: 'He waits.\nThe door opens.',
      elementIds: ['a', 'c'],
    });
  });

  it('returns null when nothing is highlighted', () => {
    expect(formatScriptQuote([])).toBeNull();
    expect(formatScriptQuote([{ id: 'a', text: '   ' }])).toBeNull();
  });
});

describe('quotePreview', () => {
  it('ellipsizes long quotes', () => {
    expect(quotePreview('short')).toBe('short');
    expect(quotePreview('x'.repeat(80)).endsWith('…')).toBe(true);
  });
});

describe('readScriptQuote', () => {
  it('captures a highlight that spans two elements', () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="dse-el" data-el-id="a">Hello world</div>
        <div class="dse-el" data-el-id="b">Second line</div>
      </div>`;
    const a = document.querySelector('[data-el-id="a"]')!;
    const b = document.querySelector('[data-el-id="b"]')!;
    const range = document.createRange();
    range.setStart(a.firstChild!, 6);
    range.setEnd(b.firstChild!, 6);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(readScriptQuote(document.getElementById('root'))).toEqual({
      text: 'world\nSecond',
      elementIds: ['a', 'b'],
    });
  });
});

describe('quoteFromElementRange', () => {
  const els = [
    { id: 'a', text: 'INT. OFFICE - DAY' },
    { id: 'b', text: 'A small office.' },
    { id: 'c', text: 'Late afternoon.' },
    { id: 'd', text: 'PETER sits.' },
  ];

  it('takes every element between the drag ends', () => {
    expect(quoteFromElementRange(els, 'b', 'd')).toEqual({
      text: 'A small office.\nLate afternoon.\nPETER sits.',
      elementIds: ['b', 'c', 'd'],
    });
  });
});

describe('resolveScriptQuote', () => {
  const els = [
    { id: 'a', text: 'One' },
    { id: 'b', text: 'Two' },
    { id: 'c', text: 'Three' },
  ];

  it('prefers a drag span over a native range that only covers one block', () => {
    const quote = resolveScriptQuote({
      elements: els,
      fromId: 'a',
      toId: 'c',
      native: { text: 'Three', elementIds: ['c'] },
    });
    expect(quote?.elementIds).toEqual(['a', 'b', 'c']);
  });

  it('toggles a line with additive (⌘-click)', () => {
    const added = resolveScriptQuote({
      elements: els, toId: 'c', native: null, additive: true, existingIds: ['a'],
    });
    expect(added?.elementIds).toEqual(['a', 'c']);
    const removed = resolveScriptQuote({
      elements: els, toId: 'a', native: null, additive: true, existingIds: ['a', 'c'],
    });
    expect(removed?.elementIds).toEqual(['c']);
  });
});
