// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn(), stat: vi.fn(), read: vi.fn(), resize: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, net: { fetch: mocks.fetch }, nativeImage: { createFromBuffer: mocks.decode } }));
vi.mock('node:fs/promises', () => ({ default: { stat: mocks.stat, readFile: mocks.read } }));
import { canvasImagePreview } from '../../../electron/ipc/canvas-image-preview';

describe('Desktop canvas image fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stat.mockResolvedValue({ size: 12, isFile: () => true });
    mocks.read.mockResolvedValue(Buffer.from('image'));
    mocks.resize.mockReturnValue({ toJPEG: () => Buffer.from('jpeg') });
    mocks.decode.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 2560, height: 1440 }), resize: mocks.resize });
  });
  it('decodes the exact local file and returns resized image pixels', async () => {
    expect(await canvasImagePreview('local-media://file/tmp/Room%20photo.png')).toBe('data:image/jpeg;base64,anBlZw==');
    expect(mocks.read).toHaveBeenCalledWith('/tmp/Room photo.png');
    expect(mocks.resize).toHaveBeenCalledWith({ width: 1280, height: 720 });
  });
  it('reads a CORS-blocked remote image without exposing raw content or cookies', async () => {
    mocks.fetch.mockResolvedValue(new Response('image bytes'));
    expect(await canvasImagePreview('https://media.example/photo.png')).toMatch(/^data:image\/jpeg;base64,/);
    expect(mocks.fetch).toHaveBeenCalledWith('https://media.example/photo.png', expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) }));
  });
  it('rejects missing, oversized and non-image sources', async () => {
    await expect(canvasImagePreview('data:text/plain,private')).rejects.toThrow('Unsupported');
    mocks.stat.mockResolvedValueOnce({ size: 33 * 1024 * 1024, isFile: () => true });
    await expect(canvasImagePreview('file:///tmp/huge.png')).rejects.toThrow('too large');
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.decode.mockReturnValueOnce({ isEmpty: () => true });
    await expect(canvasImagePreview('file:///tmp/text.txt')).rejects.toThrow('not a readable image');
    mocks.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    await expect(canvasImagePreview('https://media.example/missing')).rejects.toThrow('unavailable');
  });
});
