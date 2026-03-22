import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';

const SYSTEM_PROMPT = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;

interface MusicPromptParams {
  apiKey?: string;
  frameUrls?: string[];
  style?: string;
  genre?: string;
  mood?: string;
  tempo?: string;
  additionalNotes?: string;
}

function buildUserPrompt(params: MusicPromptParams, hasVideo: boolean): string {
  const parts: string[] = [];

  if (hasVideo) {
    parts.push('I have a video that needs a music soundtrack. I\'ve attached frames from the video for you to analyze.');
    parts.push('Look at the visual content, mood, pacing, and subject matter to inform the music style.');
  }

  const prefs: string[] = [];
  if (params.genre) prefs.push(`Genre: ${params.genre}`);
  if (params.style) prefs.push(`Style: ${params.style}`);
  if (params.mood) prefs.push(`Mood: ${params.mood}`);
  if (params.tempo) prefs.push(`Tempo: ${params.tempo}`);
  if (params.additionalNotes) prefs.push(`Notes: ${params.additionalNotes}`);

  if (prefs.length > 0) {
    parts.push('User preferences:\n' + prefs.join('\n'));
  }

  parts.push('Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else.');

  return parts.join('\n\n');
}

export function registerMusicPromptHandlers(): void {
  ipcMain.handle('music:generate-prompt', async (_event, params: MusicPromptParams) => {
    const key = params.apiKey;
    if (!key) throw new Error('No fal.ai API key provided.');

    fal.config({ credentials: key });

    const hasFrames = params.frameUrls && params.frameUrls.length > 0;
    const userPrompt = buildUserPrompt(params, !!hasFrames);

    const input: Record<string, unknown> = {
      model: 'google/gemini-flash-1.5',
      system_prompt: SYSTEM_PROMPT,
      prompt: userPrompt,
      max_tokens: 300,
    };

    const endpoint = hasFrames ? 'fal-ai/any-llm/vision' : 'fal-ai/any-llm';

    if (hasFrames) {
      input.image_urls = params.frameUrls;
    }

    const result = await fal.subscribe(endpoint, { input, logs: true });
    const data = result.data as Record<string, unknown>;
    const output = (data.output as string) ?? '';

    return { prompt: output.trim() };
  });
}
