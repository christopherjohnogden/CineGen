import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { isolatedPrompt, rewritePrefixForIsolate } from '@/lib/director/isolate-prompt';
import { compileClipBody, retimeClipToSeconds, validateClipTimings } from '@/lib/director/prompt-compiler';
import { seedance25Adapter } from '@/lib/director/video-adapter';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { BREAKDOWN_AUDIT_SYSTEM_PROMPT, BREAKDOWN_IDENTIFY_SYSTEM_PROMPT, BREAKDOWN_SYSTEM_PROMPT, shotlistContinueSystemPrompt, shotlistSystemPrompt } from '@/lib/director/llm-jobs';

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

  it('ships the dialogue discipline with any clip that carries a quoted line', () => {
    const body = compileClipBody(clip);
    expect(body).toContain('DIALOGUE — Only the quoted scripted lines are spoken');
    const silent = { ...clip, beats: clip.beats.map((beat) => ({ ...beat, quote: undefined })) };
    expect(compileClipBody(silent)).not.toContain('DIALOGUE —');
  });

  it('formats a single-beat clip as one continuous take, never one shot with cuts', () => {
    const single: DirectorClip = {
      ...clip,
      beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'He holds the look.', cam: 'CLOSE, locked' }],
    };
    const body = compileClipBody(single);
    expect(body).toContain('ONE CONTINUOUS UNBROKEN TAKE');
    expect(body).not.toContain('with hard cuts');
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
    expect(body).toContain('ELEMENTS — @Peter-Boy + @Dr-Jordan');
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
  it('uses the compiled prompt for shots — Seedance 2.5 has no multi_shots flag', () => {
    const show = createEmptyDirectorShow();
    const full = seedance25Adapter.buildRequest({ show, clip, variant: { kind: 'full' } });
    expect(full.modelId).toBe('seedance_2_5');
    expect(full.params).toEqual({
      aspect_ratio: show.aspectRatio,
      duration: 20,
      resolution: show.resolution,
      generate_audio: show.generateAudio,
    });
    expect(full.params).not.toHaveProperty('genre');
    expect(full.params).not.toHaveProperty('multi_shots');
    expect(full.params).not.toHaveProperty('multi_prompt');
    expect(full.durationSec).toBe(20);
    expect(full.prompt).toMatch(/SHOT 1|THREE SHOTS|hard cuts/i);

    const native = seedance25Adapter.buildRequest({
      show, clip, variant: { kind: 'isolated', beatN: 3, mode: 'native' },
    });
    expect(native.params.duration).toBe(6);
    expect(native.params).not.toHaveProperty('multi_shots');
    expect(native.durationSec).toBe(6);
    expect(native.prompt).toContain('SINGLE UNBROKEN TAKE, 6 SECONDS');
  });

  it('attaches element stills as Seedance 2.5 omni_reference images', () => {
    const show = createEmptyDirectorShow();
    const withRefs = seedance25Adapter.buildRequest({
      show, clip, variant: { kind: 'isolated', beatN: 2, mode: 'native' },
      referenceImages: ['https://cdn.example/peter.png', 'https://cdn.example/jordan.png'],
    });
    expect(withRefs.params.mode).toBe('omni_reference');
    expect(withRefs.medias).toEqual([
      { value: 'https://cdn.example/peter.png', role: 'image' },
      { value: 'https://cdn.example/jordan.png', role: 'image' },
    ]);
    expect(withRefs.prompt).toContain('REFERENCE STILLS');
    expect(withRefs.prompt).toContain('ELEMENTS — @Peter-Boy + @Dr-Jordan');
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

describe('shotlist system prompts', () => {
  it('mandates full-scene coverage with page math', () => {
    const prompt = shotlistSystemPrompt(20, '2–3 shots');
    expect(prompt).toMatch(/COVERAGE — this is the most important rule/);
    expect(prompt).toMatch(/first line to its last/);
    expect(prompt).toMatch(/nine-page scene needs twenty or more/);
    expect(prompt).toMatch(/"coveredToEnd"/);
    expect(prompt).toMatch(/never claim true early/);
  });
  it('continuation prompt forbids repeating existing clips and demands the scene END', () => {
    const prompt = shotlistContinueSystemPrompt(20, '2–3 shots');
    expect(prompt).toMatch(/CONTINUATION/);
    expect(prompt).toMatch(/Do NOT repeat/);
    expect(prompt).toMatch(/scene's END/);
    expect(prompt).toMatch(/never invent material past the script/);
  });
  it('batch mode caps clips per response without compressing the scene', () => {
    const prompt = shotlistSystemPrompt(20, '2–3 shots', 6);
    expect(prompt).toMatch(/BATCH MODE — return AT MOST 6 clips/);
    expect(prompt).toMatch(/NEVER compress the scene/);
    expect(shotlistSystemPrompt(20, '2–3 shots')).not.toMatch(/BATCH MODE/);
  });
});

describe('BREAKDOWN_IDENTIFY_SYSTEM_PROMPT', () => {
  it('drops the per-character profile prose (fast identify pass)', () => {
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).not.toMatch(/actingProfile/i);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).not.toMatch(/\bvoice\b/i);
  });
  it('keeps the exhaustive extraction mandate', () => {
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/EXTRACTION COMPLETENESS/);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/VEHICLES/);
  });
  it('asks for a complete list from a specialist, not a delta against a prior parse', () => {
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/professional script supervisor/i);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/COMPLETE "items" list/);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).not.toMatch(/ALREADY IDENTIFIED/);
  });
  it('forces an action-line walk with quoted evidence instead of a noun lexicon', () => {
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/\[A#\] ACTION/);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/"evidence"/);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/script's own noun phrase/);
  });
  it('the full BREAKDOWN_SYSTEM_PROMPT still asks for profiles', () => {
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/actingProfile/);
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/professional script supervisor/i);
  });
  it('audit pass hunts for misses, not a noun lexicon', () => {
    expect(BREAKDOWN_AUDIT_SYSTEM_PROMPT).toMatch(/JUNIOR BREAKDOWN/);
    expect(BREAKDOWN_AUDIT_SYSTEM_PROMPT).toMatch(/\[A#\] ACTION/);
    expect(BREAKDOWN_AUDIT_SYSTEM_PROMPT).not.toMatch(/actingProfile/i);
  });
});
