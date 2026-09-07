import { SiteHttpError, requireRecord, assertId } from './common';
import { createWorkspaceProviderVault } from './workspace-provider-vault';
import { persistGeneratedMedia } from '../../../shared/generated-media.mjs';
import type { ElevenLabsAudioRequest, ElevenLabsAudioResult } from '../../../src/lib/elevenlabs/types';

type Env = Parameters<typeof createWorkspaceProviderVault>[0] & { MEDIA: R2Bucket };
type Identity = { token: string; uid: string };
type Job = { request_id: string; input_json: string; status: ElevenLabsAudioResult['status']; url: string | null; error: string | null; updated_at: number };
const API = 'https://api.elevenlabs.io';
const TABLE = `CREATE TABLE IF NOT EXISTS elevenlabs_audio_jobs (workspace_id TEXT NOT NULL, request_id TEXT NOT NULL, input_json TEXT NOT NULL, status TEXT NOT NULL, url TEXT, error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(workspace_id, request_id))`;
const MAX_AUDIO = 32 * 1024 * 1024;

export function audioRequest(value: unknown): ElevenLabsAudioRequest {
  const p = requireRecord(value, 'Audio request');
  const requestId = assertId(p.requestId, 'audio request ID');
  const projectId = p.projectId ? assertId(p.projectId, 'project ID') : 'voice-library';
  const kind = p.kind ?? 'speech';
  if (kind !== 'speech' && kind !== 'sound') throw new SiteHttpError(400, 'Choose speech or a sound effect.');
  const text = typeof p.text === 'string' ? p.text.trim() : '';
  if (!text) throw new SiteHttpError(400, kind === 'speech' ? 'Enter the dialogue to generate.' : 'Describe the sound to generate.');
  // Eleven v3's actual provider limit. Never truncate the user's dialogue.
  if (kind === 'speech' && text.length > 5000) throw new SiteHttpError(400, 'ElevenLabs v3 accepts up to 5,000 characters per clip. Split this dialogue into separate audio nodes.');
  if (kind === 'speech' && !p.voiceId) throw new SiteHttpError(400, 'Choose an ElevenLabs voice or a character with a saved voice.');
  const voiceId = kind === 'speech' ? assertId(p.voiceId, 'ElevenLabs voice') : undefined;
  const direction = typeof p.direction === 'string' ? p.direction.trim() : '';
  if (direction.length > 1000) throw new SiteHttpError(400, 'Keep performance direction under 1,000 characters.');
  const durationSeconds = p.durationSeconds === undefined || p.durationSeconds === null ? undefined : Number(p.durationSeconds);
  if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0.5 || durationSeconds > 30)) throw new SiteHttpError(400, 'Sound effects can be 0.5–30 seconds long.');
  const parsed = { requestId, projectId, kind, text, voiceId, direction, durationSeconds } as ElevenLabsAudioRequest;
  if (kind === 'speech' && elevenLabsPayload(parsed).text.length > 5000) throw new SiteHttpError(400, 'ElevenLabs v3 accepts up to 5,000 characters including performance tags. Split this dialogue into separate audio nodes.');
  return parsed;
}

export function elevenLabsPayload(p: ElevenLabsAudioRequest) {
  if (p.kind === 'sound') return { text: [p.text, p.direction].filter(Boolean).join('\n'), model_id: 'eleven_text_to_sound_v2', ...(p.durationSeconds === undefined ? {} : { duration_seconds: p.durationSeconds }) };
  // v3 understands bracketed performance tags. Descriptive prose must never be
  // appended as spoken dialogue; the character's identity comes from voice_id.
  const tags = (p.direction || '').replace(/[\[\]\r\n]/g, ' ').trim();
  return { text: tags ? `[${tags}] ${p.text}` : p.text, model_id: 'eleven_v3' };
}

async function api(key: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'xi-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(180000) });
  if (!response.ok) {
    let message = '';
    try { const data = await response.json() as any; message = typeof data.detail === 'string' ? data.detail : data.detail?.message || data.message || ''; } catch { /* report status without exposing credentials */ }
    throw new SiteHttpError(response.status === 401 ? 401 : 502, message || `ElevenLabs could not complete the request (${response.status}).`, 'ELEVENLABS_ERROR');
  }
  return response;
}

export function createElevenLabs(env: Env, workspaceId: string, identity?: Identity) {
  const vault = createWorkspaceProviderVault(env, workspaceId);
  const key = async () => {
    const value = await vault.get('elevenlabs');
    if (!value) throw new SiteHttpError(401, 'Connect ElevenLabs in this panel before generating.', 'ELEVENLABS_NOT_CONNECTED');
    return value;
  };
  const identityRequired = () => { if (!identity) throw new SiteHttpError(401, 'Sign in to CineGen to save your audio.'); return identity; };
  const mediaKey = (id: string) => `workspaces/${workspaceId}/elevenlabs/${id}.mp3`;
  const get = async (id: string) => { await env.DB.prepare(TABLE).run(); return env.DB.prepare('SELECT * FROM elevenlabs_audio_jobs WHERE workspace_id = ? AND request_id = ?').bind(workspaceId, id).first<Job>(); };
  const update = async (id: string, status: string, url: string | null, error: string | null) => { await env.DB.prepare('UPDATE elevenlabs_audio_jobs SET status = ?, url = ?, error = ?, updated_at = ? WHERE workspace_id = ? AND request_id = ?').bind(status, url, error, Date.now(), workspaceId, id).run(); };
  const result = (j: Job): ElevenLabsAudioResult => ({ requestId: j.request_id, assetId: j.request_id, status: j.status, ...(j.url ? { url: j.url } : {}), ...(j.error ? { error: j.error } : {}) });
  const save = async (j: Job): Promise<ElevenLabsAudioResult> => {
    const who = identityRequired();
    const stored = await env.MEDIA.get(mediaKey(j.request_id));
    if (!stored) return result(j);
    const p = JSON.parse(j.input_json) as ElevenLabsAudioRequest;
    try {
      const url = await persistGeneratedMedia({ source: '', token: who.token, ownerId: who.uid, projectId: p.projectId!, assetId: j.request_id, type: 'audio', provider: 'elevenlabs', audioExtension: 'mp3' }, async () => new Response(stored.body, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(stored.size) } }));
      await update(j.request_id, 'complete', url, null);
      return { requestId: j.request_id, assetId: j.request_id, status: 'complete', url };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Audio could not be saved.';
      await update(j.request_id, 'saving', null, error);
      return { requestId: j.request_id, assetId: j.request_id, status: 'saving', error: `${error} Check again to finish saving this same audio.` };
    } finally { if (!stored.bodyUsed) await stored.body.cancel().catch(() => {}); }
  };
  return {
    async accountStatus() { return { connected: Boolean(await vault.get('elevenlabs')), provider: 'elevenlabs' }; },
    async connect(value: unknown) {
      const p = requireRecord(value, 'ElevenLabs connection');
      const secret = typeof p.secret === 'string' ? p.secret.trim() : '';
      if (!secret || secret.length > 4096) throw new SiteHttpError(400, 'Enter your ElevenLabs API key.');
      const response = await api(secret, '/v2/voices?page_size=1'); await response.body?.cancel();
      await vault.save({ provider: 'elevenlabs', secret });
      return { connected: true, provider: 'elevenlabs' };
    },
    async disconnect() { await vault.remove({ provider: 'elevenlabs' }); return { connected: false }; },
    async voices(value: unknown) {
      const p = requireRecord(value ?? {}, 'Voice search');
      const query = new URLSearchParams({ page_size: '100', ...(typeof p.search === 'string' && p.search ? { search: p.search } : {}), ...(typeof p.cursor === 'string' && p.cursor ? { next_page_token: p.cursor } : {}) });
      const data = await (await api(await key(), `/v2/voices?${query}`)).json() as any;
      return { voices: (data.voices || []).map((v: any) => ({ id: v.voice_id, name: v.name, description: v.description, previewUrl: v.preview_url })), cursor: data.has_more ? data.next_page_token : null };
    },
    async generate(value: unknown): Promise<ElevenLabsAudioResult> {
      identityRequired();
      const p = audioRequest(value), input = JSON.stringify(p), apiKey = await key();
      const existing = await get(p.requestId);
      if (existing) {
        if (existing.input_json !== input) throw new SiteHttpError(409, 'This request already belongs to another take. Start a new take for changed dialogue.');
        return existing.status === 'saving' ? save(existing) : result(existing);
      }
      const locked = await env.DB.prepare('INSERT OR IGNORE INTO elevenlabs_audio_jobs (workspace_id, request_id, input_json, status, updated_at) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, p.requestId, input, 'generating', Date.now()).run();
      if (!locked.meta.changes) return result((await get(p.requestId))!);
      try {
        const response = await api(apiKey, p.kind === 'sound' ? '/v1/sound-generation?output_format=mp3_44100_128' : `/v1/text-to-speech/${encodeURIComponent(p.voiceId!)}?output_format=mp3_44100_128`, elevenLabsPayload(p));
        if (!response.headers.get('content-type')?.startsWith('audio/') || !response.body) { await response.body?.cancel(); throw new Error('ElevenLabs did not return an audio file.'); }
        if (Number(response.headers.get('content-length')) > MAX_AUDIO) { await response.body.cancel(); throw new Error('This audio exceeds the 32 MB limit.'); }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > MAX_AUDIO) throw new Error('This audio exceeds the 32 MB limit.');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        if (!size) throw new Error('ElevenLabs returned an empty audio file.');
        // R2 requires a known-length body. Bound the audio before assembling it.
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        await env.MEDIA.put(mediaKey(p.requestId), bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
        await update(p.requestId, 'saving', null, null);
        return save((await get(p.requestId))!);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Audio generation was interrupted.';
        // A transport failure has an unknown billing outcome. Never auto-submit again.
        await update(p.requestId, 'error', null, message);
        return { requestId: p.requestId, assetId: p.requestId, status: 'error', error: message };
      }
    },
    async job(value: unknown): Promise<ElevenLabsAudioResult> {
      const p = requireRecord(value, 'Audio job');
      const j = await get(assertId(p.requestId, 'audio request ID'));
      if (!j) throw new SiteHttpError(404, 'This audio request was not submitted. Generate it when ready.', 'AUDIO_NOT_FOUND');
      if (j.status === 'saving' || (j.status === 'error' && await env.MEDIA.head(mediaKey(j.request_id)))) return save(j);
      if (j.status === 'generating' && Date.now() - j.updated_at > 240000) return { ...result(j), status: 'error', error: 'The audio request was interrupted. Check ElevenLabs history before starting another take; it may have been charged.' };
      return result(j);
    },
    async design(value: unknown) {
      const who = identityRequired(), p = requireRecord(value, 'Voice design');
      const description = typeof p.description === 'string' ? p.description.trim() : '';
      if (description.length < 20 || description.length > 1000) throw new SiteHttpError(400, 'Describe the voice in 20–1,000 characters.');
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      if (text && (text.length < 100 || text.length > 1000)) throw new SiteHttpError(400, 'For voice design, use 100–1,000 characters of sample dialogue, or leave it empty for an automatic sample.');
      const data = await (await api(await key(), '/v1/text-to-voice/design', { voice_description: description, model_id: 'eleven_ttv_v3', ...(text ? { text } : { auto_generate_text: true }) })).json() as any;
      const previews = [];
      for (const preview of data.previews || []) {
        if (!preview.generated_voice_id || typeof preview.audio_base_64 !== 'string') continue;
        if (preview.audio_base_64.length > 24 * 1024 * 1024) throw new Error('Voice preview is too large.');
        const bytes = Uint8Array.from(atob(preview.audio_base_64), c => c.charCodeAt(0));
        const url = await persistGeneratedMedia({ source: '', token: who.token, ownerId: who.uid, projectId: 'voice-library', assetId: crypto.randomUUID(), type: 'audio', provider: 'elevenlabs', audioExtension: 'mp3' }, async () => new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }));
        previews.push({ id: preview.generated_voice_id, url });
      }
      if (!previews.length) throw new Error('ElevenLabs did not return voice previews.');
      return { previews, text: data.text || text };
    },
    async saveVoice(value: unknown) {
      const p = requireRecord(value, 'Voice selection');
      const id = assertId(p.id, 'generated voice ID');
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name) throw new SiteHttpError(400, 'Give this voice a name.');
      const data = await (await api(await key(), '/v1/text-to-voice', { voice_name: name, voice_description: String(p.description || ''), generated_voice_id: id })).json() as any;
      return { id: data.voice_id, name: data.name || name };
    },
  };
}
