export interface MeasuredElement { id: string; height: number }
export interface PageLayout { pageCount: number; breakBeforeIds: string[] }

/**
 * Walk elements top-to-bottom accumulating height. When adding the next element would
 * exceed pageContentH AND the current page already has content, start a new page before it.
 * An element taller than a whole page still owns its own page (it overflows the edge — we do
 * not split within an element). Empty input → one page, no breaks. Display-only geometry.
 */
export function paginate(elements: MeasuredElement[], pageContentH: number): PageLayout {
  if (elements.length === 0) return { pageCount: 1, breakBeforeIds: [] };
  const breakBeforeIds: string[] = [];
  let acc = 0;
  let pageCount = 1;
  for (const el of elements) {
    if (acc > 0 && acc + el.height > pageContentH) {
      breakBeforeIds.push(el.id);
      pageCount += 1;
      acc = 0;
    }
    acc += el.height;
  }
  return { pageCount, breakBeforeIds };
}
