import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLocalSourcePath } from '../../../electron/ipc/copilot-visual-media';

let tmpFile: string;

beforeAll(() => {
  tmpFile = path.join(os.tmpdir(), `cinegen-cliptest-${Date.now()}.mp4`);
  fs.writeFileSync(tmpFile, 'x');
});

afterAll(() => {
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
});

describe('resolveLocalSourcePath', () => {
  it('resolves a raw existing path', () => {
    expect(resolveLocalSourcePath(tmpFile)).toBe(tmpFile);
  });

  it('resolves a local-media://file/ URL', () => {
    expect(resolveLocalSourcePath(`local-media://file${tmpFile}`)).toBe(tmpFile);
  });

  it('resolves a file:// URL', () => {
    expect(resolveLocalSourcePath(`file://${tmpFile}`)).toBe(tmpFile);
  });

  it('decodes percent-encoded paths', () => {
    // A path with a space, encoded as it would arrive in a URL.
    const spaced = path.join(os.tmpdir(), `cinegen cliptest ${Date.now()}.mp4`);
    fs.writeFileSync(spaced, 'x');
    try {
      const encoded = `local-media://file${spaced.replace(/ /g, '%20')}`;
      expect(resolveLocalSourcePath(encoded)).toBe(spaced);
    } finally {
      fs.unlinkSync(spaced);
    }
  });

  it('returns null for a missing file and for empty input', () => {
    expect(resolveLocalSourcePath('/no/such/file.mp4')).toBeNull();
    expect(resolveLocalSourcePath('   ')).toBeNull();
  });
});
