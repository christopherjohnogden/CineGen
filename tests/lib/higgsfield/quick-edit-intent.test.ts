import { describe, expect, it } from 'vitest';
import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';
import { HIGGSFIELD_MODELS } from '@/lib/higgsfield/higgsfield-models';

describe('routeQuickEdit', () => {
  it('routes clean-plate / background prompts to an image edit on a frame, overlaid', () => {
    for (const p of ['create a clean plate of this shot', 'remove the background', 'empty the room']) {
      const r = routeQuickEdit(p);
      expect(r.intent).toBe('clean-plate');
      expect(r.model).toBe(HIGGSFIELD_MODELS.nanoBanana);
      expect(r.outputType).toBe('image');
      expect(r.referenceMode).toBe('frame');
      expect(r.placement).toBe('overlay');
    }
  });

  it('routes wardrobe/object changes to reference-driven video, inserted after', () => {
    for (const p of ['make him wear a black suit', 'change the clothes to a red dress', 'remove the logo from the shirt']) {
      const r = routeQuickEdit(p);
      expect(r.intent).toBe('object-change');
      expect(r.model).toBe(HIGGSFIELD_MODELS.seedance);
      expect(r.outputType).toBe('video');
      expect(r.referenceMode).toBe('segment');
      expect(r.placement).toBe('insert_after');
    }
  });

  it('routes extend/continue prompts to a first-last continuation', () => {
    for (const p of ['extend this 3 more seconds', 'continue the same motion', 'more of this']) {
      const r = routeQuickEdit(p);
      expect(r.intent).toBe('extend');
      expect(r.referenceMode).toBe('first-last');
      expect(r.outputType).toBe('video');
    }
  });

  it('routes stylize prompts to an image stylization', () => {
    const r = routeQuickEdit('make it look like a vintage film still');
    expect(r.intent).toBe('stylize');
    expect(r.outputType).toBe('image');
    expect(r.referenceMode).toBe('frame');
  });

  it('falls back to ambiguous → reference-driven video segment', () => {
    const r = routeQuickEdit('do something cool here');
    expect(r.intent).toBe('ambiguous');
    expect(r.model).toBe(HIGGSFIELD_MODELS.seedance);
    expect(r.referenceMode).toBe('segment');
  });

  it('prefers the more specific intent when patterns could overlap', () => {
    // "clean plate" wins over a generic object-change phrasing
    expect(routeQuickEdit('remove the background and make a clean plate').intent).toBe('clean-plate');
  });
});
