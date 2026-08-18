# Final Draft (.fdx) Structured Import — Design

**Date:** 2026-08-18
**Status:** Approved (brainstorming), pending implementation plan
**Builds on:** the screenplay editor + paginated editor. This fixes `.fdx` upload to preserve exact element types.

## Problem

Uploading a Final Draft `.fdx` currently runs `extractScriptText` → `stripXml`, which deletes all XML tags and keeps only the text. The editor's `parseToScreenplay` then re-guesses each line's type with heuristics — lossy, even though the FDX file states each paragraph's exact type in a `Type="…"` attribute (Scene Heading / Action / Character / Dialogue / Parenthetical / Transition). Short all-caps action lines get misread as character cues, etc. FDX scripts should import with their exact formatting.

## Chosen direction

Parse the FDX XML directly into typed `ScreenplayElement`s using each `<Paragraph Type="…">`. Store the result in a new optional `DirectorShow.sourceElements` field that the editor prefers when present; keep `sourceText` as a derived plain-text mirror so every existing consumer (breakdown, shotlist, look-bible, serialize) keeps working with zero changes. Paste / `.txt` / `.fountain` are unchanged (they use the existing heuristic `parseToScreenplay`). Parsing is tolerant: any malformed/unrecognized FDX falls back to today's `stripXml` path so upload never fails.

## New pure module: `src/lib/director/fdx-parser.ts`

```ts
import type { Screenplay } from '@/lib/director/screenplay';
// Parse Final Draft XML into typed screenplay elements. Tolerant: returns null when the
// content has no parseable <Paragraph> structure (caller falls back to plain-text parsing).
export function parseFdx(raw: string): Screenplay | null;
```

Behavior:
- Extracts `<Paragraph …>` blocks (inside `<Content>` when present). For each, reads the `Type` attribute and concatenates all child `<Text>` runs' text (bold/italic split a line into multiple `<Text>` nodes), decoding XML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`/`&apos;`), and trims.
- **Type mapping** (Final Draft `Type` → our six):
  - `Scene Heading` → `scene`
  - `Action`, `General`, `Shot` → `action`
  - `Character` → `character`
  - `Dialogue` → `dialogue`
  - `Parenthetical` → `parenthetical`
  - `Transition` → `transition`
  - any other/unknown `Type` (Cast List, New Act, End of Act, …) → `action`
- Skips paragraphs whose concatenated text is empty.
- Assigns a fresh `generateId()` per element.
- Returns `{ elements }`; returns `null` if no `<Paragraph>` found, if parsing throws, or if the result has zero elements.
- Implementation uses tolerant regex/string scanning (not a strict XML DOM parser) so slightly-off exports still work; wrap the whole body in try/catch → `null`.

## Data model (additive, no migration)

`DirectorShow` gains one optional field:
```ts
/** Typed screenplay elements from a structured import (e.g. .fdx). When present, the editor
 *  uses these directly (exact types) instead of re-parsing sourceText. Kept in sync with
 *  sourceText, which stays the plain-text mirror all other consumers read. */
sourceElements?: ScreenplayElement[];
```
`sourceText` remains the string source of truth for breakdown / shotlist / look-bible / serialize — unchanged.

## Coherence rule

**`sourceElements`, when present, is the authoritative structure; `sourceText` is always a derived mirror written together with it.** They can never diverge because every write sets both from the same element array.

- **FDX upload:** `const parsed = parseFdx(raw)`. If non-null: `onChange({ ...show, sourceElements: parsed.elements, sourceText: serializeScreenplay(parsed), sourceFileName })`. If null: fall back to plain path below.
- **Plain upload (txt/md/fountain/rtf, or FDX fallback):** `extractScriptText` → `onChange({ ...show, sourceText: text, sourceFileName, sourceElements: undefined })` — clears any stale structured import.
- **Editor edits:** the debounced `setDoc(next)` flush sets **both** `sourceElements: next.elements` and `sourceText: serializeScreenplay(next)` in the single `onChange`, so they stay coherent.
- **Non-FDX scripts** keep `sourceElements` undefined and use `parseToScreenplay(sourceText)` — today's proven behavior, intentionally unchanged. (An edit to such a script may populate `sourceElements` from that point on, which is fine — it only ever *improves* fidelity and stays in sync.)

## Editor integration (`director-script-tab.tsx`)

The existing `doc` state (init + external-sync effect + debounced `setDoc`) changes to prefer `sourceElements`:

- **Init & external sync:** derive the doc as `show.sourceElements ? { elements: show.sourceElements } : parseToScreenplay(show.sourceText)`. The external-sync effect must re-fire when a new upload changes *either* `sourceElements` or `sourceText`. Keep the `lastSerialized` guard so the editor's own round-trip doesn't cause a reparse; when `sourceElements` is present after an external change, adopt it directly (no reparse) and update `lastSerialized` to its serialization.
- **`setDoc` flush:** `onChange({ ...show, sourceElements: next.elements, sourceText: serializeScreenplay(next) })` (add `sourceElements`).

A small helper keeps this readable: `docFromShow(show): Screenplay` returning the element-preferring doc. `sourceElements` already carry stable ids (assigned by `parseFdx` or by a prior edit), so the helper wraps them as `{ elements: show.sourceElements }` with **no id regeneration** — reparsing/regenerating would churn ids and break selection/pending-edit targeting (the exact bug fixed in the pagination phase).

## Error handling
- `parseFdx` never throws — try/catch → `null`; caller falls back to `stripXml` text path. Upload never errors on a bad FDX.
- Empty parse (zero elements) → `null` → fallback.
- Existing `scriptError` paths (unreadable file, empty text) unchanged.

## Testing
- **Unit (TDD) — `tests/lib/director/fdx-parser.test.ts`:**
  - each `Paragraph Type` maps to the correct element type (the six);
  - multiple `<Text>` runs in one paragraph concatenate into one element;
  - XML entities decode;
  - unknown `Type` (`General`, `Shot`, `Cast List`) → `action`;
  - empty paragraphs skipped;
  - malformed XML / no `<Paragraph>` → `null`;
  - `serializeScreenplay(parseFdx(sample)!)` produces readable multi-line text.
- **Driven:** upload a real `.fdx` in the app → editor shows correct scene headings / centered cues / indented dialogue; paste plain text still parses as before.

## Scope / files
- Add: `src/lib/director/fdx-parser.ts` + `tests/lib/director/fdx-parser.test.ts`.
- Modify: `src/types/director.ts` (add optional `sourceElements`), `src/components/director/director-script-tab.tsx` (`loadScript` FDX branch, `docFromShow` derivation, external-sync effect, `setDoc` flush writes both fields).
- Untouched: breakdown, shotlist, look-bible, `serializeScreenplay`/`parseToScreenplay`, the paginated editor internals, `extractScriptText`/`stripXml` (kept as the FDX fallback and for other formats).

## Non-goals (YAGNI)
- No dual-dialogue side-by-side rendering (collapses to sequential character+dialogue).
- No title-page / metadata / scriptnote import.
- No FDX export.
- No PDF import (existing guard stays).
- No change to the heuristic `parseToScreenplay` (still used for paste/txt/fountain).

## Risks
- **FDX variance:** real exports differ (namespaces, attribute order, nested runs). Mitigated by tolerant string scanning + fallback to the current path, and unit tests over representative samples.
- **Two-representation drift:** mitigated by the coherence rule — every write sets both `sourceElements` and `sourceText` from the same array; the editor never writes one without the other.
- **External-sync effect regression:** the effect that re-syncs `doc` on external change is subtle (it already guards against self-round-trip). The plan must preserve that guard while adding the `sourceElements` preference. Flagged for careful review + driven test (upload replaces content correctly; typing doesn't reparse).
