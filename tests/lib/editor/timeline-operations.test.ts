import { describe, it, expect } from 'vitest';
import {
  calculateTimelineDuration,
  addClipToTrack,
  removeClip,
  moveClip,
  trimClip,
  splitClip,
  addTrack,
  removeTrack,
  rippleTrim,
  rollTrim,
  slipClip,
  slideClip,
  trackSelectForward,
  duplicateClip,
  updateTrack,
  clipsOnTrack,
  clipAtTime,
  createDefaultTimeline,
  snapToHalfSecond,
  splitAllTracks,
  interpolateProperty,
  addKeyframe,
  removeKeyframe,
  moveKeyframe,
  addTransition,
  removeTransition,
  updateTransition,
  updateClipProperties,
} from '@/lib/editor/timeline-operations';
import type { Timeline, Track, Clip, Keyframe } from '@/types/timeline';

function makeTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    id: 'tl-1',
    name: 'Timeline 1',
    tracks: [
      { id: 'v1', name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      { id: 'a1', name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true, volume: 1 },
    ],
    clips: [],
    duration: 0,
    transitions: [],
    ...overrides,
  };
}

function makeClip(overrides?: Partial<Clip>): Clip {
  return {
    id: 'clip-1',
    assetId: 'asset-1',
    trackId: 'v1',
    name: 'Clip 1',
    startTime: 0,
    duration: 10,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    opacity: 1,
    volume: 1,
    flipH: false,
    flipV: false,
    keyframes: [],
    ...overrides,
  };
}

describe('calculateTimelineDuration', () => {
  it('returns 0 for empty timeline', () => {
    expect(calculateTimelineDuration(makeTimeline())).toBe(0);
  });

  it('calculates from clip end times', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ startTime: 0, duration: 5 }),
        makeClip({ id: 'clip-2', startTime: 8, duration: 4, trimEnd: 1 }),
      ],
    });
    expect(calculateTimelineDuration(tl)).toBe(11);
  });
});

describe('addClipToTrack', () => {
  it('adds a clip to the flat clips array', () => {
    const tl = makeTimeline();
    const result = addClipToTrack(tl, 'v1', { id: 'a1', name: 'test.mp4', type: 'video', url: '', duration: 5, createdAt: '' } as any, 2);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].trackId).toBe('v1');
    expect(result.clips[0].startTime).toBe(2);
    expect(result.duration).toBe(7);
  });
});

describe('removeClip', () => {
  it('removes clip by id', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = removeClip(tl, 'clip-1');
    expect(result.clips).toHaveLength(0);
  });
});

describe('moveClip', () => {
  it('moves clip to new time and track', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = moveClip(tl, 'clip-1', 'a1', 5);
    expect(result.clips[0].trackId).toBe('a1');
    expect(result.clips[0].startTime).toBe(5);
  });

  it('clamps startTime to 0', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = moveClip(tl, 'clip-1', 'v1', -3);
    expect(result.clips[0].startTime).toBe(0);
  });
});

describe('trimClip', () => {
  it('updates trimStart and trimEnd', () => {
    const tl = makeTimeline({ clips: [makeClip({ duration: 10 })] });
    const result = trimClip(tl, 'clip-1', 2, 3);
    expect(result.clips[0].trimStart).toBe(2);
    expect(result.clips[0].trimEnd).toBe(3);
  });

  it('clamps to 0', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const result = trimClip(tl, 'clip-1', -1, -2);
    expect(result.clips[0].trimStart).toBe(0);
    expect(result.clips[0].trimEnd).toBe(0);
  });
});

describe('splitClip', () => {
  it('splits clip at given time', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 0, duration: 10 })] });
    const result = splitClip(tl, 'clip-1', 4);
    expect(result.clips).toHaveLength(2);
    const first = result.clips.find(c => c.id === 'clip-1')!;
    expect(first.trimEnd).toBe(6);
    const second = result.clips.find(c => c.id !== 'clip-1')!;
    expect(second.startTime).toBe(4);
    expect(second.trimStart).toBe(4);
  });

  it('does nothing if split time is outside clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 2, duration: 5 })] });
    const result = splitClip(tl, 'clip-1', 0);
    expect(result.clips).toHaveLength(1);
  });
});

describe('addTrack', () => {
  it('adds a video track', () => {
    const tl = makeTimeline();
    const result = addTrack(tl, 'video');
    expect(result.tracks).toHaveLength(3);
    const newTrack = result.tracks.find(t => t.name === 'V2');
    expect(newTrack).toBeDefined();
    expect(newTrack!.kind).toBe('video');
  });

  it('adds an audio track', () => {
    const tl = makeTimeline();
    const result = addTrack(tl, 'audio');
    const newTrack = result.tracks.find(t => t.name === 'A2');
    expect(newTrack).toBeDefined();
    expect(newTrack!.kind).toBe('audio');
  });
});

describe('removeTrack', () => {
  it('removes track and its clips', () => {
    const tl = makeTimeline({ clips: [makeClip({ trackId: 'v1' })] });
    const result = removeTrack(tl, 'v1');
    expect(result.tracks).toHaveLength(1);
    expect(result.clips).toHaveLength(0);
  });

  it('does not remove last track of a kind', () => {
    const tl = makeTimeline();
    const result = removeTrack(tl, 'v1');
    expect(result.tracks.filter(t => t.kind === 'video')).toHaveLength(1);
  });
});

describe('rippleTrim', () => {
  it('trims clip and shifts subsequent clips', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 5 }),
        makeClip({ id: 'c2', startTime: 5, duration: 5 }),
        makeClip({ id: 'c3', startTime: 10, duration: 5 }),
      ],
    });
    // Trim 2 seconds from right edge of c1 → subsequent clips shift left by 2
    const result = rippleTrim(tl, 'c1', 'right', -2);
    expect(result.clips.find(c => c.id === 'c1')!.trimEnd).toBe(2);
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBe(3);
    expect(result.clips.find(c => c.id === 'c3')!.startTime).toBe(8);
  });

  it('trims clip left edge and shifts subsequent clips', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 5 }),
        makeClip({ id: 'c2', startTime: 5, duration: 5 }),
      ],
    });
    const result = rippleTrim(tl, 'c2', 'left', 1);
    const c2 = result.clips.find(c => c.id === 'c2')!;
    expect(c2.trimStart).toBe(1);
    expect(c2.startTime).toBe(5);
  });
});

describe('rollTrim', () => {
  it('adjusts cut point between adjacent clips', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 10, trimEnd: 5 }),
        makeClip({ id: 'c2', startTime: 5, duration: 10, trimStart: 0 }),
      ],
    });
    const result = rollTrim(tl, 'c1', 'c2', 2);
    expect(result.clips.find(c => c.id === 'c1')!.trimEnd).toBe(3);
    expect(result.clips.find(c => c.id === 'c2')!.trimStart).toBe(2);
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBe(7);
  });
});

describe('slipClip', () => {
  it('shifts trim window without moving clip', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', startTime: 2, duration: 10, trimStart: 1, trimEnd: 1 })],
    });
    const result = slipClip(tl, 'c1', 2);
    const c = result.clips.find(c => c.id === 'c1')!;
    expect(c.trimStart).toBe(2); // 1 + clamped(1)
    expect(c.trimEnd).toBe(0);   // 1 - clamped(1)
  });

  it('clamps slip to available source', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', duration: 10, trimStart: 0, trimEnd: 0 })],
    });
    const result = slipClip(tl, 'c1', 5);
    const c = result.clips.find(c => c.id === 'c1')!;
    expect(c.trimStart).toBe(0);
    expect(c.trimEnd).toBe(0);
  });
});

describe('slideClip', () => {
  it('moves clip and adjusts neighbor trim points', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', startTime: 0, duration: 10, trimEnd: 5 }),
        makeClip({ id: 'c2', startTime: 5, duration: 10, trimStart: 0, trimEnd: 5 }),
        makeClip({ id: 'c3', startTime: 10, duration: 10, trimStart: 0 }),
      ],
    });
    const result = slideClip(tl, 'c2', 2);
    expect(result.clips.find(c => c.id === 'c1')!.trimEnd).toBe(3);
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBe(7);
    expect(result.clips.find(c => c.id === 'c3')!.trimStart).toBe(2);
    expect(result.clips.find(c => c.id === 'c3')!.startTime).toBe(12);
  });
});

describe('trackSelectForward', () => {
  it('selects clip and all clips after it on the same track', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0 }),
        makeClip({ id: 'c2', trackId: 'v1', startTime: 5 }),
        makeClip({ id: 'c3', trackId: 'v1', startTime: 10 }),
        makeClip({ id: 'c4', trackId: 'a1', startTime: 5 }),
      ],
    });
    const ids = trackSelectForward(tl, 'c2');
    expect(ids).toEqual(new Set(['c2', 'c3']));
    expect(ids.has('c1')).toBe(false);
    expect(ids.has('c4')).toBe(false);
  });
});

describe('duplicateClip', () => {
  it('returns a copy of the clip with a new id at the given startTime', () => {
    const tl = makeTimeline({ clips: [makeClip({ id: 'clip-1', startTime: 0, duration: 5 })] });
    const { timeline: result, newClipId } = duplicateClip(tl, 'clip-1', 10);
    expect(result.clips).toHaveLength(2);
    expect(newClipId).not.toBeNull();
    expect(newClipId).not.toBe('clip-1');
    const copy = result.clips.find(c => c.id === newClipId)!;
    expect(copy.startTime).toBe(10);
    expect(copy.assetId).toBe('asset-1');
    expect(copy.duration).toBe(5);
  });

  it('clamps duplicate startTime to 0', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const { timeline: result, newClipId } = duplicateClip(tl, 'clip-1', -5);
    const copy = result.clips.find(c => c.id === newClipId)!;
    expect(copy.startTime).toBe(0);
  });

  it('returns original timeline and null newClipId when clip is not found', () => {
    const tl = makeTimeline({ clips: [makeClip()] });
    const { timeline: result, newClipId } = duplicateClip(tl, 'nonexistent', 5);
    expect(result.clips).toHaveLength(1);
    expect(newClipId).toBeNull();
  });

  it('updates timeline duration to reflect the duplicated clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 0, duration: 5 })] });
    const { timeline: result } = duplicateClip(tl, 'clip-1', 20);
    expect(result.duration).toBe(25);
  });
});

describe('updateTrack', () => {
  it('toggles the muted flag on a track', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'v1', { muted: true });
    const track = result.tracks.find(t => t.id === 'v1')!;
    expect(track.muted).toBe(true);
  });

  it('toggles the solo flag on a track', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'a1', { solo: true });
    const track = result.tracks.find(t => t.id === 'a1')!;
    expect(track.solo).toBe(true);
  });

  it('locks a track', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'v1', { locked: true });
    const track = result.tracks.find(t => t.id === 'v1')!;
    expect(track.locked).toBe(true);
  });

  it('hides a track', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'v1', { visible: false });
    const track = result.tracks.find(t => t.id === 'v1')!;
    expect(track.visible).toBe(false);
  });

  it('renames a track', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'v1', { name: 'Main Video' });
    const track = result.tracks.find(t => t.id === 'v1')!;
    expect(track.name).toBe('Main Video');
  });

  it('does not mutate other tracks', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'v1', { muted: true });
    const other = result.tracks.find(t => t.id === 'a1')!;
    expect(other.muted).toBe(false);
  });

  it('is a no-op when trackId is not found', () => {
    const tl = makeTimeline();
    const result = updateTrack(tl, 'nonexistent', { muted: true });
    expect(result.tracks).toEqual(tl.tracks);
  });
});

describe('clipsOnTrack', () => {
  it('returns only clips belonging to the given track, sorted by startTime', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c3', trackId: 'v1', startTime: 10 }),
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0 }),
        makeClip({ id: 'c2', trackId: 'a1', startTime: 2 }),
      ],
    });
    const result = clipsOnTrack(tl, 'v1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('c1');
    expect(result[1].id).toBe('c3');
  });

  it('returns an empty array when no clips are on the track', () => {
    const tl = makeTimeline({ clips: [] });
    expect(clipsOnTrack(tl, 'v1')).toEqual([]);
  });

  it('excludes clips from other tracks', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'a1', startTime: 0 })],
    });
    expect(clipsOnTrack(tl, 'v1')).toHaveLength(0);
  });
});

describe('clipAtTime', () => {
  it('returns the clip whose range covers the given time', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'v1', startTime: 2, duration: 6 })],
    });
    const found = clipAtTime(tl, 'v1', 5);
    expect(found).toBeDefined();
    expect(found!.id).toBe('c1');
  });

  it('returns undefined when no clip covers the time', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'v1', startTime: 2, duration: 3 })],
    });
    expect(clipAtTime(tl, 'v1', 0)).toBeUndefined();
    expect(clipAtTime(tl, 'v1', 5)).toBeUndefined();
  });

  it('returns undefined when querying a different track', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10 })],
    });
    expect(clipAtTime(tl, 'a1', 5)).toBeUndefined();
  });

  it('matches exactly at startTime but not at the end boundary', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'v1', startTime: 4, duration: 4 })],
    });
    expect(clipAtTime(tl, 'v1', 4)).toBeDefined();
    expect(clipAtTime(tl, 'v1', 8)).toBeUndefined();
  });
});

describe('createDefaultTimeline', () => {
  it('creates a timeline with the given name', () => {
    const tl = createDefaultTimeline('My Film');
    expect(tl.name).toBe('My Film');
  });

  it('has a non-empty generated id', () => {
    const tl = createDefaultTimeline('Test');
    expect(tl.id).toBeTruthy();
  });

  it('starts with 4 tracks: 2 video and 2 audio', () => {
    const tl = createDefaultTimeline('Test');
    expect(tl.tracks).toHaveLength(4);
    expect(tl.tracks.filter(t => t.kind === 'video')).toHaveLength(2);
    expect(tl.tracks.filter(t => t.kind === 'audio')).toHaveLength(2);
  });

  it('has track names V1, V2, A1, A2', () => {
    const tl = createDefaultTimeline('Test');
    const names = tl.tracks.map(t => t.name);
    expect(names).toContain('V1');
    expect(names).toContain('V2');
    expect(names).toContain('A1');
    expect(names).toContain('A2');
  });

  it('starts with no clips and duration 0', () => {
    const tl = createDefaultTimeline('Test');
    expect(tl.clips).toHaveLength(0);
    expect(tl.duration).toBe(0);
  });

  it('generates unique ids for each call', () => {
    const tl1 = createDefaultTimeline('A');
    const tl2 = createDefaultTimeline('B');
    expect(tl1.id).not.toBe(tl2.id);
  });
});

describe('snapToHalfSecond', () => {
  it('rounds 0.3 up to 0.5', () => {
    expect(snapToHalfSecond(0.3)).toBe(0.5);
  });

  it('rounds 0.4 up to 0.5', () => {
    expect(snapToHalfSecond(0.4)).toBe(0.5);
  });

  it('leaves an exact half-second value unchanged', () => {
    expect(snapToHalfSecond(2.5)).toBe(2.5);
  });

  it('leaves an exact whole-second value unchanged', () => {
    expect(snapToHalfSecond(3)).toBe(3);
  });

  it('rounds 1.7 down to 1.5', () => {
    expect(snapToHalfSecond(1.7)).toBe(1.5);
  });

  it('rounds 1.2 down to 1', () => {
    expect(snapToHalfSecond(1.2)).toBe(1);
  });

  it('handles 0', () => {
    expect(snapToHalfSecond(0)).toBe(0);
  });
});

describe('splitAllTracks', () => {
  it('splits clips on all unlocked tracks at the given time', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10 }),
        makeClip({ id: 'c2', trackId: 'a1', startTime: 2, duration: 8 }),
      ],
    });
    const result = splitAllTracks(tl, 5);
    const v1Clips = result.clips.filter((c) => c.trackId === 'v1');
    expect(v1Clips).toHaveLength(2);
    expect(v1Clips[0].trimEnd).toBe(5);
    expect(v1Clips[1].startTime).toBe(5);
    const a1Clips = result.clips.filter((c) => c.trackId === 'a1');
    expect(a1Clips).toHaveLength(2);
  });

  it('skips locked tracks', () => {
    const tl = makeTimeline({
      tracks: [
        { id: 'v1', name: 'V1', kind: 'video', color: '#e74c3c', muted: false, solo: false, locked: true, visible: true, volume: 1 },
        { id: 'a1', name: 'A1', kind: 'audio', color: '#2ecc71', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      ],
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10 }),
        makeClip({ id: 'c2', trackId: 'a1', startTime: 0, duration: 10 }),
      ],
    });
    const result = splitAllTracks(tl, 5);
    expect(result.clips.filter((c) => c.trackId === 'v1')).toHaveLength(1);
    expect(result.clips.filter((c) => c.trackId === 'a1')).toHaveLength(2);
  });

  it('does nothing if no clips overlap the split time', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 3 })],
    });
    const result = splitAllTracks(tl, 5);
    expect(result.clips).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------
   Keyframe & Transition Operations (Task 2)
   ------------------------------------------------------------------ */

describe('interpolateProperty', () => {
  it('returns static clip value when no keyframes exist', () => {
    const clip = makeClip({ opacity: 0.5, keyframes: [] });
    expect(interpolateProperty(clip, 'opacity', 2)).toBe(0.5);
  });

  it('returns single keyframe value at any time', () => {
    const clip = makeClip({ opacity: 0.5, keyframes: [{ time: 1, property: 'opacity', value: 0.8 }] });
    expect(interpolateProperty(clip, 'opacity', 0)).toBe(0.8);
    expect(interpolateProperty(clip, 'opacity', 5)).toBe(0.8);
  });

  it('linearly interpolates between two keyframes', () => {
    const clip = makeClip({
      opacity: 1,
      keyframes: [
        { time: 0, property: 'opacity', value: 0 },
        { time: 4, property: 'opacity', value: 1 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 2)).toBeCloseTo(0.5);
  });

  it('holds first keyframe value before it', () => {
    const clip = makeClip({
      opacity: 1,
      keyframes: [
        { time: 2, property: 'opacity', value: 0.3 },
        { time: 4, property: 'opacity', value: 0.7 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 0)).toBeCloseTo(0.3);
  });

  it('holds last keyframe value after it', () => {
    const clip = makeClip({
      opacity: 1,
      keyframes: [
        { time: 0, property: 'opacity', value: 0.3 },
        { time: 2, property: 'opacity', value: 0.7 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 5)).toBeCloseTo(0.7);
  });

  it('only considers keyframes for the requested property', () => {
    const clip = makeClip({
      opacity: 1,
      volume: 0.5,
      keyframes: [
        { time: 0, property: 'volume', value: 0 },
        { time: 4, property: 'volume', value: 1 },
      ],
    });
    expect(interpolateProperty(clip, 'opacity', 2)).toBe(1); // static, no opacity keyframes
    expect(interpolateProperty(clip, 'volume', 2)).toBeCloseTo(0.5);
  });
});

describe('addKeyframe', () => {
  it('adds a keyframe to the specified clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ keyframes: [] })] });
    const kf: Keyframe = { time: 1, property: 'opacity', value: 0.5 };
    const result = addKeyframe(tl, 'clip-1', kf);
    expect(result.clips[0].keyframes).toHaveLength(1);
    expect(result.clips[0].keyframes[0]).toEqual(kf);
  });

  it('sorts keyframes by time after adding', () => {
    const tl = makeTimeline({
      clips: [makeClip({ keyframes: [{ time: 3, property: 'opacity', value: 1 }] })],
    });
    const result = addKeyframe(tl, 'clip-1', { time: 1, property: 'opacity', value: 0 });
    expect(result.clips[0].keyframes[0].time).toBe(1);
    expect(result.clips[0].keyframes[1].time).toBe(3);
  });
});

describe('removeKeyframe', () => {
  it('removes keyframe at given index', () => {
    const tl = makeTimeline({
      clips: [makeClip({ keyframes: [
        { time: 0, property: 'opacity', value: 0 },
        { time: 2, property: 'opacity', value: 1 },
      ] })],
    });
    const result = removeKeyframe(tl, 'clip-1', 0);
    expect(result.clips[0].keyframes).toHaveLength(1);
    expect(result.clips[0].keyframes[0].time).toBe(2);
  });
});

describe('moveKeyframe', () => {
  it('moves a keyframe to a new time and re-sorts', () => {
    const tl = makeTimeline({
      clips: [makeClip({ keyframes: [
        { time: 0, property: 'opacity', value: 0 },
        { time: 2, property: 'opacity', value: 1 },
      ] })],
    });
    const result = moveKeyframe(tl, 'clip-1', 0, 3);
    expect(result.clips[0].keyframes[0].time).toBe(2);
    expect(result.clips[0].keyframes[1].time).toBe(3);
  });
});

describe('addTransition', () => {
  it('adds a fade transition to a clip', () => {
    const tl = makeTimeline({
      clips: [makeClip({ id: 'c1', startTime: 0, duration: 10, trimEnd: 2 })],
      transitions: [],
    });
    const result = addTransition(tl, {
      id: 'tr1', type: 'fadeFromBlack', duration: 1, clipAId: 'c1',
    });
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].id).toBe('tr1');
  });

  it('clamps dissolve duration to available handle material and shifts clipB', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10, trimEnd: 1 }),
        makeClip({ id: 'c2', trackId: 'v1', startTime: 10, duration: 10, trimStart: 0.5 }),
      ],
      transitions: [],
    });
    // Dissolve needs handle from both clips. clipA has 1s trimEnd (outgoing handle).
    // clipB has 0.5s trimStart (incoming handle). Available = min(1, 0.5) = 0.5.
    // Request 2s dissolve -> clamped to 0.5.
    const result = addTransition(tl, {
      id: 'tr1', type: 'dissolve', duration: 2, clipAId: 'c1', clipBId: 'c2',
    });
    expect(result.transitions[0].duration).toBeCloseTo(0.5);
    // clipB should be shifted left by the clamped duration to create overlap
    expect(result.clips.find(c => c.id === 'c2')!.startTime).toBeCloseTo(9.5);
  });

  it('no-ops dissolve when no handle material exists', () => {
    const tl = makeTimeline({
      clips: [
        makeClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 10, trimEnd: 0 }),
        makeClip({ id: 'c2', trackId: 'v1', startTime: 10, duration: 10, trimStart: 0 }),
      ],
      transitions: [],
    });
    const result = addTransition(tl, {
      id: 'tr1', type: 'dissolve', duration: 1, clipAId: 'c1', clipBId: 'c2',
    });
    expect(result.transitions).toHaveLength(0);
  });
});

describe('removeTransition', () => {
  it('removes a transition by id', () => {
    const tl = makeTimeline({
      clips: [makeClip()],
      transitions: [{ id: 'tr1', type: 'fadeFromBlack', duration: 1, clipAId: 'clip-1' }],
    });
    const result = removeTransition(tl, 'tr1');
    expect(result.transitions).toHaveLength(0);
  });
});

describe('updateTransition', () => {
  it('updates transition properties', () => {
    const tl = makeTimeline({
      clips: [makeClip()],
      transitions: [{ id: 'tr1', type: 'fadeFromBlack', duration: 1, clipAId: 'clip-1' }],
    });
    const result = updateTransition(tl, 'tr1', { duration: 2 });
    expect(result.transitions[0].duration).toBe(2);
  });
});

describe('updateClipProperties', () => {
  it('updates speed on a clip', () => {
    const tl = makeTimeline({ clips: [makeClip({ speed: 1 })] });
    const result = updateClipProperties(tl, 'clip-1', { speed: 2 });
    expect(result.clips[0].speed).toBe(2);
  });

  it('clamps speed to 0.25-4 range', () => {
    const tl = makeTimeline({ clips: [makeClip({ speed: 1 })] });
    expect(updateClipProperties(tl, 'clip-1', { speed: 0.1 }).clips[0].speed).toBe(0.25);
    expect(updateClipProperties(tl, 'clip-1', { speed: 10 }).clips[0].speed).toBe(4);
  });

  it('clamps opacity to 0-1', () => {
    const tl = makeTimeline({ clips: [makeClip({ opacity: 1 })] });
    expect(updateClipProperties(tl, 'clip-1', { opacity: -0.5 }).clips[0].opacity).toBe(0);
    expect(updateClipProperties(tl, 'clip-1', { opacity: 1.5 }).clips[0].opacity).toBe(1);
  });

  it('toggles flipH', () => {
    const tl = makeTimeline({ clips: [makeClip({ flipH: false })] });
    const result = updateClipProperties(tl, 'clip-1', { flipH: true });
    expect(result.clips[0].flipH).toBe(true);
  });

  it('recalculates timeline duration when speed changes', () => {
    const tl = makeTimeline({ clips: [makeClip({ startTime: 0, duration: 10, speed: 1 })] });
    const result = updateClipProperties(tl, 'clip-1', { speed: 2 });
    // effectiveDuration = 10/2 = 5, so timeline duration = 5
    expect(result.duration).toBe(5);
  });
});
