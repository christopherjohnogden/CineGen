# AI Editor Phase 1 — Ingest + Acoustic-Emotional Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the CineGen Copilot full per-clip awareness by adding an acoustic-emotional analysis pass (vocal delivery, emotion, pacing) plus a local objective silence map, stored in `asset.metadata.analysis` and joined into the project insight index so the chat knows every clip's performance.

**Architecture:** Pure functions (prompt building, ffmpeg `silencedetect` stderr parsing, model-JSON normalization, transcript↔acoustic timecode join) live in `src/lib/llm/acoustic-analysis.ts` — testable under vitest/jsdom with no Electron. A new Electron IPC handler `electron/ipc/acoustic-analysis.ts` extracts audio via ffmpeg, runs the silence detector, calls fal.ai `fal-ai/video-understanding` (multimodal, hears audio) for descriptors, and returns an `AcousticAnalysisResult`. The renderer persists the result into `asset.metadata.analysis`, mirroring the existing `llmVisualSummary` lifecycle. `buildProjectInsightIndex` enriches each `InsightMoment` by joining acoustic segments on overlapping timecodes. Retrieval logic is untouched (Phase 2).

**Tech Stack:** TypeScript, Electron (main + preload IPC), React 19 renderer, fal.ai client (`@fal-ai/client`), ffmpeg-static (`silencedetect`, audio extraction), better-sqlite3 (project DB via asset metadata), vitest (jsdom + node env).

**Spec:** `docs/superpowers/specs/2026-05-28-ai-editor-phase1-ingest-design.md`

---

## File Structure

| File | Responsibility | New? |
| --- | --- | --- |
| `src/lib/llm/acoustic-analysis.ts` | Pure functions: types, prompt builder, `silencedetect` parser, model-JSON normalizer | Create |
| `tests/lib/llm/acoustic-analysis.test.ts` | Unit tests for the pure functions above | Create |
| `src/lib/llm/editorial-workflow.ts` | Add acoustic types; enrich `InsightMoment`; add `extractAcousticSegments` + timecode join in `buildProjectInsightIndex` | Modify |
| `tests/lib/llm/editorial-workflow-acoustic.test.ts` | Unit tests for the index join | Create |
| `electron/ipc/acoustic-analysis.ts` | IPC handler: extract audio, run silence detect, call fal, assemble result; `registerAcousticHandlers()` | Create |
| `electron/main.ts` | Register the new handlers | Modify |
| `electron/preload.ts` | Expose `acoustic.analyzeAsset` / `acoustic.cancel` | Modify |
| `electron.d.ts` | Type the new preload API | Modify |
| `src/components/workspace/workspace-shell.tsx` | Trigger acoustic analysis + persist result into asset metadata (mirror visual-summary block) | Modify |
| `src/components/llm/llm-tab.tsx` | "Analyze entire project" batch button + progress | Modify |

The pure-function file is deliberately separate from the IPC file so all parsing/normalization logic is unit-tested without spinning up Electron or ffmpeg.

---

## Task 1: Acoustic analysis types + shared status

**Files:**
- Create: `src/lib/llm/acoustic-analysis.ts`
- Test: `tests/lib/llm/acoustic-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ACOUSTIC_ANALYSIS_VERSION, emptyAcousticAnalysis } from '@/lib/llm/acoustic-analysis';

describe('acoustic-analysis types', () => {
  it('exposes a version and an empty/missing analysis factory', () => {
    const empty = emptyAcousticAnalysis('asset-1');
    expect(empty.status).toBe('missing');
    expect(empty.assetId).toBe('asset-1');
    expect(empty.silenceMap).toEqual([]);
    expect(empty.segments).toEqual([]);
    expect(typeof ACOUSTIC_ANALYSIS_VERSION).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: FAIL — cannot resolve `@/lib/llm/acoustic-analysis`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/llm/acoustic-analysis.ts

/** Bump when the analysis shape changes so stale blocks can be re-run. */
export const ACOUSTIC_ANALYSIS_VERSION = 1;

export type AnalysisStatus = 'missing' | 'queued' | 'analyzing' | 'ready' | 'failed';

export interface SilenceInterval {
  start: number;
  end: number;
}

/** Subjective per-segment descriptor (speech). For speechless clips, `content`/`shotType`/`cutawayCandidate` are used instead of delivery/emotion. */
export interface AcousticSegment {
  start: number;
  end: number;
  delivery?: string;
  emotion?: string;
  energy?: string;
  pace?: string;
  notable?: string[];
  content?: string;
  shotType?: string;
  cutawayCandidate?: boolean;
  confidence?: number;
}

export interface AcousticAnalysisResult {
  assetId: string;
  status: AnalysisStatus;
  version: number;
  model?: string;
  updatedAt?: string;
  error?: string;
  sourceDurationSec?: number;
  hasSpeech?: boolean;
  silenceMap: SilenceInterval[];
  segments: AcousticSegment[];
}

export function emptyAcousticAnalysis(assetId: string): AcousticAnalysisResult {
  return {
    assetId,
    status: 'missing',
    version: ACOUSTIC_ANALYSIS_VERSION,
    silenceMap: [],
    segments: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/acoustic-analysis.ts tests/lib/llm/acoustic-analysis.test.ts
git commit -m "feat(acoustic): add acoustic analysis types and empty factory"
```

---

## Task 2: Parse ffmpeg `silencedetect` stderr into intervals

`ffmpeg -af silencedetect=noise=-30dB:d=0.3 -f null -` writes lines like
`[silencedetect @ 0x..] silence_start: 12.043` and `silence_end: 12.301 | silence_duration: 0.258`
to **stderr**. We pair each start with the next end.

**Files:**
- Modify: `src/lib/llm/acoustic-analysis.ts`
- Test: `tests/lib/llm/acoustic-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseSilenceDetect, SILENCE_NOISE_DB, SILENCE_MIN_DURATION } from '@/lib/llm/acoustic-analysis';

describe('parseSilenceDetect', () => {
  it('pairs silence_start with the following silence_end', () => {
    const stderr = [
      'ffmpeg version 6.0',
      '[silencedetect @ 0x55] silence_start: 1.250',
      '[silencedetect @ 0x55] silence_end: 1.900 | silence_duration: 0.650',
      '[silencedetect @ 0x55] silence_start: 12.043',
      '[silencedetect @ 0x55] silence_end: 12.301 | silence_duration: 0.258',
    ].join('\n');
    expect(parseSilenceDetect(stderr)).toEqual([
      { start: 1.25, end: 1.9 },
      { start: 12.043, end: 12.301 },
    ]);
  });

  it('drops an unterminated trailing silence_start', () => {
    const stderr = '[silencedetect @ 0x55] silence_start: 5.000';
    expect(parseSilenceDetect(stderr)).toEqual([]);
  });

  it('exposes documented default thresholds', () => {
    expect(SILENCE_NOISE_DB).toBe(-30);
    expect(SILENCE_MIN_DURATION).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: FAIL — `parseSilenceDetect` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/lib/llm/acoustic-analysis.ts`)

```ts
/** ffmpeg silencedetect defaults — tunable later. */
export const SILENCE_NOISE_DB = -30;
export const SILENCE_MIN_DURATION = 0.3;

export function parseSilenceDetect(stderr: string): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (endMatch && pendingStart !== null) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > pendingStart) {
        intervals.push({ start: pendingStart, end });
      }
      pendingStart = null;
    }
  }

  return intervals;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/acoustic-analysis.ts tests/lib/llm/acoustic-analysis.test.ts
git commit -m "feat(acoustic): parse ffmpeg silencedetect stderr into intervals"
```

---

## Task 3: Build the multimodal analysis prompt (transcript-keyed)

We send whole-clip audio once with transcript segments + timecodes embedded, asking for JSON
descriptors keyed to those timecodes. Speechless clips (no transcript) get a visual/cutaway prompt.

**Files:**
- Modify: `src/lib/llm/acoustic-analysis.ts`
- Test: `tests/lib/llm/acoustic-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { buildAcousticPrompt } from '@/lib/llm/acoustic-analysis';

describe('buildAcousticPrompt', () => {
  const transcript = [
    { start: 0, end: 3.2, text: 'I grew up in a small town.' },
    { start: 3.2, end: 7.0, text: 'It was hard to leave home.' },
  ];

  it('embeds transcript timecodes and asks for JSON keyed to them', () => {
    const prompt = buildAcousticPrompt({ assetName: 'Interview A', transcript });
    expect(prompt).toContain('Interview A');
    expect(prompt).toContain('0.00');
    expect(prompt).toContain('It was hard to leave home.');
    expect(prompt).toContain('"segments"');
    // descriptive text, not flat scores
    expect(prompt).toContain('delivery');
    expect(prompt).not.toContain('delivery_strength');
  });

  it('switches to a visual/cutaway prompt when there is no transcript', () => {
    const prompt = buildAcousticPrompt({ assetName: 'Bcam church', transcript: [] });
    expect(prompt).toContain('cutawayCandidate');
    expect(prompt).toContain('no spoken dialogue');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: FAIL — `buildAcousticPrompt` is not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
export interface PromptTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

function formatTc(seconds: number): string {
  return seconds.toFixed(2);
}

export function buildAcousticPrompt(params: {
  assetName: string;
  transcript: PromptTranscriptSegment[];
}): string {
  const { assetName, transcript } = params;

  if (transcript.length === 0) {
    return [
      `Analyze the media "${assetName}", which has no spoken dialogue (b-roll / cutaway footage).`,
      'Listen and watch, then return compact JSON ONLY with this shape:',
      '{"segments":[{"start":0.0,"end":8.0,"content":"...","shotType":"wide","cutawayCandidate":true,"confidence":0.7}]}',
      'Break the clip into a few meaningful time ranges. For each range, describe the visual content and ambient sound,',
      'name a likely shotType, and set cutawayCandidate true when the range would work as a cutaway over interview audio.',
      'Return only JSON, no prose.',
    ].join('\n');
  }

  const transcriptLines = transcript
    .map((seg) => `[${formatTc(seg.start)}-${formatTc(seg.end)}] ${seg.text}`)
    .join('\n');

  return [
    `You are an assistant film editor analyzing the AUDIO performance in "${assetName}".`,
    'Here is the transcript with timecodes (seconds):',
    transcriptLines,
    '',
    'Listen to the audio and, for each transcript segment (matched by its timecodes), describe HOW it was said.',
    'Return compact JSON ONLY with this shape:',
    '{"segments":[{"start":0.0,"end":3.2,"delivery":"voice steadies then cracks on \'home\'","emotion":"reflective","energy":"low-and-deliberate","pace":"slow","notable":["400ms pause before \'home\'","usable as hook"],"confidence":0.8}]}',
    'Use rich descriptive text, NOT numeric scores. Capture vocal delivery, emotion, energy, pace, hesitations,',
    'laughter, breaths, and reflective pauses. Keep each field short. Return only JSON, no prose.',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/acoustic-analysis.ts tests/lib/llm/acoustic-analysis.test.ts
git commit -m "feat(acoustic): build transcript-keyed multimodal analysis prompt"
```

---

## Task 4: Normalize model JSON into `AcousticSegment[]`

The model may wrap JSON in prose or fences, or include junk fields. Salvage valid segments,
drop the rest. Reuse the tolerant style of the existing vision normalizer.

**Files:**
- Modify: `src/lib/llm/acoustic-analysis.ts`
- Test: `tests/lib/llm/acoustic-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { normalizeAcousticSegments } from '@/lib/llm/acoustic-analysis';

describe('normalizeAcousticSegments', () => {
  it('parses fenced JSON and keeps valid segments', () => {
    const raw = 'Here you go:\n```json\n{"segments":[{"start":0,"end":3.2,"delivery":"steady","emotion":"calm","confidence":0.8},{"start":"bad","end":1}]}\n```';
    const out = normalizeAcousticSegments(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 0, end: 3.2, delivery: 'steady', emotion: 'calm', confidence: 0.8 });
  });

  it('keeps cutaway fields for speechless segments', () => {
    const raw = '{"segments":[{"start":0,"end":8,"content":"church exterior","shotType":"wide","cutawayCandidate":true}]}';
    const out = normalizeAcousticSegments(raw);
    expect(out[0]).toMatchObject({ content: 'church exterior', shotType: 'wide', cutawayCandidate: true });
  });

  it('returns [] when no JSON is present', () => {
    expect(normalizeAcousticSegments('sorry, I cannot help')).toEqual([]);
  });

  it('drops segments where end <= start', () => {
    const raw = '{"segments":[{"start":5,"end":5},{"start":2,"end":1}]}';
    expect(normalizeAcousticSegments(raw)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: FAIL — `normalizeAcousticSegments` is not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const tryParse = (s: string): string | null => {
    try { JSON.parse(s); return s; } catch { return null; }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  for (const m of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const inner = m[1]?.trim();
    if (inner && tryParse(inner)) return inner;
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    if (tryParse(slice)) return slice;
  }
  return null;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : undefined;
}

export function normalizeAcousticSegments(raw: string): AcousticSegment[] {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { return []; }
  const record = parsed as Record<string, unknown>;
  const list = Array.isArray(record.segments) ? record.segments : [];

  return list.flatMap((entry): AcousticSegment[] => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const start = num(r.start);
    const end = num(r.end);
    if (start === undefined || end === undefined || end <= start) return [];
    return [{
      start,
      end,
      delivery: str(r.delivery),
      emotion: str(r.emotion),
      energy: str(r.energy),
      pace: str(r.pace),
      notable: strArray(r.notable),
      content: str(r.content),
      shotType: str(r.shotType),
      cutawayCandidate: typeof r.cutawayCandidate === 'boolean' ? r.cutawayCandidate : undefined,
      confidence: num(r.confidence),
    }];
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/llm/acoustic-analysis.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/acoustic-analysis.ts tests/lib/llm/acoustic-analysis.test.ts
git commit -m "feat(acoustic): normalize model JSON into acoustic segments"
```

---

## Task 5: Enrich `InsightMoment` with acoustic data (types + extractor)

**Files:**
- Modify: `src/lib/llm/editorial-workflow.ts`
- Test: `tests/lib/llm/editorial-workflow-acoustic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { extractAcousticSegments } from '@/lib/llm/editorial-workflow';
import type { Asset } from '@/types/project';

function makeAsset(analysis: unknown): Asset {
  return {
    id: 'a1',
    name: 'Interview A',
    type: 'video',
    metadata: { analysis },
  } as unknown as Asset;
}

describe('extractAcousticSegments', () => {
  it('reads ready analysis segments from asset metadata', () => {
    const asset = makeAsset({
      status: 'ready',
      segments: [{ start: 0, end: 3.2, delivery: 'steady', emotion: 'calm' }],
      silenceMap: [{ start: 3.2, end: 3.6 }],
    });
    const segs = extractAcousticSegments(asset);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 0, end: 3.2, delivery: 'steady', emotion: 'calm' });
  });

  it('returns [] when analysis is missing or not ready', () => {
    expect(extractAcousticSegments(makeAsset(undefined))).toEqual([]);
    expect(extractAcousticSegments(makeAsset({ status: 'analyzing', segments: [] }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/llm/editorial-workflow-acoustic.test.ts`
Expected: FAIL — `extractAcousticSegments` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/llm/editorial-workflow.ts`, add the import near the top (after existing imports):

```ts
import type { AcousticSegment, SilenceInterval } from '@/lib/llm/acoustic-analysis';
```

Extend the `InsightMoment` interface (add the optional fields after `timelinePlacements`):

```ts
export interface InsightMoment {
  id: string;
  assetId: string;
  assetName: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  words: Array<{ word: string; start: number; end: number }>;
  timelinePlacements: TimelinePlacement[];
  delivery?: string;
  emotion?: string;
  energy?: string;
  pace?: string;
  notable?: string[];
  silenceBefore?: SilenceInterval;
  silenceAfter?: SilenceInterval;
}
```

Add the extractor (place it near `extractTranscriptSegments`):

```ts
export function extractAcousticSegments(asset: Asset): AcousticSegment[] {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const analysis = metadata.analysis as Record<string, unknown> | undefined;
  if (!analysis || analysis.status !== 'ready') return [];
  const segments = Array.isArray(analysis.segments) ? analysis.segments : [];
  return segments.flatMap((entry): AcousticSegment[] => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const start = Number(r.start);
    const end = Number(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{
      start,
      end,
      delivery: typeof r.delivery === 'string' ? r.delivery : undefined,
      emotion: typeof r.emotion === 'string' ? r.emotion : undefined,
      energy: typeof r.energy === 'string' ? r.energy : undefined,
      pace: typeof r.pace === 'string' ? r.pace : undefined,
      notable: Array.isArray(r.notable) ? r.notable.filter((v): v is string => typeof v === 'string') : undefined,
      content: typeof r.content === 'string' ? r.content : undefined,
      shotType: typeof r.shotType === 'string' ? r.shotType : undefined,
      cutawayCandidate: typeof r.cutawayCandidate === 'boolean' ? r.cutawayCandidate : undefined,
      confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : undefined,
    }];
  });
}

export function extractSilenceMap(asset: Asset): SilenceInterval[] {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const analysis = metadata.analysis as Record<string, unknown> | undefined;
  if (!analysis || analysis.status !== 'ready') return [];
  const map = Array.isArray(analysis.silenceMap) ? analysis.silenceMap : [];
  return map.flatMap((entry): SilenceInterval[] => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const start = Number(r.start);
    const end = Number(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ start, end }];
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/llm/editorial-workflow-acoustic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/editorial-workflow.ts tests/lib/llm/editorial-workflow-acoustic.test.ts
git commit -m "feat(acoustic): add InsightMoment acoustic fields and metadata extractors"
```

---

## Task 6: Join acoustic segments into moments in `buildProjectInsightIndex`

**Files:**
- Modify: `src/lib/llm/editorial-workflow.ts`
- Test: `tests/lib/llm/editorial-workflow-acoustic.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing acoustic test file)

```ts
import { buildProjectInsightIndex } from '@/lib/llm/editorial-workflow';

describe('buildProjectInsightIndex acoustic join', () => {
  it('joins acoustic segment onto the overlapping transcript moment', () => {
    const asset = {
      id: 'a1',
      name: 'Interview A',
      type: 'video',
      duration: 10,
      metadata: {
        transcription: {
          segments: [
            { text: 'I grew up in a small town.', start: 0, end: 3.2, words: [{ word: 'I', start: 0, end: 0.2 }] },
            { text: 'It was hard to leave home.', start: 3.2, end: 7.0, words: [{ word: 'It', start: 3.2, end: 3.4 }] },
          ],
        },
        analysis: {
          status: 'ready',
          segments: [
            { start: 3.2, end: 7.0, delivery: "cracks on 'home'", emotion: 'reflective', pace: 'slow', notable: ['400ms pause'] },
          ],
          silenceMap: [{ start: 7.0, end: 7.5 }],
        },
      },
    } as unknown as Asset;

    const index = buildProjectInsightIndex({
      projectId: 'p1',
      assets: [asset],
      timelines: [],
      activeTimelineId: '',
    });

    const moment = index.moments.find((m) => m.text === 'It was hard to leave home.');
    expect(moment).toBeDefined();
    expect(moment!.delivery).toBe("cracks on 'home'");
    expect(moment!.emotion).toBe('reflective');
    expect(moment!.notable).toEqual(['400ms pause']);
    expect(moment!.silenceAfter).toEqual({ start: 7.0, end: 7.5 });

    const firstMoment = index.moments.find((m) => m.text === 'I grew up in a small town.');
    expect(firstMoment!.delivery).toBeUndefined(); // no overlapping acoustic segment
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/llm/editorial-workflow-acoustic.test.ts`
Expected: FAIL — `delivery` is undefined (join not implemented).

- [ ] **Step 3: Write minimal implementation**

Add this helper near `findTimelinePlacements` in `editorial-workflow.ts`:

```ts
function bestOverlap(
  segmentStart: number,
  segmentEnd: number,
  acoustic: AcousticSegment[],
): AcousticSegment | undefined {
  let best: AcousticSegment | undefined;
  let bestOverlapAmount = 0;
  for (const a of acoustic) {
    const overlap = Math.min(segmentEnd, a.end) - Math.max(segmentStart, a.start);
    if (overlap > bestOverlapAmount) {
      bestOverlapAmount = overlap;
      best = a;
    }
  }
  return bestOverlapAmount > 0 ? best : undefined;
}

function nearestSilence(time: number, silenceMap: SilenceInterval[], side: 'before' | 'after'): SilenceInterval | undefined {
  const epsilon = 0.25;
  if (side === 'before') {
    return silenceMap.filter((s) => s.end <= time + epsilon).sort((x, y) => y.end - x.end)[0];
  }
  return silenceMap.filter((s) => s.start >= time - epsilon).sort((x, y) => x.start - y.start)[0];
}
```

Now, in `buildProjectInsightIndex`, the `moments` are built via
`assets.flatMap((asset) => extractTranscriptSegments(asset).map((segment, index) => ({ ... })))`.
Replace that mapping so it first reads acoustic data per asset and joins it:

```ts
  const moments: InsightMoment[] = assets.flatMap((asset) => {
    const acoustic = extractAcousticSegments(asset);
    const silenceMap = extractSilenceMap(asset);
    return extractTranscriptSegments(asset).map((segment, index) => {
      const match = bestOverlap(segment.start, segment.end, acoustic);
      return {
        id: `${asset.id}:${index}:${segment.start.toFixed(3)}`,
        assetId: asset.id,
        assetName: asset.name,
        text: segment.text,
        sourceStart: segment.start,
        sourceEnd: segment.end,
        words: segment.words,
        timelinePlacements: findTimelinePlacements(asset.id, segment.words[0]?.start ?? segment.start, timelines, activeTimelineId),
        delivery: match?.delivery,
        emotion: match?.emotion,
        energy: match?.energy,
        pace: match?.pace,
        notable: match?.notable,
        silenceBefore: nearestSilence(segment.start, silenceMap, 'before'),
        silenceAfter: nearestSilence(segment.end, silenceMap, 'after'),
      };
    });
  });
```

(Remove the old `moments` assignment this replaces.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/llm/editorial-workflow-acoustic.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full existing editorial/index tests to confirm no regression**

Run: `npx vitest run tests/lib/llm/`
Expected: PASS (all llm lib tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm/editorial-workflow.ts tests/lib/llm/editorial-workflow-acoustic.test.ts
git commit -m "feat(acoustic): join acoustic segments and silence into insight moments"
```

---

## Task 7: Include acoustic descriptors when serializing moments for chat context

`src/lib/llm/project-context.ts` formats moments into the text injected into the Copilot.
Surface the new fields so the model can answer performance questions.

**Files:**
- Modify: `src/lib/llm/project-context.ts`
- Test: none required if a pure formatter is touched minimally; if `project-context.ts` has an exported moment formatter, add a unit test. Otherwise verify via Task 11 manual check.

- [ ] **Step 1: Locate the moment serialization**

Run: `grep -n "sourceStart\|formatSeconds\|moment.text\|\.text\b" src/lib/llm/project-context.ts | head -20`
Identify where each moment becomes a context line.

- [ ] **Step 2: Add acoustic descriptors to the serialized line**

Where a moment line is currently built (e.g. `${formatSeconds(m.sourceStart)} ${m.text}`), append a performance suffix when present. Use this exact helper and inline it at the call site:

```ts
function acousticSuffix(m: { delivery?: string; emotion?: string; pace?: string; notable?: string[] }): string {
  const parts = [
    m.emotion ? `emotion: ${m.emotion}` : null,
    m.pace ? `pace: ${m.pace}` : null,
    m.delivery ? `delivery: ${m.delivery}` : null,
    m.notable && m.notable.length > 0 ? `notable: ${m.notable.join('; ')}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` — [${parts.join(' | ')}]` : '';
}
```

Append `acousticSuffix(m)` to the moment line string. If `project-context.ts` imports
`InsightMoment` / `RetrievedMoment`, the fields are already typed (Tasks 5–6); no new import needed beyond what exists.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/llm/project-context.ts
git commit -m "feat(acoustic): surface performance descriptors in chat project context"
```

---

## Task 8: Electron IPC handler — extract audio, silence map, fal multimodal call

Uses fal.ai `fal-ai/video-understanding` (multimodal, hears audio) — the established backend
analysis transport in `vision.ts` (`analyzeVideoWithPrompt`). The handler imports the pure
functions from Task 1–4. It does NOT write the DB; it returns the result.

**Files:**
- Create: `electron/ipc/acoustic-analysis.ts`

- [ ] **Step 1: Write the handler**

```ts
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';
import { analyzeVideoWithPrompt } from './vision.js';
import {
  ACOUSTIC_ANALYSIS_VERSION,
  buildAcousticPrompt,
  normalizeAcousticSegments,
  parseSilenceDetect,
  SILENCE_MIN_DURATION,
  SILENCE_NOISE_DB,
  type AcousticAnalysisResult,
  type PromptTranscriptSegment,
} from '../../src/lib/llm/acoustic-analysis.js';

export interface AcousticAnalyzeParams {
  apiKey: string;
  assetId: string;
  assetName: string;
  mediaPath: string;                 // local path to the asset media (video or audio)
  isVideo: boolean;
  durationSec?: number;
  transcript: PromptTranscriptSegment[];
  model?: string;
}

function runFfmpegSilenceDetect(mediaPath: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      '-i', mediaPath,
      '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION}`,
      '-f', 'null', '-',
    ];
    const proc = spawn(getFfmpegPath(), args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => resolve(''));
    proc.on('close', () => resolve(stderr));
  });
}

function extractAudioToTemp(mediaPath: string): Promise<string> {
  const outPath = path.join(os.tmpdir(), `cinegen-acoustic-${crypto.randomUUID()}.m4a`);
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', mediaPath, '-vn', '-acodec', 'aac', '-b:a', '128k', outPath];
    const proc = spawn(getFfmpegPath(), args);
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve(outPath) : reject(new Error(`ffmpeg audio extract failed (${code})`))));
  });
}

export async function analyzeAssetAcoustics(params: AcousticAnalyzeParams): Promise<AcousticAnalysisResult> {
  const model = params.model?.trim() || 'gemini-2.5-flash';
  const base: AcousticAnalysisResult = {
    assetId: params.assetId,
    status: 'failed',
    version: ACOUSTIC_ANALYSIS_VERSION,
    model,
    silenceMap: [],
    segments: [],
    hasSpeech: params.transcript.length > 0,
    sourceDurationSec: params.durationSec,
  };

  if (!params.apiKey) {
    return { ...base, error: 'No fal.ai API key provided.' };
  }

  let tempAudio: string | null = null;
  try {
    // 1. Objective silence map (local, free). Partial failure is tolerated.
    const stderr = await runFfmpegSilenceDetect(params.mediaPath).catch(() => '');
    const silenceMap = parseSilenceDetect(stderr);

    // 2. Subjective descriptors via fal multimodal video-understanding (hears audio).
    //    For audio-only assets, extract is unnecessary; video-understanding accepts the file path uploader.
    if (params.isVideo) {
      tempAudio = await extractAudioToTemp(params.mediaPath).catch(() => null);
    }
    const analysisInputPath = tempAudio ?? params.mediaPath;

    const prompt = buildAcousticPrompt({ assetName: params.assetName, transcript: params.transcript });
    const rawText = await analyzeVideoWithPrompt({
      apiKey: params.apiKey,
      videoPath: analysisInputPath,
      prompt,
      detailedAnalysis: true,
    });
    const segments = normalizeAcousticSegments(rawText);

    return {
      ...base,
      status: 'ready',
      updatedAt: new Date().toISOString(),
      silenceMap,
      segments,
      error: silenceMap.length === 0 ? 'Silence detection returned no intervals.' : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, error: message || 'Acoustic analysis failed.' };
  } finally {
    if (tempAudio) {
      await fs.unlink(tempAudio).catch(() => {});
    }
  }
}

export function registerAcousticHandlers(): void {
  ipcMain.handle('acoustic:analyze-asset', async (_event: unknown, params: AcousticAnalyzeParams) => {
    return analyzeAssetAcoustics(params);
  });
}
```

> **Note on `fal-ai/video-understanding` + audio-only files:** if the fal video uploader rejects a bare `.m4a`, fall back to passing the original `params.mediaPath` (video) so the model still hears the audio track. The `analysisInputPath = tempAudio ?? params.mediaPath` line already degrades to the original media; if needed during execution, prefer the original video path for the fal call and keep `tempAudio` only for future local DSP.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (If the build maps `@/` for renderer only, the relative `../../src/lib/llm/acoustic-analysis.js` import keeps the pure module usable from electron — confirm the import resolves; the electron build bundles via the existing config.)

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/acoustic-analysis.ts
git commit -m "feat(acoustic): add electron IPC handler for acoustic analysis"
```

---

## Task 9: Wire handler into main + preload + types

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron.d.ts`

- [ ] **Step 1: Register in main**

In `electron/main.ts`, add the import alongside the other `register*Handlers` imports:

```ts
import { registerAcousticHandlers } from './ipc/acoustic-analysis.js';
```

Find where the other handlers are invoked (e.g. `registerVisionHandlers();`) and add:

```ts
registerAcousticHandlers();
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.ts`, next to the `vision:` block, add:

```ts
  acoustic: {
    analyzeAsset: (params: unknown) => ipcRenderer.invoke('acoustic:analyze-asset', params),
  },
```

- [ ] **Step 3: Type it in `electron.d.ts`**

Add to the `electronAPI` interface (mirroring `vision`):

```ts
    acoustic: {
      analyzeAsset: (params: {
        apiKey: string;
        assetId: string;
        assetName: string;
        mediaPath: string;
        isVideo: boolean;
        durationSec?: number;
        transcript: Array<{ start: number; end: number; text: string }>;
        model?: string;
      }) => Promise<import('./src/lib/llm/acoustic-analysis').AcousticAnalysisResult>;
    };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts electron.d.ts
git commit -m "feat(acoustic): wire acoustic IPC into main, preload, and types"
```

---

## Task 10: Renderer — trigger analysis + persist into asset metadata (per-asset)

Mirror the existing visual-summary block in `workspace-shell.tsx` (the `vision.indexAsset`
call that sets `llmVisualSummary` / `llmVisualSummaryStatus`).

**Files:**
- Modify: `src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1: Find the visual-summary trigger pattern**

Run: `grep -n "vision.indexAsset\|llmVisualSummaryStatus\|backgroundVisionModel" src/components/workspace/workspace-shell.tsx`
This shows the function that sets status `analyzing`, calls IPC, then writes the result into the asset's metadata.

- [ ] **Step 2: Add an analogous acoustic trigger**

Add a function (near the visual one) that, given an asset:

1. Builds the transcript from `asset.metadata.transcription.segments` → `{ start, end, text }[]`.
2. Optimistically sets `asset.metadata.analysis = { status: 'analyzing', version: 1, silenceMap: [], segments: [] }`.
3. Calls `window.electronAPI.acoustic.analyzeAsset({ apiKey, assetId, assetName, mediaPath: asset.fileRef, isVideo: asset.type === 'video', durationSec: asset.duration, transcript, model })`.
4. On resolve, writes the returned result into `asset.metadata.analysis`.
5. On reject, sets `asset.metadata.analysis = { status: 'failed', version: 1, silenceMap: [], segments: [], error: String(err) }`.

Use the SAME asset-update mechanism the visual block uses (do not invent a new one — copy the surrounding `setAssets`/update call). `apiKey` and `model` come from the same source the vision trigger already reads (`backgroundVisionModel` and the settings api key).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (deferred to Task 11)** — no unit test; UI wiring is verified in the integration check.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/workspace-shell.tsx
git commit -m "feat(acoustic): per-asset acoustic analysis trigger and persistence"
```

---

## Task 11: LLM tab — "Analyze entire project" batch button

**Files:**
- Modify: `src/components/llm/llm-tab.tsx`

- [ ] **Step 1: Find where asset-wide actions / project context live**

Run: `grep -n "Analyze\|indexAsset\|assets\b\|projectContext\|llmVisualSummary" src/components/llm/llm-tab.tsx | head -30`
Identify the assets array in scope and an existing toolbar/header area for a button.

- [ ] **Step 2: Add the batch button + handler**

Add a button labeled **"Analyze entire project"**. Its handler:

1. Filters assets needing analysis: `asset.type === 'video' || asset.type === 'audio'`, and
   `(asset.metadata?.analysis?.status ?? 'missing') !== 'ready'`.
2. Tracks progress in component state: `{ total, done }`.
3. Iterates **sequentially** (to bound API spend/concurrency), calling the same per-asset acoustic
   trigger added in Task 10 (lift it to a shared callback prop or context if it currently lives in
   `workspace-shell.tsx`; if not shared, reuse `window.electronAPI.acoustic.analyzeAsset` directly
   with the same persistence write used elsewhere).
4. Shows `Analyzing {done}/{total}…` while running; resets when complete.

Because status is persisted in asset metadata, a reload mid-batch leaves completed assets `ready`
and the rest `missing`, so re-running the button resumes naturally.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/llm/llm-tab.tsx
git commit -m "feat(acoustic): add Analyze entire project batch action to LLM tab"
```

---

## Task 12: Full test + typecheck + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: PASS, including the new `acoustic-analysis.test.ts` and `editorial-workflow-acoustic.test.ts`.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual end-to-end (real footage)**

1. `npm run dev`, open a project containing a transcribed interview clip.
2. Click **Analyze entire project** in the LLM tab; watch progress reach `done == total`.
3. Inspect the asset — `metadata.analysis.status === 'ready'`, `segments[]` populated with
   `delivery`/`emotion`, `silenceMap[]` non-empty.
4. In Copilot chat ask: *"Where in the interview does she get most emotional, and what's the strongest opening line?"*
   Confirm the answer cites real timecodes and references delivery/emotion (proving the join reached chat context).
5. Run on a speechless b-roll clip; confirm `segments[]` carry `content`/`shotType`/`cutawayCandidate`.

- [ ] **Step 4: Update the changelog**

Add a bullet under the LLM tab section of `UPCOMING_RELEASE.md`:
`- **Acoustic-emotional clip analysis (in progress):** Copilot can now analyze the audio performance of each clip (vocal delivery, emotion, pacing) and detect silence boundaries; "Analyze entire project" batch-runs ingest across the media pool.`

- [ ] **Step 5: Commit**

```bash
git add UPCOMING_RELEASE.md
git commit -m "docs: note acoustic-emotional clip analysis in upcoming release"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** silence map (Task 2, 8), Gemini multimodal whole-clip descriptors (Task 3, 8),
  hyper-descriptive-not-scores (Task 3 prompt + Task 4 fields), `asset.metadata.analysis` storage
  (Task 10), index join (Task 6), chat exposure (Task 7), per-asset + batch UI hybrid-C (Task 10, 11),
  speechless b-roll cutaway descriptors (Task 3, 4, 5), status lifecycle survives reload (Task 10, 11),
  pure-function unit tests (Tasks 1–6). Retrieval intentionally untouched (Phase 2).
- **Transport note:** Spec said "Gemini multimodal"; implementation routes through fal.ai
  `fal-ai/video-understanding` (the existing backend transport that hears audio and returns text),
  with `google/gemini-2.5-flash`-class models. This honors the spec intent (multimodal model hears
  the clip) while matching the established `vision.ts` pattern and returning parseable JSON instead of
  fighting the Gemini CLI's streaming/session model. If you prefer the literal Gemini CLI path, swap
  the `analyzeVideoWithPrompt` call in Task 8 for the `copilot-visual-media` inline-`@path` attach flow —
  the pure functions and everything else are unchanged.
- **Type consistency:** `AcousticAnalysisResult`, `AcousticSegment`, `SilenceInterval`,
  `AnalysisStatus`, `PromptTranscriptSegment` defined in Task 1/3 and reused verbatim in Tasks 5, 8, 9.
  `extractAcousticSegments` / `extractSilenceMap` defined Task 5, used Task 6.
