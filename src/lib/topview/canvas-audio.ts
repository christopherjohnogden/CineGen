import { assertTopviewCanvasPrompt } from './reference-capabilities';
import { assertClipEditVideo } from './clip-edit';

type Data = Record<string, any>;
type Call = (name: string, args: Data) => Promise<unknown>;
export type CanvasReference = { value: string; role: string };
type Source = { bytes: Uint8Array; format: string; mime?: string };

export const TOPVIEW_CANVAS_AUDIO_TOOLS = [
  'list_topview_canvases', 'create_topview_canvas', 'get_topview_canvas_state',
  'get_topview_canvas_generation_capabilities', 'prepare_topview_canvas_media_upload',
  'create_topview_canvas_media_node', 'submit_topview_canvas_generation_task',
  'refresh_topview_canvas_generation_task', 'download_topview_canvas_nodes',
] as const;

export function hasTopviewCanvasAudioTools(tools: string[]): boolean {
  return TOPVIEW_CANVAS_AUDIO_TOOLS.every(name => tools.includes(name));
}

function data(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = value as Data;
  if (result.isError) throw new Error(result.structuredContent?.message || result.content?.[0]?.text || 'Topview Canvas could not complete this request.');
  if (result.structuredContent) return data(result.structuredContent);
  for (const item of result.content ?? []) {
    if (item.type === 'text') {
      let parsed: unknown;
      try { parsed = JSON.parse(item.text); } catch { continue; }
      return data(parsed);
    }
  }
  if (result.errorCode) throw new Error(result.message || result.errorMessage || result.errorCode);
  return result.result && typeof result.result === 'object' ? data(result.result) : result;
}

const TASK_PREFIX = 'cinegen-canvas:';
export function readTopviewCanvasTask(value: unknown): { canvasId: string; nodeId: string; taskId: string } | undefined {
  if (typeof value !== 'string' || !value.startsWith(TASK_PREFIX)) return undefined;
  try {
    const decoded = JSON.parse(atob(value.slice(TASK_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')));
    if (['canvasId', 'nodeId', 'taskId'].every(key => typeof decoded[key] === 'string' && /^[\w.:@-]{1,200}$/.test(decoded[key]))) return decoded;
  } catch { /* reject corrupted handles instead of querying an unrelated task */ }
  throw new Error('The saved Topview Canvas task is invalid. No new generation was submitted.');
}

export function topviewCanvasTaskHandle(value: { canvasId: string; nodeId: string; taskId: string }): string {
  const handle = TASK_PREFIX + btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  readTopviewCanvasTask(handle);
  return handle;
}

function kind(reference: CanvasReference): 'image' | 'video' | 'audio' {
  return /audio/.test(reference.role) ? 'audio' : /video/.test(reference.role) ? 'video' : 'image';
}

/** Validate the live Canvas contract before uploading references or spending credits. */
export function canvasAudioParameters(capability: Data, request: Data, references: CanvasReference[]): Data {
  const editing = request.omniReferenceTaskType === 'edit';
  if (editing && references.filter(ref => kind(ref) === 'video').length !== 1) throw new Error('Clip Edit needs exactly one source video.');
  const roles: Data[] = capability.inputRoles ?? capability.inputs ?? [];
  const counts: Data = {};
  for (const reference of references) {
    const role = `reference_${kind(reference)}`;
    counts[role] = (counts[role] ?? 0) + 1;
    if (!roles.some(input => input.role === role)) throw new Error(`Topview ${capability.displayName ?? capability.model} does not accept ${kind(reference)} references in this mode.`);
  }
  for (const role of roles) {
    const count = counts[role.role] ?? 0;
    if (count < (role.min ?? 0) || count > (role.max ?? Infinity)) throw new Error(`Topview ${capability.displayName ?? capability.model} allows ${role.min ?? 0}–${role.max} ${role.role.replace('reference_', '')} references in this mode.`);
  }
  for (const constraint of capability.constraints ?? []) {
    if (constraint.type === 'require_any_roles' && !constraint.roles.some((role: string) => counts[role])) {
      throw new Error('Add at least one image or video alongside the audio. Topview’s Seedance 2.5 Canvas route currently requires a visual reference; audio-only generation was not submitted.');
    }
  }
  if (Number(request.generatingCount ?? 1) !== 1) throw new Error('Audio-reference video generation supports one output per request.');
  const properties = capability.parametersSchema?.properties ?? {};
  const parameters = { ...capability.defaults };
  const fields = { duration: editing ? -1 : request.duration, resolution: request.resolution, aspectRatio: editing ? 'adaptive' : request.aspectRatio ?? request.ratio,
    nativeAudio: request.sound === undefined ? undefined : request.sound === true || request.sound === 'true' || request.sound === 'on',
    omniReferenceTaskType: request.omniReferenceTaskType };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === '') continue;
    if (!Object.hasOwn(properties, key)) throw new Error(`Topview Canvas does not expose the requested ${key} setting for this model.`);
    const options = properties[key].enum ?? capability.parameterEnums?.[key];
    const normalized = properties[key].type === 'number' ? Number(String(value).replace(/p$/i, '')) : value;
    if (options && !options.includes(normalized)) throw new Error(`Topview Canvas does not support ${key}=${value}. Available: ${options.join(', ')}.`);
    parameters[key] = normalized;
  }
  for (const key of capability.requiredParameters ?? []) {
    if (parameters[key] === undefined) throw new Error(`Topview requires ${key} for this generation.`);
  }
  return parameters;
}

/** Uses the same Topview MCP session and account as ordinary CineGen generations. */
export async function submitTopviewCanvasAudio(args: {
  call: Call; request: Data; references: CanvasReference[];
  submitSchema?: unknown;
  load: (reference: CanvasReference) => Promise<Source>;
}): Promise<Data> {
  const { call, request, references } = args;
  assertTopviewCanvasPrompt(request.prompt, args.submitSchema);
  const listed = data(await call('list_topview_canvases', { limit: 50 }));
  let canvasId = listed.canvases?.find((canvas: Data) => canvas.name === 'CineGen references')?.canvasId;
  if (!canvasId) canvasId = data(await call('create_topview_canvas', { name: 'CineGen references' })).canvasId;
  if (typeof canvasId !== 'string' || !canvasId) throw new Error('Topview did not return the CineGen Canvas ID.');
  const catalog = data(await call('get_topview_canvas_generation_capabilities', {
    canvasId, mediaType: 'video', include: ['schema'], refresh: true,
  }));
  const slug = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const capability = catalog.capabilities?.find((entry: Data) => entry.taskType === 'video_edit'
    && [entry.model, entry.displayName].some(value => slug(value) === slug(request.model)));
  if (!capability || !catalog.capabilityVersion) throw new Error(`Topview Canvas does not currently expose ${request.model} for this reference mode.`);
  const parameters = canvasAudioParameters(capability, request, references);
  const state = data(await call('get_topview_canvas_state', { canvasId, fields: ['nodes.geometry'] }));
  const y = (state.nodes ?? []).reduce((bottom: number, node: Data) => Math.max(bottom,
    Number(node.y ?? node.position?.y ?? node.geometry?.y ?? 0) + Number(node.height ?? node.measured?.height ?? node.geometry?.height ?? 400)), -80) + 80;
  const inputs: Data[] = [];
  for (const [index, reference] of references.entries()) {
    if (reference.value.startsWith('topview-file:')) throw new Error('Use the saved CineGen image URL for this audio-reference generation, rather than a temporary Topview upload ID.');
    const source = await args.load(reference);
    if (!source.bytes.byteLength) throw new Error('A reference file is empty.');
    if (request.omniReferenceTaskType === 'edit' && kind(reference) === 'video') assertClipEditVideo(source.bytes);
    if (kind(reference) === 'audio' && (!['mp3', 'wav'].includes(source.format.toLowerCase()) || source.bytes.byteLength > 15 * 1024 * 1024)) {
      throw new Error('Seedance audio references must be MP3 or WAV files up to 15 MB.');
    }
    const upload = data(await call('prepare_topview_canvas_media_upload', {
      canvasId, fileName: `reference-${index + 1}.${source.format}`, fileSize: source.bytes.byteLength,
    }));
    if (!/^https:\/\//.test(upload.uploadUrl ?? '') || !upload.objectKey) throw new Error('Topview did not return a usable Canvas upload destination.');
    const headers = Object.fromEntries(Object.entries(upload.requiredHeaders ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers,
      body: new Blob([new Uint8Array(source.bytes)], { type: upload.mimeType ?? source.mime }),
      redirect: 'manual', signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`Topview reference upload failed (HTTP ${response.status}). No generation was submitted.`);
    const created = data(await call('create_topview_canvas_media_node', {
      canvasId, mediaType: kind(reference), url: upload.objectKey, mimeType: upload.mimeType ?? source.mime,
      title: `${kind(reference)[0].toUpperCase()}${kind(reference).slice(1)} reference ${index + 1}`,
      x: (index % 4) * 340, y: y + Math.floor(index / 4) * 300, width: 300, height: 240,
    }));
    if (!created.nodeId || (created.consistencyStatus && created.consistencyStatus !== 'projected')) throw new Error('Topview has not finished preparing this reference. No generation was submitted.');
    inputs.push({ role: `reference_${kind(reference)}`, source: { kind: 'canvas_node', nodeId: created.nodeId } });
  }
  // One paid call, with one idempotency key. Never silently retry through another provider.
  const commandId = request.commandId ?? `cinegen-${crypto.randomUUID()}`;
  const submitted = data(await call('submit_topview_canvas_generation_task', {
    canvasId, mediaType: 'video', taskType: capability.taskType, model: capability.model,
    capabilityVersion: catalog.capabilityVersion, commandId, prompt: request.prompt,
    parameters, inputs, layout: { x: 0, y: y + Math.ceil(references.length / 4) * 300, width: 640, height: 400 },
  }));
  if (!submitted.nodeId || !submitted.taskId) throw new Error('Topview did not return a complete generation receipt. Check Topview before starting another generation.');
  return { taskId: topviewCanvasTaskHandle({ canvasId, nodeId: submitted.nodeId, taskId: submitted.taskId }),
    status: 'running', model: request.model, ...(parameters.duration > 0 ? { durationSec: parameters.duration } : {}), canvasId };
}

/** Resume the original Canvas node; never send an opaque Canvas task to the legacy query endpoint. */
export async function queryTopviewCanvasAudio(call: Call, handle: string): Promise<Data> {
  const task = readTopviewCanvasTask(handle);
  if (!task) throw new Error('Not a Topview Canvas task.');
  const refreshed = data(await call('refresh_topview_canvas_generation_task', { ...task, include: [] }));
  const status = String(refreshed.status ?? '').toLowerCase();
  if (/fail|error|cancel/.test(status)) return { taskId: handle, status: 'fail', errorMessage: refreshed.errorMessage ?? refreshed.message ?? 'Topview could not finish this video.' };
  if (!/success|complete|done|ready/.test(status) && !refreshed.mediaRef) return { taskId: handle, status: 'running' };
  // A mediaRef can be an internal S3 key. Ask for an authorized artifact instead of
  // guessing a public CDN URL or accidentally returning an input reference URL.
  const downloaded = data(await call('download_topview_canvas_nodes', { canvasId: task.canvasId, nodeIds: [task.nodeId] }));
  const artifact = downloaded.downloadArtifacts?.find((item: Data) => item.nodeId === task.nodeId && /^https:\/\//.test(item.url ?? ''));
  return artifact ? { taskId: handle, status: 'success', videoUrl: artifact.url }
    : { taskId: handle, status: 'running' };
}
