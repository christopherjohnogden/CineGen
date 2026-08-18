import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/home/home-view', () => ({
  HomeView: ({ onOpenProject }: { onOpenProject: (id: string, useSqlite: boolean) => void }) => (
    <section aria-label="project manager">
      <button type="button" onClick={() => onOpenProject('project-42', true)}>
        Open project
      </button>
    </section>
  ),
}));

vi.mock('../../src/components/workspace/workspace-shell', () => ({
  WorkspaceShell: ({
    projectId,
    useSqlite,
    onBackToHome,
  }: {
    projectId: string;
    useSqlite?: boolean;
    onBackToHome: () => void;
  }) => (
    <section aria-label="workspace" data-project-id={projectId} data-use-sqlite={String(useSqlite)}>
      <button type="button" onClick={onBackToHome}>Back to projects</button>
    </section>
  ),
}));

import { WebApp } from '../src/WebApp';

describe('WebApp', () => {
  it('opens a shared workspace in the same React tree and returns home', () => {
    render(<WebApp />);

    expect(screen.getByRole('region', { name: 'project manager' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'workspace' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

    const workspace = screen.getByRole('region', { name: 'workspace' });
    expect(workspace).toHaveAttribute('data-project-id', 'project-42');
    expect(workspace).toHaveAttribute('data-use-sqlite', 'true');
    expect(screen.queryByRole('region', { name: 'project manager' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));

    expect(screen.getByRole('region', { name: 'project manager' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'workspace' })).not.toBeInTheDocument();
  });
});
