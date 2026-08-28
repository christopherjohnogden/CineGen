import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectorGenerateViewer } from '@/components/director/director-generate-viewer';
import type { Asset } from '@/types/project';
import type { DirectorTake } from '@/types/director';

function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'take-asset',
    name: 'Generated take',
    type: 'video',
    url: 'https://provider.example/take.mp4',
    createdAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

function renderViewer(asset: Asset) {
  return render(
    <DirectorGenerateViewer
      asset={asset}
      variantLabel="Native"
      adapterLabel="Higgsfield"
      clipLabel="C01"
    />,
  );
}

function liveTake(overrides: Partial<DirectorTake> = {}): DirectorTake {
  return {
    id: 'take-live',
    number: 6,
    variantKey: 'full',
    status: 'running',
    adapterId: 'runpod-ltx-2.5',
    modelId: 'runpod-ltx-2.5',
    promptSnapshot: 'A cinematic shot.',
    createdAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DirectorGenerateViewer', () => {
  it('plays the persisted project copy before the temporary provider URL', () => {
    renderViewer(videoAsset({ fileRef: '/project/media/generated/take.mp4' }));

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'local-media://file/project/media/generated/take.mp4',
    );
  });

  it('falls back to the provider URL when the persisted copy is unavailable', () => {
    renderViewer(videoAsset({ fileRef: '/project/media/generated/missing.mp4' }));

    fireEvent.error(document.querySelector('video') as HTMLVideoElement);

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'https://provider.example/take.mp4',
    );
  });

  it('offers a retry after every available source fails', () => {
    renderViewer(videoAsset());

    fireEvent.error(document.querySelector('video') as HTMLVideoElement);

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a live elapsed timer based on the persisted take timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T00:02:05.000Z'));
    render(
      <DirectorGenerateViewer
        take={liveTake()}
        variantLabel="Full"
        adapterLabel="RunPod · LTX-2.5"
        providerLabel="RunPod Pod"
        clipLabel="1B · Jordan Retrieves the Black Book"
      />,
    );

    expect(screen.getByText('Elapsed · 02:05')).toBeInTheDocument();
    expect(screen.getByLabelText('Elapsed render time 2 minutes 5 seconds')).toHaveAttribute('datetime', 'PT125S');

    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByText('Elapsed · 02:06')).toBeInTheDocument();
  });

  it('uses provider-aware recovery copy and stops updating after completion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T00:00:10.000Z'));
    const onFetchTake = vi.fn();
    const view = render(
      <DirectorGenerateViewer
        take={liveTake()}
        variantLabel="Full"
        adapterLabel="RunPod · LTX-2.5"
        providerLabel="RunPod Pod"
        clipLabel="1B"
        onFetchTake={onFetchTake}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load from RunPod Pod' }));
    expect(onFetchTake).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Higgsfield/i)).not.toBeInTheDocument();

    view.rerender(
      <DirectorGenerateViewer
        take={liveTake({ status: 'done' })}
        variantLabel="Full"
        adapterLabel="RunPod · LTX-2.5"
        providerLabel="RunPod Pod"
        clipLabel="1B"
      />,
    );
    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.queryByText(/Elapsed/)).not.toBeInTheDocument();
  });

  it('immediately follows a newly selected running take timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T00:10:00.000Z'));
    const view = render(
      <DirectorGenerateViewer
        take={liveTake({ id: 'older-take', createdAt: '2026-08-21T00:00:00.000Z' })}
        variantLabel="Full"
        adapterLabel="RunPod · LTX-2.5"
        clipLabel="1B"
      />,
    );
    expect(screen.getByText('Elapsed · 10:00')).toBeInTheDocument();

    view.rerender(
      <DirectorGenerateViewer
        take={liveTake({ id: 'newer-take', createdAt: '2026-08-21T00:09:55.000Z' })}
        variantLabel="Full"
        adapterLabel="RunPod · LTX-2.5"
        clipLabel="1B"
      />,
    );

    expect(screen.getByText('Elapsed · 00:05')).toBeInTheDocument();
  });
});
