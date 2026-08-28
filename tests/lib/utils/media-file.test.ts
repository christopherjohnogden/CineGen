import { afterEach, describe, expect, it } from 'vitest';
import { resolveMediaFileUrl } from '@/lib/utils/media-file';

const originalElectronApi = window.electronAPI;

afterEach(() => {
  (window as Window & { electronAPI: typeof window.electronAPI }).electronAPI = originalElectronApi;
});

describe('resolveMediaFileUrl', () => {
  it('turns a Finder file path into an encoded Electron media URL', async () => {
    const file = new File(['frame'], 'Shot #1?.png', { type: 'image/png' });
    (window as Window & { electronAPI: typeof window.electronAPI }).electronAPI = {
      file: {
        getPathForFile: () => '/Users/editor/Shot #1?.png',
      },
    } as typeof window.electronAPI;

    await expect(resolveMediaFileUrl(file))
      .resolves.toBe('local-media://file/Users/editor/Shot%20%231%3F.png');
  });
});
