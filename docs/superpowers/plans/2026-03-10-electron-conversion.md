# CINEGEN Electron Conversion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert CINEGEN from a Next.js web app to an Electron desktop application with splash screen, project gallery home screen, and IPC-based architecture.

**Architecture:** Strip Next.js, rebuild renderer with Vite + React, move all server logic to Electron main process as IPC handlers. Two BrowserWindows (splash + main). View switching via React state (home | workspace). Projects stored in `~/Documents/CINEGEN/`.

**Tech Stack:** Electron, Vite, vite-plugin-electron, electron-builder, React 19, @xyflow/react, @fal-ai/client, zod

**Spec:** `docs/superpowers/specs/2026-03-10-electron-conversion-design.md`

---

## Chunk 1: Electron Scaffold & Build System

### Task 1: Initialize Electron + Vite project structure

**Files:**
- Modify: `package.json`
- Create: `vite.config.ts` (replace vitest-only config)
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/window.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Modify: `tsconfig.json`
- Create: `tsconfig.node.json`
- Delete: `next.config.ts`, `next-env.d.ts`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Update package.json — remove Next.js deps, add Electron deps**

Replace the current `package.json` with:

```json
{
  "name": "cinegen-desktop",
  "version": "1.0.0",
  "description": "AI Film Production Studio — Desktop Application",
  "private": true,
  "main": "dist-electron/main.js",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite build && electron .",
    "package": "vite build && electron-builder",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fal-ai/client": "^1.9.4",
    "@xyflow/react": "^12.10.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^25.3.5",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.4",
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0",
    "jsdom": "^28.1.0",
    "typescript": "^5.9.3",
    "vite": "^6.3.0",
    "vite-plugin-electron": "^0.30.0",
    "vite-plugin-electron-renderer": "^0.14.6",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts` with 3 build targets**

Replace the existing `vitest.config.ts` content by creating a new `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plugin to copy static files (e.g., splash.html) to dist-electron
function copyElectronStaticFiles() {
  return {
    name: 'copy-electron-static',
    writeBundle() {
      const src = path.resolve(__dirname, 'electron/splash.html');
      const dest = path.resolve(__dirname, 'dist-electron/splash.html');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
          plugins: [copyElectronStaticFiles()],
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [ ] **Step 3: Create `tsconfig.node.json` for Electron main process**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist-electron",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["electron/**/*.ts"]
}
```

- [ ] **Step 4: Update `tsconfig.json` for renderer (remove Next.js plugin)**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "electron.d.ts"],
  "exclude": ["node_modules", "dist", "dist-electron"]
}
```

- [ ] **Step 5: Create `electron.d.ts` — type declarations for the preload bridge**

Create at project root:

```ts
import type { ProjectSnapshot } from './src/types/project';
import type { ExportJob } from './src/types/export';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  elementCount: number;
  thumbnail: string | null;
}

export interface ElectronAPI {
  project: {
    list: () => Promise<ProjectMeta[]>;
    create: (name: string) => Promise<ProjectSnapshot>;
    load: (id: string) => Promise<ProjectSnapshot>;
    save: (id: string, data: Partial<ProjectSnapshot>) => Promise<ProjectSnapshot>;
    delete: (id: string) => Promise<void>;
  };
  workflow: {
    run: (params: {
      apiKey?: string;
      kieKey?: string;
      nodeId: string;
      nodeType: string;
      modelId: string;
      inputs: Record<string, unknown>;
    }) => Promise<unknown>;
    pollJob: (id: string) => Promise<{ status: string; result?: unknown }>;
  };
  export: {
    start: (params: { preset?: string; fps?: number }) => Promise<ExportJob>;
    poll: (id: string) => Promise<ExportJob>;
  };
  elements: {
    upload: (fileData: { buffer: ArrayBuffer; name: string; type: string }, apiKey?: string) => Promise<{ url: string }>;
  };
  music: {
    generatePrompt: (params: {
      apiKey?: string;
      frameUrls?: string[];
      style?: string;
      genre?: string;
      mood?: string;
      tempo?: string;
      additionalNotes?: string;
    }) => Promise<{ prompt: string }>;
  };
  dialog: {
    showSave: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    showOpen: (options?: { filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => Promise<string | null>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

- [ ] **Step 6: Create `electron/main.ts` — main process entry**

```ts
import { app, BrowserWindow } from 'electron';
import { createSplashWindow, createMainWindow } from './window.js';
import { registerProjectHandlers } from './ipc/project.js';
import { registerWorkflowHandlers } from './ipc/workflows.js';
import { registerExportHandlers } from './ipc/exports.js';
import { registerElementHandlers } from './ipc/elements.js';
import { registerMusicPromptHandlers } from './ipc/music-prompt.js';
import { registerFileSystemHandlers } from './ipc/file-system.js';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const appStartTime = Date.now();

app.whenReady().then(async () => {
  // Register all IPC handlers
  registerProjectHandlers();
  registerWorkflowHandlers();
  registerExportHandlers();
  registerElementHandlers();
  registerMusicPromptHandlers();
  registerFileSystemHandlers();

  // Show splash screen
  splashWindow = createSplashWindow();

  // Create main window (hidden)
  mainWindow = createMainWindow();

  mainWindow.once('ready-to-show', () => {
    // Ensure splash shows for at least 3s
    const splashMinTime = 3000;
    const elapsed = Date.now() - appStartTime;
    const remaining = Math.max(0, splashMinTime - elapsed);

    setTimeout(() => {
      mainWindow?.maximize();
      mainWindow?.show();
      splashWindow?.close();
      splashWindow = null;
    }, remaining);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      mainWindow.maximize();
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: Create `electron/window.ts` — window management**

```ts
import { BrowserWindow } from 'electron';
import path from 'node:path';

const DIST_ELECTRON = path.join(import.meta.dirname, '.');
const DIST = path.join(DIST_ELECTRON, '../dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

export function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    resizable: false,
    transparent: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
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
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(DIST, 'index.html'));
  }

  return win;
}
```

- [ ] **Step 8: Create `electron/preload.ts` — context bridge**

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (name: string) => ipcRenderer.invoke('project:create', name),
    load: (id: string) => ipcRenderer.invoke('project:load', id),
    save: (id: string, data: unknown) => ipcRenderer.invoke('project:save', id, data),
    delete: (id: string) => ipcRenderer.invoke('project:delete', id),
  },
  workflow: {
    run: (params: unknown) => ipcRenderer.invoke('workflow:run', params),
    pollJob: (id: string) => ipcRenderer.invoke('workflow:poll-job', id),
  },
  export: {
    start: (params: unknown) => ipcRenderer.invoke('export:start', params),
    poll: (id: string) => ipcRenderer.invoke('export:poll', id),
  },
  elements: {
    upload: (fileData: unknown, apiKey?: string) => ipcRenderer.invoke('elements:upload', fileData, apiKey),
  },
  music: {
    generatePrompt: (params: unknown) => ipcRenderer.invoke('music:generate-prompt', params),
  },
  dialog: {
    showSave: (options?: unknown) => ipcRenderer.invoke('dialog:show-save', options),
    showOpen: (options?: unknown) => ipcRenderer.invoke('dialog:show-open', options),
  },
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:open-path', filePath),
  },
});
```

- [ ] **Step 9: Create `electron/splash.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #08090c;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      overflow: hidden;
      font-family: 'Outfit', -apple-system, sans-serif;
      -webkit-app-region: drag;
    }
    .splash-container {
      text-align: center;
    }
    .splash-container img {
      max-width: 100%;
      max-height: 100vh;
      object-fit: contain;
    }
    /* Fallback if no image */
    .splash-fallback {
      color: #d4a054;
      font-size: 36px;
      font-weight: 700;
      letter-spacing: 4px;
    }
    .splash-subtitle {
      color: #8e8a82;
      font-size: 12px;
      margin-top: 8px;
    }
    .loading-bar {
      width: 120px;
      height: 2px;
      background: rgba(255,255,255,0.06);
      margin: 24px auto 0;
      border-radius: 1px;
      overflow: hidden;
    }
    .loading-bar::after {
      content: '';
      display: block;
      width: 40%;
      height: 100%;
      background: #d4a054;
      border-radius: 1px;
      animation: loading 1.5s ease-in-out infinite;
    }
    @keyframes loading {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
  </style>
</head>
<body>
  <div class="splash-container">
    <!-- User will replace this with their splash image -->
    <div class="splash-fallback">CINEGEN</div>
    <div class="splash-subtitle">AI Film Production Studio</div>
    <div class="loading-bar"></div>
  </div>
</body>
</html>
```

- [ ] **Step 10: Create `index.html` — Vite entry point**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CINEGEN</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 11: Create `src/main.tsx` — React entry point**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 12: Create `src/App.tsx` — root component with view switching (placeholder)**

```tsx
import { useState } from 'react';

type AppView = 'home' | 'workspace';

export function App() {
  const [view, setView] = useState<AppView>('home');
  const [projectId, setProjectId] = useState<string | null>(null);

  const handleOpenProject = (id: string) => {
    setProjectId(id);
    setView('workspace');
  };

  const handleBackToHome = () => {
    setProjectId(null);
    setView('home');
  };

  return (
    <div className="app-root">
      {view === 'home' && (
        <div style={{ color: '#e8e4df', padding: 40 }}>
          <h1>CINEGEN — Home (placeholder)</h1>
          <p>Project gallery will go here</p>
        </div>
      )}
      {view === 'workspace' && projectId && (
        <div style={{ color: '#e8e4df', padding: 40 }}>
          <button onClick={handleBackToHome}>Back to Projects</button>
          <h1>Workspace for project {projectId} (placeholder)</h1>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 13: Delete Next.js-specific files**

Delete these files:
- `next.config.ts`
- `next-env.d.ts`
- `app/layout.tsx`
- `app/page.tsx`

Do NOT delete `app/api/` routes yet (needed as reference for IPC migration in Task 2).
Do NOT delete `vitest.config.ts` yet (merged into vite.config.ts, delete after confirming tests still work).

- [ ] **Step 14: Install dependencies and verify build**

Run: `rm -rf node_modules package-lock.json && npm install`

Expected: Clean install with no errors.

Then run: `npx vite build`

Expected: Build succeeds, outputs to `dist/` and `dist-electron/`.

- [ ] **Step 15: Verify Electron launches**

Run: `npx electron .`

Expected: Splash window appears for ~2.5s with CINEGEN branding, then main window opens showing the placeholder home screen on a dark background.

- [ ] **Step 16: Commit scaffold**

```bash
git add -A
git commit -m "feat: scaffold Electron + Vite project structure

Strip Next.js, add Electron main/preload/window setup,
Vite config with 3 build targets, splash screen, and
placeholder App component with view switching."
```

---

## Chunk 2: IPC Handlers (Server Logic Migration)

### Task 2: Create project management IPC handlers

**Files:**
- Create: `electron/ipc/project.ts`

- [ ] **Step 1: Create `electron/ipc/project.ts`**

This replaces `lib/persistence/store.ts` + `app/api/project/route.ts` with multi-project support:

```ts
import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function projectsRoot(): string {
  return path.join(os.homedir(), 'Documents', 'CINEGEN');
}

function indexPath(): string {
  return path.join(projectsRoot(), 'projects.json');
}

function projectDir(id: string): string {
  return path.join(projectsRoot(), id);
}

function projectPath(id: string): string {
  return path.join(projectDir(id), 'project.json');
}

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  elementCount: number;
  thumbnail: string | null;
}

interface ProjectIndex {
  projects: ProjectMeta[];
}

function generateId(): string {
  return crypto.randomUUID();
}

function timestamp(): string {
  return new Date().toISOString();
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(projectsRoot(), { recursive: true });
}

async function readIndex(): Promise<ProjectIndex> {
  try {
    const raw = await fs.readFile(indexPath(), 'utf-8');
    return JSON.parse(raw) as ProjectIndex;
  } catch {
    return { projects: [] };
  }
}

async function writeIndex(index: ProjectIndex): Promise<void> {
  await ensureRoot();
  const tmp = indexPath() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8');
  await fs.rename(tmp, indexPath());
}

function defaultSnapshot(id: string, name: string) {
  const now = timestamp();
  return {
    project: { id, name, createdAt: now, updatedAt: now },
    workflow: { nodes: [], edges: [] },
    sequence: { id: 'default', tracks: [{ id: 'track-1', name: 'Track 1', clips: [] }], duration: 0 },
    assets: [],
    mediaFolders: [],
    exports: [],
    elements: [],
  };
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', async () => {
    const index = await readIndex();
    return index.projects;
  });

  ipcMain.handle('project:create', async (_event, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      throw new Error('Project name must be 1-100 characters');
    }

    const id = generateId();
    const snapshot = defaultSnapshot(id, trimmed);

    await ensureRoot();
    await fs.mkdir(projectDir(id), { recursive: true });

    const tmp = projectPath(id) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
    await fs.rename(tmp, projectPath(id));

    const index = await readIndex();
    index.projects.unshift({
      id,
      name: trimmed,
      createdAt: snapshot.project.createdAt,
      updatedAt: snapshot.project.updatedAt,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
    });
    await writeIndex(index);

    return snapshot;
  });

  ipcMain.handle('project:load', async (_event, id: string) => {
    const raw = await fs.readFile(projectPath(id), 'utf-8');
    return JSON.parse(raw);
  });

  ipcMain.handle('project:save', async (_event, id: string, updates: Record<string, unknown>) => {
    let current: Record<string, unknown>;
    try {
      const raw = await fs.readFile(projectPath(id), 'utf-8');
      current = JSON.parse(raw);
    } catch {
      throw new Error(`Project ${id} not found`);
    }

    const merged = {
      ...current,
      ...updates,
      project: {
        ...(current.project as Record<string, unknown>),
        ...((updates.project as Record<string, unknown>) ?? {}),
        updatedAt: timestamp(),
      },
    };

    const tmp = projectPath(id) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(merged, null, 2), 'utf-8');
    await fs.rename(tmp, projectPath(id));

    // Update index metadata
    const index = await readIndex();
    const meta = index.projects.find((p) => p.id === id);
    if (meta) {
      meta.updatedAt = (merged.project as Record<string, unknown>).updatedAt as string;
      meta.assetCount = Array.isArray(merged.assets) ? merged.assets.length : 0;
      meta.elementCount = Array.isArray(merged.elements) ? merged.elements.length : 0;
      if (updates.project && (updates.project as Record<string, unknown>).name) {
        meta.name = (updates.project as Record<string, unknown>).name as string;
      }
      await writeIndex(index);
    }

    return merged;
  });

  ipcMain.handle('project:delete', async (_event, id: string) => {
    await fs.rm(projectDir(id), { recursive: true, force: true });

    const index = await readIndex();
    index.projects = index.projects.filter((p) => p.id !== id);
    await writeIndex(index);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/project.ts
git commit -m "feat: add project management IPC handlers

Multi-project CRUD with ~/Documents/CINEGEN/ storage,
atomic writes, and projects.json index management."
```

### Task 3: Create workflow execution IPC handler

**Files:**
- Create: `electron/ipc/workflows.ts`

- [ ] **Step 1: Create `electron/ipc/workflows.ts`**

This replaces `app/api/workflows/route.ts` + `lib/fal/client.ts` + `lib/kie/client.ts`:

```ts
import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';

// --- kie.ai client (moved from lib/kie/client.ts) ---

const KIE_BASE = 'https://api.kie.ai/api/v1';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;

const DEDICATED_ENDPOINTS: Record<string, string> = {
  'runway': `${KIE_BASE}/runway/generate`,
  'veo': `${KIE_BASE}/veo/generate`,
  '4o-image': `${KIE_BASE}/gpt4o-image/generate`,
  'suno-music': `${KIE_BASE}/generate`,
};

function getDedicatedEndpoint(model: string): string | undefined {
  for (const [prefix, endpoint] of Object.entries(DEDICATED_ENDPOINTS)) {
    if (model.startsWith(prefix)) return endpoint;
  }
  return undefined;
}

async function submitKieTask(
  model: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<string> {
  const dedicatedUrl = getDedicatedEndpoint(model);
  const url = dedicatedUrl ?? `${KIE_BASE}/jobs/createTask`;
  const body = dedicatedUrl
    ? { ...input, callBackUrl: '' }
    : { model, input, callBackUrl: '' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).msg || `kie.ai error ${res.status}`);
  }

  const data = await res.json();
  if ((data as Record<string, unknown>).code !== 200) {
    throw new Error((data as Record<string, string>).msg || 'Failed to create kie.ai task');
  }

  return (data as { data: { taskId: string } }).data.taskId;
}

async function pollKieResult(taskId: string, apiKey: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) continue;

    const data = await res.json();
    const record = (data as { data: { state: string; resultJson: string; failMsg: string } }).data;

    if (record.state === 'success') {
      try {
        return JSON.parse(record.resultJson) as Record<string, unknown>;
      } catch {
        return record as unknown as Record<string, unknown>;
      }
    }

    if (record.state === 'fail') {
      throw new Error(record.failMsg || 'kie.ai generation failed');
    }
  }

  throw new Error('kie.ai generation timed out');
}

async function generateWithKie(
  model: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const taskId = await submitKieTask(model, input, apiKey);
  return await pollKieResult(taskId, apiKey);
}

// --- fal.ai client (moved from lib/fal/client.ts) ---

function configureFal(key: string) {
  fal.config({ credentials: key });
}

async function generateWithFal(
  model: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<unknown> {
  configureFal(apiKey);
  return await fal.subscribe(model, { input, logs: true });
}

// --- IPC handler ---

// Import ALL_MODELS dynamically — this file moves to src/lib/ in the renderer migration
// For now, we need to inline the model lookup or import it
// The models registry is client-side code, so we import it from the src path

export function registerWorkflowHandlers(): void {
  ipcMain.handle('workflow:run', async (_event, params: {
    apiKey?: string;
    kieKey?: string;
    nodeId: string;
    nodeType: string;
    modelId: string;
    inputs: Record<string, unknown>;
  }) => {
    const { apiKey, kieKey, nodeId, nodeType, modelId, inputs } = params;

    // Dynamically import models registry
    // Note: This will be resolved after the src/ migration when model files are accessible
    const { ALL_MODELS } = await import('../src/lib/fal/models.js');

    const modelDef = Object.values(ALL_MODELS).find(
      (m: { id: string; altId?: string }) => m.id === modelId || m.altId === modelId,
    );

    if (!modelDef) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    let result: unknown;

    if ((modelDef as { provider?: string }).provider === 'kie') {
      const key = kieKey;
      if (!key) throw new Error('No kie.ai API key provided. Add one in Settings.');
      result = await generateWithKie(modelId, inputs, key);
    } else {
      const key = apiKey;
      if (!key) throw new Error('No fal.ai API key provided. Add one in Settings.');
      result = await generateWithFal(modelId, inputs, key);
    }

    const data = (result as Record<string, unknown>).data ?? result;
    return data;
  });

  // Job polling (replaces /api/jobs/[id])
  const jobStore = new Map<string, { status: string; result?: unknown }>();

  ipcMain.handle('workflow:poll-job', async (_event, id: string) => {
    const job = jobStore.get(id);
    if (!job) throw new Error('Job not found');
    return job;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/workflows.ts
git commit -m "feat: add workflow execution IPC handler

Migrate fal.ai and kie.ai generation logic from API route
to Electron main process IPC handler."
```

### Task 4: Create export IPC handler

**Files:**
- Create: `electron/ipc/exports.ts`

- [ ] **Step 1: Create `electron/ipc/exports.ts`**

This replaces `app/api/exports/route.ts` and `app/api/exports/[id]/route.ts`:

```ts
import { ipcMain } from 'electron';
import crypto from 'node:crypto';

interface ExportJob {
  id: string;
  status: 'queued' | 'rendering' | 'complete' | 'failed';
  progress: number;
  preset: string;
  fps: number;
  outputUrl?: string;
  fileSize?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const exportJobs = new Map<string, ExportJob>();

function simulateRender(jobId: string) {
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 15 + 5;
    const job = exportJobs.get(jobId);
    if (!job) { clearInterval(interval); return; }

    if (progress >= 100) {
      exportJobs.set(jobId, {
        ...job,
        status: 'complete',
        progress: 100,
        outputUrl: undefined, // No actual output yet — future: ffmpeg integration
        fileSize: Math.round(Math.random() * 50 + 10) * 1024 * 1024,
        completedAt: new Date().toISOString(),
      });
      clearInterval(interval);
    } else {
      exportJobs.set(jobId, { ...job, status: 'rendering', progress });
    }
  }, 1500);
}

export function registerExportHandlers(): void {
  ipcMain.handle('export:start', async (_event, params: { preset?: string; fps?: number }) => {
    const { preset = 'standard', fps = 30 } = params;
    const job: ExportJob = {
      id: crypto.randomUUID(),
      status: 'queued',
      progress: 0,
      preset,
      fps,
      createdAt: new Date().toISOString(),
    };

    exportJobs.set(job.id, job);
    simulateRender(job.id);
    return job;
  });

  ipcMain.handle('export:poll', async (_event, id: string) => {
    const job = exportJobs.get(id);
    if (!job) throw new Error('Export not found');
    return job;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/exports.ts
git commit -m "feat: add export IPC handlers

Simulated render progress, matching existing behavior."
```

### Task 5: Create elements upload IPC handler

**Files:**
- Create: `electron/ipc/elements.ts`

- [ ] **Step 1: Create `electron/ipc/elements.ts`**

This replaces `app/api/elements/upload/route.ts`:

```ts
import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';

export function registerElementHandlers(): void {
  ipcMain.handle(
    'elements:upload',
    async (_event, fileData: { buffer: ArrayBuffer; name: string; type: string }, apiKey?: string) => {
      if (!apiKey) throw new Error('No API key provided');

      fal.config({ credentials: apiKey });

      // Convert ArrayBuffer back to a File-like object for fal.storage.upload
      const blob = new Blob([fileData.buffer], { type: fileData.type });
      const file = new File([blob], fileData.name, { type: fileData.type });

      const url = await fal.storage.upload(file);
      return { url };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/elements.ts
git commit -m "feat: add elements upload IPC handler

Accept ArrayBuffer from renderer, reconstruct File for fal.ai storage upload."
```

### Task 6: Create music prompt IPC handler

**Files:**
- Create: `electron/ipc/music-prompt.ts`

- [ ] **Step 1: Create `electron/ipc/music-prompt.ts`**

This replaces `app/api/music-prompt/route.ts`:

```ts
import { ipcMain } from 'electron';
import { fal } from '@fal-ai/client';

const SYSTEM_PROMPT = `You are a music prompt engineer. Your job is to write a detailed, evocative text prompt that will be used to generate music with an AI music model (ElevenLabs/Suno).

Your prompt should describe:
- The overall mood, energy, and emotional arc
- Instrumentation and arrangement
- Genre/style characteristics
- Tempo and rhythm feel
- Any specific musical elements (builds, drops, transitions)

Keep the prompt concise but vivid (2-4 sentences). Do NOT include timestamps or section markers. Write it as a continuous description.`;

interface MusicPromptParams {
  apiKey?: string;
  frameUrls?: string[];
  style?: string;
  genre?: string;
  mood?: string;
  tempo?: string;
  additionalNotes?: string;
}

function buildUserPrompt(params: MusicPromptParams, hasVideo: boolean): string {
  const parts: string[] = [];

  if (hasVideo) {
    parts.push('I have a video that needs a music soundtrack. I\'ve attached frames from the video for you to analyze.');
    parts.push('Look at the visual content, mood, pacing, and subject matter to inform the music style.');
  }

  const prefs: string[] = [];
  if (params.genre) prefs.push(`Genre: ${params.genre}`);
  if (params.style) prefs.push(`Style: ${params.style}`);
  if (params.mood) prefs.push(`Mood: ${params.mood}`);
  if (params.tempo) prefs.push(`Tempo: ${params.tempo}`);
  if (params.additionalNotes) prefs.push(`Notes: ${params.additionalNotes}`);

  if (prefs.length > 0) {
    parts.push('User preferences:\n' + prefs.join('\n'));
  }

  parts.push('Write a music generation prompt based on this context. Output ONLY the prompt text, nothing else.');

  return parts.join('\n\n');
}

export function registerMusicPromptHandlers(): void {
  ipcMain.handle('music:generate-prompt', async (_event, params: MusicPromptParams) => {
    const key = params.apiKey;
    if (!key) throw new Error('No fal.ai API key provided.');

    fal.config({ credentials: key });

    const hasFrames = params.frameUrls && params.frameUrls.length > 0;
    const userPrompt = buildUserPrompt(params, !!hasFrames);

    const input: Record<string, unknown> = {
      model: 'google/gemini-flash-1.5',
      system_prompt: SYSTEM_PROMPT,
      prompt: userPrompt,
      max_tokens: 300,
    };

    const endpoint = hasFrames ? 'fal-ai/any-llm/vision' : 'fal-ai/any-llm';

    if (hasFrames) {
      input.image_urls = params.frameUrls;
    }

    const result = await fal.subscribe(endpoint, { input, logs: true });
    const data = result.data as Record<string, unknown>;
    const output = (data.output as string) ?? '';

    return { prompt: output.trim() };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/music-prompt.ts
git commit -m "feat: add music prompt generation IPC handler

Migrate fal.ai LLM-based music prompt generation from API route."
```

### Task 7: Create file system / dialog IPC handler

**Files:**
- Create: `electron/ipc/file-system.ts`

- [ ] **Step 1: Create `electron/ipc/file-system.ts`**

```ts
import { ipcMain, dialog, shell, BrowserWindow } from 'electron';

export function registerFileSystemHandlers(): void {
  ipcMain.handle('dialog:show-save', async (_event, options?: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showSaveDialog(win, {
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });

    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('dialog:show-open', async (_event, options?: {
    filters?: { name: string; extensions: string[] }[];
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      filters: options?.filters,
      properties: options?.properties as Array<'openFile' | 'openDirectory' | 'multiSelections'> ?? ['openFile'],
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('shell:open-path', async (_event, filePath: string) => {
    return await shell.openPath(filePath);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc/file-system.ts
git commit -m "feat: add file system dialog and shell IPC handlers"
```

---

## Chunk 3: Renderer Migration (Move Components to src/)

### Task 8: Relocate source files from Next.js layout to Vite layout

**Files:**
- Move: `components/` → `src/components/`
- Move: `lib/` → `src/lib/` (client-side files only)
- Move: `types/` → `src/types/`
- Move: `app/globals.css` → `src/styles/globals.css`
- Move: `assets/` → `src/assets/`
- Create: `src/hooks/use-electron.ts`

- [ ] **Step 1: Create src directory structure and move files**

```bash
mkdir -p src/components src/lib src/types src/styles src/hooks src/assets

# Move components
cp -R components/* src/components/

# Move client-side lib files (NOT server-only ones)
mkdir -p src/lib/workflows src/lib/editor src/lib/utils src/lib/validation src/lib/fal src/lib/kie
cp lib/workflows/topo-sort.ts src/lib/workflows/
cp lib/workflows/execute.ts src/lib/workflows/
cp lib/workflows/node-registry.ts src/lib/workflows/
cp lib/editor/timeline.ts src/lib/editor/
cp lib/editor/waveform.ts src/lib/editor/
cp lib/utils/ids.ts src/lib/utils/
cp lib/utils/api-key.ts src/lib/utils/
cp lib/validation/schemas.ts src/lib/validation/
cp lib/fal/models.ts src/lib/fal/
cp lib/kie/models.ts src/lib/kie/
# NOTE: Do NOT copy lib/export/remotion-pipeline.ts — Remotion is removed

# Move types
cp types/* src/types/

# Move CSS
cp app/globals.css src/styles/globals.css

# Move assets
cp assets/* src/assets/
```

- [ ] **Step 2: Create `src/hooks/use-electron.ts`**

```ts
export function useElectron() {
  const api = window.electronAPI;
  if (!api) throw new Error('Not running in Electron');
  return api;
}
```

- [ ] **Step 3: Update all `@/` import paths**

All imports currently using `@/components/...`, `@/lib/...`, `@/types/...` stay the same because `tsconfig.json` now maps `@/*` to `./src/*`. However, any imports of `server-only` must be removed.

Search and remove these patterns across `src/lib/`:
- `import 'server-only';` — remove entirely from any copied files

Specifically check:
- `src/lib/fal/models.ts` — should NOT have `server-only` (check and remove if present)
- `src/lib/kie/models.ts` — should NOT have `server-only` (check and remove if present)

- [ ] **Step 4: Remove `lib/config/env.ts` dependency**

The old `env.ts` used `process.env` which doesn't exist in the Vite renderer. Check if any file in `src/lib/` imports from `@/lib/config/env`. If so, remove those imports — API keys now come exclusively from `src/lib/utils/api-key.ts` (localStorage).

- [ ] **Step 5: Commit file relocation**

```bash
git add src/
git commit -m "feat: relocate components, lib, types, styles to src/

Move all client-side code to Vite renderer structure.
Remove server-only imports."
```

### Task 9: Update workspace-shell.tsx — replace fetch with IPC

**Files:**
- Modify: `src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1: Add projectId prop and replace fetch calls**

In `src/components/workspace/workspace-shell.tsx`:

Change the component signature from:
```tsx
export function WorkspaceShell() {
```
to:
```tsx
export function WorkspaceShell({ projectId, onBackToHome }: { projectId: string; onBackToHome: () => void }) {
```

Replace the load effect (lines 350-375) — change:
```tsx
    fetch('/api/project')
      .then((res) => res.json())
      .then((snapshot) => {
```
to:
```tsx
    window.electronAPI.project.load(projectId)
      .then((snapshot) => {
```

Replace the save effect (lines 390-401) — change:
```tsx
      fetch('/api/project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: { nodes: serializableNodes, edges: state.edges },
          assets: state.assets,
          mediaFolders: state.mediaFolders,
          sequence: state.sequence,
          exports: state.exports,
          elements: state.elements,
        }),
      }).catch(() => {});
```
to:
```tsx
      window.electronAPI.project.save(projectId, {
        workflow: { nodes: serializableNodes, edges: state.edges },
        assets: state.assets,
        mediaFolders: state.mediaFolders,
        sequence: state.sequence,
        exports: state.exports,
        elements: state.elements,
      }).catch(() => {});
```

Add a "Back to Projects" button in the TopTabs area — update the render to pass `onBackToHome`:
```tsx
      <TopTabs
        activeTab={state.activeTab}
        onTabChange={(tab) => wrappedDispatch({ type: 'SET_TAB', tab })}
        status={status}
        onBackToHome={onBackToHome}
      />
```

Remove the `'use client'` directive from the top of the file (no longer needed without Next.js).

- [ ] **Step 2: Commit**

```bash
git add src/components/workspace/workspace-shell.tsx
git commit -m "feat: replace workspace-shell fetch calls with IPC

Accept projectId prop, use electronAPI for load/save,
add onBackToHome callback."
```

### Task 10: Update all components that call fetch('/api/...')

**Files:**
- Modify: `src/lib/workflows/execute.ts` (line 391)
- Modify: `src/components/elements/element-generate.tsx` (line 97)
- Modify: `src/components/elements/element-image-upload.tsx` (line 17)
- Modify: `src/components/create/nodes/file-picker-node.tsx` (line 50)
- Modify: `src/components/edit/music-generation-popup.tsx` (lines 197, 304, 337)
- Modify: `src/components/create/nodes/music-prompt-node.tsx` (lines 107, 128)
- Modify: `src/components/export/export-tab.tsx` (lines 21, 41)

- [ ] **Step 1: Update `src/lib/workflows/execute.ts`**

Replace the fetch call at line 391:
```ts
const response = await fetch('/api/workflows', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: getApiKey(),
    kieKey: getKieApiKey(),
    nodeId,
    nodeType,
    modelId: effectiveModelId,
    inputs: falInputs,
  }),
});
```

With:
```ts
const result = await window.electronAPI.workflow.run({
  apiKey: getApiKey(),
  kieKey: getKieApiKey(),
  nodeId,
  nodeType,
  modelId: effectiveModelId,
  inputs: falInputs,
});
```

And replace the response parsing that follows (lines 404-438). Since `workflow.run` now returns the data directly (not a Response), change:
```ts
if (!response.ok) {
  const errorBody = await response.json().catch(() => ({}));
  const msg = errorBody.error || response.statusText || 'Generation failed';
  throw new Error(msg);
}
const result = await response.json();
```
to just use `result` directly (it was already assigned above). Keep the URL/text extraction logic that follows unchanged.

- [ ] **Step 2: Update `src/components/elements/element-generate.tsx`**

Replace the fetch call in `generateSingleImage` (around line 97):
```ts
const res = await fetch('/api/workflows', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey,
    nodeId: 'element-gen',
    nodeType: 'nano-banana-pro',
    modelId: isEdit ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro',
    inputs,
  }),
});

if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  console.error(`[element-generate] API error ${res.status}:`, err);
  return null;
}

const data = await res.json();
```

With:
```ts
const data = await window.electronAPI.workflow.run({
  apiKey,
  nodeId: 'element-gen',
  nodeType: 'nano-banana-pro',
  modelId: isEdit ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro',
  inputs,
});
```

Keep the `data?.images?.[0]?.url` extraction that follows.

- [ ] **Step 3: Update `src/components/elements/element-image-upload.tsx`**

Replace the `uploadToFal` function (lines 11-29):
```ts
async function uploadToFal(file: File): Promise<string> {
  const apiKey = getApiKey();
  const formData = new FormData();
  formData.append('file', file);
  if (apiKey) formData.append('apiKey', apiKey);

  const res = await fetch('/api/elements/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }

  const { url } = await res.json();
  return url;
}
```

With:
```ts
async function uploadToFal(file: File): Promise<string> {
  const apiKey = getApiKey();
  const buffer = await file.arrayBuffer();
  const { url } = await window.electronAPI.elements.upload(
    { buffer, name: file.name, type: file.type },
    apiKey,
  );
  return url;
}
```

- [ ] **Step 4: Update `src/components/create/nodes/file-picker-node.tsx`**

Replace the fetch portion of `uploadFile` (lines 45-57):
```ts
      const apiKey = getApiKey();
      const formData = new FormData();
      formData.append('file', file);
      if (apiKey) formData.append('apiKey', apiKey);

      const res = await fetch('/api/elements/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      const { url } = await res.json();
```

With:
```ts
      const apiKey = getApiKey();
      const buffer = await file.arrayBuffer();
      const { url } = await window.electronAPI.elements.upload(
        { buffer, name: file.name, type: file.type },
        apiKey,
      );
```

- [ ] **Step 5: Update `src/components/edit/music-generation-popup.tsx`**

Replace all three fetch calls:

**Upload frames (line 197):** Replace:
```ts
      const res = await fetch('/api/elements/upload', { method: 'POST', body: form, signal });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url as string;
```
With:
```ts
      const apiKey = getApiKey();
      const buffer = await blob.arrayBuffer();
      const result = await window.electronAPI.elements.upload(
        { buffer, name: 'frame.jpg', type: 'image/jpeg' },
        apiKey,
      );
      return result.url;
```
Also remove the `form` / `FormData` construction above it and the `signal` parameter (IPC doesn't support AbortSignal — handle abort at the caller level).

**Generate prompt (line 304):** Replace:
```ts
      const promptRes = await fetch('/api/music-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: getApiKey(),
          frameUrls: uploadedFrameUrls.length > 0 ? uploadedFrameUrls : undefined,
          genre: genre || undefined,
          style: style || undefined,
          mood: mood || undefined,
          tempo: tempo || undefined,
          additionalNotes: finalPrompt || undefined,
        }),
        signal,
      });
      if (!promptRes.ok) {
        const body = await promptRes.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to generate prompt');
      }
      const { prompt: generated } = await promptRes.json();
```
With:
```ts
      const { prompt: generated } = await window.electronAPI.music.generatePrompt({
        apiKey: getApiKey(),
        frameUrls: uploadedFrameUrls.length > 0 ? uploadedFrameUrls : undefined,
        genre: genre || undefined,
        style: style || undefined,
        mood: mood || undefined,
        tempo: tempo || undefined,
        additionalNotes: finalPrompt || undefined,
      });
```

**Generate music (line 337):** Replace:
```ts
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: getApiKey(),
          nodeId: 'timeline-music',
          nodeType: 'music',
          modelId: 'fal-ai/elevenlabs/music',
          inputs: {
            prompt: promptWithDuration,
            music_length_ms: durationMs,
            force_instrumental: instrumental,
            output_format: 'mp3_44100_128',
          },
        }),
        signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${res.status})`);
      }
      const data = await res.json();
```
With:
```ts
      const data = await window.electronAPI.workflow.run({
        apiKey: getApiKey(),
        nodeId: 'timeline-music',
        nodeType: 'music',
        modelId: 'fal-ai/elevenlabs/music',
        inputs: {
          prompt: promptWithDuration,
          music_length_ms: durationMs,
          force_instrumental: instrumental,
          output_format: 'mp3_44100_128',
        },
      });
```

- [ ] **Step 6: Update `src/components/create/nodes/music-prompt-node.tsx`**

**Upload frames (line 107):** Replace:
```ts
    const apiKey = getApiKey();
    const urls = await Promise.all(
      blobs.map(async (blob) => {
        const form = new FormData();
        form.append('file', blob, 'frame.jpg');
        if (apiKey) form.append('apiKey', apiKey);
        const res = await fetch('/api/elements/upload', { method: 'POST', body: form, signal });
        if (!res.ok) return null;
        const data = await res.json();
        return data.url as string;
      }),
    );
```
With:
```ts
    const apiKey = getApiKey();
    const urls = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const buffer = await blob.arrayBuffer();
          const result = await window.electronAPI.elements.upload(
            { buffer, name: 'frame.jpg', type: 'image/jpeg' },
            apiKey,
          );
          return result.url;
        } catch {
          return null;
        }
      }),
    );
```

**Generate prompt (line 128):** Replace:
```ts
    const res = await fetch('/api/music-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: getApiKey(),
        frameUrls: frameUrls.length > 0 ? frameUrls : undefined,
        style: style || undefined,
        genre: genre || undefined,
        mood: mood || undefined,
        tempo: tempo || undefined,
        additionalNotes: notes || undefined,
      }),
      signal: abortRef.current.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to generate prompt');
    }

    const { prompt } = await res.json();
```
With:
```ts
    const { prompt } = await window.electronAPI.music.generatePrompt({
      apiKey: getApiKey(),
      frameUrls: frameUrls.length > 0 ? frameUrls : undefined,
      style: style || undefined,
      genre: genre || undefined,
      mood: mood || undefined,
      tempo: tempo || undefined,
      additionalNotes: notes || undefined,
    });
```

- [ ] **Step 7: Update `src/components/export/export-tab.tsx`**

**Start export (line 21):** Replace:
```ts
    const res = await fetch('/api/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset, fps, sequence: state.sequence }),
    });
    const job: ExportJob = await res.json();
```
With:
```ts
    const job = await window.electronAPI.export.start({ preset, fps });
```

**Poll export (line 41):** Replace:
```ts
      const res = await fetch(`/api/exports/${activeJob.id}`);
      const updated: ExportJob = await res.json();
```
With:
```ts
      const updated = await window.electronAPI.export.poll(activeJob.id);
```

- [ ] **Step 8: Update `src/components/export/render-progress.tsx`**

Replace the `<a href download>` link (lines 44-50):
```tsx
        {job.status === 'complete' && job.outputUrl && (
          <a
            className="render-progress__download-btn"
            href={job.outputUrl}
            download
          >
            Download MP4
          </a>
        )}
```
With:
```tsx
        {job.status === 'complete' && job.outputUrl && (
          <button
            className="render-progress__download-btn"
            onClick={() => window.electronAPI.shell.openPath(job.outputUrl!)}
          >
            Open Export
          </button>
        )}
```

- [ ] **Step 9: Remove all `'use client'` directives**

Search all files in `src/components/` for `'use client'` and remove them — they're Next.js-specific and meaningless in Vite.

- [ ] **Step 10: Commit all fetch-to-IPC migrations**

```bash
git add src/
git commit -m "feat: replace all fetch('/api/...') calls with electronAPI IPC

Migrate 13 fetch call sites across 7 components and 1 lib file
to use Electron IPC via window.electronAPI bridge."
```

---

## Chunk 4: Home Screen, Splash, & Final Integration

### Task 11: Build the project gallery home screen

**Files:**
- Create: `src/components/home/home-view.tsx`
- Create: `src/components/home/project-card.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Create `src/components/home/project-card.tsx`**

```tsx
import type { ProjectMeta } from '../../../electron.d';

interface ProjectCardProps {
  project: ProjectMeta;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  return (
    <div className="home-project-card" onClick={() => onOpen(project.id)}>
      <div className="home-project-card__thumbnail">
        <span className="home-project-card__icon">&#127909;</span>
      </div>
      <div className="home-project-card__info">
        <div className="home-project-card__name">{project.name}</div>
        <div className="home-project-card__meta">
          {timeAgo(project.updatedAt)}
          {project.assetCount > 0 && <> &middot; {project.assetCount} assets</>}
        </div>
      </div>
      <button
        className="home-project-card__delete"
        onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
        title="Delete project"
      >
        &times;
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/home/home-view.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { ProjectCard } from './project-card';
import type { ProjectMeta } from '../../../electron.d';

interface HomeViewProps {
  onOpenProject: (id: string) => void;
}

export function HomeView({ onOpenProject }: HomeViewProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.electronAPI.project.list();
      setProjects(list);
    } catch (err) {
      console.error('Failed to list projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const snapshot = await window.electronAPI.project.create(trimmed);
      setNewName('');
      setShowCreate(false);
      onOpenProject(snapshot.project.id);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleDelete = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!confirm(`Delete "${project?.name ?? 'project'}"? This cannot be undone.`)) return;
    try {
      await window.electronAPI.project.delete(id);
      await loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') { setShowCreate(false); setNewName(''); }
  };

  return (
    <div className="home-view">
      <header className="home-view__header">
        <div className="home-view__brand">CINEGEN</div>
        <div className="home-view__subtitle">AI Film Production Studio</div>
      </header>

      <div className="home-view__grid">
        {/* New Project Card */}
        {!showCreate ? (
          <div
            className="home-project-card home-project-card--new"
            onClick={() => setShowCreate(true)}
          >
            <div className="home-project-card__thumbnail home-project-card__thumbnail--new">
              <span className="home-project-card__plus">+</span>
            </div>
            <div className="home-project-card__info">
              <div className="home-project-card__name">New Project</div>
            </div>
          </div>
        ) : (
          <div className="home-project-card home-project-card--creating">
            <div className="home-project-card__create-form">
              <input
                className="home-project-card__input"
                placeholder="Project name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                maxLength={100}
              />
              <div className="home-project-card__create-actions">
                <button className="home-project-card__btn home-project-card__btn--create" onClick={handleCreate}>
                  Create
                </button>
                <button className="home-project-card__btn home-project-card__btn--cancel" onClick={() => { setShowCreate(false); setNewName(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Project Cards */}
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={onOpenProject} onDelete={handleDelete} />
        ))}
      </div>

      {!loading && projects.length === 0 && (
        <div className="home-view__empty">
          Create your first project to get started
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `src/App.tsx` with real view switching**

```tsx
import { useState, useCallback } from 'react';
import { HomeView } from './components/home/home-view';
import { WorkspaceShell } from './components/workspace/workspace-shell';

type AppView = 'home' | 'workspace';

export function App() {
  const [view, setView] = useState<AppView>('home');
  const [projectId, setProjectId] = useState<string | null>(null);

  const handleOpenProject = useCallback((id: string) => {
    setProjectId(id);
    setView('workspace');
  }, []);

  const handleBackToHome = useCallback(() => {
    setProjectId(null);
    setView('home');
  }, []);

  return (
    <div className="app-root">
      {view === 'home' && <HomeView onOpenProject={handleOpenProject} />}
      {view === 'workspace' && projectId && (
        <WorkspaceShell
          key={projectId}
          projectId={projectId}
          onBackToHome={handleBackToHome}
        />
      )}
    </div>
  );
}
```

Note: The `key={projectId}` ensures WorkspaceShell fully unmounts and remounts on project switch, resetting `loadedRef` and undo history naturally.

- [ ] **Step 4: Add home screen CSS to `src/styles/globals.css`**

Append to the end of `src/styles/globals.css`:

```css
/* ============================================================
   Home View — Project Gallery
   ============================================================ */

.app-root {
  min-height: 100vh;
  background: var(--bg-void);
}

.home-view {
  min-height: 100vh;
  padding: 80px 60px 60px;
  background: var(--bg-void);
}

.home-view__header {
  text-align: center;
  margin-bottom: 48px;
}

.home-view__brand {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 4px;
}

.home-view__subtitle {
  font-family: var(--font-display);
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 4px;
  letter-spacing: 1px;
}

.home-view__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.home-view__empty {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
  margin-top: 24px;
}

.home-project-card {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--transition-fast), transform var(--transition-fast);
  position: relative;
}

.home-project-card:hover {
  border-color: var(--border-medium);
  transform: translateY(-2px);
}

.home-project-card--new {
  border-style: dashed;
  border-color: rgba(212, 160, 84, 0.3);
}

.home-project-card--new:hover {
  border-color: var(--accent);
}

.home-project-card--creating {
  border-color: var(--accent);
}

.home-project-card__thumbnail {
  aspect-ratio: 16 / 10;
  background: linear-gradient(135deg, var(--bg-elevated), var(--bg-overlay));
  display: flex;
  align-items: center;
  justify-content: center;
}

.home-project-card__thumbnail--new {
  background: transparent;
}

.home-project-card__icon {
  font-size: 28px;
  opacity: 0.6;
}

.home-project-card__plus {
  font-size: 32px;
  color: var(--accent);
  font-weight: 300;
}

.home-project-card__info {
  padding: 12px 14px;
}

.home-project-card__name {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.home-project-card__meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.home-project-card__delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.home-project-card:hover .home-project-card__delete {
  opacity: 1;
}

.home-project-card__delete:hover {
  background: var(--error);
  color: white;
}

.home-project-card__create-form {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 180px;
  justify-content: center;
}

.home-project-card__input {
  background: var(--bg-input);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 14px;
  outline: none;
}

.home-project-card__input:focus {
  border-color: var(--accent);
}

.home-project-card__create-actions {
  display: flex;
  gap: 8px;
}

.home-project-card__btn {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.home-project-card__btn--create {
  background: var(--accent);
  color: var(--bg-void);
}

.home-project-card__btn--create:hover {
  background: var(--accent-hover);
}

.home-project-card__btn--cancel {
  background: var(--bg-overlay);
  color: var(--text-secondary);
}

.home-project-card__btn--cancel:hover {
  background: var(--bg-elevated);
}
```

- [ ] **Step 5: Commit home screen**

```bash
git add src/components/home/ src/App.tsx src/styles/globals.css
git commit -m "feat: add project gallery home screen

Gallery grid with create/delete, project cards with metadata,
CINEGEN branding, dark cinematic theme."
```

### Task 12: Update TopTabs with back-to-home button

**Files:**
- Modify: `src/components/workspace/top-tabs.tsx`

- [ ] **Step 1: Add onBackToHome prop to TopTabs**

In `src/components/workspace/top-tabs.tsx`, add the `onBackToHome` prop to the component signature and render a back button:

Add to the props interface:
```ts
onBackToHome?: () => void;
```

Add a back button at the start of the tab bar (before the tab buttons):
```tsx
{onBackToHome && (
  <button className="top-nav__back" onClick={onBackToHome} title="Back to Projects">
    &#8592; Projects
  </button>
)}
```

- [ ] **Step 2: Add CSS for back button**

Add to `src/styles/globals.css`:
```css
.top-nav__back {
  background: none;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-display);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-right: 12px;
}

.top-nav__back:hover {
  color: var(--text-primary);
  border-color: var(--border-medium);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/top-tabs.tsx src/styles/globals.css
git commit -m "feat: add back-to-projects button in top navigation"
```

### Task 13: Clean up old Next.js files and finalize

**Files:**
- Delete: `app/` directory (entire)
- Delete: `components/` directory (entire, already copied to src/)
- Delete: `lib/` directory (entire, client-side copied to src/, server-only migrated to electron/)
- Delete: `types/` directory (entire, already copied to src/)
- Delete: `assets/` directory (entire, already copied to src/)
- Delete: `vitest.config.ts` (merged into vite.config.ts)
- Delete: `next.config.ts` (if not already deleted)
- Delete: `next-env.d.ts` (if not already deleted)
- Create: `electron-builder.yml`
- Create: `.gitignore` additions

- [ ] **Step 1: Delete old directories**

```bash
rm -rf app/ components/ lib/ types/ assets/ vitest.config.ts next.config.ts next-env.d.ts
```

- [ ] **Step 2: Create `electron-builder.yml`**

```yaml
appId: com.cinegen.desktop
productName: CINEGEN
directories:
  buildResources: build
  output: release
files:
  - dist/**/*
  - dist-electron/**/*
mac:
  target:
    - dmg
    - zip
  icon: build/icon.icns
  category: public.app-category.video
extraResources:
  - from: electron/splash.html
    to: splash.html
dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
```

- [ ] **Step 3: Update `.gitignore`**

Add these entries:
```
dist/
dist-electron/
release/
.superpowers/
```

- [ ] **Step 4: Download and bundle fonts for offline use**

Download Outfit (300-700 weights) and Space Mono (400, 700) as WOFF2 files.

```bash
mkdir -p src/styles/fonts
```

Add `@font-face` declarations at the top of `src/styles/globals.css` (before the `:root` block):
```css
@font-face {
  font-family: 'Outfit';
  src: url('./fonts/Outfit-Variable.woff2') format('woff2');
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Space Mono';
  src: url('./fonts/SpaceMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Space Mono';
  src: url('./fonts/SpaceMono-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

Download the font files from Google Fonts and place them in `src/styles/fonts/`.

- [ ] **Step 5: Full build and launch test**

```bash
npm run build
npx electron .
```

Expected:
1. Splash window appears (600x400, centered, frameless) with CINEGEN branding and loading animation
2. After ~2.5s, splash closes and main window opens maximized
3. Home screen shows with CINEGEN branding and "New Project" card
4. Clicking "New Project" → enter name → Create → workspace loads
5. Workspace shows all 4 tabs (Elements, Create, Edit, Export)
6. "Back to Projects" button returns to home
7. Previously created project appears in gallery

- [ ] **Step 6: Commit cleanup and finalization**

```bash
git add -A
git commit -m "feat: complete Electron conversion

Remove all Next.js files, add electron-builder config,
bundle fonts, finalize project structure."
```

### Task 14: Data migration for existing project

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add legacy data migration on first launch**

Add to `electron/main.ts`, after IPC handler registration:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

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
```

Call `migrateLegacyData()` inside the `app.whenReady()` callback, before creating windows.

- [ ] **Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat: add legacy .data/dev/project.json migration

Automatically migrates existing single-project data to
~/Documents/CINEGEN/ on first launch."
```

---

## Summary

| Chunk | Tasks | What It Delivers |
|-------|-------|-----------------|
| 1: Scaffold | Tasks 1 | Working Electron app shell with splash, build system, placeholder UI |
| 2: IPC Handlers | Tasks 2-7 | All server logic migrated to main process IPC |
| 3: Renderer Migration | Tasks 8-10 | All components relocated, all fetch→IPC done |
| 4: Home & Final | Tasks 11-14 | Project gallery, back button, cleanup, data migration |

After completing all tasks, the app should launch as a standalone Electron desktop application with:
- Splash screen with CINEGEN branding
- Project gallery home screen (create, open, delete projects)
- Full workspace with all existing functionality (Elements, Create, Edit, Export tabs)
- Offline-capable (fonts bundled, no server dependency)
- Packageable as .app/.dmg via electron-builder
