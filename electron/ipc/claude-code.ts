import { ipcMain, BrowserWindow } from 'electron';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

interface ClaudeCodeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ClaudeCodeChatParams {
  requestId?: string;
  model?: string;
  resumeSessionId?: string;
  injectProjectContext?: boolean;
  contextRefresh?: boolean;
  purpose?: 'copilot' | 'enhance-prompt';
  systemPrompt?: string;
  userMessage: string;
  messages?: ClaudeCodeMessage[];
}

const CLAUDE_CANDIDATES = [
  path.join(os.homedir(), '.local/bin/claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  'claude',
];

const CHAT_ONLY_SUFFIX = [
  'CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.',
  'The user\'s video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.',
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  'Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands.',
].join(' ');

const COPILOT_RESUME_REMINDER = [
  'CineGen Copilot follow-up: answer from project context already established in this conversation.',
  'Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.',
  'For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer.',
].join(' ');

const ENHANCE_PROMPT_SUFFIX = [
  'CineGen prompt-rewrite mode: rewrite the user\'s rough Copilot prompt only.',
  'Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.',
  'Do not search files or invoke tools.',
  'Return only the rewritten prompt text.',
].join(' ');

const CHAT_DISALLOWED_TOOLS = [
  'Bash',
  'Edit',
  'Read',
  'Write',
  'Glob',
  'Grep',
  'Skill',
  'WebFetch',
  'WebSearch',
  'Task',
  'NotebookEdit',
].join(',');

let cachedBinary: string | null | undefined;
let activeRequest: { child: ChildProcess; requestId: string } | null = null;

function buildPathEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraPaths = [
    path.join(home, '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const currentPath = process.env.PATH ?? '';
  return {
    ...process.env,
    PATH: [...extraPaths, currentPath].filter(Boolean).join(path.delimiter),
  };
}

async function resolveClaudeBinary(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;

  for (const candidate of CLAUDE_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, ['--version'], {
        env: buildPathEnv(),
        timeout: 8000,
      });
      if (stdout.toLowerCase().includes('claude')) {
        cachedBinary = candidate;
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  cachedBinary = null;
  return null;
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

function buildConversationPrompt(messages: ClaudeCodeMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim())
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content.trim()}`)
    .join('\n\n')
    .concat('\n\nAssistant:\n');
}

interface ClaudeCodeUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

function parseClaudeCodeUsage(obj: Record<string, unknown>): ClaudeCodeUsageSummary | undefined {
  const usageRaw = obj.usage as Record<string, unknown> | undefined;
  if (!usageRaw || typeof usageRaw !== 'object') return undefined;

  const inputTokens = Number(usageRaw.input_tokens) || 0;
  const cacheCreation = Number(usageRaw.cache_creation_input_tokens) || 0;
  const cacheRead = Number(usageRaw.cache_read_input_tokens) || 0;
  const promptTokens = inputTokens + cacheCreation + cacheRead;
  const completionTokens = Number(usageRaw.output_tokens) || 0;
  const totalTokens = promptTokens + completionTokens;
  const cost = Number(obj.total_cost_usd) || 0;

  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 && cost <= 0) {
    return undefined;
  }

  return { promptTokens, completionTokens, totalTokens, cost };
}

function extractStreamToken(obj: Record<string, unknown>): string {
  if (obj.type === 'stream_event') {
    const event = obj.event as Record<string, unknown> | undefined;
    const delta = event?.delta as { type?: string; text?: string } | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return delta.text;
    }
  }

  if (obj.type === 'assistant') {
    const message = obj.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
    return (message?.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
  }

  if (obj.type === 'result' && typeof obj.result === 'string') {
    return obj.result;
  }

  return '';
}

function buildPrompt(params: ClaudeCodeChatParams): string {
  if (params.injectProjectContext) {
    const history = (params.messages ?? []).filter((message) => message.content.trim());
    if (history.length > 0) {
      return buildConversationPrompt(history);
    }
  }
  return `${params.userMessage.trim()}\n\nAssistant:\n`;
}

async function streamClaudeCodeChat(
  requestId: string,
  params: ClaudeCodeChatParams,
): Promise<{ message: string; sessionId?: string; usage?: ClaudeCodeUsageSummary; resumed: boolean }> {
  const binary = await resolveClaudeBinary();
  if (!binary) {
    throw new Error('Claude Code is not installed. Install it from https://code.claude.com');
  }

  if (!params.userMessage.trim()) {
    throw new Error('No chat message provided.');
  }

  const model = params.model?.trim() || 'sonnet';
  const canResume = Boolean(params.resumeSessionId) && !params.injectProjectContext;

  const args = [
    '-p',
    canResume ? params.userMessage.trim() : buildPrompt(params),
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns',
    '1',
    '--model',
    model,
    '--disallowed-tools',
    CHAT_DISALLOWED_TOOLS,
  ];

  if (canResume && params.resumeSessionId) {
    args.push('--resume', params.resumeSessionId);
    args.push('--append-system-prompt', COPILOT_RESUME_REMINDER);
  } else if (params.injectProjectContext && params.systemPrompt?.trim()) {
    const refreshPrefix = params.contextRefresh
      ? 'The CineGen project has changed since the last context injection. Replace any stale project facts with this refreshed context.\n\n'
      : '';
    const suffix = params.purpose === 'enhance-prompt' ? ENHANCE_PROMPT_SUFFIX : CHAT_ONLY_SUFFIX;
    args.push('--append-system-prompt', `${refreshPrefix}${params.systemPrompt.trim()}\n\n${suffix}`);
  }

  const win = getMainWindow();
  let fullContent = '';
  let stderrBuffer = '';
  let sessionId: string | undefined;
  let authFailed = false;
  let sawStreamDelta = false;
  let usage: ClaudeCodeUsageSummary | undefined;

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: buildPathEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeRequest = { child, requestId };

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

          if (obj.type === 'system' && obj.subtype === 'init' && typeof obj.session_id === 'string') {
            sessionId = obj.session_id;
          }

          if (obj.type === 'assistant' && obj.error === 'authentication_failed') {
            authFailed = true;
          }

          const parsedUsage = parseClaudeCodeUsage(obj);
          if (parsedUsage) {
            usage = parsedUsage;
          } else if (obj.type === 'assistant') {
            const message = obj.message as { usage?: Record<string, unknown> } | undefined;
            if (message?.usage) {
              const assistantUsage = parseClaudeCodeUsage({ usage: message.usage });
              if (assistantUsage) usage = assistantUsage;
            }
          }

          const token = extractStreamToken(obj);
          if (!token) continue;

          if (obj.type === 'stream_event') {
            sawStreamDelta = true;
            fullContent += token;
            win?.webContents.send('llm:claude-code-stream', { requestId, token });
            continue;
          }

          if (obj.type === 'assistant' && !sawStreamDelta) {
            fullContent = token;
            win?.webContents.send('llm:claude-code-stream', { requestId, token });
          } else if (obj.type === 'result' && !fullContent.trim()) {
            fullContent = token;
            win?.webContents.send('llm:claude-code-stream', { requestId, token });
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
      win?.webContents.send('llm:claude-code-stream', { requestId, done: true });

      const trimmed = fullContent.trim();
      if (authFailed || trimmed.includes('Not logged in')) {
        reject(new Error('Claude Code is not logged in. Open Terminal, run `claude`, and sign in with your subscription.'));
        return;
      }

      if (!trimmed) {
        reject(new Error(stderrBuffer.trim() || `Claude Code exited with code ${code ?? 'unknown'}`));
        return;
      }

      resolve({ message: trimmed, sessionId, usage, resumed: canResume });
    });
  });
}

export function registerClaudeCodeHandlers(): void {
  ipcMain.handle('llm:claude-code-detect', async () => {
    const binary = await resolveClaudeBinary();
    if (!binary) {
      return { installed: false as const };
    }

    try {
      const { stdout } = await execFileAsync(binary, ['--version'], {
        env: buildPathEnv(),
        timeout: 8000,
      });
      return {
        installed: true as const,
        path: binary,
        version: stdout.trim(),
      };
    } catch {
      return { installed: false as const };
    }
  });

  ipcMain.handle('llm:claude-code-chat', async (_event, params: ClaudeCodeChatParams) => {
    const requestId = params.requestId || crypto.randomUUID();
    const result = await streamClaudeCodeChat(requestId, params);
    return {
      message: result.message,
      sessionId: result.sessionId,
      resumed: result.resumed,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  });

  ipcMain.handle('llm:claude-code-cancel', async (_event, requestId: string) => {
    if (activeRequest?.requestId !== requestId) return;
    activeRequest.child.kill('SIGTERM');
    activeRequest = null;
  });
}
