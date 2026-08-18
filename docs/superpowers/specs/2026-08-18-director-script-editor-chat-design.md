# Director Script Editor, Chat Assistant & Per-Scene Breakdown — Design

**Date:** 2026-08-18
**Status:** Approved (brainstorming), pending implementation plan
**Builds on:** `2026-08-18-director-page-redesign-design.md` (the four-tab workbench). This phase replaces the Script and Breakdown tabs' internals.

## Problem

After the four-tab redesign, two tabs need to become real tools:

1. **Script tab** is a plain textarea with an awkward Formatted/Edit toggle and broken
   screenplay layout (dialogue not indented under cues). The user wants a single
   unified **auto-formatting screenplay editor** (like Final Draft / Fountain apps),
   a left side-panel of assets, and a right side-panel AI **chat assistant** that can
   actually edit the script.
2. **Breakdown tab** is a flat card grid of every asset. The user wants it reframed as
   a **per-scene production view**: pick a scene, read just that scene's script, and
   see/manage the assets that scene needs — with better extraction (time-of-day on
   locations, set-dressing props).

## Foundations (shared infrastructure)

### Screenplay document model
Today the script is one flat `sourceText` string; FDX/RTF are flattened on upload, so
element structure is lost. The editor needs a typed model.

**New module: `src/lib/director/screenplay.ts`**
```ts
export type ScreenplayElementType =
  | 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';

export interface ScreenplayElement { id: string; type: ScreenplayElementType; text: string }
export interface Screenplay { elements: ScreenplayElement[] }

// parse plain sourceText (or Fountain) into typed elements
export function parseToScreenplay(source: string): Screenplay;
// serialize back to sourceText (source of truth stays a string in DirectorShow)
export function serializeScreenplay(doc: Screenplay): string;
// the element type after Tab / Shift+Tab from a given type
export function nextElementType(t: ScreenplayElementType, reverse?: boolean): ScreenplayElementType;
// the type an Enter press produces after a given element (character→dialogue, etc.)
export function typeAfterEnter(t: ScreenplayElementType): ScreenplayElementType;
```
`parseToScreenplay` reuses the classification rules from the existing
`parseScreenplay` in `script-format.ts` (scene-heading / character-cue / dialogue /
parenthetical / transition / action detection), extended to emit stable ids and the
richer `Screenplay` shape. The old `parseScreenplay` (read-only line list) stays for
any remaining callers; the new module is the editable model.

**Storage:** `DirectorShow.sourceText` remains the source of truth (a string). The
editor parses it into a `Screenplay` on mount/edit and serializes back on change, so
there is **no `DirectorShow` migration** and breakdown/shotlist keep reading
`sourceText`. The cycle order is the `ScreenplayElementType` union order above.

### Scene segmentation
Both tabs need the script split into scenes with their own text/elements.

**New module: `src/lib/director/scene-split.ts`**
```ts
export interface ScriptScene { index: number; heading: string; intExt?: string; timeOfDay?: string; elements: ScreenplayElement[] }
export function splitScenes(doc: Screenplay): ScriptScene[];       // split on 'scene' elements
export function parseHeading(heading: string): { intExt?: string; timeOfDay?: string; place: string };
```
`parseHeading` extracts INT/EXT and time-of-day (DAY/NIGHT/DUSK/DAWN/CONTINUOUS/…)
from a scene heading like `INT. DR. JORDAN'S OFFICE - DAY`.

### Asset ↔ scene detection
Which breakdown assets appear in a scene, derived live from that scene's text.

**New module: `src/lib/director/scene-assets.ts`**
```ts
export interface SceneAssetHit { kind: BreakdownKind; name: string; item?: DirectorBreakdownItem }
// non-overlapping, longest-name-first matches of breakdown items in a scene's text
export function detectSceneAssets(scene: ScriptScene, breakdown: DirectorBreakdownItem[]): SceneAssetHit[];
// tokenize a line into [ {text, kind?} ] runs for colored highlighting (no HTML nesting)
export function highlightRuns(text: string, breakdown: DirectorBreakdownItem[]): Array<{ text: string; kind?: BreakdownKind }>;
```
`highlightRuns` implements the tokenize-once algorithm validated in the mockup:
collect non-overlapping matches on plain text (longest term wins), return typed runs
the React layer maps to colored `<mark>`s. This is the auto-detect layer; a manual
per-scene override map and a background-LLM refine pass layer on top (below).

## Script tab

Three columns, both side panels **collapsible** via a notch handle on the panel's
inner edge; when collapsed the panel width → 0 and the script reflows; an edge
"reopen" notch restores it. (CSS grid with `min-width:0` on the panels is required so
tracks collapse to 0 — validated in the mockup.)

```
[ left assets panel (collapsible) | screenplay editor (paper) | chat assistant (collapsible) ]
[ ───────────── bottom type legend, horizontally centered ───────────── ]
```

### Editor (center)
- A single WYSIWYG "paper" surface rendering the `Screenplay` elements with real
  screenplay metrics: scene headings (accent, bold), action (full width), character
  cues (centered/indented, uppercased), parentheticals, dialogue (indented under the
  cue), transitions (right-aligned). No Formatted/Edit split.
- **Editing / auto-format engine:**
  - Each element is an editable line. Typing edits that element's `text`.
  - **Tab** = next element type, **Shift+Tab** = previous (cycles the union order).
  - **Enter** creates a new element whose type follows `typeAfterEnter` (character →
    dialogue; dialogue → dialogue; action → action; scene → action).
  - Character cues auto-uppercase on blur/commit.
  - The current element's type shows in a status indicator.
  - **No modifier-key (Cmd/Ctrl+number) shortcuts** — they collide with the
    browser/OS. Type control is Tab/Shift+Tab + the clickable bottom legend only.
- **Bottom legend** (horizontally centered): the 6 types with color swatches; the
  active element's type is highlighted; clicking a chip sets the selected element's
  type. No hint text.
- Edits serialize back into `DirectorShow.sourceText` (debounced).

### Left assets panel (collapsible)
Tabbed: **Scenes** (navigator — click to scroll the editor to that scene), **Cast**,
**Locations**, **Props** — all derived from `splitScenes` + `breakdown`. Colors:
character `#9db4ff`, location `#8fe0a8`, prop `#e0a88f` (shared token set).

### Right chat assistant (collapsible)
A CLI-backed writing assistant reusing the existing chat infrastructure
(`invokeCliCopilotChat` / `subscribeCliCopilotStream`, provider = `show.llmProvider`).

- **Capabilities:** answer questions (read-only Q&A), edit script lines, generate new
  scenes, and be **selection-aware** (a chip shows the currently selected element/scene
  and the assistant operates on it).
- **Edit flow — inline diff with Accept/Decline, in the script:** when the assistant
  proposes changes, they render **in place in the editor** as a diff — removed lines
  struck through with a red left-border, added lines with a green left-border, and
  inline **✓ Accept / ✕ Decline** controls at the change. The chat message notes
  "proposed edit to N lines (SCx)". Accept commits the change to the `Screenplay`
  (and thus `sourceText`); Decline reverts. Read-only answers show no diff.
- The assistant returns a **structured edit proposal** (a JSON contract the system
  prompt requests), so the app can map it to element add/remove/replace against the
  document model rather than guessing from prose:
  ```ts
  interface AssistantEdit { op: 'replace' | 'insert-after' | 'delete';
    targetElementId?: string;   // for replace/delete/insert-after
    elements?: ScreenplayElement[]; } // new elements for replace/insert
  interface AssistantResponse { reply: string; edits?: AssistantEdit[] }
  ```
  A new `src/lib/director/script-assistant.ts` owns the system prompt, the request
  build (script + selection context), and parsing the JSON response into
  `AssistantResponse`. Malformed JSON → treat as a plain reply (no edits), never crash.

## Breakdown tab (per-scene production view)

Three zones:
```
[ scene navigator | this scene's script (highlighted) | this scene's assets (tabbed) ]
```

- **Scene navigator (left):** each scene — number, heading, and colored count pips
  (characters/locations/props). Click to select.
- **Scene script (center):** just the selected scene's elements, rendered read-only
  with **color-coded highlights** by asset type (via `highlightRuns`). **Clicking a
  highlight** switches the right panel to that asset's type tab (if not on All) and
  scrolls+flashes its card.
- **Scene assets (right):** **horizontally scrollable** tab bar — **All / Characters /
  Locations / Props**, each with a colored pip and a live count. Cards show:
  - **Reference image thumbnail** when the linked Element has one
    (`element.images[0]`); otherwise the colored placeholder icon + a "no ref" marker.
  - name, `@tag`, and for **locations** an **INT/EXT · TIME-OF-DAY** badge (from
    `parseHeading`).
  - status badge: linked / missing / AI-added.
  - editable description (inline).
  - actions: **Generate ref** (or "+ Add ref" when none), **Re-link** / **Create +
    link** (missing), **✕ remove from scene**; each group has **+ Add** to add an
    asset manually.
- Header: **Re-run breakdown**, **Generate all refs**, and an "AI checked" badge.

### Asset association: auto → background-LLM → manual
1. **Auto (instant):** `detectSceneAssets` derives each scene's assets live from its
   text + the breakdown list.
2. **Background LLM refine:** after breakdown, an async job asks the CLI which assets
   (incl. implied set-dressing) belong to each scene, producing a per-scene override
   that *adds* AI-suggested assets (shown as "AI-added"). Non-blocking; the UI works
   from auto results until it returns.
3. **Manual override:** the user can add/remove assets per scene; overrides persist and
   win over both auto and LLM. Stored as a per-scene asset map on the show (see below).

**Merge rule (the displayed asset list for scene i):** start with the union of
`detectSceneAssets(scene, breakdown)` (auto) and `sceneAssetSuggestions[i]` (AI-added,
flagged as such); then apply `sceneAssetOverrides[i]`: add `added[]`, drop `removed[]`.
Each resulting entry resolves to its `DirectorBreakdownItem` by tag for name/desc/link
status/ref image. A pure `resolveSceneAssets(show, sceneIndex, breakdown, scene)`
helper in `scene-assets.ts` computes this and is unit-tested.

### Better extraction quality (breakdown prompt + model)
This is a correctness fix, not just UI:
- **Locations carry time-of-day + INT/EXT.** Parsed from scene headings by
  `parseHeading`; the breakdown prompt is also updated to record it.
- **Set-dressing / furniture are extracted as props** (sofa, armchair, table,
  shelves, curtains…), not only handled objects. Update `BREAKDOWN_SYSTEM_PROMPT` in
  `src/lib/director/llm-jobs.ts` to (a) require time-of-day + INT/EXT on every
  location and (b) explicitly extract set dressing and furniture as props.

## Data model changes

Additive to `DirectorShow` — **no migration** (all new fields optional):
```ts
// per-scene manual asset overrides: sceneIndex -> { added: string[]; removed: string[] } (asset tags)
sceneAssetOverrides?: Record<number, { added: string[]; removed: string[] }>;
// background-LLM per-scene suggestions: sceneIndex -> asset tags
sceneAssetSuggestions?: Record<number, string[]>;
```
`DirectorBreakdownItem` gains (locations): `timeOfDay?: string; intExt?: string`.
Existing fields unchanged; `sourceText` stays the script's source of truth.

## Component structure

Script tab (replaces `director-script-tab.tsx`'s internals):
- `director-script-tab.tsx` — 3-column shell + collapsible state + bottom legend.
- `screenplay-editor.tsx` — the editable paper (renders `Screenplay`, Tab/Enter engine).
- `director-script-assets.tsx` — left tabbed assets panel (Scenes/Cast/Loc/Props).
- `director-script-chat.tsx` — right chat assistant (messages, composer, CLI picker).
- Editor inline-diff rendering lives in `screenplay-editor.tsx` driven by a pending
  `AssistantEdit[]`.

Breakdown tab (replaces `director-breakdown-tab.tsx`):
- `director-breakdown-tab.tsx` — 3-zone shell + scene selection.
- `scene-script-view.tsx` — read-only highlighted scene script + click-through.
- `scene-assets-panel.tsx` — scrollable asset tabs + cards (image, tod badge, actions).

Shared collapsible-panel primitive:
- `collapsible-panel.tsx` — panel with a notch handle + reopen tab (used by both side
  panels on the Script tab).

Pure logic (unit-tested):
- `screenplay.ts`, `scene-split.ts`, `scene-assets.ts`, `script-assistant.ts`.

## Testing

- **Unit (TDD):** `parseToScreenplay`/`serializeScreenplay` round-trip and type
  detection; `nextElementType`/`typeAfterEnter` transitions; `splitScenes` +
  `parseHeading` (INT/EXT + time-of-day, incl. CONTINUOUS/no-time); `detectSceneAssets`
  + `highlightRuns` (non-overlapping, longest-first, correct kind, no nesting — the
  exact cases the mockup's browser test caught); `script-assistant` response parsing
  (valid edits, malformed JSON → plain reply).
- **Driven/manual:** the tab components verified by driving the app — auto-format
  typing (Tab/Enter), collapse/expand panels, chat propose→accept/decline updates the
  script, breakdown scene switch + highlight click-through + tab filter + ref
  thumbnails.

## Non-goals (YAGNI)

- No full Fountain spec compliance (dual dialogue, sections, synopses, boneyard) —
  the six core element types only.
- No collaborative/multiuser editing, no revision history beyond accept/decline of the
  current proposal.
- No PDF import (unchanged guard).
- No change to shotlist/generate LLM logic or the video adapters.
- The chat assistant applies only script edits (add/remove/replace elements); it does
  not run shotlists, generate video, or touch settings.

## Risks

- **Auto-format editor on contentEditable** is the hardest part — caret handling,
  Tab/Enter interception, and keeping the `Screenplay` model in sync with the DOM. Keep
  the model authoritative: the DOM renders from it, edits update it, re-render from the
  model. Start with a robust line-based approach (one editable element per line) rather
  than a free contentEditable blob.
- **Assistant edit mapping** depends on the CLI returning valid JSON. Mitigated by the
  structured contract + graceful fallback to a plain reply; Accept/Decline means no
  edit lands without user confirmation.
- **Highlight click-through / overlap** — mitigated by the tokenize-once algorithm
  with unit tests for the overlap cases already found in the mockup.
- **`sourceText` round-trip fidelity** — `parseToScreenplay`→`serializeScreenplay`
  must not lose content; covered by round-trip unit tests.
