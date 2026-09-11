// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

let script: string;
const windows: JSDOM[] = [];
const storage = new Map<string, string>();
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `
    import { cloudAuth, waitForCloudAuth, firebaseApp } from './src/lib/cloud/firebase';
    import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
    import { deleteApp } from 'firebase/app';
    window.fixture = {
      ready: () => waitForCloudAuth(), uid: () => cloudAuth.currentUser?.uid ?? null,
      signIn: () => signInWithEmailAndPassword(cloudAuth, 'fixture@example.test', 'fixture-password'),
      signOut: () => signOut(cloudAuth), dispose: () => deleteApp(firebaseApp)
    };`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
  script = bundle.outputFiles[0].text;
});
afterEach(async () => {
  for (const dom of windows.splice(0)) { await (dom.window as any).fixture.dispose(); dom.window.close(); }
  storage.clear();
});

function openWindow() {
  const dom = new JSDOM('', { url: 'http://localhost:5173', runScripts: 'outside-only' });
  windows.push(dom);
  const win = dom.window;
  // A locked IndexedDB must not block login restoration. The previous
  // getAuth() -> setPersistence() sequence tried this store first and hung.
  Object.defineProperty(win, 'indexedDB', { value: { open: (name: string) => {
    if (name === 'firebaseLocalStorageDb') return {};
    throw new Error('No IndexedDB available for this fixture.');
  } } });
  const publish = (key: string, value: string | null) => {
    const oldValue = storage.get(key) ?? null;
    if (value === null) storage.delete(key); else storage.set(key, value);
    if (oldValue !== value) for (const other of windows) if (other !== dom) {
      other.window.dispatchEvent(new other.window.StorageEvent('storage', { key, oldValue, newValue: value }));
    }
  };
  Object.defineProperty(win, 'localStorage', { value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => publish(key, value),
    removeItem: (key: string) => publish(key, null),
  } });
  // Exercise the real Firebase browser SDK with offline account responses.
  // No real credentials, tokens, storage, or network requests are used.
  Object.assign(win, { Response, Request, Headers, TextEncoder, TextDecoder,
    fetch: vi.fn(async (url: string) => {
      if (url.includes('accounts:signInWithPassword')) return Response.json({
        localId: 'fixture-owner', email: 'fixture@example.test', idToken: 'fixture-token',
        refreshToken: 'fixture-refresh', expiresIn: '3600', registered: true,
      });
      if (url.includes('accounts:lookup')) return Response.json({ users: [{
        localId: 'fixture-owner', email: 'fixture@example.test', emailVerified: true,
        lastLoginAt: String(Date.now()), createdAt: String(Date.now()),
      }] });
      throw new Error(`Unexpected auth fixture request: ${new URL(url).pathname}`);
    }),
  });
  win.eval(script);
  return (win as any).fixture;
}

describe('persistent cloud login across desktop windows', () => {
  it('retains the account when the project manager opens a workspace and on the next app launch', async () => {
    const manager = openWindow();
    expect(await manager.ready()).toBeNull();
    await manager.signIn();
    const workspace = openWindow();
    expect((await workspace.ready())?.uid).toBe('fixture-owner');
    expect(manager.uid()).toBe('fixture-owner');
    for (const dom of windows.splice(0)) { await (dom.window as any).fixture.dispose(); dom.window.close(); }
    const relaunched = openWindow();
    expect((await relaunched.ready())?.uid).toBe('fixture-owner');
  });

  it('shares later sign-in and explicit sign-out with a window that was already open', async () => {
    const manager = openWindow(), workspace = openWindow();
    await Promise.all([manager.ready(), workspace.ready()]);
    await manager.signIn();
    await vi.waitFor(() => expect(workspace.uid()).toBe('fixture-owner'));
    await manager.signOut();
    await vi.waitFor(() => expect(workspace.uid()).toBeNull());
    expect(await openWindow().ready()).toBeNull();
  });
});
