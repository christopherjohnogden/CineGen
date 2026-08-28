import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectorSetupDrawer } from '@/components/director/director-setup-drawer';
import { DirectorGenerateTab } from '@/components/director/director-generate-tab';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import type { DirectorClip, DirectorShow } from '@/types/director';

const clip: DirectorClip = {
  id: 'clip-1',
  sceneId: 'scene-1',
  title: 'A deliberate turn',
  seconds: 5,
  beats: [{ n: 1, from: '0:00', to: '0:05', dur: 5, text: 'The subject turns toward camera.' }],
  subject: 'The subject turns toward camera.',
  location: 'A quiet studio.',
  intent: 'Reveal the subject.',
  style: 'Cinematic naturalism.',
  constraints: 'One continuous shot.',
  elementTags: [],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes: [],
};

function generateShow(adapterId: string): DirectorShow {
  return {
    ...createEmptyDirectorShow(),
    adapterId,
    mode: 'generate',
    resolution: '720p',
    selectedSceneId: 'scene-1',
    selectedClipId: clip.id,
    scenes: [{
      id: 'scene-1',
      number: 1,
      label: 'SCENE 1 — STUDIO',
      summary: 'The subject turns.',
      elementIds: [],
      clipIds: [clip.id],
    }],
    clips: [clip],
  };
}

describe('Director generation resolution', () => {
  afterEach(cleanup);

  it('offers every Director duration when Topview publishes model-specific limits at runtime', () => {
    render(<DirectorSetupDrawer show={createEmptyDirectorShow()} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '10s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '20s' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30s' })).toBeInTheDocument();
  });

  it.each([
    ['Topview AI · Auto', 'topview-auto'],
    ['Higgsfield · Seedance 2.5', 'seedance-2.5'],
    ['RunPod · LTX-2.5', 'runpod-ltx-2.5'],
  ])('offers 720p and 1080p for %s and preserves the selected provider', (_label, adapterId) => {
    const show = { ...createEmptyDirectorShow(), adapterId, resolution: '720p' };
    const onChange = vi.fn();

    render(<DirectorSetupDrawer show={show} onChange={onChange} />);

    const resolution = screen.getByRole('group', { name: 'Output resolution' });
    expect(resolution).toHaveTextContent('720p');
    expect(resolution).toHaveTextContent('1080p');
    expect(screen.queryByRole('button', { name: '480p' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '720p' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '1080p' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      adapterId,
      resolution: '1080p',
    }));
  });

  it('reflects a persisted 1080p selection when the Director project is reopened', () => {
    const show = { ...createEmptyDirectorShow(), resolution: '1080p' };

    render(<DirectorSetupDrawer show={show} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '1080p' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '720p' })).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    ['Topview AI · Auto', 'topview-auto'],
    ['Higgsfield · Seedance 2.5', 'seedance-2.5'],
    ['RunPod · LTX-2.5', 'runpod-ltx-2.5'],
  ])('places the %s resolution choice beside the Director Generate action', (_label, adapterId) => {
    const show = generateShow(adapterId);
    const onChange = vi.fn();

    render(<DirectorGenerateTab
      show={show}
      assets={[]}
      preflight=""
      warnings={[]}
      selectedBeatN={1}
      onSelectBeat={vi.fn()}
      onChange={onChange}
      onGenerate={vi.fn()}
      onClipNotes={vi.fn(async () => true)}
    />);

    expect(screen.getByRole('group', { name: 'Output resolution' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1080p' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      adapterId,
      resolution: '1080p',
    }));
  });
});
