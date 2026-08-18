import {
  CLI_LLM_PROVIDER_IDS,
  isCliCopilotProvider,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';

export const DEFAULT_DIRECTOR_LLM: CliLlmProviderId = 'claude-code';

export function parseDirectorLlmProvider(value: unknown): CliLlmProviderId {
  return typeof value === 'string' && isCliCopilotProvider(value) ? value : DEFAULT_DIRECTOR_LLM;
}

export function pickInstalledDirectorLlm(
  preferred: CliLlmProviderId,
  providers: Array<{ id: string; installed: boolean }>,
): CliLlmProviderId {
  const ready = new Set(providers.filter((row) => row.installed).map((row) => row.id));
  if (ready.has(preferred)) return preferred;
  return CLI_LLM_PROVIDER_IDS.find((id) => ready.has(id)) ?? preferred;
}
