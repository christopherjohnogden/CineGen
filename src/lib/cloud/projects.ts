import { readCloudProject } from './project-reader';
import { reportCloudSyncFailure, reportCloudSyncSuccess } from './sync-status';
import { restoreCloudMediaReferences } from './media-references';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { ProjectMeta } from '../../../electron';
import { cloudDb, waitForCloudAuth } from './firebase';
import { CLOUD_SIGN_IN_REQUIRED } from './auth-errors';
import { prepareStateForCloudMedia } from './media';
import {
  ensureProjectAccess,
  getProjectCollaboration,
  listSharedProjectAccess,
  registerCloudIdentity,
  type ProjectRole,
} from './collaboration';
import { canDeleteTeamProject } from './team-policy';

const CLOUD_IDS_KEY = 'cinegen_cloud_project_ids';
const CHUNK_SIZE = 180_000;
const BATCH_SIZE = 350;

export interface AvailableProjectMeta extends ProjectMeta {
  cloud?: boolean;
  cloudRole?: ProjectRole;
  cloudTeamId?: string;
  cloudTeamName?: string;
  cloudCreatorId?: string;
  cloudCanDelete?: boolean;
}

interface CloudProjectDocument {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  elementCount: number;
  thumbnail: string | null;
  useSqlite: boolean;
  currentRevision: string;
  chunkCount: number;
  schemaVersion: number;
}

const loadedRevisions = new Map<string, string>();
const loadedOwners = new Map<string, string>();
const loadedStates = new Map<string, Record<string, unknown>>();
const saveQueues = new Map<string, Promise<unknown>>();

function timestamp(): string {
  return new Date().toISOString();
}

function generateId(): string {
  return crypto.randomUUID();
}

function cloudKey(uid: string, projectId: string): string {
  return `${uid}:${projectId}`;
}

function readKnownCloudIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOUD_IDS_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function rememberCloudProject(projectId: string): void {
  if (typeof window === 'undefined') return;
  const ids = readKnownCloudIds();
  ids.add(projectId);
  localStorage.setItem(CLOUD_IDS_KEY, JSON.stringify([...ids]));
}

function forgetCloudProject(projectId: string): void {
  if (typeof window === 'undefined') return;
  const ids = readKnownCloudIds();
  ids.delete(projectId);
  localStorage.setItem(CLOUD_IDS_KEY, JSON.stringify([...ids]));
}

export function isCloudProjectId(projectId: string): boolean {
  return projectId.startsWith('cloud_') || readKnownCloudIds().has(projectId);
}

function defaultDirector() {
  return {
    sourceText: '', clipLengthSec: 20, stylePrefix: '', aspectRatio: '16:9',
    adapterId: 'topview-auto', resolution: '720p', generateAudio: true,
    genre: 'auto', mode: 'source', breakdown: [], breakdownApproved: false,
    scenes: [], clips: [], jobStatus: null,
  };
}

function createDefaultCloudProject(name: string) {
  const id = `cloud_${generateId().replaceAll('-', '')}`;
  const now = timestamp();
  const timelineId = generateId();
  const spaceId = generateId();
  return {
    project: {
      id, name, created_at: now, updated_at: now,
      resolution_width: 1920, resolution_height: 1080, frame_rate: 24,
    },
    assets: [],
    mediaFolders: [],
    timelines: [{
      id: timelineId, project_id: id, name: 'Timeline 1', duration: 0,
      created_at: now, markers: '[]',
      tracks: [
        { id: generateId(), timeline_id: timelineId, name: 'Video 1', kind: 'video', color: '#4A90D9', muted: 0, solo: 0, locked: 0, visible: 1, volume: 1, sort_order: 0 },
        { id: generateId(), timeline_id: timelineId, name: 'Audio 1', kind: 'audio', color: '#7ED321', muted: 0, solo: 0, locked: 0, visible: 1, volume: 1, sort_order: 1 },
      ],
      clips: [], transitions: [],
    }],
    activeTimelineId: timelineId,
    workflow: {
      nodes: [], edges: [],
      spaces: [{ id: spaceId, name: 'Space 1', createdAt: now, nodes: [], edges: [] }],
      activeSpaceId: spaceId, openSpaceIds: [spaceId], director: defaultDirector(),
    },
    elements: [], exports: [], director: defaultDirector(),
  };
}

function projectDetails(state: Record<string, unknown>, fallbackId: string) {
  const project = (state.project ?? {}) as Record<string, unknown>;
  const assets = Array.isArray(state.assets) ? state.assets as Array<Record<string, unknown>> : [];
  const elements = Array.isArray(state.elements) ? state.elements : [];
  const thumbnail = assets.find((asset) => {
    const value = asset.thumbnailUrl ?? asset.thumbnail_url;
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  });
  const camelCreatedAt = typeof project.createdAt === 'string' ? project.createdAt.trim() : '';
  const snakeCreatedAt = typeof project.created_at === 'string' ? project.created_at.trim() : '';
  return {
    id: typeof project.id === 'string' ? project.id : fallbackId,
    name: typeof project.name === 'string' ? project.name : 'Untitled Project',
    createdAt: camelCreatedAt || snakeCreatedAt,
    assetCount: assets.length,
    elementCount: elements.length,
    thumbnail: (thumbnail?.thumbnailUrl ?? thumbnail?.thumbnail_url ?? null) as string | null,
  };
}

function splitState(state: unknown): string[] {
  const serialized = JSON.stringify(state);
  const chunks: string[] = [];
  for (let offset = 0; offset < serialized.length; offset += CHUNK_SIZE) {
    chunks.push(serialized.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : ['{}'];
}

async function seedOwnedCloudProject(
  projectId: string,
  state: unknown,
  useSqlite: boolean,
): Promise<void> {
  const user = await waitForCloudAuth();
  if (!user) throw new Error('Sign in to CineGen Cloud before syncing a project.');
  const details = projectDetails(state as Record<string, unknown>, projectId);
  await setDoc(doc(cloudDb, 'users', user.uid, 'projects', projectId), {
    ...details,
    createdAt: details.createdAt || timestamp(),
    updatedAt: timestamp(),
    useSqlite,
    currentRevision: '',
    chunkCount: 0,
    schemaVersion: 1,
  }, { merge: true });
  await ensureProjectAccess(projectId, user);
}

async function deleteRevision(uid: string, projectId: string, revision: string): Promise<void> {
  if (!revision) return;
  const revisionRef = doc(cloudDb, 'users', uid, 'projects', projectId, 'revisions', revision);
  const chunks = await getDocs(collection(revisionRef, 'chunks'));
  let batch = writeBatch(cloudDb);
  let count = 0;
  for (const chunk of chunks.docs) {
    batch.delete(chunk.ref);
    count += 1;
    if (count >= BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(cloudDb);
      count = 0;
    }
  }
  batch.delete(revisionRef);
  await batch.commit();
}

async function performCloudSave(projectId: string, state: unknown, useSqlite: boolean): Promise<void> {
  const user = await waitForCloudAuth();
  if (!user) throw new Error('Sign in to CineGen Cloud before syncing a project.');
  const access = await ensureProjectAccess(projectId, user);
  const ownerId = access.ownerId;

  const cloudState = await prepareStateForCloudMedia(state, ownerId, projectId);
  const stateRecord = cloudState as Record<string, unknown>;
  const details = projectDetails(stateRecord, projectId);
  const revision = generateId().replaceAll('-', '');
  const chunks = splitState(cloudState);
  const projectRef = doc(cloudDb, 'users', ownerId, 'projects', projectId);
  const revisionRef = doc(projectRef, 'revisions', revision);
  const key = cloudKey(ownerId, projectId);
  const expectedRevision = loadedRevisions.get(key);

  await setDoc(revisionRef, { chunkCount: chunks.length, createdAt: timestamp(), complete: false });
  let batch = writeBatch(cloudDb);
  let batchCount = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkRef = doc(revisionRef, 'chunks', String(index).padStart(6, '0'));
    batch.set(chunkRef, { index, data: chunks[index] });
    batchCount += 1;
    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(cloudDb);
      batchCount = 0;
    }
  }
  batch.set(revisionRef, { chunkCount: chunks.length, complete: true }, { merge: true });
  await batch.commit();

  let previousRevision = '';
  try {
    await runTransaction(cloudDb, async (transaction) => {
      const current = await transaction.get(projectRef);
      previousRevision = current.exists() ? String(current.data().currentRevision ?? '') : '';
      if (expectedRevision && previousRevision && previousRevision !== expectedRevision) {
        throw new Error('This project changed on another device. Reopen it to load the newer version before editing.');
      }
      const currentData = current.exists() ? current.data() as Partial<CloudProjectDocument> : {};
      const metadata: CloudProjectDocument = {
        ...details,
        createdAt: details.createdAt || currentData.createdAt || timestamp(),
        updatedAt: timestamp(),
        useSqlite,
        currentRevision: revision,
        chunkCount: chunks.length,
        schemaVersion: 1,
      };
      transaction.set(projectRef, metadata, { merge: true });
    });
  } catch (error) {
    // Roll the failed write back, but never silently: a swallowed failure here
    // leaks an orphaned revision (and its chunks) into Firestore forever.
    await deleteRevision(ownerId, projectId, revision).catch((cleanupError) => {
      console.warn('[cloud] Failed save left an orphaned revision behind:', revision, cleanupError);
    });
    throw error;
  }

  loadedRevisions.set(key, revision);
  loadedStates.set(key, restoreCloudMediaReferences(stateRecord));
  rememberCloudProject(projectId);
  if (previousRevision && previousRevision !== revision) {
    void deleteRevision(ownerId, projectId, previousRevision).catch((error) => {
      console.warn('[cloud] Old project revision cleanup failed:', error);
    });
  }
}

export function saveCloudProject(projectId: string, state: unknown, useSqlite: boolean): Promise<void> {
  const prior = saveQueues.get(projectId) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(() => performCloudSave(projectId, state, useSqlite)).then(() => { reportCloudSyncSuccess('project'); }).catch(error => { reportCloudSyncFailure(error, 'project'); throw error; });
  saveQueues.set(projectId, next);
  return next.finally(() => {
    if (saveQueues.get(projectId) === next) saveQueues.delete(projectId);
  });
}

export async function loadCloudProject<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  const user = await waitForCloudAuth();
  if (!user) throw new Error(CLOUD_SIGN_IN_REQUIRED);
  const { ownerId, revision, state } = await readCloudProject(user, projectId, signal);
  signal?.throwIfAborted();
  const restored = restoreCloudMediaReferences(state as T);
  loadedRevisions.set(cloudKey(ownerId, projectId), revision);
  loadedOwners.set(cloudKey(user.uid, projectId), ownerId);
  loadedStates.clear();
  loadedStates.set(cloudKey(ownerId, projectId), restored as Record<string, unknown>);
  rememberCloudProject(projectId);
  return restored;
}

// Push updates are the fast path. A bounded REST check independently recovers
// missed/failed listeners, including after sleep, without waiting on the SDK.
export async function watchCloudProject(
  projectId: string,
  canApply: () => boolean,
  apply: (snapshot: Record<string, unknown>, base?: Record<string, unknown>) => boolean,
): Promise<() => void> {
  if (!isCloudProjectId(projectId)) return () => {};
  const user = await waitForCloudAuth();
  if (!user) return () => {};
  let ownerId = loadedOwners.get(cloudKey(user.uid, projectId));
  let disposed = false, busy = false, again = false, notice = 0;
  let stopListener: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const interval = () => document.visibilityState === 'hidden' ? 15_000 : 2000;
  const schedule = (delay: number) => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), delay);
  };
  const listen = () => {
    if (disposed || stopListener || !ownerId) return;
    const projectRef = doc(cloudDb, 'users', ownerId, 'projects', projectId);
    stopListener = onSnapshot(projectRef, snapshot => {
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      const revision = String(snapshot.data()?.currentRevision ?? '');
      if (revision && revision !== loadedRevisions.get(cloudKey(ownerId!, projectId))) {
        notice++;
        void refresh();
      }
    }, error => {
      console.warn('[cloud] Live listener will reconnect; server checks remain active:', error);
      stopListener?.(); stopListener = undefined;
      if (!busy) schedule(interval());
    });
  };
  const refresh = async () => {
    if (disposed) return;
    if (busy) { again = true; return; }
    if (timer) clearTimeout(timer);
    if (navigator.onLine === false || saveQueues.has(projectId) || !canApply()) { schedule(interval()); return; }
    busy = true; again = false;
    controller = new AbortController();
    const before = ownerId ? loadedRevisions.get(cloudKey(ownerId, projectId)) : undefined;
    const seen = notice;
    try {
      // Do not run access migrations/identity writes to start a read-only watch.
      const result = await readCloudProject(user, projectId, controller.signal, { ownerId, revision: before });
      if (disposed || controller.signal.aborted) return;
      if (ownerId !== result.ownerId) { stopListener?.(); stopListener = undefined; }
      ownerId = result.ownerId;
      loadedOwners.set(cloudKey(user.uid, projectId), ownerId);
      listen();
      if (!result.state || seen !== notice || loadedRevisions.get(cloudKey(ownerId, projectId)) !== before
        || saveQueues.has(projectId) || !canApply()) return;
      const raw = restoreCloudMediaReferences(result.state) as Record<string, unknown>;
      const key = cloudKey(ownerId, projectId);
      if (apply(raw, loadedStates.get(key))) {
        loadedRevisions.set(key, result.revision);
        loadedStates.set(key, raw);
      }
    } catch (error) {
      if (!disposed && !controller.signal.aborted) console.warn('[cloud] Live project update will retry:', error);
    } finally {
      busy = false; controller = undefined;
      if (!disposed) { listen(); schedule(again ? 0 : interval()); }
    }
  };
  const wake = () => {
    if (document.visibilityState === 'hidden') return;
    if (busy) { again = true; controller?.abort(); } else void refresh();
  };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  const stopPower = window.electronAPI?.app?.onPowerEvent?.(({ type }) => {
    if (type === 'resume' || type === 'unlock-screen') wake();
  });
  listen();
  void refresh();
  return () => {
    disposed = true; controller?.abort(); stopListener?.(); stopPower?.();
    if (timer) clearTimeout(timer);
    window.removeEventListener('focus', wake);
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}

export async function listCloudProjects(): Promise<AvailableProjectMeta[]> {
  const user = await waitForCloudAuth();
  if (!user) return [];
  await registerCloudIdentity(user);

  // Existing private projects predate collaboration. Register each one as an
  // owner project the first time this version of CineGen sees it.
  const owned = await getDocs(query(
    collection(cloudDb, 'users', user.uid, 'projects'),
    orderBy('updatedAt', 'desc'),
  ));
  await Promise.all(owned.docs.map((entry) => ensureProjectAccess(entry.id, user)));

  const accessList = await listSharedProjectAccess(user.uid);
  const projects = await Promise.all(accessList.map(async (access) => {
    const entry = await getDoc(doc(cloudDb, 'users', access.ownerId, 'projects', access.projectId));
    if (!entry.exists()) return null;
    const data = entry.data() as CloudProjectDocument;
    rememberCloudProject(entry.id);
    return {
      id: entry.id,
      name: data.name ?? 'Untitled Project',
      createdAt: data.createdAt ?? timestamp(),
      updatedAt: data.updatedAt ?? timestamp(),
      assetCount: data.assetCount ?? 0,
      elementCount: data.elementCount ?? 0,
      thumbnail: data.thumbnail ?? null,
      useSqlite: data.useSqlite !== false,
      cloud: true,
      cloudRole: access.members[user.uid],
      cloudTeamId: access.teamId || undefined,
      cloudTeamName: access.teamName || undefined,
      cloudCreatorId: access.ownerId,
      cloudCanDelete: canDeleteTeamProject(access.ownerId, user.uid),
    } satisfies AvailableProjectMeta;
  }));
  return projects
    .filter((project): project is NonNullable<typeof project> => project !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listAvailableProjects(): Promise<AvailableProjectMeta[]> {
  const [local, cloud] = await Promise.all([
    window.electronAPI.project.list().catch(() => []),
    listCloudProjects().catch((error) => {
      console.warn('[cloud] Could not list projects:', error);
      return [];
    }),
  ]);
  const merged = new Map<string, AvailableProjectMeta>();
  for (const project of local) merged.set(project.id, project);
  for (const project of cloud) merged.set(project.id, project);
  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createAvailableProject(name: string): Promise<{ project: { id: string } }> {
  const user = await waitForCloudAuth();
  if (!user) return window.electronAPI.db.createProject(name) as Promise<{ project: { id: string } }>;
  const state = createDefaultCloudProject(name);
  await seedOwnedCloudProject(state.project.id, state, true);
  await saveCloudProject(state.project.id, state, true);
  return state;
}

export async function deleteAvailableProject(project: AvailableProjectMeta): Promise<void> {
  if (project.cloud || isCloudProjectId(project.id)) {
    const user = await waitForCloudAuth();
    if (!user) throw new Error('Sign in to delete this cloud project.');
    const access = await ensureProjectAccess(project.id, user);
    if (!canDeleteTeamProject(access.ownerId, user.uid)) throw new Error('Only the person who created this project can delete it.');
    const projectRef = doc(cloudDb, 'users', access.ownerId, 'projects', project.id);
    const revisions = await getDocs(collection(projectRef, 'revisions'));
    for (const revision of revisions.docs) await deleteRevision(access.ownerId, project.id, revision.id);
    await deleteDoc(projectRef);
    await deleteDoc(doc(cloudDb, 'projectAccess', project.id));
    loadedRevisions.delete(cloudKey(access.ownerId, project.id));
    forgetCloudProject(project.id);
    return;
  }
  if (project.useSqlite) await window.electronAPI.db.deleteProject(project.id);
  else await window.electronAPI.project.delete(project.id);
}

export async function promoteLocalProject(projectId: string, useSqlite: boolean): Promise<void> {
  const state = useSqlite
    ? await window.electronAPI.db.loadProject(projectId)
    : await window.electronAPI.project.load(projectId);
  await seedOwnedCloudProject(projectId, state, useSqlite);
  await saveCloudProject(projectId, state, useSqlite);
  rememberCloudProject(projectId);
}

async function hasAccessibleCloudProject(projectId: string): Promise<boolean> {
  if (isCloudProjectId(projectId)) return true;
  const user = await waitForCloudAuth();
  if (!user) return false;
  try {
    const access = await getProjectCollaboration(projectId);
    if (!access?.members[user.uid]) return false;
    rememberCloudProject(projectId);
    return true;
  } catch {
    return false;
  }
}

function reportCloudSyncError(error: unknown): void {
  reportCloudSyncFailure(error, 'project');
}

export async function loadAvailableProject<T = unknown>(projectId: string, useSqlite: boolean, signal?: AbortSignal): Promise<T> {
  if (await hasAccessibleCloudProject(projectId)) return loadCloudProject<T>(projectId, signal);
  const local = await (useSqlite
    ? window.electronAPI.db.loadProject(projectId)
    : window.electronAPI.project.load(projectId)) as T;

  // Signing in opts this device into cloud continuity. Existing local
  // projects are promoted on first open so the same ID appears everywhere.
  const user = await waitForCloudAuth();
  if (user) {
    try {
      await seedOwnedCloudProject(projectId, local, useSqlite);
      await saveCloudProject(projectId, local, useSqlite);
      rememberCloudProject(projectId);
    } catch (error) {
      console.warn('[cloud] Existing project could not be promoted automatically:', error);
      reportCloudSyncError(error);
    }
  }
  return local;
}

export async function saveAvailableProject(
  projectId: string,
  state: unknown,
  useSqlite: boolean,
): Promise<unknown> {
  if (await hasAccessibleCloudProject(projectId)) return saveCloudProject(projectId, state, useSqlite);
  const localResult = await (useSqlite
    ? window.electronAPI.db.saveProject(projectId, state)
    : window.electronAPI.project.save(projectId, state as never));
  const user = await waitForCloudAuth();
  if (!user) return localResult;
  await seedOwnedCloudProject(projectId, state, useSqlite);
  await saveCloudProject(projectId, state, useSqlite);
  rememberCloudProject(projectId);
  return localResult;
}
