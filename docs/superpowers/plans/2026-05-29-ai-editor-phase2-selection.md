# AI Editor Phase 2 — Smarter Selection Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Every new selection function is a
> **pure function** in `src/lib/llm/` — testable under vitest with no Electron/network.

**Goal:** Replace flat keyword retrieval with persona-specialized, performance-aware ranking that
reads the Phase 1 emotion/energy/pace/delivery/notable fields; add a story-shape map and a
repetition/contradiction map to the project insight index; expose both in chat. Hybrid design:
deterministic heuristic backbone + optional LLM re-rank that can only reorder, never regress.

**Spec:** `docs/superpowers/specs/2026-05-29-ai-editor-phase2-selection-design.md`

**Tech Stack:** TypeScript, pure functions in `src/lib/llm/`, vitest. LLM re-rank/refine routed
through the existing `runCutWorkflow` transport in `electron/ipc/llm-chat.ts` (no new IPC).

---

## File Structure

| File | Responsibility | New? |
| --- | --- | --- |
| `src/lib/llm/selection.ts` | Pure: `ScoringWeights`, `PERSONA_WEIGHTS`, `scoreMomentPerformance`, story-shape + relation-map builders, rerank prompt/apply | Create |
| `tests/lib/llm/selection.test.ts` | Unit tests for all of the above | Create |
| `src/lib/llm/editorial-workflow.ts` | Route `retrieveRelevantMoments` through the new scorer; add `storyShape`/`relationMap` to `ProjectInsightIndex`; populate in `buildProjectInsightIndex` | Modify |
| `tests/lib/llm/editorial-workflow-selection.test.ts` | Retrieval ordering + index-enrichment tests | Create |
| `src/lib/llm/project-context.ts` | Serialize story arc + relations compactly into chat context | Modify |
| `electron/ipc/llm-chat.ts` | Pass `persona` into retrieval; optionally invoke LLM re-rank/refine behind a flag | Modify |
| `src/components/llm/llm-tab.tsx` | Read-only topbar stats: story arc + duplicate count | Modify |

---

## Task 1: Scoring weights, persona profiles, performance-aware scorer (pure)

**Files:** Create `src/lib/llm/selection.ts`, Test `tests/lib/llm/selection.test.ts`

- [ ] **Step 1: Write failing tests**
  - `BASE_WEIGHTS` has the documented keyword defaults (termInText=4, termElsewhere=2,
    activeTimeline=2, wordTiming=2).
  - `scoreMomentPerformance(moment, terms, ctx)` returns `{ score, reasons }`.
  - With no persona, a moment with matching keyword text outscores one matching only in words
    (mirrors current `scoreMoment` relative ordering).
  - With `persona: 'promo-trailer-editor'`, a moment with `energy: 'high-driving'` outscores an
    otherwise-identical `energy: 'low-and-deliberate'` moment for the same keywords.
  - With `persona: 'documentary-editor'`, the reflective/slow moment wins instead.
  - A query containing an emotion word ("emotional", "angry") boosts moments whose `emotion`
    matches (`emotionQueryMatch`), and `reasons` explains why.
  - `notable` entries each add `notableSignal` and appear in `reasons`.

- [ ] **Step 2: Run tests — expect FAIL** (`npx vitest run tests/lib/llm/selection.test.ts`)

- [ ] **Step 3: Implement** `ScoringWeights`, `BASE_WEIGHTS`, `PersonaWeightProfile`,
  `PERSONA_WEIGHTS` (one row per existing `EditorialPersona`; fuzzy token match on energy/pace
  free text), and `scoreMomentPerformance`. Import `EditorialPersona`/`InsightMoment` types from
  `editorial-workflow.ts` (or move shared types to avoid a cycle — see Task 2 note). Keep it pure.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(selection): performance-aware scorer with persona weight profiles`

---

## Task 2: Route `retrieveRelevantMoments` through the new scorer (no regression)

**Files:** Modify `src/lib/llm/editorial-workflow.ts`, Test `tests/lib/llm/editorial-workflow-selection.test.ts`

> **Import-cycle note:** `selection.ts` needs `InsightMoment`/`EditorialPersona` from
> `editorial-workflow.ts`, and `editorial-workflow.ts` will import the scorer back. If TS flags a
> cycle, extract the shared *types* into `editorial-workflow.ts` (type-only imports don't cause
> runtime cycles) — confirm `npx tsc --noEmit` is clean.

- [ ] **Step 1: Write failing tests**
  - `retrieveRelevantMoments(index, query)` with no opts returns the same *set* and a stable order
    consistent with today (regression guard — build fixtures mirroring current expectations).
  - `retrieveRelevantMoments(index, query, { persona: 'promo-trailer-editor' })` ranks a
    high-energy moment above a flat one that the old scorer tied.
  - `RetrievedMoment.reason` now contains performance reasons when applicable.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** — add optional `opts?: { limit?: number; persona?: EditorialPersona }`
  to `retrieveRelevantMoments`; call `scoreMomentPerformance`; map structured reasons into
  `RetrievedMoment.reason`. Keep `scoreMoment` exported if other callers use it, or delete if not
  (grep first).

- [ ] **Step 4: Run tests + full llm suite — expect PASS** (`npx vitest run tests/lib/llm/`)

- [ ] **Step 5: Commit** `feat(selection): route retrieval through performance-aware scorer`

---

## Task 3: Story-shape map (heuristic, on the index)

**Files:** Modify `src/lib/llm/selection.ts` + `editorial-workflow.ts`, Test both test files

- [ ] **Step 1: Write failing tests**
  - `buildStoryShape(moments)` returns `StoryBeat`-labeled points; a fixture with a low-intensity
    opening, an energy peak in the back half, and a calm close yields setup → … → climax → …
    → resolution with a sensible `arcSummary` and `method: 'heuristic'`.
  - Intensity derives from energy/emotion tokens (`high/driving` high, `calm/reflective` low).

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** `StoryBeat`, `StoryShapePoint`, `StoryShape`, `buildStoryShape` (pure);
  add `storyShape: StoryShape` to `ProjectInsightIndex`; populate in `buildProjectInsightIndex`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(selection): heuristic story-shape map on the insight index`

---

## Task 4: Repetition / contradiction map (heuristic, on the index)

**Files:** Modify `src/lib/llm/selection.ts` + `editorial-workflow.ts`, Test both test files

- [ ] **Step 1: Write failing tests**
  - `buildRelationMap(moments)` flags two near-identical-text moments as `repetition` with high
    `similarity`; unrelated moments produce no relation.
  - Contradiction heuristic only flags *candidate* pairs (high overlap + opposite emotion cue);
    does not over-claim.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** `MomentRelation`, `RelationMap`, `buildRelationMap` (token-overlap
  similarity, pure); add `relationMap: RelationMap` to `ProjectInsightIndex`; populate in
  `buildProjectInsightIndex`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(selection): heuristic repetition/contradiction map`

---

## Task 5: Optional LLM re-rank (pure prompt + pure apply)

**Files:** Modify `src/lib/llm/selection.ts`, Test `tests/lib/llm/selection.test.ts`

- [ ] **Step 1: Write failing tests**
  - `buildRerankPrompt({query, brief, candidates})` includes persona, story goal, and candidate
    ids+text.
  - `applyRerankResult(heuristic, json)` reorders by the model's id order; **malformed JSON →
    returns heuristic unchanged**; **missing ids → kept at tail in heuristic order**; **unknown
    ids → ignored**.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement** `buildRerankPrompt` + `applyRerankResult` (both pure; reuse the
  tolerant JSON extraction style from `acoustic-analysis.ts`/`vision.ts`).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(selection): optional LLM re-rank prompt + graceful apply`

---

## Task 6: Wire persona + opt-in re-rank into the cut workflow

**Files:** Modify `electron/ipc/llm-chat.ts`

- [ ] **Step 1: Find where `runCutWorkflow` calls `retrieveRelevantMoments`** and where the
  `EditorialBrief` (with `persona`, `qualityGoal`) is available.

- [ ] **Step 2: Implement** — pass `brief.persona` into `retrieveRelevantMoments`. When the
  re-rank flag is on (e.g. `qualityGoal !== 'auto'` or an explicit option), build the rerank
  prompt, call the existing LLM transport, and `applyRerankResult`. On any error, keep heuristic
  order. Re-rank only the top slice already returned.

- [ ] **Step 3: Typecheck** (`npx tsc --noEmit` — no new errors)

- [ ] **Step 4: Commit** `feat(selection): persona-aware retrieval + opt-in re-rank in cut workflow`

---

## Task 7: Serialize story-shape + relations into chat context

**Files:** Modify `src/lib/llm/project-context.ts`

- [ ] **Step 1: Find the project-context serializer** (where moments/transcript are rendered).

- [ ] **Step 2: Implement** — append a compact `arcSummary` line and a capped relations list
  (e.g. top duplicate clusters). If truncated, note the dropped count (no silent cap).

- [ ] **Step 3: Typecheck + full llm suite** — PASS

- [ ] **Step 4: Commit** `feat(selection): expose story shape and duplicate moments in chat context`

---

## Task 8: LLM-tab read-only stats

**Files:** Modify `src/components/llm/llm-tab.tsx`

- [ ] **Step 1: Implement** — add an "arc: {summary}" stat and a "{n} duplicate moments" stat to
  the topbar index area, sourced from `projectInsightIndex.storyShape` / `.relationMap`. Read-only.

- [ ] **Step 2: Typecheck** — no new errors.

- [ ] **Step 3: Commit** `feat(selection): surface story arc and duplicate count in LLM tab`

---

## Task 9: Full verification + changelog

- [ ] **Step 1: `npm test`** — all pass incl. new selection suites.
- [ ] **Step 2: `npx tsc --noEmit`** — only the 3 known pre-existing errors remain.
- [ ] **Step 3: Manual** — open a project with analyzed clips; confirm persona affects ranking,
  and the Copilot answers a "where does she repeat herself?" / "emotional climax?" question.
- [ ] **Step 4: Changelog** — add a Phase 2 bullet under the LLM tab section of
  `UPCOMING_RELEASE.md`.
- [ ] **Step 5: Commit** `docs: note performance-aware selection (Phase 2) in upcoming release`

---

## Self-Review notes

- **No-regression guard is mandatory** (Task 2 Step 1): the default `retrieveRelevantMoments` path
  must remain a superset of today's behavior, since `runCutWorkflow` and chat already depend on it.
- **Determinism**: scoring, story shape, relations, and rerank-apply are pure and tested. The only
  non-deterministic piece (the LLM re-rank/refine *call*) is isolated in `llm-chat.ts` and can only
  reorder an already-good list.
- **Persona = data, not branches**: all specialization lives in `PERSONA_WEIGHTS`; adding a persona
  is one row, no control-flow changes.
