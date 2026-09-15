import type { SetCamera, SetStandIn } from '@/types/sets';
import type { SetViewerHandle } from '@/components/sets/set-viewer';
import type { PassKind } from './scene';
import { buildCameraPrompt, REFERENCE_TAGS, MANNEQUIN_EXCLUSION } from './camera-prompt';
import { aspectRatio, renderSize, type SensorSize } from './optics';

export interface ShapeShotResult {
  mode?: 'view' | 'passes';
  files: File[];
  promptBlock: string;
  camera: SetCamera;
  setId: string;
}
export interface ShapeShotTarget {
  modelId?: string;
  models?: Array<{ key: string; label: string }>;
  selectModel?(key: string): void;
  outputControls?: Array<{ id: string; label: string; value: string; options: Array<{ value: string; label: string }> }>;
  setOutputControl?(id: string, value: string): void;
  aspect: string;
  width: number;
  height: number;
  maxReferences: number;
  viewMaxReferences?: number;
  label: string;
  unavailable?: string;
  attach(result: ShapeShotResult): Promise<void>;
  sendToCanvas?(result: ShapeShotResult): Promise<string>;
}
export function passesWithinBudget(budget: number): PassKind[] {
  if (budget >= 4) return ['plate', 'composite', 'depth', 'standin'];
  if (budget === 3) return ['plate', 'composite', 'standin'];
  return ['plate', 'composite'];
}
/** Resolution labels ending in p specify the short edge; K specifies the long edge. */
export function shapeShotSize(aspect: string, resolution: unknown): { width: number; height: number } {
  const value = String(resolution ?? '').trim().toLowerCase();
  const explicit = /^(\d+)\s*[x×]\s*(\d+)$/.exec(value);
  if (explicit) return { width: Number(explicit[1]), height: Number(explicit[2]) };
  const ratio = aspectRatio(aspect);
  const p = /^(\d+)p$/.exec(value);
  if (p) return renderSize(ratio, Number(p[1]) * Math.max(ratio, 1 / ratio));
  const k = /^(\d+(?:\.\d+)?)k$/.exec(value);
  return renderSize(ratio, k ? Number(k[1]) * 1024 : /^\d+$/.test(value) ? Number(value) : 1280);
}
export function referencePrompt(kinds: PassKind[], cameraBlock: string): string {
  const tags = kinds.map((kind, index) => REFERENCE_TAGS[kind].replace(/@image\d+/g, `@image${index + 1}`));
  const standinSlot = kinds.indexOf('standin');
  const exclusion = `The gray mannequin in @image2${standinSlot >= 0 ? ` and @image${standinSlot + 1}` : ''} is a placement guide only and must not appear in the shot.`;
  return [...tags, cameraBlock.replace(MANNEQUIN_EXCLUSION, exclusion)].join(' ').replace(/\s+/g, ' ').trim();
}
export async function captureShapeShot(handle: SetViewerHandle, options: {
  setId: string; width: number; height: number; maxReferences: number;
  focalMm: number; sensor: SensorSize; subject?: SetStandIn;
}): Promise<ShapeShotResult> {
  if (options.maxReferences < 2) throw new Error('This model needs at least two free reference slots for a Set shot. Choose another model or remove a reference in Studio.');
  const kinds = passesWithinBudget(options.maxReferences);
  const blobs = await handle.capture(kinds, options.width, options.height);
  const camera = handle.readCamera(`Set shot ${new Date().toLocaleString()}`);
  const prompt = buildCameraPrompt({ focalMm: options.focalMm, sensor: options.sensor,
    cameraHeightM: handle.cameraHeight(), subjectDistanceM: handle.subjectDistance(),
    subjectFrameX: handle.subjectFrameX(), subject: options.subject });
  return { setId: options.setId, camera,
    files: kinds.map(kind => new File([blobs[kind]], `shape-shot-${kind}.png`, { type: 'image/png' })),
    promptBlock: referencePrompt(kinds, prompt.block) };
}

export interface SetSendOptions {
  mode: 'view' | 'passes';
  includeStandIns: boolean;
  enhance: boolean;
  instructions: string;
}

export async function captureSetView(handle: SetViewerHandle, options: {
  setId: string; width: number; height: number; maxReferences: number;
} & SetSendOptions): Promise<ShapeShotResult> {
  if (options.maxReferences < 1) throw new Error('Choose a model with a free image reference slot, or remove a reference in Studio.');
  const kind = options.includeStandIns ? 'composite' : 'plate';
  const blobs = await handle.capture([kind], options.width, options.height);
  const guidance = options.enhance
    ? 'Create a polished, photorealistic image from @image1. Preserve its exact camera angle, perspective, crop, composition, architecture, object placement, and lighting direction. Resolve scan artifacts, holes, floaters, and smeared surfaces into natural, coherent detail. Keep existing signage and materials faithful; do not add objects or redesign the location.'
    : '';
  const standIns = options.enhance && options.includeStandIns
    ? ' Any gray mannequins are placement guides only. Replace them with characters described in the prompt or character references; otherwise omit them. Preserve their position, scale, and pose when replacing them.' : '';
  return { mode: 'view', setId: options.setId, camera: handle.readCamera(`Set view ${new Date().toLocaleString()}`),
    files: [new File([blobs[kind]], 'set-view.png', { type: 'image/png' })],
    promptBlock: [`${guidance}${standIns}`, options.instructions.trim()].filter(Boolean).join('\n\n') };
}
