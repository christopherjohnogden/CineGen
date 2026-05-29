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
