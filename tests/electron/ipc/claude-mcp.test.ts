// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ root: '', handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({ app: { getAppPath: () => state.root, getPath: () => join(state.root, 'userdata') }, ipcMain: { handle: (key: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(key, handler) }, shell: { showItemInFolder: vi.fn() } }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => state.root }));
import { registerClaudeMcp } from '../../../electron/ipc/claude-mcp';
const call = (name: string) => state.handlers.get(`claude-mcp:${name}`)!();
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'cinegen-setup-test-'));
  mkdirSync(join(state.root, 'dist-electron'));
  writeFileSync(join(state.root, 'dist-electron', 'cinegen-mcp.cjs'), `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({id:1,result:{tools:[{name:'cinegen_project'}]}})+'\\n'));`);
  state.handlers.clear(); registerClaudeMcp();
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
describe.skipIf(process.platform !== 'darwin')('Claude MCP setup IPC', () => {
  it('checks the runtime, installs a standalone server and writes a working entry', async () => {
    expect(call('status')).toMatchObject({ configured: false, serverAvailable: true });
    expect(await call('setup')).toMatchObject({ configured: true, needsRepair: false });
    const config = JSON.parse(readFileSync(join(state.root, 'Library/Application Support/Claude/claude_desktop_config.json'), 'utf8'));
    expect(config.mcpServers.cinegen.command).toBe(process.execPath);
    expect(config.mcpServers.cinegen.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(config.mcpServers.cinegen.args).toEqual([join(state.root, 'userdata/mcp/cinegen-mcp.cjs')]);
    writeFileSync(join(state.root, 'userdata/mcp/cinegen-mcp.cjs'), 'old');
    expect(call('status')).toMatchObject({ needsRepair: true });
    expect(await call('setup')).toMatchObject({ needsRepair: false });
    expect(await call('remove')).toMatchObject({ configured: false });
  });
  it('does not write Claude config when the bundled server cannot start', async () => {
    writeFileSync(join(state.root, 'dist-electron/cinegen-mcp.cjs'), 'throw new Error("broken");');
    await expect(call('setup')).rejects.toThrow(/could not start/);
    expect(call('status')).toMatchObject({ configured: false });
  });
});
