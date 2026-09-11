type Fields = Record<string, unknown>;
type Reference = { value: string; role?: string };

export function clipEditResolutions(options: { value: string; label: string; description?: string }[] = []): { value: string; label: string; description?: string }[] {
  return options.some(option => String(option.value).replace(/p$/i, '') === '1080')
    ? options : [...options, { value: '1080', label: '1080p' }];
}

export function supportsTopviewClipEdit(model: unknown): boolean {
  return typeof model === 'string' && /^seedance[ -]2[.-]5$/i.test(model.trim());
}

export function isTopviewClipEdit(params: Fields): boolean {
  const extra = params.params as Fields | undefined;
  return (params.videoMode ?? params.video_mode ?? extra?.video_mode) === 'edit';
}

/** Clip Edit is an explicit Canvas capability, independent of the legacy video catalog. */
export function topviewClipEditRequest(params: Fields, references: Reference[]): Fields {
  if (!supportsTopviewClipEdit(params.model)) throw new Error('Topview Clip Edit is available for Seedance 2.5. Choose that model or switch back to generation.');
  const videos = references.filter(ref => ref.role === 'video' || ref.role === 'reference_video');
  if (videos.length !== 1) throw new Error('Clip Edit needs exactly one source video. Connect it to Video to edit, then add optional image and audio references.');
  if (references.some(ref => ref.role === 'start_image' || ref.role === 'end_image')) throw new Error('Clip Edit uses the source video’s framing. Add images as references instead of first or last frames.');
  const extra = (params.params ?? {}) as Fields;
  const resolution = Number(String(params.resolution ?? extra.resolution ?? 720).replace(/p$/i, ''));
  if (![480, 720, 1080].includes(resolution)) throw new Error('Seedance 2.5 Clip Edit supports 480p, 720p, or 1080p.');
  const sound = params.generateAudio ?? extra.generate_audio;
  return {
    model: 'seedance-2.5', taskType: 'omni_reference', prompt: params.prompt,
    omniReferenceTaskType: 'edit', duration: -1, aspectRatio: 'adaptive', resolution,
    ...(sound !== undefined ? { sound } : {}),
    ...(params.commandId ? { commandId: params.commandId } : {}),
  };
}

export const CLIP_EDIT_MIN_PIXELS = 407_696;

/** Read MP4/MOV video-track dimensions without native tools (also runs in Workers).
 * Bounds-check every atom and ignore audio tracks and untrusted declared lengths.
 */
export function clipVideoFrameSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  type Atom = { type: string; start: number; end: number };
  function atoms(start: number, end: number): Atom[] {
    const result: Atom[] = [];
    while (start + 8 <= end && result.length < 10_000) {
      let size = view.getUint32(start), header = 8;
      if (size === 1) {
        if (start + 16 > end) break;
        size = view.getUint32(start + 8) * 2 ** 32 + view.getUint32(start + 12); header = 16;
      } else if (size === 0) size = end - start;
      if (!Number.isSafeInteger(size) || size < header || start + size > end) break;
      result.push({ type: tag(start + 4), start: start + header, end: start + size });
      start += size;
    }
    return result;
  }
  const moov = atoms(0, bytes.length).find(atom => atom.type === 'moov');
  if (!moov) return;
  for (const trak of atoms(moov.start, moov.end).filter(atom => atom.type === 'trak')) {
    const children = atoms(trak.start, trak.end);
    const mdia = children.find(atom => atom.type === 'mdia');
    const hdlr = mdia && atoms(mdia.start, mdia.end).find(atom => atom.type === 'hdlr');
    if (!hdlr || hdlr.start + 12 > hdlr.end || tag(hdlr.start + 8) !== 'vide') continue;
    const tkhd = children.find(atom => atom.type === 'tkhd');
    if (!tkhd) continue;
    const version = bytes[tkhd.start];
    const offset = version === 0 ? 76 : version === 1 ? 88 : -1;
    if (offset < 0 || tkhd.start + offset + 8 > tkhd.end) continue;
    const width = view.getUint32(tkhd.start + offset) / 65536;
    const height = view.getUint32(tkhd.start + offset + 4) / 65536;
    if (width > 0 && height > 0 && width <= 65535 && height <= 65535) return { width, height };
  }
}

export function assertClipEditVideo(bytes: Uint8Array): void {
  const size = clipVideoFrameSize(bytes);
  if (!size) throw new Error('Could not verify the Clip Edit source video. Use an MP4 or MOV with readable video dimensions. No generation was submitted.');
  if (size.width * size.height < CLIP_EDIT_MIN_PIXELS) throw new Error(`This source video is ${size.width}×${size.height}, below Topview’s Clip Edit minimum of 407,696 pixels per frame. Use a 720p or larger source video. Choosing 1080p output does not resize the input. No generation was submitted.`);
}
