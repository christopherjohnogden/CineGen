import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { copyButtonLabel, useCopiedFlash } from '@/hooks/use-copied-flash';

describe('copyButtonLabel', () => {
  it('swaps Copy for Copied while the flash is on', () => {
    expect(copyButtonLabel(false, 'Copy')).toBe('Copy');
    expect(copyButtonLabel(true, 'Copy')).toBe('Copied');
    expect(copyButtonLabel(true, 'Copy prompt')).toBe('Copied');
  });
});

describe('useCopiedFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => vi.useRealTimers());

  it('shows Copied for 2 seconds then clears', async () => {
    const { result } = renderHook(() => useCopiedFlash());
    await act(async () => { await result.current.copyText('hello'); });
    expect(result.current.copied).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(result.current.copied).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.copied).toBe(false);
  });

  it('does not flash when the clipboard write fails', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useCopiedFlash());
    await act(async () => { await result.current.copyText('hello'); });
    expect(result.current.copied).toBe(false);
  });

  it('tracks separate keys so one Copy does not light up another', async () => {
    const { result } = renderHook(() => useCopiedFlash());
    await act(async () => { await result.current.copyText('a', 'clip-1'); });
    expect(result.current.isCopied('clip-1')).toBe(true);
    expect(result.current.isCopied('prefix')).toBe(false);
  });
});
