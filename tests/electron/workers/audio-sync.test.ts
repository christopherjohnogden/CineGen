import { describe, it, expect } from 'vitest';

describe('SyncJob types', () => {
  it('type definitions exist and are correct', async () => {
    const types = await import('../../../electron/workers/media-worker-types');
    expect(types.JOB_PRIORITY).toBeDefined();
    expect(types.JOB_PRIORITY.sync_compute_offset).toBe(0);
    expect(types.JOB_PRIORITY.sync_batch_match).toBe(0);
  });
});

import { parseTimecode, computeTimecodeOffset } from '../../../electron/workers/audio-sync';
import { crossCorrelateFingerprints } from '../../../electron/workers/audio-sync';
import { scoreFilenameSimilarity } from '../../../electron/workers/audio-sync';
import { buildAnalysisWindows, crossCorrelatePcm } from '../../../electron/workers/audio-sync';
import { searchFingerprintAnchor } from '../../../electron/workers/audio-sync';

describe('parseTimecode', () => {
  it('parses non-drop-frame timecode HH:MM:SS:FF', () => {
    expect(parseTimecode('01:00:00:00', 24)).toBe(86400);
  });
  it('parses drop-frame timecode HH:MM:SS;FF', () => {
    expect(parseTimecode('00:01:00;02', 29.97)).toBe(1800);
  });
  it('returns null for invalid timecode', () => {
    expect(parseTimecode('not-a-timecode', 24)).toBeNull();
  });
});

describe('computeTimecodeOffset', () => {
  it('computes offset between two timecodes', () => {
    const offset = computeTimecodeOffset('01:00:00:00', '01:00:02:00', 24);
    expect(offset).toBeCloseTo(2.0, 2);
  });
  it('handles negative offset', () => {
    const offset = computeTimecodeOffset('01:00:05:00', '01:00:02:00', 24);
    expect(offset).toBeCloseTo(-3.0, 2);
  });
});

describe('crossCorrelateFingerprints', () => {
  it('finds zero offset for identical fingerprints', () => {
    const fp = [100, 200, 300, 400, 500];
    const result = crossCorrelateFingerprints(fp, fp);
    expect(result.offsetIndex).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.9);
  });
  it('finds correct offset for shifted fingerprints', () => {
    const source = [0, 0, 100, 200, 300, 400, 500, 0, 0];
    const target = [100, 200, 300, 400, 500, 0, 0, 0, 0];
    const result = crossCorrelateFingerprints(source, target);
    expect(result.offsetIndex).toBe(-2);
  });
  it('returns low confidence for unrelated fingerprints', () => {
    const source = [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF];
    const target = [0x00000000, 0x00000000, 0x00000000];
    const result = crossCorrelateFingerprints(source, target);
    expect(result.confidence).toBeLessThan(0.1);
  });
});

describe('searchFingerprintAnchor', () => {
  it('finds the anchor start within a longer fingerprint', () => {
    const anchor = [100, 200, 300, 400];
    const search = [1, 2, 3, 100, 200, 300, 400, 9];
    const result = searchFingerprintAnchor(anchor, search);
    expect(result.offsetIndex).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

describe('buildAnalysisWindows', () => {
  it('returns beginning, middle, and end windows for longer files', () => {
    const windows = buildAnalysisWindows(200, 45);
    expect(windows).toEqual([
      { label: 'start', startSeconds: 0, durationSeconds: 45 },
      { label: 'middle', startSeconds: 77.5, durationSeconds: 45 },
      { label: 'end', startSeconds: 155, durationSeconds: 45 },
    ]);
  });

  it('deduplicates windows for shorter files', () => {
    const windows = buildAnalysisWindows(30, 45);
    expect(windows).toEqual([
      { label: 'start', startSeconds: 0, durationSeconds: 30 },
    ]);
  });
});

describe('crossCorrelatePcm', () => {
  it('handles short clips without generating invalid anchor windows', () => {
    const pcm = Float32Array.from({ length: 90 }, (_, i) => (
      Math.sin(i * 0.17) * 0.7 + ((i % 7) - 3) / 10
    ));
    const result = crossCorrelatePcm(pcm, pcm, 10);
    expect(result._offsetSeconds).toBeCloseTo(0, 2);
    expect(result.confidence).toBeGreaterThan(0.3);
  });
});

describe('scoreFilenameSimilarity', () => {
  it('scores identical names as 1.0', () => {
    expect(scoreFilenameSimilarity('scene_01.mov', 'scene_01.wav')).toBe(1.0);
  });
  it('scores completely different names as low', () => {
    expect(scoreFilenameSimilarity('foo.mov', 'bar.wav')).toBeLessThan(0.5);
  });
  it('scores similar names higher than different', () => {
    const similar = scoreFilenameSimilarity('interview_take2.mov', 'interview_take2_audio.wav');
    const different = scoreFilenameSimilarity('interview_take2.mov', 'broll_sunset.wav');
    expect(similar).toBeGreaterThan(different);
  });
});

describe('batch matching logic', () => {
  it('scoreFilenameSimilarity pairs exact matches higher than partial', () => {
    const exact = scoreFilenameSimilarity('scene_01.mov', 'scene_01.wav');
    const partial = scoreFilenameSimilarity('scene_01.mov', 'scene_02.wav');
    const unrelated = scoreFilenameSimilarity('scene_01.mov', 'interview.wav');
    expect(exact).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(unrelated);
  });
  it('handles edge case: empty filenames', () => {
    expect(scoreFilenameSimilarity('.mov', '.wav')).toBe(1.0);
  });
  it('handles edge case: very long filenames', () => {
    const long = 'a'.repeat(200) + '.mov';
    const short = 'a'.repeat(200) + '.wav';
    expect(scoreFilenameSimilarity(long, short)).toBe(1.0);
  });
});
