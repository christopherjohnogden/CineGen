import { describe, expect, it } from 'vitest';
import { mergeElementsLibraries } from '@/lib/cloud/elements';

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
});
