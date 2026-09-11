import { ipcMain, nativeImage, net } from 'electron';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

/** CORS-independent fallback for an exact image already referenced by a node.
 * Only the resized JPEG crosses IPC; no arbitrary file bytes are exposed. */
export async function canvasImagePreview(source: string): Promise<string> {
  if (typeof source !== 'string') throw new Error('Invalid canvas image source.');
  const url = new URL(source);
  let bytes: Buffer;
  if (url.protocol === 'file:' || (url.protocol === 'local-media:' && url.hostname === 'file')) {
    const file = url.protocol === 'file:' ? fileURLToPath(url) : decodeURIComponent(url.pathname);
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new Error('Canvas image source is too large or unavailable.');
    bytes = await fs.readFile(file);
  } else if (url.protocol === 'https:' || url.protocol === 'http:') {
    const response = await net.fetch(source, { signal: AbortSignal.timeout(12_000), credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error('Canvas image source is unavailable.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_SOURCE_BYTES) throw new Error('Canvas image source is too large.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    bytes = Buffer.concat(chunks);
  } else throw new Error('Unsupported canvas image source.');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('Canvas source is not a readable image.');
  const { width, height } = image.getSize();
  const scale = Math.min(1, 1280 / Math.max(width, height));
  return `data:image/jpeg;base64,${image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }).toJPEG(82).toString('base64')}`;
}

export function registerCanvasImagePreview(): void {
  ipcMain.handle('llm:canvas-image-preview', (_event, source: string) => canvasImagePreview(source));
}
