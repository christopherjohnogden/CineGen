import { describe, it, expect } from 'vitest';
import { syncClips, createSyncedTimeline, createDefaultTimeline } from '@/lib/editor/timeline-operations';
import type { Timeline, Clip } from '@/types/timeline';

function makeTimeline(): Timeline {
  const tl = createDefaultTimeline('Test');
  const videoClip: Clip = {
    id: 'v1', assetId: 'asset-video', trackId: tl.tracks[0].id,
    name: 'scene_01.mov', startTime: 0, duration: 10,
    trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
    flipH: false, flipV: false, keyframes: [],
  };
  const audioClip: Clip = {
    id: 'a1', assetId: 'asset-audio', trackId: tl.tracks[2].id,
    name: 'scene_01.wav', startTime: 5, duration: 10,
    trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
    flipH: false, flipV: false, keyframes: [],
  };
  return { ...tl, clips: [videoClip, audioClip] };
}

describe('syncClips', () => {
  it('adjusts audio clip position by offset and links clips', () => {
    const tl = makeTimeline();
    const result = syncClips(tl, 'v1', 'a1', 2.5, 'replace');
    const audioClip = result.clips.find((c) => c.id === 'a1')!;
    expect(audioClip.startTime).toBeCloseTo(2.5);
    const videoClip = result.clips.find((c) => c.id === 'v1')!;
    expect(videoClip.linkedClipIds).toContain('a1');
    expect(audioClip.linkedClipIds).toContain('v1');
  });

  it('mutes scratch audio track when mode is replace', () => {
    const tl = makeTimeline();
    const scratchClip: Clip = {
      id: 'scratch', assetId: 'asset-video', trackId: tl.tracks[2].id,
      name: 'scene_01.mov (audio)', startTime: 0, duration: 10,
      trimStart: 0, trimEnd: 0, speed: 1, opacity: 1, volume: 1,
      flipH: false, flipV: false, keyframes: [], linkedClipIds: ['v1'],
    };
    const tlWithScratch = {
      ...tl,
      clips: [...tl.clips, scratchClip],
    };
    tlWithScratch.clips[0] = { ...tlWithScratch.clips[0], linkedClipIds: ['scratch'] };

    // Put the audio clip on a different track than scratch
    const a2Track = tl.tracks[3]; // A2
    tlWithScratch.clips[1] = { ...tlWithScratch.clips[1], trackId: a2Track.id };

    const result = syncClips(tlWithScratch, 'v1', 'a1', 2.5, 'replace');
    // Scratch track should be muted
    const scratchTrack = result.tracks.find((t) => t.id === tl.tracks[2].id)!;
    expect(scratchTrack.muted).toBe(true);
    // Video should now be linked to BOTH scratch and the new audio
    const videoClip = result.clips.find((c) => c.id === 'v1')!;
    expect(videoClip.linkedClipIds).toContain('scratch');
    expect(videoClip.linkedClipIds).toContain('a1');
  });
});

describe('createSyncedTimeline', () => {
  it('creates a timeline with synced clips laid out sequentially', () => {
    const pairs = [
      {
        videoAsset: { id: 'v1', name: 'clip1.mov', duration: 10 },
        audioAsset: { id: 'a1', name: 'clip1.wav', duration: 12 },
        offsetSeconds: 0.5,
      },
      {
        videoAsset: { id: 'v2', name: 'clip2.mov', duration: 8 },
        audioAsset: { id: 'a2', name: 'clip2.wav', duration: 9 },
        offsetSeconds: -0.3,
      },
    ];
    const result = createSyncedTimeline('My Timeline', pairs, 'replace', [], []);

    const videoClips = result.clips.filter((c) =>
      result.tracks.find((t) => t.id === c.trackId)?.kind === 'video'
    );
    expect(videoClips).toHaveLength(2);
    expect(videoClips[0].startTime).toBe(0);
    expect(videoClips[1].startTime).toBe(10);

    const audioClips = result.clips.filter((c) =>
      result.tracks.find((t) => t.id === c.trackId)?.kind === 'audio'
    );
    expect(audioClips[0].startTime).toBeCloseTo(0.5);
    expect(audioClips[1].startTime).toBeCloseTo(10 - 0.3);

    expect(videoClips[0].linkedClipIds).toContain(audioClips[0].id);
  });
});
