import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPENAI_DIRECTOR_MODEL,
  DEFAULT_OPENAI_MAX_COMPLETION_TOKENS,
  OPENAI_CHAT_COMPLETIONS_URL,
  buildOpenAiChatBody,
  buildOpenAiUserContent,
  completeOpenAiChat,
  openaiErrorMessage,
  parseOpenAiChatPayload,
} from '@/lib/llm/openai-chat';

describe('OpenAI chat completions helper', () => {
  it('builds a cheap JSON job for GPT-5.6 Luna', () => {
    expect(buildOpenAiChatBody({
      systemPrompt: 'Return JSON.',
      userMessage: '{"scene":1}',
    })).toEqual({
      model: DEFAULT_OPENAI_DIRECTOR_MODEL,
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: '{"scene":1}' },
      ],
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
      max_completion_tokens: DEFAULT_OPENAI_MAX_COMPLETION_TOKENS,
    });
  });

  it('omits json_object when jsonObject is false', () => {
    expect(buildOpenAiChatBody({
      userMessage: 'hello',
      jsonObject: false,
    })).not.toHaveProperty('response_format');
  });

  it('attaches stills as low-detail image_url parts', () => {
    expect(buildOpenAiUserContent('Look at these.', [
      'https://example.test/a.jpg',
      '  ',
    ])).toEqual([
      { type: 'text', text: 'Look at these.' },
      { type: 'image_url', image_url: { url: 'https://example.test/a.jpg', detail: 'low' } },
    ]);
    const body = buildOpenAiChatBody({
      userMessage: 'Look at these.',
      imageUrls: ['https://example.test/a.jpg'],
    });
    expect(body.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'Look at these.' },
        { type: 'image_url', image_url: { url: 'https://example.test/a.jpg', detail: 'low' } },
      ],
    }]);
  });

  it('extracts assistant text and nested API errors', () => {
    expect(parseOpenAiChatPayload({
      choices: [{ message: { content: '  {"ok":true}  ' }, finish_reason: 'stop' }],
    })).toBe('{"ok":true}');
    expect(() => parseOpenAiChatPayload({
      choices: [{ message: { content: '', refusal: 'I cannot do that.' } }],
    })).toThrow(/cannot do that/i);
    expect(openaiErrorMessage(
      { error: { message: 'Insufficient quota', type: 'insufficient_quota' } },
      'fallback',
    )).toBe('Insufficient quota');
  });

  it('posts Bearer auth to chat completions and returns the message', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(OPENAI_CHAT_COMPLETIONS_URL);
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-5.6-luna');
      expect(body.reasoning_effort).toBe('low');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 20 },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await expect(completeOpenAiChat({
      apiKey: 'sk-test',
      systemPrompt: 'sys',
      userMessage: 'user',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toEqual({
      message: '{"ok":true}',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 20,
        cacheWriteTokens: 0,
        cost: 0.0000764,
      },
    });
  });

  it('surfaces OpenAI HTTP errors without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Incorrect API key provided' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }));

    await expect(completeOpenAiChat({
      apiKey: 'sk-secret-value',
      userMessage: 'hello',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/Incorrect API key provided/);
  });
});
