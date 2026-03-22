import { BrowserWindow, ipcMain } from 'electron';
import {
  clearNativeSurface,
  createNativeSurface,
  destroyNativeSurface,
  getNativeVideoAvailabilityError,
  isNativeVideoAvailable,
  setNativeSurfaceHidden,
  setNativeSurfaceRect,
  syncNativeSurface,
  type NativeVideoDescriptor,
} from '../lib/native-video.js';

interface SurfaceRectPayload {
  surfaceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SyncSurfacePayload {
  surfaceId: string;
  descriptors: NativeVideoDescriptor[];
}

export function registerNativeVideoHandlers(): void {
  ipcMain.handle('native-video:is-available', () => ({
    available: isNativeVideoAvailable(),
    error: getNativeVideoAvailabilityError(),
  }));

  ipcMain.handle('native-video:reset-surfaces', (_event, surfaceIds: string[]) => {
    if (!isNativeVideoAvailable()) return false;
    for (const surfaceId of surfaceIds) {
      setNativeSurfaceHidden(surfaceId, true);
      clearNativeSurface(surfaceId);
      destroyNativeSurface(surfaceId);
    }
    return true;
  });

  ipcMain.handle('native-video:create-surface', (event, surfaceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !isNativeVideoAvailable()) return false;
    return createNativeSurface(surfaceId, win.getNativeWindowHandle());
  });

  ipcMain.on('native-video:set-surface-rect', (_event, payload: SurfaceRectPayload) => {
    if (!isNativeVideoAvailable()) return;
    setNativeSurfaceRect(payload.surfaceId, payload.x, payload.y, payload.width, payload.height);
  });

  ipcMain.on('native-video:set-surface-hidden', (_event, payload: { surfaceId: string; hidden: boolean }) => {
    if (!isNativeVideoAvailable()) return;
    setNativeSurfaceHidden(payload.surfaceId, payload.hidden);
  });

  ipcMain.on('native-video:clear-surface', (_event, surfaceId: string) => {
    if (!isNativeVideoAvailable()) return;
    clearNativeSurface(surfaceId);
  });

  ipcMain.on('native-video:sync-surface', (_event, payload: SyncSurfacePayload) => {
    if (!isNativeVideoAvailable()) return;
    syncNativeSurface(payload.surfaceId, payload.descriptors);
  });

  ipcMain.on('native-video:destroy-surface', (_event, surfaceId: string) => {
    if (!isNativeVideoAvailable()) return;
    destroyNativeSurface(surfaceId);
  });
}
