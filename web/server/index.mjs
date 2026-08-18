import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Busboy from 'busboy';
import { createCutWorkflowHandlers } from './services/cut-workflow.mjs';
import { createElementsHandlers } from './services/elements.mjs';
import { createExportHandlers } from './services/export.mjs';
import { createHiggsfieldService } from './services/higgsfield.mjs';
import { createLlmHandlers } from './services/llm.mjs';
import { createLocalLlmHandlers } from './services/llm-local.mjs';
import { createLocalModelHandlers } from './services/local-model.mjs';
import { createMediaHandlers } from './services/media.mjs';
import { createMusicHandlers } from './services/music.mjs';
import { createSam3Service } from './services/sam3.mjs';
import { createSyncHandlers } from './services/sync.mjs';
import { createTranscriptionHandlers } from './services/transcription.mjs';
import { createVisionServices } from './services/vision.mjs';
import { createWorkflowServices } from './services/workflow.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SERVER_DIR, '..');
const DEFAULT_DATA_ROOT = path.join(WEB_ROOT, '.data');
const DEFAULT_PORT = 8787;
const MAX_JSON_BYTES = Number(process.env.CINEGEN_WEB_MAX_JSON_BYTES || 64 * 1024 * 1024);
const MAX_UPLOAD_BYTES = Number(process.env.CINEGEN_WEB_MAX_UPLOAD_BYTES || 4 * 1024 * 1024 * 1024);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const MIME_TYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.aiff', 'audio/aiff'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.css', 'text/css; charset=utf-8'],
  ['.flac', 'audio/flac'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.m4a', 'audio/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function timestamp() {
  return new Date().toISOString();
}

function assertId(value, label = 'id') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`, 'INVALID_ID');
  }
  return value;
}

function sanitizeFileName(value) {
  const base = path.basename(String(value || 'upload.bin')).normalize('NFKC');
  const safe = base.replace(/[^A-Za-z0-9._() -]+/g, '_').replace(/^\.+/, '').slice(0, 180);
  return safe || 'upload.bin';
}

function pathInside(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new HttpError(400, 'Path escapes the configured data root.', 'INVALID_PATH');
  }
  return candidate;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
}

function createDefaultProjectState(name) {
  const id = crypto.randomUUID();
  const now = timestamp();
  const timelineId = crypto.randomUUID();
  const videoTrackId = crypto.randomUUID();
  const audioTrackId = crypto.randomUUID();
  const spaceId = crypto.randomUUID();
  return {
    project: {
      id,
      name,
      created_at: now,
      updated_at: now,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24,
    },
    assets: [],
    mediaFolders: [],
    timelines: [{
      id: timelineId,
      project_id: id,
      name: 'Timeline 1',
      duration: 0,
      created_at: now,
      markers: '[]',
      tracks: [
        {
          id: videoTrackId,
          timeline_id: timelineId,
          name: 'Video 1',
          kind: 'video',
          color: '#4A90D9',
          muted: 0,
          solo: 0,
          locked: 0,
          visible: 1,
          volume: 1,
          sort_order: 0,
        },
        {
          id: audioTrackId,
          timeline_id: timelineId,
          name: 'Audio 1',
          kind: 'audio',
          color: '#7ED321',
          muted: 0,
          solo: 0,
          locked: 0,
          visible: 1,
          volume: 1,
          sort_order: 1,
        },
      ],
      clips: [],
      transitions: [],
    }],
    activeTimelineId: timelineId,
    workflow: {
      nodes: [],
      edges: [],
      spaces: [{ id: spaceId, name: 'Space 1', createdAt: now, nodes: [], edges: [] }],
      activeSpaceId: spaceId,
      openSpaceIds: [spaceId],
    },
    elements: [],
    exports: [],
  };
}

class ProjectStore {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.projectsRoot = pathInside(dataRoot, 'projects');
    this.indexPath = pathInside(dataRoot, 'projects.json');
  }

  async initialize() {
    await Promise.all([
      fsp.mkdir(this.projectsRoot, { recursive: true }),
      fsp.mkdir(pathInside(this.dataRoot, 'media', 'uploads'), { recursive: true }),
      fsp.mkdir(pathInside(this.dataRoot, 'media', 'projects'), { recursive: true }),
    ]);
  }

  projectPath(id) {
    return pathInside(this.projectsRoot, assertId(id, 'project id'), 'project.json');
  }

  async readIndex() {
    const index = await readJson(this.indexPath, { projects: [] });
    return Array.isArray(index?.projects) ? index : { projects: [] };
  }

  async writeIndex(index) {
    await writeJsonAtomic(this.indexPath, index);
  }

  metaFromState(state, previous = {}) {
    const assets = Array.isArray(state.assets) ? state.assets : [];
    const elements = Array.isArray(state.elements) ? state.elements : [];
    const firstThumb = assets.find((asset) => typeof asset?.thumbnail_url === 'string')?.thumbnail_url ?? null;
    return {
      id: state.project.id,
      name: state.project.name,
      createdAt: state.project.created_at || previous.createdAt || timestamp(),
      updatedAt: state.project.updated_at || timestamp(),
      assetCount: assets.length,
      elementCount: elements.length,
      thumbnail: firstThumb,
      useSqlite: true,
    };
  }

  async list() {
    const index = await this.readIndex();
    return [...index.projects].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async create(name) {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!normalized || normalized.length > 100) {
      throw new HttpError(400, 'Project name must be 1-100 characters.', 'INVALID_PROJECT_NAME');
    }
    const state = createDefaultProjectState(normalized);
    const projectDir = path.dirname(this.projectPath(state.project.id));
    await Promise.all([
      fsp.mkdir(projectDir, { recursive: true }),
      fsp.mkdir(pathInside(this.dataRoot, 'media', 'projects', state.project.id, 'imported'), { recursive: true }),
      fsp.mkdir(pathInside(this.dataRoot, 'media', 'projects', state.project.id, 'generated'), { recursive: true }),
      fsp.mkdir(pathInside(this.dataRoot, 'media', 'projects', state.project.id, 'cache'), { recursive: true }),
    ]);
    await writeJsonAtomic(this.projectPath(state.project.id), state);
    const index = await this.readIndex();
    index.projects = [this.metaFromState(state), ...index.projects.filter((entry) => entry.id !== state.project.id)];
    await this.writeIndex(index);
    return state;
  }

  async load(id) {
    const state = await readJson(this.projectPath(id), null);
    if (!state) throw new HttpError(404, `Project not found: ${id}`, 'PROJECT_NOT_FOUND');
    return state;
  }

  async save(id, state) {
    assertId(id, 'project id');
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new HttpError(400, 'Project state must be an object.', 'INVALID_PROJECT_STATE');
    }
    const previous = await this.load(id);
    const now = timestamp();
    const next = {
      ...state,
      project: {
        ...previous.project,
        ...(state.project ?? {}),
        id,
        created_at: state.project?.created_at || previous.project.created_at,
        updated_at: now,
      },
      assets: Array.isArray(state.assets) ? state.assets : previous.assets,
      mediaFolders: Array.isArray(state.mediaFolders) ? state.mediaFolders : previous.mediaFolders,
      timelines: Array.isArray(state.timelines) ? state.timelines : previous.timelines,
      workflow: state.workflow && typeof state.workflow === 'object' ? state.workflow : previous.workflow,
      elements: Array.isArray(state.elements) ? state.elements : previous.elements,
      exports: Array.isArray(state.exports) ? state.exports : previous.exports,
    };
    await writeJsonAtomic(this.projectPath(id), next);
    const index = await this.readIndex();
    const priorMeta = index.projects.find((entry) => entry.id === id);
    const meta = this.metaFromState(next, priorMeta);
    index.projects = [meta, ...index.projects.filter((entry) => entry.id !== id)];
    await this.writeIndex(index);
    return next;
  }

  async patchProject(id, partial) {
    const state = await this.load(id);
    return this.save(id, { ...state, project: { ...state.project, ...(partial ?? {}) } });
  }

  async delete(id) {
    assertId(id, 'project id');
    await Promise.all([
      fsp.rm(pathInside(this.projectsRoot, id), { recursive: true, force: true }),
      fsp.rm(pathInside(this.dataRoot, 'media', 'projects', id), { recursive: true, force: true }),
    ]);
    const index = await this.readIndex();
    index.projects = index.projects.filter((entry) => entry.id !== id);
    await this.writeIndex(index);
  }

  async insertAsset(asset) {
    const projectId = assertId(asset?.project_id, 'asset project id');
    const state = await this.load(projectId);
    const assets = Array.isArray(state.assets) ? state.assets : [];
    const nextAsset = { ...asset, id: asset.id || crypto.randomUUID(), project_id: projectId };
    return this.save(projectId, {
      ...state,
      assets: [nextAsset, ...assets.filter((entry) => entry.id !== nextAsset.id)],
    }).then(() => nextAsset);
  }

  async updateAsset(projectId, id, partial) {
    assertId(projectId, 'project id');
    assertId(id, 'asset id');
    const state = await this.load(projectId);
    let found = false;
    const assets = (state.assets ?? []).map((asset) => {
      if (asset.id !== id) return asset;
      found = true;
      return { ...asset, ...(partial ?? {}), id, project_id: projectId };
    });
    if (!found) throw new HttpError(404, `Asset not found: ${id}`, 'ASSET_NOT_FOUND');
    await this.save(projectId, { ...state, assets });
  }

  async deleteAsset(projectId, id) {
    assertId(projectId, 'project id');
    assertId(id, 'asset id');
    const state = await this.load(projectId);
    await this.save(projectId, {
      ...state,
      assets: (state.assets ?? []).filter((asset) => asset.id !== id),
    });
  }
}

class EventHub {
  constructor() {
    this.clients = new Set();
  }

  add(response) {
    this.clients.add(response);
    response.write(': connected\n\n');
    return () => this.clients.delete(response);
  }

  emit(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of [...this.clients]) {
      if (!client.writableEnded) client.write(payload);
      else this.clients.delete(client);
    }
  }

  heartbeat() {
    for (const client of [...this.clients]) {
      if (!client.writableEnded) client.write(': keepalive\n\n');
      else this.clients.delete(client);
    }
  }

  close() {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Range');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, 'Request body is too large.', 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.', 'INVALID_JSON');
  }
}

async function handleUpload(request, dataRoot) {
  const uploadId = crypto.randomUUID();
  const uploadRoot = pathInside(dataRoot, 'media', 'uploads', uploadId);
  await fsp.mkdir(uploadRoot, { recursive: true });
  let stored = null;
  const writes = [];

  await new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 20, fieldSize: 1024 * 1024 },
      });
    } catch (error) {
      reject(new HttpError(400, error.message, 'INVALID_MULTIPART'));
      return;
    }

    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'file' || stored) {
        stream.resume();
        return;
      }
      const name = sanitizeFileName(info.filename);
      const diskPath = pathInside(uploadRoot, name);
      const output = fs.createWriteStream(diskPath, { flags: 'wx' });
      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
        output.destroy(new HttpError(413, 'Uploaded file is too large.', 'UPLOAD_TOO_LARGE'));
      });
      const write = new Promise((writeResolve, writeReject) => {
        output.on('finish', () => {
          if (truncated) writeReject(new HttpError(413, 'Uploaded file is too large.', 'UPLOAD_TOO_LARGE'));
          else writeResolve();
        });
        output.on('error', writeReject);
        stream.on('error', writeReject);
      });
      writes.push(write);
      stored = { name, diskPath, type: info.mimeType || 'application/octet-stream' };
      stream.pipe(output);
    });
    parser.on('error', reject);
    parser.on('finish', resolve);
    request.pipe(parser);
  });

  try {
    await Promise.all(writes);
  } catch (error) {
    await fsp.rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  if (!stored) {
    await fsp.rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    throw new HttpError(400, 'Multipart form must include a file field.', 'FILE_REQUIRED');
  }
  const encodedName = encodeURIComponent(stored.name);
  const url = `/media/uploads/${uploadId}/${encodedName}`;
  return { url, path: url, token: url, name: stored.name, type: stored.type };
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) throw new HttpError(416, 'Invalid Range header.', 'INVALID_RANGE');
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) throw new HttpError(416, 'Invalid Range header.', 'INVALID_RANGE');
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    throw new HttpError(416, 'Requested range is not satisfiable.', 'INVALID_RANGE');
  }
  return { start, end: Math.min(end, size - 1) };
}

async function serveFile(request, response, filePath, { immutable = false } = {}) {
  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stats.isFile()) return false;
  const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  const range = parseRange(request.headers.range, stats.size);
  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate',
  };
  if (range) {
    response.writeHead(206, {
      ...common,
      'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
      'Content-Length': range.end - range.start + 1,
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath, range).pipe(response);
    return true;
  }
  response.writeHead(200, { ...common, 'Content-Length': stats.size });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filePath).pipe(response);
  return true;
}

function buildRpcHandlers(store) {
  const createLegacySnapshot = (state) => ({
    project: {
      id: state.project.id,
      name: state.project.name,
      createdAt: state.project.created_at,
      updatedAt: state.project.updated_at,
    },
    workflow: state.workflow,
    spaces: state.workflow.spaces ?? [],
    activeSpaceId: state.workflow.activeSpaceId ?? '',
    openSpaceIds: state.workflow.openSpaceIds ?? [],
    assets: state.assets,
    mediaFolders: state.mediaFolders,
    timelines: state.timelines,
    activeTimelineId: state.activeTimelineId,
    exports: state.exports,
    elements: state.elements,
  });

  const handlers = new Map([
    ['project.list', () => store.list()],
    ['project.create', async (name) => createLegacySnapshot(await store.create(name))],
    ['project.load', async (id) => createLegacySnapshot(await store.load(id))],
    ['project.save', async (id, updates) => {
      const current = await store.load(id);
      const next = await store.save(id, {
        ...current,
        ...updates,
        project: { ...current.project, ...(updates?.project ?? {}) },
      });
      return createLegacySnapshot(next);
    }],
    ['project.delete', (id) => store.delete(id)],
    ['db.createProject', (name) => store.create(name)],
    ['db.loadProject', (id) => store.load(id)],
    ['db.saveProject', async (id, state) => { await store.save(id, state); }],
    ['db.deleteProject', (id) => store.delete(id)],
    ['db.closeProject', async () => {}],
    ['db.updateProject', async (id, data) => { await store.patchProject(id, data); }],
    ['db.insertAsset', (asset) => store.insertAsset(asset)],
    ['db.updateAsset', (projectId, id, data) => store.updateAsset(projectId, id, data)],
    ['db.deleteAsset', (projectId, id) => store.deleteAsset(projectId, id)],
    ['pm.openProject', async () => ({ ok: true })],
    ['pm.open', async () => ({ ok: true })],
    ['llm.localModels', async () => []],
    ['llm.cliDetect', async () => ({
      providers: [
        { id: 'claude-code', installed: false },
        { id: 'codex', installed: false },
        { id: 'gemini', installed: false },
      ],
    })],
    ['llm.claudeCodeDetect', async () => ({ installed: false })],
    ['higgsfield.accountStatus', async () => ({
      connected: false,
      error: 'The desktop Higgsfield CLI is unavailable in a browser. Configure a hosted provider for web use.',
    })],
    ['sam3.getPort', async () => ({ port: 0, running: false })],
    ['localModel.get', async () => null],
    ['localModel.readTranscript', async () => null],
    ['transcription.get', async () => null],
  ]);

  return handlers;
}

export async function createCineGenWebServer(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || process.env.CINEGEN_WEB_DATA_ROOT || DEFAULT_DATA_ROOT);
  const distRoot = path.resolve(options.distRoot || path.join(WEB_ROOT, 'dist'));
  const store = new ProjectStore(dataRoot);
  const events = new EventHub();
  await store.initialize();
  const handlers = buildRpcHandlers(store);
  const higgsfieldService = options.higgsfieldService ?? createHiggsfieldService({
    dataRoot,
    ...(options.higgsfieldOptions ?? {}),
  });
  const cloudServices = createWorkflowServices({
    dataRoot,
    publicBaseUrl: options.publicBaseUrl ?? process.env.CINEGEN_PUBLIC_BASE_URL,
    higgsfieldService,
  });
  for (const [method, handler] of Object.entries(cloudServices.workflowHandlers)) {
    handlers.set(`workflow.${method}`, handler);
  }
  for (const [method, handler] of Object.entries(cloudServices.podHandlers)) {
    handlers.set(`pod.${method}`, handler);
  }
  for (const [method, handler] of Object.entries(createLlmHandlers())) {
    handlers.set(`llm.${method}`, handler);
  }
  for (const [method, handler] of Object.entries(createLocalLlmHandlers({
    events,
    ollamaUrl: options.ollamaUrl ?? process.env.CINEGEN_OLLAMA_URL,
  }))) {
    handlers.set(`llm.${method}`, handler);
  }
  for (const [method, handler] of Object.entries(createElementsHandlers({ dataRoot }))) {
    handlers.set(`elements.${method}`, handler);
  }
  for (const [method, handler] of Object.entries(createMusicHandlers({ dataRoot }))) {
    handlers.set(`music.${method}`, handler);
  }
  const visionServices = createVisionServices({ dataRoot });
  for (const [namespace, serviceHandlers] of Object.entries({
    vision: visionServices.visionHandlers,
    acoustic: visionServices.acousticHandlers,
    copilot: visionServices.copilotHandlers,
  })) {
    for (const [method, handler] of Object.entries(serviceHandlers)) {
      handlers.set(`${namespace}.${method}`, handler);
    }
  }
  const mediaRoot = pathInside(dataRoot, 'media');
  const pathForMediaReference = (reference) => {
    if (typeof reference !== 'string' || reference.length > 16_384) {
      throw new HttpError(400, 'Invalid media reference.', 'INVALID_MEDIA_PATH');
    }
    let pathname = reference;
    try {
      if (/^https?:\/\//i.test(reference)) pathname = new URL(reference).pathname;
      pathname = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'Invalid media reference.', 'INVALID_MEDIA_PATH');
    }
    if (!pathname.startsWith('/media/')) {
      throw new HttpError(400, 'Only web media references are accepted.', 'INVALID_MEDIA_PATH');
    }
    return pathInside(mediaRoot, pathname.slice('/media/'.length));
  };
  const mediaUrlForPath = (filePath) => {
    const resolved = path.resolve(filePath);
    if (resolved !== mediaRoot && !resolved.startsWith(`${mediaRoot}${path.sep}`)) {
      throw new HttpError(400, 'Media file is outside the configured data root.', 'INVALID_MEDIA_PATH');
    }
    return `/media/${path.relative(mediaRoot, resolved).split(path.sep).map(encodeURIComponent).join('/')}`;
  };
  for (const [method, handler] of Object.entries(createCutWorkflowHandlers({
    dataRoot,
    store,
    pathForMediaReference,
  }))) {
    handlers.set(`llm.${method}`, handler);
  }
  for (const [method, handler] of Object.entries(higgsfieldService.handlers)) {
    handlers.set(`higgsfield.${method}`, handler);
  }
  const mediaHandlers = createMediaHandlers({
    dataRoot,
    store,
    events,
    pathForMediaReference,
    mediaUrlForPath,
  });
  for (const [method, handler] of Object.entries(mediaHandlers)) {
    handlers.set(`media.${method}`, handler);
  }
  const localModelHandlers = createLocalModelHandlers({
    dataRoot,
    store,
    events,
    pathForMediaReference,
    mediaUrlForPath,
  });
  for (const [method, handler] of Object.entries(localModelHandlers)) {
    handlers.set(`localModel.${method}`, handler);
  }
  const transcriptionHandlers = createTranscriptionHandlers({
    dataRoot,
    store,
    events,
    pathForMediaReference,
    workerApiKey: options.transcriptionWorkerApiKey ?? process.env.CINEGEN_TRANSCRIPTION_WORKER_API_KEY,
    allowHttpWorker: process.env.NODE_ENV !== 'production',
  });
  for (const [method, handler] of Object.entries(transcriptionHandlers)) {
    handlers.set(`transcription.${method}`, handler);
  }
  const syncHandlers = createSyncHandlers({
    dataRoot,
    store,
    events,
    pathForMediaReference,
  });
  for (const [method, handler] of Object.entries(syncHandlers)) {
    handlers.set(`sync.${method}`, handler);
  }
  const sam3Service = createSam3Service({
    dataRoot,
    store,
    pathForMediaReference,
  });
  for (const [method, handler] of Object.entries(sam3Service.handlers)) {
    handlers.set(`sam3.${method}`, handler);
  }
  const exportHandlers = createExportHandlers({
    dataRoot,
    store,
    events,
    pathForMediaReference,
    mediaUrlForPath,
  });
  for (const [method, handler] of Object.entries(exportHandlers)) {
    handlers.set(`export.${method}`, handler);
  }

  const server = http.createServer(async (request, response) => {
    setCors(request, response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url || '/', 'http://cinegen.local');
      const pathname = decodeURIComponent(url.pathname);

      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { ok: true, result: { status: 'ready', version: 1 } });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const remove = events.add(response);
        request.on('close', remove);
        return;
      }

      if (pathname === '/api/sam3' || pathname.startsWith('/api/sam3/')) {
        await sam3Service.handleHttp(request, response);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/uploads') {
        const result = await handleUpload(request, dataRoot);
        sendJson(response, 201, { ok: true, result });
        return;
      }

      const rpcMatch = /^\/api\/rpc\/([^/]+)\/([^/]+)$/.exec(pathname);
      if (request.method === 'POST' && rpcMatch) {
        const namespace = rpcMatch[1];
        const method = rpcMatch[2];
        if (!SAFE_ID.test(namespace) || !SAFE_ID.test(method)) {
          throw new HttpError(400, 'Invalid RPC operation.', 'INVALID_OPERATION');
        }
        const handler = handlers.get(`${namespace}.${method}`);
        if (!handler) throw new HttpError(501, `Web capability not implemented: ${namespace}.${method}`, 'CAPABILITY_UNAVAILABLE');
        const body = await readJsonBody(request);
        const args = Array.isArray(body?.args) ? body.args : [];
        const result = await handler(...args);
        sendJson(response, 200, { ok: true, result });
        return;
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && pathname.startsWith('/media/')) {
        const relativePath = pathname.slice('/media/'.length);
        const mediaPath = pathInside(dataRoot, 'media', relativePath);
        if (await serveFile(request, response, mediaPath)) return;
        throw new HttpError(404, 'Media file not found.', 'MEDIA_NOT_FOUND');
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const staticPath = pathInside(distRoot, relative);
        if (await serveFile(request, response, staticPath, { immutable: pathname.includes('/assets/') })) return;
        const indexPath = pathInside(distRoot, 'index.html');
        if (await serveFile(request, response, indexPath)) return;
      }

      throw new HttpError(404, 'Not found.', 'NOT_FOUND');
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const candidateStatus = error?.status ?? error?.statusCode;
      const status = Number.isInteger(candidateStatus) ? candidateStatus : 500;
      const isKnownError = error instanceof HttpError
        || (typeof error?.code === 'string' && error.code !== 'INTERNAL_ERROR');
      const message = status >= 500 && process.env.NODE_ENV === 'production' && !isKnownError
        ? 'Internal server error.'
        : error instanceof Error ? error.message : String(error);
      if (status >= 500) console.error('[cinegen-web]', error);
      sendJson(response, status, {
        ok: false,
        error: { message, code: error?.code || 'INTERNAL_ERROR' },
      });
    }
  });

  const heartbeat = setInterval(() => events.heartbeat(), 20_000);
  heartbeat.unref();

  return {
    server,
    store,
    events,
    handlers,
    dataRoot,
    async listen(port = options.port ?? Number(process.env.PORT || DEFAULT_PORT), host = options.host || process.env.HOST || '127.0.0.1') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      clearInterval(heartbeat);
      events.close();
      higgsfieldService.context.cancelAll();
      await sam3Service.close();
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function main() {
  const app = await createCineGenWebServer();
  const address = await app.listen();
  const host = typeof address === 'object' && address ? address.address : '127.0.0.1';
  const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
  const displayHost = host === '::' || host === '0.0.0.0' ? 'localhost' : host;
  console.log(`[cinegen-web] server ready at http://${displayHost}:${port}`);

  const shutdown = async () => {
    await app.close().catch((error) => console.error('[cinegen-web] shutdown failed', error));
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('[cinegen-web] failed to start', error);
    process.exitCode = 1;
  });
}
