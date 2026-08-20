import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorStagingMap } from '@/types/director';
import { nearestFovAnchor, opticsBlock, FOV_ANCHORS } from '@/lib/director/craft/optics';
import { weakSpatialWordsIn } from '@/lib/director/craft/blocking';
import { illustrationTriggersIn, prefixIsBloated } from '@/lib/director/craft/look';
import {
  compileActingBlock,
  compileClipBody,
  compileVoiceBlock,
  voicesFromBreakdown,
} from '@/lib/director/prompt-compiler';
import {
  bleedTokensIn,
  bumpStagingVersion,
  assignStagingFigures,
  stagingConnectorBlock,
  stagingDiagramPrompt,
  stagingTagFor,
} from '@/lib/director/staging-map';

const clip: DirectorClip = {
  id: '2-1a',
  title: 'The coin stops',
  seconds: 14,
  sceneId: 's1',
  beats: [
    {
      n: 1,
      from: '0:00',
      to: '0:07',
      dur: 7,
      text: 'The passenger\'s story falls apart.',
      cam: 'locked on the mirror',
      quote: 'I have the money.',
      speaker: '@Passenger',
    },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'The coin stops mid-roll.', cam: 'locked' },
  ],
  subject: 'a lie collapsing in a parked cab',
  location: 'a cab at a night kerb',
  blocking: '@Viktor fills the driver\'s seat, torso squared to the windscreen, eyes locked on the rear-view mirror.',
  fov: 18,
  acting: [{
    tag: '@Viktor',
    motive: 'he has waited his whole life and will not be hurried by a child',
    goal: 'make the kid say it himself',
    obstacle: 'the kid is frightened enough to keep lying',
    tactic: 'presses with silence, checking both of the kid\'s eyes in the mirror for the moment the story gives',
    moments: ['"I have the money." — lets it sit, watches the hands rather than the face'],
  }],
  style: 'Dominant sodium amber 60% / Secondary wet black 30% / Accent the coin 10%.',
  constraints: 'CONSTRAINTS — TOTAL RUNTIME 14 SECONDS. NO slow-motion.',
  elementTags: ['@Viktor', '@Passenger'],
  activeVariant: { kind: 'full' },
  bodyEdits: {},
  takes: [],
};

describe('optics', () => {
  it('snaps an arbitrary field of view to a CINEDANCE anchor', () => {
    expect(nearestFovAnchor(50)).toBe(47);
    expect(nearestFovAnchor(20)).toBe(18);
    expect(nearestFovAnchor(200)).toBe(107);
    expect(FOV_ANCHORS).toContain(nearestFovAnchor(1));
  });

  it('pairs each lens with the drift it is prone to', () => {
    expect(opticsBlock(18)).toContain('No part of this shot becomes wide-angle or normal-lens coverage');
    expect(opticsBlock(18)).toContain('never from switching lenses');
    expect(opticsBlock(107)).toContain('No part of this shot becomes telephoto portrait coverage');
    expect(opticsBlock(47)).toContain('human-eye neutral');
  });

  it('never leaks lens metadata into the written block', () => {
    for (const fov of FOV_ANCHORS) {
      expect(opticsBlock(fov)).not.toMatch(/\d+mm|f\/\d|ISO/);
    }
  });
});

describe('blocking guards', () => {
  it('flags weak proximity words that let geography drift', () => {
    expect(weakSpatialWordsIn('He stands near the car, beside the kerb')).toEqual(['near', 'beside']);
    expect(weakSpatialWordsIn('He stands within 1 meter of the car, one hand on the hood')).toEqual([]);
  });
});

describe('look guards', () => {
  it('catches illustration triggers and bloat', () => {
    expect(illustrationTriggersIn('A painterly character reference sheet')).toEqual([
      'painterly',
      'character reference sheet',
    ]);
    expect(prefixIsBloated('short prefix')).toBe(false);
    expect(prefixIsBloated('x'.repeat(2400))).toBe(true);
  });
});

describe('acting and voice compilation', () => {
  it('writes the task as verbs at the partner plus the eye-life safety line', () => {
    const block = compileActingBlock(clip.acting);
    expect(block).toContain('ACTING TASK — @Viktor');
    expect(block).toContain('MOTIVE (his fuel):');
    expect(block).toContain('OBSTACLE:');
    expect(block).toContain('Moment to moment:');
    expect(block).toContain('never a frozen, glassy, unfocused stare');
  });

  it('omits the block entirely when no character has a task', () => {
    expect(compileActingBlock(undefined)).toBe('');
    expect(compileActingBlock([])).toBe('');
  });

  it('compiles tig SCENE DIRECTION from the scene event', () => {
    const block = compileActingBlock(clip.acting, { event: 'keep the lie from landing' });
    expect(block).toContain('SCENE DIRECTION (shared, unspoken): keep the lie from landing');
  });

  it('pastes a locked voice only for characters who actually speak', () => {
    const voices = { '@Viktor': '"A 60-year-old ex-boxer."', '@Passenger': '"A frightened 19-year-old."' };
    const block = compileVoiceBlock(clip, voices);
    expect(block).toContain("Passenger's voice:");
    expect(block).not.toContain('@Viktor');
  });

  it('omits voice when the speaker has no locked prompt', () => {
    expect(compileVoiceBlock(clip, { '@Viktor': '"A 60-year-old ex-boxer."' })).toBe('');
  });

  it('collects locked voices from characters only', () => {
    const voices = voicesFromBreakdown([
      { id: '1', kind: 'character', name: 'Viktor', tag: '@Viktor', description: '', voice: '"low baritone"' },
      { id: '2', kind: 'prop', name: 'Coin', tag: '@Coin', description: '', voice: '"ignored"' },
      { id: '3', kind: 'character', name: 'Mute', tag: '@Mute', description: '' },
    ]);
    expect(voices).toEqual({ '@Viktor': '"low baritone"' });
  });
});

describe('clip body ordering', () => {
  it('follows the Oneiric heading order', () => {
    const body = compileClipBody(clip, { voices: { '@Passenger': '"A frightened 19-year-old."' } });
    const order = [
      'SCENE CONTEXT', 'ACTIVE REFERENCES', 'LOCATION MAP (exact positions)', 'FORMAT MODE',
      'SEGMENT 1', 'SEGMENT 2', 'DIALOGUE (spoken exactly as written',
      'AUDIO (voice identity only', 'STYLE', 'POSITIVE LOCKS',
    ];
    const positions = order.map((heading) => body.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('writes Oneiric ACTIVE REFERENCES from breakdown copy', () => {
    const body = compileClipBody(
      { ...clip, elementTags: ['@Viktor', '@loc_cab'] },
      {
        breakdown: [
          { id: '1', kind: 'character', name: 'Viktor', tag: '@Viktor', description: 'late-40s, grey stubble, navy coat' },
          { id: '2', kind: 'location', name: 'Night cab', tag: '@loc_cab', description: 'parked cab, sodium amber through the windscreen' },
        ],
      },
    );
    expect(body).toContain('@Viktor: late-40s, grey stubble, navy coat. 100% matches the reference.');
    expect(body).toContain('@loc_cab: parked cab, sodium amber through the windscreen. Controls architecture, materials, clutter, and light only. 100% matches the reference.');
  });

  it('puts beat camera language on the SEGMENT heading and LENS line', () => {
    const body = compileClipBody(clip);
    expect(body).toContain('SEGMENT 1 — locked on the mirror (~0:00–0:07)');
    expect(body).toContain('LENS: locked on the mirror');
    expect(body).not.toContain('CAMERA — SHOT 1:');
  });

  it('puts a clip-level CAMERA note under FORMAT MODE', () => {
    const body = compileClipBody({ ...clip, camera: 'ONE continuous shot on a BREATHING HANDHELD' });
    expect(body).toContain('ONE continuous shot on a BREATHING HANDHELD');
    expect(body.indexOf('FORMAT MODE')).toBeLessThan(body.indexOf('SEGMENT 1'));
    expect(body.indexOf('FORMAT MODE')).toBeLessThan(body.indexOf('ONE continuous shot on a BREATHING HANDHELD'));
  });

  it('leaves a clip without craft fields exactly as it was', () => {
    const plain = { ...clip, blocking: undefined, fov: undefined, acting: undefined, staging: undefined };
    const body = compileClipBody(plain);
    expect(body).not.toContain('FIRST FRAME AND BLOCKING —');
    expect(body).not.toContain('OPTICS —');
    expect(body).not.toContain('ACTION TASK:');
    expect(body).not.toContain('ACTING TASK —');
    expect(body).not.toContain('AUDIO (voice identity only');
  });

  it('puts physical action on SCENE CONTEXT and scene direction on the acting task', () => {
    const body = compileClipBody(clip, {
      event: 'keep the lie from landing',
      physicalAction: 'waiting in a parked cab',
    });
    expect(body).toContain('Physical action: waiting in a parked cab');
    expect(body).toContain('SCENE DIRECTION (shared, unspoken): keep the lie from landing');
    expect(body).toContain('ACTING TASK — @Viktor');
  });
});

describe('staging map', () => {
  const map: DirectorStagingMap = {
    enabled: true,
    stagingTag: '@staging_ONEIRIC_ward_v1',
    locationTag: '@loc_ONEIRIC_ward_s11_v1',
    figures: [
      { letter: 'A', color: 'muted blue', tag: '@Alfie', position: 'centre, supine on the bed, facing up' },
      { letter: 'B', color: 'muted orange', tag: '@Medic', position: 'frame-left, standing, facing the bed' },
    ],
  };

  it('binds letters to colours in prompt text only', () => {
    const block = stagingConnectorBlock(map);
    expect(block).toContain('@A = the MUTED BLUE figure');
    expect(block).toContain('@B = the MUTED ORANGE figure');
    expect(block).toContain('POSITION REFERENCE ONLY');
  });

  it('keeps graphic vocabulary out of the video prompt, even as negation', () => {
    expect(bleedTokensIn(stagingConnectorBlock(map))).toEqual([]);
  });

  it('allows graphic vocabulary in the diagram prompt, which never reaches the video context', () => {
    const prompt = stagingDiagramPrompt({ figures: map.figures, aspectRatio: '16:9' });
    expect(prompt).toContain('LINE DRAWING');
    expect(prompt).toContain('Do NOT complete cropped bodies');
    expect(prompt).toContain('2 outline figures');
    expect(prompt).toContain('--ar 16:9');
  });

  it('assigns one distinct muted colour and letter per figure', () => {
    const figures = assignStagingFigures(['@A-Tag', '@B-Tag', '@C-Tag']);
    expect(figures.map((figure) => figure.letter)).toEqual(['A', 'B', 'C']);
    expect(new Set(figures.map((figure) => figure.color)).size).toBe(3);
  });

  it('bumps the version so a retake never reuses a stale map', () => {
    expect(bumpStagingVersion('@staging_ONEIRIC_ward_v1')).toBe('@staging_ONEIRIC_ward_v2');
    expect(bumpStagingVersion('@staging_ONEIRIC_ward')).toBe('@staging_ONEIRIC_ward_v2');
  });

  it('upper-cases the project in a staging tag', () => {
    expect(stagingTagFor('oneiric', 'ward', 3)).toBe('@staging_ONEIRIC_ward_v3');
  });

  it('emits nothing while the map is disabled', () => {
    expect(compileClipBody({ ...clip, staging: { ...map, enabled: false } })).not.toContain('@staging_');
  });
});
