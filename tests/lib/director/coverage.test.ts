import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorScene } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  applyCoverageToScene, applyMatchSizeToScene, beatGrammarsForClip, beatInheritsSize, beatScriptContext, beatSetupColors, beatSizeLabel, compileBeatLens, filmicMoveFor,
  grammarChoiceHint, grammarLensLine, inferBeatGrammar, resetBeatToOrigin, resolveBeatGrammar, resolveCameraMove,
} from '@/lib/director/craft/coverage';
import { compileActingBlock, compileClipBody } from '@/lib/director/prompt-compiler';
import { isolatedPrompt } from '@/lib/director/isolate-prompt';

const scene: DirectorScene = {
  id: 's1', number: 1, label: 'SCENE 1 — OFFICE', summary: '', elementIds: [], clipIds: ['a', 'b'],
};

const clip = (id: string, extra?: Partial<DirectorClip>): DirectorClip => ({
  id, title: id, seconds: 14, sceneId: 's1',
  beats: [
    { n: 1, from: '0:00', to: '0:07', dur: 7, text: '@Peter sits.', speaker: '@Peter' },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: '@Jordan answers.', speaker: '@Jordan', cam: 'CLOSE, locked' },
  ],
  subject: 'a talk', location: 'the office', style: '', constraints: '', elementTags: [],
  activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
  ...extra,
});

describe('camera movement', () => {
  it('stays locked until life or an explicit move is asked for', () => {
    expect(resolveCameraMove({}).locked).toBe(true);
    expect(resolveCameraMove({ clip: { move: 'locked', intensity: 0 } }).line).toMatch(/locked off/);
    expect(filmicMoveFor(40, 'cu')).toBe('push-in');
    expect(resolveCameraMove({ clip: { move: 'locked', intensity: 40 }, beat: { size: 'cu' } }).line)
      .toMatch(/dolly in/);
    expect(filmicMoveFor(30, 'ws')).toBe('track-left');
    expect(resolveCameraMove({
      clip: { move: 'locked', intensity: 30 },
      scene: { move: 'crane-up', intensity: 80 },
      beat: { size: 'ws' },
    }).line).toMatch(/track left/);
  });

  it('an explicit dolly writes into LENS and isolation allows only that move', () => {
    const target = clip('a', {
      cameraMove: { move: 'push-in', intensity: 55 },
      beats: [{ n: 1, from: '0:00', to: '0:14', dur: 14, text: 'He waits.', grammar: { size: 'cu', clean: 'clean', bodies: 'one' } }],
    });
    const body = compileClipBody(target);
    expect(body).toContain('close-up, clean, single');
    expect(body).toMatch(/Camera move \(this one only\): measured dolly in/);
    const isolated = isolatedPrompt(target, 1, 'native', { cameraMove: target.cameraMove }) ?? '';
    expect(isolated).toContain('The camera performs only this move');
    expect(isolated).toContain('dolly in toward the subject');
    expect(isolated).not.toContain('no dolly, no crane, no drift');
  });
});

describe('coverage and match', () => {
  it('stamps empty beats from the scene coverage plan', () => {
    const show = applyCoverageToScene(
      { ...createEmptyDirectorShow(), scenes: [scene], clips: [clip('a'), clip('b')] },
      's1',
      ['master', 'singles'],
    );
    expect(show.scenes[0].coverage).toEqual(['master', 'singles']);
    expect(show.clips[0].beats[0].grammar).toMatchObject({ size: 'ws', bodies: 'two' });
    expect(show.clips[0].beats[1].grammar).toMatchObject({ size: 'cu', bodies: 'one' });
  });

  it('copies a liked CU onto every CU in the scene', () => {
    const source = clip('a', {
      beats: [
        { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'Peter.', grammar: { size: 'cu', angle: 'low', clean: 'dirty' } },
        { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'Wide room.', grammar: { size: 'ws' } },
      ],
    });
    const other = clip('b');
    const show = applyMatchSizeToScene(
      { ...createEmptyDirectorShow(), scenes: [scene], clips: [source, other] },
      's1',
      { clipId: 'a', beatN: 1 },
    );
    expect(show.clips[1].beats[1].grammar).toMatchObject({ size: 'cu', angle: 'low', clean: 'dirty' });
    expect(show.clips[0].beats[1].grammar?.size).toBe('ws');
  });

  it('writes a take note and direction chips into ACTING TASK', () => {
    expect(compileActingBlock([{
      tag: '@Peter',
      motive: 'keep the lie',
      goal: 'hold the room',
      obstacle: 'the coin',
      tactic: 'does not look',
      note: 'again, but he does not look until the last word',
      volume: 'under',
      pace: 'hold',
      eyeline: 'down',
    }])).toContain('TAKE NOTE: again, but he does not look until the last word');
  });

  it('spells out the chosen size in plain language', () => {
    expect(grammarChoiceHint({ size: 'ws', angle: 'eye' })).toMatch(/Wide shot/);
    expect(grammarChoiceHint({ size: 'cu', bodies: 'ots', clean: 'dirty' })).toMatch(/Over-the-shoulder/);
  });

  it('reads the LLM beat as framing + action + line', () => {
    expect(beatScriptContext({
      n: 1, from: '0:00', to: '0:06', dur: 6,
      text: 'Peter walks to the bookshelf',
      cam: 'MCU',
      quote: 'Wait what?',
      speaker: '@Peter',
      origin: {
        text: 'Peter walks to the bookshelf',
        dur: 6,
        cam: 'MCU',
        quote: 'Wait what?',
        speaker: '@Peter',
      },
    })).toBe('MCU on Peter — Peter walks to the bookshelf. "Wait what?"');
  });

  it('uses the live coverage heading after a storyboard restage, not the origin CU Two-shot', () => {
    expect(beatScriptContext({
      n: 2, from: '0:05', to: '0:11', dur: 6,
      text: 'it settles into a wide, Peter left, Jordan right',
      cam: 'wide of Peter',
      grammar: { size: 'ws', bodies: 'one' },
      origin: {
        text: 'it settles into a two-shot, Peter left, Jordan right',
        dur: 6,
        cam: 'CU Two-shot on Dr-Jordan',
        grammar: { size: 'cu', bodies: 'two' },
      },
    })).toMatch(/^WS One/);
    expect(beatScriptContext({
      n: 2, from: '0:05', to: '0:11', dur: 6,
      text: 'it settles into a wide',
      cam: 'wide of Peter',
      grammar: { size: 'ws', bodies: 'one' },
      origin: { text: 'it settles into a two-shot', dur: 6, cam: 'CU Two-shot on Dr-Jordan' },
    })).not.toMatch(/Two-shot|CU Two-shot/i);
  });

  it('resets coverage chips back to the LLM origin', () => {
    const origin = {
      text: 'Peter turns',
      dur: 7,
      cam: 'wide on Peter',
      quote: 'Wait what?',
      speaker: '@Peter',
    };
    const reset = resetBeatToOrigin({
      n: 1, from: '0:00', to: '0:07', dur: 4,
      text: 'edited',
      cam: 'wide on Peter',
      grammar: { size: 'cu' },
      origin,
    });
    expect(reset.grammar).toBeUndefined();
    expect(reset.text).toBe('Peter turns');
    expect(reset.dur).toBe(7);
    expect(reset.quote).toBe('Wait what?');
  });

  it('labels a shot chip from grammar size or cam text', () => {
    expect(beatSizeLabel({
      n: 1, from: '0:00', to: '0:06', dur: 6, text: 'Peter turns', grammar: { size: 'mcu' },
    })).toBe('MCU');
    expect(beatSizeLabel({
      n: 2, from: '0:06', to: '0:12', dur: 6, text: 'The room', cam: 'wide on the office',
    })).toBe('WS');
  });

  it('turns on chips from the LLM cam line', () => {
    expect(inferBeatGrammar({
      n: 1, from: '0:00', to: '0:06', dur: 6, text: 'They talk', cam: 'medium two shot',
    })).toMatchObject({ size: 'ms', bodies: 'two' });
    expect(inferBeatGrammar({
      n: 1, from: '0:00', to: '0:06', dur: 6,
      text: 'Jordan pulls the book',
      cam: '29° short-telephoto medium portrait from behind Peter\'s right shoulder; Peter stays a soft but visible left foreground anchor',
    })).toMatchObject({ size: 'ms', bodies: 'ots', clean: 'dirty' });
  });

  it('holds the previous setup when a later beat does not name a new size', () => {
    const beats = [
      { n: 1, from: '0:00', to: '0:04', dur: 4, text: 'Peter sits', cam: 'MCU on Peter' },
      { n: 2, from: '0:04', to: '0:08', dur: 4, text: 'He waits' },
      { n: 3, from: '0:08', to: '0:12', dur: 4, text: 'Jordan answers', cam: 'CU on Jordan' },
    ];
    const resolved = beatGrammarsForClip(beats);
    expect(resolved.map((entry) => entry?.size)).toEqual(['mcu', 'mcu', 'cu']);
    expect(beatInheritsSize(beats[1])).toBe(true);
    expect(beatInheritsSize(beats[2])).toBe(false);
  });

  it('colors consecutive beats that share a setup and leaves unique shots plain', () => {
    expect(beatSetupColors([
      { n: 1, from: '0:00', to: '0:04', dur: 4, text: 'Peter sits', cam: 'MCU on Peter' },
      { n: 2, from: '0:04', to: '0:08', dur: 4, text: 'He waits' },
      { n: 3, from: '0:08', to: '0:12', dur: 4, text: 'Jordan answers', cam: 'CU on Jordan' },
      { n: 4, from: '0:12', to: '0:16', dur: 4, text: 'Jordan holds' },
      { n: 5, from: '0:16', to: '0:20', dur: 4, text: 'Still Jordan' },
    ])).toEqual([0, 0, 1, 1, 1]);
    expect(beatSetupColors([
      { n: 1, from: '0:00', to: '0:05', dur: 5, text: 'Wide', cam: 'wide on the office' },
      { n: 2, from: '0:05', to: '0:10', dur: 5, text: 'Close', cam: 'close-up on Peter' },
      { n: 3, from: '0:10', to: '0:15', dur: 5, text: 'Insert', cam: 'insert on the coin' },
    ])).toEqual([undefined, undefined, undefined]);
  });

  it('does not treat coverage cuts as the same setup', () => {
    const beats = [
      { n: 1, from: '0:00', to: '0:04', dur: 4, text: 'Peter confirms', cam: '47° standard-normal medium two-shot from the window\'s shadow side; both men and the sofa-armchair relationship remain readable' },
      { n: 2, from: '0:04', to: '0:08', dur: 4, text: 'Jordan answers', cam: 'HARD CUT to a 29° short-telephoto portrait of Jordan in the armchair, book on lap and bottle low in his right hand' },
      { n: 3, from: '0:08', to: '0:10', dur: 2, text: 'Peter asks', cam: 'REVERSE CUT to an 18° classic-telephoto portrait of Peter, gaze locked on Jordan across the table' },
      { n: 4, from: '0:10', to: '0:15', dur: 5, text: 'Jordan itemizes', cam: 'HARD CUT to a 47° standard-normal medium shot; the hand action stays visible beneath the dialogue' },
      { n: 5, from: '0:15', to: '0:17', dur: 2, text: 'Peter holds', cam: 'REVERSE CUT to an 18° classic-telephoto close portrait of Peter' },
      { n: 6, from: '0:17', to: '0:20', dur: 3, text: 'Jordan opens the book', cam: 'HARD CUT to a 29° short-telephoto medium portrait of Jordan; Peter\'s shoulder a fixed left foreground edge' },
    ];
    expect(beatGrammarsForClip(beats).map((entry) => ({
      size: entry?.size,
      bodies: entry?.bodies,
      clean: entry?.clean,
    }))).toEqual([
      { size: 'ms', bodies: 'two', clean: undefined },
      { size: 'mcu', bodies: 'one', clean: undefined },
      { size: 'mcu', bodies: 'one', clean: undefined },
      { size: 'ms', bodies: undefined, clean: undefined },
      { size: 'cu', bodies: 'one', clean: undefined },
      { size: 'ms', bodies: 'ots', clean: 'dirty' },
    ]);
    expect(beatSetupColors(beats)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('inherits bodies from a hold, not from a newly named size', () => {
    expect(resolveBeatGrammar(
      { n: 2, from: '0:06', to: '0:12', dur: 6, text: 'They keep talking', cam: 'same setup' },
      { size: 'ms', bodies: 'two' },
    )).toMatchObject({ size: 'ms', bodies: 'two' });
    expect(resolveBeatGrammar(
      { n: 3, from: '0:12', to: '0:18', dur: 6, text: 'Jordan', cam: 'close-up on Jordan' },
      { size: 'ms', bodies: 'two' },
    )).toMatchObject({ size: 'cu' });
    expect(resolveBeatGrammar(
      { n: 3, from: '0:12', to: '0:18', dur: 6, text: 'Jordan', cam: 'close-up on Jordan' },
      { size: 'ms', bodies: 'two' },
    )?.bodies).toBeUndefined();
    expect(beatGrammarsForClip([
      { n: 1, from: '0:00', to: '0:06', dur: 6, text: 'They talk', cam: 'medium two shot' },
      { n: 2, from: '0:06', to: '0:12', dur: 6, text: 'They keep talking' },
    ]).map((entry) => ({ size: entry?.size, bodies: entry?.bodies }))).toEqual([
      { size: 'ms', bodies: 'two' },
      { size: 'ms', bodies: 'two' },
    ]);
  });

  it('grammar compiles without wiping an existing cam line', () => {
    expect(grammarLensLine({ size: 'mcu', bodies: 'ots', clean: 'dirty' })).toBe('medium close-up, dirty, over-the-shoulder');
    expect(compileBeatLens({
      beat: { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'x', cam: 'MEDIUM, 50mm, locked' },
      move: resolveCameraMove({}),
    })).toBe('MEDIUM, 50mm, locked.');
  });
});
