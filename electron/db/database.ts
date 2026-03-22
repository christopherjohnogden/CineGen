import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database, RunResult } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { SCHEMA_SQL, INDEXES_SQL } from './schema.js';

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

export function projectsRoot(): string {
  return path.join(os.homedir(), 'Documents', 'CINEGEN');
}

export function projectDir(id: string): string {
  return path.join(projectsRoot(), id);
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Creates the full directory structure for a project.
 *
 *   ~/Documents/CINEGEN/{id}/
 *   ├── media/generated/
 *   ├── media/imported/
 *   ├── .cache/thumbnails/
 *   ├── .cache/filmstrips/
 *   ├── .cache/waveforms/
 *   └── .cache/proxies/
 */
export function ensureProjectDirs(id: string): void {
  const root = projectDir(id);
  const dirs = [
    path.join(root, 'media', 'generated'),
    path.join(root, 'media', 'imported'),
    path.join(root, '.cache', 'thumbnails'),
    path.join(root, '.cache', 'filmstrips'),
    path.join(root, '.cache', 'waveforms'),
    path.join(root, '.cache', 'proxies'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// ProjectDatabase class
// ---------------------------------------------------------------------------

export class ProjectDatabase {
  private readonly db: BetterSqlite3Database;

  constructor(projectId: string) {
    ensureProjectDirs(projectId);
    const dbPath = path.join(projectDir(projectId), 'project.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  /**
   * Runs SCHEMA_SQL and INDEXES_SQL to create all tables and indexes if they
   * do not already exist.
   */
  initSchema(): void {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(INDEXES_SQL);
  }

  /**
   * Executes a SELECT query and returns all matching rows typed as T.
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params ?? [])) as T[];
  }

  /**
   * Executes a SELECT query and returns the first matching row typed as T,
   * or undefined if no rows match.
   */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(params ?? [])) as T | undefined;
  }

  /**
   * Executes an INSERT / UPDATE / DELETE statement and returns the RunResult.
   */
  run(sql: string, params?: unknown[]): RunResult {
    const stmt = this.db.prepare(sql);
    return stmt.run(...(params ?? []));
  }

  /**
   * Wraps the provided function in a SQLite transaction. The transaction is
   * committed on success and rolled back on exception.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Closes the underlying database connection.
   */
  close(): void {
    this.db.close();
  }
}
