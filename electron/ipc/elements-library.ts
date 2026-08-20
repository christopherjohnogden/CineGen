import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { projectsRoot } from '../db/database.js';
import {
  emptyElementsLibrary,
  migrateProjectsIntoLibrary,
  normalizeLibrary,
  syncProjectFolder,
  type ProjectElementsDump,
} from '../../src/lib/elements/library.js';
import type { ElementsLibrary } from '../../src/types/elements.js';

function libraryPath(): string {
  return path.join(projectsRoot(), 'elements-library.json');
}

function indexPath(): string {
  return path.join(projectsRoot(), 'projects.json');
}

function projectDir(id: string): string {
  return path.join(projectsRoot(), id);
}

async function writeLibrary(library: ElementsLibrary): Promise<void> {
  await fs.mkdir(projectsRoot(), { recursive: true });
  const file = libraryPath();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(library, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

async function readLibraryFile(): Promise<ElementsLibrary | null> {
  try {
    const raw = await fs.readFile(libraryPath(), 'utf-8');
    return normalizeLibrary(JSON.parse(raw));
  } catch {
    return null;
  }
}

interface IndexEntry {
  id: string;
  name: string;
  useSqlite?: boolean;
}

function collectProjectElements(entry: IndexEntry): ProjectElementsDump {
  const sqlitePath = path.join(projectDir(entry.id), 'project.db');
  const jsonPath = path.join(projectDir(entry.id), 'project.json');

  if (entry.useSqlite || fsSync.existsSync(sqlitePath)) {
    try {
      const db = new Database(sqlitePath, { readonly: true });
      const rows = db.prepare('SELECT * FROM elements').all() as unknown[];
      db.close();
      return { id: entry.id, name: entry.name, elements: rows };
    } catch {
      return { id: entry.id, name: entry.name, elements: [] };
    }
  }

  if (fsSync.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fsSync.readFileSync(jsonPath, 'utf-8')) as { elements?: unknown[] };
      return { id: entry.id, name: entry.name, elements: Array.isArray(data.elements) ? data.elements : [] };
    } catch {
      return { id: entry.id, name: entry.name, elements: [] };
    }
  }

  return { id: entry.id, name: entry.name, elements: [] };
}

async function migrateIfNeeded(): Promise<ElementsLibrary> {
  const existing = await readLibraryFile();
  if (existing) return existing;

  let projects: IndexEntry[] = [];
  try {
    const index = JSON.parse(await fs.readFile(indexPath(), 'utf-8')) as { projects?: IndexEntry[] };
    projects = Array.isArray(index.projects) ? index.projects : [];
  } catch {
    projects = [];
  }

  const dumps = projects.map(collectProjectElements);
  const library = migrateProjectsIntoLibrary(null, dumps);
  await writeLibrary(library);
  return library;
}

export function registerElementsLibraryHandlers(): void {
  ipcMain.handle(
    'elements-library:load',
    async (_event, opts?: { projectId?: string; projectName?: string }) => {
      let library = await migrateIfNeeded();
      if (opts?.projectId && opts.projectName) {
        const next = syncProjectFolder(library, opts.projectId, opts.projectName);
        if (next !== library) {
          await writeLibrary(next);
          library = next;
        }
      }
      return library;
    },
  );

  ipcMain.handle('elements-library:save', async (_event, raw: unknown) => {
    const library = normalizeLibrary(raw);
    await writeLibrary(library);
    return library;
  });
}

export { emptyElementsLibrary };
