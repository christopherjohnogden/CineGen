import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioAudioReference } from '@/components/create/studio-audio-reference';
import { readAudioPreview } from '@/lib/studio/audio-preview';

vi.mock('@/lib/studio/audio-preview', () => ({ readAudioPreview: vi.fn() }));
const preview = vi.mocked(readAudioPreview);
const remove = vi.fn();
const props = { url: 'https://example.com/voice.wav', name: 'Cody dialogue.wav', removeTestId: 'remove-ref', onRemove: remove };
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

function metadata(player: HTMLAudioElement, duration = 13) {
  Object.defineProperty(player, 'duration', { configurable: true, value: duration });
  fireEvent.loadedMetadata(player);
}

beforeEach(() => {
  vi.clearAllMocks();
  preview.mockResolvedValue({ peaks: Array.from({ length: 40 }, (_, i) => i / 40), duration: 13 });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
  });
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('audio reference playback', () => {
  it('shows a waveform, auditions and seeks without submitting the composer', async () => {
    const submit = vi.fn();
    const { container } = render(<form onSubmit={submit}><StudioAudioReference {...props} /></form>);
    const player = container.querySelector('audio')!;
    metadata(player);
    await waitFor(() => expect(container.querySelector('[data-waveform="ready"]')).toBeInTheDocument());
    expect(screen.getByText('0:13')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play Cody dialogue.wav' }));
    await screen.findByRole('button', { name: 'Pause Cody dialogue.wav' });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '6.5' } });
    expect(player.currentTime).toBe(6.5);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '0:06 of 0:13');
    fireEvent.click(screen.getByRole('button', { name: 'Pause Cody dialogue.wav' }));
    fireEvent.click(screen.getByTestId('remove-ref'));
    expect(remove).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });

  it('pauses the previous reference and stops playback on removal', async () => {
    const { container, unmount } = render(<><StudioAudioReference {...props} /><StudioAudioReference {...props} name="Music.wav" /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Play Cody dialogue.wav' }));
    await screen.findByRole('button', { name: 'Pause Cody dialogue.wav' });
    fireEvent.click(screen.getByRole('button', { name: 'Play Music.wav' }));
    await screen.findByRole('button', { name: 'Pause Music.wav' });
    expect(screen.getByRole('button', { name: 'Play Cody dialogue.wav' })).toBeInTheDocument();
    const active = container.querySelectorAll('audio')[1];
    expect(active.paused).toBe(false);
    unmount();
    expect(active.paused).toBe(true);
  });

  it('keeps playback usable when waveform decoding fails or the recording is long', async () => {
    preview.mockRejectedValue(new Error('CORS'));
    const { container } = render(<StudioAudioReference {...props} />);
    metadata(container.querySelector('audio')!);
    await waitFor(() => expect(preview).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Play Cody dialogue.wav' }));
    await screen.findByRole('button', { name: 'Pause Cody dialogue.wav' });
    expect(screen.queryByText('Preview unavailable')).not.toBeInTheDocument();
    metadata(container.querySelector('audio')!, 600);
    expect(preview).toHaveBeenCalledOnce();
    expect(screen.getByRole('slider')).toHaveAttribute('max', '600');
  });

  it('waits until visible, and cancels waveform work when removed', async () => {
    let enter!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { enter = callback; }
      observe() {}
      disconnect = disconnect;
    });
    preview.mockImplementation(() => new Promise(() => {}));
    const { container, unmount } = render(<StudioAudioReference {...props} />);
    expect(container.querySelector('audio')).not.toHaveAttribute('src');
    expect(preview).not.toHaveBeenCalled();
    act(() => enter([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    metadata(container.querySelector('audio')!);
    expect(preview).toHaveBeenCalledOnce();
    const signal = preview.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it('offers retry after playback failure and guards playback resolving after removal', async () => {
    play.mockRejectedValueOnce(new Error('NotAllowedError'));
    const { unmount } = render(<StudioAudioReference {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Cody dialogue.wav' }));
    await screen.findByText('Preview unavailable');
    let finish!: () => void;
    play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Play Cody dialogue.wav' }));
    unmount();
    await act(async () => finish());
    expect(pause).toHaveBeenCalled();
  });
});
