/**
 * Not a test of behaviour: renders the REAL SpaceStudio with fixture state and
 * writes its markup to the scratchpad, so mobile layout can be verified in a
 * real browser against real class names instead of hand-written harness HTML.
 */
import { writeFileSync } from 'node:fs';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { it, vi } from 'vitest';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

const OUT = process.env.STUDIO_DUMP_OUT;

const harness = vi.hoisted(() => ({ dispatch: vi.fn(), state: null as Record<string, unknown> | null }));
const models = vi.hoisted(() => {
  const prompt = { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' };
  return {
    'video-ref': {
      id: 'video-ref-id', nodeType: 'video-ref', name: 'Seedance 2.5', category: 'video', description: '',
      provider: 'topview', outputType: 'video', responseMapping: { path: 'video.url' },
      inputs: [
        prompt,
        { id: 'image_url', portType: 'image', label: 'References', required: false, falParam: 'reference_images', fieldType: 'port', multiple: true, mediaRole: 'image' },
        { id: 'start_frame', portType: 'image', label: 'Start Frame', required: false, falParam: 'image_url', fieldType: 'port', mediaRole: 'start_image' },
        { id: 'end_frame', portType: 'image', label: 'End Frame', required: false, falParam: 'end_frame_url', fieldType: 'port', mediaRole: 'end_image' },
        { id: 'duration', portType: 'number', label: 'Duration', required: false, falParam: 'duration', fieldType: 'select', default: '5',
          options: Array.from({ length: 27 }, (_, i) => ({ value: String(i + 4), label: String(i + 4) })) },
        { id: 'aspect_ratio', portType: 'text', label: 'Aspect Ratio', required: false, falParam: 'aspect_ratio', fieldType: 'select', default: '16:9',
          options: ['16:9', '9:16', '1:1', '4:3'].map((v) => ({ value: v, label: v })) },
        { id: 'resolution', portType: 'text', label: 'Resolution', required: false, falParam: 'resolution', fieldType: 'select', default: '720',
          options: ['480', '720', '1080'].map((v) => ({ value: v, label: v })) },
        { id: 'bitrate', portType: 'text', label: 'Bitrate', required: false, falParam: 'bitrate', fieldType: 'select', default: 'high',
          options: [{ value: 'high', label: 'High', description: 'Less compression · larger size' }, { value: 'standard', label: 'Standard', description: 'More compression · smaller size' }] },
        { id: 'generate_audio', portType: 'number', label: 'Generate Audio', required: false, falParam: 'generate_audio', fieldType: 'toggle', default: true },
      ],
    },
    'image-one': {
      id: 'image-one-id', nodeType: 'image-one', name: 'Seedream 4.5', category: 'image', description: '',
      provider: 'topview', outputType: 'image', responseMapping: { path: 'images[0].url' }, inputs: [prompt],
    },
  } as Record<string, ModelDefinition>;
});

vi.mock('@/components/workspace/workspace-shell', () => ({
  useWorkspace: () => ({ state: harness.state, dispatch: harness.dispatch, projectId: 'dump' }),
}));
vi.mock('@/components/create/nodes/video-node-preview', () => ({
  VideoNodePreview: ({ sourceUrl, className }: { sourceUrl: string; className?: string }) => (
    <video src={sourceUrl} className={className} controls />
  ),
}));
vi.mock('@/components/create/use-topview-model-catalog', () => ({ useTopviewModelCatalogVersion: () => 1 }));
vi.mock('@/lib/fal/models', () => ({ getModelDefinition: (t: string) => models[t] }));
vi.mock('@/lib/workflows/provider-model-options', () => ({
  modelProviderLabel: () => 'Topview AI',
  providerModelOptions: () => [{ key: 'video-ref', label: 'Topview AI · Seedance 2.5' }],
}));
vi.mock('@/lib/elements/variations', () => ({
  elementImagesForVariation: (el: { id: string }) => [{ id: 'i', url: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='%23594a2e'/></svg>` }],
}));
vi.mock('@/lib/workflows/execute', () => ({ executeFromNode: vi.fn() }));
vi.mock('@/lib/llm/space-node-factory', () => ({ createWorkflowNodeFromSpec: vi.fn() }));
vi.mock('@/lib/utils/video-generation-provider', () => ({ getVideoGenerationProvider: () => 'topview' }));
vi.mock('@/lib/providers/project-usage', () => ({ requestProviderUsageRefresh: vi.fn() }));

import { SpaceStudio } from '@/components/create/space-studio';

const PIX = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='%232b3a4a'/></svg>";

const PIX2 = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='%23474b3a'/><circle cx='160' cy='90' r='48' fill='%23b7a27a'/></svg>";
const PIX3 = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='%23393f4a'/><rect x='40' y='30' width='240' height='120' fill='%236f8299'/></svg>";

function node(id: string, config: Record<string, unknown>, result: WorkflowNodeData['result'], gens: string[], type = 'video-ref') {
  return { id, type, position: { x: 0, y: 0 }, data: { type, label: type === 'image-one' ? 'Seedream 4.5' : 'Seedance 2.5', config, generations: gens, result } };
}

it('dumps the rendered Studio markup for mobile layout verification', () => {
  if (!OUT) return;
  const element = { id: 'el-haz', name: 'Hazmat', type: 'character', description: '', images: [{ id: 'i', url: PIX, createdAt: '', source: 'upload' }], createdAt: '', updatedAt: '' };
  const longPrompt = 'uStyle: 8K cinematic. Photorealistic, live-action footage. Cinematography: naturalistic master cinematography. Lighting: Natural light only — high midday sun, contre-jour backlight, atmospheric haze. Color: 60:30:10 — dominant / secondary / accent. Camera: Physical cine lens. 180° shutter motion blur.';
  harness.state = {
    spaces: [{ id: 's', name: 'Space 1', createdAt: '', nodes: [], edges: [] }], activeSpaceId: 's', openSpaceIds: new Set(['s']),
    nodes: [
      node('ready', { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:00:00.000Z', __studioPrompt: '@Hazmat close up on hazmat man in under ground bunker', __studioElementIds: ['el-haz'], __studioElementNames: ['Hazmat'], duration: '5', aspect_ratio: '16:9', resolution: '720', generate_audio: true },
        { status: 'complete', url: PIX }, [PIX]),
      node('running', { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:05:00.000Z', __studioPrompt: longPrompt },
        { status: 'running', progress: 46, progressMessage: 'Topview is rendering the video', progressStartedAt: Date.now() - 84000 }, []),
      node('failed', { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:06:00.000Z', __studioPrompt: 'Push in.' },
        { status: 'error', error: "Error invoking remote method 'topview:submit': Error: Connect your Topview account in Settings before generating." }, []),
      node('img1', { __studioGenerated: true, __studioCreatedAt: '2026-09-01T12:10:00.000Z', __studioPrompt: 'Bearded man kneeling among ferns, overcast light.', resolution: '1080' },
        { status: 'complete', url: PIX2 }, [PIX2], 'image-one'),
      node('img2', { __studioGenerated: true, __studioCreatedAt: '2026-09-01T10:30:00.000Z', __studioPrompt: 'Drawings pinned to the birch trunk.', __studioLiked: true },
        { status: 'complete', url: PIX3 }, [PIX3], 'image-one'),
      node('vid2', { __studioGenerated: true, __studioCreatedAt: '2026-08-31T18:00:00.000Z', __studioPrompt: 'Wide shot of the birch forest, slow push in.', __studioReview: 'approved', duration: '5', aspect_ratio: '16:9', resolution: '720' },
        { status: 'complete', url: PIX }, [PIX]),
      node('img3', { __studioGenerated: true, __studioCreatedAt: '2026-08-31T09:00:00.000Z', __studioPrompt: 'Hand writing in a notebook, warm lamp light.' },
        { status: 'complete', url: PIX2 }, [PIX2], 'image-one'),
    ],
    edges: [], assets: [{ id: 'a1', name: 'first.png', type: 'image', url: PIX, createdAt: '' }], elements: [element], runningNodeIds: new Set(['running']),
    providerUsage: { topview: { connected: true, creditsRemaining: 100, creditsUsed: 0 } },
  };
  // Last visit was at 11:00: later clips are New, and 'ready' was the last one opened.
  localStorage.setItem('cinegen_studio_seen:dump', JSON.stringify({ seenAt: Date.parse('2026-09-01T11:00:00.000Z'), viewed: ['ready'], lastViewed: 'ready' }));
  // jsdom has no matchMedia, so the Studio renders its desktop arrangement by
  // default. Stub it to dump the phone markup instead.
  if (process.env.STUDIO_DUMP_NARROW) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: /max-width:\s*(780|767|900)px/.test(query),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
  }
  const { container } = render(<SpaceStudio />);
  // Put the composer into its fullest state: References mode, one reference, prompt with a tag.
  fireEvent.click(within(screen.getByRole('group', { name: 'Video guidance' })).getByRole('button', { name: process.env.STUDIO_DUMP_FRAMES ? 'Frames' : 'References' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: '@Hazmat close up on hazmat man in under ground bunker' } });
  // Picking an element switches the shot back to References, so the frames dump
  // stops here.
  if (!process.env.STUDIO_DUMP_FRAMES) {
    fireEvent.click(screen.getByTestId('space-studio-elements-chip'));
    fireEvent.click(screen.getByTestId('space-studio-modal-element-el-haz'));
    fireEvent.keyDown(document, { key: 'Escape' });
  }
  if (process.env.STUDIO_DUMP_SHEET) {
    fireEvent.click(screen.getByTestId('space-studio-peek'));
  }
  if (process.env.STUDIO_DUMP_SELECT) {
    fireEvent.click(screen.getByTestId('space-studio-select-ready'));
    fireEvent.click(screen.getByTestId('space-studio-select-img2'));
  }
  if (process.env.STUDIO_DUMP_VIEWER) {
    fireEvent.click(within(screen.getByTestId('space-studio-tile-vid2')).getByRole('button', { name: /^Open / }));
  }
  writeFileSync(OUT, container.innerHTML);
});
