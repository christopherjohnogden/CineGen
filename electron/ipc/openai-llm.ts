import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { completeOpenAiChat } from '@/lib/llm/openai-chat';
import { decodeLocalMediaUrl } from '@/lib/media/asset-local-storage';

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
    return completeOpenAiChat({
      apiKey,
      model: typeof record.model === 'string' ? record.model : undefined,
      systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : undefined,
      userMessage,
      imageUrls: imageUrlsFrom(record.imageUrls),
      maxCompletionTokens: typeof record.maxCompletionTokens === 'number'
        ? record.maxCompletionTokens
        : undefined,
    });
  });
}
