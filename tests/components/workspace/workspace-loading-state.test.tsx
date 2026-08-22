import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceLoadingState } from '@/components/workspace/workspace-loading-state';

describe('WorkspaceLoadingState', () => {
  it('describes what is being restored without showing an empty-project action', () => {
    render(<WorkspaceLoadingState />);

    expect(screen.getByRole('status', { name: 'Loading project' })).toBeInTheDocument();
    expect(screen.getByText('Restoring your script, shots, media, and edits')).toBeInTheDocument();
    expect(screen.queryByText('Start your script')).not.toBeInTheDocument();
  });

  it('shows a recoverable load error', () => {
    const retry = vi.fn();
    render(<WorkspaceLoadingState error="Cloud connection was interrupted." onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Cloud connection was interrupted.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
