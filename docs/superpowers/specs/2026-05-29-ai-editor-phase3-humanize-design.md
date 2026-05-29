# AI Assistant Editor — Phase 3: Human-Feeling Output (Snap-to-Silence + J/L Cuts)

> This is **Phase 3** of the phased AI-editor program. Phases 1 (ingest) and 2 (selection) supply
> the data this phase acts on. Phase 3 turns well-selected moments into a **human-feeling cut** by
> adjusting clip boundaries — it does NOT change selection/retrieval (Phase 2).

**Goal:** Make generated cuts feel hand-edited by (a) **snapping cut boundaries to nearby
silence/breath** instead of mid-word, (b) adding small **room-tone handles** so cuts don't clip the
last syllable, and (c) producing **J-cuts / L-cuts** (audio leads or trails the picture) using the
existing linked video↔audio clip model. **All opt-in and conservative** — default
`buildTimelineFromCutProposal` output is byte-for-byte unchanged unless humanization is requested.

## Where the program is going (recap)

| Phase | Outcome | Depends on |
| --- | --- | --- |
| 1 (done) | Ingest: acoustic descriptors + objective silence map, unified + queryable. | — |
| 2 (spec'd) | Smarter selection: performance-aware retrieval, story shape, repetition map. | Phase 1 data |
| **3 (this spec)** | Human-feeling output: snap cuts to breaths/silence, room-tone handles, J/L cuts. | Phase 1 silence map |

## What already exists (verified in codebase)

- ✅ **`buildTimelineFromCutProposal({proposal, assets, existingTimelines})`** —
  `src/lib/llm/cut-plan.ts:291`. Walks `proposal.segments`, resolves each to an asset, clamps
  `source_start`/`source_end` to asset duration, lays clips end-to-end with a `cursor`, and returns
  `AppliedCutTimeline { timeline, unresolvedSegments }`. **This is the single insertion point.**
- ✅ **`createLinkedVideoAudioClips({asset, startTime, sourceStart, sourceEnd, videoTrackId,
  audioTrackId})`** — `cut-plan.ts:211`. Emits a **linked V+A pair** sharing one `startTime`,
  `trimStart=sourceStart`, `trimEnd=assetDuration-sourceEnd`, cross-referenced via `linkedClipIds`.
  **J/L cuts = giving the audio clip a different `startTime`/trim than its linked video.**
- ✅ **`Clip`** — `src/types/timeline.ts:36`: `startTime`, `duration`, `trimStart`, `trimEnd`,
  `speed`, `volume`, `linkedClipIds?`. `clipEffectiveDuration` / `clipEndTime` helpers at `:86`/`:91`.
- ✅ **Tracks** — separate `video` and `audio` tracks (V2/A2 used by the cut builder); `TrackKind`
  union; gaps are implicit (clips positioned by `startTime`, no filler objects).
- ✅ **Timeline-operations toolkit** — `src/lib/editor/timeline-operations.ts`: `trimClip`,
  `rippleTrim`, `rollTrim`, `slipClip`, `slideClip`, `splitClip`, `removeClip`, `moveClip`,
  `linkClips`/`unlinkClips`, `getLinkedIds`, `calculateTimelineDuration`. Reusable, all pure
  (timeline-in/timeline-out).
- ✅ **Silence map (Phase 1)** — `asset.metadata.analysis.silenceMap: {start,end}[]` (objective,
  ffmpeg `silencedetect`), and per-moment `silenceBefore`/`silenceAfter` on `InsightMoment`.
  **Currently stored but not read by any cut logic — Phase 3 is its first consumer.**

## What is missing (the gap Phase 3 closes)

1. **Boundary snapping** — cuts land exactly on `source_start`/`source_end`, often mid-word or
   on a hard breath. No use of the silence map to nudge to the nearest silence.
2. **Room-tone handles** — no small pre-roll/post-roll padding into adjacent silence, so cuts can
   feel clipped/abrupt.
3. **J/L cuts** — linked V+A always share `startTime`; there's no way to let audio lead the picture
   in (J-cut) or trail out (L-cut), the hallmark of conversational editing.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| Default behavior | **Opt-in, conservative.** `buildTimelineFromCutProposal` is unchanged unless a `humanize` option is passed. No regressions to existing generated cuts. |
| Snapping data source | The **objective silence map** (Phase 1, ffmpeg) — exact boundaries an LLM won't give reliably. Snap only when a silence edge is within a small **tolerance window** (e.g. ≤ 0.4s) of the requested boundary; otherwise leave the boundary as-is. |
| Snapping safety | Snapping may only **shrink toward** or **extend into adjacent silence** within tolerance + a max-handle cap. It must **never** drop below a minimum clip duration or cross into a neighbor's content. Clamped + pure. |
| J/L cuts | Implemented by **offsetting the linked audio clip** relative to its video (audio `startTime` earlier = J-cut lead-in; later end = L-cut trail-out), bounded by available source handle and a max overlap. Opt-in per `humanize` config; conservative default overlap (e.g. ≤ 0.5s) only where adjacent silence permits. |
| Where it runs | A new **pure post-processor** `humanizeCutTimeline(timeline, ctx, opts)` applied *after* `buildTimelineFromCutProposal`. Keeps the builder simple and the humanization independently testable. |
| Config surface | A `HumanizeOptions` object (snap on/off, tolerance, handle length, J/L on/off, max overlap) with conservative defaults. Driven by the cut workflow / brief; a single "humanize" toggle in the UI. |

### Why a post-processor, not inline in the builder

The builder's job (resolve segments → clips) is orthogonal to boundary refinement. A separate pure
pass `(timeline, silenceContext, opts) → timeline` is: (a) trivially opt-in (don't call it),
(b) independently unit-testable on synthetic timelines + silence maps, (c) reusable on
*hand-built* timelines later (a "humanize this cut" command), and (d) incapable of regressing the
builder since the builder doesn't change.

## Architecture

### 3.1 Silence context (pure lookups over Phase 1 data)

New helpers in `src/lib/llm/cut-humanize.ts` build a per-asset silence lookup from
`asset.metadata.analysis.silenceMap` and answer boundary questions:

```ts
export interface SilenceContext {
  forAsset(assetId: string): SilenceInterval[];   // sorted, from analysis.silenceMap
}

export function buildSilenceContext(assets: Asset[]): SilenceContext;

/** Nearest silence edge to `time` within `tolerance`, or null. side picks which edge to prefer. */
export function nearestSilenceEdge(
  silences: SilenceInterval[],
  time: number,
  tolerance: number,
  side: 'in' | 'out',
): number | null;
```

Pure, no Electron. Reuses Phase 1's `SilenceInterval` type.

### 3.2 Snap-to-silence + room-tone handles (pure)

```ts
export interface HumanizeOptions {
  snapToSilence: boolean;       // default true when humanize on
  snapToleranceSec: number;     // default 0.4 — only snap if a silence edge is this close
  roomToneHandleSec: number;    // default 0.08 — pad into adjacent silence so cuts breathe
  minClipDurationSec: number;   // default 0.5 — never snap a clip shorter than this
  jlCuts: boolean;              // default true when humanize on
  maxOverlapSec: number;        // default 0.5 — cap on J/L audio lead/trail
}

export const DEFAULT_HUMANIZE: HumanizeOptions;

/** Adjust each clip's trim/startTime to land on nearby silence + add room-tone handles. Pure. */
export function snapClipsToSilence(
  timeline: Timeline,
  ctx: SilenceContext,
  opts: HumanizeOptions,
): Timeline;
```

- For each clip, compute its source in/out (from `trimStart` and `duration-trimEnd`), look up the
  nearest silence edge within `snapToleranceSec`, and adjust `trimStart`/`trimEnd` to that edge,
  optionally extending by `roomToneHandleSec` into the silence. **Clamp** so effective duration
  stays ≥ `minClipDurationSec` and never exceeds the source. Recompute downstream `startTime`s so
  the timeline stays gapless (reuse `clipEffectiveDuration` + a cursor, or `rippleTrim`).
- If no silence edge is within tolerance, the clip is left exactly as the builder produced it.

### 3.3 J-cuts / L-cuts (pure, via linked-audio offset)

```ts
/** Offset linked audio relative to video to create J/L cuts where silence permits. Pure. */
export function applyJLCuts(
  timeline: Timeline,
  ctx: SilenceContext,
  opts: HumanizeOptions,
): Timeline;
```

- Operate on linked V+A pairs (via `linkedClipIds` / `getLinkedIds`). For a **J-cut** (audio leads
  the next clip's picture): pull the *incoming* clip's audio `startTime` earlier by up to
  `maxOverlapSec`, lengthening its visible audio window (reduce its `trimStart`) only if the source
  has handle available and the *outgoing* clip ends in silence (so the overlap sits under quiet).
  For an **L-cut** (audio trails the previous picture): extend the outgoing clip's audio out-point
  past its video by up to `maxOverlapSec` into available source + adjacent silence.
- Audio and video clips become **independently positioned** (different `startTime`/trim) but stay
  linked. Bounded by `maxOverlapSec`, available source handle, and silence presence. Where
  conditions aren't met, the pair stays frame-aligned (no J/L).

### 3.4 Orchestrator

```ts
export function humanizeCutTimeline(
  timeline: Timeline,
  ctx: SilenceContext,
  opts: HumanizeOptions = DEFAULT_HUMANIZE,
): Timeline;   // snapClipsToSilence → applyJLCuts, each gated by opts
```

Pure. Idempotent enough to be safe to re-run. Returns a new timeline.

### 3.5 Integration (opt-in)

- `buildTimelineFromCutProposal` gains an **optional** `humanize?: HumanizeOptions` param. When
  present, it builds `SilenceContext` from `assets` and runs `humanizeCutTimeline` on the result
  before returning. **When absent, behavior is identical to today.**
- `runCutWorkflow` / the apply path passes `humanize` when the brief/UI requests it.

### 3.6 UI (minimal)

- A single **"Humanize cut" toggle** (or a brief field) near where cuts are generated/applied in
  `llm-tab.tsx`. Off by default to honor the conservative decision; when on, passes
  `DEFAULT_HUMANIZE`. Optionally a one-line note in the applied-cut summary ("snapped 7 cuts to
  silence, 3 J/L cuts").

## Out of scope (explicitly)

- Crossfades / audio ducking / room-tone *generation* (we only reposition existing audio into
  existing silence; no synthesized tone).
- Frame-accurate snapping to video content (beats/cuts-on-action) — silence/breath only.
- Changing selection or which segments are chosen (Phase 2).
- Persisting humanize settings to the DB beyond the brief.

## Success criteria for Phase 3

1. With no `humanize` option, `buildTimelineFromCutProposal` output is identical to today —
   verified by a regression test comparing clip arrays.
2. `snapClipsToSilence` moves a boundary that sits 0.2s before a silence edge onto that edge (and
   adds the room-tone handle), but leaves a boundary 2s from any silence untouched — verified on
   synthetic timeline + silence-map fixtures.
3. Snapping never produces a clip shorter than `minClipDurationSec` and never exceeds source bounds
   — verified by clamp tests.
4. `applyJLCuts` offsets a linked audio clip relative to its video (creating measurable overlap)
   only where adjacent silence + source handle permit, bounded by `maxOverlapSec`, and leaves the
   pair frame-aligned otherwise — verified by unit tests asserting `startTime`/trim deltas.
5. `humanizeCutTimeline` end-to-end on a multi-clip fixture yields a gapless timeline with snapped
   boundaries and at least one J/L cut — verified by an integration-style unit test.
6. All humanization logic is pure and unit-tested with no Electron/network dependency; manual
   check confirms a humanized generated cut plays without clipped syllables or sync drift.
