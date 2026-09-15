import { describe, expect, it } from 'vitest';
import { mediaFieldCapacity } from '@/lib/studio/fields';
import type { ModelInputField } from '@/types/workflow';

function field(overrides: Partial<ModelInputField>): ModelInputField {
  return {
    id: 'image_url',
    portType: 'media',
    label: 'References',
    required: false,
    falParam: 'reference_images',
    fieldType: 'port',
    ...overrides,
  };
}

describe('mediaFieldCapacity', () => {
  it('reads capacity from max on an element-list that declares no multiple flag', () => {
    // Topview omni `extra_images` — src/lib/topview/model-catalog.ts:323.
    // This is the field Shape Shot's four renders land on.
    expect(mediaFieldCapacity(field({
      id: 'extra_images',
      falParam: 'image_urls',
      fieldType: 'element-list',
      max: 30,
      mediaRole: 'image',
    }))).toBe(30);
  });

  it('honours maxItems over multiple, so a single-slot media tool stays single', () => {
    // Topview media tools — src/lib/topview/media-tools.ts:34. This is the one
    // element-list that sets multiple:true, and it is the one that must be
    // limited to exactly one. `multiple` is an inverted signal here.
    expect(mediaFieldCapacity(field({
      fieldType: 'element-list',
      multiple: true,
      max: 1,
      maxItems: 1,
      mediaRole: 'image',
    }))).toBe(1);
  });

  it('prefers maxItems when max disagrees', () => {
    expect(mediaFieldCapacity(field({ max: 30, maxItems: 4 }))).toBe(4);
  });

  it('treats a multiple port with no explicit bound as unbounded', () => {
    expect(mediaFieldCapacity(field({ multiple: true, mediaRole: 'image' }))).toBe(Infinity);
  });

  it('defaults a plain single port to one', () => {
    expect(mediaFieldCapacity(field({ mediaRole: 'start_image' }))).toBe(1);
  });

  it('never returns less than one, even if a catalogue declares max 0', () => {
    expect(mediaFieldCapacity(field({ max: 0 }))).toBe(1);
  });
});
