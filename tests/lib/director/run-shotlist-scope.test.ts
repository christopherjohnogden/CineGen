import { describe, expect, it } from 'vitest';
import { runDirectorShotlist } from '@/lib/director/run-shotlist';
import { bindShotlistToScene, mergeShotlist, parseShotlistPayload } from '@/lib/director/shotlist';
import type { DirectorClip, DirectorScene, DirectorShow } from '@/types/director';

describe('runDirectorShotlist scene scope', () => {
  it('keeps each full-run response in its requested scene even when the model repeats Scene 1 IDs', () => {
    const scenes: DirectorScene[] = [
      { id: 'scene-1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
      { id: 'scene-2', number: 2, label: 'EXT. FOREST - NIGHT', summary: '', elementIds: [], clipIds: [] },
    ];
    const mistakenPayload = {
      scenes: [{ id: 'scene-1', number: 1, label: 'INT. OFFICE - DAY', summary: '' }],
      clips: [{
        id: '1-a', sceneId: 'scene-1', title: 'Opening beat', seconds: 20,
        elementTags: [], subject: '', location: '', style: '', constraints: '',
        beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'The beat plays.' }],
      }],
      coveredToEnd: true,
    };

    const first = bindShotlistToScene(parseShotlistPayload(mistakenPayload), scenes[0]);
    const second = bindShotlistToScene(parseShotlistPayload(mistakenPayload), scenes[1]);
    const afterFirst = mergeShotlist(scenes, [], first);
    const afterSecond = mergeShotlist(afterFirst.scenes, afterFirst.clips, second);

    expect(afterSecond.clips).toHaveLength(2);
    expect(afterSecond.clips[0]).toMatchObject({ id: '1-a', sceneId: 'scene-1' });
    expect(afterSecond.clips[1]).toMatchObject({ id: '2-1-a', sceneId: 'scene-2' });
    expect(afterSecond.scenes[0].clipIds).toEqual(['1-a']);
    expect(afterSecond.scenes[1].clipIds).toEqual(['2-1-a']);
  });

  it('preserves the existing shotlist when the requested scene cannot be isolated', async () => {
    const scene: DirectorScene = {
      id: 'scene-1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: ['1-a'],
    };
    const clip: DirectorClip = {
      id: '1-a', sceneId: scene.id, title: 'Existing coverage', seconds: 20,
      elementTags: [], subject: '', location: '', style: '', constraints: '',
      activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
      beats: [{ n: 1, from: '0:00', to: '0:20', dur: 20, text: 'Jordan enters.' }],
    };
    const show = {
      sourceText: 'INT. OFFICE - DAY\nJordan enters.',
      clipLengthSec: 20,
      stylePrefix: '',
      lookBible: { filmRefs: [], moodBoards: [], notes: '' },
      breakdown: [],
      scenes: [scene],
      clips: [clip],
    } as DirectorShow;
    const missing = { ...scene, id: 'missing-scene', number: 9, label: 'SCENE 9' };
    let current = show;
    let writes = 0;

    const result = await runDirectorShotlist({
      getShow: () => current,
      setShow: (next) => { current = next; writes += 1; },
    }, show, [missing], 'openai');

    expect(result.error).toMatch(/Could not isolate Scene 9/);
    expect(writes).toBe(0);
    expect(current.clips).toEqual([clip]);
  });
});
