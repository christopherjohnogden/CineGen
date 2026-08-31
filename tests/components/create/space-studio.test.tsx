import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
          options: [{ value: '5', label: '5 seconds' }],
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
          options: [{ value: '720p', label: '720p' }],
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
        ]
      : [{ key: 'image-one', label: 'Topview AI · Image Model' }]
  ),
}));
vi.mock('@/lib/elements/variations', () => ({ elementImagesForVariation: () => [] }));
vi.mock('@/lib/workflows/execute', () => ({ executeFromNode: vi.fn() }));
vi.mock('@/lib/llm/space-node-factory', () => ({
  createWorkflowNodeFromSpec: vi.fn(),
}));
vi.mock('@/lib/utils/video-generation-provider', () => ({
  getVideoGenerationProvider: () => 'topview',
}));
vi.mock('@/lib/providers/project-usage', () => ({ requestProviderUsageRefresh: vi.fn() }));

import { CreateTab } from '@/components/create/create-tab';
import { SpaceStudio } from '@/components/create/space-studio';

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
    expect(screen.getByRole('button', { name: 'Frames' })).toHaveAttribute('aria-pressed', 'true');

    const modelSelect = screen.getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(modelSelect).toHaveValue('video-one'));
    expect(screen.getByRole('combobox', { name: 'Duration' })).toBeInTheDocument();

    fireEvent.change(modelSelect, { target: { value: 'video-two' } });
    expect(modelSelect).toHaveValue('video-two');
    expect(screen.getByRole('combobox', { name: 'Resolution' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Duration' })).not.toBeInTheDocument();

    const generate = screen.getByTestId('space-studio-generate');
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'A slow dolly toward the subject.' },
    });
    expect(generate).toBeEnabled();
    expect(generate).toHaveAttribute('type', 'submit');

    fireEvent.click(within(outputType).getByRole('button', { name: 'Image' }));
    await waitFor(() => expect(modelSelect).toHaveValue('image-one'));
    expect(within(outputType).getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Video guidance' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toBeInTheDocument();
    expect(screen.getByTestId('space-studio-generate')).toHaveTextContent('Generate image');
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
