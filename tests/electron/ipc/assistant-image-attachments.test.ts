// @vitest-environment node
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { claudeImageMessage, decodeAssistantImages, stageAssistantImages } from '../../../electron/ipc/assistant-image-attachments';

const image = { label: 'Image 1 [node first]', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo4AAAAASUVORK5CYII=' };

describe('Assistant image transport', () => {
  it('writes real image bytes with private permissions and cleans up the turn', async () => {
    const staged = await stageAssistantImages([image]);
    const file = staged.refs[0].mediaPath;
    expect((await readFile(file)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await staged.cleanup();
    await expect(stat(file)).rejects.toThrow();
  });
  it('creates Claude image content blocks, not paths in a text-only prompt', () => {
    const result = JSON.parse(claudeImageMessage('Compare the frames', [image]));
    expect(result.message.content).toEqual([
      { type: 'text', text: 'Compare the frames' },
      { type: 'text', text: 'Attached image 1: Image 1 [node first]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.dataUrl.split(',')[1] } },
    ]);
  });
  it('rejects URLs, fake images, and over-budget batches before invoking a model', () => {
    expect(() => decodeAssistantImages([{ ...image, dataUrl: 'https://example.com/a.jpg' }])).toThrow();
    expect(() => decodeAssistantImages([{ ...image, dataUrl: 'data:image/png;base64,aGVsbG8=' }])).toThrow();
    expect(() => decodeAssistantImages(Array(19).fill(image))).toThrow('Too many');
  });
});
