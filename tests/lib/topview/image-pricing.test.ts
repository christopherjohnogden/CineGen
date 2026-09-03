import { describe, expect, it } from 'vitest';
import type { ModelDefinition } from '@/types/workflow';
import {
  imageResolutionOptions,
  preferredImageResolution,
  topviewImageCreditEstimate,
} from '@/lib/topview/image-pricing';

function imageModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'topview/image/GPT Image 2',
    nodeType: 'topview-image-gpt-image-2',
    name: 'GPT Image 2',
    category: 'image',
    description: 'Topview image model',
    outputType: 'image',
    provider: 'topview',
    responseMapping: { path: 'url' },
    inputs: [
      {
        id: 'resolution',
        portType: 'text',
        label: 'Resolution',
        required: false,
        falParam: 'resolution',
        fieldType: 'select',
        default: '1K',
        options: [
          { value: '1K', label: '1K' },
          { value: '2K', label: '2K' },
          { value: '4K', label: '4K' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Topview Storyboarder image pricing', () => {
  it('uses only the resolutions supported by the selected live model', () => {
    const model = imageModel();
    expect(imageResolutionOptions(model)).toEqual(['1K', '2K', '4K']);
    expect(preferredImageResolution(model, '4K')).toBe('4K');
    expect(preferredImageResolution(model, '8K')).toBe('1K');
  });

  it('estimates the selected resolution per image and for the full storyboard', () => {
    const estimate = topviewImageCreditEstimate({
      model: imageModel(),
      resolution: '2K',
      count: 9,
    });

    expect(estimate).toMatchObject({
      model: 'GPT Image 2',
      resolution: '2K',
      unitCredits: 0.8,
      totalCredits: 7.2,
      count: 9,
    });
  });

  it('shows each published Nano Banana 2 resolution rate', () => {
    const model = imageModel({ name: 'Nano Banana 2', nodeType: 'topview-image-nano-banana-2' });
    expect(topviewImageCreditEstimate({ model, resolution: '1K', count: 1 })?.unitCredits).toBe(0.4);
    expect(topviewImageCreditEstimate({ model, resolution: '2K', count: 1 })?.unitCredits).toBe(0.6);
    expect(topviewImageCreditEstimate({ model, resolution: '4K', count: 1 })?.unitCredits).toBe(0.85);
  });

  it('uses GPT Image 2 pricing for the legacy automatic Topview model', () => {
    const model = imageModel({
      id: 'topview/image/auto',
      nodeType: 'topview-image-auto',
      name: 'Recommended · Automatic',
    });
    expect(topviewImageCreditEstimate({ model, resolution: '4K', count: 3 })).toMatchObject({
      model: 'GPT Image 2',
      unitCredits: 1.4,
      totalCredits: 4.2,
      usesAutomaticDefault: true,
    });
  });

  it('prices every quality Topview quotes, not just the cheapest', () => {
    const gpt = imageModel({
      inputs: [
        {
          id: 'quality', portType: 'text', label: 'Quality', required: false,
          falParam: 'quality', fieldType: 'select', default: 'medium',
          options: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
        },
      ],
    });
    const quoted = [
      { quality: 'medium', resolution: '1K', credits: 0.2 },
      { quality: 'medium', resolution: '2K', credits: 0.8 },
      { quality: 'medium', resolution: '4K', credits: 1.4 },
      { quality: 'high', resolution: '1K', credits: 1.6 },
      { quality: 'high', resolution: '2K', credits: 3.2 },
      { quality: 'high', resolution: '4K', credits: 4.8 },
    ];
    for (const { quality, resolution, credits } of quoted) {
      expect(topviewImageCreditEstimate({ model: gpt, resolution, quality, count: 1 })?.unitCredits)
        .toBe(credits);
    }
    // However the catalog cases it.
    expect(topviewImageCreditEstimate({ model: gpt, resolution: '2K', quality: 'High', count: 1 })?.unitCredits)
      .toBe(3.2);
    // With nothing chosen, the quality the model would actually submit.
    expect(topviewImageCreditEstimate({ model: gpt, resolution: '2K', count: 1 })?.unitCredits).toBe(0.8);
    // A tier the button was never read on is not quoted at the cheapest tier's price.
    expect(topviewImageCreditEstimate({ model: gpt, resolution: '2K', quality: 'low', count: 1 })).toBeNull();
  });

  it('does not invent Topview credit pricing for another provider', () => {
    expect(topviewImageCreditEstimate({
      model: imageModel({ provider: 'higgsfield' }),
      resolution: '2K',
      count: 9,
    })).toBeNull();
  });
});
