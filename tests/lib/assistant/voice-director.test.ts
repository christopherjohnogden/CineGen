import { describe, expect, it } from 'vitest';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import {
  applyVoiceDirectorChanges,
  buildVoiceDirectorContext,
  normalizeVoiceDirectorChanges,
  voiceScreenplay,
} from '@/lib/assistant/voice-director';
import type { WorkspaceState } from '@/types/workspace';

function showFixture() {
  const show = createEmptyDirectorShow();
  show.sourceText = 'INT. ROOM - NIGHT\nPeter waits.\n\nPETER\nWhere is it?';
  show.scenes = [{
    id: 'scene-1', number: 1, label: 'INT. ROOM - NIGHT', summary: 'Peter waits.',
    elementIds: [], clipIds: ['clip-1'],
  }];
  show.clips = [{
    id: 'clip-1', title: 'The wait', seconds: 10, sceneId: 'scene-1',
    subject: '@Peter', location: '@Room', style: '', constraints: '', elementTags: ['@Peter', '@Room'],
    blocking: '@Peter stands by the door.',
    activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
    beats: [
      { n: 1, from: '0:00', to: '0:05', dur: 5, text: 'Peter waits.', cam: 'Wide two-shot.' },
      { n: 2, from: '0:05', to: '0:10', dur: 5, text: 'Peter asks where it is.', cam: 'Medium close-up.' },
    ],
  }];
  show.selectedSceneId = 'scene-1';
  show.selectedClipId = 'clip-1';
  return show;
}

describe('voice director changes', () => {
  it('normalizes only supported changes', () => {
    const normalized = normalizeVoiceDirectorChanges({
      summary: 'Adjusted the scene.',
      sceneUpdates: [{ sceneId: 'scene-1', patch: { event: 'Peter commits to the search.', unknown: 'drop me' } }],
      clipUpdates: [{ clipId: 'clip-1', patch: { blocking: '@Peter crosses camera-left.', seconds: 99 } }],
    });
    expect(normalized?.sceneUpdates[0].patch).toEqual({ event: 'Peter commits to the search.' });
    expect(normalized?.clipUpdates[0].patch).toEqual({ blocking: '@Peter crosses camera-left.' });
  });

  it('applies script, blocking, and shot edits as one director result', () => {
    const show = showFixture();
    const doc = voiceScreenplay(show);
    const actionId = doc.elements.find((element) => element.text === 'Peter waits.')?.id;
    if (!actionId) throw new Error('missing action');

    const result = applyVoiceDirectorChanges(show, {
      summary: 'Reblocked Peter and tightened the coverage.',
      scriptEdits: [{
        op: 'replace', targetElementId: actionId,
        elements: [{ type: 'action', text: 'Peter paces from the door to the table.' }],
      }],
      clipUpdates: [{ clipId: 'clip-1', patch: { blocking: '@Peter crosses camera-left from the door to the table.' } }],
      shotUpdates: [{ clipId: 'clip-1', beatN: 2, patch: { cam: 'Slow push-in to a clean close-up.', grammar: { size: 'cu', bodies: 'one', clean: 'clean', move: 'push-in' } } }],
    });

    expect(result.appliedCount).toBe(3);
    expect(result.director.sourceText).toContain('Peter paces from the door to the table.');
    expect(result.director.clips[0].blocking).toContain('camera-left');
    expect(result.director.clips[0].beats[1].cam).toContain('push-in');
    expect(result.director.clips[0].beats[1].grammar?.size).toBe('cu');
    expect(show.sourceText).not.toContain('paces');
  });

  it('retimes replacement shots to the existing clip duration', () => {
    const result = applyVoiceDirectorChanges(showFixture(), {
      summary: 'Rebuilt the shot flow.',
      replaceShots: [{
        clipId: 'clip-1',
        beats: [
          { dur: 2, text: 'Hold the empty room.', cam: 'Locked wide.' },
          { dur: 3, text: 'Peter enters and crosses.', cam: 'Track left.' },
          { dur: 2, text: 'Peter stops at the table.', cam: 'Close-up.' },
        ],
      }],
    });
    const clip = result.director.clips[0];
    expect(clip.beats).toHaveLength(3);
    expect(clip.beats.reduce((sum, beat) => sum + beat.dur, 0)).toBe(10);
    expect(clip.beats[0].from).toBe('0:00');
    expect(clip.beats[2].to).toBe('0:10');
  });

  it('ignores stale ids and reports a warning', () => {
    const show = showFixture();
    const result = applyVoiceDirectorChanges(show, {
      summary: 'Changed a missing clip.',
      clipUpdates: [{ clipId: 'gone', patch: { blocking: 'Nowhere.' } }],
    });
    expect(result.appliedCount).toBe(0);
    expect(result.warnings[0]).toContain('gone');
    expect(result.director).not.toBe(show);
  });

  it('builds focused context for the active scene and clip', () => {
    const show = showFixture();
    const state = {
      activeTab: 'director', director: show, timelines: [], activeTimelineId: '', nodes: [],
    } as unknown as WorkspaceState;
    const context = buildVoiceDirectorContext(state);
    expect(context).toContain('ACTIVE TAB: director');
    expect(context).toContain('SELECTED CLIP AND SHOTS');
    expect(context).toContain('clip-1');
    expect(context).toContain('voice-script-');
  });
});
