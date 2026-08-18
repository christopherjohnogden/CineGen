import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ServiceError,
  isPlainRecord,
  requireRecord,
  requireString,
} from './_shared.mjs';

const execFileAsync = promisify(execFile);
const PROVIDERS = Object.freeze(['claude-code', 'codex', 'gemini']);
const MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434/';
const DEFAULT_OLLAMA_MODEL = 'qwen3.5:latest';
const DEFAULT_MODELS = Object.freeze({
  'claude-code': 'sonnet',
  codex: 'gpt-5.3-codex',
  gemini: 'gemini-2.5-flash',
});
const STREAM_EVENTS = Object.freeze({
  local: 'llm:local-stream',
  'claude-code': 'llm:claude-code-stream',
  codex: 'llm:codex-stream',
  gemini: 'llm:gemini-stream',
});
const COMMAND_ENV = Object.freeze({
  'claude-code': 'CINEGEN_CLAUDE_CODE_PATH',
  codex: 'CINEGEN_CODEX_PATH',
  gemini: 'CINEGEN_GEMINI_PATH',
});

const CHAT_ONLY_SUFFIX = [
  'CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.',
  'The user\'s video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.',
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  'CineGen SKILLS are listed in the system prompt — answer skill inventory questions from that catalog, never via tools.',
  'When an ACTIVE SKILL section is present, follow it directly in chat — never invoke tools or slash commands.',
  'Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands.',
].join(' ');

const COPILOT_RESUME_REMINDER = [
  'CineGen Copilot follow-up: answer from project context already established in this conversation.',
  'Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.',
  'CineGen SKILLS are in the system prompt — list them directly; never use a tool or say you will check.',
  'For clip/timeline lists: use a numbered list with timeline/clip citations, never markdown tables.',
].join(' ');

const ENHANCE_PROMPT_SUFFIX = [
  'CineGen prompt-rewrite mode: rewrite the user\'s rough Copilot prompt only.',
  'Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.',
  'Do not search files or invoke tools.',
  'Return only the rewritten prompt text.',
].join(' ');

export const localLlmCapabilities = Object.freeze({
  ollamaHttpStreaming: true,
  serverCliStreaming: true,
  concurrentRequests: true,
  runCutWorkflow: false,
  geminiVisualRefs: false,
  shellInterpolation: false,
  promptsPersistedByService: false,
});

function stripAnsiCodes(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function validateRequestId(value, { generate = true } = {}) {
  if ((value === undefined || value === null || value === '') && generate) return crypto.randomUUID();
  return requireString(value, 'Request id', { maxLength: 128, pattern: REQUEST_ID_PATTERN });
}

function validateSessionId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, 'CLI session id', { maxLength: 256, pattern: SESSION_ID_PATTERN });
}

function validateModel(value, fallback, label = 'Model') {
  if (value === undefined || value === null || value === '') return fallback;
  const model = requireString(value, label, { maxLength: 256, pattern: MODEL_PATTERN });
  if (model.includes('..') || model.includes('://') || model.startsWith('/') || model.endsWith('/')) {
    throw new ServiceError(`${label} has an invalid format.`, { code: 'INVALID_MODEL' });
  }
  return model;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ServiceError(`${label} must be text no longer than ${maxLength.toLocaleString()} characters.`, {
      code: 'INVALID_INPUT',
    });
  }
  return value.trim() || undefined;
}

function optionalBoolean(value, label, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    throw new ServiceError(`${label} must be true or false.`, { code: 'INVALID_INPUT' });
  }
  return value;
}

function optionalNumber(value, label, { fallback, min, max, integer = false }) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ServiceError(`${label} must be between ${min} and ${max}.`, { code: 'INVALID_INPUT' });
  }
  return integer ? Math.floor(value) : value;
}

function validateMessages(value, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ServiceError('No chat messages provided.', { code: 'INVALID_INPUT' });
    return [];
  }
  if (!Array.isArray(value) || value.length > 200) {
    throw new ServiceError('Chat messages must be an array with at most 200 entries.', {
      code: 'INVALID_INPUT',
    });
  }
  let totalLength = 0;
  const messages = value.map((entry, index) => {
    const message = requireRecord(entry, `Chat message ${index + 1}`);
    if (!MESSAGE_ROLES.has(message.role)) {
      throw new ServiceError(`Chat message ${index + 1} has an invalid role.`, {
        code: 'INVALID_INPUT',
      });
    }
    if (typeof message.content !== 'string' || message.content.length > 250_000) {
      throw new ServiceError(`Chat message ${index + 1} must contain valid text.`, {
        code: 'INVALID_INPUT',
      });
    }
    const content = message.content.trim();
    totalLength += content.length;
    return { role: message.role, content };
  });
  if (totalLength > 1_000_000) {
    throw new ServiceError('The chat conversation is too large.', {
      code: 'INVALID_INPUT',
      statusCode: 413,
    });
  }
  return messages;
}

function validateLocalChatParams(value) {
  const params = requireRecord(value, 'Local chat parameters');
  const messages = validateMessages(params.messages, { required: true }).filter((message) => message.content);
  if (!messages.some((message) => message.role !== 'system')) {
    throw new ServiceError('No chat messages provided.', { code: 'INVALID_INPUT' });
  }
  return {
    requestId: validateRequestId(params.requestId),
    model: validateModel(params.model, DEFAULT_OLLAMA_MODEL, 'Ollama model'),
    systemPrompt: optionalText(params.systemPrompt, 'System prompt', 500_000),
    messages,
    maxTokens: optionalNumber(params.maxTokens, 'Maximum tokens', {
      fallback: undefined,
      min: 1,
      max: 131_072,
      integer: true,
    }),
    temperature: optionalNumber(params.temperature, 'Temperature', {
      fallback: undefined,
      min: 0,
      max: 2,
    }),
  };
}

function validateCliChatParams(value, provider) {
  const params = requireRecord(value, `${provider} chat parameters`);
  const userMessage = requireString(params.userMessage, 'Chat message', { maxLength: 250_000 });
  const messages = validateMessages(params.messages);
  const systemPrompt = optionalText(params.systemPrompt, 'System prompt', 500_000);
  const injectProjectContext = optionalBoolean(params.injectProjectContext, 'Project context flag');
  const contextRefresh = optionalBoolean(params.contextRefresh, 'Context refresh flag');
  const purpose = params.purpose ?? 'copilot';
  if (!['copilot', 'enhance-prompt'].includes(purpose)) {
    throw new ServiceError('CLI chat purpose is invalid.', { code: 'INVALID_INPUT' });
  }
  if (params.visualRefs !== undefined && params.visualRefs !== null) {
    if (!Array.isArray(params.visualRefs)) {
      throw new ServiceError('CLI visual references must be an array.', { code: 'INVALID_INPUT' });
    }
    if (params.visualRefs.length > 0) {
      throw new ServiceError(
        'Gemini CLI visual attachments are not exposed by the web server. Use copilot.analyzeVisualRefs for hosted visual analysis.',
        { code: 'WEB_CLI_VISUAL_UNAVAILABLE', statusCode: 422 },
      );
    }
  }
  return {
    requestId: validateRequestId(params.requestId),
    model: validateModel(params.model, DEFAULT_MODELS[provider], `${provider} model`),
    resumeSessionId: validateSessionId(params.resumeSessionId),
    injectProjectContext,
    contextRefresh,
    purpose,
    systemPrompt,
    userMessage,
    messages,
  };
}

function buildConversationPrompt(messages) {
  return messages
    .filter((message) => message.role !== 'system' && message.content)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`)
    .join('\n\n')
    .concat('\n\nAssistant:\n');
}

function validateOllamaBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ServiceError('Configured Ollama URL is invalid.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
      cause,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ServiceError('Configured Ollama URL must be an HTTP(S) server URL without credentials, query, or fragment.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function validateCommand(value, label) {
  const command = requireString(value, label, { maxLength: 4_096 });
  if (/[\0\r\n]/.test(command)) {
    throw new ServiceError(`${label} contains invalid characters.`, {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  if (!path.isAbsolute(command) && !COMMAND_NAME_PATTERN.test(command)) {
    throw new ServiceError(`${label} must be an absolute executable path or a bare command name.`, {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  return command;
}

function defaultCandidates(provider) {
  const home = os.homedir();
  if (provider === 'claude-code') {
    return [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', 'claude'];
  }
  if (provider === 'codex') {
    return [
      path.join(home, '.npm-global/bin/codex'),
      path.join(home, '.local/bin/codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      'codex',
    ];
  }
  return [
    path.join(home, '.npm-global/bin/gemini'),
    path.join(home, '.local/bin/gemini'),
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    'gemini',
  ];
}

function optionForProvider(record, provider) {
  if (!isPlainRecord(record)) return undefined;
  return record[provider] ?? (provider === 'claude-code' ? record.claudeCode : undefined);
}

function buildCliEnvironment(options) {
  const extraPaths = [
    path.join(os.homedir(), '.local/bin'),
    path.join(os.homedir(), '.npm-global/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const base = isPlainRecord(options.cliEnv) ? options.cliEnv : process.env;
  const currentPath = typeof base.PATH === 'string' ? base.PATH : process.env.PATH ?? '';
  return {
    ...base,
    PATH: [...extraPaths, currentPath].filter(Boolean).join(path.delimiter),
    TERM: 'dumb',
    NO_COLOR: '1',
  };
}

function createDefaultProcessRunner() {
  return (spec, handlers) => new Promise((resolve, reject) => {
    if (spec.signal.aborted) {
      reject(spec.signal.reason ?? new Error('Request aborted.'));
      return;
    }
    let settled = false;
    let killTimer;
    let child;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      spec.signal.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      callback();
    };
    const terminate = () => {
      if (!child || child.killed) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2_000);
      killTimer.unref?.();
    };
    const abort = () => terminate();

    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: false,
        windowsHide: true,
        stdio: spec.stdin === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    spec.signal.addEventListener('abort', abort, { once: true });
    if (spec.stdin !== undefined) {
      child.stdin?.end(spec.stdin);
    }
    child.stdout?.on('data', (chunk) => {
      if (settled) return;
      try {
        handlers.onStdout(chunk);
      } catch (error) {
        terminate();
        finish(() => reject(error));
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (settled) return;
      try {
        handlers.onStderr(chunk);
      } catch (error) {
        terminate();
        finish(() => reject(error));
      }
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code, signal) => finish(() => resolve({ code, signal })));
  });
}

function normalizeDetection(provider, value) {
  if (value === false || value === null || value === undefined) {
    return { id: provider, installed: false };
  }
  if (typeof value === 'string') {
    return {
      id: provider,
      installed: true,
      path: validateCommand(value, `${provider} executable`),
      version: 'unknown',
    };
  }
  if (!isPlainRecord(value) || value.installed !== true) {
    return { id: provider, installed: false };
  }
  return {
    id: provider,
    installed: true,
    path: validateCommand(value.path, `${provider} executable`),
    version: typeof value.version === 'string' && value.version.trim()
      ? stripAnsiCodes(value.version).trim().slice(0, 1_024)
      : 'unknown',
  };
}

function parseNumericUsage(value, names) {
  if (!isPlainRecord(value)) return undefined;
  const promptTokens = Number(value[names.prompt]) || 0;
  const cachedNames = Array.isArray(names.cached) ? names.cached : names.cached ? [names.cached] : [];
  const cachedTokens = cachedNames.reduce((total, name) => total + (Number(value[name]) || 0), 0);
  const completionTokens = Number(value[names.completion]) || 0;
  const reportedTotal = names.total ? Number(value[names.total]) || 0 : 0;
  const totalTokens = reportedTotal || promptTokens + cachedTokens + completionTokens;
  const cost = names.cost ? Number(value[names.cost]) || 0 : 0;
  if (totalTokens <= 0 && cost <= 0) return undefined;
  return {
    promptTokens: promptTokens + cachedTokens,
    completionTokens,
    totalTokens,
    cost,
  };
}

function safeProviderSession(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value) ? value : undefined;
}

function createNdjsonParser(onObject, maxLineBytes) {
  let buffer = '';
  const decodeChunk = (chunk) => {
    if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
    if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
    return String(chunk);
  };
  const parseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // CLI tools occasionally interleave non-JSON diagnostics; stderr and exit
      // status still provide the authoritative failure path.
      return;
    }
    if (isPlainRecord(parsed)) onObject(parsed);
  };
  return {
    push(chunk) {
      buffer += decodeChunk(chunk);
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
          throw new ServiceError('CLI output contained an oversized line.', {
            code: 'OUTPUT_LIMIT',
            statusCode: 502,
          });
        }
        parseLine(line);
      }
      if (Buffer.byteLength(buffer, 'utf8') > maxLineBytes) {
        throw new ServiceError('CLI output contained an oversized line.', {
          code: 'OUTPUT_LIMIT',
          statusCode: 502,
        });
      }
    },
    finish() {
      if (buffer) parseLine(buffer);
      buffer = '';
    },
  };
}

function buildClaudeSpec(params, command, context) {
  const history = params.messages.filter((message) => message.content);
  const prompt = params.injectProjectContext && history.length > 0
    ? buildConversationPrompt(history)
    : `${params.userMessage}\n\nAssistant:\n`;
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  const args = [
    '-p', canResume ? params.userMessage : prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns', '2',
    '--model', params.model,
    '--tools', '',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
  ];
  if (canResume) {
    args.push('--resume', params.resumeSessionId);
    args.push('--append-system-prompt', [params.systemPrompt, COPILOT_RESUME_REMINDER].filter(Boolean).join('\n\n'));
  } else if (params.injectProjectContext && params.systemPrompt) {
    const refresh = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    const suffix = params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
    args.push('--append-system-prompt', `${refresh}${params.systemPrompt}\n\n${suffix}`);
  }
  context.assertArgSize(args);
  return { command, args, cwd: context.cwd, env: context.env, shell: false, canResume };
}

function buildCodexSpec(params, command, context) {
  const systemParts = [];
  if (params.injectProjectContext && params.systemPrompt) {
    const refresh = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    const suffix = params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
    systemParts.push(`${refresh}${params.systemPrompt}\n\n${suffix}`);
  }
  const history = params.messages.filter((message) => message.content);
  const conversation = history.length > 0
    ? buildConversationPrompt(history)
    : `${params.userMessage}\n\nAssistant:\n`;
  const prompt = systemParts.length > 0 ? `${systemParts.join('\n\n')}\n\n${conversation}` : params.userMessage;
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  const args = ['exec'];
  if (canResume) args.push('resume', params.resumeSessionId, params.userMessage);
  else args.push(prompt);
  args.push('--json', '-s', 'read-only', '-m', params.model, '--skip-git-repo-check');
  context.assertArgSize(args);
  return { command, args, cwd: context.cwd, env: context.env, shell: false, canResume };
}

function buildGeminiSpec(params, command, context) {
  const systemParts = [];
  if (params.injectProjectContext && params.systemPrompt) {
    const refresh = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    const suffix = params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
    systemParts.push(`${refresh}${params.systemPrompt}\n\n${suffix}`);
  }
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  let prompt;
  if (canResume) {
    const prefix = [params.systemPrompt, COPILOT_RESUME_REMINDER].filter(Boolean).join('\n\n');
    prompt = prefix
      ? `${prefix}\n\nUser:\n${params.userMessage}\n\nAssistant:\n`
      : `${params.userMessage}\n\nAssistant:\n`;
  } else {
    const history = params.messages.filter((message) => message.content);
    const conversation = history.length > 0
      ? buildConversationPrompt(history)
      : `User:\n${params.userMessage}\n\nAssistant:\n`;
    prompt = systemParts.length > 0 ? `${systemParts.join('\n\n')}\n\n${conversation}` : conversation;
  }
  const model = params.model.replace(/^[^/]+\//, '');
  const useStdin = prompt.length > context.geminiStdinThreshold;
  const args = [
    '--skip-trust',
    '-p', useStdin ? '' : prompt,
    '-o', 'stream-json',
    '-m', model,
    '--approval-mode', 'default',
  ];
  if (canResume) args.push('-r', params.resumeSessionId);
  context.assertArgSize(args);
  return {
    command,
    args,
    cwd: context.cwd,
    env: { ...context.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    shell: false,
    canResume,
    ...(useStdin ? { stdin: prompt } : {}),
  };
}

function createCliAccumulator(provider, requestId, emit, limits) {
  let fullContent = '';
  let stderr = '';
  let sessionId;
  let usage;
  let sawClaudeDelta = false;
  let lastCodexText = '';
  let authFailed = false;
  let lastResult;
  const appendToken = (token, { replace = false } = {}) => {
    if (!token) return;
    fullContent = replace ? token : fullContent + token;
    if (Buffer.byteLength(fullContent, 'utf8') > limits.maxOutputBytes) {
      throw new ServiceError('CLI response exceeded the configured output limit.', {
        code: 'OUTPUT_LIMIT',
        statusCode: 502,
      });
    }
    emit(STREAM_EVENTS[provider], { requestId, token });
  };

  const parser = createNdjsonParser((object) => {
    if (provider === 'claude-code') {
      if (object.type === 'system' && object.subtype === 'init') sessionId = safeProviderSession(object.session_id);
      if (object.type === 'assistant' && object.error === 'authentication_failed') authFailed = true;
      if (object.type === 'result') lastResult = object;
      const directUsage = parseNumericUsage(object.usage, {
        prompt: 'input_tokens',
        cached: ['cache_creation_input_tokens', 'cache_read_input_tokens'],
        completion: 'output_tokens',
      });
      const messageUsage = isPlainRecord(object.message)
          ? parseNumericUsage(object.message.usage, {
            prompt: 'input_tokens',
            cached: ['cache_creation_input_tokens', 'cache_read_input_tokens'],
            completion: 'output_tokens',
          })
        : undefined;
      if (directUsage || messageUsage) {
        usage = directUsage ?? messageUsage;
        if (usage && Number(object.total_cost_usd) > 0) usage.cost = Number(object.total_cost_usd);
      }
      if (object.type === 'stream_event' && isPlainRecord(object.event) && isPlainRecord(object.event.delta)) {
        const delta = object.event.delta;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          sawClaudeDelta = true;
          appendToken(delta.text);
        }
      } else if (object.type === 'assistant' && !sawClaudeDelta && isPlainRecord(object.message)) {
        const blocks = Array.isArray(object.message.content) ? object.message.content : [];
        const text = blocks
          .filter((block) => isPlainRecord(block) && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('');
        if (text) appendToken(text, { replace: true });
      } else if (object.type === 'result' && !fullContent.trim() && typeof object.result === 'string') {
        appendToken(object.result, { replace: true });
      }
      return;
    }

    if (provider === 'codex') {
      if (object.type === 'thread.started') sessionId = safeProviderSession(object.thread_id);
      const parsedUsage = parseNumericUsage(object.usage, {
        prompt: 'input_tokens',
        cached: 'cached_input_tokens',
        completion: 'output_tokens',
      });
      if (parsedUsage) usage = parsedUsage;
      if (object.type === 'turn.failed' && isPlainRecord(object.error) && typeof object.error.message === 'string') {
        stderr += object.error.message;
      }
      if (['item.completed', 'item.updated'].includes(object.type) && isPlainRecord(object.item)) {
        const text = object.item.type === 'agent_message' && typeof object.item.text === 'string'
          ? object.item.text
          : '';
        if (text) {
          const delta = text.startsWith(lastCodexText) ? text.slice(lastCodexText.length) : text;
          lastCodexText = text;
          fullContent = text;
          if (Buffer.byteLength(fullContent, 'utf8') > limits.maxOutputBytes) {
            throw new ServiceError('CLI response exceeded the configured output limit.', {
              code: 'OUTPUT_LIMIT',
              statusCode: 502,
            });
          }
          if (delta) emit(STREAM_EVENTS[provider], { requestId, token: delta });
        }
      }
      return;
    }

    if (object.type === 'init') sessionId = safeProviderSession(object.session_id);
    const parsedUsage = parseNumericUsage(object.stats, {
      prompt: 'input_tokens',
      completion: 'output_tokens',
      total: 'total_tokens',
    });
    if (parsedUsage) usage = parsedUsage;
    if (object.type === 'tool_use') {
      const tool = typeof object.tool_name === 'string' && object.tool_name.trim()
        ? object.tool_name.replace(/_/g, ' ')
        : 'working';
      emit(STREAM_EVENTS[provider], { requestId, status: `Gemini CLI: ${tool}…` });
    }
    if (object.type === 'message' && object.role === 'assistant' && typeof object.content === 'string') {
      appendToken(object.content);
    }
    if (object.type === 'error' && typeof object.message === 'string') stderr += object.message;
    if (object.type === 'result' && object.status === 'error') {
      stderr += typeof object.error === 'string'
        ? object.error
        : typeof object.message === 'string' ? object.message : 'Gemini CLI returned an error.';
    }
  }, limits.maxLineBytes);

  return {
    onStdout(chunk) {
      parser.push(chunk);
    },
    onStderr(chunk) {
      stderr += chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString('utf8')
        : String(chunk);
      if (Buffer.byteLength(stderr, 'utf8') > limits.maxStderrBytes) {
        throw new ServiceError('CLI diagnostics exceeded the configured output limit.', {
          code: 'OUTPUT_LIMIT',
          statusCode: 502,
        });
      }
    },
    finish(exit, resumed) {
      parser.finish();
      const message = fullContent.trim();
      const cleanStderr = stripAnsiCodes(stderr).trim().slice(0, 8_000);
      if (provider === 'claude-code' && (authFailed || message.includes('Not logged in'))) {
        throw new ServiceError('Claude Code is not logged in on the web server.', {
          code: 'CLI_AUTH_REQUIRED',
          statusCode: 422,
        });
      }
      if (!message) {
        let failure = cleanStderr;
        if (provider === 'claude-code' && isPlainRecord(lastResult)) {
          const errors = Array.isArray(lastResult.errors)
            ? lastResult.errors.filter((entry) => typeof entry === 'string').join(' ')
            : '';
          failure = errors || (typeof lastResult.result === 'string' ? lastResult.result.trim() : '') || failure;
          if (!failure && lastResult.subtype === 'error_max_turns') {
            failure = 'Claude Code hit its turn limit before finishing a reply.';
          }
        }
        throw new ServiceError(
          failure || `${provider} exited with code ${exit?.code ?? 'unknown'}.`,
          { code: 'CLI_FAILED', statusCode: 502 },
        );
      }
      return {
        message,
        ...(sessionId ? { sessionId } : {}),
        resumed,
        ...(usage ? { usage } : {}),
      };
    },
  };
}

function createThinkFilter(onToken, maxOutputBytes) {
  let fullContent = '';
  let insideThink = false;
  let buffer = '';
  const flush = (token) => {
    if (!token) return;
    fullContent += token;
    if (Buffer.byteLength(fullContent, 'utf8') > maxOutputBytes) {
      throw new ServiceError('Ollama response exceeded the configured output limit.', {
        code: 'OUTPUT_LIMIT',
        statusCode: 502,
      });
    }
    onToken(token);
  };
  return {
    push(token) {
      for (const character of token) {
        if (!insideThink) {
          buffer += character;
          if (buffer === '<think>') {
            insideThink = true;
            buffer = '';
          } else if (!'<think>'.startsWith(buffer)) {
            flush(buffer);
            buffer = '';
          }
        } else {
          buffer += character;
          if (buffer.endsWith('</think>')) {
            insideThink = false;
            buffer = '';
          }
        }
      }
    },
    finish() {
      if (buffer && !insideThink) flush(buffer);
      buffer = '';
      return fullContent.trim();
    },
  };
}

function abortError(state) {
  if (state.failure) return state.failure;
  if (state.timedOut) {
    return new ServiceError(`${state.label} timed out.`, {
      code: 'PROVIDER_TIMEOUT',
      statusCode: 504,
    });
  }
  return new ServiceError(`${state.label} was cancelled.`, {
    code: 'REQUEST_CANCELLED',
    statusCode: 499,
  });
}

async function raceWithAbort(promise, state) {
  const guarded = Promise.resolve(promise);
  guarded.catch(() => {});
  const aborted = new Promise((_, reject) => {
    if (state.controller.signal.aborted) {
      reject(abortError(state));
      return;
    }
    state.controller.signal.addEventListener('abort', () => reject(abortError(state)), { once: true });
  });
  return Promise.race([guarded, aborted]);
}

export function createLocalLlmService(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ServiceError('This Node runtime does not provide fetch.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  const ollamaBaseUrl = validateOllamaBaseUrl(
    options.ollamaUrl ?? process.env.CINEGEN_OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
  );
  const ollamaTimeoutMs = options.ollamaTimeoutMs ?? 15 * 60_000;
  const ollamaListTimeoutMs = options.ollamaListTimeoutMs ?? 5_000;
  const cliTimeoutMs = options.cliTimeoutMs ?? 15 * 60_000;
  const detectionTimeoutMs = options.detectionTimeoutMs ?? 8_000;
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const maxStderrBytes = options.maxStderrBytes ?? 1024 * 1024;
  const maxLineBytes = options.maxLineBytes ?? 2 * 1024 * 1024;
  const maxCliArgumentBytes = options.maxCliArgumentBytes ?? 240 * 1024;
  const geminiStdinThreshold = options.geminiStdinThreshold ?? 8_000;
  const processRunner = options.processRunner ?? createDefaultProcessRunner();
  const detector = options.detector;
  const events = options.events;
  const activeRequests = new Map();
  const cliEnvironment = buildCliEnvironment(options);
  const cliCwd = path.resolve(options.cliCwd ?? os.tmpdir());

  const emit = (event, payload) => {
    try {
      events?.emit?.(event, payload);
    } catch {
      // A disconnected SSE subscriber must not fail an otherwise valid request.
    }
  };

  const candidatesByProvider = Object.fromEntries(PROVIDERS.map((provider) => {
    const explicit = optionForProvider(options.cliCommands, provider)
      ?? process.env[COMMAND_ENV[provider]];
    if (explicit) return [provider, [validateCommand(explicit, `${provider} executable`)]];
    const configuredCandidates = optionForProvider(options.cliCandidates, provider);
    if (configuredCandidates !== undefined) {
      if (!Array.isArray(configuredCandidates) || configuredCandidates.length > 20) {
        throw new ServiceError(`${provider} candidates must be an array with at most 20 entries.`, {
          code: 'SERVER_MISCONFIGURED',
          statusCode: 500,
        });
      }
      return [provider, configuredCandidates.map((candidate) => validateCommand(candidate, `${provider} executable`))];
    }
    return [provider, defaultCandidates(provider)];
  }));

  const detectProvider = async (provider) => {
    const candidates = candidatesByProvider[provider];
    try {
      if (typeof detector === 'function') {
        const result = await detector(provider, {
          candidates: [...candidates],
          env: { ...cliEnvironment },
          timeoutMs: detectionTimeoutMs,
        });
        return normalizeDetection(provider, result);
      }
      for (const candidate of candidates) {
        try {
          const { stdout } = await execFileAsync(candidate, ['--version'], {
            env: cliEnvironment,
            timeout: detectionTimeoutMs,
            maxBuffer: 64 * 1024,
            windowsHide: true,
          });
          if (stdout.trim()) {
            return normalizeDetection(provider, {
              installed: true,
              path: candidate,
              version: stdout,
            });
          }
        } catch {
          // Try the next server-configured candidate.
        }
      }
    } catch {
      // Detection is informational and should degrade to installed=false.
    }
    return { id: provider, installed: false };
  };

  const beginRequest = (requestId, provider, label) => {
    if (activeRequests.has(requestId)) {
      throw new ServiceError(`Request id ${requestId} is already active.`, {
        code: 'REQUEST_IN_PROGRESS',
        statusCode: 409,
      });
    }
    const state = {
      requestId,
      provider,
      label,
      controller: new AbortController(),
      timedOut: false,
      cancelled: false,
      failure: undefined,
    };
    activeRequests.set(requestId, state);
    return state;
  };

  const endRequest = (state) => {
    if (activeRequests.get(state.requestId) === state) activeRequests.delete(state.requestId);
  };

  const runLocalChat = async (paramsValue) => {
    const params = validateLocalChatParams(paramsValue);
    const state = beginRequest(params.requestId, 'local', 'Ollama chat');
    const timeout = setTimeout(() => {
      state.timedOut = true;
      state.controller.abort();
    }, ollamaTimeoutMs);
    try {
      const messages = [];
      if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt });
      messages.push(...params.messages);
      const response = await raceWithAbort(fetchImpl(new URL('api/chat', ollamaBaseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages,
          stream: true,
          think: false,
          options: {
            ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
            ...(params.maxTokens !== undefined ? { num_predict: params.maxTokens } : {}),
          },
        }),
        signal: state.controller.signal,
      }), state);
      if (!response?.ok) {
        const detail = await response?.text?.().catch(() => '') ?? '';
        throw new ServiceError(
          `Ollama request failed (${response?.status ?? 'unknown'}): ${detail.trim().slice(0, 2_000) || response?.statusText || 'No response'}`,
          { code: 'OLLAMA_ERROR', statusCode: 502 },
        );
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new ServiceError('Ollama returned a response without a readable stream.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }

      let rawBytes = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      const filter = createThinkFilter((token) => {
        emit(STREAM_EVENTS.local, { requestId: params.requestId, token });
      }, maxOutputBytes);
      const parser = createNdjsonParser((chunk) => {
        if (typeof chunk.error === 'string' && chunk.error.trim()) {
          throw new ServiceError(chunk.error.trim().slice(0, 2_000), {
            code: 'OLLAMA_ERROR',
            statusCode: 502,
          });
        }
        if (isPlainRecord(chunk.message) && typeof chunk.message.content === 'string') {
          filter.push(chunk.message.content);
        }
        if (chunk.done) {
          promptTokens = Number(chunk.prompt_eval_count) || 0;
          completionTokens = Number(chunk.eval_count) || 0;
        }
      }, maxLineBytes);
      const reader = response.body.getReader();
      for (;;) {
        const next = await raceWithAbort(reader.read(), state);
        if (next.done) break;
        rawBytes += next.value?.byteLength ?? 0;
        if (rawBytes > maxOutputBytes * 2) {
          state.failure = new ServiceError('Ollama stream exceeded the configured output limit.', {
            code: 'OUTPUT_LIMIT',
            statusCode: 502,
          });
          state.controller.abort();
          throw state.failure;
        }
        parser.push(next.value ?? new Uint8Array());
      }
      parser.finish();
      const message = filter.finish();
      if (!message) {
        throw new ServiceError('Ollama returned an empty response.', {
          code: 'PROVIDER_BAD_RESPONSE',
          statusCode: 502,
        });
      }
      const usage = promptTokens > 0 || completionTokens > 0
        ? {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            cost: 0,
          }
        : undefined;
      return { message, ...(usage ? { usage } : {}) };
    } catch (error) {
      if (state.controller.signal.aborted) throw abortError(state);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('Could not reach the configured Ollama server.', {
        code: 'OLLAMA_UNAVAILABLE',
        statusCode: 502,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      emit(STREAM_EVENTS.local, { requestId: params.requestId, done: true });
      endRequest(state);
    }
  };

  const listLocalModels = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ollamaListTimeoutMs);
    try {
      const response = await fetchImpl(new URL('api/tags', ollamaBaseUrl), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response?.ok) return [];
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) return [];
      const payload = JSON.parse(text);
      if (!isPlainRecord(payload) || !Array.isArray(payload.models)) return [];
      const models = payload.models.flatMap((entry) => {
        if (!isPlainRecord(entry) || typeof entry.name !== 'string') return [];
        try {
          return [validateModel(entry.name, '', 'Ollama model')];
        } catch {
          return [];
        }
      });
      return [...new Set(models)].slice(0, 1_000);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  };

  const runCliChat = async (provider, paramsValue) => {
    const params = validateCliChatParams(paramsValue, provider);
    const state = beginRequest(params.requestId, provider, `${provider} CLI request`);
    const timeout = setTimeout(() => {
      state.timedOut = true;
      state.controller.abort();
    }, cliTimeoutMs);
    const buildContext = {
      cwd: cliCwd,
      env: cliEnvironment,
      geminiStdinThreshold,
      assertArgSize(args) {
        const bytes = args.reduce((total, arg) => total + Buffer.byteLength(arg, 'utf8'), 0);
        if (bytes > maxCliArgumentBytes) {
          throw new ServiceError('CLI prompt is too large for the server process transport.', {
            code: 'INVALID_INPUT',
            statusCode: 413,
          });
        }
      },
    };
    let doneSent = false;
    const sendDone = () => {
      if (doneSent) return;
      doneSent = true;
      emit(STREAM_EVENTS[provider], { requestId: params.requestId, done: true });
    };
    try {
      const detection = await raceWithAbort(detectProvider(provider), state);
      if (state.controller.signal.aborted) throw abortError(state);
      if (!detection.installed) {
        throw new ServiceError(`${provider} CLI is not installed or configured on the web server.`, {
          code: 'CLI_NOT_INSTALLED',
          statusCode: 422,
        });
      }
      const spec = provider === 'claude-code'
        ? buildClaudeSpec(params, detection.path, buildContext)
        : provider === 'codex'
          ? buildCodexSpec(params, detection.path, buildContext)
          : buildGeminiSpec(params, detection.path, buildContext);
      const accumulator = createCliAccumulator(provider, params.requestId, emit, {
        maxOutputBytes,
        maxStderrBytes,
        maxLineBytes,
      });
      let observedBytes = 0;
      const accountOutput = (chunk) => {
        observedBytes += chunk instanceof Uint8Array
          ? chunk.byteLength
          : Buffer.byteLength(String(chunk), 'utf8');
        if (observedBytes > maxOutputBytes + maxStderrBytes) {
          state.failure = new ServiceError('CLI process exceeded the configured output limit.', {
            code: 'OUTPUT_LIMIT',
            statusCode: 502,
          });
          state.controller.abort();
          throw state.failure;
        }
      };
      const runnerPromise = processRunner({
        provider,
        requestId: params.requestId,
        command: spec.command,
        args: [...spec.args],
        cwd: spec.cwd,
        env: { ...spec.env },
        shell: false,
        signal: state.controller.signal,
        ...(spec.stdin !== undefined ? { stdin: spec.stdin } : {}),
      }, {
        onStdout(chunk) {
          if (state.controller.signal.aborted) return;
          accountOutput(chunk);
          accumulator.onStdout(chunk);
        },
        onStderr(chunk) {
          if (state.controller.signal.aborted) return;
          accountOutput(chunk);
          accumulator.onStderr(chunk);
        },
      });
      const exit = await raceWithAbort(runnerPromise, state);
      if (state.controller.signal.aborted) throw abortError(state);
      return accumulator.finish(exit, spec.canResume);
    } catch (error) {
      if (state.controller.signal.aborted) throw abortError(state);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(`${provider} CLI could not be started.`, {
        code: 'CLI_UNAVAILABLE',
        statusCode: 502,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      sendDone();
      endRequest(state);
    }
  };

  const cancelCli = async (provider, requestIdValue) => {
    const requestId = validateRequestId(requestIdValue, { generate: false });
    const state = activeRequests.get(requestId);
    if (!state || state.provider !== provider) return undefined;
    state.cancelled = true;
    state.controller.abort();
    return undefined;
  };

  const handlers = {
    localChat: runLocalChat,
    localModels: listLocalModels,
    claudeCodeDetect: async () => {
      const result = await detectProvider('claude-code');
      return result.installed
        ? { installed: true, path: result.path, version: result.version }
        : { installed: false };
    },
    cliDetect: async () => ({ providers: await Promise.all(PROVIDERS.map(detectProvider)) }),
    claudeCodeChat: (params) => runCliChat('claude-code', params),
    codexChat: (params) => runCliChat('codex', params),
    geminiChat: (params) => runCliChat('gemini', params),
    claudeCodeCancel: (requestId) => cancelCli('claude-code', requestId),
    codexCancel: (requestId) => cancelCli('codex', requestId),
    geminiCancel: (requestId) => cancelCli('gemini', requestId),
  };

  const context = {
    ollamaUrl: ollamaBaseUrl.href,
    capabilities: localLlmCapabilities,
    activeRequestCount: () => activeRequests.size,
    cancel: (requestIdValue) => {
      const requestId = validateRequestId(requestIdValue, { generate: false });
      const state = activeRequests.get(requestId);
      if (!state) return false;
      state.cancelled = true;
      state.controller.abort();
      return true;
    },
    cancelAll: () => {
      for (const state of activeRequests.values()) {
        state.cancelled = true;
        state.controller.abort();
      }
    },
  };

  return { handlers, context };
}

export function createLocalLlmHandlers(options = {}) {
  return createLocalLlmService(options).handlers;
}

export const localLlmHandlers = createLocalLlmHandlers();
