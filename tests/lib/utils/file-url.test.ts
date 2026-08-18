import { describe, expect, it } from 'vitest';
import { toFileUrl } from '@/lib/utils/file-url';

describe('toFileUrl', () => {
  it('preserves browser-owned media references', () => {
    expect(toFileUrl('/media/projects/project-1/generated/result.mp4'))
      .toBe('/media/projects/project-1/generated/result.mp4');
  });

  it('keeps Electron local path conversion intact', () => {
    expect(toFileUrl('/Users/editor/My Clip #1.mov'))
      .toBe('local-media://file/Users/editor/My%20Clip%20%231.mov');
  });

  it('passes through existing URLs', () => {
    expect(toFileUrl('https://cdn.example.com/clip.mp4'))
      .toBe('https://cdn.example.com/clip.mp4');
  });
});
