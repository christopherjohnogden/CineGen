import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/cloud/cloud-account', () => ({
  CloudAccountCard: () => <section aria-label="Cloud account" />,
}));

import { SettingsPage } from '@/components/settings/settings-page';

const statusLtx25 = vi.fn();
const terminateLtx25 = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      pod: {
        setupLtx25: vi.fn(),
        statusLtx25,
        terminateLtx25,
      },
      higgsfield: {
        accountStatus: vi.fn().mockResolvedValue({ connected: false }),
        authLogin: vi.fn(),
        authLogout: vi.fn(),
      },
      artlist: {
        accountStatus: vi.fn().mockResolvedValue({ connected: false, configured: false }),
        authLogin: vi.fn(),
        authLogout: vi.fn(),
      },
    },
  });
}

function saveActiveSession(status: 'downloading' | 'ready' = 'downloading') {
  localStorage.setItem('cinegen_settings', JSON.stringify({
    runpodKey: 'rp_test_key',
    huggingFaceToken: 'hf_testToken123',
    podId: 'pod-active',
    podUrl: 'https://pod-active-8000.proxy.runpod.net',
    runpodLtxPodId: 'pod-active',
    runpodLtxPodUrl: 'https://pod-active-8000.proxy.runpod.net',
    runpodLtxPodAuthToken: 'session-token',
    runpodLtxSecretIds: ['secret-1', 'secret-2'],
    runpodLtxStatus: status,
  }));
}

describe('Settings RunPod status checks', () => {
  beforeEach(() => {
    localStorage.clear();
    statusLtx25.mockReset();
    terminateLtx25.mockReset().mockResolvedValue({ ok: true });
    installElectronApi();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('runs a manual status check with visible progress and shows the provider message', async () => {
    saveActiveSession('ready');
    const pending = deferred<{
      status: string;
      phase: string;
      ready: boolean;
      message: string;
      podUrl: string;
    }>();
    statusLtx25.mockReturnValue(pending.promise);

    render(<SettingsPage onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));

    expect(statusLtx25).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();

    await act(async () => {
      pending.resolve({
        status: 'ready',
        phase: 'ready',
        ready: true,
        message: 'The generation service is ready now.',
        podUrl: 'https://pod-active-8000.proxy.runpod.net',
      });
      await pending.promise;
    });

    expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled();
    expect(screen.getByText(/The generation service is ready now/)).toBeInTheDocument();
    expect(screen.getByText(/Last checked at/)).toBeInTheDocument();
  });

  it('keeps automatic checks single-flight and shows successful check feedback', async () => {
    vi.useFakeTimers();
    saveActiveSession();
    const pending = deferred<{
      status: string;
      phase: string;
      message: string;
      podUrl: string;
    }>();
    statusLtx25.mockReturnValue(pending.promise);

    render(<SettingsPage onBack={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    expect(statusLtx25).toHaveBeenCalledTimes(1);
    expect(statusLtx25).toHaveBeenCalledWith({
      runpodKey: 'rp_test_key',
      podId: 'pod-active',
      podUrl: 'https://pod-active-8000.proxy.runpod.net',
      podAuthToken: 'session-token',
      secretIds: ['secret-1', 'secret-2'],
    });
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(18_000);
    });
    expect(statusLtx25).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({
        status: 'downloading',
        phase: 'downloading',
        message: 'The Pod is running and the CineGen service is still starting.',
        podUrl: 'https://pod-active-8000.proxy.runpod.net',
      });
      await pending.promise;
    });

    expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled();
    expect(screen.getByText(/The Pod is running and the CineGen service is still starting/)).toBeInTheDocument();
    expect(screen.getByText(/Last checked at/)).toBeInTheDocument();
  });

  it('keeps polling after a transient check failure and later transitions to ready', async () => {
    vi.useFakeTimers();
    saveActiveSession();
    statusLtx25
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({
        status: 'ready',
        phase: 'ready',
        ready: true,
        message: 'LTX-2.5 is loaded and ready to generate.',
        podUrl: 'https://pod-active-8000.proxy.runpod.net',
      });

    render(<SettingsPage onBack={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    expect(statusLtx25).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Session needs attention')).not.toBeInTheDocument();
    expect(screen.getByText(/Automatic checks will continue while the session starts/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('cinegen_settings') ?? '{}')).toMatchObject({
      runpodLtxStatus: 'downloading',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(statusLtx25).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Session ready')).toBeInTheDocument();
    expect(screen.getByText(/LTX-2.5 is loaded and ready to generate/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /RunPod · LTX-2.5/i })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem('cinegen_settings') ?? '{}')).toMatchObject({
      runpodLtxStatus: 'ready',
    });
  });

  it('ignores a pending status response after the session is ended', async () => {
    saveActiveSession();
    const pending = deferred<{
      status: string;
      phase: string;
      ready: boolean;
      message: string;
      podUrl: string;
    }>();
    statusLtx25.mockReturnValue(pending.promise);

    render(<SettingsPage onBack={vi.fn()} />);
    await waitFor(() => expect(statusLtx25).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Pod and end session' }));

    await waitFor(() => expect(terminateLtx25).toHaveBeenCalledWith({
      runpodKey: 'rp_test_key',
      podId: 'pod-active',
      secretIds: ['secret-1', 'secret-2'],
    }));
    await waitFor(() => expect(screen.getByText('No active session')).toBeInTheDocument());

    await act(async () => {
      pending.resolve({
        status: 'ready',
        phase: 'ready',
        ready: true,
        message: 'This stale response must be ignored.',
        podUrl: 'https://pod-active-8000.proxy.runpod.net',
      });
      await pending.promise;
    });

    expect(screen.getByText('No active session')).toBeInTheDocument();
    expect(screen.queryByText('This stale response must be ignored.')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('cinegen_settings') ?? '{}')).toMatchObject({
      runpodLtxPodId: '',
      runpodLtxStatus: 'not-configured',
    });
  });
});
