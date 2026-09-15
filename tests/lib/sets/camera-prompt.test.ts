import { describe, expect, it } from 'vitest';
import { MANNEQUIN_EXCLUSION, REFERENCE_TAGS, buildCameraPrompt } from '@/lib/sets/camera-prompt';
import { FULL_FRAME } from '@/lib/sets/optics';

describe('buildCameraPrompt', () => {
  const base = { cameraHeightM: 1.6, subjectDistanceM: 4.2, subjectFrameX: 0.35, sensor: FULL_FRAME };

  it('translates a 50mm full-frame lens to the doctrine 47° anchor', () => {
    const result = buildCameraPrompt({ ...base, focalMm: 50 });
    expect(result.fovAnchor).toBe(47);
    expect(result.block).toContain('47° diagonal field of view');
    expect(result.block).toMatch(/standard normal lens character/);
  });

  it('maps the brief lens presets onto the anchors they really are', () => {
    expect(buildCameraPrompt({ ...base, focalMm: 24 }).fovAnchor).toBe(84);
    expect(buildCameraPrompt({ ...base, focalMm: 85 }).fovAnchor).toBe(29);
    expect(buildCameraPrompt({ ...base, focalMm: 300 }).fovAnchor).toBe(8);
  });

  it('never writes millimetres, f-stops or ISO into the prompt', () => {
    const block = buildCameraPrompt({ ...base, focalMm: 85 }).block;
    expect(block).not.toMatch(/\bmm\b/i);
    expect(block).not.toMatch(/\bf\/\d/i);
    expect(block).not.toMatch(/\bISO\b/i);
    expect(block).not.toMatch(/85/);
  });

  it('states the measured distance and drops the anchor block’s asserted range', () => {
    // The 47° anchor block claims "camera 3 to 5 meters from subject"; at 12m
    // that claim is simply wrong and must not survive.
    const result = buildCameraPrompt({ ...base, focalMm: 50, subjectDistanceM: 12 });
    expect(result.block).toContain('about 12 metres from camera');
    expect(result.block).not.toMatch(/camera 3 to 5 meters from subject/i);
  });

  it('keeps the anchor’s own range when there is no measurement to prefer', () => {
    const result = buildCameraPrompt({ focalMm: 50, cameraHeightM: 1.6 });
    expect(result.block).toMatch(/camera 3 to 5 meters from subject/i);
    expect(result.measuredDistanceM).toBeUndefined();
  });

  it('derives the shot size from the geometry rather than being told', () => {
    const near = buildCameraPrompt({ ...base, focalMm: 85, subjectDistanceM: 1.5 });
    const far = buildCameraPrompt({ ...base, focalMm: 24, subjectDistanceM: 25 });
    expect(near.shotSize).toMatch(/close/i);
    expect(far.shotSize).toMatch(/wide/i);
    expect(near.block).toContain(`Framed as a ${near.shotSize}`);
  });

  it('describes camera height against the subject, not in metres', () => {
    expect(buildCameraPrompt({ ...base, focalMm: 50, cameraHeightM: 0.25 }).block).toMatch(/ground level|low angle/i);
    expect(buildCameraPrompt({ ...base, focalMm: 50, cameraHeightM: 5 }).block).toMatch(/high above|high angle/i);
  });

  it('always carries the mannequin exclusion and the environment lock', () => {
    const block = buildCameraPrompt({ ...base, focalMm: 35 }).block;
    expect(block).toContain(MANNEQUIN_EXCLUSION);
    expect(block).toContain('no added buildings, signage, or objects');
  });

  it('places the subject in the frame and names its facing', () => {
    const block = buildCameraPrompt({
      ...base, focalMm: 50, subjectFrameX: 0.85, subjectFacing: 'three-quarters toward camera',
    }).block;
    expect(block).toContain('far right of frame');
    expect(block).toContain('facing three-quarters toward camera');
  });
});

describe('REFERENCE_TAGS', () => {
  it('matches the slot mapping exactly', () => {
    expect(REFERENCE_TAGS.plate).toContain('@image1 is the background environment');
    expect(REFERENCE_TAGS.composite).toContain('@image2 shows the exact camera framing');
    expect(REFERENCE_TAGS.depth).toContain('@image3 is a depth map');
    expect(REFERENCE_TAGS.standin).toContain('@image4 shows character position');
  });
});
