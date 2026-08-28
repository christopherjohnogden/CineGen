import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { completeOpenAiChat } from '@/lib/llm/openai-chat';
import { decodeLocalMediaUrl } from '@/lib/media/asset-local-storage';
import { invokeSharedOpenAi, TEAM_PROVIDER_SENTINEL } from './team-providers.js';

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/** Chat Completions only accepts https or data: URLs — turn local stills into data URLs. */
export function resolveOpenAiImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const local = decodeLocalMediaUrl(trimmed)
    ?? (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed) ? trimmed : null);
  if (!local || !fs.existsSync(local)) return null;
  const buf = fs.readFileSync(local);
  return `data:${mimeFromPath(local)};base64,${buf.toString('base64')}`;
}

function imageUrlsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const resolved = resolveOpenAiImageUrl(entry);
    return resolved ? [resolved] : [];
  });
}

export function registerOpenAiLlmHandlers(): void {
  ipcMain.handle('llm:openai-chat', async (_event, params: unknown) => {
    const record = params && typeof params === 'object' && !Array.isArray(params)
      ? params as Record<string, unknown>
      : {};
    const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
    const userMessage = typeof record.userMessage === 'string' ? record.userMessage : '';
    const imageUrls = imageUrlsFrom(record.imageUrls);
    if (apiKey === TEAM_PROVIDER_SENTINEL) {
      return invokeSharedOpenAi({
        ...record,
        apiKey: TEAM_PROVIDER_SENTINEL,
        userMessage,
        imageUrls,
      });
    }
    return completeOpenAiChat({
      apiKey,
      model: typeof record.model === 'string' ? record.model : undefined,
      systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : undefined,
      userMessage,
      imageUrls,
      maxCompletionTokens: typeof record.maxCompletionTokens === 'number'
        ? record.maxCompletionTokens
        : undefined,
      jsonObject: record.jsonObject === false ? false : undefined,
    });
  });

  ipcMain.handle('llm:openai-realtime-session', async (_event, params: unknown) => {
    const record = params && typeof params === 'object' && !Array.isArray(params)
      ? params as Record<string, unknown>
      : {};
    const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : '';
    const sdp = typeof record.sdp === 'string' ? record.sdp : '';
    const voices = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar']);
    const voice = typeof record.voice === 'string' && voices.has(record.voice) ? record.voice : 'cedar';
    if (!apiKey) throw new Error('Add an OpenAI API key in Settings to use Voice Director.');
    if (!sdp || sdp.length > 1_000_000) throw new Error('Voice Director received an invalid audio session offer.');

    const session = JSON.stringify({
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'auto',
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice },
      },
    });
    const body = new FormData();
    body.set('sdp', sdp);
    body.set('session', session);

    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Safety-Identifier': 'cinegen-desktop-user',
      },
      body,
    });
    const answer = await response.text();
    if (!response.ok) {
      let message = `OpenAI Realtime failed (${response.status}).`;
      try {
        const parsed = JSON.parse(answer) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {}
      throw new Error(message);
    }
    return { sdp: answer };
  });
}
