import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorScene } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  applyStagingToScene, bindStagingDiagram, characterTagsForStaging, ensureClipStaging,
  listedStagingMediaUrl, matchListedStagingJob,
} from '@/lib/director/staging-diagram';
import { collectClipElementRefs } from '@/lib/director/generate';

const scene: DirectorScene = {
  id: 's1', number: 1, label: 'SCENE 1 — WARD', summary: '', elementIds: [], clipIds: ['a', 'b'],
};

const clip = (id: string, extra?: Partial<DirectorClip>): DirectorClip => ({
  id, title: id, seconds: 14, sceneId: 's1',
  beats: [{ n: 1, from: '0:00', to: '0:14', dur: 14, text: '@Peter sits.' }],
  subject: 'a talk', location: 'the ward', style: '', constraints: '',
  elementTags: ['@Peter', '@Jordan', '@loc_ward'],
  activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
  ...extra,
});

describe('staging diagram bind', () => {
  it('uses character tags only for the letter legend', () => {
    expect(characterTagsForStaging(clip('a'), [
      { id: '1', kind: 'character', name: 'Peter', tag: '@Peter', description: '' },
      { id: '2', kind: 'character', name: 'Jordan', tag: '@Jordan', description: '' },
      { id: '3', kind: 'location', name: 'Ward', tag: '@loc_ward', description: '' },
    ])).toEqual(['@Peter', '@Jordan']);
  });

  it('keeps an existing figure list when ensuring a map', () => {
    const existing = clip('a', {
      staging: {
        enabled: false,
        stagingTag: '@staging_SHOW_ward_v1',
        locationTag: '@loc_SHOW_ward_s1_v1',
        figures: [{ letter: 'A', color: 'muted blue', tag: '@Peter', position: 'centre' }],
      },
    });
    expect(ensureClipStaging(existing, 'SCENE 1 — WARD').figures).toHaveLength(1);
  });

  it('binds the returned schematic onto the clip and the breakdown', () => {
    const show = bindStagingDiagram({
      show: { ...createEmptyDirectorShow(), scenes: [scene], clips: [clip('a'), clip('b')] },
      clipId: 'a',
      diagramUrl: 'https://cdn/map.png',
      elementId: 'el-map',
      scope: 'clip',
    });
    expect(show.clips[0].staging).toMatchObject({
      enabled: true,
      diagramUrl: 'https://cdn/map.png',
      elementId: 'el-map',
      status: 'ready',
      scope: 'clip',
    });
    expect(show.breakdown.some((entry) => entry.tag === show.clips[0].staging?.stagingTag && entry.elementId === 'el-map')).toBe(true);
    expect(show.clips[1].staging?.diagramUrl).toBeUndefined();
  });

  it('copies the map onto every clip in the scene', () => {
    const bound = bindStagingDiagram({
      show: { ...createEmptyDirectorShow(), scenes: [scene], clips: [clip('a'), clip('b')] },
      clipId: 'a',
      diagramUrl: 'https://cdn/map.png',
      elementId: 'el-map',
      jobId: 'job-map',
      scope: 'scene',
    });
    expect(bound.clips[1].staging).toMatchObject({
      enabled: true,
      diagramUrl: 'https://cdn/map.png',
      jobId: 'job-map',
      scope: 'scene',
    });
    const copied = applyStagingToScene(bound, 's1', bound.clips[0].staging!);
    expect(copied.clips[1].staging?.stagingTag).toBe(bound.clips[0].staging?.stagingTag);
  });

  it('attaches a diagram URL last even without a library still yet', () => {
    const target = clip('a', {
      elementTags: ['@Peter'],
      staging: {
        enabled: true,
        stagingTag: '@staging_ward_v1',
        locationTag: '@loc_ward',
        figures: [],
        diagramUrl: 'https://cdn/map.png',
      },
    });
    expect(collectClipElementRefs(target, [
      { id: '1', kind: 'character', name: 'Peter', tag: '@Peter', description: '', elementId: 'el-peter' },
    ], [
      { id: 'el-peter', name: 'Peter', type: 'character', description: '', images: [{ id: 'i1', url: 'https://cdn/peter.png', createdAt: '', source: 'upload' }], createdAt: '', updatedAt: '' },
    ])).toEqual(['https://cdn/peter.png', 'https://cdn/map.png']);
  });
});

const NANO_PRO_JOB = {
  id: '213375f2-df1d-45f5-8acb-a0c4fad312b7',
  job_type: 'nano_banana_pro',
  status: 'completed',
  result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_20260820_162836_213375f2.png',
  min_result_url: 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_20260820_162836_213375f2_min.webp',
  params: {
    prompt: 'The attached image is a COMPOSITION-ONLY guide: copy its exact framing.\nFlat minimalist technical LINE DRAWING, a staging plan for a film scene.',
    input_images: [{ url: 'https://cdn/liked-frame.jpg' }],
    aspect_ratio: '16:9',
  },
};

describe('staging diagram Higgsfield list match', () => {
  it('reads result_url and ignores the input still and min thumbnail', () => {
    expect(listedStagingMediaUrl(NANO_PRO_JOB)).toBe(NANO_PRO_JOB.result_url);
  });

  it('matches Nano Banana Pro list rows by the composition-only prompt', () => {
    expect(matchListedStagingJob([
      { id: 'seedance', job_type: 'seedance_2_5', status: 'completed', result_url: 'https://cdn/take.mp4' },
      NANO_PRO_JOB,
    ])).toMatchObject({ id: NANO_PRO_JOB.id });
  });

  it('matches a stored job set id against the listed child', () => {
    expect(matchListedStagingJob([
      { ...NANO_PRO_JOB, job_set_id: 'set-id' },
    ], { jobId: 'set-id' })?.id).toBe(NANO_PRO_JOB.id);
  });

  it('ignores in-flight image jobs without a result url', () => {
    expect(matchListedStagingJob([
      { id: 'running', job_type: 'nano_banana_pro', status: 'running', params: { prompt: NANO_PRO_JOB.params.prompt } },
    ])).toBeUndefined();
  });
});
