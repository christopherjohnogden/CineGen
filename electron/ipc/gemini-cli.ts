import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildGeminiUserMessageWithVisualRefs,
  cleanupEphemeralVisualRefs,
  prepareCopilotVisualRefs,
  type PreparedCopilotVisualRef,
} from './copilot-visual-media.js';
import {
  buildGeminiCliEnv,
  buildConversationPrompt,
  CHAT_ONLY_SUFFIX,
  COPILOT_RESUME_REMINDER,
  ENHANCE_PROMPT_SUFFIX,
  getMainWindow,
  resolveCliBinary,
  stripAnsiCodes,
  type ActiveCliRequest,
  type CliCopilotChatParams,
  type CliUsageSummary,
} from './cli-llm-shared.js';

let activeRequest: ActiveCliRequest | null = null;

const FIRST_TOKEN_TIMEOUT_MS = 90_000;
const VISUAL_FIRST_TOKEN_TIMEOUT_MS = 180_000;
const PROMPT_STDIN_THRESHOLD = 8_000;

function getGeminiWorkspaceDir(): string {
  return path.join(app.getPath('userData'), 'gemini-cli-workspace');
}

function getGeminiVisualWorkspaceDir(): string {
  return path.join(os.tmpdir(), 'cinegen-gemini-visual-refs');
}

function buildGeminiPrompt(params: CliCopilotChatParams): string {
  const systemParts: string[] = [];

  if (params.injectProjectContext && params.systemPrompt?.trim()) {
    const refreshPrefix = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    systemParts.push(`${refreshPrefix}${params.systemPrompt.trim()}\n\n${params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX}`);
  }

  const history = (params.messages ?? []).filter((message) => message.content.trim());
  if (history.length > 0) {
    return systemParts.length > 0
      ? `${systemParts.join('\n\n')}\n\n${buildConversationPrompt(history)}`
      : buildConversationPrompt(history);
  }

  return systemParts.length > 0
    ? `${systemParts.join('\n\n')}\n\nUser:\n${params.userMessage.trim()}\n\nAssistant:\n`
    : params.userMessage.trim();
}

function buildGeminiResumePrompt(params: CliCopilotChatParams): string {
  const prefix = [
    params.systemPrompt?.trim(),
    COPILOT_RESUME_REMINDER,
  ].filter(Boolean).join('\n\n');

  return prefix
    ? `${prefix}\n\nUser:\n${params.userMessage.trim()}\n\nAssistant:\n`
    : `${params.userMessage.trim()}\n\nAssistant:\n`;
}

function parseGeminiUsage(obj: Record<string, unknown>): CliUsageSummary | undefined {
  const stats = obj.stats as Record<string, unknown> | undefined;
  if (!stats) return undefined;

  const promptTokens = Number(stats.input_tokens) || 0;
  const completionTokens = Number(stats.output_tokens) || 0;
  const totalTokens = Number(stats.total_tokens) || (promptTokens + completionTokens);
  if (totalTokens <= 0) return undefined;

  return { promptTokens, completionTokens, totalTokens, cost: 0 };
}

function formatGeminiToolStatus(toolName: unknown): string {
  if (typeof toolName !== 'string' || !toolName.trim()) return 'Gemini CLI is working…';
  const normalized = toolName.replace(/_/g, ' ').toLowerCase();
  if (normalized.includes('read') && normalized.includes('file')) {
    return 'Gemini CLI: Reading attached video…';
  }
  return `Gemini CLI: ${toolName.replace(/_/g, ' ')}…`;
}

function isFatalGeminiStreamError(message: string): boolean {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(message);
}

function isMissingGeminiSessionError(message: string): boolean {
  return /no previous sessions found/i.test(message);
}

async function streamGeminiChatOnce(
  requestId: string,
  params: CliCopilotChatParams,
  options: {
    canResume: boolean;
    hasVisualRefs: boolean;
    preparedVisualRefs: PreparedCopilotVisualRef[];
  },
): Promise<{ message: string; sessionId?: string; usage?: CliUsageSummary; resumed: boolean }> {
  const binary = await resolveCliBinary('gemini');
  if (!binary) {
    throw new Error('Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli');
  }

  const model = params.model?.trim() || 'gemini-2.5-flash';
  const prompt = options.canResume
    ? buildGeminiResumePrompt(params)
    : buildGeminiPrompt(params);
  const useStdin = prompt.length > PROMPT_STDIN_THRESHOLD;
  const workDir = getGeminiWorkspaceDir();
  await mkdir(workDir, { recursive: true });

  const args = [
    '--skip-trust',
    ...(useStdin ? ['-p', ''] : ['-p', prompt]),
    '-o',
    'stream-json',
    '-m',
    model,
    '--approval-mode',
    options.hasVisualRefs ? 'yolo' : 'default',
  ];

  if (options.hasVisualRefs) {
    args.push('--session-id', crypto.randomUUID());
    const includeDirs = [...new Set(
      options.preparedVisualRefs.map((ref) => path.dirname(ref.mediaPath)),
    )];
    for (const dir of includeDirs) {
      args.push('--include-directories', dir);
    }
  } else if (options.canResume && params.resumeSessionId) {
    args.push('-r', params.resumeSessionId);
  }

  const win = getMainWindow();
  let fullContent = '';
  let stderrBuffer = '';
  let sessionId: string | undefined;
  let usage: CliUsageSummary | undefined;
  const chatTimeoutMs = 15 * 60 * 1000;
  const firstTokenTimeoutMs = options.hasVisualRefs
    ? VISUAL_FIRST_TOKEN_TIMEOUT_MS
    : FIRST_TOKEN_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: buildGeminiCliEnv(),
      cwd: workDir,
      stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    if (useStdin) {
      child.stdin?.write(prompt);
      child.stdin?.end();
    }

    activeRequest = { child, requestId, provider: 'gemini' };

    let lineBuffer = '';
    let settled = false;
    let firstTokenReceived = false;

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(firstTokenTimeoutId);
      cleanupEphemeralVisualRefs(options.preparedVisualRefs);
      handler();
    };

    const timeoutId = setTimeout(() => {
      activeRequest = null;
      child.kill('SIGTERM');
      finish(() => reject(new Error('Gemini CLI timed out after 15 minutes. Try again or switch models.')));
    }, chatTimeoutMs);

    const firstTokenTimeoutId = setTimeout(() => {
      if (firstTokenReceived || settled) return;
      activeRequest = null;
      child.kill('SIGTERM');
      finish(() => reject(new Error(
        options.hasVisualRefs
          ? 'Gemini CLI is still reading the attached video. Try again or use a shorter clip.'
          : 'Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat.',
      )));
    }, firstTokenTimeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();

      let newlineIdx: number;
      while ((newlineIdx = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          const obj = JSON.parse(line) as Record<string, unknown>;

          if (obj.type === 'init' && typeof obj.session_id === 'string') {
            sessionId = obj.session_id;
          }

          const parsedUsage = parseGeminiUsage(obj);
          if (parsedUsage) usage = parsedUsage;

          if (obj.type === 'tool_use') {
            win?.webContents.send('llm:gemini-stream', {
              requestId,
              status: formatGeminiToolStatus(obj.tool_name),
            });
          }

          if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
            const token = obj.content;
            if (token) {
              firstTokenReceived = true;
              fullContent += token;
              win?.webContents.send('llm:gemini-stream', { requestId, token });
            }
          }

          if (obj.type === 'error' && typeof obj.message === 'string') {
            const errorMessage = obj.message;
            stderrBuffer += errorMessage;
            if (!fullContent.trim() && isFatalGeminiStreamError(errorMessage)) {
              activeRequest = null;
              child.kill('SIGTERM');
              finish(() => reject(new Error(stripAnsiCodes(errorMessage))));
            }
          }

          if (obj.type === 'result' && obj.status === 'error') {
            const resultError = typeof obj.error === 'string'
              ? obj.error
              : typeof obj.message === 'string'
                ? obj.message
                : 'Gemini CLI returned an error.';
            stderrBuffer += resultError;
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.on('error', (error) => {
      activeRequest = null;
      finish(() => reject(error));
    });

    child.on('close', (code) => {
      activeRequest = null;
      win?.webContents.send('llm:gemini-stream', { requestId, done: true });

      const trimmed = fullContent.trim();
      if (!trimmed) {
        const errorMessage = stripAnsiCodes(stderrBuffer.trim()) || `Gemini CLI exited with code ${code ?? 'unknown'}`;
        finish(() => reject(new Error(errorMessage)));
        return;
      }

      finish(() => resolve({
        message: trimmed,
        sessionId,
        usage,
        resumed: options.canResume,
      }));
    });
  });
}

async function streamGeminiChat(
  requestId: string,
  params: CliCopilotChatParams,
): Promise<{ message: string; sessionId?: string; usage?: CliUsageSummary; resumed: boolean }> {
  if (!params.userMessage.trim()) {
    throw new Error('No chat message provided.');
  }

  const workDir = getGeminiWorkspaceDir();
  const visualWorkspaceDir = getGeminiVisualWorkspaceDir();
  await mkdir(workDir, { recursive: true });
  await mkdir(visualWorkspaceDir, { recursive: true });
  const preparedVisualRefs = await prepareCopilotVisualRefs(params.visualRefs ?? [], visualWorkspaceDir);
  if ((params.visualRefs ?? []).length > 0 && preparedVisualRefs.length === 0) {
    throw new Error('Could not load the attached /clip or /asset files for Gemini visual analysis. Use local video or image files.');
  }

  const hasVisualRefs = preparedVisualRefs.length > 0;
  const effectiveParams: CliCopilotChatParams = {
    ...params,
    userMessage: buildGeminiUserMessageWithVisualRefs(params.userMessage, preparedVisualRefs),
  };
  const wantsResume = Boolean(params.resumeSessionId) && !params.injectProjectContext && !hasVisualRefs;

  try {
    return await streamGeminiChatOnce(requestId, effectiveParams, {
      canResume: wantsResume,
      hasVisualRefs,
      preparedVisualRefs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!wantsResume || !isMissingGeminiSessionError(message)) {
      throw error;
    }

    return streamGeminiChatOnce(requestId, {
      ...effectiveParams,
      injectProjectContext: !hasVisualRefs,
      contextRefresh: !hasVisualRefs,
      resumeSessionId: undefined,
    }, {
      canResume: false,
      hasVisualRefs,
      preparedVisualRefs,
    });
  }
}

export function registerGeminiCliHandlers(): void {
  ipcMain.handle('llm:gemini-chat', async (_event, params: CliCopilotChatParams) => {
    const requestId = params.requestId || crypto.randomUUID();
    const result = await streamGeminiChat(requestId, params);
    return {
      message: result.message,
      sessionId: result.sessionId,
      resumed: result.resumed,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  });

  ipcMain.handle('llm:gemini-cancel', async (_event, requestId: string) => {
    if (activeRequest?.requestId !== requestId || activeRequest.provider !== 'gemini') return;
    activeRequest.child.kill('SIGTERM');
    activeRequest = null;
  });
}
