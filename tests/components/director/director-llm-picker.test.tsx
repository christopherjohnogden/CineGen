import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DirectorLlmPicker } from '@/components/director/director-llm-picker';

describe('DirectorLlmPicker', () => {
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
