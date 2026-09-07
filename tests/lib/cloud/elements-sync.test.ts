import { beforeEach, expect, it, vi } from 'vitest';
import type { Element, ElementsLibrary } from '@/types/elements';

const mocks = vi.hoisted(() => ({ get: vi.fn(), transaction: vi.fn(), prepare: vi.fn(), failure: vi.fn(), success: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: () => 'team', getDoc: mocks.get, runTransaction: mocks.transaction }));
vi.mock('@/lib/cloud/firebase', () => ({ cloudDb: {}, waitForCloudAuth: async () => ({ uid: 'owner' }) }));
vi.mock('@/lib/cloud/collaboration', () => ({ resolveProjectCreationTeam: async () => ({ teamId: 'team', ownerId: 'owner' }) }));
vi.mock('@/lib/cloud/media', async (original) => ({ ...await original<object>(), prepareElementsLibraryForCloudMedia: mocks.prepare }));
vi.mock('@/lib/cloud/sync-status', () => ({ reportCloudSyncFailure: mocks.failure, reportCloudSyncSuccess: mocks.success }));
import { loadAvailableElementsLibrary, saveAvailableElementsLibrary } from '@/lib/cloud/elements';

const temporary = 'https://api.topview.ai/s/expired-reference';
const permanent = 'https://firebasestorage.googleapis.com/v0/b/test/o/reference.png?alt=media&token=test';
const actor: Element = { id: 'actor', name: 'Actor', type: 'character', description: '',
  images: [{ id: 'reference', url: permanent, source: 'generated', createdAt: '2026-08-31' }],
  createdAt: '2026-08-31', updatedAt: '2026-08-31' };
const library = (...elements: Element[]): ElementsLibrary => ({ version: 1, folders: [], elements });
let device: ElementsLibrary;
let cloud: ElementsLibrary;
beforeEach(() => {
  vi.clearAllMocks();
  device = library();
  cloud = library(actor);
  const snapshot = () => ({ exists: () => true, data: () => ({ elementsLibraryJson: JSON.stringify(cloud), elementsLibraryRevision: 1 }) });
  mocks.get.mockImplementation(async () => snapshot());
  mocks.prepare.mockImplementation(async value => value);
  mocks.transaction.mockImplementation(async (_db, fn) => fn({ get: async () => snapshot(), update: (_ref: unknown, data: { elementsLibraryJson: string }) => { cloud = JSON.parse(data.elementsLibraryJson); } }));
  window.electronAPI = { elements: {
    loadLibrary: vi.fn(async () => device),
    saveLibrary: vi.fn(async value => { device = value; return value; }),
  } } as unknown as typeof window.electronAPI;
});

it('loads cloud Elements even when an unrelated local reference cannot upload', async () => {
  device = library({ ...actor, id: 'pending', name: 'Pending local reference', images: [{ ...actor.images[0], url: temporary }] });
  mocks.prepare.mockRejectedValue(new Error('Reference unavailable'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const available = await loadAvailableElementsLibrary();
    expect(available.elements.map(e => e.id)).toEqual(['actor', 'pending']);
    expect(available.elements[0].images[0].url).toBe(permanent);
    expect(available.elements[1].images[0].url).toBe(temporary);
    expect(cloud.elements.map(e => e.id)).toEqual(['actor']);
    expect(mocks.failure).toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});

it('clears a previous warning after a healthy load, including when no cloud write is necessary', async () => {
  const loaded = await loadAvailableElementsLibrary();
  expect(loaded.elements[0].images[0].url).toBe(permanent);
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledWith('elements');
});

it('reuses the latest cloud reference before attempting an upload from a stale device', async () => {
  const requested = library({ ...actor, name: 'Renamed on device', updatedAt: '2026-09-07', images: [{ ...actor.images[0], url: temporary }] });
  mocks.prepare.mockImplementation(async value => {
    if (value.elements[0].images[0].url === temporary) throw new Error('Expired URL must not be fetched');
    return value;
  });
  const saved = await saveAvailableElementsLibrary(requested);
  expect(saved.elements[0].name).toBe('Renamed on device');
  expect(saved.elements[0].images[0].url).toBe(permanent);
  expect(cloud.elements[0].images[0].url).toBe(permanent);
  expect(device.elements[0].images[0].url).toBe(permanent);
});
