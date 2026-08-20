import {
  CLI_LLM_PROVIDER_IDS,
  isCliCopilotProvider,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';

/** Director jobs run on a local CLI, fal.ai's any-llm endpoint, Higgsfield's llm_text model,
 *  ChatGPT Luna (Codex CLI), or OpenAI Luna (API key, gpt-5.6-luna). */
export type DirectorLlmProvider = CliLlmProviderId | 'luna' | 'openai' | 'fal' | 'higgsfield';

export const DEFAULT_DIRECTOR_LLM: DirectorLlmProvider = 'claude-code';

/** The any-llm model director jobs use when the provider is 'fal'. */
export const FAL_DIRECTOR_LLM_MODEL = 'google/gemini-2.5-flash';
export const FAL_DIRECTOR_LLM_LABEL = 'fal.ai — Gemini 2.5 Flash';

/** ChatGPT's cheap GPT-5.6 tier. Codex CLI Luna uses ChatGPT quota; OpenAI Luna uses an API key. */
export const LUNA_DIRECTOR_LLM_MODEL = 'gpt-5.6-luna';
export const LUNA_DIRECTOR_LLM_LABEL = 'ChatGPT Luna';
export const OPENAI_DIRECTOR_LLM_LABEL = 'OpenAI Luna';

/** The llm_text model director jobs use when the provider is 'higgsfield'. */
export const HIGGSFIELD_DIRECTOR_LLM_MODEL = 'gpt-5-mini';
export const HIGGSFIELD_DIRECTOR_LLM_LABEL = 'Higgsfield — GPT-5 mini';

/** Whether the installed Higgsfield CLI generation can run llm_text end to end.
 *  As of CLI 1.1.23 it cannot: the v2 alpha generate path refuses to submit
 *  llm_text, and pre-1.x builds submitted it but never printed the answer.
 *  Flip this when Higgsfield ships CLI LLM support — the picker, auto-pick and
 *  job runner all read it. */
export const HIGGSFIELD_LLM_CLI_SUPPORTED = false;

/** Availability of the non-CLI providers, from Settings / account status. */
export interface DirectorLlmReadiness {
  falReady?: boolean;
  openaiReady?: boolean;
  higgsfieldReady?: boolean;
}

export function isDirectorLlmProvider(value: unknown): value is DirectorLlmProvider {
  return value === 'fal' || value === 'higgsfield' || value === 'luna' || value === 'openai'
    || (typeof value === 'string' && isCliCopilotProvider(value));
}

export function parseDirectorLlmProvider(value: unknown): DirectorLlmProvider {
  return isDirectorLlmProvider(value) ? value : DEFAULT_DIRECTOR_LLM;
}

/** Local CLI binary that actually runs the job. Hosted picks have no CLI. */
export function cliTransportFor(provider: DirectorLlmProvider): CliLlmProviderId | null {
  if (provider === 'fal' || provider === 'higgsfield' || provider === 'openai') return null;
  if (provider === 'luna') return 'codex';
  return provider;
}

/** Hosted APIs can run several scene/slice jobs at once; local CLIs stay gated to 1. */
export function directorShotlistParallel(provider: DirectorLlmProvider): boolean {
  return provider === 'fal' || provider === 'openai';
}

/** The CLI to use for CLI-only surfaces (script chat) when the director LLM is hosted. */
export function cliProviderFor(provider: DirectorLlmProvider): CliLlmProviderId {
  return cliTransportFor(provider) ?? 'claude-code';
}

export function pickInstalledDirectorLlm(
  preferred: DirectorLlmProvider,
  providers: Array<{ id: string; installed: boolean }>,
  readiness: DirectorLlmReadiness = {},
): DirectorLlmProvider {
  const ready = new Set(providers.filter((row) => row.installed).map((row) => row.id));
  if (preferred === 'fal') {
    if (readiness.falReady) return preferred;
  } else if (preferred === 'openai') {
    if (readiness.openaiReady) return preferred;
  } else if (preferred === 'higgsfield') {
    if (readiness.higgsfieldReady) return preferred;
  } else if (preferred === 'luna') {
    if (ready.has('codex')) return preferred;
  } else if (ready.has(preferred)) {
    return preferred;
  }
  return CLI_LLM_PROVIDER_IDS.find((id) => ready.has(id))
    ?? (readiness.falReady ? 'fal'
      : readiness.openaiReady ? 'openai'
      : readiness.higgsfieldReady ? 'higgsfield'
      : preferred);
}
