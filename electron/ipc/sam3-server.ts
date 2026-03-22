import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const SAM3_REPO = path.join(os.homedir(), 'Desktop', 'Coding', 'Sam3');
const SAM3_PYTHON = path.join(SAM3_REPO, '.venv', 'bin', 'python');
const SAM3_SCRIPT = path.join(SAM3_REPO, 'cinegen_server.py');

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_MAX_ATTEMPTS = 60; // 30 seconds max wait for startup

class Sam3ServerManager {
  private proc: ChildProcess | null = null;
  private port = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  async start(): Promise<number> {
    if (this.proc && !this.proc.killed) {
      return this.port;
    }

    this.port = await this.findFreePort();
    console.log(`[sam3] Starting server on port ${this.port}`);

    this.proc = spawn(SAM3_PYTHON, [SAM3_SCRIPT, '--port', String(this.port)], {
      cwd: SAM3_REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: '1',
      },
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      console.log('[sam3-stdout]', chunk.toString().trim());
    });
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) console.log('[sam3-stderr]', msg);
    });

    this.proc.on('exit', (code) => {
      console.log(`[sam3] Server exited with code ${code}`);
      this.proc = null;
    });

    // Wait for health endpoint
    await this.waitForHealth();
    this.resetIdleTimer();

    console.log('[sam3] Server ready');
    return this.port;
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.proc && !this.proc.killed) {
      console.log('[sam3] Stopping server');
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  async ensureRunning(): Promise<number> {
    if (this.isRunning()) {
      this.resetIdleTimer();
      return this.port;
    }
    return this.start();
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  getPort(): number {
    return this.port;
  }

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log('[sam3] Idle timeout — stopping server');
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error('Could not find free port'));
        }
      });
    });
  }

  private async waitForHealth(): Promise<void> {
    console.log(`[sam3] Waiting for health on port ${this.port}...`);
    for (let i = 0; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (res.ok) {
          console.log(`[sam3] Health check passed after ${i + 1} attempts`);
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    console.error('[sam3] Health check timed out after 30 seconds');
    throw new Error('SAM 3 server failed to start within 30 seconds');
  }
}

const manager = new Sam3ServerManager();

export function registerSam3Handlers(): void {
  ipcMain.handle('sam3:start', async () => {
    const port = await manager.ensureRunning();
    return { port };
  });

  ipcMain.handle('sam3:stop', async () => {
    await manager.stop();
  });

  ipcMain.handle('sam3:port', () => {
    return { port: manager.getPort(), running: manager.isRunning() };
  });
}

export function stopSam3Server(): void {
  manager.stop();
}
