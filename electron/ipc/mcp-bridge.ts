import { ipcMain, type BrowserWindow } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * The loopback bridge an MCP client uses to drive the running app.
 *
 * The app's data lives in the renderer's workspace state, and generation needs
 * this process's provider credentials, so the bridge is a thin forwarder: it
 * accepts a tool call over 127.0.0.1, hands it to the renderer, and returns what
 * comes back. Everything a tool can do is something the UI can already do.
 *
 * It is bound to the loopback interface and gated on a token written to a
 * 0600 file, so only a process running as this user can reach it.
 */

const INVOKE_TIMEOUT_MS = 120_000;
const DISCOVERY_DIR = join(homedir(), 'Documents', 'CINEGEN');
const DISCOVERY_FILE = join(DISCOVERY_DIR, 'mcp-bridge.json');

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
/** True while a project workspace is mounted and able to answer tool calls. */
let workspaceReady = false;
let server: Server | null = null;
let token = '';

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A script or shot list is the biggest thing a tool takes.
    if (size > 4_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Ask the renderer to run a tool and wait for its answer. */
function invokeRenderer(win: BrowserWindow, tool: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CineGen did not answer "${tool}" within ${Math.round(INVOKE_TIMEOUT_MS / 1000)}s.`));
    }, INVOKE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send('mcp:invoke', { id, tool, args });
  });
}

export function registerMcpBridge(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('mcp:ready', (_event, ready: unknown) => {
    workspaceReady = Boolean(ready);
  });

  ipcMain.on('mcp:result', (_event, payload: { id?: string; ok?: boolean; result?: unknown; error?: string }) => {
    const entry = payload?.id ? pending.get(payload.id) : undefined;
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(payload.id as string);
    if (payload.ok) entry.resolve(payload.result);
    else entry.reject(new Error(payload.error || 'The tool failed.'));
  });

  ipcMain.handle('mcp:status', () => ({
    running: Boolean(server),
    workspaceReady,
    port: server ? (server.address() as { port: number } | null)?.port ?? 0 : 0,
    discoveryFile: DISCOVERY_FILE,
  }));

  token = randomBytes(24).toString('hex');
  server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');

        if (req.method === 'GET' && url.pathname === '/health') {
          json(res, 200, { ok: true, app: 'CineGen', appReady: Boolean(getWindow()) });
          return;
        }

        const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        // Constant-time-ish: compare fixed-length hex strings of equal size.
        if (provided.length !== token.length || provided !== token) {
          json(res, 401, { ok: false, error: 'Bad or missing bridge token.' });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/invoke') {
          const body = await readBody(req) as { tool?: string; args?: unknown };
          const tool = typeof body?.tool === 'string' ? body.tool : '';
          if (!tool) {
            json(res, 400, { ok: false, error: 'No tool named.' });
            return;
          }
          const win = getWindow();
          if (!win || win.isDestroyed()) {
            json(res, 503, { ok: false, error: 'CineGen has no open window. Open the app and try again.' });
            return;
          }
          // Without a project open there is nothing to act on, and no listener:
          // say so now rather than making the caller wait out the timeout.
          if (!workspaceReady && tool !== 'cinegen_project') {
            json(res, 200, { ok: false, error: 'No CineGen project is open. Open a project in the app, then try again.' });
            return;
          }
          try {
            json(res, 200, { ok: true, result: await invokeRenderer(win, tool, body.args ?? {}) });
          } catch (error) {
            json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }

        json(res, 404, { ok: false, error: 'Unknown path.' });
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  server.listen(0, '127.0.0.1', () => {
    const port = (server?.address() as { port: number } | null)?.port ?? 0;
    try {
      mkdirSync(DISCOVERY_DIR, { recursive: true });
      writeFileSync(
        DISCOVERY_FILE,
        `${JSON.stringify({ port, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
        { mode: 0o600 },
      );
      console.log(`[mcp-bridge] listening on 127.0.0.1:${port}`);
    } catch (error) {
      console.error('[mcp-bridge] could not publish the discovery file:', error);
    }
  });

  server.on('error', (error) => {
    console.error('[mcp-bridge] server error:', error);
  });
}

export function stopMcpBridge(): void {
  workspaceReady = false;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error('CineGen is closing.'));
  }
  pending.clear();
  server?.close();
  server = null;
  try {
    rmSync(DISCOVERY_FILE, { force: true });
  } catch {
    // The file is a convenience; leaving a stale one behind is harmless.
  }
}
