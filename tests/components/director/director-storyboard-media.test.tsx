import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectorStoryboardTab } from '@/components/director/director-storyboard-tab';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import type { DirectorClip, DirectorShow } from '@/types/director';
import type { Asset } from '@/types/project';

const clip: DirectorClip = {
  id: 'clip-1',
  sceneId: 'scene-1',
  title: 'Interlock Your Fingers',
  seconds: 10,
  beats: [{
    n: 1,
    from: '0:00',
    to: '0:10',
    dur: 10,
    text: "Peter studies Jordan's offered hand without moving.",
    cam: '29° short telephoto medium two-shot',
  }],
  subject: 'Peter and Jordan sit opposite one another.',
  location: "Dr. Jordan's office.",
  style: 'Photorealistic cinematic drama.',
  constraints: '',
  elementTags: [],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes: [],
};

function storyboardShow(imageUrl: string, assetId?: string): DirectorShow {
  return {
    ...createEmptyDirectorShow(),
    mode: 'storyboard',
    selectedSceneId: 'scene-1',
    scenes: [{
      id: 'scene-1',
      number: 1,
      label: "SCENE 1 — DR. JORDAN'S OFFICE",
      summary: 'Peter considers an offered hand.',
      elementIds: [],
      clipIds: [clip.id],
    }],
    clips: [clip],
    storyboardFrames: [{
      id: `${clip.id}::1`,
      clipId: clip.id,
      beatN: 1,
      prompt: 'A cinematic two-shot in the office.',
      modelId: 'runpod_sdxl_session',
      status: 'ready',
      imageUrl,
      assetId,
    }],
  };
}

function renderStoryboard(
  show: DirectorShow,
  assets: Asset[] = [],
  session: { ready?: boolean; models?: string[] } = {},
) {
  return render(
    <DirectorStoryboardTab
      show={show}
      assets={assets}
      elements={[]}
      sceneFilter={null}
      expandRequest={null}
      higgsfieldReady
      runpodReady={session.ready ?? true}
      runpodImageModels={session.models ?? ['sdxl']}
      onChange={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe('Director storyboard generated media', () => {
  it('shows the active provider/model route and the model used for a finished frame', () => {
    renderStoryboard({
      ...storyboardShow('https://provider.example/storyboard.png'),
      storyboardModelId: 'runpod_sdxl_session',
    });

    const renderer = screen.getByLabelText('Storyboard image renderer');
    expect(renderer).toHaveTextContent('RunPod Session');
    expect(renderer).toHaveTextContent('SDXL');
    expect(renderer).toHaveTextContent('ready on this RunPod session');
    expect(screen.getByText('Frame model').parentElement).toHaveTextContent('RunPod Session · SDXL');
  });

  it('keeps an existing frame attributed to its completed model while a replacement renders', () => {
    const current = storyboardShow('https://provider.example/storyboard.png');
    current.storyboardModelId = 'runpod_sdxl_session';
    current.storyboardFrames = current.storyboardFrames?.map((frame) => ({
      ...frame,
      modelId: 'nano_banana_2',
      status: 'generating',
    }));
    renderStoryboard(current);

    expect(screen.getByText('Frame model').parentElement).toHaveTextContent('Higgsfield · Nano Banana 2');
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('does not call a frame source-blocked when only its RunPod session is unavailable', () => {
    const current = storyboardShow('https://provider.example/storyboard.png');
    current.storyboardModelId = 'runpod_qwen_image_edit_session';
    current.storyboardFrames = current.storyboardFrames?.map((frame) => ({
      ...frame,
      generatedSourceHash: 'outdated',
      generatedPrompt: frame.prompt,
    }));
    renderStoryboard(current, [], { ready: false, models: ['qwen-image-edit'] });

    expect(screen.getByLabelText('Storyboard image renderer')).not.toHaveTextContent('need a source');
    expect(screen.getByRole('button', { name: 'Session not ready' })).toBeDisabled();
  });

  it('turns a generated frame filesystem path into a browser-safe local-media URL', () => {
    renderStoryboard(storyboardShow('/Users/editor/CineGen/Storyboards/shot 1 #final.png'));

    expect(screen.getByRole('img', {
      name: "1A shot 1: Peter studies Jordan's offered hand without moving.",
    })).toHaveAttribute(
      'src',
      'local-media://file/Users/editor/CineGen/Storyboards/shot%201%20%23final.png',
    );
  });

  it('uses an asset fileRef for a persisted generated frame before its temporary provider URL', () => {
    const asset: Asset = {
      id: 'storyboard-asset-1',
      name: 'Storyboard shot 1',
      type: 'image',
      url: 'https://provider.example/temporary-storyboard.png',
      fileRef: '/Users/editor/CineGen/Storyboards/persisted frame.png',
      createdAt: '2026-08-26T12:00:00.000Z',
    };
    renderStoryboard(
      storyboardShow('https://provider.example/original-storyboard.png', asset.id),
      [asset],
    );

    expect(screen.getByRole('img', {
      name: "1A shot 1: Peter studies Jordan's offered hand without moving.",
    })).toHaveAttribute(
      'src',
      'local-media://file/Users/editor/CineGen/Storyboards/persisted%20frame.png',
    );
  });
});
