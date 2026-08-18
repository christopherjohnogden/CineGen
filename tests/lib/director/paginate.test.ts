import { describe, expect, it } from 'vitest';
import { paginate } from '@/lib/director/paginate';

const els = (heights: number[]) => heights.map((h, i) => ({ id: `e${i}`, height: h }));

describe('paginate', () => {
  it('empty input → one page, no breaks', () => {
    expect(paginate([], 800)).toEqual({ pageCount: 1, breakBeforeIds: [] });
  });

  it('content that fits on one page → no breaks', () => {
    expect(paginate(els([100, 100, 100]), 800)).toEqual({ pageCount: 1, breakBeforeIds: [] });
  });

  it('starts a new page before the element that would overflow', () => {
    // 300+300 = 600 fits; +300 = 900 > 800 → break before e2
    const r = paginate(els([300, 300, 300]), 800);
    expect(r.breakBeforeIds).toEqual(['e2']);
    expect(r.pageCount).toBe(2);
  });

  it('an element taller than a page owns its own page (still breaks before it if page non-empty)', () => {
    // e0 100 on page1; e1 900 > 800 → break before e1; e1 owns page2 (overflows); e2 100 → break before e2
    const r = paginate(els([100, 900, 100]), 800);
    expect(r.breakBeforeIds).toEqual(['e1', 'e2']);
    expect(r.pageCount).toBe(3);
  });

  it('an exact-fit page does not force an extra break', () => {
    // 400+400 = 800 exactly fits page1; next 400 → break before e2
    const r = paginate(els([400, 400, 400]), 800);
    expect(r.breakBeforeIds).toEqual(['e2']);
  });

  it('accumulation resets after each page', () => {
    // 500 (p1), 500 → break e1 (p2), 500 → break e2 (p3)
    const r = paginate(els([500, 500, 500]), 800);
    expect(r.breakBeforeIds).toEqual(['e1', 'e2']);
    expect(r.pageCount).toBe(3);
  });
});
