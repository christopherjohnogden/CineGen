import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectorLlmPicker } from '@/components/director/director-llm-picker';

describe('DirectorLlmPicker', () => {
  afterEach(cleanup);
  it('shows signed-out providers as unavailable, including the Codex Luna alias', () => {
    render(<DirectorLlmPicker provider="codex" providers={{
      'claude-code': { id: 'claude-code', installed: true, authenticated: false },
      codex: { id: 'codex', installed: true, authenticated: false },
      gemini: { id: 'gemini', installed: false },
    }} falReady={false} openaiReady={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Codex/i }));
    expect(screen.getByRole('option', { name: /Claude Code.*Sign in required/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Codex.*Sign in required/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: /ChatGPT Luna.*Sign in/i })).toBeDisabled();
  });
  it('shows writing LLMs without listing video generation providers', () => {
    render(
      <DirectorLlmPicker
        provider="claude-code"
        providers={{
          'claude-code': { id: 'claude-code', installed: true },
          codex: { id: 'codex', installed: true },
          gemini: { id: 'gemini', installed: true },
        }}
        falReady
        openaiReady
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Claude Code/i }));
    expect(screen.getByRole('option', { name: /Claude Code/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Higgsfield/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Artlist/i })).not.toBeInTheDocument();
  });
});
