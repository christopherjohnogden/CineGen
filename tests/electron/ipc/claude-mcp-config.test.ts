// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateClaudeConfig, readClaudeConfig, matchesEntry } from '../../../electron/lib/claude-mcp-config';
let dir: string;
let file: string;
const entry = { command: '/Applications/CineGen.app/Contents/MacOS/CineGen', args: ['/Library/CineGen/mcp.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cinegen-config-test-')); file = join(dir, 'claude.json'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe('Claude MCP configuration', () => {
  it('preserves other servers and preferences and makes a private exact backup', () => {
    const original = JSON.stringify({ preferences: { theme: 'dark' }, mcpServers: { other: { command: 'other' }, cinegen: { command: 'old' } } });
    writeFileSync(file, original);
    const { backupPath } = updateClaudeConfig(file, entry);
    expect(readFileSync(backupPath!, 'utf8')).toBe(original);
    expect(statSync(backupPath!).mode & 0o777).toBe(0o600);
    expect(readClaudeConfig(file).config).toEqual({ preferences: { theme: 'dark' }, mcpServers: { other: { command: 'other' }, cinegen: entry } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it('creates a missing configuration and makes repeated setup safe', () => {
    updateClaudeConfig(file, entry); updateClaudeConfig(file, entry);
    expect(readClaudeConfig(file).config).toEqual({ mcpServers: { cinegen: entry } });
  });
  it('refuses malformed JSON without changing it', () => {
    writeFileSync(file, '{broken');
    expect(() => updateClaudeConfig(file, entry)).toThrow(/not valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
  it('refuses a non-object server map', () => {
    writeFileSync(file, '{"mcpServers":[]}');
    expect(() => updateClaudeConfig(file, entry)).toThrow(/unexpected format/);
  });
  it('disconnects only CineGen', () => {
    writeFileSync(file, JSON.stringify({ mcpServers: { cinegen: entry, other: { command: 'other' } }, preferences: { x: 1 } }));
    updateClaudeConfig(file, null);
    expect(readClaudeConfig(file).config).toEqual({ mcpServers: { other: { command: 'other' } }, preferences: { x: 1 } });
  });
  it('detects outdated paths and missing runtime environment', () => {
    expect(matchesEntry(entry, entry)).toBe(true);
    expect(matchesEntry({ ...entry, command: 'node' }, entry)).toBe(false);
    expect(matchesEntry({ ...entry, env: {} }, entry)).toBe(false);
  });
});
