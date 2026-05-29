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
