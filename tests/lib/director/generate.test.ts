import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { clipsForGenerateScope, collectClipElementRefs, generateViewerMessage } from '@/lib/director/generate';

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

  it('active falls back to the first clip when nothing is selected', () => {
    expect(clipsForGenerateScope(clips, 'active').map((entry) => entry.id)).toEqual(['a']);
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

describe('generateViewerMessage', () => {
  const take = (status: 'queued' | 'running' | 'done' | 'failed', error?: string) => ({
    id: 't1', number: 2, variantKey: 'full', status, adapterId: 'seedance-2.5',
    modelId: 'seedance_2_5', promptSnapshot: '', createdAt: '', error,
  });

  it('shows generating copy while a take is in flight', () => {
    expect(generateViewerMessage(take('running'), false)).toBe('T02 generating…');
    expect(generateViewerMessage(take('queued'), false)).toBe('T02 generating…');
  });

  it('surfaces the Higgsfield error instead of "no take yet"', () => {
    expect(generateViewerMessage(take('failed', 'Higgsfield CLI not found'), false))
      .toBe('Higgsfield CLI not found');
    expect(generateViewerMessage(take('failed'), false)).toMatch(/Generation failed/);
  });

  it('is empty when the take already has a video', () => {
    expect(generateViewerMessage(take('done'), true)).toBe('');
  });
});

describe('collectClipElementRefs', () => {
  it('takes the first still from each tagged, linked element', () => {
    const target = clip('a', 's1');
    target.elementTags = ['@Peter', '@Dr-Jordan'];
    target.framingRefOn = true;
    target.framingRefTag = '@Office';
    const urls = collectClipElementRefs(target, [
      { id: '1', kind: 'character', name: 'Peter', tag: '@Peter', description: '', elementId: 'el-peter' },
      { id: '2', kind: 'character', name: 'Jordan', tag: '@Dr-Jordan', description: '', elementId: 'el-jordan' },
      { id: '3', kind: 'location', name: 'Office', tag: '@Office', description: '', elementId: 'el-office' },
    ], [
      { id: 'el-peter', name: 'Peter', type: 'character', description: '', images: [{ id: 'i1', url: 'https://cdn/peter.png', createdAt: '', source: 'upload' }], createdAt: '', updatedAt: '' },
      { id: 'el-jordan', name: 'Dr Jordan', type: 'character', description: '', images: [{ id: 'i2', url: 'https://cdn/jordan.png', createdAt: '', source: 'generated' }], createdAt: '', updatedAt: '' },
      { id: 'el-office', name: 'Office', type: 'location', description: '', images: [{ id: 'i3', url: 'https://cdn/office.png', createdAt: '', source: 'upload' }], createdAt: '', updatedAt: '' },
    ]);
    expect(urls).toEqual(['https://cdn/peter.png', 'https://cdn/jordan.png', 'https://cdn/office.png']);
  });

  it('skips tags with no still', () => {
    const target = clip('a', 's1');
    target.elementTags = ['@Peter'];
    expect(collectClipElementRefs(target, [
      { id: '1', kind: 'character', name: 'Peter', tag: '@Peter', description: '', elementId: 'el-peter' },
    ], [
      { id: 'el-peter', name: 'Peter', type: 'character', description: '', images: [], createdAt: '', updatedAt: '' },
    ])).toEqual([]);
  });
});
