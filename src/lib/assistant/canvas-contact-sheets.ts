import { MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_IMAGE_BYTES, type LlmImageAttachment } from '@/lib/llm/image-attachments';

// Leave room for six closer views requested by the assistant itself.
export const CANVAS_OVERVIEW_PAGES = MAX_ASSISTANT_IMAGES - 6;
export const imageBytes = (image: LlmImageAttachment) => (image.dataUrl.split(',')[1]?.length ?? 0) * 0.75;

/** Every frame has a tile; the number of sources never determines eligibility. */
export function canvasSheetGroups<T>(frames: T[]): T[][] {
  const pageCount = Math.min(CANVAS_OVERVIEW_PAGES, Math.ceil(frames.length / 9));
  if (!pageCount) return [];
  const perPage = Math.ceil(frames.length / pageCount);
  return Array.from({ length: Math.ceil(frames.length / perPage) }, (_, index) => frames.slice(index * perPage, (index + 1) * perPage));
}

export async function renderCanvasSheet(frames: LlmImageAttachment[], page: number): Promise<LlmImageAttachment> {
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const tile = Math.min(512, Math.floor(2048 / cols));
  const caption = Math.max(24, Math.round(tile * 0.065));
  const canvas = document.createElement('canvas');
  canvas.width = cols * tile;
  canvas.height = rows * tile;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas overview could not be created.');
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, frame] of frames.entries()) {
    const img = new Image();
    try {
      // These are already decoded, app-created data URLs, never external URLs.
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Canvas overview image could not be read.'));
        img.src = frame.dataUrl;
      });
      const x = (index % cols) * tile;
      const y = Math.floor(index / cols) * tile;
      const scale = Math.min((tile - 12) / img.naturalWidth, (tile - caption - 12) / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, x + (tile - w) / 2, y + (tile - caption - h) / 2, w, h);
      ctx.fillStyle = '#efede8';
      ctx.font = `${Math.max(12, caption * 0.65)}px sans-serif`;
      ctx.fillText(`${page + 1}.${index + 1}`, x + 8, y + tile - 8);
    } finally { img.removeAttribute('src'); }
  }
  return {
    label: `Canvas overview ${page + 1}. Tiles read left to right, top to bottom:\n${frames.map((frame, i) => `Tile ${page + 1}.${i + 1}: ${frame.label}`).join('\n')}`,
    dataUrl: canvas.toDataURL('image/jpeg', 0.78),
  };
}

export async function packCanvasImages(frames: LlmImageAttachment[], renderSheet = renderCanvasSheet): Promise<{ images: LlmImageAttachment[]; packed: boolean }> {
  if (frames.length <= MAX_ASSISTANT_IMAGES && frames.reduce((n, frame) => n + imageBytes(frame), 0) <= MAX_ASSISTANT_IMAGE_BYTES) {
    return { images: frames, packed: false };
  }
  const images: LlmImageAttachment[] = [];
  for (const [page, group] of canvasSheetGroups(frames).entries()) images.push(await renderSheet(group, page));
  if (images.reduce((n, frame) => n + imageBytes(frame), 0) > MAX_ASSISTANT_IMAGE_BYTES) {
    throw new Error('The canvas overview is too large to send. Please try again.');
  }
  return { images, packed: true };
}
