import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DirectorGenerateViewer } from '@/components/director/director-generate-viewer';
import type { Asset } from '@/types/project';

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
});
