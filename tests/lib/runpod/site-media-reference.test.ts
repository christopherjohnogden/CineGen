import { describe, expect, it, vi } from 'vitest';
import {
  hostedMediaPath,
  persistCompletedSessionImage,
} from '../../../site/lib/server/runpod-ltx25';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('hosted RunPod media reference routing', () => {
  const origin = 'https://app.cinegen.example';

  it('resolves relative and same-origin media URLs to workspace R2 keys', () => {
    expect(hostedMediaPath('/media/elements/source%20frame.png', origin)).toBe('elements/source frame.png');
    expect(hostedMediaPath(`${origin}/media/generated/frame.webp`, origin)).toBe('generated/frame.webp');
  });

  it('leaves external HTTPS URLs containing /media/ on the public-fetch path', () => {
    expect(hostedMediaPath('https://cdn.example/media/reference.jpg', origin)).toBeUndefined();
  });

  it('stores a completed image in R2 without returning inline data or Pod credentials', async () => {
    const put = vi.fn(async () => undefined);
    const result = await persistCompletedSessionImage({
      jobId: 'image-job-1',
      status: 'completed',
      phase: 'ready',
      output: {
        data: PNG_BASE64,
        mediaType: 'image/png',
        model: 'SDXL',
      },
    }, { MEDIA: { put } } as never, 'workspace-1');

    expect(put).toHaveBeenCalledWith(
      'workspaces/workspace-1/generated/runpod-session-images/image-job-1.png',
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { provider: 'runpod', model: 'SDXL', jobId: 'image-job-1' },
      }),
    );
    expect(result.output).toMatchObject({
      url: '/media/generated/runpod-session-images/image-job-1.png',
      mediaType: 'image/png',
      model: 'SDXL',
    });
    expect(result.output).not.toHaveProperty('data');
    expect(JSON.stringify(result)).not.toContain('podAuthToken');
  });
});
