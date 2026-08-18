# Director Page Redesign — Design

**Date:** 2026-08-18
**Status:** Approved (brainstorming), pending implementation plan

## Problem

The Director page (`src/components/director/director-tab.tsx`) presents its entire
workflow — write/upload script → breakdown → shotlist → generate — as a single
always-on three-column grid (`300px | 1fr | 320px`). Every control is visible at
once, producing a dense wall. The mode pills (Source / Breakdown / Shotlist /
Generate) are decorative: they set `show.mode` but do **not** change the layout, so
they mislead more than they help.

Two concrete goals:

1. **Make the page user-friendly** by giving each stage its own room instead of
   cramming all three columns together.
2. **Add a Script view** where an uploaded script can actually be read — formatted
   as a screenplay — and edited in place as the source of truth.

## Chosen direction

A **four-tab workbench** where the mode tabs genuinely swap the main stage
(Prototype B from brainstorming). This preserves the user's "see everything, jump
around" work style while removing the density.

This is a **layout reorganization**, not a logic rewrite. All existing state
(`DirectorShow`) and all existing handlers in `director-tab.tsx`
(`runBreakdown`, `runShotlist`, `runGenerate`, `generateOne`, `runRewrite`,
`runLookBible`, `approveBreakdown`, `createMissing`, etc.) are reused unchanged.
The only new *logic* is a pure screenplay parser for the formatted Script view.

## Layout

```
┌─ Toolbar ───────────────────────────────────────────────────────────────┐
│  🎬 Director  [Script][Breakdown][Shotlist][Generate]   ⚙Setup 🎨Look 🤖LLM  status │
├──────────────────────────────────────────────────────────────────────────┤
│  Script / Breakdown tab   →  full-width stage (no rail)                    │
│  Shotlist / Generate tab  →  [ structure rail (scenes→clips) | stage ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Toolbar
- **Brand** + **four mode tabs**: Script / Breakdown / Shotlist / Generate. Only
  the active tab's content is mounted. Tab state replaces the current
  `show.mode` pill row; `show.mode` continues to hold the active tab id
  (`'source'` maps to the Script tab — keep the existing `DirectorMode` union;
  the Script tab uses the `'source'` id to avoid a state migration).
- **Active tab is driven by `show.mode`.** The tabs set `show.mode`, and any
  handler that already sets `mode` (e.g. `approveBreakdown` → `'shotlist'`,
  `runShotlist` → `'shotlist'`, `runGenerate` → `'generate'`) therefore also
  switches the visible tab for free. No separate tab-activation state.
- **Setup** button → collapsible drawer/popover with clip length, adapter, aspect,
  resolution, genre, generate-audio. (Moved out of the old left panel.)
- **Look bible** button → drawer/popover wrapping the existing
  `DirectorLookBiblePanel` unchanged.
- **LLM picker** stays in the toolbar (existing `DirectorLlmPicker`).
- **Job status** message renders in the toolbar as today (`show.jobStatus.message`).
- **Tab affordances**: done-dot on Script when `show.sourceText` is non-empty;
  count badge on Breakdown (`show.breakdown.length`) and Shotlist
  (non-alt clip count).

### Structure rail
- A scenes → clips tree (reuses today's Board scene/clip selection logic).
- **Persistent on Shotlist & Generate only.** Hidden on Script & Breakdown, which
  take full width.
- **Clicking a clip stays on the current tab** — it only changes
  `selectedClipId` / `selectedSceneId`. This lets the user flip clip-to-clip
  inside Generate or Shotlist without being yanked to another tab.

## Tab contents

Each tab is a presentational component fed by `show` and the existing callbacks
passed down from `director-tab.tsx`. No handler signatures change.

### 📝 Script tab (full width)
- Header: filename (`show.sourceFileName`) · **Upload** (existing `loadScript`
  path via `extractScriptText`) · **Edit / Formatted** toggle · **Run breakdown →**
  (accent; calls `runBreakdown`, then activates the Breakdown tab).
- **Edit mode**: full-height `<textarea>` bound to `show.sourceText` — unchanged
  source-of-truth editing.
- **Formatted mode**: read-only screenplay render parsed from `show.sourceText`
  (see Screenplay parser). Toggling to Formatted never mutates `sourceText`.
- Footer: word count + "source of truth for breakdown & shotlist" note.

### 🧩 Breakdown tab (full width)
- Action row: **Approve breakdown →** (`approveBreakdown`, activates Shotlist tab
  as it already sets `mode: 'shotlist'`), **Create missing (n)** (`createMissing`),
  **Generate refs** (`onOpenElements`).
- Card grid of `show.breakdown` grouped by kind, each card: tag · name · blurb ·
  **linked / missing** badge (reuses `findMatchingElement` / `itemsMissingElements`).
  Replaces the cramped registry list in the old source panel.

### 🎞 Shotlist tab (rail + stage)
- Stage: **Shotlist show** / **Shotlist scene** buttons (`runShotlist(false|true)`),
  the scene `event` / `physicalAction` fields (existing Board inputs), and a
  **clip board** — cards per clip in the selected scene (thumb, title,
  `seconds`/`beats.length`, shot chips). Clicking a clip selects it.

### ✨ Generate tab (rail + stage)
- Stage for the selected clip, absorbing today's Board viewer/takes **and** the
  entire Inspector:
  - video **preview** (selected take's asset),
  - **variant** buttons (Full / Hold to Ns / Native) — existing `setClipVariant`,
  - **compiled prompt** block: editable active-variant body (`bodyEdits` +
    `activeBody`) and read-only compiled prompt (`adapter.buildRequest`),
  - **preflight + warnings** (existing `preflight` / `warnings` props),
  - **Generate variant / scene / queued** (`runGenerate(scope)`),
  - **takes** strip (double-click = hero, existing `setHeroTake`),
  - **shot timings** editor (existing beat dur/text inputs),
  - **director notes / rewrite** (`runRewrite`, `keepPendingRewrite`,
    `discardPendingRewrite`).

## Screenplay parser (only new logic)

Today's `extractScriptText` (in `src/lib/director/look-bible.ts`) flattens uploads
to plain text at upload time, so formatting structure is not preserved in
`sourceText`. The formatted view therefore parses the stored text on demand.

**New module: `src/lib/director/script-format.ts`** — a pure function:

```ts
export type ScriptLineType =
  | 'scene-heading'  // INT./EXT./EST./I/E. prefix
  | 'transition'     // CUT TO:, FADE OUT., DISSOLVE TO:
  | 'character'      // short ALL-CAPS cue line
  | 'parenthetical'  // (beat)
  | 'dialogue'       // block following a cue, until blank line
  | 'action';        // everything else

export interface ScriptLine {
  type: ScriptLineType;
  text: string;
  sceneIndex?: number; // increments on each scene-heading
}

export function parseScreenplay(source: string): ScriptLine[];
```

Detection rules (Fountain-flavored, degrades to plain text):
- **scene-heading**: line matches `^\s*(INT|EXT|EST|INT\.?/EXT|I\.?/E)\b` (case-insensitive).
- **transition**: ALL-CAPS line ending in `TO:` or matching `FADE (IN|OUT)`/`DISSOLVE`.
- **character**: short (`< ~30` chars) ALL-CAPS line that is not a heading/transition,
  followed by a non-blank line.
- **parenthetical**: trimmed line wrapped in `( … )`.
- **dialogue**: lines after a character cue (and its parentheticals) until a blank line.
- **action**: default.

The Formatted view maps each `ScriptLine.type` to a CSS class (centered headings in
gold, centered cues, indented dialogue, right-aligned transitions, plain action).
`extractScriptText` and the upload path are **unchanged**.

## Component decomposition

The three large panels are replaced by tab components plus small shared pieces:

- `director-tab.tsx` — keeps all state/handlers; renders toolbar + active tab +
  drawers. Owns which tab is active.
- `director-toolbar.tsx` — tabs, Setup/Look/LLM triggers, status.
- `director-setup-drawer.tsx` — render settings (from old source panel top).
- `director-structure-rail.tsx` — scenes→clips tree (from Board).
- `director-script-tab.tsx` — editor + formatted view.
- `director-breakdown-tab.tsx` — registry card grid.
- `director-shotlist-tab.tsx` — shotlist buttons + scene fields + clip board.
- `director-generate-tab.tsx` — preview, variants, prompt, generate, takes,
  timings, notes (absorbs Inspector + Board viewer).
- Shared pieces extracted as needed (clip fields, prompt block, takes strip).
- `director-look-bible.tsx` and `director-llm-picker.tsx` reused as-is (wrapped in
  drawers/toolbar).

Old files retired: `director-source-panel.tsx`, `director-board.tsx`,
`director-inspector.tsx` (their contents move into the tab components).

## Testing

- **Unit (TDD):** `tests/lib/director/script-format.test.ts` covering
  scene-heading detection, character-cue vs. action, dialogue grouping,
  parenthetical, transition, and plain-text fallback.
- **Manual/driven:** the tab components are presentational wrappers over unchanged
  logic; verify by driving the app (upload a script, toggle formatted view, run
  breakdown → approve → shotlist → generate, flip clips in the rail without losing
  the active tab).

## Non-goals (YAGNI)

- No scene ↔ script cross-linking / click-to-jump (user chose edit-in-place, not
  navigate).
- No PDF import (still out of scope; existing `extractScriptText` guard stays).
- No change to breakdown/shotlist/generate LLM logic or the video adapters.
- No visual restyle beyond what the new layout requires; keep the existing theme
  tokens and `director-tab.css` conventions.

## Risks

- **Screenplay parser accuracy** on messy real scripts — mitigated by graceful
  degradation to `action` lines and unit tests; the Edit view is always available
  and lossless.
- **State-id mapping**: the Script tab reuses the `'source'` `DirectorMode` id to
  avoid a `DirectorShow` migration; the tab labels differ from the union values,
  so the mapping must be explicit in one place.
