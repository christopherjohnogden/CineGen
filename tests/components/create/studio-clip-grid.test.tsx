import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { StudioClipGrid, type StudioClipGridActions } from '@/components/create/studio-clip-grid';
import type { ClipItem } from '@/lib/studio/clips';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

afterEach(cleanup);

const videoModel = { name: 'Seedance 2.5', outputType: 'video' } as ModelDefinition;
const imageModel = { name: 'Seedream 4.5', outputType: 'image' } as ModelDefinition;

function clip(overrides: Partial<ClipItem> & { id: string }): ClipItem {
  const node = {
    id: overrides.id,
    type: 'video-one',
    position: { x: 0, y: 0 },
    data: { type: 'video-one', label: 'Video', config: {} },
  } as unknown as Node<WorkflowNodeData>;
  return {
    node,
    model: videoModel,
    kind: 'video',
    url: 'local-media://clip.mp4',
    urls: ['local-media://clip.mp4'],
    prompt: 'Push in on the diver.',
    status: 'complete',
    createdAt: Date.now(),
    liked: false,
    comments: [],
    elementNames: [],
    isNew: false,
    lastViewed: false,
    ...overrides,
  };
}

function actions(): StudioClipGridActions {
  return {
    onOpen: vi.fn(),
    onLike: vi.fn(),
    onDownload: vi.fn(),
    onRecreate: vi.fn(),
    onReference: vi.fn(),
    onExtractFrame: vi.fn(),
    onOpenInCanvas: vi.fn(),
    onCopyPrompt: vi.fn(),
    onCopyUrl: vi.fn(),
    onRemove: vi.fn(),
    onReview: vi.fn(),
  };
}

describe('StudioClipGrid', () => {
  it('shows how long a render has been going, and no New badge until it lands', () => {
    const started = Date.now() - 271_000;
    render(<StudioClipGrid
      items={[clip({ id: 'busy', status: 'running', url: '', urls: [], startedAt: started, isNew: true })]}
      cardSize="m"
      {...actions()}
    />);

    const tile = screen.getByTestId('space-studio-tile-busy');
    expect(within(tile).getByText('Generating…')).toBeInTheDocument();
    expect(screen.getByTestId('space-studio-elapsed-busy')).toHaveTextContent('4:31');
    // A tile cannot honestly be both "Generating…" and "New".
    expect(within(tile).queryByText('New')).not.toBeInTheDocument();
  });

  it('drops the clock once the clip is ready', () => {
    render(<StudioClipGrid items={[clip({ id: 'done', startedAt: Date.now() - 60_000 })]} cardSize="m" {...actions()} />);
    expect(screen.queryByTestId('space-studio-elapsed-done')).not.toBeInTheDocument();
  });

  it('renders one tile per clip with a New badge on unseen ones and a play glyph on videos', () => {
    render(<StudioClipGrid items={[clip({ id: 'a', isNew: true }), clip({ id: 'b', kind: 'image', model: imageModel, url: 'local-media://still.png' })]} cardSize="m" {...actions()} />);

    const first = screen.getByTestId('space-studio-tile-a');
    expect(within(first).getByText('New')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Open Seedance 2.5 video' })).toBeInTheDocument();
    const second = screen.getByTestId('space-studio-tile-b');
    expect(within(second).queryByText('New')).not.toBeInTheDocument();
    expect(second.querySelector('img')).toHaveAttribute('src', 'local-media://still.png');
  });

  it('opens on a tap of the media, while the hover actions act without opening', () => {
    const handlers = actions();
    render(<StudioClipGrid items={[clip({ id: 'a' })]} cardSize="m" {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Seedance 2.5 video' }));
    expect(handlers.onOpen).toHaveBeenCalledWith('a');

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recreate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
    expect(handlers.onLike).toHaveBeenCalledWith('a');
    expect(handlers.onDownload).toHaveBeenCalledWith('a');
    expect(handlers.onRecreate).toHaveBeenCalledWith('a');
    expect(handlers.onReference).toHaveBeenCalledWith('a');
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers the full action menu and asks before removing', () => {
    const handlers = actions();
    render(<StudioClipGrid items={[clip({ id: 'a' })]} cardSize="m" {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'Clip actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Extract start frame' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit video' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Extract last frame' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Open in Canvas' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Copy video URL' })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Extract last frame' }));
    expect(handlers.onExtractFrame).toHaveBeenCalledWith('a', 'end');

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(handlers.onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Remove this generation?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(handlers.onRemove).toHaveBeenCalledWith('a');
  });

  it('offers Edit video on a clip when the composer can edit', () => {
    const handlers = { ...actions(), onEditVideo: vi.fn() };
    render(<StudioClipGrid items={[clip({ id: 'a' })]} cardSize="m" {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Clip actions' })).getByRole('menuitem', { name: 'Edit video' }));
    expect(handlers.onEditVideo).toHaveBeenCalledWith('a');
  });

  it('sets a review status from the tile pill', () => {
    const handlers = actions();
    render(<StudioClipGrid items={[clip({ id: 'a' })]} cardSize="m" {...handlers} />);

    fireEvent.click(screen.getByRole('button', { name: 'No status' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Approved' }));
    expect(handlers.onReview).toHaveBeenCalledWith('a', 'approved');
  });

  it('selects with the tile checkbox, outlines the selection, and taps toggle instead of opening while selecting', () => {
    const handlers = actions();
    const onToggleSelect = vi.fn();
    render(<StudioClipGrid items={[clip({ id: 'a' }), clip({ id: 'b' })]} cardSize="m" selectedIds={new Set(['a'])} onToggleSelect={onToggleSelect} {...handlers} />);

    expect(screen.getByTestId('space-studio-tile-a')).toHaveClass('is-selected');
    expect(screen.getByTestId('space-studio-select-a')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('space-studio-feed-grid')).toHaveClass('has-selection');

    fireEvent.click(screen.getByTestId('space-studio-select-b'));
    expect(onToggleSelect).toHaveBeenCalledWith('b');
    fireEvent.click(within(screen.getByTestId('space-studio-tile-b')).getByRole('button', { name: 'Open Seedance 2.5 video' }));
    expect(onToggleSelect).toHaveBeenLastCalledWith('b');
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it('shows progress and failure without media, and never offers a download for them', () => {
    render(<StudioClipGrid items={[clip({ id: 'r', url: '', urls: [], status: 'running' }), clip({ id: 'e', url: '', urls: [], status: 'error' })]} cardSize="m" {...actions()} />);

    expect(within(screen.getByTestId('space-studio-tile-r')).getByText('Generating…')).toBeInTheDocument();
    expect(within(screen.getByTestId('space-studio-tile-e')).getAllByText('Failed').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('space-studio-tile-e')).getByRole('button', { name: 'Download' })).toBeDisabled();
  });
});
