import { describe, expect, it } from 'vitest';
import {
  clampRange,
  formatTimecode,
  isTrimStale,
  isWholeSource,
  localPathFor,
  parseTimecode,
  trimmedDuration,
} from '@/lib/studio/trim';

/**
 * A trim is a paid, several-second re-encode, so the range has to be right
 * before it runs: an inverted or out-of-bounds range renders a broken file, and
 * a stale "applied" state sends the wrong clip to a model.
 */
describe('trim range', () => {
  it('reads back the timecodes it writes', () => {
    expect(formatTimecode(0)).toBe('00:00:00');
    expect(formatTimecode(8827)).toBe('02:27:07');
    expect(parseTimecode('02:27:07')).toBe(8827);
    // Shorter forms are what people actually type.
    expect(parseTimecode('90')).toBe(90);
    expect(parseTimecode('1:30')).toBe(90);
  });

  it('refuses a field it cannot read rather than silently jumping to zero', () => {
    expect(parseTimecode('')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('1:2:3:4')).toBeNull();
  });

  it('keeps the range inside the clip', () => {
    expect(clampRange({ startSec: -5, endSec: 400 }, 120)).toEqual({ startSec: 0, endSec: 120 });
  });

  it('gives way on the handle that moved, so a range never inverts', () => {
    // Dragging the start past the end pushes the start back, not the end.
    const start = clampRange({ startSec: 90, endSec: 30 }, 120, 'start');
    expect(start.startSec).toBeLessThan(start.endSec);
    expect(start.endSec).toBe(30);

    const end = clampRange({ startSec: 60, endSec: 10 }, 120, 'end');
    expect(end.startSec).toBe(60);
    expect(end.endSec).toBeGreaterThan(60);
  });

  it('knows when a range is the whole clip and needs no render', () => {
    expect(isWholeSource({ startSec: 0, endSec: 120 }, 120)).toBe(true);
    expect(isWholeSource({ startSec: 2, endSec: 120 }, 120)).toBe(false);
    // Nothing is "whole" before the duration is known.
    expect(isWholeSource({ startSec: 0, endSec: 0 }, 0)).toBe(false);
  });

  it('treats a rendered trim as stale as soon as the range moves', () => {
    const rendered = { startSec: 10, endSec: 20, url: 'local-media://file/trim.mp4' };
    expect(isTrimStale({ startSec: 10, endSec: 20 }, rendered)).toBe(false);
    expect(isTrimStale({ startSec: 10, endSec: 25 }, rendered)).toBe(true);
    // Never rendered is always stale, so Apply stays available.
    expect(isTrimStale({ startSec: 0, endSec: 5 }, null)).toBe(true);
  });

  it('measures the selection, not the source', () => {
    expect(trimmedDuration({ startSec: 12, endSec: 30 })).toBe(18);
    expect(trimmedDuration({ startSec: 30, endSec: 12 })).toBe(0);
  });

  /** ffmpeg needs a path; a remote or blob url has none and must not be guessed at. */
  it('resolves only the urls that name a file on disk', () => {
    expect(localPathFor('local-media://file/clips/game%20day.mp4')).toBe('/clips/game day.mp4');
    expect(localPathFor('file:///clips/a.mp4')).toBe('/clips/a.mp4');
    expect(localPathFor('/already/a/path.mp4')).toBe('/already/a/path.mp4');
    expect(localPathFor('https://cdn.example.com/a.mp4')).toBe('');
    expect(localPathFor('blob:abc')).toBe('');
    expect(localPathFor('')).toBe('');
  });
});
