import { getCliProviderLabel, getDefaultModelForCliProvider, type CliLlmProviderId } from '@/lib/llm/claude-code-session';
import { cancelCliCopilotChat, invokeCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import { extractJsonValue } from './llm-jobs';

export const DIRECTOR_CLI_TIMEOUT_MS = 120_000;

export function directorCliJobPrompt(systemPrompt: string, userPrompt: string): {
  systemPrompt: string;
  userMessage: string;
} {
  return {
    systemPrompt: `${systemPrompt.trim()}\n\nReturn ONLY a JSON object. No markdown fences, no preamble, no tools, no file search.`,
    userMessage: userPrompt.trim(),
  };
}

export async function runDirectorJsonJob(
  systemPrompt: string,
  userPrompt: string,
  provider: CliLlmProviderId,
  requestId = crypto.randomUUID(),
): Promise<unknown> {
  const prompt = directorCliJobPrompt(systemPrompt, userPrompt);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      void cancelCliCopilotChat(provider, requestId);
      reject(new Error('Timed out waiting for the CLI. Cancel and try again, or pick another CLI.'));
    }, DIRECTOR_CLI_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      invokeCliCopilotChat(provider, {
        requestId,
        model: getDefaultModelForCliProvider(provider),
        injectProjectContext: false,
        systemPrompt: prompt.systemPrompt,
        userMessage: `${prompt.systemPrompt}\n\n${prompt.userMessage}`,
      }),
      timedOut,
    ]);
    return extractJsonValue(response.message ?? '');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Director LLM job failed.';
    throw new Error(`${getCliProviderLabel(provider)}: ${detail}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
