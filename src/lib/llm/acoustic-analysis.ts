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
