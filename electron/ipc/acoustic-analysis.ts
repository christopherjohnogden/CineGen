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
    const stderr = await runFfmpegSilenceDetect(params.mediaPath).catch(() => '');
    const silenceMap = parseSilenceDetect(stderr);

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
