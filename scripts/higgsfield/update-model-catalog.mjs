import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const OUTPUT_PATH = path.join(ROOT, 'src/lib/higgsfield/model-catalog.generated.json');
const CHECK_ONLY = process.argv.includes('--check');
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const CONCURRENCY = 8;

const CANDIDATES = [
  process.env.CINEGEN_HIGGSFIELD_BIN,
  path.join(os.homedir(), '.npm-global/bin/higgsfield'),
  path.join(os.homedir(), '.local/bin/higgsfield'),
  '/opt/homebrew/bin/higgsfield',
  '/usr/local/bin/higgsfield',
  'higgsfield',
].filter(Boolean);

async function commandExists(command) {
  if (!path.isAbsolute(command)) return true;
  try {
    await access(command);
    return true;
  } catch {
    return false;
  }
}

async function findCli() {
  for (const candidate of CANDIDATES) {
    if (await commandExists(candidate)) return candidate;
  }
  throw new Error('Higgsfield CLI not found. Install it or set CINEGEN_HIGGSFIELD_BIN.');
}

function run(command, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const append = (current, chunk, label) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        finish(new Error(`Higgsfield ${label} exceeded ${MAX_OUTPUT_BYTES} bytes.`));
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk, 'stdout'); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk, 'stderr'); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr.trim() || stdout.trim() || `Higgsfield exited with code ${code}.`));
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`Higgsfield command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
}

const MODEL_TYPES = new Set(['image', 'video', 'audio', 'text', '3d']);
const PARAM_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'array', 'object', 'null']);

function validateList(value) {
  if (!Array.isArray(value)) throw new Error('Higgsfield model list was not an array.');
  const ids = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Model list entry ${index} was invalid.`);
    const { display_name: displayName, job_set_type: id, type } = entry;
    if (typeof displayName !== 'string' || !displayName.trim()) throw new Error(`Model ${index} has no display name.`);
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`Model ${index} has an invalid id.`);
    if (!MODEL_TYPES.has(type)) throw new Error(`Model ${id} has unknown output type ${String(type)}.`);
    if (ids.has(id)) throw new Error(`Duplicate Higgsfield model id: ${id}.`);
    ids.add(id);
    return { display_name: displayName, job_set_type: id, type };
  });
}

function validateSchema(value, expected) {
  if (!value || typeof value !== 'object') throw new Error(`Schema for ${expected.job_set_type} was invalid.`);
  if (value.job_set_type !== expected.job_set_type) throw new Error(`Schema id mismatch for ${expected.job_set_type}.`);
  if (value.display_name !== expected.display_name) throw new Error(`Schema display-name mismatch for ${expected.job_set_type}.`);
  if (value.type !== expected.type) throw new Error(`Schema output-type mismatch for ${expected.job_set_type}.`);
  if (!Array.isArray(value.params)) throw new Error(`Schema params for ${expected.job_set_type} were invalid.`);
  const names = new Set();
  const params = value.params.map((param, index) => {
    if (!param || typeof param !== 'object') throw new Error(`Param ${index} for ${expected.job_set_type} was invalid.`);
    if (typeof param.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(param.name)) {
      throw new Error(`Param ${index} for ${expected.job_set_type} has an invalid name.`);
    }
    if (names.has(param.name)) throw new Error(`Duplicate param ${param.name} for ${expected.job_set_type}.`);
    names.add(param.name);
    if (!PARAM_TYPES.has(param.type)) throw new Error(`Param ${param.name} for ${expected.job_set_type} has unknown type ${String(param.type)}.`);
    if (typeof param.required !== 'boolean') throw new Error(`Param ${param.name} for ${expected.job_set_type} has invalid required flag.`);
    if (param.enum !== undefined && (!Array.isArray(param.enum) || param.enum.some((item) => typeof item !== 'string'))) {
      throw new Error(`Param ${param.name} for ${expected.job_set_type} has an invalid enum.`);
    }
    return {
      name: param.name,
      type: param.type,
      default: param.default ?? null,
      required: param.required,
      ...(param.enum ? { enum: [...param.enum] } : {}),
    };
  });
  return { ...expected, params };
}

function parseVersion(raw) {
  const match = raw.trim().match(/^higgsfield\s+(\S+)\s+\(([^)]+)\)\s+built\s+(.+)$/m);
  if (!match) return { version: 'unknown', commit: 'unknown', builtAt: null };
  return { version: match[1], commit: match[2], builtAt: match[3].trim() };
}

async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function main() {
  const cli = await findCli();
  const version = parseVersion(await run(cli, ['version', '--json']));
  const list = validateList(parseJson(await run(cli, ['model', 'list', '--json']), 'Higgsfield model list'))
    .sort((a, b) => a.job_set_type.localeCompare(b.job_set_type));
  const models = await mapConcurrent(list, async (model) => (
    validateSchema(
      parseJson(await run(cli, ['model', 'get', model.job_set_type, '--json']), `Schema for ${model.job_set_type}`),
      model,
    )
  ));
  const payload = `${JSON.stringify({ schemaVersion: 1, cli: version, models }, null, 2)}\n`;

  if (CHECK_ONLY) {
    const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => '');
    if (current !== payload) {
      throw new Error('Higgsfield model catalog is stale. Run npm run higgsfield:catalog.');
    }
    process.stdout.write(`Higgsfield catalog is current (${models.length} models, CLI ${version.version}).\n`);
    return;
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const tempPath = `${OUTPUT_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, OUTPUT_PATH);
  process.stdout.write(`Updated ${path.relative(ROOT, OUTPUT_PATH)} (${models.length} models, CLI ${version.version}).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
