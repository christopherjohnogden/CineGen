import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from '@/components/assistant/assistant-markdown';

describe('AssistantMarkdown', () => {
  it('renders structured responses with consistent rich-response classes', () => {
    const { container } = render(
      <AssistantMarkdown>{[
        '## Coverage plan',
        '',
        'Keep the **close-up** for the turn.',
        '',
        '- Establish geography',
        '- Protect the reaction',
        '',
        '1. Shoot the wide',
        '2. Move into coverage',
        '',
        '| Shot | Purpose |',
        '| --- | --- |',
        '| Wide | Geography |',
        '',
        '> Hold for one extra beat.',
        '',
        '- [x] Blocking approved',
        '',
        'Use `SC2` and [open the reference](https://example.com/reference).',
        '',
        '```text',
        'INT. EDIT SUITE - NIGHT',
        '```',
      ].join('\n')}</AssistantMarkdown>,
    );

    expect(screen.getByRole('heading', { name: 'Coverage plan' })).toHaveClass('copilot__md-h--2');
    expect(container.querySelector('.copilot__md-ul')).toBeInTheDocument();
    expect(container.querySelector('.copilot__md-ol')).toBeInTheDocument();
    expect(container.querySelector('.copilot__md-table-wrap')).toBeInTheDocument();
    expect(container.querySelector('.copilot__md-blockquote')).toBeInTheDocument();
    expect(container.querySelector("input[type='checkbox']")).toBeChecked();
    expect(container.querySelector('.copilot__md-code')).toHaveTextContent('SC2');
    expect(container.querySelector('.copilot__md-pre')).toHaveTextContent('INT. EDIT SUITE - NIGHT');
    expect(screen.getByRole('link', { name: 'open the reference' })).toHaveAttribute('target', '_blank');
  });
});
