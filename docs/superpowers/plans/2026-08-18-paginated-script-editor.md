# Paginated Script Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Script tab editor as discrete Final-Draft-style US-Letter page cards with gaps and (CONT'D) markers, breaking between elements, while keeping the existing per-element editing engine and the `Screenplay` model authoritative.

**Architecture:** A pure `paginate()` computes page break points from measured element heights. A `useMeasuredHeights` hook measures the rendered elements (debounced + ResizeObserver). `PaginatedEditor` renders the existing per-element `contentEditable` blocks inside one flow, inserts inert spacer blocks at break points to create page gaps + (CONT'D) markers, and lays out cream page cards as a backdrop. Pagination is display-only: it never mutates the model or element identity, so the caret, Tab/Enter engine, and AI inline-diff are untouched.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`@/` → `src/`), existing `director-tab.css` theme, `ResizeObserver`.

## Global Constraints

- Test runner: `npx vitest run <path>`; full-project typecheck gate `npx tsc --noEmit -p tsconfig.json` must stay clean.
- `paginate()` is PURE (no DOM) and unit-tested (TDD, failing test first).
- Pagination is DISPLAY-ONLY: never mutate the `Screenplay` model or element ids. Break points land BETWEEN elements only (no mid-paragraph split); an element taller than a page owns its page and overflows.
- Preserve the existing editing engine verbatim: per-element `contentEditable` `.dse-el` blocks, Tab/Shift+Tab type cycle (`nextElementType`), Enter-flow (`typeAfterEnter` + `generateId`), blur-uppercase for `character`, `onSelect` on focus, inline-diff render for `pendingEdits`, `data-el-id` on each block, `hasPendingEdits` gating.
- `PaginatedEditor` keeps the EXACT prop shape of `ScreenplayEditor`: `{ doc, selectedId, pendingEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits }`, and exports `ELEMENT_TYPES` (same 6 entries) so `director-script-tab.tsx` changes only the import + tag.
- Page content height constant: PAGE_CONTENT_H = 800 (px of element content per page at the 620px paper width); documented as a tunable constant.
- Reuse: `Screenplay`/`ScreenplayElement`/`ScreenplayElementType`/`nextElementType`/`typeAfterEnter` from `@/lib/director/screenplay`; `generateId` from `@/lib/utils/ids`; `AssistantEdit` from `@/lib/director/script-assistant`.
- `git add` only the files each task owns; never `git add .` (scratch/`.playwright-mcp` files exist). `.playwright-mcp/` is gitignored.
- Commit after every task.

---

### Task 1: Pure paginator (`paginate.ts`)

**Files:**
- Create: `src/lib/director/paginate.ts`
- Test: `tests/lib/director/paginate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MeasuredElement { id: string; height: number }
  export interface PageLayout { pageCount: number; breakBeforeIds: string[] }
  export function paginate(elements: MeasuredElement[], pageContentH: number): PageLayout;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/paginate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/paginate.test.ts`
Expected: FAIL — cannot resolve `@/lib/director/paginate`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/paginate.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/paginate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/paginate.ts tests/lib/director/paginate.test.ts
git commit -m "feat(director): pure paginator for script page breaks"
```

---

### Task 2: Measured-heights hook (`use-measured-heights.ts`)

**Files:**
- Create: `src/components/director/use-measured-heights.ts`

**Interfaces:**
- Consumes: `MeasuredElement` from `@/lib/director/paginate`.
- Produces:
  ```ts
  export function useMeasuredHeights(
    containerRef: React.RefObject<HTMLElement>,
    elementIds: string[],
  ): MeasuredElement[];
  ```
  Reads each `[data-el-id]` child's `offsetHeight` inside `containerRef`; recomputes after paint, debounced ~120ms on mutations, and on a `ResizeObserver` of the container. `elementIds` in the dep set so add/remove/reorder re-measures.

- [ ] **Step 1: Create the hook**

Create `src/components/director/use-measured-heights.ts`:

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/use-measured-heights.ts
git commit -m "feat(director): useMeasuredHeights hook (debounced + ResizeObserver)"
```

---

### Task 3: CSS for page flow, page cards, spacers

**Files:**
- Modify: `src/styles/director-tab.css` (append)

**Interfaces:**
- Produces classes consumed by Task 4: `dse-pageflow`, `dse-pages`, `dse-page`, `dse-page-num`, `dse-spacer`, `dse-contd`. Reuses existing `dse-paperwrap`, `dse-paper`, `dse-el*`, `dse-diffbar`.

- [ ] **Step 1: Append the classes**

Append to `src/styles/director-tab.css`:

```css
/* ── Paginated editor: page cards behind a single flow ──────────── */
.dse-pageflow { position:relative; width:620px; max-width:100%; margin:0 auto; }
.dse-pages { position:absolute; inset:0; z-index:0; pointer-events:none; }
.dse-page { position:absolute; left:0; width:620px; max-width:100%; background:#f4f1ea; border-radius:4px; box-shadow:0 8px 40px rgba(0,0,0,.5); }
.dse-page-num { position:absolute; top:14px; right:24px; color:#8a8270; font-family:'Courier New',monospace; font-size:11px; }
/* the flow content sits above the page cards; padding matches the old paper */
.dse-flowcontent { position:relative; z-index:1; padding:48px 60px 56px 82px; color:#16130d; font-family:'Courier New',Courier,monospace; font-size:14.5px; line-height:1.5; }
/* inert page-gap spacer with a (CONT'D) marker */
.dse-spacer { position:relative; height:96px; user-select:none; }
.dse-contd { position:absolute; top:8px; right:0; color:#8a8270; font-style:italic; font-size:11px; }
```

- [ ] **Step 2: Typecheck (CSS regression guard)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/director-tab.css
git commit -m "style(director): page-card/spacer classes for paginated editor"
```

---

### Task 4: Paginated editor component (`paginated-editor.tsx`)

**Files:**
- Create: `src/components/director/paginated-editor.tsx`

**Interfaces:**
- Consumes: `paginate` + `MeasuredElement` from `@/lib/director/paginate`; `useMeasuredHeights` from `./use-measured-heights`; `Screenplay`/`ScreenplayElement`/`ScreenplayElementType`/`nextElementType`/`typeAfterEnter` from `@/lib/director/screenplay`; `generateId` from `@/lib/utils/ids`; `AssistantEdit` from `@/lib/director/script-assistant`.
- Produces:
  ```ts
  export const ELEMENT_TYPES: { id: ScreenplayElementType; name: string; color: string }[]; // same 6 as before
  interface PaginatedEditorProps { doc; selectedId?; pendingEdits?; onChange; onSelect; onAcceptEdits; onDeclineEdits } // identical to ScreenplayEditor
  export function PaginatedEditor(props: PaginatedEditorProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/paginated-editor.tsx`. This keeps the entire editing engine from `screenplay-editor.tsx` verbatim (per-element editables, Tab/Enter, blur-uppercase, diff render, `hasPendingEdits`), and wraps it in the page-card layout:

```tsx
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
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

  // lay out the cream page cards behind the flow from the spacer offsets
  const [, force] = useState(0);
  useLayoutEffect(() => {
    const flow = flowRef.current, pages = pagesRef.current;
    if (!flow || !pages) return;
    const spacers = [...flow.querySelectorAll<HTMLElement>('.dse-spacer')];
    const GAP = 96; // must match .dse-spacer height in CSS
    const bottoms = spacers.map((s) => s.offsetTop).concat([flow.scrollHeight]);
    let top = 0;
    pages.innerHTML = '';
    bottoms.forEach((b, i) => {
      const pg = document.createElement('div');
      pg.className = 'dse-page';
      pg.style.top = `${top}px`;
      pg.style.height = `${b - top}px`;
      pg.innerHTML = `<div class="dse-page-num">${i + 1}.</div>`;
      pages.appendChild(pg);
      top = b + GAP;
    });
  }); // runs every render after DOM settles; cheap (reads offsets, writes backdrop)
  void force;

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
                  <div className="dse-spacer" contentEditable={false} suppressContentEditableWarning>
                    <span className="dse-contd">(CONT'D)</span>
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
```

Note on caret safety: each `.dse-el` is its own `contentEditable`, so inserting/removing a sibling `.dse-spacer` never touches the editable the user is typing in — the caret is inherently preserved (the spike confirmed caret survives re-pagination; per-element editables make it stronger). The spacer is `contentEditable={false}` so focus/caret skip it.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/paginated-editor.tsx
git commit -m "feat(director): paginated editor (page cards + spacers, engine preserved)"
```

---

### Task 5: Swap the editor into the Script tab; retire the old editor

**Files:**
- Modify: `src/components/director/director-script-tab.tsx` (import + tag)
- Delete: `src/components/director/screenplay-editor.tsx`

**Interfaces:**
- `PaginatedEditor` + `ELEMENT_TYPES` from `./paginated-editor` replace `ScreenplayEditor` + `ELEMENT_TYPES` from `./screenplay-editor`. Props are identical.

- [ ] **Step 1: Update the import in `director-script-tab.tsx`**

Change:
```tsx
import { ScreenplayEditor, ELEMENT_TYPES } from './screenplay-editor';
```
to:
```tsx
import { PaginatedEditor, ELEMENT_TYPES } from './paginated-editor';
```

- [ ] **Step 2: Update the JSX tag**

Change the `<ScreenplayEditor ... />` render to `<PaginatedEditor ... />` (props unchanged):
```tsx
<PaginatedEditor
  doc={doc}
  selectedId={selectedId}
  pendingEdits={pending}
  onChange={setDoc}
  onSelect={setSelectedId}
  onAcceptEdits={acceptEdits}
  onDeclineEdits={declineEdits}
/>
```

- [ ] **Step 3: Delete the old editor**

```bash
git rm src/components/director/screenplay-editor.tsx
```

- [ ] **Step 4: Verify full typecheck + director tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (fix any dangling `ScreenplayEditor` reference).
Run: `npx vitest run tests/lib/director/`
Expected: PASS (existing 88 + the 6 paginate tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/director/director-script-tab.tsx
git commit -m "feat(director): use paginated editor in Script tab; retire screenplay-editor"
```

---

### Task 6: Browser-driven verification (the risky behaviors)

No new code unless a fix is needed — drive the real app to confirm pagination, caret safety, and editing.

- [ ] **Step 1: Build/launch and open the Script tab**

Launch the app (dev server). Open Director → Script with a script long enough to exceed one page (paste/upload the multi-page sample if needed).

- [ ] **Step 2: Verify pagination visuals**

Confirm: the script renders as multiple cream **page cards** with dark gaps between them; each card shows a **page number** (top-right); a **(CONT'D)** marker appears at each page break. Collapsing a side panel (width change) re-paginates without breaking.

- [ ] **Step 3: Verify editing + caret across a break**

Click into a line just after a page break and type — the caret stays put, text updates. Tab/Shift+Tab cycles the line type; Enter after a character makes a dialogue line; the bottom legend still reflects/sets the selected line's type. Ask the chat assistant to rewrite a line spanning near a break → the inline diff renders and Accept/Decline works.

- [ ] **Step 4: Commit any fixes**

If manual driving surfaces a fix (e.g. PAGE_CONTENT_H needs tuning so breaks land at the visual page edge, or the page-card backdrop is misaligned), make the smallest fix and commit it. Otherwise no commit.

---

## Self-Review Notes

- **Spec coverage:** pure paginator + break-at-element-boundary + over-tall-owns-page + empty→1page (T1); measuring hook debounced + ResizeObserver (T2); page-card/spacer/(CONT'D) CSS (T3); paginated editor preserving the full engine + spacers + page-card backdrop + caret-safe per-element editables (T4); swap into Script tab + retire old editor, props identical so `director-script-tab.tsx` minimal change (T5); browser-driven verification of the risky caret/pagination behaviors (T6). Covered.
- **Type consistency:** `MeasuredElement`/`PageLayout`/`paginate` signature identical across T1/T2/T4; `PaginatedEditor` prop shape identical to the retired `ScreenplayEditor` (verified against the current file); `ELEMENT_TYPES` same 6 entries; `PAGE_CONTENT_H` defined once in T4 and referenced in the layout math. The `.dse-spacer` height (96px) is stated in both the CSS (T3) and the `GAP` constant (T4) — flagged in T4's layout code as "must match".
- **No placeholders:** every code step is complete.
- **Known tuning point:** `PAGE_CONTENT_H = 800` and the spacer `GAP = 96` are visual constants tuned once in T6; flagged to the final reviewer as the expected place for a small adjustment, not a logic bug.
