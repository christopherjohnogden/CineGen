import {
  ServiceError,
  createFalMediaStager,
  createFalSubscriber,
  isPlainRecord,
  requireRecord,
  requireSecret,
} from './_shared.mjs';

const SYSTEM_PROMPT = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;

const MUSIC_TEXT_MODEL = 'google/gemini-flash-1.5';
const TEXT_ENDPOINT = 'fal-ai/any-llm';
const VISION_ENDPOINT = 'fal-ai/any-llm/vision';

export const musicCapabilities = Object.freeze({
  hostedPromptGeneration: true,
  visualFrameContext: true,
});

function optionalText(value, label, maxLength = 4_000) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ServiceError(`${label} must be text.`, { code: 'INVALID_INPUT' });
  }
  if (value.length > maxLength) {
    throw new ServiceError(`${label} is too long.`, { code: 'INVALID_INPUT' });
  }
  return value.trim() || undefined;
}

function validateParams(value) {
  const params = requireRecord(value, 'Music prompt parameters');
  const apiKey = requireSecret(params.apiKey, 'fal.ai API key');
  let frameUrls = [];
  if (params.frameUrls !== undefined && params.frameUrls !== null) {
    if (!Array.isArray(params.frameUrls) || params.frameUrls.length > 12) {
      throw new ServiceError('Music prompt frame URLs must be an array with at most 12 entries.', {
        code: 'INVALID_INPUT',
      });
    }
    frameUrls = params.frameUrls.map((entry, index) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new ServiceError(`Music prompt frame ${index + 1} must be a URL.`, {
          code: 'INVALID_INPUT',
        });
      }
      return entry.trim();
    });
  }
  return {
    apiKey,
    frameUrls,
    style: optionalText(params.style, 'Music style'),
    genre: optionalText(params.genre, 'Music genre'),
    mood: optionalText(params.mood, 'Music mood'),
    tempo: optionalText(params.tempo, 'Music tempo'),
    additionalNotes: optionalText(params.additionalNotes, 'Music notes', 12_000),
  };
}

function buildUserPrompt(params, hasFrames) {
  const parts = [];
  if (hasFrames) {
    parts.push("I have a video that needs a music soundtrack. I've attached frames from the video for you to analyze.");
    parts.push('Look at the visual content, mood, pacing, and subject matter to inform the music style.');
  }

  const preferences = [];
  if (params.genre) preferences.push(`Genre: ${params.genre}`);
  if (params.style) preferences.push(`Style: ${params.style}`);
  if (params.mood) preferences.push(`Mood: ${params.mood}`);
  if (params.tempo) preferences.push(`Tempo: ${params.tempo}`);
  if (params.additionalNotes) preferences.push(`Notes: ${params.additionalNotes}`);
  if (preferences.length > 0) parts.push(`User preferences:\n${preferences.join('\n')}`);
  parts.push('Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else.');
  return parts.join('\n\n');
}

function unwrapFalData(result) {
  return isPlainRecord(result) && isPlainRecord(result.data) ? result.data : result;
}

export function createMusicHandlers(options = {}) {
  const falSubscribe = options.falSubscribe ?? createFalSubscriber(options);
  const stageMedia = options.stageMedia ?? createFalMediaStager(options);

  return {
    generatePrompt: async (paramsValue) => {
      const params = validateParams(paramsValue);
      const frameUrls = await Promise.all(params.frameUrls.map((url, index) => (
        stageMedia(url, params.apiKey, `Music prompt frame ${index + 1}`)
      )));
      const input = {
        model: MUSIC_TEXT_MODEL,
        system_prompt: SYSTEM_PROMPT,
        prompt: buildUserPrompt(params, frameUrls.length > 0),
        max_tokens: 300,
        ...(frameUrls.length > 0 ? { image_urls: frameUrls } : {}),
      };
      const result = await falSubscribe(
        frameUrls.length > 0 ? VISION_ENDPOINT : TEXT_ENDPOINT,
        input,
        params.apiKey,
      );
      const data = unwrapFalData(result);
      const output = isPlainRecord(data)
        ? (typeof data.output === 'string' ? data.output : typeof data.text === 'string' ? data.text : '')
        : '';
      const prompt = output.trim();
      if (!prompt) {
        throw new ServiceError('The hosted music prompt model returned an empty response.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      return { prompt };
    },
  };
}

export const musicHandlers = createMusicHandlers();
