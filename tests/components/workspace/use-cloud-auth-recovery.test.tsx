import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_AUTH_RESTORE_TIMEOUT, CLOUD_SIGN_IN_REQUIRED } from '@/lib/cloud/auth-errors';
const auth = vi.hoisted(() => ({ listen: vi.fn(), unsubscribe: vi.fn(), changed: (_user: unknown) => {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: auth.listen }));
vi.mock('@/lib/cloud/firebase', () => ({ cloudAuth: {} }));
import { useCloudAuthRecovery } from '@/components/workspace/use-cloud-auth-recovery';

beforeEach(() => {
  vi.clearAllMocks();
  auth.listen.mockImplementation((_auth, changed) => { auth.changed = changed; return auth.unsubscribe; });
});

describe('cloud project sign-in recovery', () => {
  it.each([CLOUD_SIGN_IN_REQUIRED, CLOUD_AUTH_RESTORE_TIMEOUT])('retries once when sign-in arrives after %s', error => {
    const retry = vi.fn();
    const { rerender } = renderHook(({ error }: { error: string | null }) => useCloudAuthRecovery(error, retry), { initialProps: { error } });
    act(() => auth.changed(null));
    expect(retry).not.toHaveBeenCalled();
    act(() => { auth.changed({ uid: 'owner' }); auth.changed({ uid: 'owner' }); });
    expect(retry).toHaveBeenCalledOnce();
    rerender({ error: null });
    expect(auth.unsubscribe).toHaveBeenCalledOnce();
  });

  it('never reloads a loaded or edited project on sign-in changes, or loops on a permission error', () => {
    const retry = vi.fn();
    const { rerender } = renderHook(({ error }: { error: string | null }) => useCloudAuthRecovery(error, retry), { initialProps: { error: null } });
    rerender({ error: 'Your account cannot open this project.' });
    expect(auth.listen).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });
});
