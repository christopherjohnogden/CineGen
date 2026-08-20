import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { clipsForGenerateScope } from '@/lib/director/generate';

const clip = (id: string, sceneId: string, queued?: boolean, altOf?: string): DirectorClip => ({
  id, title: id, seconds: 30, sceneId, altOf, queued, beats: [], subject: '', location: '',
  style: '', constraints: '', elementTags: [], activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
});

const clips = [
  clip('a', 's1'),
  clip('b', 's1', true),
  clip('c', 's2', true),
  clip('c-alt', 's2', false, 'c'),
];

describe('clipsForGenerateScope', () => {
  it('active is the selected clip only', () => {
    expect(clipsForGenerateScope(clips, 'active', 'a').map((entry) => entry.id)).toEqual(['a']);
  });

  it('scene is every non-alt clip in that scene', () => {
    expect(clipsForGenerateScope(clips, 'scene', 'a', 's1').map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(clipsForGenerateScope(clips, 'scene', 'c', 's2').map((entry) => entry.id)).toEqual(['c']);
  });

  it('queued is only ticked clips — empty queue is empty, not the whole show', () => {
    expect(clipsForGenerateScope(clips, 'queued').map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(clipsForGenerateScope(clips.map((entry) => ({ ...entry, queued: false })), 'queued')).toEqual([]);
  });
});
