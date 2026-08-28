import { useEffect, useRef, useState } from 'react';
import {
  CLI_LLM_PROVIDER_IDS,
  getCliProviderLabel,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';
import type { DirectorLlmProvider } from '@/lib/director/cli-provider';

export interface DirectorCliInfo {
  id: CliLlmProviderId;
  installed: boolean;
}

interface DirectorLlmPickerProps {
  provider: DirectorLlmProvider;
  providers: Record<CliLlmProviderId, DirectorCliInfo>;
  /** True when a fal.ai API key is configured in Settings. */
  falReady: boolean;
  /** True when an OpenAI API key is configured in Settings. */
  openaiReady: boolean;
  onChange: (provider: DirectorLlmProvider) => void;
  title?: string;
  menuLabel?: string;
}

interface LlmOption {
  id: DirectorLlmProvider;
  name: string;
  sub: string;
  disabled: boolean;
}

export function DirectorLlmPicker({
  provider, providers, falReady, openaiReady, onChange,
  title = 'LLM used for breakdown, shotlist, look bible and rewrites',
  menuLabel = 'Director LLM',
}: DirectorLlmPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const options: LlmOption[] = [
    ...CLI_LLM_PROVIDER_IDS.map((id) => ({
      id: id as DirectorLlmProvider,
      name: getCliProviderLabel(id),
      sub: providers[id]?.installed ? 'Local CLI' : 'Not installed',
      disabled: !providers[id]?.installed,
    })),
    {
      id: 'luna' as const,
      name: 'ChatGPT Luna',
      sub: providers.codex?.installed ? 'GPT-5.6 · ChatGPT Codex quota' : 'Install Codex CLI',
      disabled: !providers.codex?.installed,
    },
    {
      id: 'openai' as const,
      name: 'OpenAI Luna',
      sub: openaiReady ? 'GPT-5.6 · API · cheap' : 'Add OpenAI key in Settings',
      disabled: !openaiReady,
    },
    {
      id: 'fal' as const,
      name: 'fal.ai',
      sub: falReady ? 'Gemini 2.5 Flash · hosted' : 'Add fal key in Settings',
      disabled: !falReady,
    },
  ];
  const current = options.find((option) => option.id === provider) ?? options[0];
  const anyReady = options.some((option) => !option.disabled);

  return (
    <div className="dllm" ref={rootRef}>
      <button
        type="button"
        className={`dllm-trigger${open ? ' dllm-trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`dllm-dot${current.disabled ? ' dllm-dot--off' : ''}`} aria-hidden />
        <span className="dllm-trigger-name">{current.name}</span>
        <svg className="dllm-chev" width="9" height="6" viewBox="0 0 9 6" aria-hidden>
          <path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="dllm-menu" role="listbox" aria-label={menuLabel}>
          <div className="dllm-menu-head">{menuLabel}</div>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === provider}
              className={`dllm-item${option.id === provider ? ' dllm-item--active' : ''}`}
              disabled={option.disabled}
              onClick={() => { onChange(option.id); setOpen(false); }}
            >
              <span className={`dllm-dot${option.disabled ? ' dllm-dot--off' : ''}`} aria-hidden />
              <span className="dllm-item-text">
                <span className="dllm-item-name">{option.name}</span>
                <span className="dllm-item-sub">{option.sub}</span>
              </span>
              {option.id === provider && <span className="dllm-check" aria-hidden>✓</span>}
            </button>
          ))}
          {!anyReady && (
            <div className="dllm-menu-foot">Install Claude, Codex, or Gemini CLI — or add a fal.ai / OpenAI key.</div>
          )}
        </div>
      )}
    </div>
  );
}
