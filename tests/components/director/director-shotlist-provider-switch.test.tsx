import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectorShotlistTab } from '@/components/director/director-shotlist-tab';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import type { DirectorClip, DirectorScene, DirectorShow } from '@/types/director';

const scenes: DirectorScene[] = [
  {
    id: 'scene-1',
    number: 1,
    label: 'INT. OFFICE - NIGHT',
    summary: 'Peter signs the waiver while Jordan watches.',
    elementIds: [],
    clipIds: ['clip-a', 'clip-b'],
  },
];

const clips: DirectorClip[] = [
  {
    id: 'clip-a',
    sceneId: 'scene-1',
    title: 'Peter signs',
    seconds: 10,
    subject: '@Peter signs the waiver under pressure.',
    location: 'A dim medical office at night.',
    intent: 'The decision becomes irreversible.',
    style: 'Naturalistic tungsten light and restrained camera work.',
    constraints: 'Hard cuts only. Preserve screen direction.',
    elementTags: ['@Peter', '@Jordan'],
    activeVariant: { kind: 'full' },
    bodyEdits: {},
    takes: [],
    beats: [
      {
        n: 1,
        from: '0:00',
        to: '0:05',
        dur: 5,
        cam: 'MEDIUM, 50mm, locked',
        text: '@Peter reads the final line, then grips the pen.',
      },
      {
        n: 2,
        from: '0:05',
        to: '0:10',
        dur: 5,
        cam: 'CLOSE, 85mm, slow push-in',
        text: '@Peter signs as @Jordan watches without moving.',
        speaker: '@Jordan',
        quote: 'There is no going back now.',
      },
    ],
  },
  {
    id: 'clip-b',
    sceneId: 'scene-1',
    title: 'Jordan takes the page',
    seconds: 10,
    subject: '@Jordan takes possession of the signed waiver.',
    location: 'The same dim medical office at night.',
    intent: 'Control shifts from Peter to Jordan.',
    style: 'Naturalistic tungsten light and restrained camera work.',
    constraints: 'Hard cuts only. Preserve screen direction.',
    elementTags: ['@Peter', '@Jordan'],
    activeVariant: { kind: 'full' },
    bodyEdits: {},
    takes: [],
    beats: [
      {
        n: 1,
        from: '0:00',
        to: '0:04',
        dur: 4,
        cam: 'INSERT, 85mm, locked',
        text: '@Jordan slides the signed page away from @Peter.',
      },
      {
        n: 2,
        from: '0:04',
        to: '0:10',
        dur: 6,
        cam: 'TWO SHOT, 50mm, locked',
        text: '@Peter releases the page and @Jordan files it.',
      },
    ],
  },
];

function project(adapterId: string): DirectorShow {
  return {
    ...createEmptyDirectorShow(),
    sourceText: 'INT. OFFICE - NIGHT\nPeter signs the waiver.',
    adapterId,
    mode: 'shotlist',
    scenes,
    clips,
  };
}

function props(show: DirectorShow) {
  return {
    show,
    elements: [],
    sceneFilter: null,
    expandRequest: null,
    syncing: false,
    onChange: vi.fn(),
    onShotlist: vi.fn(),
    onStopShotlist: vi.fn(),
    onSceneNotes: vi.fn(async () => true),
    onClipNotes: vi.fn(async () => true),
    onReshotBeat: vi.fn(),
    onReshotClip: vi.fn(),
    onSelectClip: vi.fn(),
  };
}

function openEveryClip(container: HTMLElement) {
  for (const clip of clips) {
    const row = container.querySelector(`[data-clip-row="${clip.id}"]`);
    const head = row?.querySelector<HTMLElement>('.director-tab__cliprow-head');
    if (!head) throw new Error(`Missing shotlist row for ${clip.id}`);
    fireEvent.click(head);
  }
}

function visiblePrompts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-clip-row] .dsl-prompt'))
    .map((entry) => entry.textContent?.trim() ?? '');
}

async function copyEveryPrompt(container: HTMLElement, writeText: ReturnType<typeof vi.fn>) {
  const callCount = writeText.mock.calls.length;
  for (const clip of clips) {
    const row = container.querySelector(`[data-clip-row="${clip.id}"]`);
    if (!row) throw new Error(`Missing shotlist row for ${clip.id}`);
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^(Copy prompt|Copied)$/ }));
  }
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(callCount + clips.length));
  return writeText.mock.calls.slice(callCount).map(([prompt]) => String(prompt));
}

describe('Director shotlist provider switching', () => {
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('re-derives every preview and copied prompt, then restores Seedance without changing clips', async () => {
    const seedance = project('seedance-2.5');
    const originalClips = structuredClone(seedance.clips);
    const view = render(<DirectorShotlistTab {...props(seedance)} />);
    openEveryClip(view.container);

    const seedancePreviews = visiblePrompts(view.container);
    expect(seedancePreviews).toHaveLength(clips.length);
    expect(seedancePreviews.every((prompt) => prompt.includes('FORMAT MODE'))).toBe(true);
    expect(seedancePreviews.every((prompt) => prompt.includes('SEGMENT 1'))).toBe(true);
    expect(await copyEveryPrompt(view.container, writeText)).toEqual(seedancePreviews);

    const runpod = { ...seedance, adapterId: 'runpod-ltx-2.5' };
    view.rerender(<DirectorShotlistTab {...props(runpod)} />);

    const ltxPreviews = visiblePrompts(view.container);
    expect(ltxPreviews).toHaveLength(clips.length);
    expect(ltxPreviews).not.toEqual(seedancePreviews);
    expect(ltxPreviews.every((prompt) => !prompt.includes('SCENE CONTEXT'))).toBe(true);
    expect(ltxPreviews.every((prompt) => !prompt.includes('SEGMENT 1'))).toBe(true);
    expect(await copyEveryPrompt(view.container, writeText)).toEqual(ltxPreviews);

    view.rerender(<DirectorShotlistTab {...props(seedance)} />);

    expect(visiblePrompts(view.container)).toEqual(seedancePreviews);
    expect(await copyEveryPrompt(view.container, writeText)).toEqual(seedancePreviews);
    expect(seedance.clips).toEqual(originalClips);
    expect(runpod.clips).toEqual(originalClips);
  });
});
