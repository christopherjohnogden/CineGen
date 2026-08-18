import {
  CapabilityUnavailableError,
  ServiceError,
  createFalSubscriber,
  isPlainRecord,
  requireRecord,
  requireSecret,
  validateModelId,
} from './_shared.mjs';

const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-4.6';
const OPENROUTER_ENDPOINT = 'openrouter/router';
const MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);

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
