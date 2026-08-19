import { useCallback, type KeyboardEvent } from 'react';
import type { Screenplay, ScreenplayElement, ScreenplayElementType } from '@/lib/director/screenplay';
import { nextElementType, typeAfterEnter } from '@/lib/director/screenplay';
import { generateId } from '@/lib/utils/ids';
import type { AssistantEdit } from '@/lib/director/script-assistant';
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
  onAcceptEdits: () => void;
  onDeclineEdits: () => void;
}

export function PaginatedEditor({ doc, selectedId, pendingEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits }: PaginatedEditorProps) {
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
      <span className="director-tab__meta">assistant edit · {pendingEdits!.length} change{pendingEdits!.length === 1 ? '' : 's'}</span>
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
            {el.id === bottomBarAfterId && inlineBar}
          </>
        );
      }}
      leading={hasPendingEdits ? (
        <div className="dxf-stickybar">
          <span className="lbl">assistant edit · {pendingEdits!.length} change{pendingEdits!.length === 1 ? '' : 's'}</span>
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

function renderDiffAdds(edits: AssistantEdit[], targetId: string) {
  const add = edits.find((e) => e.targetElementId === targetId && (e.op === 'replace' || e.op === 'insert-after'));
  if (!add?.elements) return null;
  return add.elements.map((n) => (
    <div key={n.id} className={`dse-el dse-el--${n.type} dse-el--diffadd`}>{n.text}</div>
  ));
}
