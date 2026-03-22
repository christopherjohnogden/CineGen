const DEBUG_KEY = 'cinegen_debug_media';

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

export function isMediaDebugEnabled(): boolean {
  if (!canUseWindow()) return false;
  try {
    const raw = window.localStorage.getItem(DEBUG_KEY);
    return raw === '1' || raw === 'true' || raw === 'on';
  } catch {
    return false;
  }
}

function ts(): string {
  return new Date().toISOString();
}

export function mediaDebug(message: string, payload?: unknown): void {
  if (!isMediaDebugEnabled()) return;
  if (payload === undefined) {
    console.log(`[media-debug ${ts()}] ${message}`);
    return;
  }
  console.log(`[media-debug ${ts()}] ${message}`, payload);
}

export function mediaDebugWarn(message: string, payload?: unknown): void {
  if (!isMediaDebugEnabled()) return;
  if (payload === undefined) {
    console.warn(`[media-debug ${ts()}] ${message}`);
    return;
  }
  console.warn(`[media-debug ${ts()}] ${message}`, payload);
}

export function mediaDebugError(message: string, payload?: unknown): void {
  if (!isMediaDebugEnabled()) return;
  if (payload === undefined) {
    console.error(`[media-debug ${ts()}] ${message}`);
    return;
  }
  console.error(`[media-debug ${ts()}] ${message}`, payload);
}

