import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Screenplay, ScreenplayElement, ScreenplayElementType } from '@/lib/director/screenplay';
import { nextElementType, typeAfterEnter } from '@/lib/director/screenplay';
import { generateId } from '@/lib/utils/ids';
import type { AssistantEdit } from '@/lib/director/script-assistant';
import { paginate } from '@/lib/director/paginate';
import { useMeasuredHeights } from './use-measured-heights';

export const ELEMENT_TYPES: { id: ScreenplayElementType; name: string; color: string }[] = [
  { id: 'scene', name: 'Scene Heading', color: '#c9a24a' },
  { id: 'action', name: 'Action', color: '#8a8a96' },
  { id: 'character', name: 'Character', color: '#9db4ff' },
  { id: 'dialogue', name: 'Dialogue', color: '#e8e8ee' },
  { id: 'parenthetical', name: 'Parenthetical', color: '#c8a0e0' },
  { id: 'transition', name: 'Transition', color: '#8fe0a8' },
];

const PAGE_CONTENT_H = 800; // px of element content per page at 620px paper width (tunable)
const PAGE_MARGIN = 44;     // cream breathing room above/below page content
const GAP_ONLY = 24;        // dark space actually between two page cards
// The inter-page spacer reserves bottom margin + gap + top margin.
// Keep the CSS .dse-spacer height in sync with SPACER_H below.
const SPACER_H = PAGE_MARGIN + GAP_ONLY + PAGE_MARGIN; // 112

interface PaginatedEditorProps {
  doc: Screenplay;
  selectedId?: string;
  pendingEdits?: AssistantEdit[];
  onChange: (doc: Screenplay) => void;
  onSelect: (elementId: string) => void;
  onAcceptEdits: () => void;
  onDeclineEdits: () => void;
}

export function PaginatedEditor({ doc, selectedId, pendingEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits }: PaginatedEditorProps) {
  const flowRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const patch = useCallback((elements: ScreenplayElement[]) => onChange({ elements }), [onChange]);

  const setText = (id: string, text: string) => patch(doc.elements.map((e) => (e.id === id ? { ...e, text } : e)));
  const setType = (id: string, type: ScreenplayElementType) => patch(doc.elements.map((e) => (e.id === id ? { ...e, type } : e)));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, el: ScreenplayElement) => {
    if (e.key === 'Tab') { e.preventDefault(); setType(el.id, nextElementType(el.type, e.shiftKey)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const i = doc.elements.findIndex((x) => x.id === el.id);
      const created: ScreenplayElement = { id: generateId(), type: typeAfterEnter(el.type), text: '' };
      patch([...doc.elements.slice(0, i + 1), created, ...doc.elements.slice(i + 1)]);
      onSelect(created.id);
    }
  };

  const diffTargets = new Set(
    (pendingEdits ?? []).filter((ed) => ed.op === 'replace' || ed.op === 'delete').map((ed) => ed.targetElementId).filter(Boolean) as string[],
  );
  const hasPendingEdits = !!pendingEdits && pendingEdits.length > 0;

  // measure → paginate
  const ids = doc.elements.map((e) => e.id);
  const measured = useMeasuredHeights(flowRef, ids);
  const { breakBeforeIds } = paginate(measured, PAGE_CONTENT_H);
  const breakSet = new Set(breakBeforeIds);

  // lay out the cream page cards behind the flow from the spacer offsets.
  // Only re-runs when pagination actually changes (break points or element count),
  // not on every keystroke — the backdrop is display-only.
  //
  // Geometry: a spacer between pages reserves (page-1 bottom margin) + (dark gap) +
  // (page-2 top margin). A card must extend PAGE_MARGIN above the first line of its
  // content and PAGE_MARGIN below the last, so text never touches the card edge and
  // never falls into the dark gap. GAP_ONLY is the dark space actually between cards.
  const breakSignature = breakBeforeIds.join('|');
  useLayoutEffect(() => {
    const flow = flowRef.current, pages = pagesRef.current;
    if (!flow || !pages) return;
    const spacers = [...flow.querySelectorAll<HTMLElement>('.dse-spacer')];
    // spacer height (CSS) MUST equal PAGE_MARGIN + GAP_ONLY + PAGE_MARGIN.
    const bottoms = spacers.map((s) => s.offsetTop).concat([flow.scrollHeight]);
    let top = 0;
    pages.innerHTML = '';
    bottoms.forEach((b, i) => {
      const isLast = i === bottoms.length - 1;
      const pg = document.createElement('div');
      pg.className = 'dse-page';
      pg.style.top = `${top}px`;
      // card ends PAGE_MARGIN below the last line of this page (into the spacer);
      // the last card runs to the flow bottom.
      const cardBottom = isLast ? b : b + PAGE_MARGIN;
      pg.style.height = `${cardBottom - top}px`;
      pg.innerHTML = `<div class="dse-page-num">${i + 1}.</div>`;
      pages.appendChild(pg);
      // next card starts PAGE_MARGIN above the next page's first line
      // (spacer = PAGE_MARGIN + GAP_ONLY + PAGE_MARGIN, so next content top = b + spacerHeight;
      //  card top = that - PAGE_MARGIN = b + PAGE_MARGIN + GAP_ONLY).
      top = b + PAGE_MARGIN + GAP_ONLY;
    });
  }, [breakSignature, doc.elements.length]);

  return (
    <div className="dse-paperwrap">
      <div className="dse-pageflow">
        <div className="dse-pages" ref={pagesRef} aria-hidden="true" />
        <div className="dse-flowcontent" ref={flowRef}>
          {doc.elements.map((el) => {
            const isDiff = diffTargets.has(el.id);
            return (
              <div key={el.id}>
                {breakSet.has(el.id) && (
                  <div className="dse-spacer" style={{ height: SPACER_H }} contentEditable={false} suppressContentEditableWarning>
                    <span className="dse-contd" style={{ top: PAGE_MARGIN }}>(CONT'D)</span>
                  </div>
                )}
                <div
                  data-el-id={el.id}
                  className={`dse-el dse-el--${el.type}${el.id === selectedId ? ' dse-el--sel' : ''}${isDiff ? ' dse-el--diffdel' : ''}`}
                  contentEditable={!hasPendingEdits}
                  suppressContentEditableWarning
                  spellCheck={false}
                  onFocus={() => onSelect(el.id)}
                  onKeyDown={(e) => onKeyDown(e, el)}
                  onBlur={(e) => {
                    const text = e.currentTarget.textContent ?? '';
                    const finalText = el.type === 'character' ? text.toUpperCase() : text;
                    if (finalText !== el.text) setText(el.id, finalText);
                  }}
                >
                  {el.text}
                </div>
                {isDiff && pendingEdits && renderDiffAdds(pendingEdits, el.id)}
              </div>
            );
          })}
          {hasPendingEdits && (
            <div className="dse-diffbar">
              <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept</button>
              <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline</button>
              <span className="director-tab__meta">assistant edit · {pendingEdits.length} change{pendingEdits.length === 1 ? '' : 's'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderDiffAdds(edits: AssistantEdit[], targetId: string) {
  const add = edits.find((e) => e.targetElementId === targetId && (e.op === 'replace' || e.op === 'insert-after'));
  if (!add?.elements) return null;
  return add.elements.map((n) => (
    <div key={n.id} className={`dse-el dse-el--${n.type} dse-el--diffadd`}>{n.text}</div>
  ));
}
