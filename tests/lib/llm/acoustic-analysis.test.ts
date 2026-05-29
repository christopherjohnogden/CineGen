import { describe, expect, it } from 'vitest';
import {
  ACOUSTIC_ANALYSIS_VERSION,
  emptyAcousticAnalysis,
  parseSilenceDetect,
  SILENCE_NOISE_DB,
  SILENCE_MIN_DURATION,
} from '@/lib/llm/acoustic-analysis';

describe('acoustic-analysis types', () => {
  it('exposes a version and an empty/missing analysis factory', () => {
    const empty = emptyAcousticAnalysis('asset-1');
    expect(empty.status).toBe('missing');
    expect(empty.assetId).toBe('asset-1');
    expect(empty.silenceMap).toEqual([]);
    expect(empty.segments).toEqual([]);
    expect(typeof ACOUSTIC_ANALYSIS_VERSION).toBe('number');
  });
});

describe('parseSilenceDetect', () => {
  it('pairs silence_start with the following silence_end', () => {
    const stderr = [
      'ffmpeg version 6.0',
      '[silencedetect @ 0x55] silence_start: 1.250',
      '[silencedetect @ 0x55] silence_end: 1.900 | silence_duration: 0.650',
      '[silencedetect @ 0x55] silence_start: 12.043',
      '[silencedetect @ 0x55] silence_end: 12.301 | silence_duration: 0.258',
    ].join('\n');
    expect(parseSilenceDetect(stderr)).toEqual([
      { start: 1.25, end: 1.9 },
      { start: 12.043, end: 12.301 },
    ]);
  });

  it('drops an unterminated trailing silence_start', () => {
    const stderr = '[silencedetect @ 0x55] silence_start: 5.000';
    expect(parseSilenceDetect(stderr)).toEqual([]);
  });

  it('exposes documented default thresholds', () => {
    expect(SILENCE_NOISE_DB).toBe(-30);
    expect(SILENCE_MIN_DURATION).toBe(0.3);
  });
});
