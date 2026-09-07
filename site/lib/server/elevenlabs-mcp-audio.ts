import { SiteHttpError } from './common';
import { createElevenLabsMcp, type McpTool } from './elevenlabs-mcp';
import type { ElevenLabsAudioRequest } from '../../../src/lib/elevenlabs/types';

type Kind = 'voices' | 'speech' | 'sound' | 'design' | 'saveVoice';
// Match against the server's live advertised schemas, never a fabricated tool.
// Unknown/changed contracts fail before any billable call is made.
const names: Record<Kind, RegExp> = {
  voices: /(?:^|_)(?:get_voices|list_voices|search_voices)$/, speech: /(?:^|_)(?:text_to_speech|generate_speech|speech_generate)$/,
  sound: /(?:^|_)(?:text_to_sound_effects|generate_sound_effect|generate_sound_effects|sound_generation)$/,
  design: /(?:^|_)(?:voice_design|design_voice|design_voices|generate_voice|text_to_voice)$/,
  saveVoice: /(?:^|_)(?:create_voice_from_preview|save_generated_voice|save_voice|create_voice)$/,
};
export function findAudioTool(tools: McpTool[], kind: Kind): McpTool | undefined {
  return tools.find(t => names[kind].test(t.name) && (kind !== 'speech' || Boolean(t.inputSchema.properties?.text && t.inputSchema.properties?.voice_id)));
}
export function audioCapabilities(tools: McpTool[]) {
  return Object.fromEntries((Object.keys(names) as Kind[]).map(kind => [kind, Boolean(findAudioTool(tools, kind))]));
}
export function toolArguments(tool: McpTool, candidates: Record<string, unknown>) {
  const props = tool.inputSchema.properties || {}, args: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(candidates)) {
    if (!(name in props) || value === undefined) continue;
    const schema = props[name];
    if (schema.enum && !schema.enum.includes(value)) throw new SiteHttpError(422, `ElevenLabs MCP does not support this ${name.replace(/_/g, ' ')}. No generation was submitted.`);
    if (typeof value === 'string' && schema.maxLength && value.length > schema.maxLength) throw new SiteHttpError(422, `ElevenLabs MCP accepts ${schema.maxLength} characters for ${name.replace(/_/g, ' ')}. Your text has not been shortened.`);
    args[name] = value;
  }
  for (const name of tool.inputSchema.required || []) { if (args[name] === undefined && props[name]?.default !== undefined) args[name] = props[name].default; }
  const missing = (tool.inputSchema.required || []).filter(k => args[k] === undefined);
  if (missing.length) throw new SiteHttpError(422, 'The ElevenLabs MCP tool has changed and needs a CineGen update. No generation was submitted.', 'ELEVENLABS_MCP_SCHEMA_CHANGED');
  return args;
}
export function toolData(result: any): any {
  if (result?.structuredContent) return result.structuredContent;
  for (const part of result?.content || []) {
    if (part.type !== 'text') continue;
    try { return JSON.parse(part.text); } catch { /* A text-only tool result is handled below. */ }
  }
  return result;
}
export function returnedAudio(result: any): { url?: string; base64?: string; mimeType?: string } {
  const data = toolData(result);
  for (const object of [data, data?.result, data?.data, data?.audio]) {
    if (!object || typeof object !== 'object') continue;
    const url = object.audio_url || object.download_url || object.audio_download_url || object.url;
    if (typeof url === 'string' && /^https:\/\//.test(url)) return { url };
    const base64 = object.audio_base_64 || object.audio_base64;
    if (typeof base64 === 'string') return { base64, mimeType: object.mime_type || 'audio/mpeg' };
  }
  for (const part of result?.content || []) {
    if (part.type === 'audio' && typeof part.data === 'string') return { base64: part.data, mimeType: part.mimeType };
    if (part.type === 'resource_link' && part.mimeType?.startsWith('audio/') && typeof part.uri === 'string') return { url: part.uri };
  }
  throw new SiteHttpError(502, 'ElevenLabs completed the tool call but did not return a supported audio download. Check ElevenLabs history before starting another take.', 'ELEVENLABS_AUDIO_MISSING');
}
export async function openMcpAudio(env: Parameters<typeof createElevenLabsMcp>[0], workspace: string) {
  const session = await createElevenLabsMcp(env, workspace).session();
  const tools = await session.tools();
  function selected(kind: Kind) {
    const tool = findAudioTool(tools, kind);
    if (!tool) throw new SiteHttpError(422, `Your ElevenLabs hosted MCP does not expose ${kind === 'sound' ? 'sound effects' : kind === 'design' || kind === 'saveVoice' ? 'voice design' : kind === 'voices' ? 'voice browsing' : 'speech generation'}.`, 'ELEVENLABS_MCP_UNAVAILABLE');
    return tool;
  }
  return {
    capabilities: audioCapabilities(tools),
    prepare(p: ElevenLabsAudioRequest, payload: { text: string; model_id: string }) {
      const tool = selected(p.kind === 'speech' ? 'speech' : 'sound');
      if (p.direction && p.kind === 'speech' && !tool.inputSchema.properties?.model_id) throw new SiteHttpError(422, 'This ElevenLabs MCP speech tool does not expose model selection for performance tags. Remove the direction or use the API connection. No generation was submitted.');
      if (p.kind === 'sound' && p.durationSeconds !== undefined && !tool.inputSchema.properties?.duration_seconds) throw new SiteHttpError(422, 'This ElevenLabs MCP tool does not expose sound duration. No generation was submitted.');
      const args = toolArguments(tool, { text: payload.text, voice_id: p.voiceId, model_id: payload.model_id, output_format: 'mp3_44100_128', duration_seconds: p.durationSeconds });
      return () => session.call(tool.name, args);
    },
    async voices(search: string, cursor?: string) {
      const tool = selected('voices');
      const data = toolData(await session.call(tool.name, toolArguments(tool, { search, query: search, page_size: 100, next_page_token: cursor, cursor })));
      const rows = Array.isArray(data) ? data : data.voices || data.result?.voices || data.data?.voices;
      if (!Array.isArray(rows)) throw new Error('ElevenLabs MCP did not return a voice list.');
      return { voices: rows.filter((v: any) => v.voice_id || v.id).map((v: any) => ({ id: v.voice_id || v.id, name: v.name || v.voice_id || v.id, description: v.description, previewUrl: v.preview_url })), cursor: data.has_more ? data.next_page_token : data.next_cursor || null };
    },
    async design(description: string, text: string) {
      const tool = selected('design');
      return toolData(await session.call(tool.name, toolArguments(tool, { voice_description: description, description, text: text || undefined, auto_generate_text: !text, model_id: 'eleven_ttv_v3' })));
    },
    async saveVoice(id: string, name: string, description: string) {
      const tool = selected('saveVoice');
      return toolData(await session.call(tool.name, toolArguments(tool, { generated_voice_id: id, voice_name: name, voice_description: description, name, description })));
    },
  };
}
