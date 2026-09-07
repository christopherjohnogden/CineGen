import { describe, expect, it } from 'vitest';
import { mergeElementsLibraries, restoreSavedElementReferences } from '@/lib/cloud/elements';
import type { Element, ElementsLibrary } from '@/types/elements';

const temporary = 'https://api.topview.ai/s/expired-reference';
const permanent = 'https://firebasestorage.googleapis.com/v0/b/test/o/reference.png?alt=media&token=test';
const image = { id: 'reference', url: temporary, source: 'generated' as const, createdAt: '2026-08-31T21:14:31Z' };
const actor: Element = {
  id: 'actor', name: 'Sky Diver', type: 'character', description: '', images: [image],
  createdAt: image.createdAt, updatedAt: image.createdAt,
  variations: [{ id: 'baseline', name: 'Hero', kind: 'baseline', description: '', images: [image], createdAt: image.createdAt, updatedAt: image.createdAt }],
};
const library = (...elements: Element[]): ElementsLibrary => ({ version: 1, folders: [], elements });
const savedActor: Element = { ...actor, images: [{ ...image, url: permanent }], variations: undefined };

describe('mergeElementsLibraries', () => {
  it('unifies device libraries, deduplicates project folders, and keeps the newest element', () => {
    const merged = mergeElementsLibraries({
      version: 1,
      folders: [{ id: 'cloud-folder', name: 'Film', createdAt: 'a', sourceProjectId: 'project-1' }],
      elements: [{
        id: 'actor', name: 'Actor old', type: 'character', description: '', images: [],
        folderId: 'cloud-folder', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      }],
    }, {
      version: 1,
      folders: [
        { id: 'device-folder', name: 'Film renamed', createdAt: 'b', sourceProjectId: 'project-1' },
        { id: 'props', name: 'Props', createdAt: 'c' },
      ],
      elements: [
        {
          id: 'actor', name: 'Actor approved', type: 'character', description: '', images: [],
          folderId: 'device-folder', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
        },
        {
          id: 'car', name: 'Car', type: 'vehicle', description: '', images: [],
          folderId: 'props', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
        },
      ],
    });

    expect(merged.folders).toHaveLength(2);
    expect(merged.folders.find((folder) => folder.sourceProjectId === 'project-1')).toMatchObject({
      id: 'cloud-folder',
      name: 'Film',
    });
    expect(merged.elements.find((element) => element.id === 'actor')).toMatchObject({
      name: 'Actor approved',
      folderId: 'cloud-folder',
    });
    expect(merged.elements.find((element) => element.id === 'car')?.folderId).toBe('props');
  });

  it.each([image.createdAt, '2026-09-07T02:00:00Z'])('keeps saved images when an equally old or newer device copy has expired links (%s)', (updatedAt) => {
    const device = library({ ...actor, name: 'Sky Diver renamed', updatedAt });
    const merged = mergeElementsLibraries(library(savedActor), device);
    expect(merged.elements[0].name).toBe('Sky Diver renamed');
    expect(merged.elements[0].images[0].url).toBe(permanent);
    expect(merged.elements[0].variations?.[0].images[0].url).toBe(permanent);
    expect(device.elements[0].images[0].url).toBe(temporary);
    expect(mergeElementsLibraries(merged, device)).toEqual(merged);
  });

  it('restores only matching images without undoing removals or replacing a new upload', () => {
    const replacement = { ...image, createdAt: '2026-09-07T03:00:00Z', url: 'blob:new-image' };
    const requested = library({ ...actor, images: [replacement], variations: [] });
    expect(restoreSavedElementReferences(requested, library(savedActor))).toEqual(restoreSavedElementReferences(requested, library()));
    expect(restoreSavedElementReferences(library(), library(savedActor)).elements).toEqual([]);
    expect(restoreSavedElementReferences(library({ ...actor, id: 'different-actor' }), library(savedActor)).elements[0].images[0].url).toBe(temporary);
  });

  it('can recover saved references from an older device copy without restoring deleted references', () => {
    const newer = { ...actor, images: [], updatedAt: '2026-09-07T03:00:00Z' };
    const merged = mergeElementsLibraries(library(newer), library(savedActor));
    expect(merged.elements[0].images).toEqual([]);
    expect(merged.elements[0].variations?.[0].images[0].url).toBe(permanent);
  });
});
