import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { paginate } from '@/lib/director/paginate';
import { useMeasuredHeights } from './use-measured-heights';

// Shared page-card pagination geometry, used by the Script editor (editable) and the
// Breakdown scene view (read-only). Owns: measuring element heights, computing page
// breaks, inserting inert (CONT'D) spacers, and laying out cream page-card backdrops
// with top/bottom page margins. Callers supply how each element renders.

export const PAGE_CONTENT_H = 800; // px of element content per page at 620px paper width (tunable)
export const PAGE_MARGIN = 44;     // cream breathing room above/below page content
export const GAP_ONLY = 24;        // dark space actually between two page cards
// The inter-page spacer reserves bottom margin + gap + top margin.
export const SPACER_H = PAGE_MARGIN + GAP_ONLY + PAGE_MARGIN; // 112

export interface PaginatedItem { id: string }

interface PaginatedPagesProps<T extends PaginatedItem> {
  items: T[];
  /** Render one item's block. It MUST include a `data-el-id={item.id}` on its measurable node. */
  renderItem: (item: T) => ReactNode;
  /** Optional content appended after the flow (e.g. the assistant diff bar). */
  trailing?: ReactNode;
  /** Optional content pinned at the top of the flow (e.g. a sticky accept/decline bar). */
  leading?: ReactNode;
  /** Click anywhere on the page surface (used by the editor for click-to-type). */
  onFlowClick?: (event: MouseEvent<HTMLDivElement>) => void;
  /** Mouse/key up on the paper (used to snapshot a text highlight for the assistant). */
  onFlowSelect?: (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
  onFlowPointerDown?: (event: MouseEvent<HTMLDivElement>) => void;
  lineSelecting?: boolean;
}

export function PaginatedPages<T extends PaginatedItem>({ items, renderItem, trailing, leading, onFlowClick, onFlowSelect, onFlowPointerDown, lineSelecting }: PaginatedPagesProps<T>) {
  const flowRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  const ids = items.map((it) => it.id);
  const measured = useMeasuredHeights(flowRef, ids);
  const { breakBeforeIds } = paginate(measured, PAGE_CONTENT_H);
  const breakSet = new Set(breakBeforeIds);

  // Lay out the cream page cards behind the flow from the spacer offsets. Re-runs when
  // break points, item count, OR any measured height changes — so a card also resizes
  // when a line wraps within a page (heights change but break points don't). Display-only.
  // Geometry: each card extends PAGE_MARGIN above the first line and below the last of
  // its page, so text never touches the card edge and never falls into the dark gap.
  const breakSignature = breakBeforeIds.join('|');
  const heightSignature = measured.map((m) => m.height).join('|');
  useLayoutEffect(() => {
    const flow = flowRef.current, pages = pagesRef.current;
    if (!flow || !pages) return;
    const spacers = [...flow.querySelectorAll<HTMLElement>('.dse-spacer')];
    const bottoms = spacers.map((s) => s.offsetTop).concat([flow.scrollHeight]);
    let top = 0;
    pages.replaceChildren(); // clear prior page cards (safe, no innerHTML)
    bottoms.forEach((b, i) => {
      const isLast = i === bottoms.length - 1;
      const pg = document.createElement('div');
      pg.className = 'dse-page';
      pg.style.top = `${top}px`;
      const cardBottom = isLast ? b : b + PAGE_MARGIN;
      pg.style.height = `${cardBottom - top}px`;
      const num = document.createElement('div');
      num.className = 'dse-page-num';
      num.textContent = `${i + 1}.`; // textContent (not innerHTML) — no injection surface
      pg.appendChild(num);
      pages.appendChild(pg);
      top = b + PAGE_MARGIN + GAP_ONLY;
    });
  }, [breakSignature, heightSignature, items.length]);

  return (
    <div
      className={`dse-paperwrap${lineSelecting ? ' dse-paperwrap--linerange' : ''}`}
      onMouseDown={(event) => onFlowPointerDown?.(event)}
      onMouseUp={(event) => onFlowSelect?.(event)}
      onKeyUp={(event) => onFlowSelect?.(event)}
    >
      {leading && <div className="dxf-stickywrap">{leading}</div>}
      <div className="dse-pageflow">
        <div className="dse-pages" ref={pagesRef} aria-hidden="true" />
        <div className="dse-flowcontent" ref={flowRef} onClick={onFlowClick}>
          {items.map((item) => (
            <div key={item.id}>
              {breakSet.has(item.id) && (
                <div className="dse-spacer" style={{ height: SPACER_H }} contentEditable={false} suppressContentEditableWarning>
                  <span className="dse-contd" style={{ top: PAGE_MARGIN }}>(CONT'D)</span>
                </div>
              )}
              {renderItem(item)}
            </div>
          ))}
          {trailing}
        </div>
      </div>
    </div>
  );
}
