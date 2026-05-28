import { getApiKey } from '@/lib/utils/api-key';

export type FileMediaType = 'image' | 'video' | 'audio' | '';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'];
const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
const AUDIO_EXTS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'aiff'];

export function detectMediaType(file: File): FileMediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return '';
}

export function detectMediaTypeFromExt(filePath: string): FileMediaType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  return '';
}

export function getMediaTypeForFile(file: File): FileMediaType {
  return detectMediaType(file) || detectMediaTypeFromExt(file.name);
}

export function isMediaDragEvent(e: DragEvent | { dataTransfer: DataTransfer | null }): boolean {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes('Files') || types.includes('application/cinegen-shot');
}

export function getLocalPathForFile(file: File): string | undefined {
  try {
    const path = window.electronAPI?.file?.getPathForFile(file);
    if (path) return path;
  } catch {
    // ignore — fall back below
  }

  const legacyPath = (file as File & { path?: string }).path;
  return legacyPath || undefined;
}

export async function resolveMediaFileUrl(file: File): Promise<string> {
  const localPath = getLocalPathForFile(file);
  if (localPath) {
    return `local-media://file${localPath}`;
  }

  const apiKey = getApiKey();
  const buffer = await file.arrayBuffer();
  const result = await window.electronAPI.elements.upload(
    { buffer, name: file.name, type: file.type },
    apiKey,
  );
  return result.url;
}
