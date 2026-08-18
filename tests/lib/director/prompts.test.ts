import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { isolatedPrompt, rewritePrefixForIsolate } from '@/lib/director/isolate-prompt';
import { compileClipBody, retimeClipToSeconds, validateClipTimings } from '@/lib/director/prompt-compiler';
import { seedance25Adapter } from '@/lib/director/video-adapter';
import { createEmptyDirectorShow } from '@/lib/director/create-show';

const clip: DirectorClip = {
  id: '2-9b',
  title: 'He turns',
  seconds: 20,
  sceneId: 's9',
  beats: [
    { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'MEDIUM, 50mm, locked, on @Dr-Jordan crouched behind him.', cam: 'MEDIUM, 50mm, locked', quote: 'Peter, is that you?' },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'CLOSE, 85mm, locked, on the boy\'s small hand and the charcoal.', cam: 'CLOSE, 85mm, locked' },
    { n: 3, from: '0:14', to: '0:20', dur: 6, text: 'CLOSE, 85mm, locked, on @Peter-Boy as he TURNS.', cam: 'CLOSE, 85mm, locked' },
  ],
  subject: 'the reveal of @Peter-Boy\'s face. MULTISHOT. Emotional beat: mild irritation.',
  location: '@Peter-Camp-Birch is a STYLE AND LAYOUT REFERENCE, not a fixed keyframe.',
  intent: 'ACTION —',
  style: 'Dominant the boy\'s face 60% / Secondary the dark trunk 30% / Accent the charcoal smear 10%.',
  constraints: 'CONSTRAINTS — 16:9. TOTAL RUNTIME 20 SECONDS. NO slow-motion. Hard cuts between shots only.',
  elementTags: ['@Peter-Boy', '@Dr-Jordan'],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes: [],
};

describe('director prompt compiler', () => {
  it('emits parser-owned headings and timed shots', () => {
    const body = compileClipBody(clip);
    expect(body).toContain('ELEMENTS — @Peter-Boy + @Dr-Jordan');
    expect(body).toContain('FORMAT — 20 SECONDS, THREE SHOTS');
    expect(body).toContain('SHOT 1 (0:00–0:07)');
    expect(body).toContain('SHOT 3 (0:14–0:20)');
  });

  it('rejects mistimed clips', () => {
    expect(validateClipTimings({ seconds: 15, beats: clip.beats })).toMatch(/sum to 20s/);
    expect(validateClipTimings(clip)).toBeNull();
  });

  it('retimes shot headings when clip length changes', () => {
    const retimed = retimeClipToSeconds(clip, 15);
    expect(validateClipTimings(retimed)).toBeNull();
    expect(retimed.seconds).toBe(15);
    expect(retimed.beats.reduce((sum, beat) => sum + beat.dur, 0)).toBe(15);
  });
});

describe('director isolate prompt', () => {
  it('rewrites held isolate as a 20s unbroken take', () => {
    const body = isolatedPrompt(clip, 3, 'held', { aspectRatio: '16:9' });
    expect(body).toContain('SINGLE UNBROKEN TAKE, 20 SECONDS');
    expect(body).toContain('BEAT 1 of the same take');
    expect(body).toContain('FAILED TAKE');
    expect(body).not.toContain('THREE SHOTS with hard cuts');
  });

  it('rewrites native isolate to the beat duration', () => {
    const body = isolatedPrompt(clip, 3, 'native', { aspectRatio: '16:9' });
    expect(body).toContain('SINGLE UNBROKEN TAKE, 6 SECONDS');
    expect(body).toContain('one beat lifted out');
    expect(body).toContain('TOTAL RUNTIME IS 6 SECONDS');
    expect(body).not.toContain('BEAT 1 of the same take');
  });

  it('rewrites cut vocabulary in the shared style prefix', () => {
    const prefix = rewritePrefixForIsolate('Lighting identical across every cut. Technical: 24fps smooth motion.');
    expect(prefix).toContain('identical throughout the single continuous take');
    expect(prefix).toContain('ONE continuous unbroken take');
  });
});

describe('seedance 2.5 adapter', () => {
  it('uses multi_prompt for full clips and disables it when isolated', () => {
    const show = createEmptyDirectorShow();
    const full = seedance25Adapter.buildRequest({ show, clip, variant: { kind: 'full' } });
    expect(full.modelId).toBe('seedance_2_5');
    expect(full.params.multi_shots).toBe(true);
    expect(full.params.multi_prompt).toHaveLength(3);
    expect(full.durationSec).toBe(20);

    const native = seedance25Adapter.buildRequest({
      show, clip, variant: { kind: 'isolated', beatN: 3, mode: 'native' },
    });
    expect(native.params.multi_shots).toBe(false);
    expect(native.durationSec).toBe(6);
    expect(native.prompt).toContain('SINGLE UNBROKEN TAKE, 6 SECONDS');
  });

  it('uses stored body edits for the active variant', () => {
    const show = createEmptyDirectorShow();
    const edited = {
      ...clip,
      bodyEdits: { full: 'ELEMENTS — @Edited\n\nFORMAT — 20 SECONDS, THREE SHOTS with hard cuts.' },
    };
    const full = seedance25Adapter.buildRequest({ show, clip: edited, variant: { kind: 'full' } });
    expect(full.prompt).toContain('ELEMENTS — @Edited');
  });
});
