import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

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
  useSqlite?: boolean;
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
  const defaultSpace = {
    id: generateId(),
    name: 'Space 1',
    createdAt: now,
    nodes: [],
    edges: [],
  };
  return {
    project: { id, name, createdAt: now, updatedAt: now },
    workflow: { nodes: [], edges: [] },
    spaces: [defaultSpace],
    activeSpaceId: defaultSpace.id,
    openSpaceIds: [defaultSpace.id],
    sequence: { id: 'default', tracks: [{ id: 'track-1', name: 'Track 1', clips: [] }], duration: 0 },
    assets: [],
    mediaFolders: [],
    exports: [],
    elements: [],
  };
}

function resolveLegacyThumbnail(projectId: string): string | null {
  const jsonPath = path.join(projectDir(projectId), 'project.json');
  if (!fsSync.existsSync(jsonPath)) return null;
  try {
    const raw = fsSync.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(raw) as { assets?: Array<{ type?: string; thumbnailUrl?: string }> };
    const asset = (data.assets ?? []).find(
      (a) => (a.type === 'video' || a.type === 'image') && a.thumbnailUrl,
    );
    return asset?.thumbnailUrl ?? null;
  } catch {
    return null;
  }
}

function resolveSqliteThumbnail(projectId: string): string | null {
  const dbPath = path.join(projectDir(projectId), 'project.db');
  if (!fsSync.existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });

    // 1st priority: first video/image clip on the timeline (by start_time)
    const fromClip = db.prepare(
      `SELECT a.thumbnail_url
       FROM clips c
       JOIN tracks t ON t.id = c.track_id
       JOIN timelines tl ON tl.id = t.timeline_id
       JOIN assets a ON a.id = c.asset_id
       WHERE tl.project_id = ?
         AND t.kind = 'video'
         AND a.type IN ('video', 'image')
         AND a.thumbnail_url IS NOT NULL
       ORDER BY c.start_time ASC
       LIMIT 1`,
    ).get(projectId) as { thumbnail_url: string } | undefined;

    if (fromClip?.thumbnail_url) {
      db.close();
      return `file://${fromClip.thumbnail_url}`;
    }

    // 2nd priority: any asset with a thumbnail (backfills projects with no clips)
    const fromAsset = db.prepare(
      `SELECT thumbnail_url FROM assets
       WHERE project_id = ?
         AND type IN ('video', 'image')
         AND thumbnail_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    ).get(projectId) as { thumbnail_url: string } | undefined;

    db.close();
    return fromAsset?.thumbnail_url ? `file://${fromAsset.thumbnail_url}` : null;
  } catch {
    return null;
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', async () => {
    const index = await readIndex();
    // Hydrate live thumbnails for all projects
    return index.projects.map((p) => {
      const thumbnail = p.useSqlite
        ? resolveSqliteThumbnail(p.id)
        : resolveLegacyThumbnail(p.id);
      return { ...p, thumbnail };
    });
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
