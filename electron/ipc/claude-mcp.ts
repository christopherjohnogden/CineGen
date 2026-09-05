import { app, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readClaudeConfig, cinegenEntry, matchesEntry, updateClaudeConfig, type ClaudeMcpEntry } from '../lib/claude-mcp-config';

const execute = promisify(execFile);
function paths() {
  return {
    config: join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    source: join(app.getAppPath(), 'dist-electron', 'cinegen-mcp.cjs'),
    installed: join(app.getPath('userData'), 'mcp', 'cinegen-mcp.cjs'),
  };
}
function entry(): ClaudeMcpEntry {
  return { command: process.execPath, args: [paths().installed], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
function supported() {
  if (process.platform !== 'darwin') throw new Error('Automatic Claude Desktop setup is currently available on Mac.');
  if (process.execPath.includes('/AppTranslocation/') || process.execPath.startsWith('/Volumes/')) {
    throw new Error('Move CineGen to Applications and open it there before connecting Claude.');
  }
}
async function testRuntime(script: string) {
  // Protocol discovery only: never submits generation or project operations.
  const code = `const {spawn}=require('node:child_process');const p=spawn(process.execPath,[process.argv[1]],{env:process.env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.setEncoding('utf8');p.stdout.on('data',x=>out+=x);p.stderr.on('data',()=>{});p.on('error',()=>process.exit(1));p.on('close',c=>{try{const r=out.trim().split('\\n').map(JSON.parse);if(c!==0||!r.some(x=>x.result?.tools?.some(t=>t.name==='cinegen_project')))process.exit(1);console.log('ready');}catch{process.exit(1)}});p.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\\n');`;
  try {
    await execute(process.execPath, ['-e', code, script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10_000, maxBuffer: 128_000,
    });
  } catch { throw new Error('CineGen’s bundled MCP server could not start. Reinstall the latest Mac build and try again.'); }
}
function status() {
  const p = paths();
  const config = readClaudeConfig(p.config).config;
  const existing = cinegenEntry(config);
  const currentScript = existsSync(p.source) && existsSync(p.installed)
    && readFileSync(p.source).equals(readFileSync(p.installed));
  return {
    supported: process.platform === 'darwin',
    configured: Boolean(existing),
    needsRepair: Boolean(existing) && (!matchesEntry(existing, entry()) || !currentScript),
    serverAvailable: existsSync(p.source),
    configPath: p.config,
  };
}
export function registerClaudeMcp(): void {
  ipcMain.handle('claude-mcp:status', () => status());
  ipcMain.handle('claude-mcp:setup', async () => {
    supported();
    const p = paths();
    // Validate before touching either the existing server or Claude settings.
    readClaudeConfig(p.config);
    if (!existsSync(p.source)) throw new Error('This build is missing the MCP server. Install the latest CineGen Mac build.');
    await testRuntime(p.source);
    mkdirSync(join(app.getPath('userData'), 'mcp'), { recursive: true });
    writeFileSync(p.installed, readFileSync(p.source), { mode: 0o600 });
    const result = updateClaudeConfig(p.config, entry());
    return { ...status(), ...result };
  });
  ipcMain.handle('claude-mcp:remove', () => {
    supported();
    const result = updateClaudeConfig(paths().config, null);
    return { ...status(), ...result };
  });
  ipcMain.handle('claude-mcp:reveal', () => {
    supported();
    if (!existsSync(paths().config)) throw new Error('Connect Claude Desktop first to create its configuration.');
    shell.showItemInFolder(paths().config);
  });
}
