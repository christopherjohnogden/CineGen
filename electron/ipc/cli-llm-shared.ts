import { BrowserWindow } from 'electron';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export type CliLlmProviderId = 'claude-code' | 'codex' | 'gemini';

export interface CliUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface CliProviderDetectResult {
  id: CliLlmProviderId;
  installed: boolean;
  path?: string;
  version?: string;
}

export interface CliCopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CliCopilotChatParams {
  requestId?: string;
  model?: string;
  resumeSessionId?: string;
  injectProjectContext?: boolean;
  contextRefresh?: boolean;
  purpose?: 'copilot' | 'enhance-prompt';
  systemPrompt?: string;
  userMessage: string;
  messages?: CliCopilotMessage[];
}

const PROVIDER_BINARIES: Record<CliLlmProviderId, string[]> = {
  'claude-code': [
    path.join(os.homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    'claude',
  ],
  codex: [
    path.join(os.homedir(), '.npm-global/bin/codex'),
    path.join(os.homedir(), '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    'codex',
  ],
  gemini: [
    path.join(os.homedir(), '.npm-global/bin/gemini'),
    path.join(os.homedir(), '.local/bin/gemini'),
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    'gemini',
  ],
};

const binaryCache = new Map<CliLlmProviderId, string | null | undefined>();

export function buildCliPathEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraPaths = [
    path.join(home, '.local/bin'),
    path.join(home, '.npm-global/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const currentPath = process.env.PATH ?? '';
  return {
    ...process.env,
    PATH: [...extraPaths, currentPath].filter(Boolean).join(path.delimiter),
  };
}

export function buildGeminiCliEnv(): NodeJS.ProcessEnv {
  return {
    ...buildCliPathEnv(),
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
    TERM: 'dumb',
    NO_COLOR: '1',
  };
}

export function stripAnsiCodes(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export async function resolveCliBinary(provider: CliLlmProviderId): Promise<string | null> {
  if (binaryCache.has(provider)) {
    return binaryCache.get(provider) ?? null;
  }

  for (const candidate of PROVIDER_BINARIES[provider]) {
    try {
      const { stdout } = await execFileAsync(candidate, ['--version'], {
        env: buildCliPathEnv(),
        timeout: 8000,
      });
      if (stdout.trim()) {
        binaryCache.set(provider, candidate);
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  binaryCache.set(provider, null);
  return null;
}

export async function detectCliProvider(provider: CliLlmProviderId): Promise<CliProviderDetectResult> {
  const binary = await resolveCliBinary(provider);
  if (!binary) {
    return { id: provider, installed: false };
  }

  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      env: buildCliPathEnv(),
      timeout: 8000,
    });
    return {
      id: provider,
      installed: true,
      path: binary,
      version: stdout.trim(),
    };
  } catch {
    return { id: provider, installed: false };
  }
}

export async function detectAllCliProviders(): Promise<CliProviderDetectResult[]> {
  return Promise.all([
    detectCliProvider('claude-code'),
    detectCliProvider('codex'),
    detectCliProvider('gemini'),
  ]);
}

export function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

export function buildConversationPrompt(messages: CliCopilotMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim())
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content.trim()}`)
    .join('\n\n')
    .concat('\n\nAssistant:\n');
}

export const CHAT_ONLY_SUFFIX = [
  'CineGen Copilot chat mode: you are NOT exploring the CineGen source codebase.',
  'The user\'s video-editing project (timelines, clips, transcripts, assets) is provided in ACTIVE PROJECT CONTEXT above — not on disk and not in repo files.',
  'Answer immediately from ACTIVE PROJECT CONTEXT and conversation history. Never search files, run commands, or say "let me look at the project".',
  'Respond in plain text or markdown only. Do not invoke tools, skills, or shell commands.',
].join(' ');

export const COPILOT_RESUME_REMINDER = [
  'CineGen Copilot follow-up: answer from project context already established in this conversation.',
  'Do not search the filesystem or CineGen source code. Timelines and clips are in the prior context, not in repo files.',
  'For clip/timeline lists: numbered list + [timeline:Name / clip:ClipName @ time] citations only — never markdown tables, even when repeating an earlier answer.',
].join(' ');

export const ENHANCE_PROMPT_SUFFIX = [
  'CineGen prompt-rewrite mode: rewrite the user\'s rough Copilot prompt only.',
  'Do NOT answer the prompt or reveal project facts, clip names, durations, or asset IDs.',
  'Do not search files or invoke tools.',
  'Return only the rewritten prompt text.',
].join(' ');

export type ActiveCliRequest = { child: ChildProcess; requestId: string; provider: CliLlmProviderId };
