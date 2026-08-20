/** OpenAI Chat Completions helper for Director JSON jobs (GPT-5.6 Luna). */

import { parseOpenAiUsage, priceOpenAiUsage, type OpenAiPricedUsage } from './openai-usage';

export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_OPENAI_DIRECTOR_MODEL = 'gpt-5.6-luna';
export const DEFAULT_OPENAI_MAX_COMPLETION_TOKENS = 60_000;

export type OpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface OpenAiChatParams {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  userMessage: string;
  /** HTTPS or data: image URLs already resolved for Chat Completions. */
  imageUrls?: string[];
  maxCompletionTokens?: number;
  reasoningEffort?: OpenAiReasoningEffort;
  jsonObject?: boolean;
  fetchImpl?: typeof fetch;
}

export function buildOpenAiUserContent(
  userMessage: string,
  imageUrls: string[] = [],
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }> {
  const text = userMessage.trim();
  const images = imageUrls.map((url) => url.trim()).filter(Boolean);
  if (images.length === 0) return text;
  return [
    { type: 'text', text },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
  ];
}

export function buildOpenAiChatBody(params: {
  model?: string;
  systemPrompt?: string;
  userMessage: string;
  imageUrls?: string[];
  maxCompletionTokens?: number;
  reasoningEffort?: OpenAiReasoningEffort;
  /** Director JSON jobs keep this on. Assistant chat turns it off. */
  jsonObject?: boolean;
}): Record<string, unknown> {
  const messages: Array<{ role: 'system' | 'user'; content: ReturnType<typeof buildOpenAiUserContent> }> = [];
  const system = params.systemPrompt?.trim() ?? '';
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: buildOpenAiUserContent(params.userMessage, params.imageUrls) });
  const body: Record<string, unknown> = {
    model: params.model?.trim() || DEFAULT_OPENAI_DIRECTOR_MODEL,
    messages,
    reasoning_effort: params.reasoningEffort ?? 'low',
    max_completion_tokens: Number.isFinite(params.maxCompletionTokens)
      ? Math.max(1, Math.floor(params.maxCompletionTokens as number))
      : DEFAULT_OPENAI_MAX_COMPLETION_TOKENS,
  };
  if (params.jsonObject !== false) body.response_format = { type: 'json_object' };
  return body;
}

export function openaiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 2_000);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 2_000);
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 2_000);
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim().slice(0, 2_000);
  }
  return fallback;
}

export function parseOpenAiChatPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('OpenAI returned an invalid response.');
  }
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = choices[0] && typeof choices[0] === 'object' && !Array.isArray(choices[0])
    ? choices[0] as Record<string, unknown>
    : null;
  const message = choice?.message && typeof choice.message === 'object' && !Array.isArray(choice.message)
    ? choice.message as Record<string, unknown>
    : null;
  const refusal = typeof message?.refusal === 'string' ? message.refusal.trim() : '';
  if (refusal) throw new Error(refusal);
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  if (!content) throw new Error('OpenAI returned no text output.');
  if (choice?.finish_reason === 'length') {
    throw new Error('The model hit its output limit mid-answer. Try shotlisting one scene at a time.');
  }
  return content;
}

export async function completeOpenAiChat(params: OpenAiChatParams): Promise<{
  message: string;
  usage?: OpenAiPricedUsage;
}> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) throw new Error('No OpenAI API key provided.');
  const userMessage = params.userMessage.trim();
  if (!userMessage) throw new Error('No OpenAI prompt provided.');
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('This runtime does not provide fetch.');

  const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAiChatBody({
      model: params.model,
      systemPrompt: params.systemPrompt,
      userMessage,
      imageUrls: params.imageUrls,
      maxCompletionTokens: params.maxCompletionTokens,
      reasoningEffort: params.reasoningEffort,
      jsonObject: params.jsonObject,
    })),
  });

  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try { payload = JSON.parse(text); } catch { /* keep raw text */ }
  }
  if (!response.ok) {
    throw new Error(openaiErrorMessage(payload, `OpenAI request failed (${response.status}).`));
  }
  const tokens = parseOpenAiUsage(payload);
  return {
    message: parseOpenAiChatPayload(payload),
    ...(tokens ? { usage: priceOpenAiUsage(tokens) } : {}),
  };
}
