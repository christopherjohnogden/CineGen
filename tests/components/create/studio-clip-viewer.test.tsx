import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { StudioClipViewer, type StudioClipViewerProps } from '@/components/create/studio-clip-viewer';
import type { ClipItem } from '@/lib/studio/clips';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

afterEach(cleanup);

const model = { name: 'Seedance 2.5', outputType: 'video' } as ModelDefinition;

function clip(overrides: Partial<ClipItem> = {}): ClipItem {
  const node = {
    id: 'a',
    type: 'video-one',
    position: { x: 0, y: 0 },
    data: { type: 'video-one', label: 'Video', config: { resolution: '720p', bitrate: 'High' } },
  } as unknown as Node<WorkflowNodeData>;
  return {
    id: 'a',
    node,
    model,
    kind: 'video',
    url: 'local-media://clip.mp4',
    urls: ['local-media://clip.mp4'],
    prompt: 'Style: 8K cinematic. '.repeat(20),
    status: 'complete',
    createdAt: new Date(2026, 7, 20, 23, 13).getTime(),
    liked: false,
    comments: [],
    elementNames: ['Hazmat'],
    isNew: false,
    lastViewed: false,
    ...overrides,
  };
}

function props(overrides: Partial<StudioClipViewerProps> = {}): StudioClipViewerProps {
  return {
    item: clip(),
    index: 0,
    count: 3,
    spaceName: 'Subconscious Mind',
    author: 'You',
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onLike: vi.fn(),
    onDownload: vi.fn(),
    onRecreate: vi.fn(),
    onReference: vi.fn(),
    onExtend: vi.fn(),
    onExtractFrame: vi.fn(),
    onOpenInCanvas: vi.fn(),
    onCopyPrompt: vi.fn(() => true),
    onCopyUrl: vi.fn(),
    onRemove: vi.fn(),
    onReview: vi.fn(),
    onAddComment: vi.fn(),
    ...overrides,
  };
}

describe('StudioClipViewer', () => {
  it('shows the prompt with a copy action, the details, and where the clip is filed', async () => {
    const p = props();
    render(<StudioClipViewer {...p} />);

    const dialog = screen.getByRole('dialog', { name: 'Seedance 2.5 video' });
    expect(within(dialog).getByText('Subconscious Mind')).toBeInTheDocument();
    expect(within(dialog).getByText('Seedance 2.5')).toBeInTheDocument();
    expect(within(dialog).getByText('720p')).toBeInTheDocument();
    expect(within(dialog).getByText('High')).toBeInTheDocument();
    expect(within(dialog).getByText('Hazmat')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();

    // Long prompts are clamped until "See all".
    expect(screen.getByTestId('space-studio-clip-prompt').textContent?.endsWith('…')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /See all/ }));
    expect(screen.getByTestId('space-studio-clip-prompt').textContent?.endsWith('…')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(p.onCopyPrompt).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('recreates, references, likes, and removes after a confirmation', () => {
    const p = props();
    render(<StudioClipViewer {...p} />);

    fireEvent.click(screen.getByRole('button', { name: 'Recreate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(p.onRecreate).toHaveBeenCalled();
    expect(p.onReference).toHaveBeenCalled();
    expect(p.onLike).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(p.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(p.onRemove).toHaveBeenCalled();
  });

  it('sets a status from the transport and the Edit tab routes to the canvas and Extend', () => {
    const p = props();
    render(<StudioClipViewer {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /^Status$/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Needs review' }));
    expect(p.onReview).toHaveBeenCalledWith('needs_review');

    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Canvas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Extend from the last frame' }));
    expect(p.onOpenInCanvas).toHaveBeenCalled();
    expect(p.onExtend).toHaveBeenCalled();
  });

  it('collects comments with the playhead time, and the keyboard navigates and closes', () => {
    const p = props();
    render(<StudioClipViewer {...p} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
    expect(screen.getByText('No comments yet')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a comment' }), { target: { value: 'Hold longer on the diver.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send comment' }));
    expect(p.onAddComment).toHaveBeenCalledWith('Hold longer on the diver.', 0);

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(p.onNavigate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalled();
  });

  it('explains a clip that has no media yet instead of showing an empty player', () => {
    render(<StudioClipViewer {...props({ item: clip({ url: '', urls: [], status: 'error', error: 'Connect your Topview account in Settings before generating.' }) })} />);

    expect(screen.getByText('Connect your Topview account in Settings before generating.')).toBeInTheDocument();
    expect(screen.queryByTestId('space-studio-clip-video')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reference' })).toBeDisabled();
  });
});
