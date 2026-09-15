import type { ProjectSet } from '@/types/sets';
import { createScene, renderPass, rgbaToPngBlob } from './scene';
import { resolveStartView } from './start-view';
import { loadPhotoStart } from './photo-start';
import { toFileUrl } from '@/lib/utils/file-url';

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not save the preview.'));
    reader.readAsDataURL(blob);
  });
}
/** Called serially by the gallery so large scans never compete for GPU memory. */
export async function createSetThumbnail(set: ProjectSet): Promise<string> {
  const url = toFileUrl(set.splatPath!);
  const ctx = await createScene({ canvas: document.createElement('canvas'), set, splatUrl: url });
  try {
    const photo = await loadPhotoStart(url, new AbortController().signal);
    const view = resolveStartView(ctx.splat, set, false, photo);
    ctx.camera.position.set(...view.position);
    ctx.camera.up.set(...(view.up ?? [0, 1, 0]));
    ctx.camera.lookAt(...view.target);
    ctx.camera.fov = view.verticalFov ?? 40;
    ctx.camera.aspect = 16 / 9;
    ctx.camera.updateProjectionMatrix();
    ctx.camera.updateMatrixWorld(true);
    const { data } = await renderPass(ctx, 'plate', 480, 270);
    return blobDataUrl(await rgbaToPngBlob(data, 480, 270));
  } finally { ctx.dispose(); }
}
