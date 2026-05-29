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
  // Balanced scan: find the first complete {...} or [...] block.
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const startIdx = trimmed.indexOf(open);
    if (startIdx === -1) continue;
    let depth = 0;
    for (let i = startIdx; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const slice = trimmed.slice(startIdx, i + 1);
          const parsedSlice = tryParse(slice);
          if (parsedSlice) return parsedSlice;
          break;
        }
      }
    }
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
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).segments)
      ? ((parsed as Record<string, unknown>).segments as unknown[])
      : [];

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
