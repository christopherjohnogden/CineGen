import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DirectorStructureRail } from '@/components/director/director-structure-rail';
import type { DirectorClip, DirectorScene, DirectorShow } from '@/types/director';

describe('DirectorStructureRail', () => {
  it('collapses and expands each scene independently', () => {
    const scenes: DirectorScene[] = [
      { id: 'scene-1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: ['1-a'] },
      { id: 'scene-2', number: 2, label: 'EXT. FOREST - NIGHT', summary: '', elementIds: [], clipIds: ['2-a'] },
    ];
    const clip = (id: string, sceneId: string, title: string): DirectorClip => ({
      id, sceneId, title, seconds: 20, elementTags: [], subject: '', location: '', style: '', constraints: '',
      activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
      beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: title }],
    });
    const show = {
      scenes,
      clips: [clip('1-a', 'scene-1', 'Jordan enters'), clip('2-a', 'scene-2', 'Jordan wakes')],
    } as DirectorShow;
    const onSelectScene = vi.fn();

    render(
      <DirectorStructureRail
        show={show}
        filterSceneId={null}
        onShowAll={vi.fn()}
        onSelectScene={onSelectScene}
        onSelectClip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Scene 1' }));
    expect(screen.queryByRole('button', { name: /Jordan enters/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jordan wakes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Scene 1' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByTitle('INT. OFFICE - DAY'));
    expect(onSelectScene).toHaveBeenCalledWith('scene-1');
    expect(screen.getByRole('button', { name: /Jordan enters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Scene 1' })).toHaveAttribute('aria-expanded', 'true');
  });
});
