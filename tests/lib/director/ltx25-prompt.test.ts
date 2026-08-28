import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorShow } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  compileLtx25DirectorPrompt,
  LTX25_PROMPT_MAX_CHARS,
  LTX25_PROMPT_MAX_WORDS,
} from '@/lib/director/ltx25-prompt';
import { runpodLtx25Adapter, seedance25Adapter } from '@/lib/director/video-adapter';

function richFixture(): { show: DirectorShow; clip: DirectorClip } {
  const clip: DirectorClip = {
    id: '1-a',
    title: 'Peter signs the waiver',
    seconds: 20,
    sceneId: 'scene-1',
    subject: 'Peter signs the waiver while Dr Jordan watches for hesitation.',
    location: '@Office, late afternoon, warm desk lamp reflected in dark walnut.',
    blocking: '@Peter sits frame left at the desk; @Dr-Jordan stands frame right, facing him.',
    fov: 47,
    style: 'Natural live-action photography, warm amber light, dark walnut and muted green.',
    constraints: 'Keep identity, wardrobe, screen direction, and the waiver consistent across every cut.',
    acting: [
      {
        tag: '@Peter',
        motive: 'prove he understands the risk without asking for reassurance',
        goal: 'sign before doubt becomes visible',
        obstacle: 'his hand gives away the hesitation he is hiding',
        tactic: 'keeps his eyes on the signature line and measures Jordan in the desk reflection',
        moments: ['the pen pauses once, then commits'],
      },
      {
        tag: '@Dr-Jordan',
        motive: 'make consent unmistakably voluntary',
        goal: 'hear Peter state the decision clearly',
        obstacle: 'Peter is performing confidence',
        tactic: 'waits without rescuing him from the silence',
      },
    ],
    elementTags: ['@Peter', '@Dr-Jordan', '@Office', '@Waiver'],
    beats: [
      {
        n: 1, from: '0:00', to: '0:05', dur: 5,
        text: '@Peter sits with the pen hovering above the signature line.',
        cam: 'medium two-shot at eye level',
        speaker: '@Dr-Jordan', quote: 'You can still walk away.',
      },
      {
        n: 2, from: '0:05', to: '0:10', dur: 5,
        text: '@Peter looks up once, then returns his eyes to the waiver.',
        cam: 'medium close-up on Peter',
        speaker: '@Peter', quote: 'I know.',
      },
      {
        n: 3, from: '0:10', to: '0:15', dur: 5,
        text: 'The pen touches paper and his signature begins in one deliberate stroke.',
        cam: 'insert close-up of the pen and waiver',
      },
      {
        n: 4, from: '0:15', to: '0:20', dur: 5,
        text: '@Dr-Jordan watches @Peter finish, then takes the signed waiver without breaking eye contact.',
        cam: 'medium close-up on Dr Jordan',
      },
    ],
    activeVariant: { kind: 'full' },
    bodyEdits: {},
    takes: [],
  };
  const empty = createEmptyDirectorShow();
  const show: DirectorShow = {
    ...empty,
    adapterId: 'runpod-ltx-2.5',
    generateAudio: true,
    scenes: [{
      id: 'scene-1', number: 1, label: 'INT. DR. JORDAN\'S OFFICE - DAY',
      summary: 'Peter signs.', elementIds: [], clipIds: [clip.id],
      physicalAction: 'Peter reviews and signs a waiver.',
      event: 'Peter must own the decision without being pushed.',
    }],
    breakdown: [
      { id: 'p', kind: 'character', name: 'Peter', tag: '@Peter', description: 'a lean young man with close dark curls and a faded green cardigan', voice: 'a soft American tenor, measured and dry' },
      { id: 'j', kind: 'character', name: 'Dr Jordan', tag: '@Dr-Jordan', description: 'a composed doctor with silver-rimmed glasses and a charcoal shirt', voice: 'a low precise American alto' },
      { id: 'o', kind: 'location', name: 'Office', tag: '@Office', description: 'a compact dark-walnut office lit by one warm desk lamp' },
      { id: 'w', kind: 'prop', name: 'waiver', tag: '@Waiver', description: 'a cream legal form with a black signature line' },
    ],
    lookBible: {
      ...empty.lookBible,
      notes: 'Restrained naturalistic live action with warm practical light, subtle film grain, realistic skin and quiet room tone.',
    },
    clips: [clip],
  };
  return { show, clip };
}

describe('LTX-2.5 Director prompt compiler', () => {
  it('turns a rich four-shot clip into one bounded natural-language paragraph', () => {
    const { show, clip } = richFixture();
    const result = compileLtx25DirectorPrompt({ show, clip, variant: { kind: 'full' }, hasFirstFrame: true });

    expect(result.durationSec).toBe(20);
    expect(result.prompt.length).toBeLessThanOrEqual(LTX25_PROMPT_MAX_CHARS);
    expect(result.prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(LTX25_PROMPT_MAX_WORDS);
    expect(result.prompt.match(/A hard cut transitions to/g)).toHaveLength(3);
    expect(result.prompt).toContain('"You can still walk away."');
    expect(result.prompt).toContain('"I know."');
    expect(result.prompt).toContain('close dark curls and a faded green cardigan');
    expect(result.prompt).toContain('silver-rimmed glasses and a charcoal shirt');
    expect(result.prompt).toContain('Office, late afternoon, warm desk lamp reflected in dark walnut');
    expect(result.prompt).toContain('Room tone continues across every cut');
    expect(result.prompt).not.toMatch(/SCENE CONTEXT|ACTIVE REFERENCES|SEGMENT 1|POSITIVE LOCKS/);
    expect(result.prompt).not.toContain('@Peter');
    expect(result.prompt).not.toContain('\n');
  });

  it('is deterministic, honors a concise manual body direction, and never mutates the show', () => {
    const { show, clip } = richFixture();
    clip.bodyEdits.full = 'Peter keeps the pen hovering for one full breath before the signature becomes decisive.';
    const before = structuredClone(show);

    const first = compileLtx25DirectorPrompt({ show, clip, variant: { kind: 'full' } });
    const second = compileLtx25DirectorPrompt({ show, clip, variant: { kind: 'full' } });

    expect(first.prompt).toBe(second.prompt);
    expect(first.prompt).toContain('Peter keeps the pen hovering for one full breath before the signature becomes decisive.');
    expect(first.prompt).not.toContain('returns his eyes to the waiver');
    expect(first.prompt).not.toContain('signature begins in one deliberate stroke');
    expect(show).toEqual(before);
  });

  it('uses edited segment action without shipping the old structured headings', () => {
    const { show, clip } = richFixture();
    clip.bodyEdits.full = [
      'SCENE CONTEXT',
      'Peter decides whether to sign.',
      '',
      'SEGMENT 1 — medium two-shot (~0:00–0:05)',
      'Peter steadies the pen against his thumb and waits through one breath.',
      'LENS: medium two-shot',
      '',
      'STYLE',
      'Quiet naturalism with warm practical light.',
    ].join('\n');

    const result = compileLtx25DirectorPrompt({ show, clip, variant: { kind: 'full' } });
    expect(result.prompt).toContain('Peter steadies the pen against his thumb and waits through one breath');
    expect(result.prompt).not.toContain('SCENE CONTEXT');
    expect(result.prompt).not.toContain('SEGMENT 1');
  });

  it('keeps native isolates continuous and uses the selected beat duration', () => {
    const { show, clip } = richFixture();
    const result = compileLtx25DirectorPrompt({
      show,
      clip,
      variant: { kind: 'isolated', beatN: 2, mode: 'native' },
      hasFirstFrame: true,
    });

    expect(result.durationSec).toBe(5);
    expect(result.prompt).toContain('In one continuous take');
    expect(result.prompt).toContain('"I know."');
    expect(result.prompt).not.toContain('A hard cut transitions to');
  });

  it('wires only RunPod through the concise compiler', () => {
    const { show, clip } = richFixture();
    const runpod = runpodLtx25Adapter.buildRequest({ show, clip, variant: { kind: 'full' } });
    const seedance = seedance25Adapter.buildRequest({ show, clip, variant: { kind: 'full' } });

    expect(runpod.prompt).toContain('A hard cut transitions to');
    expect(runpod.prompt).not.toContain('SEGMENT 1');
    expect(seedance.prompt).toContain('SEGMENT 1');
    expect(seedance.prompt).toContain('ACTIVE REFERENCES');
  });
});
