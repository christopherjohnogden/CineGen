import { describe, expect, it } from 'vitest';
import { addTrackAbove } from '../../../src/lib/editor/timeline-operations';
import type { Timeline } from '../../../src/types/timeline';

function makeTimeline(): Timeline {
  return {
    id: 't', name: 'T', duration: 0, clips: [],
    tracks: [
      { id: 'v1', name: 'V1', kind: 'video', color: '#111', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'v2', name: 'V2', kind: 'video', color: '#222', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'a1', name: 'A1', kind: 'audio', color: '#333', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
  } as unknown as Timeline;
}

describe('addTrackAbove', () => {
  it('inserts a new video track immediately after the target in array order (= above in reversed render)', () => {
    const { timeline, trackId } = addTrackAbove(makeTimeline(), 'v1', 'video');
    const ids = timeline.tracks.map((t) => t.id);
    expect(ids.indexOf(trackId)).toBe(ids.indexOf('v1') + 1);
    expect(ids[ids.length - 1]).toBe('a1');
  });

  it('appends after the target when target is the topmost video track', () => {
    const { timeline, trackId } = addTrackAbove(makeTimeline(), 'v2', 'video');
    const ids = timeline.tracks.map((t) => t.id);
    expect(ids.indexOf(trackId)).toBe(ids.indexOf('v2') + 1);
    expect(ids[ids.length - 1]).toBe('a1');
  });

  it('falls back to appending a track when the target id is unknown', () => {
    const before = makeTimeline().tracks.length;
    const { timeline, trackId } = addTrackAbove(makeTimeline(), 'nope', 'video');
    expect(timeline.tracks.length).toBe(before + 1);
    expect(timeline.tracks.some((t) => t.id === trackId)).toBe(true);
    expect(timeline.tracks.find((t) => t.id === trackId)?.kind).toBe('video');
  });
});
