/** Verified against Higgsfield's model catalog on 2026-09-11. */
export function isHiggsfieldGenjutsu(model: unknown): boolean {
  return ['hf_mult_motion_control', 'hf_mult_replace_object'].includes(String(model));
}

export function isHiggsfieldMediaTool(model: unknown): boolean {
  return isHiggsfieldGenjutsu(model) || ['topaz_image', 'topaz_video', 'sync_so'].includes(String(model));
}

export function validateHiggsfieldMediaTool(model: string, params: Record<string, unknown>, medias: Array<{ value: string; role?: string }>): void {
  if (!isHiggsfieldMediaTool(model)) return;
  const image = medias.filter(m => /image/.test(m.role ?? ''));
  const video = medias.filter(m => /video/.test(m.role ?? ''));
  const audio = medias.filter(m => /audio/.test(m.role ?? ''));
  if (isHiggsfieldGenjutsu(model)) {
    if (medias.some(media => !['image', 'image_references', 'video', 'video_references'].includes(media.role ?? ''))) {
      throw new Error('Genjutsu accepts reference images and one source video. Audio and frame references are not supported.');
    }
    if (video.length !== 1) throw new Error('Genjutsu requires exactly one source video.');
    if (!image.length) throw new Error('Genjutsu requires at least one reference image.');
    if (params.resolution !== undefined && !['480p', '720p', '1080p'].includes(String(params.resolution))) {
      throw new Error('Genjutsu output must be 480p, 720p, or 1080p.');
    }
  } else if (model === 'topaz_image') {
    if (image.length !== 1 || medias.length !== 1) throw new Error('Topaz Image Upscale requires exactly one source image.');
    for (const field of ['output_width', 'output_height']) {
      const size = Number(params[field]);
      if (!Number.isSafeInteger(size) || size < 1) throw new Error('Choose positive whole-pixel output width and height.');
    }
    for (const field of ['sharpen', 'denoise', 'face_enhancement_strength', 'face_enhancement_creativity']) {
      if (params[field] !== undefined && (!Number.isFinite(Number(params[field])) || Number(params[field]) < 0 || Number(params[field]) > 1)) throw new Error(`${field} must be between 0 and 1.`);
    }
  } else if (model === 'topaz_video') {
    if (video.length !== 1 || medias.length !== 1) throw new Error('Topaz Video Upscale requires exactly one source video.');
    if (params.resolution !== undefined && !['1080p','2160p'].includes(String(params.resolution))) throw new Error('Topaz video output must be 1080p or 2160p (4K).');
  } else if (video.length !== 1 || audio.length !== 1 || medias.length !== 2) throw new Error('Lip sync requires exactly one source video and one dialogue audio file.');
}
