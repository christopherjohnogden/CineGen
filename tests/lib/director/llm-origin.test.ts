import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { applyReshotClip, mergeShotlist, parseReshotClipPayload } from '@/lib/director/shotlist';
import {
  beatIsDirtyFromLlmOrigin,
  clipIsDirtyFromLlmOrigin,
  resetClipBeatToLlmOrigin,
  resetClipToLlmOrigin,
} from '@/lib/director/llm-origin';

const clip = (): DirectorClip => ({
  id: 'a', title: 'Peter waits', seconds: 14, sceneId: 's1',
  beats: [
    { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'Peter sits.', cam: 'medium two-shot' },
    { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'Jordan answers.', cam: 'portrait of Jordan' },
  ],
  subject: 'a talk', location: 'the office', style: '', constraints: '', elementTags: [],
  activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
});

describe('first shotlist origin', () => {
  it('keeps the first write through a notes/redo pass and restores it', () => {
    const source = clip();
    const incoming = parseReshotClipPayload({
      clip: {
        id: 'other', sceneId: 'wrong', title: 'Peter fidgets', seconds: 14,
        subject: 'a talk', location: 'the office',
        beats: [
          { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'Peter rubs his fingers.', cam: 'medium two-shot' },
          { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'Jordan answers.', cam: 'portrait of Jordan' },
        ],
      },
    }, 's1');
    const noted = applyReshotClip(source, incoming!);
    expect(clipIsDirtyFromLlmOrigin(noted)).toBe(true);
    expect(noted.beats[0].text).toMatch(/rubs his fingers/);
    expect(noted.llmOrigin?.beats[0].text).toBe('Peter sits.');

    const twice = applyReshotClip(noted, parseReshotClipPayload({
      clip: {
        id: 'a', sceneId: 's1', title: 'Again', seconds: 14,
        subject: 'a talk', location: 'the office',
        beats: [{ n: 1, from: '0:00', to: '0:14', dur: 14, text: 'Peter stands.', cam: 'wide' }],
      },
    }, 's1')!);
    expect(twice.llmOrigin?.beats[0].text).toBe('Peter sits.');
    expect(twice.beats).toHaveLength(1);

    const restored = resetClipToLlmOrigin(twice);
    expect(restored.title).toBe('Peter waits');
    expect(restored.beats).toHaveLength(2);
    expect(restored.beats[0].text).toBe('Peter sits.');
    expect(clipIsDirtyFromLlmOrigin(restored)).toBe(false);
  });

  it('restores one shot without dropping the others', () => {
    const source = applyReshotClip(clip(), parseReshotClipPayload({
      clip: {
        id: 'a', sceneId: 's1', title: 'Peter waits', seconds: 14,
        subject: 'a talk', location: 'the office',
        beats: [
          { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'Peter fidgets.', cam: 'medium two-shot' },
          { n: 2, from: '0:07', to: '0:14', dur: 7, text: 'Jordan slams the file.', cam: 'portrait of Jordan' },
        ],
      },
    }, 's1')!);
    expect(beatIsDirtyFromLlmOrigin(source, 1)).toBe(true);
    const next = resetClipBeatToLlmOrigin(source, 1);
    expect(next.beats[0].text).toBe('Peter sits.');
    expect(next.beats[1].text).toMatch(/slams the file/);
  });

  it('does not let a scene-notes merge replace the first shotlist', () => {
    const existing = applyReshotClip(clip(), parseReshotClipPayload({
      clip: {
        id: 'a', sceneId: 's1', title: 'Peter fidgets', seconds: 14,
        subject: 'a talk', location: 'the office',
        beats: [{ n: 1, from: '0:00', to: '0:14', dur: 14, text: 'Peter fidgets.', cam: 'wide' }],
      },
    }, 's1')!);
    const merged = mergeShotlist(
      [{ id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: ['a'] }],
      [existing],
      {
        scenes: [],
        clips: [{
          ...existing,
          title: 'Notes again',
          llmOrigin: undefined,
          beats: [{ n: 1, from: '0:00', to: '0:14', dur: 14, text: 'Even more fidget.', cam: 'wide' }],
        }],
        errors: [],
        rawClipCount: 1,
      },
    );
    expect(merged.clips[0].title).toBe('Notes again');
    expect(merged.clips[0].llmOrigin?.title).toBe('Peter waits');
    expect(resetClipToLlmOrigin(merged.clips[0]).beats[0].text).toBe('Peter sits.');
  });
});
