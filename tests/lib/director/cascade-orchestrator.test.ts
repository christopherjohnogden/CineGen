import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDirectorCascade } from '@/components/director/use-director-cascade';
import type { DirectorShow } from '@/types/director';

const base = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SCRIPT = 'INT. OFFICE - DAY\nDr. Jordan enters.';
const SCRIPT2 = 'INT. OFFICE - DAY\nDr. Jordan enters and sits down slowly.';

describe('useDirectorCascade', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces: one run after the idle pause', async () => {
    const runBreakdown = vi.fn().mockResolvedValue(undefined);
    const runShotlist = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const { rerender } = renderHook((p) => useDirectorCascade(p), {
      initialProps: { show: base({ sourceText: '' }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 },
    });
    rerender({ show: base({ sourceText: SCRIPT }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(runBreakdown).toHaveBeenCalledTimes(1);
    expect(runShotlist).toHaveBeenCalledTimes(1);
  });

  it('does nothing when autoSync is off', async () => {
    const runBreakdown = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook((p) => useDirectorCascade(p), {
      initialProps: { show: base({ sourceText: '' }), autoSync: false, runBreakdown, runShotlist: vi.fn(), commitSyncState: vi.fn(), debounceMs: 2500 },
    });
    rerender({ show: base({ sourceText: SCRIPT }), autoSync: false, runBreakdown, runShotlist: vi.fn(), commitSyncState: vi.fn(), debounceMs: 2500 });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(runBreakdown).not.toHaveBeenCalled();
  });

  it('cancel-and-restart: a second edit during the debounce window re-arms; only ONE cascade runs against the latest text', async () => {
    const runBreakdown = vi.fn().mockResolvedValue(undefined);
    const runShotlist = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const { rerender } = renderHook((p) => useDirectorCascade(p), {
      initialProps: { show: base({ sourceText: '' }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 },
    });

    // First edit — arms the timer.
    rerender({ show: base({ sourceText: SCRIPT }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 });
    // Advance PART of the window — not enough to fire.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(runBreakdown).not.toHaveBeenCalled();

    // Second edit before the window elapses — must cancel and re-arm from now.
    rerender({ show: base({ sourceText: SCRIPT2 }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 });
    // The remainder of the FIRST window elapses — still must not fire (timer was reset).
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(runBreakdown).not.toHaveBeenCalled();

    // A full debounce from the LAST edit elapses — exactly one cascade runs.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(runBreakdown).toHaveBeenCalledTimes(1);
    expect(runShotlist).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('unmounting mid-run aborts the in-flight controller', async () => {
    let capturedSignal: AbortSignal | undefined;
    const runBreakdown = vi.fn((_scope: unknown, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<void>(() => {}); // never resolves — simulates an in-flight job
    });
    const runShotlist = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const { rerender, unmount } = renderHook((p) => useDirectorCascade(p), {
      initialProps: { show: base({ sourceText: '' }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 },
    });

    rerender({ show: base({ sourceText: SCRIPT }), autoSync: true, runBreakdown, runShotlist, commitSyncState: commit, debounceMs: 2500 });
    // Let the debounce elapse so fire() starts and runBreakdown is invoked (in-flight).
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(runBreakdown).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    expect(runShotlist).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
