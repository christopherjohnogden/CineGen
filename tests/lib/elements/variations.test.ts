import { describe, expect, it } from 'vitest';
import type { Element } from '@/types/elements';
import {
  elementActiveVariation,
  elementImagesForVariation,
  elementVariationLabel,
} from '@/lib/elements/variations';

const element: Element = {
  id: 'actor-1',
  name: 'Mara',
  type: 'character',
  description: 'Lead investigator.',
  images: [{ id: 'legacy', url: 'legacy.png', source: 'upload', createdAt: '' }],
  activeVariationId: 'damaged',
  variations: [
    {
      id: 'clean',
      name: 'Hero / Clean',
      kind: 'baseline',
      description: 'Intact wardrobe.',
      images: [{ id: 'clean-front', url: 'clean.png', source: 'generated', createdAt: '' }],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'damaged',
      name: 'After the crash',
      kind: 'condition',
      description: 'Cuts and torn jacket.',
      images: [{ id: 'damaged-front', url: 'damaged.png', source: 'generated', createdAt: '' }],
      createdAt: '',
      updatedAt: '',
    },
  ],
  createdAt: '',
  updatedAt: '',
};

describe('element continuity variations', () => {
  it('uses the approved default look for Director consumers', () => {
    expect(elementActiveVariation(element)?.id).toBe('damaged');
    expect(elementImagesForVariation(element).map((image) => image.url)).toEqual(['damaged.png']);
    expect(elementVariationLabel(element)).toBe('After the crash');
  });

  it('allows a Spaces node to override the default look', () => {
    expect(elementImagesForVariation(element, 'clean').map((image) => image.url)).toEqual(['clean.png']);
  });

  it('keeps older projects working before variations exist', () => {
    const legacy = { ...element, variations: undefined, activeVariationId: undefined };
    expect(elementImagesForVariation(legacy).map((image) => image.url)).toEqual(['legacy.png']);
  });
});
