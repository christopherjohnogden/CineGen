import type {
  Element,
  ElementFolder,
  ElementFolderFilter,
  ElementImage,
  ElementType,
  ElementVariation,
  ElementVariationKind,
  ElementsLibrary,
} from '../../types/elements';

export function emptyElementsLibrary(): ElementsLibrary {
  return { version: 1, folders: [], elements: [] };
}

export function normalizeElement(raw: unknown): Element | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) return null;
  const type = row.type === 'character' || row.type === 'location' || row.type === 'prop' || row.type === 'vehicle'
    ? row.type
    : 'character';
  const folderId = typeof row.folderId === 'string' && row.folderId
    ? row.folderId
    : typeof row.folder_id === 'string' && row.folder_id
      ? row.folder_id
      : undefined;
  const variations = normalizeVariations(row.variations);
  const activeVariationId = typeof row.activeVariationId === 'string'
    && variations.some((variation) => variation.id === row.activeVariationId)
    ? row.activeVariationId
    : variations[0]?.id;
  return {
    id,
    name: typeof row.name === 'string' ? row.name : 'Untitled',
    type,
    description: typeof row.description === 'string' ? row.description : '',
    images: normalizeImages(row.images),
    variations: variations.length ? variations : undefined,
    activeVariationId,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : (typeof row.created_at === 'string' ? row.created_at : ''),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : (typeof row.updated_at === 'string' ? row.updated_at : ''),
    folderId,
  };
}

function normalizeVariationKind(value: unknown): ElementVariationKind {
  return value === 'baseline' || value === 'wardrobe' || value === 'condition' || value === 'time' || value === 'custom'
    ? value
    : 'custom';
}

function normalizeVariations(raw: unknown): ElementVariation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) return [];
    return [{
      id,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Untitled look',
      kind: normalizeVariationKind(row.kind),
      description: typeof row.description === 'string' ? row.description : '',
      images: normalizeImages(row.images),
      sourceVariationId: typeof row.sourceVariationId === 'string' && row.sourceVariationId
        ? row.sourceVariationId
        : undefined,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    }];
  });
}

function normalizeImages(raw: unknown): ElementImage[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const img = item as Record<string, unknown>;
    if (typeof img.id !== 'string' || typeof img.url !== 'string') return [];
    return [{
      id: img.id,
      url: img.url,
      createdAt: typeof img.createdAt === 'string' ? img.createdAt : '',
      source: img.source === 'generated' ? 'generated' : 'upload',
    }];
  });
}

export function normalizeFolder(raw: unknown): ElementFolder | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) return null;
  const sourceProjectId = typeof row.sourceProjectId === 'string' && row.sourceProjectId
    ? row.sourceProjectId
    : undefined;
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Untitled',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    sourceProjectId,
  };
}

export function normalizeLibrary(raw: unknown): ElementsLibrary {
  if (!raw || typeof raw !== 'object') return emptyElementsLibrary();
  const row = raw as Record<string, unknown>;
  const folders = Array.isArray(row.folders)
    ? row.folders.map(normalizeFolder).filter((f): f is ElementFolder => f !== null)
    : [];
  const folderIds = new Set(folders.map((f) => f.id));
  const elements = Array.isArray(row.elements)
    ? row.elements.map(normalizeElement).filter((e): e is Element => e !== null)
    : [];
  return {
    version: 1,
    folders,
    elements: elements.map((el) => (
      el.folderId && !folderIds.has(el.folderId) ? { ...el, folderId: undefined } : el
    )),
  };
}

export interface ProjectElementsDump {
  id: string;
  name: string;
  elements: unknown[];
}

/** First-run merge: project-local elements land in a folder named after that project. */
export function migrateProjectsIntoLibrary(
  existing: ElementsLibrary | null,
  projects: ProjectElementsDump[],
): ElementsLibrary {
  const library = existing ? normalizeLibrary(existing) : emptyElementsLibrary();
  const byId = new Map(library.elements.map((el) => [el.id, el]));
  const folders = [...library.folders];

  for (const project of projects) {
    const incoming = project.elements.map(normalizeElement).filter((e): e is Element => e !== null);
    if (incoming.length === 0) continue;

    let folder = folders.find((f) => f.sourceProjectId === project.id);
    if (!folder) {
      folder = {
        id: crypto.randomUUID(),
        name: project.name.trim() || 'Untitled project',
        createdAt: new Date().toISOString(),
        sourceProjectId: project.id,
      };
      folders.push(folder);
    }

    for (const el of incoming) {
      if (byId.has(el.id)) continue;
      byId.set(el.id, { ...el, folderId: el.folderId && folders.some((f) => f.id === el.folderId) ? el.folderId : folder.id });
    }
  }

  return { version: 1, folders, elements: [...byId.values()] };
}

export function syncProjectFolder(
  library: ElementsLibrary,
  projectId: string,
  projectName: string,
): ElementsLibrary {
  const name = projectName.trim() || 'Untitled project';
  const existing = library.folders.find((f) => f.sourceProjectId === projectId);
  if (!existing) {
    const folder: ElementFolder = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      sourceProjectId: projectId,
    };
    return { ...library, folders: [...library.folders, folder] };
  }
  if (existing.name === name) return library;
  return {
    ...library,
    folders: library.folders.map((f) => (f.id === existing.id ? { ...f, name } : f)),
  };
}

export function projectFolderId(library: ElementsLibrary, projectId: string): string | undefined {
  return library.folders.find((f) => f.sourceProjectId === projectId)?.id;
}

export function filterElements(
  elements: Element[],
  folder: ElementFolderFilter,
  type: ElementType | 'all',
): Element[] {
  return elements.filter((el) => {
    if (type !== 'all' && el.type !== type) return false;
    if (folder === 'all') return true;
    if (folder === 'unfiled') return !el.folderId;
    return el.folderId === folder;
  });
}

export function moveElementsToFolder(
  elements: Element[],
  ids: Iterable<string>,
  folderId: string | undefined,
): Element[] {
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  return elements.map((el) => (
    idSet.has(el.id) ? { ...el, folderId, updatedAt: now } : el
  ));
}

export function removeElementFolder(
  library: ElementsLibrary,
  folderId: string,
): ElementsLibrary {
  return {
    version: 1,
    folders: library.folders.filter((f) => f.id !== folderId),
    elements: library.elements.map((el) => (
      el.folderId === folderId ? { ...el, folderId: undefined } : el
    )),
  };
}

export function defaultFolderForNewElement(
  folder: ElementFolderFilter,
  projectFolderId: string | undefined,
): string | undefined {
  if (folder === 'unfiled') return undefined;
  if (folder !== 'all') return folder;
  return projectFolderId;
}

export function countByFolder(elements: Element[], folderId: string | 'unfiled'): number {
  if (folderId === 'unfiled') return elements.filter((el) => !el.folderId).length;
  return elements.filter((el) => el.folderId === folderId).length;
}
