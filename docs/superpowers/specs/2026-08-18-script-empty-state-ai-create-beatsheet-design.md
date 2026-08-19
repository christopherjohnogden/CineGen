# Script Empty State, AI Creation & Beat Sheets — Design

**Date:** 2026-08-18
**Status:** Approved (brainstorming), pending implementation plan
**Builds on:** the Script tab (paginated editor, chat assistant, FDX import).

## Problem

The Script tab starts empty with no guidance. The user wants: (1) an **empty state** offering Upload / New Screenplay / New Beat Sheet plus a prompt box; (2) the **AI assistant** as a starting-point collaborator that can brainstorm a story or draft a first version from a prompt; (3) a **beat-sheet document type** for no-dialogue videos — detailed beats that feed video-prompt generation. Beat sheets should flow through the same breakdown → shotlist → generate pipeline a screenplay does.

## Overview & document types

`DirectorShow` gains a discriminator and a beat-sheet store (additive, optional):
```ts
docKind?: 'screenplay' | 'beatsheet';   // defaults to 'screenplay' when absent
beatSheet?: BeatSheet;                    // present when docKind === 'beatsheet'
```
- `docKind` absent or `'screenplay'` → the existing paginated screenplay editor.
- `docKind === 'beatsheet'` → the new beat-sheet editor.

**Coherence rule (same pattern as FDX `sourceElements`):** the structured store (`sourceElements` for screenplay, `beatSheet` for beat sheet) is authoritative when present; `sourceText` is always its derived mirror, written together on every edit. Breakdown / shotlist / generate read `sourceText` and are unchanged.

### Beat-sheet model
**New pure module: `src/lib/director/beatsheet.ts`**
```ts
export interface Beat {
  id: string; n: number;
  action: string;            // what happens — core prose → video prompt
  location: string;          // setting → location refs
  shot: string;              // camera / framing / movement
  duration?: number;         // rough seconds
  mood?: string;             // tone / style
}
export interface BeatSheet { beats: Beat[] }
export function emptyBeatSheet(): BeatSheet;
export function serializeBeatSheet(bs: BeatSheet): string;   // → sourceText mirror
export function renumberBeats(beats: Beat[]): Beat[];        // keep n sequential after add/remove/reorder
```
`serializeBeatSheet` emits one compact block per beat that the existing breakdown/shotlist prompts can read:
```
BEAT 1 — INT. ALLEY (12s, tense)
Action: A woman slips a wallet back into a coat pocket…
Shot: Handheld medium, follows her hand.
```
(Location on the heading line, duration+mood in parens, action + shot as labeled lines. Empty optional fields omitted.)

## Empty state

When the Script tab has no content for the current kind — screenplay: `!sourceText.trim() && !sourceElements`; beat sheet: `beatSheet` empty — render an empty state instead of the editor.

**Component: `src/components/director/script-empty-state.tsx`** — a two-step, in-place flow (no modal):
- **Step 1:** heading + three choice cards (New Screenplay / New Beat Sheet / Upload) + a prompt box ("or tell the assistant") with seed chips.
  - **New Screenplay** → `onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined })` (blank editor).
  - **New Beat Sheet** → `onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' })`.
  - **Upload** → triggers the existing file picker / `loadScript`.
  - **Prompt + Send** → advance to Step 2 (does not send yet).
- **Step 2 (replaces Step 1 in place):** echoes the idea, "How do you want to start?", two cards — **Draft it** / **Brainstorm first** — and a **‹ Back**.
  - **Brainstorm first** → open the doc of the chosen kind, seed the chat with the idea in *brainstorm* mode (conversational, no edits), leave the document empty.
  - **Draft it** → open the doc, send the idea to the assistant in *draft* mode; the returned edits land as the inline-diff Accept/Decline in the editor.
  - **Document kind for the prompt path:** the user chose type-first. If a choice card was clicked (New Screenplay / New Beat Sheet) before typing, that kind is used. If the user typed into the prompt box **without** first clicking a kind card, Step 2 adds a small kind toggle (Screenplay / Beat Sheet, defaulting to Screenplay) so the kind is always explicit before drafting — the assistant is never left to infer it.

**CSS:** empty-state + beat-card classes appended to `director-tab.css`.

## AI creation flow

Extends the existing chat (`script-assistant.ts`, `director-script-chat.tsx`) — reuses the CLI wiring, `parseAssistantResponse`, inline-diff Accept/Decline. No rebuild.

- **Two modes** carried as a chat request option: `brainstorm` (converse, never returns edits) and `draft` (returns a full first draft as edits). The empty-state "Draft it / Brainstorm first" choice sets the initial mode; within the chat the user can later say "now write it" to draft.
- **docKind-aware system prompt:** `screenplay` mode → the existing `SCRIPT_ASSISTANT_SYSTEM_PROMPT` returning screenplay `AssistantEdit`s. `beatsheet` mode → a new `BEATSHEET_ASSISTANT_SYSTEM_PROMPT` returning **beat edits** (detailed no-dialogue beats with the four fields).
- **Contract extension (`script-assistant.ts`):**
  ```ts
  export interface BeatEdit { op: 'replace' | 'insert-after' | 'delete'; targetBeatId?: string; beats?: Beat[] }
  export interface AssistantResponse { reply: string; edits?: AssistantEdit[]; beatEdits?: BeatEdit[] }
  export function applyBeatEdits(bs: BeatSheet, edits: BeatEdit[]): BeatSheet;   // mirrors applyAssistantEdits
  export function buildBeatsheetMessage(bs: BeatSheet, userText: string, selection?): string;
  ```
  `parseAssistantResponse` already tolerates unknown fields → extend it to also pull `beatEdits` (validated like `edits`); malformed JSON → plain reply (existing fallback).

## Beat-sheet editor

**Component: `src/components/director/beatsheet-editor.tsx`** — same prop contract shape the paginated editor uses so the Script tab swaps by `docKind`:
- A vertical list of **beat cards**; each shows number + the four fields: `action` (main multiline), `location` / `shot` / `mood` (compact inputs), `duration` (number). Edit-in-place; commits (debounced) write both `beatSheet` and `serializeBeatSheet → sourceText`.
- **Add beat** / **remove** (with `renumberBeats`) / reorder (up/down).
- **Assistant beat-edit inline diff:** proposed beat inserts/rewrites/deletes render as diff cards (added green / struck red) with Accept/Decline — same UX as the screenplay diff, applied via `applyBeatEdits`.
- No pagination (card list, not paper).

## Script tab integration (`director-script-tab.tsx`)

- If content is empty for the current kind → render `ScriptEmptyState`.
- Else if `docKind === 'beatsheet'` → render `BeatsheetEditor` (+ the left assets panel + right chat as today).
- Else → the paginated screenplay editor (today).
- The right chat gets `docKind` + mode so it uses the right system prompt and applies the right edit kind.
- Commit coherence: screenplay edits write `sourceElements`+`sourceText`; beat edits write `beatSheet`+`sourceText`.

## Pipeline feed (no pipeline changes)

Because a beat sheet keeps `sourceText` in sync via `serializeBeatSheet`, **breakdown / shotlist / generate work unchanged** — they read `sourceText`. Breakdown extracts characters/locations/props from the beats' action+location text; shotlist turns beats into clips/shots; the beat's shot/duration/mood/action inform camera/seconds/style/subject. No change to `llm-jobs.ts`, `shotlist.ts`, `generate.ts`.

## Error handling
- Assistant returns no/empty edits in draft mode → treated as a plain reply (nothing lands); user can retry.
- Malformed assistant JSON → plain reply (existing graceful fallback), no crash.
- Switching `docKind` on a non-empty doc: allowed via a small "New" affordance in the toolbar that re-shows the empty state (guard: confirm before discarding, out of scope to over-build — a simple `docKind` switch that preserves nothing is fine for v1; document that switching type starts fresh).
- Beat with all-empty fields is skipped by `serializeBeatSheet` (like empty screenplay elements).

## Testing
- **Unit (TDD):** `beatsheet.ts` — `serializeBeatSheet` block format, omit empty optional fields, `renumberBeats` sequential after add/remove/reorder; `script-assistant.ts` — `parseAssistantResponse` pulls `beatEdits`, `applyBeatEdits` replace/insert-after/delete immutable by id.
- **Driven:** empty state renders when no content; New Screenplay / New Beat Sheet / Upload each open the right editor; prompt+Send → step 2 → Draft it lands a diff, Brainstorm first converses; beat editor add/remove/edit + assistant beat diff Accept/Decline; a beat sheet runs breakdown → shotlist end-to-end.

## Component / file structure
- Add: `src/lib/director/beatsheet.ts` (+ tests); `src/components/director/script-empty-state.tsx`; `src/components/director/beatsheet-editor.tsx`; CSS.
- Modify: `src/types/director.ts` (`docKind`, `beatSheet`); `src/lib/director/script-assistant.ts` (`BeatEdit`/`beatEdits`/`applyBeatEdits`/`buildBeatsheetMessage`/`BEATSHEET_ASSISTANT_SYSTEM_PROMPT`); `src/components/director/director-script-tab.tsx` (empty-state + kind routing + coherent commits); `src/components/director/director-script-chat.tsx` (mode + docKind → prompt/edit kind).
- Untouched: breakdown, shotlist, generate, look-bible, paginated editor internals, FDX parser.

## Non-goals (YAGNI)
- No beat-sheet ↔ screenplay conversion.
- No per-beat direct-generate button (beats go through breakdown/shotlist, per decision).
- No rich reorder (drag-drop) — up/down buttons only for v1.
- No confirm-dialog framework for type switching beyond a simple guard.
- No title-page / metadata.

## Risks
- **Two structured stores + sourceText coherence:** three representations now (`sourceElements`, `beatSheet`, `sourceText`). Mitigated by the single coherence rule — every edit writes the active structured store AND `sourceText` from the same data; only one structured store is active per `docKind`. Flag for careful review of the commit paths.
- **Assistant beat-edit reliability:** depends on the CLI returning valid beat JSON; mitigated by the structured contract + graceful plain-reply fallback + user Accept/Decline (nothing lands unconfirmed).
- **serializeBeatSheet ↔ breakdown prompt fit:** the block format must be legible to the existing breakdown/shotlist prompts. Verified by the end-to-end driven test; the format is plain labeled text, close to how scenes already read.
