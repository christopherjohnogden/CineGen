import { ALL_MODELS } from '../../src/lib/fal/models';
import { buildTopviewModelRegistry, topviewRequestedModel, type TopviewGenerationCatalog } from '../../src/lib/topview/model-catalog';
import type { RecordValue } from './firebase';

export type GenerationProvider = 'topview' | 'higgsfield';
export function requestedProvider(value: unknown): GenerationProvider {
  if (value === undefined || value === 'topview') return 'topview';
  if (value === 'higgsfield') return 'higgsfield';
  throw new Error('Use Topview by default. Higgsfield is available only when explicitly requested.');
}

/** Calls the same authenticated provider connection used by the CineGen website. */
export async function providerRpc(token: string, provider: GenerationProvider, method: string, params?: unknown): Promise<RecordValue> {
  if(provider==='topview' && method==='generate' && params && typeof params==='object') params={...params,downloadSource:'origin'};
  const response = await fetch(`https://cinegen-api.christopherjohnogden.workers.dev/api/rpc/${provider}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-cinegen-id-token': token, 'x-cinegen-origin': 'https://cinegen-film.vercel.app' },
    body: JSON.stringify({ args: params === undefined ? [] : [params] }),
    signal: AbortSignal.timeout(method === 'generate' ? 240000 : 60000),
  });
  const body = await response.json() as RecordValue;
  if (!response.ok || !body.ok) throw new Error(body.error?.message || `${provider} ${method} failed (${response.status}).`);
  return body.result;
}

export function providerModels(provider: GenerationProvider, kind?: unknown, catalog?: TopviewGenerationCatalog) {
  const registry = provider === 'topview' ? buildTopviewModelRegistry(catalog) : ALL_MODELS;
  return Object.values(registry).filter(m => m.provider === provider && ['image', 'video'].includes(m.outputType) && (!kind || m.outputType === kind) && !m.nodeType.endsWith('-auto'));
}
export async function connectedModels(token: string, provider: GenerationProvider, kind?: unknown) {
  const status = await providerRpc(token, provider, 'accountStatus');
  const catalog = provider === 'topview' ? await providerRpc(token, provider, 'modelCatalog') : undefined;
  return { connected: status.connected !== false, models: providerModels(provider, kind, catalog as TopviewGenerationCatalog | undefined) };
}

export function prepareProviderGeneration(args: RecordValue, available = providerModels(requestedProvider(args.provider))) {
  const provider = requestedProvider(args.provider);
  const model = available.find(m => m.nodeType === args.model && m.provider === provider);
  if (!model) throw new Error(`Choose an exact ${provider} model from cinegen_list_models. Higgsfield requires provider: "higgsfield" and an explicit user request.`);
  if (!args.inputs || typeof args.inputs !== 'object' || Array.isArray(args.inputs)) throw new Error('Model inputs are required.');
  const config: RecordValue = {};
  const medias: Array<{ value: string; role: string }> = [];
  for (const key of Object.keys(args.inputs)) if (!model.inputs.some(f => f.id === key)) throw new Error(`Unknown model input: ${key}`);
  for (const field of model.inputs) {
    let value = args.inputs[field.id] ?? field.default;
    if (value === undefined || value === null || value === '') { if (field.required) throw new Error(`Missing ${field.id}`); continue; }
    if (field.schemaType === 'number' || field.schemaType === 'integer' || field.fieldType === 'range' || field.fieldType === 'number') {
      value = Number(value);
      if (!Number.isFinite(value) || (field.schemaType === 'integer' && !Number.isInteger(value))) throw new Error(`Invalid number for ${field.id}`);
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) throw new Error(`Out of range: ${field.id}`);
    }
    if (field.id === 'resolution' && field.options) {
      const pixels = (v: unknown) => /^\d+p?$/i.test(String(v).trim()) ? String(v).trim().replace(/p$/i, '') : null;
      const requested = pixels(value);
      const option = field.options.find(o => String(o.value) === String(value))
        ?? (requested ? field.options.find(o => pixels(o.value) === requested) : undefined);
      if (option) value = option.value;
    }
    if (field.fieldType === 'toggle' && typeof value !== 'boolean') throw new Error(`Expected true or false for ${field.id}`);
    if (field.options && !field.options.some(o => String(o.value) === String(value))) throw new Error(`Unsupported value for ${field.id}=${String(value)}. ${model.name} allows: ${field.options.map(o => o.value).join(", ")}. Refresh cinegen_list_models for current provider options.`);
    if (['image', 'video', 'audio', 'media'].includes(field.portType)) {
      for (const media of Array.isArray(value) ? value : [value]) {
        if (typeof media !== 'string' || !media.startsWith('https://')) throw new Error(`Use saved HTTPS media URLs for ${field.id}`);
        let role: string = field.mediaRole || (field.portType === 'media' ? 'image' : field.portType);
        const pathname = decodeURIComponent(new URL(media).pathname).toLowerCase();
        if (!['start_image', 'end_image'].includes(role)) {
          if (/\.(mp4|mov|webm|m4v)$/.test(pathname)) role = 'video';
          else if (/\.(mp3|wav|aac|m4a|ogg)$/.test(pathname)) role = 'audio';
        }
        medias.push({ value: media, role });
      }
    }
    if (['generate_count', 'batch_size', 'num_images'].includes(field.id) && Number(value) !== 1) throw new Error('Use one output per requestId; create separate jobs for multiple generations.');
    config[field.id] = value;
  }
  const promptField = model.inputs.find(f => f.id === 'prompt' || f.falParam === 'prompt');
  const prompt = promptField ? String(config[promptField.id] ?? '') : '';
  if (!prompt.trim()) throw new Error('A prompt is required.');
  const params: RecordValue = { prompt, outputType: model.outputType, model: provider === 'topview' ? topviewRequestedModel(model, config.model) : model.id, medias };
  if (provider === 'topview') {
    for (const [from, to] of [['duration','durationSec'],['aspect_ratio','aspectRatio'],['resolution','resolution'],['generate_audio','generateAudio'],['generate_count','generateCount']]) {
      if (config[from] !== undefined && config[from] !== '') params[to] = from === 'duration' || from === 'generate_count' ? Number(config[from]) : config[from];
    }
    params.waitForCompletion = false;
  } else { params.params = config; params.wait = true; }
  return { provider, model, config, params, prompt };
}
