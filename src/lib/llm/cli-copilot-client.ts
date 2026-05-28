import type { CliLlmProviderId } from '@/lib/llm/claude-code-session';
import type { CopilotVisualRefInput } from '@/lib/llm/copilot-visual-refs';

export interface CliCopilotChatParams {
  requestId?: string;
  model?: string;
  resumeSessionId?: string;
  injectProjectContext?: boolean;
  contextRefresh?: boolean;
  purpose?: 'copilot' | 'enhance-prompt';
  systemPrompt?: string;
  userMessage: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  visualRefs?: CopilotVisualRefInput[];
}

export interface CliCopilotChatResult {
  message: string;
  sessionId?: string;
  resumed?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
}

export async function invokeCliCopilotChat(
  provider: CliLlmProviderId,
  params: CliCopilotChatParams,
): Promise<CliCopilotChatResult> {
  switch (provider) {
    case 'claude-code':
      return window.electronAPI.llm.claudeCodeChat(params);
    case 'codex':
      return window.electronAPI.llm.codexChat(params);
    case 'gemini':
      return window.electronAPI.llm.geminiChat(params);
    default:
      throw new Error(`Unsupported CLI provider: ${provider satisfies never}`);
  }
}

export interface CliCopilotStreamEvent {
  requestId: string;
  token?: string;
  done?: boolean;
  status?: string;
}

export function subscribeCliCopilotStream(
  provider: CliLlmProviderId,
  handler: (data: CliCopilotStreamEvent) => void,
): () => void {
  switch (provider) {
    case 'claude-code':
      return window.electronAPI.llm.onClaudeCodeStream(handler);
    case 'codex':
      return window.electronAPI.llm.onCodexStream(handler);
    case 'gemini':
      return window.electronAPI.llm.onGeminiStream(handler);
    default:
      return () => {};
  }
}
