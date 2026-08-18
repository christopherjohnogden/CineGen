import { describe, expect, it } from 'vitest';
import { parseBreakdownPayload } from '@/lib/director/breakdown';
import { parseShotlistPayload } from '@/lib/director/shotlist';
import { breakdownJobInput, lookBibleJobInput, shotlistJobInput } from '@/lib/director/job-inputs';
import { createEmptyDirectorShow } from '@/lib/director/create-show';

describe('breakdown payload', () => {
  const parsed = parseBreakdownPayload({
    items: [
      {
        kind: 'character',
        name: 'Viktor',
        description: 'retired night-cab driver',
        actingProfile: 'Character acting as VIKTOR. Early 60s, heavy build...',
        voice: '"A 60-year-old ex-boxer, working-class city accent."',
      },
      { kind: 'prop', name: 'Coin', description: 'a worn brass coin' },
    ],
    scenes: [{
      number: 11,
      label: 'SCENE 11 — ROUNDS',
      summary: 'Two men over a third.',
      event: 'The search for self-forgiveness',
      physicalAction: 'routine rounds',
    }],
  });

  it('keeps the acting profile and locked voice on characters', () => {
    const viktor = parsed.items[0];
    expect(viktor.actingProfile).toContain('Character acting as VIKTOR');
    expect(viktor.voice).toContain('ex-boxer');
    expect(viktor.tag).toBe('@Viktor');
  });

  it('leaves acting fields off items that were given none', () => {
    expect(parsed.items[1].actingProfile).toBeUndefined();
    expect(parsed.items[1].voice).toBeUndefined();
  });

  it('carries the scene event and its physical action', () => {
    expect(parsed.scenes[0].event).toBe('The search for self-forgiveness');
    expect(parsed.scenes[0].physicalAction).toBe('routine rounds');
  });
});

describe('shotlist payload', () => {
  const parsed = parseShotlistPayload({
    scenes: [{ id: 'scene-11', number: 11, label: 'SCENE 11 — ROUNDS', summary: '', event: 'self-forgiveness' }],
    clips: [{
      id: '11-1a',
      title: 'Rounds',
      seconds: 10,
      sceneId: 'scene-11',
      blocking: '@Medic stands within 1 meter of the bed, one hand on the rail.',
      fov: 30,
      elementTags: ['@Medic'],
      acting: [{ tag: 'Medic', motive: 'penance', goal: 'earn forgiveness', obstacle: 'the doctor watching', tactic: 'cares for the man, not the chart', moments: ['"Poor bastard." — the line breaks'] }],
      staging: {
        stagingTag: '@staging_ONEIRIC_ward_v1',
        locationTag: '@loc_ONEIRIC_ward_s11_v1',
        figures: [{ tag: '@Medic', position: 'frame-left, facing the bed' }],
      },
      beats: [{ n: 1, dur: 10, text: 'He checks the man.', quote: 'Poor bastard.', speaker: 'Medic' }],
    }],
  });

  const clip = parsed.clips[0];

  it('snaps a stray field of view onto an anchor', () => {
    expect(clip.fov).toBe(29);
  });

  it('normalises acting and speaker tags to @ form', () => {
    expect(clip.acting?.[0].tag).toBe('@Medic');
    expect(clip.beats[0].speaker).toBe('@Medic');
  });

  it('fills in a letter and colour for a staging figure that came without them', () => {
    expect(clip.staging?.figures[0]).toMatchObject({ letter: 'A', color: 'muted blue', tag: '@Medic' });
    expect(clip.staging?.enabled).toBe(true);
  });

  it('drops a staging map that has no figures to bind', () => {
    const bare = parseShotlistPayload({
      clips: [{
        id: '1a',
        title: 'x',
        seconds: 5,
        staging: { stagingTag: '@staging_X_v1', locationTag: '@loc_X_v1', figures: [] },
        beats: [{ n: 1, dur: 5, text: 'x' }],
      }],
    });
    expect(bare.clips[0].staging).toBeUndefined();
  });
});

describe('job inputs', () => {
  const show = {
    ...createEmptyDirectorShow(),
    sourceText: 'INT. CAB — NIGHT',
    breakdown: [{
      id: '1',
      kind: 'character' as const,
      name: 'Viktor',
      tag: '@Viktor',
      description: 'night-cab driver',
      actingProfile: 'Character acting as VIKTOR.',
      voice: '"A 60-year-old ex-boxer."',
    }],
    scenes: [{
      id: 's1',
      number: 1,
      label: 'SCENE 1',
      summary: 'A lie collapses.',
      elementIds: [],
      clipIds: [],
      event: 'The search for self-forgiveness',
      physicalAction: 'routine rounds',
    }],
  };

  it('hands the shotlist job the acting profile, the locked voice and the scene event', () => {
    const input = shotlistJobInput(show, show.scenes[0], false);
    expect(input).toContain('ACTING PROFILE — Character acting as VIKTOR.');
    expect(input).toContain('VOICE (locked, never adapted) — "A 60-year-old ex-boxer."');
    expect(input).toContain('EVENT — The search for self-forgiveness');
    expect(input).toContain('PHYSICAL ACTION — routine rounds');
  });

  it('sends only the selected scene when shotlisting one scene', () => {
    const input = shotlistJobInput({ ...show, scenes: [...show.scenes, { ...show.scenes[0], id: 's2', number: 2, label: 'SCENE 2' }] }, show.scenes[0], true);
    expect(input).toContain('Only this scene:');
    expect(input).not.toContain('SCENE 2');
  });

  it('omits acting lines for characters that have none', () => {
    const input = shotlistJobInput({ ...show, breakdown: [{ ...show.breakdown[0], actingProfile: undefined, voice: undefined }] }, undefined, false);
    expect(input).not.toContain('ACTING PROFILE');
    expect(input).not.toContain('VOICE (locked');
  });

  it('trims the script for the look bible and keeps it whole for the breakdown', () => {
    const long = { ...show, sourceText: 'x'.repeat(9000) };
    expect(lookBibleJobInput(long).length).toBeLessThan(5000);
    expect(breakdownJobInput(long, '')).toContain('x'.repeat(9000));
  });
});
