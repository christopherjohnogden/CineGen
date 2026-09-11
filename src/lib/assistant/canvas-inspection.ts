import { MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_IMAGE_BYTES, type LlmImageAttachment } from '@/lib/llm/image-attachments';
import { imageBytes } from './canvas-contact-sheets';
import type { CanvasVisualContext } from './canvas-visual-context';

const INSPECT = 'For a closer look at any overview tile, respond ONLY with ```cinegen-canvas-inspect followed by JSON {"nodeIds":["exact node ID"]} and a closing fence. CineGen will supply larger images automatically. Request at most two nodes at a time. This is internal; never ask the user to attach or select them.';

export function canvasInspectionIds(reply: string): string[] | null {
  const match = reply.trim().match(/^```cinegen-canvas-inspect\s*([\s\S]*?)\s*```$/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed.nodeIds)) return [];
    return [...new Set<string>(parsed.nodeIds.filter((id: unknown) => typeof id === 'string'))].slice(0, 2);
  } catch { return []; }
}

/** A bounded internal zoom loop. It can only read pixels already on this canvas. */
export async function answerWithCanvasVision(
  visual: CanvasVisualContext,
  invoke: (context: string, images: LlmImageAttachment[]) => Promise<string>,
  isCurrent: () => boolean = () => true,
): Promise<string> {
  let images = visual.images;
  let inspection = '';
  for (let turn = 0; turn < 3; turn++) {
    if (!isCurrent()) return '';
    const allowInspect = visual.packed && turn < 2;
    const context = [visual.context,
      `CURRENT MESSAGE IMAGE ORDER:\n${images.map((image, i) => `Attached image ${i + 1}: ${image.label}`).join('\n')}`,
      inspection, allowInspect ? INSPECT : 'Answer the user now from the supplied images. Do not output an inspection request.'].join('\n\n');
    const reply = await invoke(context, images);
    const ids = canvasInspectionIds(reply);
    if (ids === null) return reply;
    if (!allowInspect) throw new Error('The assistant could not finish inspecting the canvas. Please try again.');
    images = [...visual.overview];
    const supplied: string[] = [];
    for (const id of ids) {
      for (const frame of visual.details.get(id) ?? []) {
        if (images.length >= MAX_ASSISTANT_IMAGES || images.reduce((n, image) => n + imageBytes(image), 0) + imageBytes(frame) > MAX_ASSISTANT_IMAGE_BYTES) break;
        images.push(frame);
        supplied.push(`Attached image ${images.length}: ${frame.label}`);
      }
    }
    inspection = [
      'AUTOMATIC CLOSER VIEW — requested from the canvas without user attachment:',
      ...supplied,
      supplied.length ? 'These larger views accompany the complete canvas overview. Answer the original user message.' : 'No readable images matched those node IDs. Use the current overview and its exact node IDs; do not invent contents.',
    ].join('\n');
  }
  throw new Error('The assistant could not finish inspecting the canvas. Please try again.');
}
