import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const LOAD_RETRY_DELAY_MS = 1200;
const RESUME_NUDGE_DELAY_MS = 150;
const RESUME_HEALTH_CHECK_DELAY_MS = 1000;
const RESUME_HARD_RELOAD_DELAY_MS = 2800;

type WindowReloader = (win: BrowserWindow) => Promise<void>;

const WINDOW_RELOADERS = new WeakMap<BrowserWindow, WindowReloader>();
const WINDOW_LABELS = new WeakMap<BrowserWindow, string>();
const WINDOW_RESUME_TIMERS = new WeakMap<BrowserWindow, Set<NodeJS.Timeout>>();
const WINDOW_WAKE_GRACE_UNTIL = new WeakMap<BrowserWindow, number>();

function resolveWindowIconPath(): string | undefined {
  const fileNames = process.platform === 'darwin'
    ? ['CineGen.png', 'CineGen.icns']
    : process.platform === 'win32'
      ? ['CineGen.ico', 'CineGen.png']
      : ['CineGen.png'];
  const candidates = [
    ...fileNames.map((fileName) => path.resolve(process.cwd(), 'build', fileName)),
    ...fileNames.map((fileName) => path.resolve(import.meta.dirname, '../build', fileName)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const APP_ICON = resolveWindowIconPath();
const DIST_ELECTRON = path.join(import.meta.dirname, '.');
const DIST = path.join(DIST_ELECTRON, '../dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function loadProjectManagerContent(win: BrowserWindow): Promise<void> {
  if (VITE_DEV_SERVER_URL) {
    return win.loadURL(`${VITE_DEV_SERVER_URL}?pm=1`);
  }
  return win.loadFile(path.join(DIST, 'index.html'), { query: { pm: '1' } });
}

function loadMainContent(win: BrowserWindow): Promise<void> {
  if (VITE_DEV_SERVER_URL) {
    return win.loadURL(VITE_DEV_SERVER_URL);
  }
  return win.loadFile(path.join(DIST, 'index.html'));
}

function addWindowTimer(win: BrowserWindow, timer: NodeJS.Timeout): void {
  const timers = WINDOW_RESUME_TIMERS.get(win) ?? new Set<NodeJS.Timeout>();
  timers.add(timer);
  WINDOW_RESUME_TIMERS.set(win, timers);
}

function removeWindowTimer(win: BrowserWindow, timer: NodeJS.Timeout): void {
  WINDOW_RESUME_TIMERS.get(win)?.delete(timer);
}

function clearWindowTimers(win: BrowserWindow): void {
  const timers = WINDOW_RESUME_TIMERS.get(win);
  if (!timers) return;
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers.clear();
}

function reloadExistingPage(win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      win.webContents.removeListener('did-finish-load', handleFinish);
      win.webContents.removeListener('did-fail-load', handleFail);
    };

    const handleFinish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const handleFail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (settled || !isMainFrame || errorCode === -3) return;
      settled = true;
      cleanup();
      reject(new Error(`did-fail-load ${errorCode}: ${errorDescription}`));
    };

    win.webContents.on('did-finish-load', handleFinish);
    win.webContents.on('did-fail-load', handleFail);
    win.webContents.reloadIgnoringCache();
  });
}

async function reloadWindowForRecovery(
  win: BrowserWindow,
  label: string,
  reloadWindow: WindowReloader,
  reason: string,
): Promise<void> {
  if (win.isDestroyed()) return;
  console.warn(`[window] ${label} reloading after wake: ${reason}`);
  const currentUrl = win.webContents.getURL();
  if (currentUrl) {
    await reloadExistingPage(win);
    return;
  }
  await reloadWindow(win);
}

async function runResumeHealthCheck(
  win: BrowserWindow,
  label: string,
  reloadWindow: WindowReloader,
): Promise<void> {
  if (win.isDestroyed()) return;
  try {
    const status = await win.webContents.executeJavaScript(
      `(() => {
        const root =
          document.getElementById('root') ??
          document.getElementById('app') ??
          document.querySelector('[data-reactroot]');
        const bodyChildren = document.body?.childElementCount ?? 0;
        const bodyTextLength = (document.body?.innerText ?? '').trim().length;
        return {
          readyState: document.readyState,
          hasRoot: Boolean(root),
          bodyChildren,
          bodyTextLength,
        };
      })()`,
      true,
    );

    const looksBlank = !status?.hasRoot && status?.bodyChildren === 0 && status?.bodyTextLength === 0;
    if (!looksBlank) return;
    await reloadWindowForRecovery(win, label, reloadWindow, 'blank renderer DOM after resume');
  } catch (error) {
    console.warn(`[window] ${label} health check failed after wake:`, error);
    await reloadWindowForRecovery(win, label, reloadWindow, 'resume health check failed');
  }
}

export function recoverManagedWindowsFromSleep(reason: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const reloadWindow = WINDOW_RELOADERS.get(win);
    if (!reloadWindow) continue;
    const label = WINDOW_LABELS.get(win) ?? 'window';

    clearWindowTimers(win);
    WINDOW_WAKE_GRACE_UNTIL.set(win, Date.now() + RESUME_HARD_RELOAD_DELAY_MS + 1000);

    let hardReloadTimer: NodeJS.Timeout | null = null;

    const nudgeTimer = setTimeout(() => {
      removeWindowTimer(win, nudgeTimer);
      if (win.isDestroyed()) return;
      console.log(`[window] ${label} wake recovery started: ${reason}`);
      win.webContents.invalidate();
      void win.webContents.executeJavaScript(
        `(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        })()`,
        true,
      ).catch(() => {});

      if (win.isVisible()) {
        win.show();
        win.focus();
      }
    }, RESUME_NUDGE_DELAY_MS);
    addWindowTimer(win, nudgeTimer);

    const healthCheckTimer = setTimeout(() => {
      removeWindowTimer(win, healthCheckTimer);
      void (async () => {
        try {
          await runResumeHealthCheck(win, label, reloadWindow);
          if (hardReloadTimer) {
            clearTimeout(hardReloadTimer);
            removeWindowTimer(win, hardReloadTimer);
            hardReloadTimer = null;
          }
        } catch (error) {
          console.warn(`[window] ${label} resume health check threw:`, error);
        }
      })();
    }, RESUME_HEALTH_CHECK_DELAY_MS);
    addWindowTimer(win, healthCheckTimer);

    hardReloadTimer = setTimeout(() => {
      removeWindowTimer(win, hardReloadTimer!);
      if (win.isDestroyed()) return;
      void reloadWindowForRecovery(win, label, reloadWindow, `hard reload after ${reason}`).catch((error) => {
        console.error(`[window] ${label} hard reload failed:`, error);
      });
    }, RESUME_HARD_RELOAD_DELAY_MS);
    addWindowTimer(win, hardReloadTimer);
  }
}

function attachWindowRecovery(
  win: BrowserWindow,
  label: string,
  reloadWindow: (win: BrowserWindow) => Promise<void>,
): void {
  let reloadTimer: NodeJS.Timeout | null = null;
  WINDOW_RELOADERS.set(win, reloadWindow);
  WINDOW_LABELS.set(win, label);

  const scheduleReload = (reason: string) => {
    if (win.isDestroyed() || reloadTimer) return;
    const wakeGraceUntil = WINDOW_WAKE_GRACE_UNTIL.get(win) ?? 0;
    if (reason === 'window became unresponsive' && Date.now() < wakeGraceUntil) {
      console.warn(`[window] ${label} suppressing reload during wake recovery: ${reason}`);
      return;
    }
    console.warn(`[window] ${label} scheduling reload: ${reason}`);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (win.isDestroyed()) return;
      reloadWindow(win).catch((error) => {
        console.error(`[window] ${label} reload failed:`, error);
      });
    }, LOAD_RETRY_DELAY_MS);
  };

  win.on('unresponsive', () => {
    scheduleReload('window became unresponsive');
  });

  win.on('closed', () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    clearWindowTimers(win);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    scheduleReload(`render process gone (${details.reason})`);
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    scheduleReload(`did-fail-load ${errorCode}: ${errorDescription}`);
  });
}

export function createProjectManagerWindow(): BrowserWindow {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const pmW = 900;
  const pmH = 580;

  const pm = new BrowserWindow({
    width: pmW,
    height: pmH,
    x: Math.round((screenW - pmW) / 2),
    y: Math.round((screenH - pmH) / 2),
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  attachWindowRecovery(pm, 'project-manager', loadProjectManagerContent);
  void loadProjectManagerContent(pm);

  return pm;
}

export function createSplashWindow(): BrowserWindow {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const splashW = 800;
  const splashH = 395;

  const splash = new BrowserWindow({
    width: splashW,
    height: splashH,
    x: Math.round((screenW - splashW) / 2),
    y: Math.round((screenH - splashH) / 2),
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splash.loadFile(path.join(DIST_ELECTRON, 'splash.html'));
  return splash;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#08090c',
    titleBarStyle: 'hiddenInset',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  attachWindowRecovery(win, 'main', loadMainContent);
  void loadMainContent(win);

  if (VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}
