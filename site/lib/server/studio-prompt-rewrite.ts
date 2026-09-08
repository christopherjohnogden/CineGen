/// <reference path="../../../backend/env.d.ts" />
import { SiteHttpError, assertId, requireRecord } from './common';
import { studioRewriteMessages, applyStudioPromptEdits, type StudioRewriteRequest, type StudioRewriteResult } from '../../../src/lib/studio/prompt-rewrite';

type RewriteEnv = Pick<Cloudflare.Env, 'DB'> & Partial<Pick<Cloudflare.Env, 'AI'>>;
type Job = StudioRewriteResult & { input_json: string; updated_at: number };
const TABLE = `CREATE TABLE IF NOT EXISTS studio_prompt_rewrites (workspace_id TEXT NOT NULL, request_id TEXT NOT NULL, input_json TEXT NOT NULL, status TEXT NOT NULL, text TEXT, error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(workspace_id, request_id))`;

export function createStudioPromptRewriter(env: RewriteEnv, workspace: string) {
  return async (value: unknown): Promise<StudioRewriteResult> => {
    const p = requireRecord(value, 'Prompt rewrite');
    const requestId = assertId(p.requestId, 'rewrite request ID');
    if (p.kind !== 'image' && p.kind !== 'video') throw new SiteHttpError(400, 'Choose an image or video prompt.');
    if (typeof p.text !== 'string' || p.text.length > 64000) throw new SiteHttpError(400, 'This prompt exceeds the AI editor’s 64,000-character capacity. Your prompt has not been shortened.');
    if (typeof p.feedback !== 'string' || !p.feedback.trim() || p.feedback.length > 12000) throw new SiteHttpError(400, 'Describe your changes in 1–12,000 characters.');
    if (!env.AI) throw new SiteHttpError(503, 'The AI editor is temporarily unavailable. Your prompt is unchanged.');
    const input: StudioRewriteRequest = { requestId, kind: p.kind, text: p.text, feedback: p.feedback.trim() };
    const identity = JSON.stringify({ kind: input.kind, text: input.text, feedback: input.feedback });
    await env.DB.prepare(TABLE).run();
    const get = () => env.DB.prepare('SELECT * FROM studio_prompt_rewrites WHERE workspace_id = ? AND request_id = ?').bind(workspace, requestId).first<Job>();
    const finish = (status: string, text: string | null, error: string | null) => env.DB.prepare("UPDATE studio_prompt_rewrites SET status = ?, text = ?, error = ?, updated_at = ? WHERE workspace_id = ? AND request_id = ? AND status = 'running'").bind(status, text, error, Date.now(), workspace, requestId).run();
    const result = (job: Job): StudioRewriteResult => ({ status: job.status, ...(job.text ? { text: job.text } : {}), ...(job.error ? { error: job.error } : {}) });
    const existing = await get();
    if (existing) {
      if (existing.input_json !== identity) throw new SiteHttpError(409, 'This request belongs to different prompt instructions.');
      if (existing.status === 'running' && Date.now() - existing.updated_at > 300000) {
        await finish('error', null, 'The AI editor took too long. Your prompt is unchanged. Try again.');
        return result((await get())!);
      }
      return result(existing);
    }
    // Persist the request before inference. Reconnecting recovers this rewrite
    // instead of paying for a second inference. No media generation is submitted.
    const inserted = await env.DB.prepare('INSERT INTO studio_prompt_rewrites (workspace_id, request_id, input_json, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, request_id) DO NOTHING').bind(workspace, requestId, identity, 'running', Date.now()).run();
    if (!inserted.meta.changes) {
      const concurrent = (await get())!;
      if (concurrent.input_json !== identity) throw new SiteHttpError(409, 'This request belongs to different prompt instructions.');
      return result(concurrent);
    }
    try {
      const answer = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
        messages: studioRewriteMessages(input), temperature: 0.3,
        max_tokens: Math.min(32768, Math.max(2048, Math.ceil((input.text.length + input.feedback.length) * 0.8) + 1024)),
        response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'], additionalProperties: false } } }, required: ['edits'], additionalProperties: false } },
      });
      if (!('response' in answer)) throw new Error('No rewrite returned.');
      const choices = 'choices' in answer && Array.isArray(answer.choices) ? answer.choices : [];
      if (('finish_reason' in answer && answer.finish_reason === 'length')
        || choices.some(choice => choice?.finish_reason === 'length')) throw new Error('Incomplete rewrite.');
      const output = typeof answer.response === 'string' ? JSON.parse(answer.response) : answer.response;
      await finish('complete', applyStudioPromptEdits(output, input.text), null);
    } catch {
      await finish('error', null, 'The AI could not finish this rewrite. Your prompt is unchanged. Try again.');
    }
    return result((await get())!);
  };
}
