import { describe, expect, it } from 'vitest';
import {
  aspectRatioFor, defaultModelFor, modelsFor, outputTypeForModel,
} from '../../../src/lib/higgsfield/frame-chat-model-options';

describe('aspectRatioFor', () => {
  it('snaps common source dimensions to the nearest supported ratio', () => {
    expect(aspectRatioFor(1920, 1080)).toBe('16:9');
    expect(aspectRatioFor(1080, 1920)).toBe('9:16');
    expect(aspectRatioFor(1024, 1024)).toBe('1:1');
    expect(aspectRatioFor(1440, 1080)).toBe('4:3');
    expect(aspectRatioFor(2560, 1080)).toBe('21:9');
  });

  it('snaps near-but-not-exact dimensions to the closest ratio', () => {
    expect(aspectRatioFor(1280, 718)).toBe('16:9'); // ~16:9
    expect(aspectRatioFor(1000, 1010)).toBe('1:1');  // ~square
  });

  it('falls back to 16:9 when dimensions are missing or invalid', () => {
    expect(aspectRatioFor(undefined, undefined)).toBe('16:9');
    expect(aspectRatioFor(0, 0)).toBe('16:9');
    expect(aspectRatioFor(1920, 0)).toBe('16:9');
  });
});

describe('model option helpers', () => {
  it('filters models by output type', () => {
    expect(modelsFor('image').every((m) => m.outputType === 'image')).toBe(true);
    expect(modelsFor('video').every((m) => m.outputType === 'video')).toBe(true);
    expect(modelsFor('image').length).toBeGreaterThan(0);
    expect(modelsFor('video').length).toBeGreaterThan(0);
  });

  it('returns a default model of the requested type', () => {
    expect(outputTypeForModel(defaultModelFor('image'))).toBe('image');
    expect(outputTypeForModel(defaultModelFor('video'))).toBe('video');
  });
});
