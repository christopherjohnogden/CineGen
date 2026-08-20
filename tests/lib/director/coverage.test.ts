import { describe, expect, it } from 'vitest';
import type { DirectorClip, DirectorScene } from '@/types/director';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  applyCoverageToScene, applyMatchSizeToScene, compileBeatLens, filmicMoveFor,
  grammarLensLine, resolveCameraMove,
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

  it('grammar compiles without wiping an existing cam line', () => {
    expect(grammarLensLine({ size: 'mcu', bodies: 'ots', clean: 'dirty' })).toBe('medium close-up, dirty, over-the-shoulder');
    expect(compileBeatLens({
      beat: { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'x', cam: 'MEDIUM, 50mm, locked' },
      move: resolveCameraMove({}),
    })).toBe('MEDIUM, 50mm, locked.');
  });
});
