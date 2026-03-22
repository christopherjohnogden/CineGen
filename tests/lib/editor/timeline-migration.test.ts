import { describe, it, expect } from 'vitest';
import { migrateSequenceToTimelines } from '@/lib/editor/timeline-migration';

describe('migrateSequenceToTimelines', () => {
  it('converts old sequence with nested clips to timelines with flat clips', () => {
    const oldSnapshot = {
      project: { id: 'p1', name: 'Test', createdAt: '', updatedAt: '' },
      sequence: {
        id: 'seq-1',
        tracks: [
          {
            id: 't1', name: 'Track 1', clips: [
              { id: 'c1', assetId: 'a1', trackId: 't1', name: 'Clip 1', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0 },
            ],
            muted: true,
          },
          {
            id: 't2', name: 'Track 2', clips: [],
          },
        ],
        duration: 5,
      },
      assets: [],
      mediaFolders: [],
      exports: [],
      elements: [],
      workflow: { nodes: [], edges: [] },
    };

    const result = migrateSequenceToTimelines(oldSnapshot);
    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0].clips).toHaveLength(1);
    expect(result.timelines[0].clips[0].trackId).toBe('t1');
    expect(result.timelines[0].tracks[0].kind).toBe('video');
    expect(result.timelines[0].tracks[0].muted).toBe(true);
    expect(result.activeTimelineId).toBe(result.timelines[0].id);
    expect(result.sequence).toBeUndefined();
  });

  it('returns unchanged if timelines already exist', () => {
    const snapshot = {
      timelines: [{ id: 'tl1', name: 'TL', tracks: [], clips: [], duration: 0 }],
      activeTimelineId: 'tl1',
    };
    const result = migrateSequenceToTimelines(snapshot as any);
    expect(result.timelines).toHaveLength(1);
    expect(result.timelines[0].id).toBe('tl1');
  });

  it('infers track kind from clip asset types', () => {
    const oldSnapshot = {
      sequence: {
        id: 'seq-1',
        tracks: [
          { id: 't1', name: 'Track 1', clips: [
            { id: 'c1', assetId: 'audio-asset', trackId: 't1', name: 'Music', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0 },
          ]},
        ],
        duration: 5,
      },
      assets: [{ id: 'audio-asset', type: 'audio', name: 'Music', url: '', createdAt: '' }],
    };

    const result = migrateSequenceToTimelines(oldSnapshot as any);
    expect(result.timelines[0].tracks[0].kind).toBe('audio');
  });
});
