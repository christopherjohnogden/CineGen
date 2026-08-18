import {
  CLI_LLM_PROVIDER_IDS,
  getCliProviderLabel,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';

export interface DirectorCliInfo {
  id: CliLlmProviderId;
  installed: boolean;
}

interface DirectorLlmPickerProps {
  provider: CliLlmProviderId;
  providers: Record<CliLlmProviderId, DirectorCliInfo>;
  onChange: (provider: CliLlmProviderId) => void;
}

export function DirectorLlmPicker({ provider, providers, onChange }: DirectorLlmPickerProps) {
  const anyInstalled = CLI_LLM_PROVIDER_IDS.some((id) => providers[id]?.installed);
  return (
    <label className="director-tab__llm">
      <span className="director-tab__label">LLM</span>
      <select
        id="director-llm"
        value={provider}
        onChange={(event) => onChange(event.target.value as CliLlmProviderId)}
      >
        {CLI_LLM_PROVIDER_IDS.map((id) => (
          <option key={id} value={id} disabled={!providers[id]?.installed}>
            {getCliProviderLabel(id)}{providers[id]?.installed ? '' : ' — not installed'}
          </option>
        ))}
      </select>
      {!anyInstalled && (
        <span className="director-tab__meta">Install Claude, Codex, or Gemini CLI, then restart CineGen.</span>
      )}
    </label>
  );
}
