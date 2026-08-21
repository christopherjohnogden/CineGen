import {
  CapabilityUnavailableError,
  ServiceError,
  createFalSubscriber,
  fetchJson,
  isPlainRecord,
  requireRecord,
  requireSecret,
  requireString,
  validateModelId,
} from './_shared.mjs';

const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-4.6';
const OPENROUTER_ENDPOINT = 'openrouter/router';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime/calls';
const OPENAI_DIRECTOR_MODEL = 'gpt-5.6-luna';
const OPENAI_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);
const REALTIME_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

function parseFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUsage(value) {
  if (!isPlainRecord(value)) return undefined;
  const promptTokens = parseFiniteNumber(value.prompt_tokens ?? value.promptTokens) ?? 0;
  const completionTokens = parseFiniteNumber(value.completion_tokens ?? value.completionTokens) ?? 0;
  const totalTokens = parseFiniteNumber(value.total_tokens ?? value.totalTokens)
    ?? (promptTokens + completionTokens);
  const cost = parseFiniteNumber(value.cost) ?? 0;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 && cost <= 0) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens, cost };
}

function validateChatParams(value) {
  const params = requireRecord(value, 'LLM chat parameters');
  const apiKey = requireSecret(params.apiKey, 'fal.ai API key');
  const model = params.model === undefined || params.model === null || params.model === ''
    ? DEFAULT_TEXT_MODEL
    : validateModelId(params.model, 'LLM model');

  if (!Array.isArray(params.messages) || params.messages.length === 0) {
    throw new ServiceError('No chat messages provided.', { code: 'INVALID_INPUT' });
  }
  if (params.messages.length > 200) {
    throw new ServiceError('Too many chat messages were provided.', { code: 'INVALID_INPUT' });
  }

  let totalCharacters = 0;
  const messages = params.messages.map((entry, index) => {
    const message = requireRecord(entry, `Chat message ${index + 1}`);
    if (!MESSAGE_ROLES.has(message.role)) {
      throw new ServiceError(`Chat message ${index + 1} has an invalid role.`, {
        code: 'INVALID_INPUT',
      });
    }
    if (typeof message.content !== 'string') {
      throw new ServiceError(`Chat message ${index + 1} must contain text.`, {
        code: 'INVALID_INPUT',
      });
    }
    const content = message.content.trim();
    if (content.length > 250_000) {
      throw new ServiceError(`Chat message ${index + 1} is too long.`, {
        code: 'INVALID_INPUT',
      });
    }
    totalCharacters += content.length;
    return { role: message.role, content };
  });
  if (totalCharacters > 1_000_000) {
    throw new ServiceError('The chat conversation is too large.', {
      code: 'INVALID_INPUT',
      statusCode: 413,
    });
  }
  if (!messages.some((message) => message.role !== 'system' && message.content)) {
    throw new ServiceError('No chat prompt provided.', { code: 'INVALID_INPUT' });
  }

  let systemPrompt;
  if (params.systemPrompt !== undefined && params.systemPrompt !== null) {
    if (typeof params.systemPrompt !== 'string' || params.systemPrompt.length > 250_000) {
      throw new ServiceError('System prompt must be text no longer than 250,000 characters.', {
        code: 'INVALID_INPUT',
      });
    }
    systemPrompt = params.systemPrompt.trim() || undefined;
  }

  let maxTokens = 1_600;
  if (params.maxTokens !== undefined && params.maxTokens !== null) {
    if (typeof params.maxTokens !== 'number' || !Number.isFinite(params.maxTokens)) {
      throw new ServiceError('Maximum tokens must be a finite number.', { code: 'INVALID_INPUT' });
    }
    maxTokens = Math.floor(params.maxTokens);
    if (maxTokens < 1 || maxTokens > 128_000) {
      throw new ServiceError('Maximum tokens must be between 1 and 128,000.', {
        code: 'INVALID_INPUT',
      });
    }
  }

  let temperature;
  if (params.temperature !== undefined && params.temperature !== null) {
    if (typeof params.temperature !== 'number' || !Number.isFinite(params.temperature)) {
      throw new ServiceError('Temperature must be a finite number.', { code: 'INVALID_INPUT' });
    }
    if (params.temperature < 0 || params.temperature > 2) {
      throw new ServiceError('Temperature must be between 0 and 2.', { code: 'INVALID_INPUT' });
    }
    temperature = params.temperature;
  }

  return { apiKey, model, messages, systemPrompt, maxTokens, temperature };
}

function buildConversationPrompt(messages) {
  return messages
    .filter((message) => message.role !== 'system' && message.content)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`)
    .join('\n\n')
    .concat('\n\nAssistant:\n');
}

function unavailable(name) {
  throw new CapabilityUnavailableError(name);
}

export const llmCapabilities = Object.freeze({
  hostedChat: true,
  cutWorkflow: false,
  localOllama: false,
  desktopCliProviders: false,
});

export function createLlmHandlers(options = {}) {
  const falSubscribe = options.falSubscribe ?? createFalSubscriber(options);

  return {
    chat: async (paramsValue) => {
      const params = validateChatParams(paramsValue);
      const input = {
        model: params.model,
        prompt: buildConversationPrompt(params.messages),
        max_tokens: params.maxTokens,
        ...(params.systemPrompt ? { system_prompt: params.systemPrompt } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      };
      const result = await falSubscribe(OPENROUTER_ENDPOINT, input, params.apiKey);
      const data = isPlainRecord(result) && isPlainRecord(result.data) ? result.data : result;
      if (!isPlainRecord(data)) {
        throw new ServiceError('The hosted LLM returned an invalid response.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      const message = typeof data.output === 'string'
        ? data.output
        : typeof data.text === 'string'
          ? data.text
          : '';
      const usage = parseUsage(data.usage);
      return {
        message: message.trim(),
        ...(usage ? { usage } : {}),
      };
    },

    openaiChat: async (paramsValue) => {
      const params = requireRecord(paramsValue, 'OpenAI chat parameters');
      const apiKey = requireSecret(params.apiKey, 'OpenAI API key');
      const userMessage = requireString(params.userMessage, 'OpenAI prompt', { maxLength: 1_000_000 });
      const model = params.model === undefined || params.model === null || params.model === ''
        ? OPENAI_DIRECTOR_MODEL
        : requireString(params.model, 'OpenAI model', { maxLength: 200, pattern: OPENAI_MODEL_ID });
      const systemPrompt = params.systemPrompt === undefined || params.systemPrompt === null || params.systemPrompt === ''
        ? undefined
        : requireString(params.systemPrompt, 'OpenAI system prompt', { maxLength: 250_000 });
      const imageUrls = Array.isArray(params.imageUrls)
        ? params.imageUrls.filter((url) => (
          typeof url === 'string'
          && (/^https?:\/\//i.test(url) || /^data:image\//i.test(url))
        )).slice(0, 6)
        : [];
      const userContent = imageUrls.length === 0
        ? userMessage
        : [
          { type: 'text', text: userMessage },
          ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } })),
        ];
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      const payload = await fetchJson(fetchImpl, OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          reasoning_effort: 'low',
          max_completion_tokens: Number.isFinite(params.maxCompletionTokens)
            ? Math.max(1, Math.floor(params.maxCompletionTokens))
            : 60_000,
        }),
      }, { provider: 'OpenAI', timeoutMs: 120_000 });
      if (!isPlainRecord(payload)) {
        throw new ServiceError('OpenAI returned an invalid response.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const choice = isPlainRecord(choices[0]) ? choices[0] : null;
      const message = choice && isPlainRecord(choice.message) ? choice.message : null;
      if (typeof message?.refusal === 'string' && message.refusal.trim()) {
        throw new ServiceError(message.refusal.trim(), { code: 'PROVIDER_ERROR', statusCode: 502 });
      }
      const content = typeof message?.content === 'string' ? message.content.trim() : '';
      if (!content) {
        throw new ServiceError('OpenAI returned no text output.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      const usageRecord = isPlainRecord(payload.usage) ? payload.usage : null;
      const details = usageRecord && isPlainRecord(usageRecord.prompt_tokens_details)
        ? usageRecord.prompt_tokens_details
        : {};
      const promptTokens = Number(usageRecord?.prompt_tokens) || 0;
      const completionTokens = Number(usageRecord?.completion_tokens) || 0;
      const usage = promptTokens > 0 || completionTokens > 0
        ? {
          promptTokens,
          completionTokens,
          totalTokens: Number(usageRecord?.total_tokens) || promptTokens + completionTokens,
          cachedTokens: Number(details.cached_tokens) || 0,
          cacheWriteTokens: Number(details.cache_write_tokens) || 0,
        }
        : undefined;
      return { message: content, ...(usage ? { usage } : {}) };
    },

    openaiRealtimeSession: async (paramsValue) => {
      const params = requireRecord(paramsValue, 'OpenAI Realtime parameters');
      const apiKey = requireSecret(params.apiKey, 'OpenAI API key');
      // SDP is line-oriented and must keep its terminating CRLF. The shared
      // string validator trims input, so validate this protocol payload without
      // normalizing it.
      if (typeof params.sdp !== 'string' || !params.sdp || params.sdp.length > 1_000_000) {
        throw new ServiceError('Voice Director audio session offer is invalid.', {
          code: 'INVALID_INPUT',
        });
      }
      const sdp = params.sdp;
      const voice = typeof params.voice === 'string' && REALTIME_VOICES.has(params.voice)
        ? params.voice
        : 'cedar';
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
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;

      let response;
      try {
        response = await fetchImpl(OPENAI_REALTIME_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'OpenAI-Safety-Identifier': 'cinegen-web-user',
          },
          body,
        });
      } catch (cause) {
        throw new ServiceError('Could not reach OpenAI Realtime.', {
          code: 'PROVIDER_UNAVAILABLE',
          statusCode: 502,
          cause,
        });
      }

      const answer = await response.text();
      if (!response.ok) {
        let message = `OpenAI Realtime failed (${response.status}).`;
        try {
          const payload = JSON.parse(answer);
          if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
            message = payload.error.message.trim();
          }
        } catch {}
        throw new ServiceError(message, { code: 'PROVIDER_ERROR', statusCode: 502 });
      }
      if (!answer.trim()) {
        throw new ServiceError('OpenAI Realtime returned an empty audio session answer.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      return { sdp: answer };
    },

    localChat: async () => unavailable('Local Ollama chat'),
    localModels: async () => [],
    runCutWorkflow: async () => unavailable('The advanced editorial cut workflow'),

    claudeCodeDetect: async () => ({ installed: false }),
    cliDetect: async () => ({
      providers: [
        { id: 'claude-code', installed: false },
        { id: 'codex', installed: false },
        { id: 'gemini', installed: false },
      ],
    }),
    claudeCodeChat: async () => unavailable('Claude Code CLI chat'),
    codexChat: async () => unavailable('Codex CLI chat'),
    geminiChat: async () => unavailable('Gemini CLI chat'),
    claudeCodeCancel: async () => undefined,
    codexCancel: async () => undefined,
    geminiCancel: async () => undefined,
  };
}

export const llmHandlers = createLlmHandlers();
