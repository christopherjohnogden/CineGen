import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
const PROMPT_STDIN_THRESHOLD = 8_000;

function buildGeminiPrompt(params: CliCopilotChatParams): string {
  const systemParts: string[] = [];
  if (params.injectProjectContext && params.systemPrompt?.trim()) {
    const refreshPrefix = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    const suffix = params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
    systemParts.push(`${refreshPrefix}${params.systemPrompt.trim()}\n\n${suffix}`);
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
  const prefix = [params.systemPrompt?.trim(), COPILOT_RESUME_REMINDER].filter(Boolean).join('\n\n');
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
  const label = toolName.replace(/_/g, ' ');
  return `Gemini CLI: ${label}…`;
}

function isFatalGeminiStreamError(message: string): boolean {
  return /malformed tool call|empty response|API Error|INVALID_ARGUMENT/i.test(message);
}

async function streamGeminiChat(
  requestId: string,
  params: CliCopilotChatParams,
): Promise<{ message: string; sessionId?: string; usage?: CliUsageSummary; resumed: boolean }> {
  const binary = await resolveCliBinary('gemini');
  if (!binary) {
    throw new Error('Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli');
  }

  if (!params.userMessage.trim()) {
    throw new Error('No chat message provided.');
  }

  const model = params.model?.trim() || 'gemini-2.5-flash';
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  const prompt = canResume ? buildGeminiResumePrompt(params) : buildGeminiPrompt(params);
  const useStdin = prompt.length > PROMPT_STDIN_THRESHOLD;
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'cinegen-gemini-'));

  const args = [
    '--skip-trust',
    ...(useStdin ? ['-p', ''] : ['-p', prompt]),
    '-o',
    'stream-json',
    '-m',
    model,
    '--approval-mode',
    'default',
  ];

  if (canResume && params.resumeSessionId) {
    args.push('-r', params.resumeSessionId);
  }

  const win = getMainWindow();
  let fullContent = '';
  let stderrBuffer = '';
  let sessionId: string | undefined;
  let usage: CliUsageSummary | undefined;
  const chatTimeoutMs = 15 * 60 * 1000;

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

    const cleanupWorkDir = () => {
      void rm(workDir, { recursive: true, force: true }).catch(() => {});
    };

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(firstTokenTimeoutId);
      cleanupWorkDir();
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
        'Gemini CLI is taking too long to respond. Try gemini-2.5-flash, shorten the question, or start a new chat.',
      )));
    }, FIRST_TOKEN_TIMEOUT_MS);

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
            stderrBuffer += obj.message;
            if (!fullContent.trim() && isFatalGeminiStreamError(obj.message)) {
              activeRequest = null;
              child.kill('SIGTERM');
              finish(() => reject(new Error(stripAnsiCodes(obj.message))));
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

      finish(() => resolve({ message: trimmed, sessionId, usage, resumed: canResume }));
    });
  });
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
