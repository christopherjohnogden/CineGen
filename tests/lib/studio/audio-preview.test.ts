import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAudioPreview } from '@/lib/studio/audio-preview';

const decode = vi.fn();
const request = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode; });
});
afterEach(() => vi.unstubAllGlobals());

describe('reference waveform extraction', () => {
  it('includes both audio channels, normalizes silence safely, and reuses cached peaks', async () => {
    request.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    decode.mockResolvedValue({ length: 80, numberOfChannels: 2, duration: 8,
      getChannelData: (channel: number) => Float32Array.from({ length: 80 }, (_, i) => channel ? i / 80 : 0) });
    const result = await readAudioPreview('https://example.com/stereo.wav', new AbortController().signal);
    expect(result.peaks).toHaveLength(40);
    expect(result.peaks[39]).toBe(1);
    expect(result.peaks[0]).toBeLessThan(result.peaks[20]);
    expect(await readAudioPreview('https://example.com/stereo.wav', new AbortController().signal)).toBe(result);
    expect(request).toHaveBeenCalledOnce();
    decode.mockResolvedValue({ length: 1, numberOfChannels: 1, duration: 0.01, getChannelData: () => new Float32Array(1) });
    const silent = await readAudioPreview('https://example.com/silent.wav', new AbortController().signal);
    expect(silent.peaks.every(value => value === 0)).toBe(true);
  });

  it('does not decode HTTP errors or oversized downloads, including unadvertised sizes', async () => {
    request.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(new Response('large', { headers: { 'content-length': String(25 * 1024 * 1024) } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(25 * 1024 * 1024)));
    for (const key of ['error', 'large-header', 'large-stream']) {
      await expect(readAudioPreview(key, new AbortController().signal)).rejects.toThrow();
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects aborted work before downloading or caching a late decode', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readAudioPreview('aborted', controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const late = new AbortController();
    request.mockResolvedValue(new Response(new Uint8Array([1])));
    decode.mockImplementation(async () => {
      late.abort();
      return { length: 1, numberOfChannels: 1, duration: 1, getChannelData: () => new Float32Array(1) };
    });
    await expect(readAudioPreview('late-decode', late.signal)).rejects.toThrow();
  });
});
