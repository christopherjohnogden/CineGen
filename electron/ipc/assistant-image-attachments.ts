import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_IMAGE_BYTES, type LlmImageAttachment } from '@/lib/llm/image-attachments';

export function decodeAssistantImages(images: LlmImageAttachment[] = []) {
  if (images.length > MAX_ASSISTANT_IMAGES) throw new Error('Too many canvas previews in one request. Please try again.');
  let total = 0;
  return images.map(image => {
    if (typeof image.dataUrl !== 'string' || image.dataUrl.length > MAX_ASSISTANT_IMAGE_BYTES * 4 / 3 + 100) throw new Error('Canvas preview is too large.');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if (!match) throw new Error('Canvas preview must be a JPEG, PNG, or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    total += bytes.length;
    if (total > MAX_ASSISTANT_IMAGE_BYTES) throw new Error('Canvas previews are too large to send. Please try again.');
    const mime = match[1] as 'image/jpeg' | 'image/png' | 'image/webp';
    const valid = mime === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('Canvas preview contains invalid image data.');
    return { label: String(image.label).slice(0, 1000), mime, base64: match[2], bytes };
  });
}

/** CLI image flags require local files. Keep private snapshots only for the turn. */
export async function stageAssistantImages(images: LlmImageAttachment[] = []) {
  const decoded = decodeAssistantImages(images);
  if (!decoded.length) return { refs: [], cleanup: async () => {} };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cinegen-assistant-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const refs = [];
    for (const [i, image] of decoded.entries()) {
      const mediaPath = path.join(directory, `${i + 1}.${image.mime.split('/')[1]}`);
      await writeFile(mediaPath, image.bytes, { mode: 0o600 });
      refs.push({ label: image.label, kind: 'asset' as const, mediaType: 'image' as const, mediaPath, ephemeral: false });
    }
    return { refs, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export function claudeImageMessage(prompt: string, images: LlmImageAttachment[]) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'text', text: prompt },
    ...decodeAssistantImages(images).flatMap((image, index) => [
      { type: 'text', text: `Attached image ${index + 1}: ${image.label}` },
      { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
    ]),
  ] } }) + '\n';
}
