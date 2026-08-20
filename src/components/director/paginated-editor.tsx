import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Screenplay, ScreenplayElement, ScreenplayElementType } from '@/lib/director/screenplay';
import { nextElementType, typeAfterEnter } from '@/lib/director/screenplay';
import { generateId } from '@/lib/utils/ids';
import type { AssistantEdit } from '@/lib/director/script-assistant';
import { readScriptQuote, resolveScriptQuote, quoteFromElementRange, type ScriptQuote } from '@/lib/director/script-selection';
import { PaginatedPages } from './paginated-pages';

export const ELEMENT_TYPES: { id: ScreenplayElementType; name: string; color: string }[] = [
  { id: 'scene', name: 'Scene Heading', color: '#c9a24a' },
  { id: 'action', name: 'Action', color: '#8a8a96' },
  { id: 'character', name: 'Character', color: '#9db4ff' },
  { id: 'dialogue', name: 'Dialogue', color: '#e8e8ee' },
  { id: 'parenthetical', name: 'Parenthetical', color: '#c8a0e0' },
  { id: 'transition', name: 'Transition', color: '#8fe0a8' },
];

interface PaginatedEditorProps {
  doc: Screenplay;
  selectedId?: string;
  pendingEdits?: AssistantEdit[];
  onChange: (doc: Screenplay) => void;
  onSelect: (elementId: string) => void;
  contextIds?: string[];
  onContextSelect: (quote: ScriptQuote | null) => void;
  onAcceptEdits: () => void;
  onDeclineEdits: () => void;
}

export function PaginatedEditor({ doc, selectedId, pendingEdits, onChange, onSelect, contextIds, onContextSelect, onAcceptEdits, onDeclineEdits }: PaginatedEditorProps) {
  const patch = useCallback((elements: ScreenplayElement[]) => onChange({ elements }), [onChange]);
  // Element to focus after the next render — used when an element was just
  // created (Enter, or click-to-type on an empty page) and its node doesn't
  // exist yet at the moment of the event.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragIds, setDragIds] = useState<string[] | undefined>();
  const dragFrom = useRef<string | undefined>(undefined);
  const dragMoved = useRef(false);
  const rangeMode = useRef(false);

  useEffect(() => {
    if (!focusId) return;
    const node = document.querySelector<HTMLElement>(`.dse-el[data-el-id="${focusId}"]`);
    if (node) {
      node.focus();
      placeCaretAtEnd(node);
    }
    setFocusId(null);
  }, [focusId, doc.elements]);

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
      setFocusId(created.id);
    }
  };

  // Click-to-type: a click on the page surface (not inside an element) focuses
  // the nearest line — or, on a brand-new empty script, creates the first one.
  const onFlowClick = (e: MouseEvent<HTMLDivElement>) => {
    if (dragMoved.current) return;
    if ((e.target as HTMLElement).closest('.dse-el')) return; // native caret handling
    if (pendingEdits && pendingEdits.length > 0) return;      // read-only while a diff is pending
    if (doc.elements.length === 0) {
      const created: ScreenplayElement = { id: generateId(), type: 'scene', text: '' };
      patch([created]);
      onSelect(created.id);
      setFocusId(created.id);
      return;
    }
    const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>('.dse-el[contenteditable="true"]')];
    if (nodes.length === 0) return;
    let best = nodes[0];
    for (const node of nodes) {
      if (node.getBoundingClientRect().top <= e.clientY) best = node;
    }
    best.focus();
    placeCaretAtEnd(best);
  };

  const onFlowPointerDown = (e: MouseEvent<HTMLDivElement>) => {
    dragFrom.current = elementIdFromTarget(e.target);
    dragMoved.current = false;
    rangeMode.current = false;
    setDragIds(undefined);
    const root = e.currentTarget;
    const onMove = (ev: globalThis.MouseEvent) => {
      if (ev.buttons !== 1 || !dragFrom.current) return;
      const toId = elementIdAtPoint(root, ev.clientX, ev.clientY);
      if (!toId) return;
      if (toId === dragFrom.current && !rangeMode.current) return;
      rangeMode.current = true;
      dragMoved.current = true;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      const next = quoteFromElementRange(doc.elements, dragFrom.current, toId)?.elementIds ?? [dragFrom.current, toId];
      setDragIds((prev) => (prev && prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));
    };
    const onUp = (ev: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const from = dragFrom.current;
      if (!from) return;
      const toId = elementIdAtPoint(root, ev.clientX, ev.clientY) ?? from;
      const quote = resolveScriptQuote({
        elements: doc.elements,
        fromId: from,
        toId,
        native: rangeMode.current ? null : readScriptQuote(root),
        additive: ev.metaKey || ev.ctrlKey,
        existingIds: contextIds,
        extendFromId: ev.shiftKey ? (contextIds?.[0] ?? selectedId) : undefined,
      });
      dragFrom.current = undefined;
      rangeMode.current = false;
      setDragIds(undefined);
      if (quote || ev.metaKey || ev.ctrlKey) onContextSelect(quote);
    };
    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
  };

  const onFlowSelect = (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if ('clientX' in e) return;
    const quote = resolveScriptQuote({
      elements: doc.elements,
      fromId: dragFrom.current,
      toId: elementIdFromTarget(e.target),
      native: readScriptQuote(e.currentTarget),
      existingIds: contextIds,
    });
    if (quote) onContextSelect(quote);
  };
  const liveIds = dragIds ?? contextIds ?? [];
  const liveSet = new Set(liveIds);
  const dragging = Boolean(dragIds?.length);

  const diffTargets = new Set(
    (pendingEdits ?? []).filter((ed) => ed.op === 'replace' || ed.op === 'delete').map((ed) => ed.targetElementId).filter(Boolean) as string[],
  );
  const pendingCount = pendingEdits?.length ?? 0;
  const hasPendingEdits = pendingCount > 0;
  // Added elements with no existing anchor (no target, or a target not in the doc — e.g.
  // drafting into an empty script) render at the top; otherwise they'd be invisible.
  const elementIds = new Set(doc.elements.map((e) => e.id));
  const unanchoredAdds = (pendingEdits ?? [])
    .filter((ed) => ed.op === 'insert-after' && (!ed.targetElementId || !elementIds.has(ed.targetElementId)))
    .flatMap((ed) => ed.elements ?? []);
  // Prepend unanchored adds as synthetic diff-add items so they render even with an empty doc.
  const items = [...unanchoredAdds.map((n) => ({ ...n, __add: true as const })), ...doc.elements.map((e) => ({ ...e, __add: false as const }))];

  // A compact inline Accept/Decline bar rendered right at the bottom of a diff region.
  const inlineBar = (
    <div className="dse-diffbar">
      <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept</button>
      <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline</button>
      <span className="director-tab__meta">assistant edit · {pendingCount} change{pendingCount === 1 ? '' : 's'}</span>
    </div>
  );
  // Which existing element is the LAST one carrying a diff (so the bottom-of-diff bar lands there).
  const lastDiffTargetId = [...doc.elements].reverse().find((e) => diffTargets.has(e.id))?.id;
  // If the only changes are unanchored adds (drafting into an empty/anchorless doc), the bar
  // goes after the last synthetic add instead.
  const lastUnanchoredId = unanchoredAdds.length ? unanchoredAdds[unanchoredAdds.length - 1].id : undefined;
  // trailing falls back to a bottom bar only when a diff has no anchor at all — so
  // Accept/Decline is never unreachable.
  const bottomBarAfterId = lastDiffTargetId ?? lastUnanchoredId;

  return (
    <PaginatedPages
      items={items}
      onFlowClick={onFlowClick}
      onFlowSelect={onFlowSelect}
      onFlowPointerDown={onFlowPointerDown}
      lineSelecting={dragging}
      renderItem={(el) => {
        if (el.__add) {
          return (
            <>
              <div className={`dse-el dse-el--${el.type} dse-el--diffadd`}>{el.text}</div>
              {el.id === bottomBarAfterId && inlineBar}
            </>
          );
        }
        const isDiff = diffTargets.has(el.id);
        return (
          <>
            <div
              data-el-id={el.id}
              className={`dse-el dse-el--${el.type}${el.id === selectedId && !dragging ? ' dse-el--sel' : ''}${liveSet.has(el.id) ? (dragging ? ' dse-el--drag' : ' dse-el--ctx') : ''}${isDiff ? ' dse-el--diffdel' : ''}`}
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
            {el.id === bottomBarAfterId && inlineBar}
          </>
        );
      }}
      leading={hasPendingEdits ? (
        <div className="dxf-stickybar">
          <span className="lbl">assistant edit · {pendingCount} change{pendingCount === 1 ? '' : 's'}</span>
          <div className="dxf-stickybar__btns">
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept all</button>
            <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline all</button>
          </div>
        </div>
      ) : null}
      trailing={hasPendingEdits && !bottomBarAfterId ? inlineBar : null}
    />
  );
}

function placeCaretAtEnd(node: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function elementIdFromTarget(target: EventTarget | null): string | undefined {
  return (target instanceof Element ? target : null)?.closest('.dse-el')?.getAttribute('data-el-id') ?? undefined;
}

function elementIdAtPoint(root: HTMLElement, clientX: number, clientY: number): string | undefined {
  const hit = document.elementFromPoint(clientX, clientY)?.closest('.dse-el');
  if (hit?.getAttribute('data-el-id')) return hit.getAttribute('data-el-id') ?? undefined;
  const nodes = [...root.querySelectorAll<HTMLElement>('.dse-el[data-el-id]')];
  let best: HTMLElement | undefined;
  for (const node of nodes) {
    if (node.getBoundingClientRect().top <= clientY) best = node;
  }
  return best?.getAttribute('data-el-id') ?? undefined;
}

function renderDiffAdds(edits: AssistantEdit[], targetId: string) {
  const add = edits.find((e) => e.targetElementId === targetId && (e.op === 'replace' || e.op === 'insert-after'));
  if (!add?.elements) return null;
  return add.elements.map((n) => (
    <div key={n.id} className={`dse-el dse-el--${n.type} dse-el--diffadd`}>{n.text}</div>
  ));
}
