import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyClickSelection,
  applyContextSelection,
  boxToRect,
  idsIntersectingMarquee,
  isAdditiveClick,
  marqueeBox,
  mergeMarqueeHits,
  pruneSelection,
  type MarqueeBox,
} from '@/lib/elements/selection';

const MARQUEE_THRESHOLD_PX = 6;

interface DragState {
  startX: number;
  startY: number;
  preSelected: Set<string>;
  active: boolean;
}

export function useElementSelection(orderedIds: string[], blocked: boolean) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lastClickedRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, orderedIds));
  }, [orderedIds]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    lastClickedRef.current = null;
    setContextMenu(null);
  }, []);

  const handleCardClick = useCallback((id: string, e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return { shouldOpen: false };
    }
    const result = applyClickSelection(
      orderedIds,
      selectedRef.current,
      lastClickedRef.current,
      id,
      { metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey },
    );
    setSelected(result.selected);
    lastClickedRef.current = result.lastClicked;
    setContextMenu(null);
    return { shouldOpen: result.shouldOpen };
  }, [orderedIds]);

  const handleCardContextMenu = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = applyContextSelection(selectedRef.current, id);
    setSelected(next);
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const handleGridContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('[data-element-id]')) return;
    if (selectedRef.current.size === 0) return;
    setContextMenu({ x: e.clientX, y: e.clientY, id: null });
  }, []);

  const hitTest = useCallback((box: MarqueeBox) => {
    const grid = gridRef.current;
    if (!grid) return new Set<string>();
    const cont = grid.getBoundingClientRect();
    const marqueeRect = boxToRect(box);
    const items: Array<{ id: string; rect: { left: number; top: number; right: number; bottom: number } }> = [];
    grid.querySelectorAll('[data-element-id]').forEach((el) => {
      const id = el.getAttribute('data-element-id');
      if (!id) return;
      const r = el.getBoundingClientRect();
      const left = r.left - cont.left + grid.scrollLeft;
      const top = r.top - cont.top + grid.scrollTop;
      items.push({ id, rect: { left, top, right: left + r.width, bottom: top + r.height } });
    });
    return idsIntersectingMarquee(items, marqueeRect);
  }, []);

  const toGridPoint = useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current;
    if (!grid) return { x: clientX, y: clientY };
    const cont = grid.getBoundingClientRect();
    return {
      x: clientX - cont.left + grid.scrollLeft,
      y: clientY - cont.top + grid.scrollTop,
    };
  }, []);

  const handleGridPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || blocked) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button.elements-tab__filter, button.elements-tab__add-btn')) return;

    const { x, y } = toGridPoint(e.clientX, e.clientY);
    const additive = isAdditiveClick({ metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey });
    dragRef.current = {
      startX: x,
      startY: y,
      preSelected: additive ? new Set(selectedRef.current) : new Set(),
      active: false,
    };
    if (!additive && !e.shiftKey && !target.closest('[data-element-id]')) {
      setSelected(new Set());
    }
    window.getSelection()?.removeAllRanges();
  }, [blocked, toGridPoint]);

  const dragging = marquee !== null;
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !gridRef.current) return;
      const { x, y } = toGridPoint(e.clientX, e.clientY);
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (!drag.active && (dx * dx + dy * dy) < MARQUEE_THRESHOLD_PX * MARQUEE_THRESHOLD_PX) return;

      if (!drag.active) {
        drag.active = true;
        suppressClickRef.current = true;
      }
      e.preventDefault();
      const box = marqueeBox(drag.startX, drag.startY, x, y);
      setMarquee(box);
      setSelected(mergeMarqueeHits(drag.preSelected, hitTest(box)));
      setContextMenu(null);
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setMarquee(null);
      if (drag?.active) {
        suppressClickRef.current = true;
        requestAnimationFrame(() => { suppressClickRef.current = false; });
      } else if (e.button === 0) {
        const target = e.target as HTMLElement | null;
        if (target && !target.closest('[data-element-id]') && !target.closest('button')) {
          setSelected(new Set());
          lastClickedRef.current = null;
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    const onSelectStart = (e: Event) => {
      if (!dragRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea')) return;
      e.preventDefault();
    };
    document.addEventListener('selectstart', onSelectStart);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('selectstart', onSelectStart);
    };
  }, [hitTest, toGridPoint]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  return {
    selected,
    marquee,
    contextMenu,
    gridRef,
    dragging,
    handleCardClick,
    handleCardContextMenu,
    handleGridContextMenu,
    handleGridPointerDown,
    closeContextMenu,
    clearSelection,
  };
}
