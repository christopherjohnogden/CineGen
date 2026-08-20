import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { applyReshotBeat, applyReshotClip, parseReshotBeatPayload, parseReshotClipPayload } from '@/lib/director/shotlist';

const clip = (): DirectorClip => ({
  id: 'a', title: 'Peter waits', seconds: 14, sceneId: 's1',
  beats: [
    { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'Peter sits.', cam: 'medium two-shot', quote: 'Yeah.', speaker: '@Peter' },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'Jordan answers.', cam: 'portrait of Jordan', quote: 'It helps.', speaker: '@Dr-Jordan' },
  ],
  subject: 'a talk', location: 'the office', style: '', constraints: '', elementTags: [],
  activeVariant: { kind: 'full' }, bodyEdits: { full: 'keep me' }, takes: [],
});

describe('redo one shot', () => {
  it('replaces that beat camera and keeps duration, dialogue, and neighbours', () => {
    const incoming = parseReshotBeatPayload({
      beat: {
        n: 2, from: '9:99', to: '9:99', dur: 99,
        text: 'Jordan in the armchair, bottle low.',
        cam: 'HARD CUT to an 18° classic-telephoto close portrait of Jordan',
        quote: 'CHANGED', speaker: '@Wrong', fov: 18,
      },
    }, 2);
    expect(incoming?.cam).toMatch(/close portrait of Jordan/);
    const next = applyReshotBeat(clip(), 2, incoming!);
    expect(next.beats[0].cam).toBe('medium two-shot');
    expect(next.beats[1].cam).toMatch(/close portrait of Jordan/);
    expect(next.beats[1].dur).toBe(7);
    expect(next.beats[1].from).toBe('0:07');
    expect(next.beats[1].quote).toBe('It helps.');
    expect(next.beats[1].speaker).toBe('@Dr-Jordan');
    expect(next.beats[1].fov).toBe(18);
    expect(next.bodyEdits).toEqual({});
    expect(next.beats[1].origin?.cam).toMatch(/close portrait of Jordan/);
  });

  it('leaves the clip alone when the beat is missing', () => {
    const source = clip();
    expect(applyReshotBeat(source, 9, source.beats[0])).toBe(source);
  });
});

describe('redo one clip', () => {
  it('replaces coverage and keeps id, duration, and takes', () => {
    const source: DirectorClip = {
      ...clip(),
      takes: [{ id: 't1', number: 1, variantKey: 'full', status: 'done', adapterId: 'seedance-2.5' }],
      fov: 47,
    };
    const incoming = parseReshotClipPayload({
      clip: {
        id: 'other', sceneId: 'wrong', title: 'Peter waits', seconds: 99,
        subject: 'a talk', location: 'the office',
        beats: [
          { n: 1, from: '0:00', to: '0:10', dur: 10, text: 'Wide of the office.', cam: 'extreme wide of the room' },
          { n: 2, from: '0:10', to: '0:14', dur: 4, text: 'Peter on the sofa.', cam: 'close-up on Peter', quote: 'Yeah.', speaker: '@Peter' },
        ],
      },
    }, 's1');
    expect(incoming?.beats).toHaveLength(2);
    const next = applyReshotClip(source, incoming!);
    expect(next.id).toBe('a');
    expect(next.sceneId).toBe('s1');
    expect(next.seconds).toBe(14);
    expect(next.beats).toHaveLength(2);
    expect(next.beats[0].cam).toMatch(/extreme wide/);
    expect(next.takes).toHaveLength(1);
    expect(next.bodyEdits).toEqual({});
    expect(next.activeVariant).toEqual({ kind: 'full' });
  });
});
