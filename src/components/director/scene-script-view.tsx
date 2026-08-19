import { useRef, useState } from 'react';
import type { ScriptScene } from '@/lib/director/scene-split';
import { highlightRuns } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem } from '@/types/director';
import { PaginatedPages } from './paginated-pages';

interface SceneScriptViewProps {
  scene: ScriptScene;
  breakdown: DirectorBreakdownItem[];
  onAssetClick: (kind: BreakdownKind, name: string) => void;
  /** Tag the currently-highlighted text as a breakdown element of the given kind. */
  onTagSelection: (kind: BreakdownKind, name: string) => void;
}

const KIND_OPTIONS: { kind: BreakdownKind; label: string }[] = [
  { kind: 'character', label: 'Character' },
  { kind: 'location', label: 'Location' },
  { kind: 'prop', label: 'Prop' },
  { kind: 'vehicle', label: 'Vehicle' },
];

interface Popover { name: string; x: number; y: number }

export function SceneScriptView({ scene, breakdown, onAssetClick, onTagSelection }: SceneScriptViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<Popover | null>(null);

  // On mouse-up, if the user has selected non-empty text inside this view, show the tag
  // popover anchored just above the selection. Coordinates are relative to wrapRef so the
  // popover scrolls with the content.
  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    const wrap = wrapRef.current;
    if (!sel || sel.rangeCount === 0 || !text || !wrap) { setPop(null); return; }
    const range = sel.getRangeAt(0);
    // Ignore selections that aren't inside this view.
    if (!wrap.contains(range.commonAncestorContainer)) { setPop(null); return; }
    const rect = range.getBoundingClientRect();
    const base = wrap.getBoundingClientRect();
    setPop({
      name: text,
      x: rect.left - base.left + wrap.scrollLeft + rect.width / 2,
      y: rect.top - base.top + wrap.scrollTop,
    });
  };

  const choose = (kind: BreakdownKind) => {
    if (pop) onTagSelection(kind, pop.name);
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  return (
    <div ref={wrapRef} className="dbk-scriptwrap" onMouseUp={onMouseUp}>
      <PaginatedPages
        items={scene.elements}
        renderItem={(el) => (
          <div data-el-id={el.id} className={`dse-el dse-el--${el.type}`}>
            {highlightRuns(el.text, breakdown).map((run, i) =>
              run.kind ? (
                <mark
                  key={i}
                  className={`dbk-mark dbk-mark--${run.kind}`}
                  title={`Jump to ${run.text}`}
                  onClick={() => onAssetClick(run.kind as BreakdownKind, run.text)}
                >{run.text}</mark>
              ) : (
                <span key={i}>{run.text}</span>
              ),
            )}
          </div>
        )}
      />
      {pop && (
        <div
          className="dbk-tagpop"
          style={{ left: pop.x, top: pop.y }}
          // Keep the text selection alive while clicking a button.
          onMouseDown={(e) => e.preventDefault()}
          role="menu"
          aria-label="Tag as element type"
        >
          <span className="dbk-tagpop__label">Tag as</span>
          {KIND_OPTIONS.map((o) => (
            <button
              key={o.kind}
              type="button"
              className={`dbk-tagpop__btn dbk-tagpop__btn--${o.kind}`}
              onClick={() => choose(o.kind)}
            >{o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
