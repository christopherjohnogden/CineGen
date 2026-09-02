import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioSelectionBar, type StudioSelectionBarProps } from '@/components/create/studio-selection-bar';

afterEach(cleanup);

function props(overrides: Partial<StudioSelectionBarProps> = {}): StudioSelectionBarProps {
  return {
    count: 2,
    previewUrl: 'local-media://a.png',
    previewKind: 'image',
    allLiked: false,
    onDownload: vi.fn(),
    onLike: vi.fn(),
    onRemove: vi.fn(),
    onCopyPrompts: vi.fn(),
    onReview: vi.fn(),
    onOpenInCanvas: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

describe('StudioSelectionBar', () => {
  it('names the selection and runs the direct actions', () => {
    const p = props();
    render(<StudioSelectionBar {...p} />);

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(p.onDownload).toHaveBeenCalled();
    expect(p.onLike).toHaveBeenCalled();
    expect(p.onClear).toHaveBeenCalled();
  });

  it('asks before removing, and the count is in the question', () => {
    const p = props({ count: 3 });
    render(<StudioSelectionBar {...p} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
    expect(p.onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Remove 3 clips?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Remove 3 clips?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(p.onRemove).toHaveBeenCalled();
  });

  it('offers prompts, a status for every selected clip, and the canvas only for a single clip', () => {
    const p = props({ count: 1 });
    render(<StudioSelectionBar {...p} />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy prompts' }));
    expect(p.onCopyPrompts).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Needs review' }));
    expect(p.onReview).toHaveBeenCalledWith('needs_review');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Open in Canvas' })).toBeInTheDocument();

    cleanup();
    render(<StudioSelectionBar {...props({ count: 2 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Open in Canvas' })).not.toBeInTheDocument();
  });
});
