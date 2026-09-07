import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ listener: null as any, read: vi.fn(), stop: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (...v: unknown[]) => v, doc: (...v: unknown[]) => v,
  documentId: vi.fn(), orderBy: vi.fn(), query: (v: unknown) => v,
  getDoc: async () => ({ exists: () => true, data: () => ({ currentRevision: 'initial' }) }),
  getDocs: (...v: unknown[]) => mock.read(...v),
  onSnapshot: (_: unknown, cb: unknown) => { mock.listener = cb; return mock.stop; },
  deleteDoc: vi.fn(), runTransaction: vi.fn(), setDoc: vi.fn(), writeBatch: vi.fn(),
}));
vi.mock('@/lib/cloud/firebase', () => ({ cloudDb: {}, waitForCloudAuth: async () => ({ uid: 'owner' }) }));
vi.mock('@/lib/cloud/media', () => ({ prepareStateForCloudMedia: vi.fn() }));
vi.mock('@/lib/cloud/media-references', () => ({ restoreCloudMediaReferences: (v: unknown) => v }));
vi.mock('@/lib/cloud/collaboration', () => ({ ensureProjectAccess: async () => ({ ownerId: 'owner' }) }));
vi.mock('@/lib/cloud/project-reader', () => ({ readCloudProject: async () => ({ ownerId: 'owner', revision: 'initial', state: { assets: [] } }) }));
import { loadCloudProject, watchCloudProject } from '@/lib/cloud/projects';
const response = (value: unknown) => ({ docs: [{ data: () => ({ data: JSON.stringify(value) }) }] });
const emit = (revision: string) => mock.listener({ metadata: { hasPendingWrites: false }, data: () => ({ currentRevision: revision }) });
beforeEach(() => { vi.useFakeTimers(); mock.read.mockReset().mockResolvedValue(response({ assets: [] })); mock.stop.mockClear(); });
afterEach(() => vi.useRealTimers());
test('live completion applies once and defers while the user has unsaved work', async () => {
  await loadCloudProject('cloud_live');
  let dirty = true;
  const apply = vi.fn((_snapshot: Record<string, any>) => true);
  const stop = await watchCloudProject('cloud_live', () => !dirty, apply);
  emit('initial'); emit('completed');
  await vi.advanceTimersByTimeAsync(2000);
  expect(apply).not.toHaveBeenCalled();
  dirty = false;
  mock.read.mockResolvedValue(response({ assets: [{ id: 'result', url: 'https://media/image.png' }] }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0].assets[0].id).toBe('result');
  emit('completed'); await vi.advanceTimersByTimeAsync(4000);
  expect(apply).toHaveBeenCalledTimes(1);
  stop(); expect(mock.stop).toHaveBeenCalled();
});
test('an edit or unmount during download prevents applying a stale snapshot', async () => {
  await loadCloudProject('cloud_race');
  let dirty = false;
  const apply = vi.fn((_snapshot: Record<string, any>) => true);
  const stop = await watchCloudProject('cloud_race', () => !dirty, apply);
  let resolve!: (v: unknown) => void;
  mock.read.mockImplementation(() => new Promise(r => { resolve = r; }));
  emit('next'); dirty = true; resolve(response({ assets: ['remote'] }));
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
  dirty = false; await vi.advanceTimersByTimeAsync(2000);
  stop(); resolve(response({ assets: ['remote'] }));
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
});
