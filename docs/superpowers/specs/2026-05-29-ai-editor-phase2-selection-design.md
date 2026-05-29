# AI Assistant Editor — Phase 2: Smarter Selection (Performance-Aware Retrieval + Story Shape)

> This is **Phase 2** of the phased AI-editor program. Phase 1 (ingest: acoustic/emotional
> descriptors + objective silence map, unified into the insight index) is complete and merged.
> Phase 2 turns that data into **smarter selection** — it does NOT touch cut assembly (Phase 3).

**Goal:** Replace the flat keyword `.includes()` retrieval with **performance-aware ranking** that
reads the Phase 1 emotion/energy/pace/delivery/notable fields, specialized per video style via the
existing **editorial persona** (not hardcoded), plus two new project-level analyses the Copilot can
cite: a **story-shape map** (where the narrative arc sits across moments) and a
**repetition / contradiction map** (which moments say the same thing or conflict).

## Where the program is going (recap — NOT in scope here)

| Phase | Outcome | Depends on |
| --- | --- | --- |
| 1 (done) | Full project awareness: transcript + word timing + visual summary + acoustic-emotional descriptors + silence map, unified + queryable. | — |
| **2 (this spec)** | Smarter selection: performance-aware retrieval (replace keyword `.includes()`), story-shape discovery, repetition/contradiction map. Persona-specialized. | Phase 1 data |
| 3 | Human-feeling output: snap cuts to breaths/silence, room-tone handles, J-cuts / L-cuts. | Phase 1 silence map |

## What already exists (verified in codebase)

- ✅ **`scoreMoment(moment, terms, activeTimelineId)`** — `src/lib/llm/editorial-workflow.ts:505`.
  Pure keyword scoring: builds a lowercased haystack from `assetName + text + words`, adds
  `+4` per term in `text` / `+2` elsewhere, `+2` active-timeline bonus, `+2` word-timing bonus.
  **Ignores every Phase 1 acoustic field.**
- ✅ **`retrieveRelevantMoments(index, query, limit=24)`** — `editorial-workflow.ts:519`. Maps
  `scoreMoment` over `index.moments`, filters `score > 0`, sorts by score then `sourceStart`,
  returns `RetrievedMoment[]` with a string `reason`.
- ✅ **`InsightMoment`** — `editorial-workflow.ts:27`. Carries Phase 1 fields:
  `delivery?`, `emotion?`, `energy?`, `pace?`, `notable?`, `silenceBefore?`, `silenceAfter?`,
  plus `text`, `words`, `sourceStart/End`, `timelinePlacements`.
- ✅ **`EditorialPersona`** — `editorial-workflow.ts:7`. Union of 5:
  `documentary-editor | promo-trailer-editor | brand-storyteller | social-shortform-editor |
  interview-producer`. Already a field on `EditorialBrief.persona` (`editorial-workflow.ts:88`).
- ✅ **`RetrievedMoment` / `RetrievalSummary`** — `editorial-workflow.ts:114` / `:127`.
- ✅ **`ProjectInsightIndex`** — `editorial-workflow.ts:175`, with `.stats` and `.moments`.
- ✅ **`runCutWorkflow`** (`electron/ipc/llm-chat.ts`) consumes `retrievalSummary` to build
  variants. UI calls live in `src/components/llm/llm-tab.tsx` (`buildProjectInsightIndex`,
  cut workflow handlers).
- ✅ **Cloud LLM transport** — the existing fal/Anthropic chat path used by `runCutWorkflow`; and
  the local Gemini CLI one-shot helper `analyzeMediaWithGeminiCli` (text-in/text-out is reusable
  for a text re-rank if we route through a CLI, though re-rank here is a text-only LLM call).

## What is missing (the gap Phase 2 closes)

1. **Performance signal in ranking** — `scoreMoment` is blind to emotion/energy/pace/delivery.
   A reflective, cracking-voice line scores identically to a flat throwaway with the same words.
2. **Persona specialization** — persona is captured in the brief but never steers *which moments
   surface*. A promo-trailer editor and a documentary editor get the same ranked list.
3. **Story-shape awareness** — no notion of narrative arc position (setup / rising / climax /
   resolution) across the project, so the Copilot can't reason about *structure*.
4. **Repetition / contradiction map** — no detection of moments that restate or conflict with each
   other, so cuts can accidentally include three takes of the same sentence.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| Ranking approach | **Hybrid.** A deterministic **heuristic prefilter** (pure, unit-tested) scores every moment using keyword relevance + Phase 1 performance fields + persona weights, producing the top-N. An **optional LLM re-rank** then reorders the top slice by story fit. Heuristic always runs; re-rank is opt-in (off for cheap/offline, on for "make me the best cut"). |
| Persona specialization | **Via the existing `EditorialPersona`**, expressed as a per-persona **weight profile** (a data table), NOT hardcoded branches. Adding a persona = adding a row. |
| Determinism | Heuristic scoring is a **pure function**, fully unit-testable, no LLM/network. The LLM re-rank is isolated behind a flag and degrades to heuristic order on any failure. |
| Story-shape + repetition map | Computed as **project-level analyses over the index**, stored on `ProjectInsightIndex` (derived, not persisted to the DB — rebuilt with the index). Heuristic-first; an LLM pass may refine but must degrade gracefully. |
| Backward compatibility | `retrieveRelevantMoments` keeps its signature and default behavior when no persona/flags are supplied, so existing callers don't change. New behavior is additive via optional params. |

### Why hybrid (not pure-LLM or pure-heuristic)

Pure keyword misses performance entirely (the Phase 1 unlock). Pure-LLM re-rank of *every* moment
is slow, costly, and non-deterministic — and untestable. The hybrid keeps a fast, auditable,
testable heuristic as the backbone (which alone already beats today's behavior because it reads
emotion/energy), and spends LLM budget only on reordering a small, already-relevant slice.

## Architecture

### 2.1 Performance-aware heuristic scoring (pure)

Extend scoring in `src/lib/llm/editorial-workflow.ts`. Rather than mutating `scoreMoment`'s
signature (used internally), add a richer scorer and route `retrieveRelevantMoments` through it:

```ts
export interface ScoringWeights {
  termInText: number;        // keyword found in transcript text
  termElsewhere: number;     // keyword in assetName/words only
  activeTimeline: number;    // moment already used on the active timeline
  wordTiming: number;        // has word-level timestamps
  hasEmotion: number;        // any emotion descriptor present
  hasDelivery: number;       // delivery descriptor present (vocal performance)
  energyMatch: number;       // energy matches persona's preferred energy
  paceMatch: number;         // pace matches persona's preferred pace
  notableSignal: number;     // per notable[] entry (hooks, pauses, beats)
  emotionQueryMatch: number; // query mentions an emotion word that this moment carries
}

export type PersonaWeightProfile = Record<EditorialPersona, {
  weights: Partial<ScoringWeights>;     // overrides on the base weights
  preferredEnergy: string[];            // e.g. promo-trailer → ['high', 'driving', 'punchy']
  preferredPace: string[];              // e.g. documentary → ['slow', 'measured', 'deliberate']
  emotionBias: string[];                // emotions this persona favors surfacing
}>;
```

- A `BASE_WEIGHTS: ScoringWeights` constant captures today's behavior (termInText=4,
  termElsewhere=2, activeTimeline=2, wordTiming=2, all new perf weights default to sensible
  positives) so that **with no persona the heuristic is a strict superset of current scoring**.
- `PERSONA_WEIGHTS: PersonaWeightProfile` is the single data table where specialization lives.
  Energy/pace matching is **fuzzy substring/synonym** against the persona's preferred lists
  (the Phase 1 fields are free text like `"low-and-deliberate"`, so we match on tokens).
- New scorer: `scoreMomentPerformance(moment, terms, ctx): { score: number; reasons: string[] }`
  where `ctx = { activeTimelineId, persona?, queryEmotions: string[] }`. Returns structured
  reasons (e.g. `"reflective emotion (persona bias)"`, `"hook noted in performance"`) so the
  `RetrievedMoment.reason` becomes genuinely informative.
- `retrieveRelevantMoments(index, query, opts?)` gains an optional
  `opts: { limit?; persona?; }`. Default path (no opts) ≈ current ordering plus perf tie-breaks.

### 2.2 Optional LLM re-rank (isolated, degrades gracefully)

A new pure helper builds the re-rank prompt; the LLM call is a thin wrapper:

```ts
export function buildRerankPrompt(params: {
  query: string;
  brief: Pick<EditorialBrief, 'persona' | 'tone' | 'storyGoal' | 'pacing'>;
  candidates: RetrievedMoment[];     // already heuristically ranked top slice
}): string;

export function applyRerankResult(
  heuristic: RetrievedMoment[],
  rerankJson: string,                // model output: ordered ids + 1-line reasons
): RetrievedMoment[];                // reorders heuristic; unknown ids dropped to tail
```

- Re-rank is invoked only inside `runCutWorkflow` (`electron/ipc/llm-chat.ts`) when a
  `rerank: true` option is set (wired to a brief/quality-goal signal, e.g. `qualityGoal !== 'auto'`
  or an explicit toggle). It re-orders **only the heuristic top slice** (e.g. top 24 → reordered),
  never the whole index.
- `applyRerankResult` is pure and unit-tested: malformed JSON, missing ids, or extra ids all fall
  back to heuristic order. On any LLM error, the caller keeps the heuristic list. **No regression
  path** — re-rank can only reorder an already-good list, never break retrieval.

### 2.3 Story-shape map (project-level, heuristic-first)

Add a derived analysis to `ProjectInsightIndex`:

```ts
export type StoryBeat = 'setup' | 'rising' | 'climax' | 'falling' | 'resolution';

export interface StoryShapePoint {
  momentId: string;
  position: number;        // 0..1 normalized position in the dominant timeline (or asset order)
  beat: StoryBeat;         // heuristic assignment
  intensity: number;       // 0..1 from energy/emotion descriptors
  reason: string;
}

export interface StoryShape {
  points: StoryShapePoint[];
  arcSummary: string;      // one-line ("front-loaded, weak resolution")
  method: 'heuristic' | 'llm-refined';
}
```

- **Heuristic**: order moments by timeline placement (or `sourceStart` when unplaced), derive an
  `intensity` curve from energy/emotion tokens (`high/driving` → high, `calm/reflective` → low),
  and label beats by position + local intensity (climax = global intensity peak in the back half,
  setup = low-intensity opening, etc.). Pure, testable.
- Stored as `ProjectInsightIndex.storyShape`, computed in `buildProjectInsightIndex`.
- Optional LLM refinement (same opt-in flag as re-rank) can relabel beats; `method` records which.

### 2.4 Repetition / contradiction map (project-level, heuristic-first)

```ts
export interface MomentRelation {
  aId: string;
  bId: string;
  kind: 'repetition' | 'contradiction';
  similarity: number;      // 0..1
  reason: string;
}

export interface RelationMap {
  relations: MomentRelation[];
  method: 'heuristic' | 'llm-refined';
}
```

- **Repetition (heuristic)**: token-overlap / normalized-text similarity between moment `text`
  fields above a threshold → flag as repetition (catches multiple takes of the same line). Pure.
- **Contradiction (heuristic)**: cheap negation/antonym signal is unreliable, so the heuristic only
  flags *candidate* pairs (high lexical overlap but opposite sentiment cue, or shared subject with
  conflicting emotion); precise contradiction detection is the LLM refinement's job (opt-in).
- Stored as `ProjectInsightIndex.relationMap`. Exposed in chat context so the Copilot can warn
  "moments 4, 9, and 14 are the same sentence — pick one" and avoid stacking duplicates in a cut.

### 2.5 Chat / cut-workflow exposure

- `buildProjectInsightIndex` returns the enriched index (`storyShape`, `relationMap`) and
  `retrieveRelevantMoments` returns perf-aware order with informative reasons.
- Serialize the new analyses into the project context (`src/lib/llm/project-context.ts`) compactly
  — story arc summary + a short relations list (cap the count, `log`/note if truncated) so the
  Copilot can cite structure and dedupe.
- `runCutWorkflow` passes `persona` into retrieval and (optionally) runs the re-rank.

### 2.6 UI (minimal)

- The LLM-tab topbar index area (where "N assets / transcripts / clips / visuals" live) gains a
  small **story-shape affordance** (e.g. "arc: front-loaded") and a **"N duplicate moments"**
  stat from the relation map. Read-only; clicking opens the existing index popover style.
- No new heavy UI. The retrieval/ranking changes are invisible except in better cut output.

## Out of scope (explicitly)

- Cut assembly / boundary snapping / J-L cuts — **Phase 3**.
- Persisting story-shape / relation map to the DB (they're cheap to recompute with the index).
- Re-training or embeddings-based semantic search (token overlap is the Phase 2 baseline; a vector
  index is a possible Phase 2.5 if heuristic recall proves insufficient).
- New personas beyond the existing 5 (adding one later = one row in `PERSONA_WEIGHTS`).

## Success criteria for Phase 2

1. `retrieveRelevantMoments` with a `documentary-editor` persona surfaces reflective/measured
   moments above flat ones for the same keywords; with `promo-trailer-editor`, high-energy
   moments rise — verified by unit tests on fixture moments.
2. With no persona/opts, retrieval order is a stable superset of today's (no regression for
   existing callers) — verified by a test that mirrors the old scoring expectations.
3. `buildProjectInsightIndex` populates `storyShape` and `relationMap`; duplicate-take fixtures
   produce `repetition` relations — verified by unit tests.
4. The Copilot, asked "where does she repeat herself?" / "what's the emotional climax?", answers
   from the relation map / story shape with real moment references.
5. The optional LLM re-rank, when its output is malformed or absent, leaves retrieval identical to
   the heuristic order — verified by unit tests on `applyRerankResult`.
6. All new selection logic (scoring, story shape, relations, rerank-apply) is pure and unit-tested
   with no Electron/network dependency.
