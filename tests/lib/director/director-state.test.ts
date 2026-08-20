import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorTake } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { removeDirectorTake, setHeroTake } from '@/lib/director/director-state';

const take = (id: string, number: number, extra?: Partial<DirectorTake>): DirectorTake => ({
  id,
  number,
  variantKey: extra?.variantKey ?? 'full',
  status: extra?.status ?? 'failed',
  adapterId: 'seedance-2.5',
  modelId: 'seedance_2_5',
  promptSnapshot: '',
  createdAt: '',
  ...extra,
});

const clipWithTakes = (takes: DirectorTake[]): DirectorClip => ({
  id: 'clip-a',
  title: 'Arrival',
  seconds: 20,
  sceneId: 's1',
  beats: [],
  subject: '',
  location: '',
  style: '',
  constraints: '',
  elementTags: [],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes,
});

describe('removeDirectorTake', () => {
  it('drops the take and selects the last remaining sibling in that variant', () => {
    const show = {
      ...createEmptyDirectorShow(),
      selectedTakeId: 't3',
      clips: [clipWithTakes([
        take('t1', 1, { variantKey: '2:native' }),
        take('t2', 2, { variantKey: '2:native' }),
        take('t3', 3, { variantKey: '2:native' }),
        take('full-1', 1),
      ])],
    };
    const next = removeDirectorTake(show, 'clip-a', 't3');
    expect(next.clips[0].takes.map((entry) => entry.id)).toEqual(['t1', 't2', 'full-1']);
    expect(next.selectedTakeId).toBe('t2');
  });

  it('falls back to another variant when the group is emptied', () => {
    const show = {
      ...createEmptyDirectorShow(),
      selectedTakeId: 't1',
      clips: [clipWithTakes([
        take('t1', 1, { variantKey: '2:native' }),
        take('full-1', 1),
      ])],
    };
    const next = removeDirectorTake(show, 'clip-a', 't1');
    expect(next.clips[0].takes.map((entry) => entry.id)).toEqual(['full-1']);
    expect(next.selectedTakeId).toBe('full-1');
  });

  it('clears selection when the last take is deleted', () => {
    const show = {
      ...createEmptyDirectorShow(),
      selectedTakeId: 't1',
      clips: [clipWithTakes([take('t1', 1)])],
    };
    const next = removeDirectorTake(show, 'clip-a', 't1');
    expect(next.clips[0].takes).toEqual([]);
    expect(next.selectedTakeId).toBeUndefined();
  });

  it('leaves another clip take selected when deleting an unselected take', () => {
    const show = {
      ...createEmptyDirectorShow(),
      selectedTakeId: 't1',
      clips: [clipWithTakes([take('t1', 1), take('t2', 2)])],
    };
    const next = removeDirectorTake(show, 'clip-a', 't2');
    expect(next.clips[0].takes.map((entry) => entry.id)).toEqual(['t1']);
    expect(next.selectedTakeId).toBe('t1');
  });

  it('does not promote a remaining take to hero', () => {
    const show = setHeroTake({
      ...createEmptyDirectorShow(),
      clips: [clipWithTakes([take('t1', 1), take('t2', 2)])],
    }, 'clip-a', 't2');
    const next = removeDirectorTake(show, 'clip-a', 't2');
    expect(next.clips[0].takes.find((entry) => entry.id === 't1')?.hero).toBeFalsy();
  });

  it('is a no-op when the take is missing', () => {
    const show = {
      ...createEmptyDirectorShow(),
      selectedTakeId: 't1',
      clips: [clipWithTakes([take('t1', 1)])],
    };
    expect(removeDirectorTake(show, 'clip-a', 'missing')).toBe(show);
  });
});
