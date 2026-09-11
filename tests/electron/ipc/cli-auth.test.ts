// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {} }));
vi.mock('node:child_process', () => {
  Object.assign(mock.exec, { [Symbol.for('nodejs.util.promisify.custom')]: (...args: unknown[]) => new Promise((resolve, reject) => {
    mock.exec(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }) });
  return { execFile: mock.exec };
});
import { detectCliAuthentication } from '../../../electron/ipc/cli-llm-shared';

describe('CLI authentication detection', () => {
  it('does not confuse an installed Claude CLI with a signed-in account', async () => {
    mock.exec.mockImplementation((_bin, args, _opts, callback) => {
      expect(args).toEqual(['auth', 'status']);
      callback(Object.assign(new Error('exit 1'), { stdout: '{"loggedIn":false}' }));
    });
    expect(await detectCliAuthentication('claude-code', '/test/claude')).toBe(false);
  });
  it('recognizes Codex ChatGPT login status on stderr', async () => {
    mock.exec.mockImplementation((_bin, args, _opts, callback) => {
      expect(args).toEqual(['login', 'status']);
      callback(null, '', 'Logged in using ChatGPT');
    });
    expect(await detectCliAuthentication('codex', '/test/codex')).toBe(true);
  });
  it('keeps a timeout or unsupported auth command unknown', async () => {
    mock.exec.mockImplementation((_bin, _args, _opts, callback) => callback(new Error('timeout')));
    expect(await detectCliAuthentication('codex', '/test/codex')).toBeUndefined();
  });
});
