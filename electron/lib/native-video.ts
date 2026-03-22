import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface NativeVideoDescriptor {
  id: string;
  kind: 'video' | 'image';
  source: string;
  currentTime: number;
  rate: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  playing: boolean;
  muted: boolean;
  flipH: boolean;
  flipV: boolean;
}

interface NativeVideoAddon {
  createSurface: (surfaceId: string, nativeHandle: Buffer) => boolean;
  destroySurface: (surfaceId: string) => void;
  setSurfaceRect: (surfaceId: string, x: number, y: number, width: number, height: number) => void;
  setSurfaceHidden: (surfaceId: string, hidden: boolean) => void;
  clearSurface: (surfaceId: string) => void;
  syncSurface: (surfaceId: string, descriptors: NativeVideoDescriptor[]) => void;
}

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveAddonPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'native', 'cinegen_avfoundation.node');
  }
  return path.resolve(moduleDir, '../native/avfoundation/build/Release/cinegen_avfoundation.node');
}

let addon: NativeVideoAddon | null = null;
let addonError: string | null = null;

if (process.platform === 'darwin') {
  try {
    const addonPath = resolveAddonPath();
    addon = require(addonPath) as NativeVideoAddon;
    console.log('[native-video] AVFoundation addon loaded:', addonPath);
  } catch (err) {
    addonError = err instanceof Error ? err.message : String(err);
    console.error('[native-video] Failed to load AVFoundation addon:', addonError);
  }
}

export function isNativeVideoAvailable(): boolean {
  return addon != null;
}

export function getNativeVideoAvailabilityError(): string | null {
  return addonError;
}

export function createNativeSurface(surfaceId: string, nativeHandle: Buffer): boolean {
  if (!addon) return false;
  return addon.createSurface(surfaceId, nativeHandle);
}

export function destroyNativeSurface(surfaceId: string): void {
  addon?.destroySurface(surfaceId);
}

export function setNativeSurfaceRect(surfaceId: string, x: number, y: number, width: number, height: number): void {
  addon?.setSurfaceRect(surfaceId, x, y, width, height);
}

export function setNativeSurfaceHidden(surfaceId: string, hidden: boolean): void {
  addon?.setSurfaceHidden(surfaceId, hidden);
}

export function clearNativeSurface(surfaceId: string): void {
  addon?.clearSurface(surfaceId);
}

export function syncNativeSurface(surfaceId: string, descriptors: NativeVideoDescriptor[]): void {
  addon?.syncSurface(surfaceId, descriptors);
}

export type { NativeVideoDescriptor };
