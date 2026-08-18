# Paginated Script Editor (Final-Draft-style page breaks) — Design

**Date:** 2026-08-18
**Status:** Approved (brainstorming), pending implementation plan
**Builds on:** `2026-08-18-director-script-editor-chat-design.md` (the screenplay editor). This replaces the editor's rendering with paginated page cards.

## Problem

The Script tab's editor renders the whole script as one continuous cream "paper" — a single long page. The user wants it broken into discrete US-Letter **page cards** with gaps between them and **(CONT'D)** markers at page breaks, like Final Draft.

## Chosen direction

A **model-authoritative, display-only paginator** over a **single contentEditable surface**. The `Screenplay` elements array stays the single source of truth; pagination decides where page boundaries fall and paints page cards + gaps. It never mutates the model or element identity, so the Tab/Enter engine, AI inline-diff, and selection/undo all keep working.

Page breaks land at **element boundaries** (between paragraphs/lines) — proven caret-safe in a browser spike. A single element taller than a page is rare in screenplays; when it happens it owns its page and slightly overflows the edge (accepted, not split). Mid-paragraph line splitting is explicitly out of scope.

### Why this is safe (validated by spike)
A browser spike proved: with one `contentEditable` holding all elements and inert spacer blocks (`contenteditable="false"`, `tabindex="-1"`) inserted at break points to create the page gaps, (a) page cards form, (b) a long paragraph at a break stays ONE element/editable field, (c) spacers are inert so the caret skips them, and (d) the caret survives re-pagination when restored by (element-id, offset). No editable content is ever moved between DOM containers — avoiding the cursor/undo breakage that plagues real editable-pagination libraries.

## Architecture

The editor becomes: one `contentEditable` flow (the real editable surface) + a page-card backdrop layer + inert spacers that create the visual page gaps.

### New pure module: `src/lib/director/paginate.ts`
```ts
export interface MeasuredElement { id: string; height: number }
export interface PageLayout { pageCount: number; breakBeforeIds: string[] }
// Walk elements top-to-bottom accumulating height; when the next element would exceed
// pageContentH (and the page is non-empty), start a new page before it. An element taller
// than a full page still gets its own page (owns it, overflows). Empty input → 1 page, no breaks.
export function paginate(elements: MeasuredElement[], pageContentH: number): PageLayout;
```
Pure, no DOM — unit-tested with synthetic heights.

### New hook: `src/components/director/use-measured-heights.ts`
```ts
// Measures each rendered .dse-el's offsetHeight and returns MeasuredElement[]; recomputes
// (debounced) after edits settle and on ResizeObserver width/height changes of the editor.
export function useMeasuredHeights(editorRef, elementIds: string[], deps): MeasuredElement[];
```

### New component: `src/components/director/paginated-editor.tsx` (replaces `screenplay-editor.tsx`)
- Renders all `Screenplay` elements as `.dse-el` blocks inside one `contentEditable` div.
- Keeps the existing editing engine verbatim: Tab/Shift+Tab type cycle, Enter-flow, blur-uppercase for cues, `onSelect`, inline-diff rendering for pending assistant edits, `data-el-id` on each block.
- Runs `paginate(useMeasuredHeights(...), pageContentH)`; syncs inert **spacer** blocks before each `breakBeforeId`, each spacer carrying the page gap height + a `(CONT'D)` marker.
- Lays out cream **page cards** (US-Letter proportion, page numbers) as a backdrop positioned from the spacer offsets.
- **Caret preservation:** before re-paginating, save `(anchor element-id, offset)` from the selection; after, restore via a Range on that element's text node (no-op if the element is gone). Verified in the spike.
- Same props as `ScreenplayEditor` (`doc, selectedId, pendingEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits`) so `director-script-tab.tsx` only changes the import + tag name. Exports `ELEMENT_TYPES` (unchanged) for the bottom legend.

### CSS (append to `director-tab.css`)
- `.dse-pageflow` — the contentEditable flow, transparent so paper shows through.
- `.dse-pages` — absolutely-positioned backdrop layer; `.dse-page` — a cream US-Letter card with `.dse-page-num`.
- `.dse-spacer` — inert gap block (height = page bottom margin + gap + next page top margin), with `.dse-contd` — the right-aligned `(CONT'D)` marker.
- Page content height derived from a US-Letter ratio at the paper's rendered width (a constant in the component, e.g. paper width 620px → page content height ≈ 800px; exact value tuned once, documented).

## Data flow (per edit cycle)
1. Type → contentEditable input → map DOM change back to the model element by `data-el-id`; debounced serialize to `sourceText` (as today, `director-script-tab.tsx` unchanged).
2. After edits settle (debounced ~250ms), `useMeasuredHeights` reads each `.dse-el` `offsetHeight`.
3. `paginate(measured, pageContentH)` returns `breakBeforeIds`.
4. Component syncs spacers to those ids and lays out page cards; caret saved before / restored after.
5. `ResizeObserver` on the editor re-paginates on size changes.

## Error handling / edge cases
- Empty script → one empty page card, no spacers.
- Element taller than a page → owns its page, overflows edge (accepted; no mid-element split).
- Rapid typing → pagination debounced, never mid-keystroke; caret restore is a no-op if the saved element vanished.
- Assistant inline-diff blocks are ordinary `.dse-el`s in the flow → paginated for free.
- Collapsing side panels changes width → `ResizeObserver` re-paginates.

## Testing
- **Unit (TDD) — `tests/lib/director/paginate.test.ts`:** break points for a simple sequence; over-tall element owns its page; empty → 1 page/0 breaks; exact-fit boundary (element that exactly fills a page does not force an extra break); accumulation resets after each page.
- **Driven:** caret-round-trip and spacer-inert behaviors (as proven in the spike) verified by driving the app; existing 88 director tests stay green (model/parse/serialize untouched).

## Component structure / scope
- Replace: `screenplay-editor.tsx` → `paginated-editor.tsx`.
- Add: `paginate.ts`, `use-measured-heights.ts`, CSS.
- Modify: `director-script-tab.tsx` — swap the editor import/tag only (props identical).
- Untouched: `screenplay.ts` model, parse/serialize, scene-split, scene-assets, script-assistant, chat, panels, breakdown tab, `director-tab.tsx`.

## Non-goals (YAGNI)
- No mid-paragraph line splitting (breaks at element boundaries only).
- No print/PDF export pagination (screen display only; export is a separate concern).
- No page-count-accurate industry pagination rules (widows/orphans, dialogue-continued rules) beyond the (CONT'D) marker.
- No change to the Breakdown tab's scene-script view in this phase (it can adopt the same paginator later if wanted).

## Risks
- **Page content height constant** must match the rendered paper metrics or breaks land slightly off; tuned once against the real paper CSS and documented. Low risk (visual only).
- **Re-pagination flicker** if it ran on every keystroke — mitigated by debounce; spacers only change when break points change.
- **Caret restore** across re-paginate — proven in the spike; guarded for missing nodes.
