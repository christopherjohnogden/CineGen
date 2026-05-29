import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { getFfmpegPath } from '../lib/ffmpeg-paths.js';
import { analyzeVideoWithPrompt } from './vision.js';
import { analyzeMediaWithGeminiCli, GeminiMediaUnavailableError } from './copilot-visual-media.js';
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
  apiKey?: string;
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

const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash';
const FAL_MODEL_LABEL = 'fal-ai/video-understanding';

/**
 * Run the multimodal descriptor pass. Prefers the local Gemini CLI (no API key, hears audio).
 * Falls back to fal.ai `video-understanding` only when Gemini CLI is unavailable or declines the
 * media, and only if a fal API key is present. Returns the raw model text plus the model label
 * that actually produced it.
 */
async function runDescriptorPass(params: AcousticAnalyzeParams, prompt: string): Promise<{ rawText: string; model: string }> {
  const geminiModel = params.model?.trim() || GEMINI_MODEL_DEFAULT;
  try {
    const rawText = await analyzeMediaWithGeminiCli({
      mediaPath: params.mediaPath,
      prompt,
      model: geminiModel,
    });
    return { rawText, model: geminiModel };
  } catch (error) {
    const geminiUnavailable = error instanceof GeminiMediaUnavailableError;
    if (!geminiUnavailable) throw error;
    if (!params.apiKey) {
      throw new Error('Gemini CLI could not analyze this clip and no fal.ai API key is set for fallback.');
    }
    const rawText = await analyzeVideoWithPrompt({
      apiKey: params.apiKey,
      videoPath: params.mediaPath,
      prompt,
      detailedAnalysis: true,
    });
    return { rawText, model: FAL_MODEL_LABEL };
  }
}

export async function analyzeAssetAcoustics(params: AcousticAnalyzeParams): Promise<AcousticAnalysisResult> {
  const base: AcousticAnalysisResult = {
    assetId: params.assetId,
    status: 'failed',
    version: ACOUSTIC_ANALYSIS_VERSION,
    model: params.model?.trim() || GEMINI_MODEL_DEFAULT,
    silenceMap: [],
    segments: [],
    hasSpeech: params.transcript.length > 0,
    sourceDurationSec: params.durationSec,
  };

  try {
    const stderr = await runFfmpegSilenceDetect(params.mediaPath).catch(() => '');
    const silenceMap = parseSilenceDetect(stderr);

    const prompt = buildAcousticPrompt({ assetName: params.assetName, transcript: params.transcript });
    const { rawText, model } = await runDescriptorPass(params, prompt);
    const segments = normalizeAcousticSegments(rawText);

    return {
      ...base,
      model,
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
