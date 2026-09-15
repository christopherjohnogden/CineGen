import { describe, expect, it } from 'vitest';
import {
  FULL_FRAME,
  LENS_PRESETS,
  diagonalFov,
  verticalFov,
  horizontalFov,
  shotSize,
  heightDescriptor,
  framePosition,
  aspectRatio,
} from '@/lib/sets/optics';

describe('diagonalFov', () => {
  // The repo's OPTICS_DOCTRINE bank is a full-frame lens bank; these are the
  // numbers that let a lens preset map onto one of its six anchors.
  it('matches the classic full-frame lens equivalents', () => {
    expect(diagonalFov(24, FULL_FRAME)).toBeCloseTo(84.1, 0);
    expect(diagonalFov(50, FULL_FRAME)).toBeCloseTo(46.8, 0);
    expect(diagonalFov(85, FULL_FRAME)).toBeCloseTo(28.6, 0);
  });

  it('narrows as focal length grows', () => {
    const wide = diagonalFov(16, FULL_FRAME);
    const long = diagonalFov(200, FULL_FRAME);
    expect(wide).toBeGreaterThan(long);
    expect(long).toBeGreaterThan(0);
  });

  it('widens on a larger sensor at the same focal length', () => {
    const superThirtyFive = { widthMm: 24.89, heightMm: 18.66 };
    expect(diagonalFov(50, superThirtyFive)).toBeLessThan(diagonalFov(50, FULL_FRAME));
  });
});

describe('vertical and horizontal fov', () => {
  it('are both narrower than the diagonal', () => {
    expect(verticalFov(50, FULL_FRAME)).toBeLessThan(diagonalFov(50, FULL_FRAME));
    expect(horizontalFov(50, FULL_FRAME)).toBeLessThan(diagonalFov(50, FULL_FRAME));
    expect(verticalFov(50, FULL_FRAME)).toBeLessThan(horizontalFov(50, FULL_FRAME));
  });
});

describe('shotSize', () => {
  const vFov = verticalFov(50, FULL_FRAME);

  it('names the shot from how much of the subject the frame holds', () => {
    // Close enough that the frame covers well under a head-to-toe 1.8m figure.
    expect(shotSize(1.8, 1.2, vFov)).toMatch(/close/i);
    // Far enough that the figure is small in a tall frame.
    expect(shotSize(1.8, 30, vFov)).toMatch(/wide|long/i);
  });

  it('moves through the sizes monotonically as the camera pulls back', () => {
    const sizes = [0.8, 2, 4, 8, 20].map((d) => shotSize(1.8, d, vFov));
    expect(new Set(sizes).size).toBeGreaterThan(2);
  });

  it('never returns empty, even at absurd distances', () => {
    expect(shotSize(1.8, 0.01, vFov)).toBeTruthy();
    expect(shotSize(1.8, 5000, vFov)).toBeTruthy();
  });
});

describe('heightDescriptor', () => {
  it('describes camera height relative to the subject rather than in metres', () => {
    expect(heightDescriptor(0.3, 1.8)).toMatch(/low|ground/i);
    expect(heightDescriptor(1.6, 1.8)).toMatch(/eye/i);
    expect(heightDescriptor(4.5, 1.8)).toMatch(/high|above/i);
  });
});

describe('framePosition', () => {
  it('reads normalised screen x as a thirds position', () => {
    expect(framePosition(0.5)).toMatch(/cent/i);
    expect(framePosition(0.12)).toMatch(/left/i);
    expect(framePosition(0.88)).toMatch(/right/i);
  });
});

describe('aspectRatio', () => {
  it('parses the shapes the generate panel offers', () => {
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9, 5);
    expect(aspectRatio('9:16')).toBeCloseTo(9 / 16, 5);
    expect(aspectRatio('2.39:1')).toBeCloseTo(2.39, 5);
    expect(aspectRatio('1:1')).toBe(1);
  });

  it('falls back to 16:9 rather than producing a degenerate camera', () => {
    expect(aspectRatio('adaptive')).toBeCloseTo(16 / 9, 5);
    expect(aspectRatio('')).toBeCloseTo(16 / 9, 5);
    expect(aspectRatio('0:0')).toBeCloseTo(16 / 9, 5);
  });
});

describe('LENS_PRESETS', () => {
  it('offers the four the brief names, in order', () => {
    expect(LENS_PRESETS).toEqual([24, 35, 50, 85]);
  });
});
