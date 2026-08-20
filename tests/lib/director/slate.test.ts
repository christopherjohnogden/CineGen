import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorScene } from '@/types/director';
import { nextTakeNumber, takeDisplayName, variantFolderName, variantKey, variantTakeLabel, isLegacyTakeDisplayName } from '@/lib/director/slate';

const scene: DirectorScene = {
  id: 's9',
  number: 9,
  label: 'SCENE 9 — THE BOY',
  summary: '',
  elementIds: [],
  clipIds: ['2-9b'],
};

const clip: DirectorClip = {
  id: '2-9b',
  title: 'He turns',
  seconds: 20,
  sceneId: 's9',
  beats: [
    { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'medium' },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'insert' },
    { n: 3, from: '0:14', to: '0:20', dur: 6, text: 'close', cam: 'CLOSE, 85mm, locked' },
  ],
  subject: '',
  location: '',
  style: '',
  constraints: '',
  elementTags: [],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes: [
    {
      id: 't1', number: 1, variantKey: 'full', status: 'done',
      adapterId: 'seedance-2.5', modelId: 'seedance_2_5', promptSnapshot: '', createdAt: '',
    },
  ],
};

describe('director slate', () => {
  it('names full and isolated takes with the paper slate, not the stored clip id', () => {
    expect(takeDisplayName(scene, clip, 'full', 3, '9A')).toBe('9A · T03');
    expect(takeDisplayName(scene, clip, '3:held', 1, '9A')).toBe('9A · S3 held · T01');
    expect(takeDisplayName(scene, clip, '3:native', 1, '9A')).toBe('9A · S3 · T01');
  });

  it('increments take numbers per variant', () => {
    expect(nextTakeNumber(clip, 'full')).toBe(2);
    expect(nextTakeNumber(clip, '3:native')).toBe(1);
  });

  it('names variant folders', () => {
    expect(variantFolderName(clip, variantKey({ kind: 'full' }))).toBe('Full');
    expect(variantFolderName(clip, '3:held')).toBe('Shot 3 · 20s');
    expect(variantFolderName(clip, '3:native')).toBe('Shot 3 · 6s');
  });

  it('labels take groups for the Generate board', () => {
    expect(variantTakeLabel(clip, 'full')).toBe('Full');
    expect(variantTakeLabel(clip, '3:native')).toBe('S3 · 6s');
    expect(variantTakeLabel(clip, '3:held')).toBe('S3 · 20s held');
  });

  it('recognizes leaked clip-id take names from the media pool', () => {
    expect(isLegacyTakeDisplayName('S01_1-p0a_S1_T01', '1-p0a')).toBe(true);
    expect(isLegacyTakeDisplayName('S01_1-p0a_S1_T01 failed', '1-p0a')).toBe(true);
    expect(isLegacyTakeDisplayName('1A · S1 · T01', '1-p0a')).toBe(false);
  });
});
