/// <reference path="../../../backend/env.d.ts" />
import { SiteHttpError, assertId, requireRecord } from './common';
import { audioEnhancePrompt, enhancedAudioText, type AudioEnhanceKind } from '../../../src/lib/elevenlabs/enhance-prompt';

type EnhanceEnv = Pick<Cloudflare.Env, 'DB'> & Partial<Pick<Cloudflare.Env, 'AI'>>;
const TABLE = `CREATE TABLE IF NOT EXISTS audio_prompt_enhancements (workspace_id TEXT NOT NULL, request_id TEXT NOT NULL, input_json TEXT NOT NULL, status TEXT NOT NULL, text TEXT, error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(workspace_id, request_id))`;
type Job = { input_json: string; status: 'running' | 'complete' | 'error'; text: string | null; error: string | null; updated_at: number };

export function createAudioEnhancer(env: EnhanceEnv, workspace: string) {
  return async (value: unknown) => {
    const p = requireRecord(value, 'Prompt enhancement');
    const requestId = assertId(p.requestId, 'enhancement request ID');
    if (typeof p.kind !== 'string' || !['voice', 'direction', 'sound'].includes(p.kind)) throw new SiteHttpError(400, 'Choose a voice description, performance direction, or sound brief.');
    const kind = p.kind as AudioEnhanceKind;
    if (typeof p.text !== 'string' || p.text.length > 12000) throw new SiteHttpError(400, 'Enter up to 12,000 characters to enhance. Your text has not been shortened.');
    if (p.feedback !== undefined && (typeof p.feedback !== 'string' || p.feedback.length > 12000)) throw new SiteHttpError(400, 'Enter up to 12,000 characters of feedback. Your text has not been shortened.');
    const feedback = typeof p.feedback === 'string' ? p.feedback.trim() : '';
    if (!p.text.trim() && !feedback) throw new SiteHttpError(400, 'Write a description or explain what you want to change.');
    if (!env.AI) throw new SiteHttpError(503, 'The prompt enhancer is temporarily unavailable. Your original text is unchanged.');
    // Preserve the request identity for clients and retries predating feedback.
    const input = JSON.stringify({ kind, text: p.text, ...(feedback ? { feedback } : {}) });
    await env.DB.prepare(TABLE).run();
    const get = () => env.DB.prepare('SELECT * FROM audio_prompt_enhancements WHERE workspace_id = ? AND request_id = ?').bind(workspace, requestId).first<Job>();
    const update = (status: string, text: string | null, error: string | null) => env.DB.prepare('UPDATE audio_prompt_enhancements SET status = ?, text = ?, error = ?, updated_at = ? WHERE workspace_id = ? AND request_id = ?').bind(status, text, error, Date.now(), workspace, requestId).run();
    const result = (j: Job) => ({ status: j.status, ...(j.text ? { text: j.text } : {}), ...(j.error ? { error: j.error } : {}) });
    const existing = await get();
    if (existing) {
      if (existing.input_json !== input) throw new SiteHttpError(409, 'This request already belongs to different wording.');
      if (existing.status === 'running' && Date.now() - existing.updated_at > 120000) {
        await update('error', null, 'The enhancer took too long. Your original text is unchanged.');
        return result((await get())!);
      }
      return result(existing);
    }
    // Persist before inference so a lost connection or double-click can recover
    // the same rewrite without starting another. This endpoint cannot create audio.
    const inserted = await env.DB.prepare('INSERT INTO audio_prompt_enhancements (workspace_id, request_id, input_json, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, request_id) DO NOTHING').bind(workspace, requestId, input, 'running', Date.now()).run();
    if (!inserted.meta.changes) return result((await get())!);
    try {
      const prompt = audioEnhancePrompt(kind, p.text, feedback);
      const answer = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0.35, max_tokens: 512,
        response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { enhanced: { type: 'string' } }, required: ['enhanced'], additionalProperties: false } },
      });
      if (!('response' in answer)) throw new Error('No rewrite returned.');
      const output = typeof answer.response === 'string' ? JSON.parse(answer.response) : answer.response;
      await update('complete', enhancedAudioText(output, kind), null);
    } catch {
      await update('error', null, 'The enhancer could not finish this rewrite. Your original text is unchanged. Try again.');
    }
    return result((await get())!);
  };
}
