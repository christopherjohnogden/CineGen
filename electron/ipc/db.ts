import { ipcMain } from 'electron';
import {
  ProjectDatabase,
  ensureProjectDirs,
  generateId,
  timestamp,
  projectsRoot,
  projectDir,
} from '../db/database.js';
import * as pdb from '../db/project-db.js';
import type { ProjectRow, FullProjectState } from '../db/project-db.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// ProjectMeta — entry in projects.json index
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Connection cache — one ProjectDatabase per open project
// ---------------------------------------------------------------------------

const dbCache = new Map<string, ProjectDatabase>();

export function getDb(projectId: string): ProjectDatabase {
  let db = dbCache.get(projectId);
  if (!db) {
    db = new ProjectDatabase(projectId);
    dbCache.set(projectId, db);
  }
  return db;
}

// ---------------------------------------------------------------------------
// projects.json helpers
// ---------------------------------------------------------------------------

function indexPath(): string {
  return path.join(projectsRoot(), 'projects.json');
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
  await fs.mkdir(projectsRoot(), { recursive: true });
  await fs.writeFile(indexPath(), JSON.stringify(index, null, 2), 'utf-8');
}

async function upsertIndexEntry(meta: ProjectMeta): Promise<void> {
  const index = await readIndex();
  const existing = index.projects.findIndex((p) => p.id === meta.id);
  if (existing >= 0) {
    index.projects[existing] = meta;
  } else {
    index.projects.push(meta);
  }
  await writeIndex(index);
}

async function removeIndexEntry(id: string): Promise<void> {
  const index = await readIndex();
  index.projects = index.projects.filter((p) => p.id !== id);
  await writeIndex(index);
}

// ---------------------------------------------------------------------------
// Register all db:* IPC handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resolve thumbnail for a SQLite project — returns a file:// URI or null
// ---------------------------------------------------------------------------

function resolveThumbnail(projectId: string): string | null {
  try {
    const db = getDb(projectId);

    // 1st priority: first video/image clip on the timeline (by start_time)
    const fromClip = db.queryOne<{ thumbnail_url: string }>(
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
      [projectId],
    );
    if (fromClip?.thumbnail_url) {
      return `file://${fromClip.thumbnail_url}`;
    }

    // 2nd priority: any asset in the project that has a thumbnail (backfill)
    const fromAsset = db.queryOne<{ thumbnail_url: string }>(
      `SELECT thumbnail_url FROM assets
       WHERE project_id = ?
         AND type IN ('video', 'image')
         AND thumbnail_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [projectId],
    );
    if (fromAsset?.thumbnail_url) {
      return `file://${fromAsset.thumbnail_url}`;
    }
  } catch {
    // Project may not have a DB yet — silently return null
  }
  return null;
}

export function registerDbHandlers(): void {
  // -------------------------------------------------------------------------
  // db:project:create — creates dirs, opens DB, inserts project row + default
  // timeline, updates projects.json index. Returns FullProjectState.
  // -------------------------------------------------------------------------
  ipcMain.handle('db:project:create', async (_event, name: string) => {
    const id = generateId();
    const now = timestamp();

    // Ensure project directories exist (also called inside ProjectDatabase
    // constructor, but we call it explicitly here for clarity).
    ensureProjectDirs(id);

    const db = getDb(id);

    // Insert project row
    const projectRow: ProjectRow = {
      id,
      name,
      created_at: now,
      updated_at: now,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24,
    };
    pdb.insertProject(db, projectRow);

    // Create a default timeline with one video track and one audio track
    const timelineId = generateId();
    pdb.insertTimeline(db, {
      id: timelineId,
      project_id: id,
      name: 'Timeline 1',
      duration: 0,
      created_at: now,
    });

    pdb.upsertTrack(db, {
      id: generateId(),
      timeline_id: timelineId,
      name: 'Video 1',
      kind: 'video',
      color: '#4A90D9',
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 0,
    });

    pdb.upsertTrack(db, {
      id: generateId(),
      timeline_id: timelineId,
      name: 'Audio 1',
      kind: 'audio',
      color: '#7ED321',
      muted: 0,
      solo: 0,
      locked: 0,
      visible: 1,
      volume: 1,
      sort_order: 1,
    });

    // Update projects.json index
    await upsertIndexEntry({
      id,
      name,
      createdAt: now,
      updatedAt: now,
      assetCount: 0,
      elementCount: 0,
      thumbnail: null,
      useSqlite: true,
    });

    return pdb.loadFullProject(db, id);
  });

  // -------------------------------------------------------------------------
  // db:project:load — opens DB (cached) and returns FullProjectState
  // -------------------------------------------------------------------------
  ipcMain.handle('db:project:load', async (_event, id: string) => {
    const db = getDb(id);
    const state = pdb.loadFullProject(db, id);

    // Check for broken links — validate local file references on disk
    // Persist status changes back to the database
    for (const asset of state.assets) {
      if (asset.file_ref && !asset.source_url) {
        const prevStatus = asset.status;
        if (fsSync.existsSync(asset.file_ref)) {
          if (asset.status === 'offline') {
            asset.status = 'online';
          }
        } else {
          asset.status = 'offline';
        }
        if (asset.status !== prevStatus) {
          pdb.updateAsset(db, asset.id, { status: asset.status });
        }
      }
    }

    return state;
  });

  // -------------------------------------------------------------------------
  // db:project:save — persists state, updates index metadata
  // -------------------------------------------------------------------------
  ipcMain.handle('db:project:save', async (_event, id: string, state: FullProjectState) => {
    const db = getDb(id);
    pdb.saveFullProject(db, id, state);

    const now = timestamp();
    const index = await readIndex();
    const entry = index.projects.find((p) => p.id === id);
    if (entry) {
      entry.name = state.project.name;
      entry.updatedAt = now;
      entry.assetCount = state.assets.length;
      entry.elementCount = state.elements.length;
      await writeIndex(index);
    }

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // db:project:delete — closes DB, removes project directory, updates index
  // -------------------------------------------------------------------------
  ipcMain.handle('db:project:delete', async (_event, id: string) => {
    const db = dbCache.get(id);
    if (db) {
      db.close();
      dbCache.delete(id);
    }

    const dir = projectDir(id);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[db:project:delete] Failed to remove directory ${dir}:`, err);
    }

    await removeIndexEntry(id);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // db:project:close — closes DB connection and removes from cache
  // -------------------------------------------------------------------------
  ipcMain.handle('db:project:close', async (_event, id: string) => {
    const db = dbCache.get(id);
    if (db) {
      db.close();
      dbCache.delete(id);
    }
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // db:project:update — updates individual project fields
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'db:project:update',
    async (_event, id: string, data: Partial<Omit<ProjectRow, 'id'>>) => {
      const db = getDb(id);
      pdb.updateProject(db, id, data);
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // db:asset:insert — inserts a new asset row
  // -------------------------------------------------------------------------
  ipcMain.handle('db:asset:insert', async (_event, asset: pdb.AssetRow) => {
    const db = getDb(asset.project_id);
    pdb.insertAsset(db, asset);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // db:asset:update — updates fields on an existing asset
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'db:asset:update',
    async (
      _event,
      projectId: string,
      id: string,
      data: Partial<Omit<pdb.AssetRow, 'id'>>,
    ) => {
      const db = getDb(projectId);
      pdb.updateAsset(db, id, data);
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // db:asset:delete — removes an asset row
  // -------------------------------------------------------------------------
  ipcMain.handle('db:asset:delete', async (_event, projectId: string, id: string) => {
    const db = getDb(projectId);
    pdb.deleteAsset(db, id);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// closeAllDbs — call on app before-quit to flush all open connections
// ---------------------------------------------------------------------------

export function closeAllDbs(): void {
  for (const [id, db] of dbCache) {
    try {
      db.close();
    } catch (err) {
      console.error(`[closeAllDbs] Failed to close DB for project ${id}:`, err);
    }
  }
  dbCache.clear();
}
