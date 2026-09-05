import { doc, getDoc, runTransaction } from 'firebase/firestore';
import type { Element, ElementFolder, ElementsLibrary } from '@/types/elements';
import { normalizeLibrary } from '@/lib/elements/library';
import { cloudDb, waitForCloudAuth } from './firebase';
import { getProjectCollaboration, resolveProjectCreationTeam } from './collaboration';
import { prepareElementsLibraryForCloudMedia } from './media';

const MAX_LIBRARY_BYTES = 850_000;
const loadedRevisions = new Map<string, number>();

export interface ElementsLibraryOptions {
  projectId?: string;
  projectName?: string;
}

interface LibraryTarget {
  teamId: string;
  ownerId: string;
}

function updatedAt(value: Element): number {
  const parsed = Date.parse(value.updatedAt || value.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Union two device libraries without losing newer edits or duplicating project folders. */
export function mergeElementsLibraries(
  cloudValue: unknown,
  deviceValue: unknown,
): ElementsLibrary {
  const cloud = normalizeLibrary(cloudValue);
  const device = normalizeLibrary(deviceValue);
  const folders: ElementFolder[] = [...cloud.folders];
  const folderAliases = new Map<string, string>();
  const folderIds = new Set(folders.map((folder) => folder.id));
  const projectFolders = new Map(
    folders.flatMap((folder) => folder.sourceProjectId ? [[folder.sourceProjectId, folder] as const] : []),
  );

  for (const folder of device.folders) {
    const projectFolder = folder.sourceProjectId ? projectFolders.get(folder.sourceProjectId) : undefined;
    if (projectFolder) {
      folderAliases.set(folder.id, projectFolder.id);
      continue;
    }
    if (folderIds.has(folder.id)) continue;
    folders.push(folder);
    folderIds.add(folder.id);
    if (folder.sourceProjectId) projectFolders.set(folder.sourceProjectId, folder);
  }

  const remapFolder = (element: Element): Element => {
    const folderId = element.folderId ? (folderAliases.get(element.folderId) ?? element.folderId) : undefined;
    return folderId === element.folderId ? element : { ...element, folderId };
  };
  const elements = new Map(cloud.elements.map((element) => [element.id, element]));
  for (const rawElement of device.elements) {
    const element = remapFolder(rawElement);
    const existing = elements.get(element.id);
    if (!existing || updatedAt(element) >= updatedAt(existing)) elements.set(element.id, element);
  }

  return normalizeLibrary({ version: 1, folders, elements: [...elements.values()] });
}

function readStoredLibrary(data: Record<string, unknown>): ElementsLibrary {
  const raw = data.elementsLibraryJson;
  if (typeof raw !== 'string' || !raw.trim()) return normalizeLibrary(null);
  try {
    return normalizeLibrary(JSON.parse(raw));
  } catch {
    throw new Error('The shared Elements library is damaged and could not be opened.');
  }
}

function serializedLibrary(library: ElementsLibrary): string {
  const json = JSON.stringify(normalizeLibrary(library));
  if (new TextEncoder().encode(json).byteLength > MAX_LIBRARY_BYTES) {
    throw new Error('The shared Elements library is too large to sync. Remove unused reference views and try again.');
  }
  return json;
}

async function resolveTarget(projectId?: string): Promise<{ userId: string; target: LibraryTarget } | null> {
  const user = await waitForCloudAuth();
  if (!user) return null;
  if (projectId) {
    const access = await getProjectCollaboration(projectId).catch(() => null);
    if (access?.teamId && access.members[user.uid]) {
      return { userId: user.uid, target: { teamId: access.teamId, ownerId: access.ownerId } };
    }
  }
  const team = await resolveProjectCreationTeam(user);
  return { userId: user.uid, target: { teamId: team.teamId, ownerId: team.ownerId } };
}

async function saveCloudLibrary(
  library: ElementsLibrary,
  options: ElementsLibraryOptions,
  resolved?: Awaited<ReturnType<typeof resolveTarget>>,
): Promise<ElementsLibrary> {
  const context = resolved ?? await resolveTarget(options.projectId);
  if (!context) return library;
  const durable = await prepareElementsLibraryForCloudMedia(
    normalizeLibrary(library),
    context.userId,
    options.projectId || `elements-${context.target.teamId}`,
  );
  const ref = doc(cloudDb, 'teams', context.target.teamId);
  const expectedRevision = loadedRevisions.get(context.target.teamId);
  let saved = durable;
  let savedRevision = 0;

  await runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('The CineGen team workspace was not found.');
    const data = snapshot.data() as Record<string, unknown>;
    const currentRevision = Number(data.elementsLibraryRevision ?? 0) || 0;
    const current = readStoredLibrary(data);
    saved = expectedRevision !== undefined && expectedRevision === currentRevision
      ? durable
      : mergeElementsLibraries(current, durable);
    savedRevision = currentRevision + 1;
    transaction.update(ref, {
      elementsLibraryJson: serializedLibrary(saved),
      elementsLibraryRevision: savedRevision,
      elementsLibraryUpdatedAt: new Date().toISOString(),
    });
  });
  loadedRevisions.set(context.target.teamId, savedRevision);
  return saved;
}

function reportSyncError(error: unknown): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cinegen:cloud-sync-error', { detail: error }));
  }
}

export async function loadAvailableElementsLibrary(
  options: ElementsLibraryOptions = {},
): Promise<ElementsLibrary> {
  const device = normalizeLibrary(await window.electronAPI.elements.loadLibrary(options));
  const context = await resolveTarget(options.projectId).catch((error) => {
    reportSyncError(error);
    return null;
  });
  if (!context) return device;

  try {
    const snapshot = await getDoc(doc(cloudDb, 'teams', context.target.teamId));
    if (!snapshot.exists()) return device;
    const data = snapshot.data() as Record<string, unknown>;
    const revision = Number(data.elementsLibraryRevision ?? 0) || 0;
    const cloud = readStoredLibrary(data);
    loadedRevisions.set(context.target.teamId, revision);
    const merged = mergeElementsLibraries(cloud, device);
    const synced = JSON.stringify(merged) === JSON.stringify(cloud)
      ? cloud
      : await saveCloudLibrary(merged, options, context);
    await window.electronAPI.elements.saveLibrary(synced);
    return synced;
  } catch (error) {
    console.warn('[cloud] Shared Elements library could not be loaded:', error);
    reportSyncError(error);
    return device;
  }
}

export async function saveAvailableElementsLibrary(
  libraryValue: unknown,
  options: ElementsLibraryOptions = {},
): Promise<ElementsLibrary> {
  const requested = normalizeLibrary(libraryValue);
  const device = normalizeLibrary(await window.electronAPI.elements.saveLibrary(requested));
  try {
    const synced = await saveCloudLibrary(device, options);
    if (JSON.stringify(synced) !== JSON.stringify(device)) {
      await window.electronAPI.elements.saveLibrary(synced);
    }
    return synced;
  } catch (error) {
    reportSyncError(error);
    throw error;
  }
}

/** Shared by the Element modal and MCP: approval never stores a temporary provider URL. */
export async function prepareElementReferences(
  element: Element,
  projectId: string,
): Promise<Element> {
  const context = await resolveTarget(projectId);
  const library: ElementsLibrary = { version: 1, folders: [], elements: [element] };
  if (context) {
    return (await prepareElementsLibraryForCloudMedia(library, context.userId, projectId)).elements[0];
  }
  const durable = structuredClone(element);
  const sources = new Map<string, string>();
  for (const image of new Set([...durable.images, ...(durable.variations ?? []).flatMap(look => look.images)])) {
    const existing = sources.get(image.url);
    if (existing) { image.url = existing; continue; }
    const source = image.url;
    const api = window.electronAPI?.media?.persistGeneratedAsset;
    if (!api) throw new Error('Project reference storage is unavailable. Sign in to the cloud or use CineGen Desktop.');
    const remote = /^(https?:|data:)/i.test(source);
    const result = await api({ projectId, assetId: `${element.id}-reference-${image.id}`, assetType: 'image', ...(remote ? { remoteUrl: source } : { localPathHint: source }) });
    if ('error' in result) throw new Error(result.error);
    if (!result.path) throw new Error('Reference storage returned no saved file.');
    image.url = `local-media://file${result.path}`;
    sources.set(source, image.url);
  }
  return durable;
}
