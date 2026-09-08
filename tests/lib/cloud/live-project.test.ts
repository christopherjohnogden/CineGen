import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ listener: null as any, listenerError: null as any, read: vi.fn(), stop: vi.fn(), access: vi.fn(), power: null as any, stopPower: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (...v: unknown[]) => v, doc: (...v: unknown[]) => v,
  orderBy: vi.fn(), query: (v: unknown) => v,
  getDoc: vi.fn(), getDocs: vi.fn(),
  onSnapshot: (_: unknown, cb: unknown, error: unknown) => { mock.listener = cb; mock.listenerError = error; return mock.stop; },
  deleteDoc: vi.fn(), runTransaction: vi.fn(), setDoc: vi.fn(), writeBatch: vi.fn(),
}));
vi.mock('@/lib/cloud/firebase', () => ({ cloudDb: {}, waitForCloudAuth: async () => ({ uid: 'owner' }) }));
vi.mock('@/lib/cloud/media', () => ({ prepareStateForCloudMedia: vi.fn() }));
vi.mock('@/lib/cloud/media-references', () => ({ restoreCloudMediaReferences: (v: unknown) => v }));
vi.mock('@/lib/cloud/collaboration', () => ({ ensureProjectAccess: mock.access }));
vi.mock('@/lib/cloud/project-reader', () => ({ readCloudProject: (...args: unknown[]) => mock.read(...args) }));
import { loadCloudProject, watchCloudProject } from '@/lib/cloud/projects';
let revision: string;
const initial = { project: { id: 'cloud_live' }, assets: [] };
const fresh = { project: { id: 'cloud_live' }, assets: [{ id: 'result', url: 'https://media/video.mp4' }] };
const emit = (value: string) => mock.listener({ metadata: { hasPendingWrites: false }, data: () => ({ currentRevision: value }) });
const apply = vi.fn(() => true);
let stop = () => {};
beforeEach(async () => {
  vi.useFakeTimers(); revision = 'initial'; apply.mockClear(); mock.stop.mockClear(); mock.access.mockClear(); mock.stopPower.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal('electronAPI', undefined);
  (window as any).electronAPI = { app: { onPowerEvent: (cb: unknown) => { mock.power = cb; return mock.stopPower; } } };
  mock.read.mockReset().mockImplementation(async (_user, _project, _signal, known) => ({ ownerId: 'owner', revision, state: known?.revision === revision ? undefined : revision === 'initial' ? initial : fresh }));
  await loadCloudProject('cloud_live'); mock.read.mockClear();
});
afterEach(() => { stop(); stop = () => {}; vi.unstubAllGlobals(); vi.useRealTimers(); });

test('polls the server and discovers a completion even when no listener event arrives', async () => {
  stop = await watchCloudProject('cloud_live', () => true, apply);
  await vi.advanceTimersByTimeAsync(0);
  expect(mock.read).toHaveBeenLastCalledWith(expect.anything(), 'cloud_live', expect.any(AbortSignal), { ownerId: 'owner', revision: 'initial' });
  revision = 'complete'; await vi.advanceTimersByTimeAsync(2000);
  expect(apply).toHaveBeenCalledWith(fresh, initial);
  await vi.advanceTimersByTimeAsync(6000);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(mock.access).not.toHaveBeenCalled();
});

test('push triggers an immediate check and retries after a running local job settles', async () => {
  let running = true;
  stop = await watchCloudProject('cloud_live', () => !running, apply);
  revision = 'complete'; emit(revision);
  await vi.advanceTimersByTimeAsync(0); expect(apply).not.toHaveBeenCalled();
  running = false; await vi.advanceTimersByTimeAsync(2000);
  expect(apply).toHaveBeenCalledTimes(1);
  revision = 'newer'; emit(revision); await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledTimes(2);
});

test('a rejected merge does not acknowledge the remote revision', async () => {
  stop = await watchCloudProject('cloud_live', () => true, apply);
  await vi.advanceTimersByTimeAsync(0); revision = 'complete'; apply.mockReturnValueOnce(false);
  await vi.advanceTimersByTimeAsync(2000); expect(apply).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000); expect(apply).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenLastCalledWith(fresh, initial);
});

test('a failed listener cannot prevent independent polling or reconnecting', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  stop = await watchCloudProject('cloud_live', () => true, apply);
  await vi.advanceTimersByTimeAsync(0);
  mock.listenerError(new Error('stream closed')); revision = 'complete';
  await vi.advanceTimersByTimeAsync(2000);
  expect(apply).toHaveBeenCalledWith(fresh, initial); expect(mock.stop).toHaveBeenCalled(); warn.mockRestore();
});

test.each(['focus', 'online', 'visibilitychange', 'resume'])('%s checks immediately instead of waiting for the background interval', async event => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  stop = await watchCloudProject('cloud_live', () => true, apply);
  await vi.advanceTimersByTimeAsync(0); revision = 'complete';
  await vi.advanceTimersByTimeAsync(4000); expect(apply).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  if (event === 'resume') mock.power({ type: event });
  else if (event === 'visibilitychange') document.dispatchEvent(new Event(event));
  else window.dispatchEvent(new Event(event));
  await vi.advanceTimersByTimeAsync(0); expect(apply).toHaveBeenCalledTimes(1);
});

test('does not overlap reads; ignores an older download when a newer push arrives', async () => {
  stop = await watchCloudProject('cloud_live', () => true, apply); await vi.advanceTimersByTimeAsync(0);
  let finish!: (value: unknown) => void;
  mock.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  revision = 'first'; emit(revision); revision = 'second'; emit(revision);
  await vi.advanceTimersByTimeAsync(6000); expect(mock.read).toHaveBeenCalledTimes(2);
  finish({ ownerId: 'owner', revision: 'first', state: { assets: ['outdated'] } });
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledWith(fresh, initial);
});

test('unmount aborts reads and removes all refresh triggers', async () => {
  stop = await watchCloudProject('cloud_live', () => true, apply); await vi.advanceTimersByTimeAsync(0);
  let finish!: (value: unknown) => void;
  mock.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  revision = 'complete'; emit(revision);
  const signal = mock.read.mock.calls.at(-1)![2];
  stop(); stop = () => {}; expect(signal.aborted).toBe(true);
  finish({ ownerId: 'owner', revision, state: fresh });
  window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(15000);
  expect(apply).not.toHaveBeenCalled(); expect(mock.read).toHaveBeenCalledTimes(2); expect(mock.stopPower).toHaveBeenCalled();
});
