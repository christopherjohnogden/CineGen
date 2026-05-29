import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
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
} from '@/lib/llm/acoustic-analysis';

export interface AcousticAnalyzeParams {
  apiKey: string;
  assetId: string;
  assetName: string;
  mediaPath: string;
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

  try {
    const stderr = await runFfmpegSilenceDetect(params.mediaPath).catch(() => '');
    const silenceMap = parseSilenceDetect(stderr);

    const prompt = buildAcousticPrompt({ assetName: params.assetName, transcript: params.transcript });
    const rawText = await analyzeVideoWithPrompt({
      apiKey: params.apiKey,
      videoPath: params.mediaPath,
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
  }
}

export function registerAcousticHandlers(): void {
  ipcMain.handle('acoustic:analyze-asset', async (_event: unknown, params: AcousticAnalyzeParams) => {
    return analyzeAssetAcoustics(params);
  });
}
