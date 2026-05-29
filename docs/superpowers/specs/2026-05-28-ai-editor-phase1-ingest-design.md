# AI Assistant Editor — Phase 1: Full Project Awareness (Ingest + Unified Index)

> **Status:** Design — approved for spec review
> **Date:** 2026-05-28
> **Author:** Chris + Claude (brainstorming session)

## Context

CineGen's LLM tab ("Copilot") should become a legit AI assistant editor — one that can
analyze footage and build genuinely good rough cuts, including taking an interview and
shaping it into a short documentary-style story. This requires the Copilot to know *every*
clip deeply: audio, transcript, visual content, and — critically — vocal **performance and
emotion**, for every asset in both the media pool and the timeline.

This is a **phased program**. This spec covers **Phase 1 only**.

### Where the program is going (for context — NOT in scope here)

| Phase | Outcome | Depends on |
| --- | --- | --- |
| **1 (this spec)** | Full project awareness: every asset carries transcript + word timing + visual summary + **NEW acoustic-emotional descriptors** + **NEW objective silence map**, unified into the insight index and queryable in chat. | — |
| 2 | Smarter selection: performance-aware retrieval (replace keyword `.includes()`), story-shape discovery, repetition/contradiction map. Specialized per video style via the existing editorial **persona**, not by hardcoding. | Phase 1 data |
| 3 | Human-feeling output: snap cuts to breaths/silence, room-tone handles, J-cuts / L-cuts. | Phase 1 silence map |

**A basic rough cut already works today** via `runCutWorkflow` → `buildTimelineFromCutProposal`,
but it is transcript/keyword-driven ("flat, robotic" assembly). The phased program turns that
into well-selected, well-structured, human-feeling cuts. **Phase 1 is the unlock** — Phases 2
and 3 have nothing good to reason or cut against without performance/emotion data per moment.

## What already exists (verified in codebase)

- ✅ **Transcription** — WhisperX with word-level timestamps (`electron/ipc/transcription.ts`,
  `scripts/whisperx/cinegen_infer.py`). Stored in `asset.metadata.transcription.segments[].words[]`.
- ✅ **Visual summaries** — Gemini-based per-asset (`electron/ipc/vision.ts`
  `analyzeAssetVisualSummary`), stored in `asset.metadata.llmVisualSummary` with a
  `status: missing|queued|analyzing|ready|failed` lifecycle. Renderer persists the IPC result
  into asset metadata (pattern in `src/components/workspace/workspace-shell.tsx` ~L1425–1467).
- ✅ **Editorial reasoning (Tier 2, partial)** — `runCutWorkflow` in `electron/ipc/llm-chat.ts`
  produces an `EditorialBrief`, divergent `CutVariant`s, scorecards, ranking. Types in
  `src/lib/llm/editorial-workflow.ts`.
- ✅ **Insight index** — `buildProjectInsightIndex` builds `InsightMoment[]` from transcript
  segments + maps them to timeline placements; `retrieveRelevantMoments` does keyword scoring.
- ✅ **Cut engine (Tier 3, basic)** — `buildTimelineFromCutProposal` (`src/lib/llm/cut-plan.ts`)
  creates a real timeline with linked video+audio clips on V2/A2.
- ✅ **Gemini multimodal pipeline** — `electron/ipc/gemini-cli.ts` (CLI, inline `@/path` media
  attach), `electron/ipc/vision.ts` (API). ffmpeg/ffprobe via `electron/lib/ffmpeg-paths.ts`.
- ✅ **Waveform peaks** — `src/lib/editor/waveform.ts` `extractWaveformPeaks` (renderer-side
  Web Audio; amplitude only — NOT silence boundaries).

## What is missing (the gap Phase 1 closes)

1. **Acoustic / emotional analysis pass** — entirely absent. No vocal delivery, emotion, pacing,
   laughter, or reflective-pause data.
2. **Objective silence map** — no per-asset silence-boundary data. (`extractWaveformPeaks` gives
   amplitude envelopes, not silence intervals; runs in renderer.)
3. **Index enrichment** — `InsightMoment` carries transcript text only; no performance/emotion
   descriptors joined in.

## Decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Acoustic extraction method | **Gemini multimodal on audio** for subjective descriptors. PLUS objective silence map computed **locally via ffmpeg `silencedetect`** as a cheap substrate (Phase 3 needs exact boundaries an LLM won't give reliably). |
| Audio chunking for Gemini | **Whole-clip audio, once**, with transcript + timecodes in the prompt; Gemini returns descriptors keyed to timecodes. Fewer calls, full pacing context. |
| Storage | **`asset.metadata.analysis`** block in the project DB — consistent with `transcription` and `llmVisualSummary`, travels with the project, already read by `buildProjectInsightIndex`. |
| When the pass runs | **Hybrid (C)**: on-demand per asset (button + chat action) PLUS a one-click **"Analyze entire project"** batch in the LLM tab with progress. Mirrors the existing vision-summary status lifecycle. |
| Footage scope | **General-purpose ingest** — acoustic/emotional analysis is footage-agnostic. Speechless B-roll still gets visual + content descriptors flagged as cutaway candidates. Style specialization is deferred to Phase 2 via the existing editorial **persona**, not hardcoded here. |

### Why hyper-descriptive text, not flat scores

Per the architecture critique: convert vocal/visual micro-behaviors into **rich descriptive
text** (`delivery: "voice steadies then cracks on 'home'"`) rather than lossy numbers
(`delivery_strength: 9`). The only numeric field is a `confidence` in the analysis itself.
This grounds Phase 2's reasoning and gives an auditable log when a cut misses.

## Architecture

### New file: `electron/ipc/acoustic-analysis.ts`

Exposes `registerAcousticHandlers()` registering one IPC handler (plus a cancel), following the
exact shape of `vision.ts` `registerVisionHandlers()`:

```
acoustic:analyze-asset   → AcousticAnalysisResult   (per-asset, on demand)
acoustic:cancel          → void                     (cancel in-flight)
```

The handler does, for one asset:

1. **Resolve audio source** — the asset's local `fileRef` (media is persisted locally per
   `generated-asset-persist` / `media-import`). For video, extract an audio track to a temp
   `.wav`/`.m4a` via ffmpeg (`getFfmpegPath()`); for audio assets use directly.
2. **Objective silence map (local, free)** — run ffmpeg
   `-af silencedetect=noise=-30dB:d=0.3 -f null -` and parse `silence_start` / `silence_end`
   from stderr into `silenceMap: [{ start, end }]`. Threshold/min-duration are constants
   (tunable later); documented defaults: noise floor `-30dB`, min silence `0.3s`.
3. **Subjective descriptors (Gemini multimodal)** — send the whole-clip audio once with the
   transcript segments + timecodes embedded in the prompt; instruct Gemini to return JSON
   descriptors keyed to those timecodes. Reuses the Gemini path already used by `vision.ts`
   (API model `gemini-2.5-flash` default) — same model-selection + error handling conventions.
   For speechless clips (no transcript segments), request visual/content + cutaway descriptors
   instead, so B-roll is still catalogued.
4. **Assemble + return** `AcousticAnalysisResult` (status `ready` or `failed` with `error`).
   The handler does **not** write the DB — it returns the result; the renderer persists it into
   `asset.metadata.analysis` (mirroring the vision-summary pattern in `workspace-shell.tsx`).

Cleanup: delete the temp extracted-audio file in a `finally`.

### Data shape — `asset.metadata.analysis`

```jsonc
{
  "status": "ready",                 // missing|queued|analyzing|ready|failed
  "model": "gemini-2.5-flash",
  "updatedAt": "2026-05-28T...Z",
  "error": null,
  "sourceDurationSec": 612.4,
  "hasSpeech": true,
  "silenceMap": [                    // objective, local (ffmpeg silencedetect)
    { "start": 12.04, "end": 12.30 }
  ],
  "segments": [                      // subjective, Gemini, keyed to timecodes
    {
      "start": 12.04, "end": 12.32,
      "delivery": "voice steadies then cracks slightly on 'home'",
      "emotion": "reflective",
      "energy": "low-and-deliberate",
      "pace": "slow",
      "notable": ["400ms pause before 'home'", "usable as hook"],
      "confidence": 0.8
    }
  ],
  // For speechless / B-roll clips, segments[] instead carry visual/content
  // descriptors with a cutawayCandidate flag, e.g.:
  // { "start": 0, "end": 8.0, "content": "exterior of old church, golden hour",
  //   "shotType": "wide", "cutawayCandidate": true, "confidence": 0.7 }
}
```

### Type additions — `src/lib/llm/editorial-workflow.ts`

Add `AssetAcousticAnalysis`, `AcousticSegment`, and a `VisualSummaryStatus`-style
`AnalysisStatus` reusing the existing union. Mirror the existing `AssetVisualSummary` style so
the parsing/normalization helpers look familiar.

### Index enrichment — `buildProjectInsightIndex` (surgical)

`InsightMoment` gains optional fields populated by **joining `analysis.segments` to transcript
moments by overlapping timecode** (and attaching nearest `silenceMap` boundaries):

```ts
interface InsightMoment {
  // ...existing...
  delivery?: string;
  emotion?: string;
  energy?: string;
  pace?: string;
  notable?: string[];
  silenceBefore?: { start: number; end: number };
  silenceAfter?: { start: number; end: number };
}
```

A new helper `extractAcousticSegments(asset)` parallels the existing
`extractTranscriptSegments(asset)` / `getStoredVisualSummary(asset)`. The join is the whole task.

**Phase 1 does NOT change `retrieveRelevantMoments` / `scoreMoment`.** Retrieval stays keyword-based;
we only make the new data *present, parsed, and queryable in chat*. (Performance-aware ranking is
explicitly Phase 2.)

### Chat exposure

The enriched moments flow into the existing project-context / `runCutWorkflow` path
(`src/lib/llm/project-context.ts`, `electron/ipc/llm-chat.ts`) so the Copilot can answer
content + performance + emotion questions immediately ("where does she get emotional?",
"strongest opening line?", "where does she repeat herself?"). No new chat plumbing beyond
including the new fields when serializing moments for context.

### UI — three entry points (mirror vision-summary UX)

1. **Per-asset "Analyze" affordance** in the Edit left panel / workspace (where
   `llmVisualSummary` status already renders). Shows `queued/analyzing/ready/failed`.
2. **Chat action** — "analyze this clip" routed to `acoustic:analyze-asset`.
3. **"Analyze entire project"** batch button in the LLM tab: iterates un-analyzed assets,
   queues each, shows progress; reuses the status lifecycle so it survives reload.

### Preload / IPC wiring

Add `acoustic.analyzeAsset` / `acoustic.cancel` to `electron/preload.ts` and `electron.d.ts`,
register `registerAcousticHandlers()` in main, mirroring `vision`.

## Components & boundaries

| Unit | Responsibility | Depends on | Independently testable? |
| --- | --- | --- | --- |
| `acoustic-analysis.ts` (IPC) | Extract audio, silence map, Gemini descriptors → result | ffmpeg paths, Gemini path | Yes — feed a fixture clip, assert result shape |
| silence-map parser (pure fn) | Parse ffmpeg `silencedetect` stderr → intervals | none | Yes — feed captured stderr text |
| acoustic prompt + JSON normalizer (pure fns) | Build prompt; parse/validate Gemini JSON → `AcousticSegment[]` | none | Yes — feed sample model output |
| `extractAcousticSegments` + index join | Read metadata, join by timecode into moments | editorial-workflow types | Yes — feed an asset + assert enriched moments |
| Renderer persistence | Write result into `asset.metadata.analysis`, status lifecycle | existing asset-update path | Yes — reuse vision-summary test approach |
| UI entry points | Trigger + show status | preload API | Manual/Playwright |

## Error handling

- **No audio track / corrupt media** → `status: failed`, `error` set, `hasSpeech: false`;
  never throws into the renderer.
- **ffmpeg silencedetect fails** → still attempt Gemini; return with empty `silenceMap` and a
  warning in `error` (partial success is acceptable; silence map is Phase 3's concern).
- **Gemini returns malformed/again-non-JSON** → normalizer salvages valid segments, drops the
  rest; if none, `status: failed`. Same tolerant approach as `normalizeCutVariants`.
- **Timecode drift** (Gemini timecodes off) → join uses overlap with epsilon; moments with no
  acoustic overlap simply keep transcript-only fields (graceful degradation).
- **Cancellation** → in-flight Gemini/ffmpeg child processes killed; status reverts to prior.

## Testing strategy

- **Unit (vitest)**: silence-map parser, prompt builder, Gemini-JSON normalizer,
  `extractAcousticSegments` + index join. These are pure functions — primary coverage.
- **Integration**: `acoustic:analyze-asset` against a short committed fixture clip (or mocked
  ffmpeg + mocked Gemini) asserting `AcousticAnalysisResult` shape and metadata persistence.
- **Manual**: run "Analyze entire project" on a real interview; confirm chat answers a
  performance question ("where does she get emotional?") citing real timecodes.

## Out of scope (explicitly)

- Performance-aware retrieval / ranking (Phase 2).
- Story-shape discovery, repetition/contradiction map (Phase 2).
- Breath-snapping, room-tone handles, J/L cuts (Phase 3).
- Changing `runCutWorkflow`'s variant strategies.
- Per-style hardcoding — handled later via editorial persona.

## Success criteria for Phase 1

1. Running the acoustic pass on an interview asset writes a well-formed `analysis` block
   (silence map + segment descriptors) into its metadata, with a visible status lifecycle.
2. "Analyze entire project" processes all un-analyzed assets with progress and survives reload.
3. Enriched moments appear in the insight index; the Copilot answers a performance/emotion
   question about a clip with real timecodes — without any Phase 2/3 work.
4. Speechless B-roll clips get visual/cutaway descriptors.
5. All pure-function units covered by passing vitest tests.
