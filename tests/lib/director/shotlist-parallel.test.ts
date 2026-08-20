import { describe, expect, it } from 'vitest';
import {
  createGate,
  falSliceBatchSize,
  falSliceCount,
  splitScriptForCoverage,
} from '@/lib/director/shotlist-parallel';
import { shotlistSliceInput } from '@/lib/director/job-inputs';
import type { DirectorShow, DirectorScene } from '@/types/director';

describe('fal shotlist parallelism', () => {
  it('keeps short scenes as a single job and splits ~12-clip scenes into 3', () => {
    expect(falSliceCount(3)).toBe(1);
    expect(falSliceCount(5)).toBe(1);
    expect(falSliceCount(8)).toBe(2);
    expect(falSliceCount(12)).toBe(3);
    expect(falSliceCount(40)).toBe(3);
  });

  it('sizes each slice to the ~20s Flash batch, never the whole scene', () => {
    expect(falSliceCount(13)).toBe(3);
    expect(falSliceBatchSize(12, 3)).toBe(4);
    expect(falSliceBatchSize(13, 3)).toBe(5);
    expect(falSliceBatchSize(5, 1)).toBe(5);
    expect(falSliceBatchSize(13, 1)).toBe(5);
  });

  it('splits a single-spaced screenplay into the requested number of excerpts', () => {
    const text = [
      'INT. OFFICE - DAY',
      'Peter waits on the couch.',
      'DR. JORDAN',
      'Sorry I\'m late.',
      'PETER',
      'I counted the tiles again.',
      'Dr Jordan sits and opens a drawer.',
      'DR. JORDAN',
      'This will only take a moment.',
      'He swallows a pill.',
      'PETER',
      'What was that?',
      'DR. JORDAN',
      'Nothing you need to worry about.',
      'Peter leans forward.',
      'PETER',
      'Then why hide it.',
    ].join('\n');
    const slices = splitScriptForCoverage(text, 3);
    expect(slices.length).toBe(3);
    expect(slices[0]).toContain('Peter waits');
    expect(slices[0]).not.toContain('Then why hide it');
    expect(slices[2]).toContain('Then why hide it');
    expect(slices[2]).not.toContain('Peter waits');
  });

  it('splits on blank lines without tearing a block apart', () => {
    const text = ['INT. OFFICE - DAY', 'Jordan sits.', '', 'Peter waits.', '', 'The phone rings.'].join('\n');
    const slices = splitScriptForCoverage(text, 2);
    expect(slices.length).toBe(2);
    expect(slices.join('\n\n')).toContain('Jordan sits.');
    expect(slices.join('\n\n')).toContain('The phone rings.');
    expect(slices.some((slice) => slice.includes('Jordan sits.') && slice.includes('The phone rings.'))).toBe(false);
  });

  it('runs at most N jobs at once', async () => {
    let inflight = 0;
    let peak = 0;
    const gate = createGate(2);
    await Promise.all([1, 2, 3, 4].map((value) => gate.run(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inflight -= 1;
      return value;
    })));
    expect(peak).toBe(2);
  });
});

describe('shotlistSliceInput', () => {
  it('prefixes clip ids per slice so parallel merges cannot collide', () => {
    const scene: DirectorScene = {
      id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [],
    };
    const show = {
      sourceText: 'INT. OFFICE - DAY\nJordan sits.',
      clipLengthSec: 30,
      stylePrefix: '',
      lookBible: { filmRefs: [], moodBoards: [], notes: '' },
      breakdown: [],
      scenes: [scene],
      clips: [],
    } as unknown as DirectorShow;
    const body = shotlistSliceInput(show, scene, { index: 1, of: 3, text: 'Peter waits.' });
    expect(body).toMatch(/SLICE 2 of 3/);
    expect(body).toContain('1-p1');
    expect(body).toContain('Peter waits.');
    expect(body).not.toContain('Jordan sits.');
  });
});
