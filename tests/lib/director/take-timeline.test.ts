import { describe, expect, it } from 'vitest';
import type { DirectorClip } from '@/types/director';
import { createPendingTake } from '@/lib/director/generate';
import { beatAtPlayhead, videoTimeForBeat } from '@/lib/director/framing-reserve';
import { parseSegmentTimes, snapshotTakeBeatTimes, takeTimelineClip } from '@/lib/director/take-timeline';

const clip = (extra?: Partial<DirectorClip>): DirectorClip => ({
  id: 'a', title: 'a', seconds: 20, sceneId: 's1',
  beats: [
    { n: 1, from: '0:00', to: '0:05', dur: 5, text: 'ws' },
    { n: 2, from: '0:05', to: '0:10', dur: 5, text: 'ws' },
    { n: 3, from: '0:10', to: '0:15', dur: 5, text: 'cu' },
    { n: 4, from: '0:15', to: '0:20', dur: 5, text: 'ms' },
  ],
  subject: '', location: '', style: '', constraints: '', elementTags: [],
  activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
  ...extra,
});

const takePrompt = [
  'SEGMENT 1 — WS (~0:00–0:07)',
  'SEGMENT 2 — WS (~0:07–0:13)',
  'SEGMENT 3 — CU (~0:12–0:15)',
  'SEGMENT 4 — MS (~0:15–0:20)',
].join('\n');

describe('take timeline', () => {
  it('parses SEGMENT times from the prompt that made the take', () => {
    expect(parseSegmentTimes(takePrompt)).toEqual([
      { n: 1, from: '0:00', to: '0:07', dur: 7 },
      { n: 2, from: '0:07', to: '0:13', dur: 6 },
      { n: 3, from: '0:12', to: '0:15', dur: 3 },
      { n: 4, from: '0:15', to: '0:20', dur: 5 },
    ]);
  });

  it('bakes those times onto a new take even if the shotlist later changes', () => {
    const take = createPendingTake({
      clip: clip(),
      variant: { kind: 'full' },
      adapterId: 'seedance-2.5',
      modelId: 'seedance_2_5',
      promptSnapshot: takePrompt,
    });
    expect(take.beatTimes?.map((row) => `${row.n}:${row.from}-${row.to}`)).toEqual([
      '1:0:00-0:07', '2:0:07-0:13', '3:0:12-0:15', '4:0:15-0:20',
    ]);
    const edited = clip({
      beats: [
        { n: 1, from: '0:00', to: '0:10', dur: 10, text: 'rewritten' },
        { n: 2, from: '0:10', to: '0:20', dur: 10, text: 'rewritten' },
      ],
    });
    const timeline = takeTimelineClip(edited, take);
    expect(timeline.beats.map((beat) => beat.from)).toEqual(['0:00', '0:07', '0:12', '0:15']);
    expect(beatAtPlayhead(timeline, 11)?.n).toBe(2);
    expect(beatAtPlayhead(timeline, 12)?.n).toBe(3);
    expect(videoTimeForBeat(timeline, 3, 20)).toBe(12);
  });

  it('falls back to clip beats when the prompt has no SEGMENT times', () => {
    expect(snapshotTakeBeatTimes(clip(), 'just a note')).toEqual([
      { n: 1, from: '0:00', to: '0:05', dur: 5 },
      { n: 2, from: '0:05', to: '0:10', dur: 5 },
      { n: 3, from: '0:10', to: '0:15', dur: 5 },
      { n: 4, from: '0:15', to: '0:20', dur: 5 },
    ]);
  });
});
