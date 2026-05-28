import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import {
  buildCliPathEnv,
  buildConversationPrompt,
  CHAT_ONLY_SUFFIX,
  ENHANCE_PROMPT_SUFFIX,
  getMainWindow,
  resolveCliBinary,
  type ActiveCliRequest,
  type CliCopilotChatParams,
  type CliUsageSummary,
} from './cli-llm-shared.js';

let activeRequest: ActiveCliRequest | null = null;

function buildCodexPrompt(params: CliCopilotChatParams): string {
  const systemParts: string[] = [];
  if (params.injectProjectContext && params.systemPrompt?.trim()) {
    const refreshPrefix = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    const suffix = params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
    systemParts.push(`${refreshPrefix}${params.systemPrompt.trim()}\n\n${suffix}`);
  }

  const history = (params.messages ?? []).filter((message) => message.content.trim());
  const conversation = history.length > 0
    ? buildConversationPrompt(history)
    : `${params.userMessage.trim()}\n\nAssistant:\n`;

  return systemParts.length > 0 ? `${systemParts.join('\n\n')}\n\n${conversation}` : params.userMessage.trim();
}

function parseCodexUsage(obj: Record<string, unknown>): CliUsageSummary | undefined {
  const usageRaw = obj.usage as Record<string, unknown> | undefined;
  if (!usageRaw) return undefined;

  const inputTokens = Number(usageRaw.input_tokens) || 0;
  const cachedInput = Number(usageRaw.cached_input_tokens) || 0;
  const promptTokens = inputTokens + cachedInput;
  const completionTokens = Number(usageRaw.output_tokens) || 0;
  const totalTokens = promptTokens + completionTokens;
  if (totalTokens <= 0) return undefined;

  return { promptTokens, completionTokens, totalTokens, cost: 0 };
}

function extractCodexAgentText(obj: Record<string, unknown>): string {
  if (obj.type !== 'item.completed' && obj.type !== 'item.updated') return '';

  const item = obj.item as { type?: string; text?: string } | undefined;
  if (item?.type === 'agent_message' && typeof item.text === 'string') {
    return item.text;
  }
  return '';
}

async function streamCodexChat(
  requestId: string,
  params: CliCopilotChatParams,
): Promise<{ message: string; sessionId?: string; usage?: CliUsageSummary; resumed: boolean }> {
  const binary = await resolveCliBinary('codex');
  if (!binary) {
    throw new Error('Codex CLI is not installed. Install it from https://developers.openai.com/codex');
  }

  if (!params.userMessage.trim()) {
    throw new Error('No chat message provided.');
  }

  const model = params.model?.trim() || 'gpt-5.3-codex';
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;
  const args = ['exec'];

  if (canResume && params.resumeSessionId) {
    args.push('resume', params.resumeSessionId, params.userMessage.trim());
  } else {
    args.push(buildCodexPrompt(params));
  }

  args.push(
    '--json',
    '-s',
    'read-only',
    '-m',
    model,
    '--skip-git-repo-check',
  );

  const win = getMainWindow();
  let fullContent = '';
  let stderrBuffer = '';
  let sessionId: string | undefined;
  let usage: CliUsageSummary | undefined;
  let lastAgentText = '';

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: buildCliPathEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeRequest = { child, requestId, provider: 'codex' };

    let lineBuffer = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();

      let newlineIdx: number;
      while ((newlineIdx = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          const obj = JSON.parse(line) as Record<string, unknown>;

          if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
            sessionId = obj.thread_id;
          }

          const parsedUsage = parseCodexUsage(obj);
          if (parsedUsage) usage = parsedUsage;

          if (obj.type === 'turn.failed') {
            const error = obj.error as { message?: string } | undefined;
            stderrBuffer += error?.message ?? 'Codex turn failed.';
          }

          const agentText = extractCodexAgentText(obj);
          if (agentText) {
            const delta = agentText.startsWith(lastAgentText)
              ? agentText.slice(lastAgentText.length)
              : agentText;
            lastAgentText = agentText;
            fullContent = agentText;
            if (delta) {
              win?.webContents.send('llm:codex-stream', { requestId, token: delta });
            }
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
      reject(error);
    });

    child.on('close', (code) => {
      activeRequest = null;
      win?.webContents.send('llm:codex-stream', { requestId, done: true });

      const trimmed = fullContent.trim();
      if (!trimmed) {
        reject(new Error(stderrBuffer.trim() || `Codex exited with code ${code ?? 'unknown'}`));
        return;
      }

      resolve({ message: trimmed, sessionId, usage, resumed: canResume });
    });
  });
}

export function registerCodexCliHandlers(): void {
  ipcMain.handle('llm:codex-chat', async (_event, params: CliCopilotChatParams) => {
    const requestId = params.requestId || crypto.randomUUID();
    const result = await streamCodexChat(requestId, params);
    return {
      message: result.message,
      sessionId: result.sessionId,
      resumed: result.resumed,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  });

  ipcMain.handle('llm:codex-cancel', async (_event, requestId: string) => {
    if (activeRequest?.requestId !== requestId || activeRequest.provider !== 'codex') return;
    activeRequest.child.kill('SIGTERM');
    activeRequest = null;
  });
}
