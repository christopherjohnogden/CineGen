import { app, ipcMain } from 'electron';
import path from 'node:path';
import {
  cleanupEphemeralVisualRefs,
  prepareCopilotVisualRefs,
} from './copilot-visual-media.js';
import type { CopilotVisualRefInput } from './cli-llm-shared.js';
import { analyzeImageWithPrompt, analyzeVideoWithPrompt } from './vision.js';

export interface CopilotVisualAnalysisResult {
  label: string;
  mediaType: 'image' | 'video';
  analysis: string;
}

function buildAnalysisPrompt(userPrompt: string, label: string, mediaType: 'image' | 'video'): string {
  const mediaLabel = mediaType === 'video' ? 'video clip' : 'image';
  return [
    userPrompt.trim() || `Describe this ${mediaLabel} in detail.`,
    `Attached ${mediaLabel}: "${label}".`,
    'Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.',
    'Do not answer from clip names, storyboard labels, or generic production terminology alone.',
  ].join('\n');
}

export async function analyzeCopilotVisualRefs(params: {
  apiKey: string;
  prompt: string;
  visualRefs: CopilotVisualRefInput[];
  workspaceDir?: string;
}): Promise<CopilotVisualAnalysisResult[]> {
  const workspaceDir = params.workspaceDir ?? path.join(app.getPath('userData'), 'gemini-cli-workspace');
  const prepared = await prepareCopilotVisualRefs(params.visualRefs, workspaceDir);
  if (prepared.length === 0) {
    throw new Error('Could not load the attached clip or asset files for visual analysis.');
  }

  try {
    const results: CopilotVisualAnalysisResult[] = [];
    for (const ref of prepared) {
      const analysisPrompt = buildAnalysisPrompt(params.prompt, ref.label, ref.mediaType);
      const analysis = ref.mediaType === 'video'
        ? await analyzeVideoWithPrompt({
          apiKey: params.apiKey,
          videoPath: ref.mediaPath,
          prompt: analysisPrompt,
          detailedAnalysis: true,
        })
        : await analyzeImageWithPrompt({
          apiKey: params.apiKey,
          imagePath: ref.mediaPath,
          prompt: analysisPrompt,
        });
      results.push({
        label: ref.label,
        mediaType: ref.mediaType,
        analysis,
      });
    }
    return results;
  } finally {
    cleanupEphemeralVisualRefs(prepared);
  }
}

export function registerCopilotVideoAnalysisHandlers(): void {
  ipcMain.handle('copilot:analyze-visual-refs', async (_event, params: {
    apiKey: string;
    prompt: string;
    visualRefs: CopilotVisualRefInput[];
  }) => analyzeCopilotVisualRefs(params));
}
