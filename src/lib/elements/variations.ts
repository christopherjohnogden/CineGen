import type { Element, ElementImage, ElementVariation, ElementVariationKind } from '@/types/elements';

export const BASELINE_VARIATION_NAME = 'Hero / Clean';

export function elementActiveVariation(element: Element): ElementVariation | undefined {
  const variations = element.variations ?? [];
  return variations.find((variation) => variation.id === element.activeVariationId) ?? variations[0];
}

export function elementVariation(
  element: Element,
  variationId?: string,
): ElementVariation | undefined {
  if (variationId) {
    const selected = element.variations?.find((variation) => variation.id === variationId);
    if (selected) return selected;
  }
  return elementActiveVariation(element);
}

/** The only reference pack that should be sent for this requested story state. */
export function elementImagesForVariation(element: Element, variationId?: string): ElementImage[] {
  const selected = elementVariation(element, variationId);
  if (selected) return selected.images;
  return element.images;
}

export function elementVariationLabel(element: Element, variationId?: string): string {
  return elementVariation(element, variationId)?.name ?? BASELINE_VARIATION_NAME;
}

export function createBaselineVariation(
  images: ElementImage[],
  now: string,
  id: string,
): ElementVariation {
  return {
    id,
    name: BASELINE_VARIATION_NAME,
    kind: 'baseline',
    description: 'The approved clean continuity look before story-state changes.',
    images,
    createdAt: now,
    updatedAt: now,
  };
}

export function variationKindLabel(kind: ElementVariationKind): string {
  switch (kind) {
    case 'baseline': return 'Baseline';
    case 'wardrobe': return 'Wardrobe';
    case 'condition': return 'Condition';
    case 'time': return 'Time / Scene';
    case 'custom': return 'Custom';
  }
}
