import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '@/types/elements';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), persist: vi.fn() }));
vi.mock('@/lib/elements/reference-generation', () => ({
  generateSingleImage: mocks.generate,
  buildIndividualPrompts: (_type: string, description: string) => Array.from({ length: 7 }, (_, i) => `${description} view ${i}`),
  elementGenerationModelOptions: () => [{ key: 'image-model', provider: 'topview' }],
}));
vi.mock('@/lib/cloud/elements', () => ({ prepareElementReferences: mocks.persist }));
import { buildElementDraft } from '@/lib/elements/build-element';
import { materializeElementLooks } from '@/lib/elements/variations';
const existing: Element = { id: 'mug', name: 'Coffee Mug', type: 'prop', description: 'Ceramic mug', createdAt: 'now', updatedAt: 'now', images: [{ id: 'old', url: 'https://provider/old', source: 'generated', createdAt: 'now' }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockImplementation(async () => ({ url: `https://provider/${mocks.generate.mock.calls.length}`, referenceValue: `ref-${mocks.generate.mock.calls.length}` }));
  mocks.persist.mockImplementation(async (el: Element) => {
    const copy = structuredClone(el);
    for (const image of [...copy.images, ...copy.variations!.flatMap(v => v.images)]) image.url = image.url.replace('https://provider/', 'https://project/');
    return copy;
  });
});
describe('Element build service', () => {
  it('ingests existing short-link art without generating or changing the original', async () => {
    const draft = await buildElementDraft({ reference: { mode: 'upload', uploadUrls: [existing.images[0].url] } }, existing, 'project');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(draft.id).toBe(existing.id);
    expect(draft.variations![0].name).toBe('Hero / Clean');
    expect(draft.images[0].url).toBe('https://project/old');
    expect(draft.images[0].id).toBeTruthy();
    expect(existing.images[0].url).toBe('https://provider/old');
  });
  it('uses stable first/previous reference anchors and stores generated packs before returning', async () => {
    const draft = await buildElementDraft({ name: 'Mug', type: 'prop', description: 'Ceramic', reference: { mode: 'guide', model: 'image-model', guideImages: ['guide'], views: 3 } }, undefined, 'project');
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(mocks.generate.mock.calls[2][2]).toEqual(['guide', 'ref-1', 'ref-2']);
    expect(draft.images).toHaveLength(3);
    expect(draft.images.every(image => image.url.startsWith('https://project/'))).toBe(true);
  });
  it('generates a continuity look from the durable baseline pack', async () => {
    const draft = await buildElementDraft({ name: 'Mug', type: 'prop', reference: { mode: 'upload', uploadUrls: ['https://provider/base'] }, variations: [{ name: 'Broken', kind: 'condition', description: 'Cracked handle', reference: { mode: 'generate', model: 'image-model', views: 1 } }] }, undefined, 'project');
    expect(draft.variations).toHaveLength(2);
    expect(mocks.generate.mock.calls[0][2]).toContain('https://project/base');
    expect(draft.variations![1].sourceVariationId).toBe(draft.activeVariationId);
    expect(draft.images[0].url).toBe('https://project/base');
  });
  it('rejects invalid later look requests before spending any credits', async () => {
    await expect(buildElementDraft({ name: 'Mug', reference: { mode: 'generate', model: 'image-model' }, variations: [{ name: 'Broken', kind: 'condition', description: 'Cracked', reference: { mode: 'generate', model: 'missing' } }] }, undefined, 'project')).rejects.toThrow(/model/);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('surfaces storage failure and never returns an apparently approved draft', async () => {
    mocks.persist.mockRejectedValue(new Error('Storage unavailable'));
    await expect(buildElementDraft({ reference: { mode: 'upload', uploadUrls: ['https://provider/old'] } }, existing, 'project')).rejects.toThrow('Storage unavailable');
    expect(existing.images[0].url).toBe('https://provider/old');
  });
  it('materializes legacy looks with stable IDs while preserving stored continuity', () => {
    expect(materializeElementLooks(existing)).toEqual(materializeElementLooks(existing));
    const el = materializeElementLooks(existing);
    expect(materializeElementLooks(el).variations).toEqual(el.variations);
  });
});
