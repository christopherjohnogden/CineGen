import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { MeasuredElement } from '@/lib/director/paginate';

export function useMeasuredHeights(
  containerRef: RefObject<HTMLElement>,
  elementIds: string[],
): MeasuredElement[] {
  const [measured, setMeasured] = useState<MeasuredElement[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const next: MeasuredElement[] = [];
      for (const id of elementIds) {
        const el = container.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(id)}"]`);
        next.push({ id, height: el ? el.offsetHeight : 0 });
      }
      setMeasured((prev) => {
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.height === next[i].height)) {
          return prev; // no change — avoid render loop
        }
        return next;
      });
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(measure, 120);
    };

    measure(); // initial synchronous pass after paint
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    const mo = new MutationObserver(schedule);
    mo.observe(container, { childList: true, characterData: true, subtree: true });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      ro.disconnect();
      mo.disconnect();
    };
  }, [containerRef, elementIds.join('|')]); // re-bind when the id set changes

  return measured;
}
