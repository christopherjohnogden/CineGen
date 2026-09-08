export interface AudioPreview {
  peaks: number[];
  duration: number;
}

const MAX_PREVIEW_BYTES = 24 * 1024 * 1024;
const previews = new Map<string, AudioPreview>();

/** Keep only the small waveform, never decoded audio, between composer layouts. */
export async function readAudioPreview(url: string, signal: AbortSignal): Promise<AudioPreview> {
  signal.throwIfAborted();
  const cached = previews.get(url);
  if (cached) return cached;
  if (typeof OfflineAudioContext === 'undefined') throw new Error('Waveform preview unavailable');

  const response = await fetch(url, { signal });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_PREVIEW_BYTES) {
    await response.body?.cancel();
    throw new Error('Waveform preview unavailable');
  }
  // Bound downloads even when the server omits Content-Length. Playback remains
  // available for long recordings without decoding them just for a thumbnail.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Waveform preview unavailable');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PREVIEW_BYTES) throw new Error('Recording too large for a waveform preview');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Offline decoding needs no audio permission or active speaker connection.
  const context = new OfflineAudioContext(1, 1, 8000);
  const buffer = await context.decodeAudioData(bytes.buffer);
  signal.throwIfAborted();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const peaks = Array.from({ length: 40 }, (_, index) => {
    const start = Math.floor(index * buffer.length / 40);
    const end = Math.floor((index + 1) * buffer.length / 40);
    let energy = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) energy += channel[sample] ** 2;
    }
    return Math.sqrt(energy / Math.max(1, (end - start) * channels.length));
  });
  const maximum = Math.max(...peaks, 0.001);
  const preview = { peaks: peaks.map(peak => peak / maximum), duration: buffer.duration };
  if (previews.size >= 32) previews.delete(previews.keys().next().value!);
  previews.set(url, preview);
  return preview;
}
