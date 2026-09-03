import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@/types/project';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

const workspaceHarness = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: null as Record<string, unknown> | null,
}));

const models = vi.hoisted(() => {
  const prompt = {
    id: 'prompt',
    portType: 'text',
    label: 'Prompt',
    required: true,
    falParam: 'prompt',
    fieldType: 'port',
  };
  return {
    'video-one': {
      id: 'video-one-id',
      nodeType: 'video-one',
      name: 'Video Model',
      category: 'video',
      description: 'Video test model',
      provider: 'topview',
      outputType: 'video',
      responseMapping: { path: 'video.url' },
      inputs: [
        prompt,
        {
          id: 'duration',
          portType: 'config',
          label: 'Duration',
          required: false,
          falParam: 'duration',
          fieldType: 'select',
          default: '5',
          options: Array.from({ length: 12 }, (_, index) => ({
            value: String(index + 4),
            label: String(index + 4),
          })),
        },
        {
          id: 'bitrate',
          portType: 'config',
          label: 'Bitrate',
          required: false,
          falParam: 'bitrate',
          fieldType: 'select',
          default: 'high',
          options: [
            { value: 'high', label: 'High', description: 'Less compression · larger size' },
            { value: 'standard', label: 'Standard', description: 'More compression · smaller size' },
          ],
        },
        {
          id: 'start_image',
          portType: 'image',
          label: 'Start image',
          required: false,
          falParam: 'start_image',
          fieldType: 'port',
          mediaRole: 'start_image',
        },
        {
          id: 'end_image',
          portType: 'image',
          label: 'End image',
          required: false,
          falParam: 'end_image',
          fieldType: 'port',
          mediaRole: 'end_image',
        },
      ],
    },
    'video-seedance': {
      id: 'video-seedance-id',
      nodeType: 'video-seedance',
      name: 'Seedance 2.5',
      category: 'video',
      description: 'The model the composer opens on',
      provider: 'topview',
      outputType: 'video',
      responseMapping: { path: 'video.url' },
      inputs: [
        prompt,
        {
          id: 'image_url',
          portType: 'image',
          label: 'References',
          required: false,
          falParam: 'reference_images',
          fieldType: 'port',
          multiple: true,
          mediaRole: 'image',
        },
        {
          id: 'duration',
          portType: 'config',
          label: 'Duration',
          required: false,
          falParam: 'duration',
          fieldType: 'select',
          default: '5',
          options: Array.from({ length: 12 }, (_, index) => ({
            value: String(index + 4),
            label: String(index + 4),
          })),
        },
      ],
    },
    'video-ref': {
      id: 'video-ref-id',
      nodeType: 'video-ref',
      name: 'Reference Video',
      category: 'video',
      description: 'Reference-capable video test model',
      provider: 'topview',
      outputType: 'video',
      responseMapping: { path: 'video.url' },
      inputs: [
        prompt,
        {
          id: 'image_url',
          portType: 'image',
          label: 'References',
          required: false,
          falParam: 'reference_images',
          fieldType: 'port',
          multiple: true,
          mediaRole: 'image',
        },
      ],
    },
    'video-two': {
      id: 'video-two-id',
      nodeType: 'video-two',
      name: 'Alternate Video',
      category: 'video',
      description: 'Alternate video test model',
      provider: 'higgsfield',
      outputType: 'video',
      responseMapping: { path: 'video.url' },
      inputs: [
        prompt,
        {
          id: 'resolution',
          portType: 'config',
          label: 'Resolution',
          required: false,
          falParam: 'resolution',
          fieldType: 'select',
          default: '720p',
          options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
        },
      ],
    },
    'image-one': {
      id: 'image-one-id',
      nodeType: 'image-one',
      name: 'Image Model',
      category: 'image',
      description: 'Image test model',
      provider: 'topview',
      outputType: 'image',
      responseMapping: { path: 'images.0.url' },
      inputs: [
        prompt,
        {
          id: 'aspect_ratio',
          portType: 'config',
          label: 'Aspect ratio',
          required: false,
          falParam: 'aspect_ratio',
          fieldType: 'select',
          default: '16:9',
          options: [{ value: '16:9', label: '16:9' }],
        },
        {
          id: 'extra_images',
          portType: 'image',
          label: 'Reference',
          required: false,
          falParam: 'image_urls',
          fieldType: 'element-list',
          max: 15,
        },
      ],
    },
  } as Record<string, ModelDefinition>;
});

vi.mock('@/components/workspace/workspace-shell', () => ({
  useWorkspace: () => ({
    state: workspaceHarness.state,
    dispatch: workspaceHarness.dispatch,
    projectId: 'studio-test-project',
  }),
}));

vi.mock('@/components/create/workflow-canvas', () => ({
  WorkflowCanvas: () => <div data-testid="workflow-canvas" />,
}));
vi.mock('@/components/create/create-timeline', () => ({
  CreateTimeline: () => <div data-testid="create-timeline" />,
}));
vi.mock('@/components/create/toolbar/workflows-panel', () => ({ WorkflowsPanel: () => null }));
vi.mock('@/components/create/toolbar/models-panel', () => ({ ModelsPanel: () => null }));
vi.mock('@/components/create/toolbar/history-panel', () => ({ HistoryPanel: () => null }));

vi.mock('@/components/create/nodes/video-node-preview', () => ({
  VideoNodePreview: ({
    sourceUrl,
    className,
    ariaLabel,
  }: {
    sourceUrl: string;
    className?: string;
    ariaLabel?: string;
  }) => <video src={sourceUrl} className={className} aria-label={ariaLabel} />,
}));
vi.mock('@/components/create/use-topview-model-catalog', () => ({
  useTopviewModelCatalogVersion: () => 1,
}));
vi.mock('@/lib/fal/models', () => ({
  getModelDefinition: (nodeType: string) => models[nodeType],
}));
vi.mock('@/lib/workflows/provider-model-options', () => ({
  modelProviderLabel: (model: ModelDefinition) => (
    model.provider === 'higgsfield' ? 'Higgsfield' : 'Topview AI'
  ),
  providerModelOptions: (categories: string[]) => (
    categories.includes('video')
      ? [
          { key: 'video-one', label: 'Topview AI · Video Model' },
          { key: 'video-two', label: 'Higgsfield · Alternate Video' },
          { key: 'video-ref', label: 'Topview AI · Reference Video' },
          // Listed last so the default is chosen by name, not by position.
          { key: 'video-seedance', label: 'Topview AI · Seedance 2.5' },
        ]
      : [{ key: 'image-one', label: 'Topview AI · Image Model' }]
  ),
}));
vi.mock('@/lib/elements/variations', () => ({
  elementImagesForVariation: (element: { id: string }) => (
    element.id === 'el-sky' ? [{ id: 'i1', url: 'local-media://sky.png' }] : []
  ),
}));
vi.mock('@/lib/workflows/execute', () => ({ executeFromNode: vi.fn() }));
vi.mock('@/lib/llm/space-node-factory', () => ({
  createWorkflowNodeFromSpec: vi.fn(),
}));
vi.mock('@/lib/utils/video-generation-provider', () => ({
  getVideoGenerationProvider: () => 'topview',
}));
vi.mock('@/lib/providers/project-usage', () => ({ requestProviderUsageRefresh: vi.fn() }));

import { CreateTab } from '@/components/create/create-tab';
import { renewalCountdown } from '@/lib/providers/renewal';
import { SpaceStudio } from '@/components/create/space-studio';
import { createWorkflowNodeFromSpec } from '@/lib/llm/space-node-factory';
import { executeFromNode } from '@/lib/workflows/execute';
import { splitPromptMentions } from '@/lib/studio/mentions';

function node(
  id: string,
  type: string,
  data: Partial<WorkflowNodeData>,
): Record<string, unknown> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      type,
      label: models[type].name,
      config: {},
      ...data,
    },
  };
}

function makeState(nodes: Record<string, unknown>[] = []) {
  const activeSpace = {
    id: 'space-a',
    name: 'Scene Lab',
    createdAt: '2026-08-31T12:00:00.000Z',
    nodes,
    edges: [],
  };
  return {
    spaces: [activeSpace],
    activeSpaceId: activeSpace.id,
    openSpaceIds: new Set([activeSpace.id]),
    nodes,
    edges: [],
    assets: [],
    elements: [],
    runningNodeIds: new Set<string>(),
    providerUsage: { topview: { connected: true, creditsRemaining: 100, creditsUsed: 0 } },
  };
}

describe('Space Studio', () => {
  beforeEach(() => {
    workspaceHarness.state = makeState();
    workspaceHarness.dispatch.mockClear();
    localStorage.clear();
    // Most of these tests read the list cards; the grid has its own suite.
    localStorage.setItem('cinegen_studio_feed_view', 'list');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '(max-width: 767px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('switches between Canvas and Studio without unmounting or mutating the workflow', () => {
    render(<CreateTab />);

    const viewSwitch = screen.getByRole('group', { name: 'Space view' });
    const canvasButton = within(viewSwitch).getByRole('button', { name: 'Canvas' });
    const studioButton = within(viewSwitch).getByRole('button', { name: 'Studio' });
    const workflowCanvas = screen.getByTestId('workflow-canvas');

    expect(canvasButton).toHaveAttribute('aria-pressed', 'true');
    expect(studioButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('space-studio')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-timeline')).toBeInTheDocument();

    fireEvent.click(studioButton);

    expect(studioButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('space-studio')).toBeInTheDocument();
    expect(workflowCanvas).toBeInTheDocument();
    expect(workflowCanvas.closest('.create-tab__canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('create-timeline')).not.toBeInTheDocument();
    expect(localStorage.getItem('cinegen_spaces_view_mode')).toBe('studio');
    expect(workspaceHarness.dispatch).not.toHaveBeenCalled();

    fireEvent.click(canvasButton);

    expect(canvasButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('space-studio')).not.toBeInTheDocument();
    expect(workflowCanvas.closest('.create-tab__canvas')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByTestId('create-timeline')).toBeInTheDocument();
  });

  it('renders semantic composer controls and updates them when the model or media type changes', async () => {
    render(<SpaceStudio />);

    expect(screen.getByRole('heading', { name: 'Generate in Studio' })).toBeInTheDocument();
    expect(screen.getByText('Scene Lab')).toBeInTheDocument();

    const outputType = screen.getByRole('group', { name: 'Output type' });
    expect(within(outputType).getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(outputType).getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Video guidance' })).toBeInTheDocument();
    // References is the opening mode, and Seedance 2.5 the opening model, even
    // though it is listed last.
    expect(screen.getByRole('button', { name: 'References' })).toHaveAttribute('aria-pressed', 'true');

    // The model picker is a searchable overlay, so the selection lives on the
    // trigger rather than in a native select value.
    const modelTrigger = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(modelTrigger).toHaveAttribute('data-value', 'video-seedance'));
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('space-studio-control-duration-trigger')).toBeInTheDocument();

    fireEvent.click(modelTrigger);
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('option', { name: /Alternate Video/ }));

    expect(modelTrigger).toHaveAttribute('data-value', 'video-two');
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('combobox', { name: 'Resolution' })).toBeInTheDocument();
    expect(screen.queryByTestId('space-studio-control-duration-trigger')).not.toBeInTheDocument();

    const generate = screen.getByTestId('space-studio-generate');
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'A slow dolly toward the subject.' },
    });
    expect(generate).toBeEnabled();
    expect(generate).toHaveAttribute('type', 'submit');

    fireEvent.click(within(outputType).getByRole('button', { name: 'Image' }));
    await waitFor(() => expect(modelTrigger).toHaveAttribute('data-value', 'image-one'));
    expect(within(outputType).getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Video guidance' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toBeInTheDocument();
    expect(screen.getByTestId('space-studio-generate')).toHaveTextContent('Generate image');
  });

  it('completes an @ mention from the prompt and adds it as a reference', async () => {
    workspaceHarness.state = {
      ...makeState(),
      elements: [{
        id: 'el-sky',
        name: 'Sky Diver',
        type: 'character',
        description: '',
        images: [{ id: 'i1', url: 'local-media://sky.png', createdAt: '', source: 'upload' }],
        createdAt: '',
        updatedAt: '',
      }],
    };

    render(<SpaceStudio />);

    // A mention only attaches a reference on a model that accepts one.
    const outputType = screen.getByRole('group', { name: 'Output type' });
    fireEvent.click(within(outputType).getByRole('button', { name: 'Image' }));

    const promptBox = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(promptBox, { target: { value: 'A shot of @sky' } });

    // Typing @ offers the matching Elements without leaving the prompt.
    const option = await screen.findByTestId('space-studio-mention-el-sky');
    expect(option).toHaveTextContent('@Sky-Diver');

    fireEvent.click(option);

    // The mention token survives Topview's prompt sanitiser, which turns
    // @Sky-Diver back into "Sky Diver".
    await waitFor(() => expect(promptBox.value).toBe('A shot of @Sky-Diver '));
    expect(screen.getByTestId('space-studio-element-el-sky')).toBeInTheDocument();
  });

  it('opens the element picker from the prompt chip', async () => {
    workspaceHarness.state = {
      ...makeState(),
      elements: [{
        id: 'el-sky',
        name: 'Sky Diver',
        type: 'character',
        description: '',
        images: [{ id: 'i1', url: 'local-media://sky.png', createdAt: '', source: 'upload' }],
        createdAt: '',
        updatedAt: '',
      }],
    };

    render(<SpaceStudio />);

    const outputType = screen.getByRole('group', { name: 'Output type' });
    fireEvent.click(within(outputType).getByRole('button', { name: 'Image' }));

    // Nothing from the library is shown until something is chosen.
    expect(screen.queryByTestId('space-studio-modal-element-el-sky')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('space-studio-elements-chip'));

    const modal = await screen.findByTestId('space-studio-element-modal');
    fireEvent.click(within(modal).getByTestId('space-studio-modal-element-el-sky'));

    expect(within(modal).getByTestId('space-studio-modal-element-el-sky'))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('remembers the prompt, settings, and references a generation used', () => {
    const skyDiver = {
      id: 'el-sky',
      name: 'Sky Diver',
      type: 'character' as const,
      description: '',
      images: [{ id: 'i1', url: 'local-media://sky.png', createdAt: '', source: 'upload' as const }],
      createdAt: '',
      updatedAt: '',
    };
    workspaceHarness.state = {
      ...makeState([
        node('video-feed', 'video-one', {
          config: {
            __studioGenerated: true,
            __studioCreatedAt: '2026-09-01T12:00:00.000Z',
            __studioPrompt: 'Move toward camera.',
            __studioElementIds: ['el-sky'],
            duration: '5',
          },
          generations: ['https://media.example/v1.mp4'],
          activeGeneration: 0,
          result: { status: 'complete', url: 'https://media.example/v1.mp4' },
        }),
      ]),
      elements: [skyDiver],
    };

    render(<SpaceStudio />);

    const card = screen.getByRole('article', { name: 'Video Model generation' });
    // The settings it actually ran with, read back off the node.
    expect(within(card).getByLabelText('Settings used')).toHaveTextContent('5s');
    // And the references it used, resolved against the current library.
    expect(within(card).getByRole('img', { name: 'Sky Diver' })).toBeInTheDocument();
    expect(within(card).getByText('1 reference')).toBeInTheDocument();

    // Clicking the prompt itself loads the recipe back into the composer, as
    // does the explicit Reuse action.
    fireEvent.click(within(card).getByTestId('space-studio-prompt-load-video-feed'));
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Move toward camera.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'edited' } });
    fireEvent.click(within(card).getByTestId('space-studio-reuse-video-feed'));
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Move toward camera.');
  });

  it('marks every mention in a prompt, not every other one', () => {
    // A global regex reused across parts carries lastIndex; this pins the fix.
    const parts = splitPromptMentions('a @Sky-Diver b @Sky-Diver c', ['Sky Diver']);

    expect(parts.filter((part) => part.mention)).toHaveLength(2);
    expect(parts.map((part) => part.text).join('')).toBe('a @Sky-Diver b @Sky-Diver c');
    expect(splitPromptMentions('no tags here', ['Sky Diver'])).toEqual([
      { text: 'no tags here', mention: false },
    ]);
  });

  it('writes the tag into the prompt when an element is picked, and removes it', async () => {
    workspaceHarness.state = {
      ...makeState(),
      elements: [{
        id: 'el-sky',
        name: 'Sky Diver',
        type: 'character',
        description: '',
        images: [{ id: 'i1', url: 'local-media://sky.png', createdAt: '', source: 'upload' }],
        createdAt: '',
        updatedAt: '',
      }],
    };

    render(<SpaceStudio />);
    const outputType = screen.getByRole('group', { name: 'Output type' });
    fireEvent.click(within(outputType).getByRole('button', { name: 'Image' }));

    const promptBox = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(promptBox, { target: { value: 'A wide shot' } });

    fireEvent.click(await screen.findByTestId('space-studio-elements-chip'));
    const picker = await screen.findByTestId('space-studio-element-modal');
    fireEvent.click(within(picker).getByTestId('space-studio-modal-element-el-sky'));

    expect(promptBox).toHaveValue('A wide shot @Sky-Diver ');

    // Deselecting takes the tag back out rather than stranding it.
    fireEvent.click(within(picker).getByTestId('space-studio-modal-element-el-sky'));
    expect(promptBox.value).not.toContain('@Sky-Diver');
  });

  it('uses a slider for a dense numeric range and a described flyout for other settings', async () => {
    render(<SpaceStudio />);

    // The bitrate setting belongs to the first mock model, not the default one.
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: /Video Model/ }));

    // 12 durations is past the point a menu stays scannable.
    fireEvent.click(screen.getByTestId('space-studio-control-duration-trigger'));
    const slider = await screen.findByTestId('space-studio-control-duration');
    expect(slider).toHaveAttribute('type', 'range');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(screen.getByTestId('space-studio-control-duration-trigger')).toHaveTextContent('7s');

    // Dragging a 12-stop range inside a pill-width popover left everything but
    // the ends unreachable, so every accepted value is also a target of its own.
    const stops = screen.getByTestId('space-studio-control-duration-stops');
    expect(within(stops).getAllByRole('button')).toHaveLength(12);
    fireEvent.click(within(stops).getByRole('button', { name: '11s' }));
    expect(screen.getByTestId('space-studio-control-duration-trigger')).toHaveTextContent('11s');

    // And a nudge lands on the neighbouring second, not two away.
    fireEvent.click(screen.getByTestId('space-studio-control-duration-up'));
    expect(screen.getByTestId('space-studio-control-duration-trigger')).toHaveTextContent('12s');
    fireEvent.click(screen.getByTestId('space-studio-control-duration-down'));
    expect(screen.getByTestId('space-studio-control-duration-trigger')).toHaveTextContent('11s');

    // Bitrate is not one of the three pills, so it becomes a row with a
    // flyout that carries each option's explanation.
    fireEvent.click(screen.getByTestId('space-studio-control-bitrate-trigger'));
    const flyout = await screen.findByTestId('space-studio-control-bitrate');
    expect(within(flyout).getByText('Less compression · larger size')).toBeInTheDocument();
    fireEvent.click(within(flyout).getByRole('option', { name: /Standard/ }));
    expect(screen.getByTestId('space-studio-control-bitrate-trigger')).toHaveTextContent('Standard');
  });

  it('shows a flat clip grid that opens a viewer', () => {
    workspaceHarness.state = makeState([
      node('a', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      }),
      node('b', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-08-30T12:00:00.000Z' },
        generations: ['https://media.example/b.mp4'],
        result: { status: 'complete', url: 'https://media.example/b.mp4' },
      }),
    ]);

    render(<SpaceStudio />);
    fireEvent.click(screen.getByTestId('space-studio-view-grid'));

    // A flat wall of clips, newest first, with no date headings to break it up.
    const grid = screen.getByTestId('space-studio-feed-grid');
    expect(within(grid).queryByRole('heading')).not.toBeInTheDocument();
    const tiles = within(grid).getAllByTestId(/^space-studio-tile-/);
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual(['space-studio-tile-a', 'space-studio-tile-b']);
    expect(screen.queryByRole('article', { name: 'Video Model generation' })).not.toBeInTheDocument();

    // Opening a clip shows the viewer for it; the arrow keys walk the grid.
    fireEvent.click(within(tiles[0]).getByRole('button', { name: 'Open Video Model video' }));
    const viewer = screen.getByTestId('space-studio-clip-viewer');
    expect(within(viewer).getByText('1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(within(screen.getByTestId('space-studio-clip-viewer')).getByText('2 of 2')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('space-studio-clip-viewer'), { key: 'Escape' });
    expect(screen.queryByTestId('space-studio-clip-viewer')).not.toBeInTheDocument();
    // The opened clip is remembered as the last one viewed.
    expect(JSON.parse(localStorage.getItem('cinegen_studio_seen:studio-test-project') ?? '{}').lastViewed).toBe('b');
  });

  it('docks the composer as a bar over the grid and restores the panel for the list', () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([
      node('a', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      }),
    ]);

    render(<SpaceStudio />);
    expect(screen.getByTestId('space-studio')).toHaveClass('space-studio--dock');
    expect(screen.getByTestId('space-studio-generate')).toHaveTextContent(/^Generate$/);

    // The guidance pill drives the same state as the panel's segmented control.
    const modePill = screen.getByTestId('space-studio-dock-mode');
    expect(modePill).toHaveTextContent('References');
    fireEvent.click(modePill);
    expect(screen.getByRole('menuitemradio', { name: 'References' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Frames' }));
    expect(screen.getByTestId('space-studio-dock-mode')).toHaveTextContent('Frames');
    expect(within(screen.getByRole('group', { name: 'Video guidance' })).getByRole('button', { name: 'Frames' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('menu', { name: 'Video guidance' })).not.toBeInTheDocument();

    // The Elements chip sits in the tool row while docked, and back in the prompt card for the list.
    expect(screen.getByTestId('space-studio-elements-chip').closest('.space-studio__tools')).not.toBeNull();
    expect(screen.getByTestId('space-studio-dock-add')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('space-studio-view-list'));
    expect(screen.getByTestId('space-studio')).not.toHaveClass('space-studio--dock');
    expect(screen.getByTestId('space-studio-elements-chip').closest('.space-studio__prompt-chips')).not.toBeNull();
    expect(screen.queryByTestId('space-studio-dock-add')).not.toBeInTheDocument();
    expect(screen.getByTestId('space-studio-generate')).toHaveTextContent('Generate video');
  });

  it('makes one node and one run per version when the stepper asks for more than one', () => {
    let counter = 0;
    // The real executor returns a promise; a bare vi.fn() would throw on `.catch`.
    vi.mocked(executeFromNode).mockResolvedValue(undefined as never);
    vi.mocked(createWorkflowNodeFromSpec).mockImplementation((spec: { nodeType: string; label: string; config: Record<string, unknown> }, position: { x: number; y: number }) => ({
      id: `made-${++counter}`,
      type: spec.nodeType,
      position,
      data: { type: spec.nodeType, label: spec.label, config: spec.config },
    }) as never);
    workspaceHarness.state = makeState([]);

    render(<SpaceStudio />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Three takes of the same push in.' } });
    fireEvent.click(screen.getByRole('button', { name: 'More versions' }));
    fireEvent.click(screen.getByRole('button', { name: 'More versions' }));
    expect(screen.getByTestId('space-studio-batch')).toHaveTextContent('3/4');
    expect(screen.getByTestId('space-studio-generate')).toHaveTextContent('Generate 3 videos');

    fireEvent.submit(screen.getByTestId('space-studio-generate').closest('form') as HTMLFormElement);

    const setNodes = workspaceHarness.dispatch.mock.calls.map(([action]) => action).find((action) => action.type === 'SET_NODES') as { nodes: Array<{ id: string; data: { config: Record<string, unknown> } }> };
    expect(setNodes.nodes.map((made) => made.id)).toEqual(['made-1', 'made-2', 'made-3']);
    expect(setNodes.nodes.map((made) => made.data.config.__studioBatchIndex)).toEqual([1, 2, 3]);
    expect(setNodes.nodes.every((made) => made.data.config.__studioBatchSize === 3)).toBe(true);
    expect(vi.mocked(executeFromNode)).toHaveBeenCalledTimes(3);
    // Never past four, never below one.
    fireEvent.click(screen.getByRole('button', { name: 'More versions' }));
    fireEvent.click(screen.getByRole('button', { name: 'More versions' }));
    expect(screen.getByTestId('space-studio-batch')).toHaveTextContent('4/4');
    expect(screen.getByRole('button', { name: 'More versions' })).toBeDisabled();
  });

  it('removes a multi-selection from the grid after one confirmation', () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([
      node('a', 'video-one', { config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' }, generations: ['https://media.example/a.mp4'], result: { status: 'complete', url: 'https://media.example/a.mp4' } }),
      node('b', 'video-one', { config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T11:00:00.000Z' }, generations: ['https://media.example/b.mp4'], result: { status: 'complete', url: 'https://media.example/b.mp4' } }),
      node('c', 'video-one', { config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T10:00:00.000Z' }, generations: ['https://media.example/c.mp4'], result: { status: 'complete', url: 'https://media.example/c.mp4' } }),
    ]);

    render(<SpaceStudio />);
    expect(screen.queryByTestId('space-studio-selection')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('space-studio-select-a'));
    fireEvent.click(screen.getByTestId('space-studio-select-c'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // While selecting, a tap on a tile toggles it instead of opening the viewer.
    fireEvent.click(within(screen.getByTestId('space-studio-tile-b')).getByRole('button', { name: 'Open Video Model video' }));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.queryByTestId('space-studio-clip-viewer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('space-studio-select-b'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const setNodes = workspaceHarness.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === 'SET_NODES').pop() as { nodes: Array<{ id: string }> };
    expect(setNodes.nodes.map((kept) => kept.id)).toEqual(['b']);
  });

  it('opens docked menus above the bar, not inside the tool row that clips them', () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([
      node('a', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      }),
    ]);

    render(<SpaceStudio />);

    // The tool row scrolls sideways, so an absolutely positioned menu would be
    // clipped by it: docked menus are placed against the viewport instead.
    const guidance = screen.getByTestId('space-studio-dock-mode');
    guidance.getBoundingClientRect = () => ({ x: 300, y: 700, left: 300, top: 700, right: 460, bottom: 742, width: 160, height: 42, toJSON: () => ({}) });
    fireEvent.click(guidance);
    const menu = screen.getByRole('menu', { name: 'Video guidance' });
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.bottom).toBe(`${window.innerHeight - 700 + 8}px`);
    expect(Number(menu.style.zIndex)).toBeGreaterThan(60);
    fireEvent.keyDown(document, { key: 'Escape' });

    // The model picker is anchored to the bar and must size to its content: with
    // a bottom offset it would otherwise stretch from the CSS `top` to the bar.
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    const flyout = document.querySelector('.space-studio__flyout') as HTMLElement;
    expect(flyout).not.toBeNull();
    expect(flyout.style.top).toBe('auto');
    expect(flyout.style.bottom).not.toBe('');
  });

  it('closes a docked menu on a second click, on a click away, and lets its options through', () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([
      node('a', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      }),
    ]);

    render(<SpaceStudio />);

    // A model with a short option list, so a selection is visible on the pill.
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: /Alternate Video/ }));
    const pill = screen.getByRole('combobox', { name: 'Resolution' });
    pill.getBoundingClientRect = () => ({ x: 400, y: 700, left: 400, top: 700, right: 520, bottom: 742, width: 120, height: 42, toJSON: () => ({}) });

    // Both bounds are pinned: a fixed menu would otherwise take `min-width: 100%`
    // from the viewport and run off the screen.
    const open = () => { fireEvent.mouseDown(pill); fireEvent.click(pill); };
    open();
    const menu = screen.getByRole('listbox', { name: 'Resolution' });
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.width).toBe('220px');
    expect(menu.style.minWidth).toBe('220px');
    expect(menu.style.maxWidth).toBe('220px');

    // A second click on the same control closes it.
    open();
    expect(screen.queryByRole('listbox', { name: 'Resolution' })).not.toBeInTheDocument();

    // A click anywhere else closes it.
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Resolution' })).not.toBeInTheDocument();

    // An option still receives its click instead of being swallowed by the dismissal.
    open();
    const option = screen.getByTestId('space-studio-control-resolution-1080p');
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(screen.queryByRole('listbox', { name: 'Resolution' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Resolution' })).toHaveAttribute('data-value', '1080p');
  });

  it('treats a file attached from the bar as a reference and leaves the mode alone', async () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      file: { getPathForFile: (file: File) => `/Users/chris/Movies/${file.name}` },
    };

    vi.mocked(executeFromNode).mockResolvedValue(undefined as never);
    let made = 0;
    vi.mocked(createWorkflowNodeFromSpec).mockImplementation((spec: { nodeType: string; label: string; config: Record<string, unknown> }, position: { x: number; y: number }) => ({
      id: `made-${++made}`,
      type: spec.nodeType,
      position,
      data: { type: spec.nodeType, label: spec.label, config: spec.config },
    }) as never);

    render(<SpaceStudio />);
    const modeBefore = screen.getByTestId('space-studio-dock-mode').textContent;

    const input = screen.getByTestId('space-studio-attach-input');
    expect(input).toHaveAttribute('accept', 'image/*,video/*,audio/*');
    expect(input).toHaveAttribute('multiple');

    // A whole set at once, mixed media — that is what a reference pack is.
    fireEvent.change(input, {
      target: {
        files: [
          new File(['x'], 'jordan.png', { type: 'image/png' }),
          new File(['x'], 'jordan-travis.mp4', { type: 'video/mp4' }),
        ],
      },
    });

    expect(await screen.findByText('jordan-travis.mp4 added as a reference.')).toBeInTheDocument();
    // The video used to stop at "saved to Assets"; both are references now.
    expect(screen.getAllByRole('button', { name: 'Remove jordan.png' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Remove jordan-travis.mp4' }).length).toBeGreaterThan(0);
    // Attaching must not move the shot to Frames.
    expect(screen.getByTestId('space-studio-dock-mode')).toHaveTextContent(modeBefore ?? '');

    // They ride into the generation on the model's reference field.
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'He walks out of the tunnel.' } });
    fireEvent.submit(screen.getByTestId('space-studio-generate').closest('form') as HTMLFormElement);
    const setNodes = workspaceHarness.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === 'SET_NODES') as { nodes: Array<{ data: { config: Record<string, unknown> } }> };
    const reference = setNodes.nodes[0].data.config.image_url as { urls?: string[] };
    expect(reference.urls).toHaveLength(2);
    expect(reference.urls?.[0]).toContain('jordan.png');
    expect(reference.urls?.[1]).toContain('jordan-travis.mp4');

    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows first and last frame slots above the bar in Frames mode and fills the one you click', async () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      file: { getPathForFile: () => '/Users/chris/Pictures/last.png' },
    };
    // The slot reads the asset back out of workspace state, so the harness has
    // to actually keep what the Studio files away.
    workspaceHarness.dispatch.mockImplementation((action: { type: string; asset?: Asset }) => {
      if (action.type === 'ADD_ASSET' && action.asset) {
        workspaceHarness.state = { ...workspaceHarness.state, assets: [...workspaceHarness.state.assets, action.asset] };
      }
    });

    render(<SpaceStudio />);
    // The default model takes references and no frames: nothing to show.
    expect(screen.getByTestId('space-studio-dock-mode')).toHaveTextContent('References');
    expect(screen.queryByTestId('space-studio-dock-frames')).not.toBeInTheDocument();

    // A frames model puts the two slots above the bar.
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
    fireEvent.click(screen.getByRole('option', { name: /Video Model/ }));
    await waitFor(() => expect(screen.getByTestId('space-studio-dock-mode')).toHaveTextContent('Frames'));
    expect(screen.getByTestId('space-studio-dock-frames')).toBeInTheDocument();
    expect(screen.getByTestId('space-studio-dock-start-frame')).toHaveAttribute('aria-label', 'Add first frame from your computer');

    // Clicking the last-frame slot aims the picker at that slot.
    fireEvent.click(screen.getByTestId('space-studio-dock-end-frame'));
    const file = new File(['x'], 'last.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('space-studio-attach-input'), { target: { files: [file] } });

    expect(await screen.findByText('last.png is the last frame.')).toBeInTheDocument();
    const added = workspaceHarness.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === 'ADD_ASSET') as { asset: { id: string; name: string } };
    expect(added.asset.name).toBe('last.png');
    // The slot now shows that image, and only that slot.
    await waitFor(() => expect(screen.getByTestId('space-studio-dock-end-frame')).toHaveAttribute('aria-label', 'Last frame: last.png. Replace'));
    expect(screen.getByTestId('space-studio-dock-start-frame')).toHaveAttribute('aria-label', 'Add first frame from your computer');
    expect(screen.getByRole('button', { name: 'Remove last frame' })).toBeInTheDocument();

    // A video cannot be a frame.
    fireEvent.click(screen.getByTestId('space-studio-dock-start-frame'));
    fireEvent.change(screen.getByTestId('space-studio-attach-input'), { target: { files: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })] } });
    expect(await screen.findByText('A frame has to be an image.')).toBeInTheDocument();

    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('folds the composer into a bottom sheet on a phone so the clips come first', () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    // jsdom reports no matchMedia, which the Studio reads as a desktop width.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: /max-width:\s*780px/.test(query),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
    workspaceHarness.state = makeState([
      node('a', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      }),
    ]);

    render(<SpaceStudio />);

    const studio = screen.getByTestId('space-studio');
    expect(studio).toHaveClass('space-studio--sheet');
    expect(studio).not.toHaveClass('space-studio--dock');
    expect(studio).not.toHaveClass('is-composing');

    // The collapsed bar shows what the prompt says, and opens the composer.
    const peek = screen.getByTestId('space-studio-peek');
    expect(peek).toHaveTextContent('Describe the shot…');
    fireEvent.click(peek);
    expect(screen.getByTestId('space-studio')).toHaveClass('is-composing');
    expect(screen.queryByTestId('space-studio-peek')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'A slow push through the ferns.' } });
    fireEvent.click(screen.getByTestId('space-studio-sheet-close'));
    expect(screen.getByTestId('space-studio')).not.toHaveClass('is-composing');
    expect(screen.getByTestId('space-studio-peek')).toHaveTextContent('A slow push through the ferns.');

    // The list keeps the full panel: the sheet belongs to the grid.
    fireEvent.click(screen.getByTestId('space-studio-view-list'));
    expect(screen.getByTestId('space-studio')).not.toHaveClass('space-studio--sheet');
    expect(screen.queryByTestId('space-studio-peek')).not.toBeInTheDocument();

    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('shows the Topview credit reset in the provider card instead of a project tally', () => {
    workspaceHarness.state = makeState([]);

    render(<CreateTab />);

    const card = screen.getByLabelText('Topview AI project usage');
    expect(within(card).getByText('Credits left')).toBeInTheDocument();
    expect(within(card).queryByText('Used in project')).not.toBeInTheDocument();
    expect(within(card).getByText('Renews in')).toBeInTheDocument();
    // The countdown is derived from today, so assert against the same helper
    // rather than a date that would rot.
    expect(screen.getByTestId('cs-provider-renewal')).toHaveTextContent(renewalCountdown());
    expect(within(card).getByText(/resets? on the 27th of each month/i)).toBeInTheDocument();
  });

  it('shows every attached reference above the bar, Elements and files alike', async () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = {
      ...makeState([]),
      elements: [{
        id: 'el-sky',
        name: 'Sky Diver',
        type: 'character',
        description: '',
        images: [{ id: 'i1', url: 'local-media://sky.png', createdAt: '', source: 'upload' }],
        createdAt: '',
        updatedAt: '',
      }],
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      file: { getPathForFile: (file: File) => `/Users/chris/Movies/${file.name}` },
    };

    render(<SpaceStudio />);
    // Nothing attached yet, so no strip.
    expect(screen.queryByTestId('space-studio-dock-refs')).not.toBeInTheDocument();

    // An Element picked from the picker.
    fireEvent.click(screen.getByTestId('space-studio-elements-chip'));
    fireEvent.click(screen.getByTestId('space-studio-modal-element-el-sky'));
    fireEvent.keyDown(document, { key: 'Escape' });

    // And a file attached from disk.
    fireEvent.change(screen.getByTestId('space-studio-attach-input'), {
      target: { files: [new File(['x'], 'run-cycle.mp4', { type: 'video/mp4' })] },
    });
    await screen.findByText('run-cycle.mp4 added as a reference.');

    const strip = screen.getByTestId('space-studio-dock-refs');
    expect(within(strip).getByText('Sky Diver')).toBeInTheDocument();
    expect(within(strip).getByText('run-cycle.mp4')).toBeInTheDocument();
    // A clip shows a still of itself, so you can tell which video it is.
    const clip = strip.querySelector('video');
    expect(clip).not.toBeNull();
    expect(clip?.getAttribute('src')).toContain('run-cycle.mp4');
    expect(clip?.getAttribute('preload')).toBe('metadata');

    // Each tile can be taken off the shot from here.
    fireEvent.click(within(strip).getByRole('button', { name: 'Remove run-cycle.mp4' }));
    expect(within(screen.getByTestId('space-studio-dock-refs')).queryByText('run-cycle.mp4')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('space-studio-dock-refs')).getByRole('button', { name: 'Remove Sky Diver' }));
    expect(screen.queryByTestId('space-studio-dock-refs')).not.toBeInTheDocument();

    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('opens on the grid by default and remembers a switch to the list', () => {
    localStorage.removeItem('cinegen_studio_feed_view');
    workspaceHarness.state = makeState([
      node('a', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        generations: ['https://media.example/a.mp4'],
        result: { status: 'complete', url: 'https://media.example/a.mp4' },
      }),
    ]);

    render(<SpaceStudio />);
    expect(screen.getByTestId('space-studio-view-grid')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('space-studio-feed-grid')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('space-studio-view-list'));
    expect(localStorage.getItem('cinegen_studio_feed_view')).toBe('list');
    expect(screen.getByRole('article', { name: 'Video Model generation' })).toBeInTheDocument();
  });

  it('recovers a re-created reference by name and reports one that is truly gone', () => {
    // The library was re-imported: "Sky Diver" now has a new id, and "Cave" is gone.
    workspaceHarness.state = {
      ...makeState([
        node('old-video', 'video-ref', {
          config: {
            __studioGenerated: true,
            __studioCreatedAt: '2026-08-27T12:00:00.000Z',
            __studioPrompt: 'Hold on the diver.',
            __studioElementIds: ['el-sky-OLD', 'el-cave-OLD'],
            __studioElementNames: ['Sky Diver', 'Cave'],
          },
          generations: ['https://media.example/old.mp4'],
          result: { status: 'complete', url: 'https://media.example/old.mp4' },
        }),
      ]),
      elements: [{
        id: 'el-sky',
        name: 'Sky Diver',
        type: 'character',
        description: '',
        images: [{ id: 'i1', url: 'local-media://sky.png', createdAt: '', source: 'upload' }],
        createdAt: '',
        updatedAt: '',
      }],
    };

    render(<SpaceStudio />);
    fireEvent.click(screen.getByTestId('space-studio-prompt-load-old-video'));

    // Sky Diver came back under its NEW id via the stored name.
    expect(screen.getByTestId('space-studio-element-el-sky')).toBeInTheDocument();
    // Cave could not, and the user is told instead of shown an empty strip.
    expect(screen.getByTestId('space-studio-missing-references')).toHaveTextContent('1 reference');
    expect(screen.getByRole('button', { name: 'References' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not land in References mode when every stored reference is gone', () => {
    workspaceHarness.state = {
      ...makeState([
        node('orphan', 'video-one', {
          config: {
            __studioGenerated: true,
            __studioCreatedAt: '2026-08-27T12:00:00.000Z',
            __studioPrompt: 'Push in.',
            __studioElementIds: ['el-gone'],
          },
          generations: ['https://media.example/o.mp4'],
          result: { status: 'complete', url: 'https://media.example/o.mp4' },
        }),
      ]),
      elements: [],
    };

    render(<SpaceStudio />);
    fireEvent.click(screen.getByTestId('space-studio-prompt-load-orphan'));

    expect(screen.getByTestId('space-studio-missing-references')).toHaveTextContent('1 reference');
    expect(screen.getByRole('button', { name: 'Frames' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('routes an auth failure to Settings instead of offering a retry that would fail the same way', () => {
    workspaceHarness.state = makeState([
      node('unauth', 'video-one', {
        config: { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z' },
        result: {
          status: 'error',
          error: "Error invoking remote method 'topview:submit': Error: Connect your Topview account in Settings before generating.",
        },
      }),
    ]);

    render(<SpaceStudio />);

    const card = screen.getByRole('article', { name: 'Video Model generation' });
    // The raw Electron wrapper never reaches the user.
    expect(within(card).getByRole('alert')).toHaveTextContent('Connect your Topview account in Settings before generating.');
    expect(within(card).getByRole('alert')).not.toHaveTextContent('invoking remote method');
    expect(within(card).queryByTestId('space-studio-retry-unauth')).not.toBeInTheDocument();

    fireEvent.click(within(card).getByTestId('space-studio-open-settings-unauth'));
    expect(workspaceHarness.dispatch).toHaveBeenCalledWith({ type: 'SET_TAB', tab: 'settings' });
  });

  it('shows completed video and image generations, version navigation, and feed filters', () => {
    workspaceHarness.state = makeState([
      node('video-feed', 'video-one', {
        config: {
          __studioGenerated: true,
          __studioCreatedAt: '2026-08-31T12:00:00.000Z',
          __studioPrompt: 'Move toward camera.',
        },
        generations: [
          'https://media.example/video-v1.mp4',
          'https://media.example/video-v2.mp4',
        ],
        activeGeneration: 1,
        result: { status: 'complete', url: 'https://media.example/video-v2.mp4' },
      }),
      node('image-feed', 'image-one', {
        config: {
          __studioGenerated: true,
          __studioCreatedAt: '2026-08-31T12:01:00.000Z',
          __studioPrompt: 'A wide production still.',
        },
        generations: ['https://media.example/image-v1.webp'],
        activeGeneration: 0,
        result: { status: 'complete', url: 'https://media.example/image-v1.webp' },
      }),
    ]);

    render(<SpaceStudio />);

    expect(screen.getByRole('article', { name: 'Video Model generation' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Image Model generation' })).toBeInTheDocument();
    expect(screen.getByLabelText('Video Model, version 2')).toHaveAttribute(
      'src',
      'https://media.example/video-v2.mp4',
    );
    expect(screen.getByRole('img', { name: 'Image Model result, version 1' })).toHaveAttribute(
      'src',
      'https://media.example/image-v1.webp',
    );

    const versions = screen.getByRole('tablist', { name: 'Video Model versions' });
    expect(within(versions).getByRole('tab', { name: 'V2' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(versions).getByRole('tab', { name: 'V1' }));
    expect(screen.getByLabelText('Video Model, version 1')).toHaveAttribute(
      'src',
      'https://media.example/video-v1.mp4',
    );

    const filters = screen.getByRole('group', { name: 'Filter generations' });
    fireEvent.click(within(filters).getByRole('button', { name: 'Video' }));
    expect(screen.getByRole('article', { name: 'Video Model generation' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Image Model generation' })).not.toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
  });
});
