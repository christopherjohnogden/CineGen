import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

type JsonObject = Record<string, unknown>;
export interface ClaudeMcpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}
function object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function readClaudeConfig(path: string): { raw: string | null; config: JsonObject } {
  if (!existsSync(path)) return { raw: null, config: {} };
  const raw = readFileSync(path, 'utf8');
  let config: unknown;
  try { config = JSON.parse(raw); } catch {
    throw new Error('Claude’s configuration is not valid JSON. Fix it in Claude → Settings → Developer → Edit Config, then try again. No changes were made.');
  }
  if (!object(config) || (config.mcpServers !== undefined && !object(config.mcpServers))) {
    throw new Error('Claude’s configuration has an unexpected format. No changes were made.');
  }
  return { raw, config };
}
export function cinegenEntry(config: JsonObject): unknown {
  return object(config.mcpServers) ? config.mcpServers.cinegen : undefined;
}
export function matchesEntry(value: unknown, expected: ClaudeMcpEntry): boolean {
  if (!object(value) || !object(value.env)) return false;
  const env = value.env;
  return value.command === expected.command
    && JSON.stringify(value.args) === JSON.stringify(expected.args)
    && Object.entries(expected.env).every(([key, val]) => env[key] === val);
}

/** Merge only CineGen; preserve every other server and preference, and keep a private backup. */
export function updateClaudeConfig(path: string, entry: ClaudeMcpEntry | null): { backupPath?: string } {
  const before = readClaudeConfig(path);
  const servers = { ...(before.config.mcpServers as JsonObject | undefined) };
  if (entry) servers.cinegen = entry;
  else delete servers.cinegen;
  if (!entry && !cinegenEntry(before.config)) return {};
  const next = { ...before.config, mcpServers: servers };
  mkdirSync(dirname(path), { recursive: true });
  const backupPath = before.raw === null ? undefined : `${path}.cinegen-backup-${Date.now()}-${randomUUID()}`;
  const temp = `${path}.cinegen-${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const latest = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (latest !== before.raw) throw new Error('Claude’s configuration changed during setup. Try again.');
    if (backupPath) { copyFileSync(path, backupPath); chmodSync(backupPath, 0o600); }
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
  return { backupPath };
}
