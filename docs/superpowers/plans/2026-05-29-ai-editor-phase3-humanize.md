# AI Editor Phase 3 — Human-Feeling Output Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. All humanization logic is **pure**
> (`timeline-in / timeline-out`), testable under vitest with no Electron/network. **Opt-in**: the
> default `buildTimelineFromCutProposal` path must stay byte-for-byte unchanged.

**Goal:** Snap generated cut boundaries to the Phase 1 silence map, add room-tone handles, and
produce J/L cuts via the linked video↔audio model — all behind an opt-in `humanize` option, applied
as a pure post-processor after `buildTimelineFromCutProposal`.

**Spec:** `docs/superpowers/specs/2026-05-29-ai-editor-phase3-humanize-design.md`

**Tech Stack:** TypeScript, pure functions in `src/lib/llm/` + reuse `src/lib/editor/timeline-operations.ts`, vitest.

---

## File Structure

| File | Responsibility | New? |
| --- | --- | --- |
| `src/lib/llm/cut-humanize.ts` | Pure: `SilenceContext`, `HumanizeOptions`/`DEFAULT_HUMANIZE`, `snapClipsToSilence`, `applyJLCuts`, `humanizeCutTimeline` | Create |
| `tests/lib/llm/cut-humanize.test.ts` | Unit tests for all of the above | Create |
| `src/lib/llm/cut-plan.ts` | Add optional `humanize?` param to `buildTimelineFromCutProposal`; run post-processor when present | Modify |
| `tests/lib/llm/cut-plan-humanize.test.ts` | No-regression test (no opt) + opt-in end-to-end test | Create |
| `electron/ipc/llm-chat.ts` | Pass `humanize` through the cut workflow when requested | Modify |
| `src/components/llm/llm-tab.tsx` | "Humanize cut" toggle + applied-cut summary note | Modify |

---

## Task 1: Silence context + nearest-edge lookup (pure)

**Files:** Create `src/lib/llm/cut-humanize.ts`, Test `tests/lib/llm/cut-humanize.test.ts`

- [ ] **Step 1: Write failing tests**
  - `buildSilenceContext(assets)` reads `asset.metadata.analysis.silenceMap` and returns sorted
    intervals per assetId; assets without analysis return `[]`.
  - `nearestSilenceEdge(silences, time, tolerance, side)` returns the closest edge within
    tolerance, `null` when none; respects `side` ('in' prefers a silence end before the cut,
    'out' prefers a silence start after it).

- [ ] **Step 2: Run tests — expect FAIL** (`npx vitest run tests/lib/llm/cut-humanize.test.ts`)

- [ ] **Step 3: Implement** `SilenceInterval` reuse, `SilenceContext`, `buildSilenceContext`,
  `nearestSilenceEdge`. Pure.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(humanize): silence context + nearest-edge lookup over Phase 1 map`

---

## Task 2: Snap-to-silence + room-tone handles (pure, clamped)

**Files:** Modify `src/lib/llm/cut-humanize.ts`, Test `tests/lib/llm/cut-humanize.test.ts`

- [ ] **Step 1: Write failing tests**
  - `HumanizeOptions` / `DEFAULT_HUMANIZE` exist with documented defaults
    (snapTolerance 0.4, roomToneHandle 0.08, minClipDuration 0.5, maxOverlap 0.5).
  - A clip whose out-point sits 0.2s before a silence edge snaps to that edge + room-tone handle.
  - A clip 2s from any silence is left untouched.
  - Clamp: snapping never yields effective duration < `minClipDurationSec`, never trims past
    source bounds, never overlaps a neighbor's content.
  - Downstream clip `startTime`s recompute so the timeline stays gapless after snapping.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** `snapClipsToSilence(timeline, ctx, opts)` — per clip compute source
  in/out from `trimStart`/`duration-trimEnd`, snap via `nearestSilenceEdge`, extend by room-tone
  into silence, clamp, then re-flow `startTime`s (cursor or `rippleTrim` from timeline-operations).
  Pure.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(humanize): snap cut boundaries to silence with room-tone handles`

---

## Task 3: J-cuts / L-cuts via linked-audio offset (pure)

**Files:** Modify `src/lib/llm/cut-humanize.ts`, Test `tests/lib/llm/cut-humanize.test.ts`

- [ ] **Step 1: Write failing tests**
  - On a linked V+A pair where the outgoing clip ends in silence and source handle exists,
    `applyJLCuts` offsets the audio `startTime`/trim relative to video (measurable overlap),
    bounded by `maxOverlapSec`.
  - Where silence/handle conditions aren't met, the pair stays frame-aligned (no change).
  - Audio stays linked (`linkedClipIds` intact) and never exceeds source bounds.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** `applyJLCuts(timeline, ctx, opts)` — find linked pairs via
  `getLinkedIds`; for J/L conditions, adjust the audio clip's `startTime`/`trimStart`/`trimEnd`
  within `maxOverlapSec` + available source + silence presence. Pure.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(humanize): J/L cuts via linked-audio offset where silence permits`

---

## Task 4: Orchestrator

**Files:** Modify `src/lib/llm/cut-humanize.ts`, Test `tests/lib/llm/cut-humanize.test.ts`

- [ ] **Step 1: Write failing test** — `humanizeCutTimeline(timeline, ctx, opts)` runs
  `snapClipsToSilence` then `applyJLCuts`, each gated by its opt flag; multi-clip fixture yields a
  gapless timeline with snapped boundaries and ≥1 J/L cut. Disabling both flags returns an
  equivalent timeline.

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement** `humanizeCutTimeline`. Pure.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit** `feat(humanize): humanizeCutTimeline orchestrator`

---

## Task 5: Opt-in integration into the cut builder (no regression)

**Files:** Modify `src/lib/llm/cut-plan.ts`, Test `tests/lib/llm/cut-plan-humanize.test.ts`

- [ ] **Step 1: Write failing tests**
  - **No-regression:** `buildTimelineFromCutProposal({proposal, assets, existingTimelines})` with
    no `humanize` produces the exact same clip array as before (compare against a fixture snapshot).
  - **Opt-in:** passing `humanize: DEFAULT_HUMANIZE` with a silence-bearing fixture produces snapped
    boundaries / a J/L cut.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** — add optional `humanize?: HumanizeOptions` to the params; when present,
  build `SilenceContext` from `assets` and run `humanizeCutTimeline` on the assembled timeline
  before returning. When absent, return exactly as today.

- [ ] **Step 4: Run tests + full llm suite — expect PASS** (`npx vitest run tests/lib/llm/`)

- [ ] **Step 5: Commit** `feat(humanize): opt-in humanize pass in buildTimelineFromCutProposal`

---

## Task 6: Wire the humanize toggle through the cut workflow

**Files:** Modify `electron/ipc/llm-chat.ts` (+ wherever cuts are applied)

- [ ] **Step 1: Find** where `buildTimelineFromCutProposal` / `buildCombinedCutProposal` is invoked
  in the apply path and where the brief/options are available.

- [ ] **Step 2: Implement** — thread a `humanize` flag (from brief/UI) into the builder call.
  Default off (conservative).

- [ ] **Step 3: Typecheck** — no new errors.

- [ ] **Step 4: Commit** `feat(humanize): pass humanize option through cut workflow`

---

## Task 7: UI toggle + summary note

**Files:** Modify `src/components/llm/llm-tab.tsx`

- [ ] **Step 1: Implement** — a "Humanize cut" toggle near cut generation/apply (off by default).
  When on, pass `DEFAULT_HUMANIZE`. Optionally add a one-line note to the applied-cut summary
  ("snapped N cuts to silence, M J/L cuts").

- [ ] **Step 2: Typecheck** — no new errors.

- [ ] **Step 3: Commit** `feat(humanize): Humanize cut toggle in LLM tab`

---

## Task 8: Full verification + changelog

- [ ] **Step 1: `npm test`** — all pass incl. new humanize suites.
- [ ] **Step 2: `npx tsc --noEmit`** — only the 3 known pre-existing errors remain.
- [ ] **Step 3: Manual** — generate a cut from analyzed footage with Humanize on; confirm it plays
  without clipped syllables, boundaries land in pauses, and a J/L cut is audible without sync drift.
  Then generate with Humanize off and confirm output matches pre-Phase-3 behavior.
- [ ] **Step 4: Changelog** — add a Phase 3 bullet under the LLM tab section of
  `UPCOMING_RELEASE.md`.
- [ ] **Step 5: Commit** `docs: note human-feeling cut output (Phase 3) in upcoming release`

---

## Self-Review notes

- **Opt-in is the contract** (Task 5 Step 1): the no-`humanize` path must be unchanged. The
  regression snapshot test is the guard — do not skip it.
- **Clamp everything**: snapping and J/L offsets are bounded by `minClipDurationSec`,
  `maxOverlapSec`, available source handle, and neighbor content. No boundary may cross into a
  neighbor or exceed source.
- **Reuse, don't reinvent**: lean on `timeline-operations.ts` (`rippleTrim`, `getLinkedIds`,
  `clipEffectiveDuration`) rather than recomputing clip math by hand.
- **Pure + testable**: the only non-pure touchpoints are the `llm-chat.ts` wiring and the UI
  toggle; all boundary math lives in `cut-humanize.ts` and is unit-tested.
