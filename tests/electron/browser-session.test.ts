// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ isPackaged: false, getPath: vi.fn(), setPath: vi.fn() }));
vi.mock('electron', () => ({ app }));
import { configureBrowserSession } from '../../electron/browser-session';
const directories: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });

describe('development browser session', () => {
  it('reuses durable dev storage across launches and leaves installed browser storage separate', () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'cinegen-session-test-')); directories.push(userData);
    app.isPackaged = false; app.getPath.mockReturnValue(userData);
    configureBrowserSession();
    const sessionPath = app.setPath.mock.calls[0][1];
    expect(sessionPath).not.toBe(userData);
    writeFileSync(path.join(sessionPath, 'saved-session-fixture'), 'retained');
    configureBrowserSession();
    expect(app.setPath.mock.calls).toEqual([['sessionData', sessionPath], ['sessionData', sessionPath]]);
    expect(readFileSync(path.join(sessionPath, 'saved-session-fixture'), 'utf8')).toBe('retained');
  });
  it('retains the existing installed app profile', () => {
    app.isPackaged = true;
    configureBrowserSession();
    expect(app.setPath).not.toHaveBeenCalled();
  });
});
