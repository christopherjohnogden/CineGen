import { app, BrowserWindow, ipcMain, nativeImage, protocol, powerMonitor } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import {
  createSplashWindow,
  createMainWindow,
  createProjectManagerWindow,
  recoverManagedWindowsFromSleep,
} from './window.js';
import { registerProjectHandlers } from './ipc/project.js';
import { registerWorkflowHandlers } from './ipc/workflows.js';
import { registerExportHandlers } from './ipc/exports.js';
import { registerElementHandlers } from './ipc/elements.js';
import { registerLLMChatHandlers } from './ipc/llm-chat.js';
import { registerMusicPromptHandlers } from './ipc/music-prompt.js';
import { registerFileSystemHandlers } from './ipc/file-system.js';
import { registerDbHandlers, closeAllDbs } from './ipc/db.js';
import { registerMediaImportHandlers, terminateMediaWorker, submitJob } from './ipc/media-import.js';
import { registerAudioSyncHandlers } from './ipc/audio-sync.js';
import { registerNativeVideoHandlers } from './ipc/native-video.js';
import { registerTranscriptionHandlers } from './ipc/transcription.js';
import { registerLocalModelHandlers } from './ipc/local-models.js';
import { registerSam3Handlers, stopSam3Server } from './ipc/sam3-server.js';
import { registerVisionHandlers } from './ipc/vision.js';

const SHOULD_DISABLE_GPU_FOR_DEV_WAKE =
  process.platform === 'darwin' && !app.isPackaged;

if (SHOULD_DISABLE_GPU_FOR_DEV_WAKE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
  console.log('[app] hardware acceleration disabled for macOS dev wake stability');
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Register custom protocol for serving local media files to the renderer
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let pmWindow: BrowserWindow | null = null;
let wakeRecoveryTimer: NodeJS.Timeout | null = null;
const appStartTime = Date.now();
const LEGACY_USER_DATA_DIR = 'cinegen-desktop';
const PREFERRED_USER_DATA_DIR = 'CineGen';
const USER_DATA_MIGRATION_MARKER = '.cinegen-user-data-migrated.json';
const APP_DISPLAY_NAME = 'CineGen';
const WAKE_RECOVERY_DELAY_MS = 700;

function broadcastPowerEvent(type: 'suspend' | 'resume' | 'unlock-screen'): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('app:power-event', { type });
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.json': 'application/json',
};

function configureUserDataPath(): { preferredUserDataPath: string; legacyUserDataPath: string } {
  try {
    const appDataPath = app.getPath('appData');
    const legacyUserDataPath = path.join(appDataPath, LEGACY_USER_DATA_DIR);
    const preferredUserDataPath = path.join(appDataPath, PREFERRED_USER_DATA_DIR);
    if (app.getPath('userData') !== preferredUserDataPath) {
      app.setPath('userData', preferredUserDataPath);
    }
    console.log('[app] userData path:', preferredUserDataPath);
    return { preferredUserDataPath, legacyUserDataPath };
  } catch (error) {
    console.error('[app] failed to configure userData path:', error);
    const appDataPath = app.getPath('appData');
    const preferredUserDataPath = path.join(appDataPath, PREFERRED_USER_DATA_DIR);
    const legacyUserDataPath = path.join(appDataPath, LEGACY_USER_DATA_DIR);
    return { preferredUserDataPath, legacyUserDataPath };
  }
}

const userDataPaths = configureUserDataPath();

try {
  app.setName(APP_DISPLAY_NAME);
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: APP_DISPLAY_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
    });
  }
} catch (error) {
  console.error('[app] failed to configure app display name:', error);
}

async function migrateUserDataIfNeeded(): Promise<void> {
  const { preferredUserDataPath, legacyUserDataPath } = userDataPaths;
  if (preferredUserDataPath === legacyUserDataPath) return;
  if (!fsSync.existsSync(legacyUserDataPath)) return;

  const markerPath = path.join(preferredUserDataPath, USER_DATA_MIGRATION_MARKER);
  if (fsSync.existsSync(markerPath)) return;

  try {
    await fs.mkdir(preferredUserDataPath, { recursive: true });
    await fs.cp(legacyUserDataPath, preferredUserDataPath, { recursive: true, force: true });
    await fs.writeFile(
      markerPath,
      JSON.stringify({
        migratedFrom: legacyUserDataPath,
        migratedAt: new Date().toISOString(),
      }, null, 2),
      'utf-8',
    );
    console.log('[app] migrated userData:', legacyUserDataPath, '->', preferredUserDataPath);
  } catch (error) {
    console.error('[app] failed to migrate userData:', error);
  }
}

function resolveAppIconPaths(): string[] {
  const fileNames = process.platform === 'darwin'
    ? ['CineGen.png', 'CineGen.icns']
    : process.platform === 'win32'
      ? ['CineGen.ico', 'CineGen.png']
      : ['CineGen.png'];
  const roots = [
    process.cwd(),
    app.getAppPath(),
    process.resourcesPath,
  ];

  const candidates: string[] = [];
  for (const root of roots) {
    for (const fileName of fileNames) {
      const candidate = path.join(root, 'build', fileName);
      if (fsSync.existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function getHeader(headers: Headers, name: string): string | null {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? headers.get(name.toUpperCase());
}

function parseByteRangeHeader(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader.startsWith('bytes=')) return null;
  // We only support a single range. If multiple are provided, use the first.
  const firstRange = rangeHeader.slice('bytes='.length).split(',')[0]?.trim() ?? '';
  const match = /^(\d*)-(\d*)$/.exec(firstRange);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  // "bytes=-N" => suffix range (last N bytes)
  if (!startStr && endStr) {
    const suffixLen = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(totalSize - suffixLen, 0);
    const end = totalSize - 1;
    return start <= end ? { start, end } : null;
  }

  // "bytes=N-" or "bytes=N-M"
  if (startStr) {
    const start = Number.parseInt(startStr, 10);
    const parsedEnd = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(parsedEnd)) return null;
    const end = Math.min(parsedEnd, totalSize - 1);
    if (start < 0 || end < start || start >= totalSize) return null;
    return { start, end };
  }

  return null;
}

function toFsPathFromLocalMediaUrl(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.hostname !== 'file') return null;

  let decodedPath = decodeURIComponent(url.pathname);
  if (process.platform === 'win32' && decodedPath.startsWith('/')) {
    decodedPath = decodedPath.slice(1);
  }
  return path.normalize(decodedPath);
}

async function migrateLegacyData(): Promise<void> {
  const legacyPath = path.join(process.cwd(), '.data', 'dev', 'project.json');
  const cingenDir = path.join(os.homedir(), 'Documents', 'CINEGEN');
  const indexPath = path.join(cingenDir, 'projects.json');

  try {
    await fs.access(legacyPath);
  } catch {
    return; // No legacy data
  }

  try {
    await fs.access(indexPath);
    return; // Already migrated (index exists)
  } catch {
    // Continue with migration
  }

  try {
    const raw = await fs.readFile(legacyPath, 'utf-8');
    const snapshot = JSON.parse(raw);
    const id = snapshot.project?.id || crypto.randomUUID();
    const name = snapshot.project?.name || 'Migrated Project';

    await fs.mkdir(path.join(cingenDir, id), { recursive: true });
    await fs.writeFile(
      path.join(cingenDir, id, 'project.json'),
      JSON.stringify(snapshot, null, 2),
      'utf-8',
    );

    const index = {
      projects: [{
        id,
        name,
        createdAt: snapshot.project?.createdAt || new Date().toISOString(),
        updatedAt: snapshot.project?.updatedAt || new Date().toISOString(),
        assetCount: Array.isArray(snapshot.assets) ? snapshot.assets.length : 0,
        elementCount: Array.isArray(snapshot.elements) ? snapshot.elements.length : 0,
        thumbnail: null,
      }],
    };
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');

    console.log(`[migration] Migrated legacy project "${name}" to ${cingenDir}/${id}`);
  } catch (err) {
    console.error('[migration] Failed to migrate legacy data:', err);
  }
}

app.whenReady().then(async () => {
  await migrateUserDataIfNeeded();

  // Set dock icon
  if (process.platform === 'darwin') {
    const iconPaths = resolveAppIconPaths();
    console.log('[dock] icon candidates:', iconPaths);
    for (const iconPath of iconPaths) {
      try {
        const icon = nativeImage.createFromPath(iconPath);
        console.log('[dock] testing icon:', iconPath, 'empty?', icon.isEmpty());
        if (!icon.isEmpty()) {
          await Promise.resolve(app.dock.setIcon(icon));
          console.log('[dock] applied icon:', iconPath);
          break;
        }
      } catch (error) {
        console.error('[dock] failed to apply icon:', iconPath, error);
      }
    }
  }

  // Handle local-media:// protocol with byte-range support for instant scrubbing/playback.
  protocol.handle('local-media', async (request) => {
    try {
      // URL format: local-media://file/absolute/path/to/file.ext
      const fsPath = toFsPathFromLocalMediaUrl(request.url);
      if (!fsPath) {
        return new Response('Invalid local-media host', { status: 400 });
      }

      const stats = await fs.stat(fsPath);
      if (!stats.isFile()) {
        return new Response('Not a file', { status: 404 });
      }

      const totalSize = stats.size;
      const contentType = guessContentType(fsPath);
      const range = getHeader(request.headers, 'range');

      // HEAD requests should return headers only.
      if (request.method.toUpperCase() === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(totalSize),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      if (range) {
        const parsed = parseByteRangeHeader(range, totalSize);
        if (!parsed) {
          return new Response('Invalid Range', { status: 416 });
        }

        const safeStart = parsed.start;
        const safeEnd = parsed.end;
        if (safeStart < 0 || safeEnd < safeStart || safeStart >= totalSize) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${totalSize}`,
            },
          });
        }

        const chunkSize = safeEnd - safeStart + 1;
        const stream = fsSync.createReadStream(fsPath, { start: safeStart, end: safeEnd });
        const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

        return new Response(body, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${safeStart}-${safeEnd}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      const stream = fsSync.createReadStream(fsPath);
      const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(totalSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      console.error('[local-media] Failed request:', request.url, err);
      return new Response('Invalid local-media URL', { status: 400 });
    }
  });

  // Register all IPC handlers
  registerProjectHandlers();
  registerWorkflowHandlers();
  registerExportHandlers();
  registerElementHandlers();
  registerLLMChatHandlers();
  registerMusicPromptHandlers();
  registerFileSystemHandlers();
  registerDbHandlers();
  registerMediaImportHandlers();
  registerAudioSyncHandlers(submitJob);
  registerVisionHandlers();
  registerNativeVideoHandlers();
  registerTranscriptionHandlers();
  registerLocalModelHandlers();
  registerSam3Handlers();

  // Migrate legacy data before creating windows
  await migrateLegacyData();

  // IPC: renderer in PM window calls this when user picks a project
  ipcMain.handle('pm:open-project', async (_event, id: string, useSqlite: boolean) => {
    // Close signal from the dot button
    if (id === '__close__') {
      pmWindow?.close();
      pmWindow = null;
      return { ok: true };
    }
    // Create/show main window and send the project to open
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
    mainWindow.once('ready-to-show', () => {
      mainWindow?.maximize();
      mainWindow?.show();
      mainWindow?.webContents.send('pm:open-project', id, useSqlite);
    });
    // If already loaded, send immediately
    if (mainWindow.webContents.getURL() !== '') {
      mainWindow.maximize();
      mainWindow.show();
      mainWindow.webContents.send('pm:open-project', id, useSqlite);
    }
    // Close PM window
    pmWindow?.close();
    pmWindow = null;
    return { ok: true };
  });

  // IPC: main window calls this to re-open PM (back to home)
  ipcMain.handle('pm:open', async () => {
    if (pmWindow && !pmWindow.isDestroyed()) {
      pmWindow.focus();
      return { ok: true };
    }
    pmWindow = createProjectManagerWindow();
    pmWindow.on('closed', () => { pmWindow = null; });
    return { ok: true };
  });

  // Show splash screen
  splashWindow = createSplashWindow();

  // Create main window (hidden — stays hidden until a project is opened)
  mainWindow = createMainWindow();

  // After splash, show PM window instead of main window
  const splashMinTime = 3000;
  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - appStartTime;
    const remaining = Math.max(0, splashMinTime - elapsed);
    setTimeout(() => {
      splashWindow?.close();
      splashWindow = null;
      // Show PM window
      pmWindow = createProjectManagerWindow();
      pmWindow.on('closed', () => { pmWindow = null; });
    }, remaining);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      pmWindow = createProjectManagerWindow();
      pmWindow.on('closed', () => { pmWindow = null; });
    }
  });

  const scheduleWakeRecovery = (source: string) => {
    if (wakeRecoveryTimer) {
      clearTimeout(wakeRecoveryTimer);
      wakeRecoveryTimer = null;
    }

    wakeRecoveryTimer = setTimeout(() => {
      wakeRecoveryTimer = null;
      console.log(`[app] Wake recovery triggered by ${source}`);
      recoverManagedWindowsFromSleep(source);
    }, WAKE_RECOVERY_DELAY_MS);
  };

  powerMonitor.on('resume', () => {
    broadcastPowerEvent('resume');
    scheduleWakeRecovery('resume');
  });

  powerMonitor.on('unlock-screen', () => {
    broadcastPowerEvent('unlock-screen');
    scheduleWakeRecovery('unlock-screen');
  });

  powerMonitor.on('suspend', () => {
    broadcastPowerEvent('suspend');
  });
});

app.on('before-quit', () => {
  if (wakeRecoveryTimer) {
    clearTimeout(wakeRecoveryTimer);
    wakeRecoveryTimer = null;
  }
  terminateMediaWorker();
  closeAllDbs();
  stopSam3Server();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
