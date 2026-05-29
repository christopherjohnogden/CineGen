import { describe, expect, it } from 'vitest';
import { selectQuickEditMedias } from '../../../electron/ipc/higgsfield';

describe('selectQuickEditMedias', () => {
  it('uses the drawn frame path as the image reference when provided (frame mode)', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'frame', outputType: 'image',
      drawnFramePath: '/tmp/drawn.png', extractedPaths: ['/tmp/clean.jpg'], extractedRoles: ['image'],
    });
    expect(medias).toEqual([{ value: '/tmp/drawn.png', role: 'image' }]);
  });

  it('uses the drawn frame as start_image for a frame-mode video generation', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'frame', outputType: 'video',
      drawnFramePath: '/tmp/drawn.png', extractedPaths: ['/tmp/clean.jpg'], extractedRoles: ['image'],
    });
    expect(medias).toEqual([{ value: '/tmp/drawn.png', role: 'start_image' }]);
  });

  it('falls back to extracted paths when there is no drawn frame', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'first-last', outputType: 'video',
      extractedPaths: ['/tmp/a.jpg', '/tmp/b.jpg'], extractedRoles: ['start_image', 'end_image'],
    });
    expect(medias).toEqual([
      { value: '/tmp/a.jpg', role: 'start_image' },
      { value: '/tmp/b.jpg', role: 'end_image' },
    ]);
  });

  it('ignores the drawn frame for non-frame modes (first-last/segment keep extracted refs)', () => {
    const medias = selectQuickEditMedias({
      referenceMode: 'first-last', outputType: 'video',
      drawnFramePath: '/tmp/drawn.png', extractedPaths: ['/tmp/a.jpg', '/tmp/b.jpg'], extractedRoles: ['start_image', 'end_image'],
    });
    expect(medias).toEqual([
      { value: '/tmp/a.jpg', role: 'start_image' },
      { value: '/tmp/b.jpg', role: 'end_image' },
    ]);
  });
});
