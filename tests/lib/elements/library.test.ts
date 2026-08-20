import { describe, expect, it } from 'vitest';
import {
  countByFolder,
  defaultFolderForNewElement,
  emptyElementsLibrary,
  filterElements,
  migrateProjectsIntoLibrary,
  moveElementsToFolder,
  normalizeElement,
  normalizeLibrary,
  removeElementFolder,
  syncProjectFolder,
} from '@/lib/elements/library';
import type { Element } from '@/types/elements';

function el(partial: Partial<Element> & Pick<Element, 'id' | 'name'>): Element {
  return {
    type: 'character',
    description: '',
    images: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('normalizeElement', () => {
  it('accepts sqlite-shaped rows with JSON images', () => {
    const parsed = normalizeElement({
      id: 'e1',
      name: 'Maya',
      type: 'character',
      description: 'lead',
      images: JSON.stringify([{ id: 'i1', url: 'https://x', createdAt: 't', source: 'upload' }]),
      created_at: 'a',
      updated_at: 'b',
    });
    expect(parsed?.images).toHaveLength(1);
    expect(parsed?.createdAt).toBe('a');
  });

  it('returns null without an id', () => {
    expect(normalizeElement({ name: 'Nope' })).toBeNull();
  });
});

describe('migrateProjectsIntoLibrary', () => {
  it('puts each project\'s elements into a folder named after that project', () => {
    const library = migrateProjectsIntoLibrary(null, [
      { id: 'p1', name: 'Sunset', elements: [el({ id: 'a', name: 'Jordan' })] },
      { id: 'p2', name: 'Night Drive', elements: [el({ id: 'b', name: 'Car', type: 'vehicle' })] },
    ]);
    expect(library.folders.map((f) => f.name).sort()).toEqual(['Night Drive', 'Sunset']);
    const sunset = library.folders.find((f) => f.sourceProjectId === 'p1')!;
    expect(library.elements.find((e) => e.id === 'a')?.folderId).toBe(sunset.id);
  });

  it('does not duplicate an element that is already in the library', () => {
    const seed = migrateProjectsIntoLibrary(null, [
      { id: 'p1', name: 'Sunset', elements: [el({ id: 'a', name: 'Jordan' })] },
    ]);
    const again = migrateProjectsIntoLibrary(seed, [
      { id: 'p1', name: 'Sunset', elements: [el({ id: 'a', name: 'Jordan v2' })] },
    ]);
    expect(again.elements).toHaveLength(1);
    expect(again.elements[0].name).toBe('Jordan');
  });
});

describe('syncProjectFolder', () => {
  it('creates a project folder when missing and renames it when the project is renamed', () => {
    const created = syncProjectFolder(emptyElementsLibrary(), 'p1', 'Sunset');
    expect(created.folders).toHaveLength(1);
    expect(created.folders[0].sourceProjectId).toBe('p1');
    const renamed = syncProjectFolder(created, 'p1', 'Dusk');
    expect(renamed.folders[0].name).toBe('Dusk');
    expect(syncProjectFolder(renamed, 'p1', 'Dusk')).toBe(renamed);
  });
});

describe('filterElements / move / remove folder', () => {
  const folders = [
    { id: 'f1', name: 'Sunset', createdAt: 't', sourceProjectId: 'p1' },
  ];
  const elements = [
    el({ id: 'a', name: 'Jordan', folderId: 'f1' }),
    el({ id: 'b', name: 'Forest', type: 'location' }),
    el({ id: 'c', name: 'Notebook', type: 'prop', folderId: 'f1' }),
  ];

  it('filters by All, a folder, unfiled, and type', () => {
    expect(filterElements(elements, 'all', 'all')).toHaveLength(3);
    expect(filterElements(elements, 'f1', 'all').map((e) => e.id)).toEqual(['a', 'c']);
    expect(filterElements(elements, 'unfiled', 'all').map((e) => e.id)).toEqual(['b']);
    expect(filterElements(elements, 'f1', 'prop').map((e) => e.id)).toEqual(['c']);
  });

  it('moves selected elements into a folder', () => {
    const next = moveElementsToFolder(elements, ['b'], 'f1');
    expect(next.find((e) => e.id === 'b')?.folderId).toBe('f1');
  });

  it('unfiles elements when their folder is removed', () => {
    const next = removeElementFolder({ version: 1, folders, elements }, 'f1');
    expect(next.folders).toHaveLength(0);
    expect(next.elements.every((e) => !e.folderId)).toBe(true);
  });

  it('drops folder ids that point at a missing folder', () => {
    const next = normalizeLibrary({
      version: 1,
      folders: [],
      elements: [el({ id: 'a', name: 'Jordan', folderId: 'gone' })],
    });
    expect(next.elements[0].folderId).toBeUndefined();
  });
});

describe('defaultFolderForNewElement', () => {
  it('uses the active folder, unfiled, or the current project folder from All', () => {
    expect(defaultFolderForNewElement('f1', 'proj')).toBe('f1');
    expect(defaultFolderForNewElement('unfiled', 'proj')).toBeUndefined();
    expect(defaultFolderForNewElement('all', 'proj')).toBe('proj');
  });
});

describe('countByFolder', () => {
  it('counts members and unfiled separately', () => {
    const elements = [
      el({ id: 'a', name: 'A', folderId: 'f1' }),
      el({ id: 'b', name: 'B' }),
    ];
    expect(countByFolder(elements, 'f1')).toBe(1);
    expect(countByFolder(elements, 'unfiled')).toBe(1);
  });
});
