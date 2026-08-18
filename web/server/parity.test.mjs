import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCineGenWebServer } from './index.mjs';

// Any temporary adapter/server gap must be explicit here. Keep this empty for
// a parity-complete build.
const IN_PROGRESS_RPC_METHODS = new Set();

function adapterRpcMethods(source) {
  return new Set(
    [...source.matchAll(/\brpc\(\s*['"]([A-Za-z][A-Za-z0-9]*)['"]\s*,\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)]
      .map((match) => `${match[1]}.${match[2]}`),
  );
}

test('every browser-adapter RPC has a registered server handler', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cinegen-web-parity-'));
  const app = await createCineGenWebServer({ dataRoot });
  t.after(async () => {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  const adapterSource = await readFile(new URL('../src/platform/install.ts', import.meta.url), 'utf8');
  const adapterMethods = adapterRpcMethods(adapterSource);
  assert.ok(adapterMethods.size > 0, 'browser adapter RPC inventory must not be empty');

  for (const method of IN_PROGRESS_RPC_METHODS) {
    assert.ok(adapterMethods.has(method), `stale in-progress RPC exception: ${method}`);
  }

  const missing = [...adapterMethods]
    .filter((method) => !app.handlers.has(method))
    .sort();
  const unexpectedMissing = missing
    .filter((method) => !IN_PROGRESS_RPC_METHODS.has(method));

  assert.deepEqual(
    unexpectedMissing,
    [],
    `browser adapter RPCs without server handlers: ${unexpectedMissing.join(', ')}`,
  );

  const unregisteredExceptions = [...IN_PROGRESS_RPC_METHODS]
    .filter((method) => !app.handlers.has(method))
    .sort();
  assert.deepEqual(missing, unregisteredExceptions);
});
