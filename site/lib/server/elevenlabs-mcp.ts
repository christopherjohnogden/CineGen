import { SiteHttpError, assertId, requireRecord } from './common';

// ElevenLabs publishes these endpoints in OAuth discovery. This client uses its
// own CIMD identity; Claude's registration and credentials are never reused.
export const ELEVENLABS_ORIGIN = 'https://cinegen-api.christopherjohnogden.workers.dev';
export const ELEVENLABS_CLIENT_ID = `${ELEVENLABS_ORIGIN}/api/elevenlabs/oauth/client.json`;
const CALLBACK = `${ELEVENLABS_ORIGIN}/api/elevenlabs/oauth/callback`;
const ISSUER = 'https://api.us.elevenlabs.io';
const RESOURCE = `${ISSUER}/v1/mcp`;
const SCOPES = 'text_to_speech speech_history_read voice_generation';
type Env = { DB: D1Database; CINEGEN_WORKSPACE_PROVIDER_SECRET?: string; CINEGEN_TOPVIEW_TOKEN_SECRET?: string; CINEGEN_HIGGSFIELD_TOKEN_SECRET?: string };
type Token = { access_token: string; refresh_token?: string; expires_at: number; scope?: string; attempt: string };
type Pending = { workspace_id: string; attempt: string; verifier_ciphertext: string; browser_hash: string | null; expires_at: number; phase: string; error: string | null };
export type McpTool = { name: string; description?: string; inputSchema: { properties?: Record<string, any>; required?: string[]; [key: string]: any } };
const PENDING = 'CREATE TABLE IF NOT EXISTS elevenlabs_oauth_pending (workspace_id TEXT PRIMARY KEY, attempt TEXT UNIQUE NOT NULL, verifier_ciphertext TEXT NOT NULL, browser_hash TEXT, expires_at INTEGER NOT NULL, phase TEXT NOT NULL, error TEXT)';
const CONNECTIONS = 'CREATE TABLE IF NOT EXISTS elevenlabs_oauth_connections (workspace_id TEXT PRIMARY KEY, token_ciphertext TEXT NOT NULL, updated_at INTEGER NOT NULL)';
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const base64url = (b: Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (s: string) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
async function key(env: Env, workspace: string) {
  const secret = env.CINEGEN_WORKSPACE_PROVIDER_SECRET || env.CINEGEN_TOPVIEW_TOKEN_SECRET || env.CINEGEN_HIGGSFIELD_TOKEN_SECRET || (workspace === 'cinegen-local-v1' ? 'cinegen-local-elevenlabs-oauth-test' : '');
  if (!secret) throw new SiteHttpError(503, 'ElevenLabs connection storage is not configured.');
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env: Env, workspace: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${workspace}:elevenlabs-oauth`) }, await key(env, workspace), enc.encode(JSON.stringify(value)));
  return JSON.stringify({ iv: b64(iv), data: b64(new Uint8Array(data)) });
}
async function unseal<T>(env: Env, workspace: string, value: string): Promise<T> {
  const p = JSON.parse(value);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv), additionalData: enc.encode(`${workspace}:elevenlabs-oauth`) }, await key(env, workspace), unb64(p.data));
  return JSON.parse(new TextDecoder().decode(data));
}
async function storedToken(env: Env, workspace: string): Promise<Token | null> {
  await env.DB.prepare(CONNECTIONS).run();
  const row = await env.DB.prepare('SELECT token_ciphertext FROM elevenlabs_oauth_connections WHERE workspace_id = ?').bind(workspace).first<{ token_ciphertext: string }>();
  return row ? unseal<Token>(env, workspace, row.token_ciphertext) : null;
}
async function storeToken(env: Env, workspace: string, token: Token) {
  await env.DB.prepare(CONNECTIONS).run();
  await env.DB.prepare('INSERT INTO elevenlabs_oauth_connections (workspace_id, token_ciphertext, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET token_ciphertext = excluded.token_ciphertext, updated_at = excluded.updated_at').bind(workspace, await seal(env, workspace, token), Date.now()).run();
}
async function exchange(body: URLSearchParams) {
  const response = await fetch(`${ISSUER}/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const data = await response.json() as any;
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) throw new SiteHttpError(401, 'ElevenLabs sign-in expired or was refused. Connect ElevenLabs again.', 'ELEVENLABS_AUTH_FAILED');
  return data;
}
const refreshes = new Map<string, Promise<Token>>();
async function accessToken(env: Env, workspace: string): Promise<Token> {
  const stored = await storedToken(env, workspace);
  if (!stored) throw new SiteHttpError(401, 'Connect your ElevenLabs account to use its MCP.', 'ELEVENLABS_NOT_CONNECTED');
  if (stored.expires_at > Date.now() + 60000) return stored;
  if (!stored.refresh_token) throw new SiteHttpError(401, 'Reconnect ElevenLabs to renew access.', 'ELEVENLABS_AUTH_FAILED');
  const active = refreshes.get(workspace); if (active) return active;
  const refresh = (async () => {
    const data = await exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refresh_token!, client_id: ELEVENLABS_CLIENT_ID, resource: RESOURCE }));
    const next: Token = { ...stored, access_token: data.access_token, refresh_token: data.refresh_token || stored.refresh_token, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000, scope: data.scope || stored.scope };
    // Disconnect/reconnect while a refresh was in flight must not resurrect it.
    const current = await storedToken(env, workspace);
    if (current?.attempt !== stored.attempt) throw new SiteHttpError(401, 'The ElevenLabs connection changed. Try again.');
    await storeToken(env, workspace, next); return next;
  })();
  refreshes.set(workspace, refresh);
  try { return await refresh; } finally { refreshes.delete(workspace); }
}

export function createElevenLabsMcp(env: Env, workspace: string) {
  return {
    async connected() { return Boolean(await storedToken(env, workspace)); },
    async authLogin() {
      await env.DB.prepare(PENDING).run();
      const state = random(), attempt = await hash(state), verifier = random();
      await env.DB.prepare('INSERT INTO elevenlabs_oauth_pending (workspace_id, attempt, verifier_ciphertext, browser_hash, expires_at, phase, error) VALUES (?, ?, ?, NULL, ?, ?, NULL) ON CONFLICT(workspace_id) DO UPDATE SET attempt = excluded.attempt, verifier_ciphertext = excluded.verifier_ciphertext, browser_hash = NULL, expires_at = excluded.expires_at, phase = excluded.phase, error = NULL').bind(workspace, attempt, await seal(env, workspace, { verifier, state }), Date.now() + 600000, 'pending').run();
      return { attempt, authorizationUrl: `${ELEVENLABS_ORIGIN}/api/elevenlabs/oauth/start?state=${encodeURIComponent(state)}` };
    },
    async authCancel(value: unknown) {
      const p = requireRecord(value, 'ElevenLabs sign-in');
      await env.DB.prepare(PENDING).run();
      await env.DB.prepare('DELETE FROM elevenlabs_oauth_pending WHERE workspace_id = ? AND attempt = ?').bind(workspace, assertId(p.attempt, 'sign-in attempt')).run();
      return { cancelled: true };
    },
    async authStatus(value: unknown) {
      const p = requireRecord(value, 'ElevenLabs sign-in'), attempt = assertId(p.attempt, 'sign-in attempt');
      const token = await storedToken(env, workspace);
      if (token?.attempt === attempt) return { connected: true };
      await env.DB.prepare(PENDING).run();
      const pending = await env.DB.prepare('SELECT * FROM elevenlabs_oauth_pending WHERE workspace_id = ? AND attempt = ?').bind(workspace, attempt).first<Pending>();
      return { connected: false, ...(pending?.error ? { error: pending.error } : !pending || pending.expires_at < Date.now() ? { error: 'This sign-in expired. Connect ElevenLabs again.' } : {}) };
    },
    async disconnect() {
      const token = await storedToken(env, workspace);
      await env.DB.prepare('DELETE FROM elevenlabs_oauth_connections WHERE workspace_id = ?').bind(workspace).run();
      await env.DB.prepare(PENDING).run();
      await env.DB.prepare('DELETE FROM elevenlabs_oauth_pending WHERE workspace_id = ?').bind(workspace).run();
      if (token) {
        // Forget locally even when the provider cannot be reached.
        await fetch(`${ISSUER}/v1/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token.refresh_token || token.access_token, client_id: ELEVENLABS_CLIENT_ID }).toString(), redirect: 'manual', signal: AbortSignal.timeout(10000) }).then(r => r.body?.cancel()).catch(() => {});
      }
    },
    async session() {
      const session = await mcpSession((await accessToken(env, workspace)).access_token);
      return { ...session, async tools() {
        const tools = await session.tools();
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS elevenlabs_mcp_catalog (workspace_id TEXT PRIMARY KEY, tools_json TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
        await env.DB.prepare('INSERT INTO elevenlabs_mcp_catalog (workspace_id, tools_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET tools_json = excluded.tools_json, updated_at = excluded.updated_at').bind(workspace, JSON.stringify(tools), Date.now()).run();
        return tools;
      } };
    },
  };
}

function page(message: string, ok = false) {
  // Only fixed application messages are rendered, never provider query values.
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>ElevenLabs · CineGen</title><style>body{margin:0;background:#0d0f14;color:#eee;font:17px system-ui;display:grid;min-height:100dvh;place-items:center}main{max-width:380px;padding:32px}small{color:#d3a352;letter-spacing:.18em}h1{font-size:26px}p{color:#aaa;line-height:1.6}a{color:#d3a352}</style></head><body><main><small>CINEGEN</small><h1>${ok ? 'ElevenLabs connected' : 'ElevenLabs sign-in'}</h1><p>${message}</p><a href="https://cinegen-film.vercel.app/">Return to CineGen</a></main></body></html>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" } });
}
export async function handleElevenLabsOAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return null;
  if (url.pathname === '/api/elevenlabs/oauth/client.json') return Response.json({ client_id: ELEVENLABS_CLIENT_ID, client_name: 'CineGen', client_uri: 'https://cinegen-film.vercel.app', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPES }, { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
  if (!['/api/elevenlabs/oauth/start', '/api/elevenlabs/oauth/callback'].includes(url.pathname)) return null;
  const state = url.searchParams.get('state');
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return page('Open Connect ElevenLabs from inside CineGen to start a new sign-in.');
  const attempt = await hash(state);
  await env.DB.prepare(PENDING).run();
  const pending = await env.DB.prepare('SELECT * FROM elevenlabs_oauth_pending WHERE attempt = ?').bind(attempt).first<Pending>();
  if (!pending || pending.expires_at < Date.now() || pending.phase !== 'pending') return page('This sign-in has expired or was already used. Start again from CineGen.');
  const cookieName = `__Host-cinegen-el-${attempt}`;
  if (url.pathname.endsWith('/start')) {
    const binding = random();
    const claimed = await env.DB.prepare('UPDATE elevenlabs_oauth_pending SET browser_hash = ? WHERE attempt = ? AND browser_hash IS NULL AND phase = ?').bind(await hash(binding), attempt, 'pending').run();
    if (!claimed.meta.changes) return page('This sign-in was already opened. Start a new connection from CineGen.');
    const { verifier } = await unseal<{ verifier: string }>(env, pending.workspace_id, pending.verifier_ciphertext);
    const authorization = new URL('https://elevenlabs.io/app/oauth/authorize');
    authorization.search = new URLSearchParams({ client_id: ELEVENLABS_CLIENT_ID, redirect_uri: CALLBACK, response_type: 'code', code_challenge: await hash(verifier), code_challenge_method: 'S256', state, scope: SCOPES, resource: RESOURCE }).toString();
    return new Response(null, { status: 302, headers: { location: authorization.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'set-cookie': `${cookieName}=${binding}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` } });
  }
  const cookie = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!cookie || !pending.browser_hash || await hash(cookie) !== pending.browser_hash) return page('Complete sign-in in the same browser where you opened Connect ElevenLabs.');
  const claimed = await env.DB.prepare('UPDATE elevenlabs_oauth_pending SET phase = ? WHERE attempt = ? AND phase = ?').bind('exchanging', attempt, 'pending').run();
  if (!claimed.meta.changes) return page('This sign-in was already used. Start again from CineGen.');
  const finish = async (error: string | null) => env.DB.prepare('UPDATE elevenlabs_oauth_pending SET phase = ?, error = ? WHERE attempt = ?').bind(error ? 'error' : 'complete', error, attempt).run();
  let response: Response;
  try {
    if (url.searchParams.has('error')) throw new Error('ElevenLabs sign-in was cancelled. Connect again when ready.');
    if (url.searchParams.get('iss') !== ISSUER) throw new Error('ElevenLabs returned an unexpected sign-in issuer. Start again from CineGen.');
    const code = url.searchParams.get('code'); if (!code || code.length > 4096) throw new Error('ElevenLabs did not return an authorization code.');
    const { verifier } = await unseal<{ verifier: string }>(env, pending.workspace_id, pending.verifier_ciphertext);
    const data = await exchange(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: ELEVENLABS_CLIENT_ID, redirect_uri: CALLBACK, resource: RESOURCE }));
    const stillCurrent = await env.DB.prepare('SELECT * FROM elevenlabs_oauth_pending WHERE workspace_id = ? AND attempt = ?').bind(pending.workspace_id, attempt).first<Pending>();
    if (!stillCurrent) throw new Error('A newer connection replaced this sign-in. Return to CineGen.');
    await storeToken(env, pending.workspace_id, { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000, scope: data.scope, attempt });
    await finish(null); response = page('You can close this tab and return to your audio node. Your ElevenLabs account is now connected to CineGen.', true);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'ElevenLabs sign-in failed.';
    await finish(message);
    response = page('The connection could not finish. Return to CineGen and try Connect ElevenLabs again.');
  }
  response.headers.set('set-cookie', `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

// Read both JSON and Streamable HTTP SSE. A tools/call is sent exactly once:
// transport failures must never quietly repeat a billable generation.
export async function mcpSession(token: string) {
  let sessionId = '', protocol = '2025-03-26', nextId = 1;
  async function request(method: string, params: unknown, notification = false): Promise<any> {
    const id = notification ? undefined : nextId++;
    const response = await fetch(RESOURCE, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sessionId ? { 'mcp-session-id': sessionId } : {}), ...(method === 'initialize' ? {} : { 'mcp-protocol-version': protocol }) }, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }), redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if (!response.ok) { await response.body?.cancel(); throw new SiteHttpError(response.status === 401 ? 401 : 502, `ElevenLabs MCP could not complete the request (${response.status}).${response.status === 401 ? ' Reconnect ElevenLabs.' : ''}`, 'ELEVENLABS_MCP_ERROR'); }
    sessionId = response.headers.get('mcp-session-id') || sessionId;
    if (notification || response.status === 202) { await response.body?.cancel(); return null; }
    let message: any;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '', size = 0;
      try {
        outer: for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 48 * 1024 * 1024) throw new Error('ElevenLabs MCP response is too large.');
          buffer = (buffer + value).replace(/\r\n/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const parsed = JSON.parse(data); if (parsed.id === id) { message = parsed; break outer; }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } else message = await response.json();
    if (!message || message.id !== id) throw new Error('ElevenLabs MCP did not return a matching result.');
    if (message.error || message.result?.isError) throw new SiteHttpError(502, message.error?.message || message.result.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') || 'ElevenLabs could not complete this action.', 'ELEVENLABS_MCP_ERROR');
    return message.result;
  }
  const initialized = await request('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'CineGen', version: '1.0.0' } });
  protocol = initialized.protocolVersion || protocol;
  await request('notifications/initialized', {}, true);
  return {
    async tools(): Promise<McpTool[]> {
      const tools: McpTool[] = []; let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await request('tools/list', cursor ? { cursor } : {});
        tools.push(...(result.tools || [])); if (!result.nextCursor) return tools;
        if (result.nextCursor === cursor) throw new Error('ElevenLabs repeated a tools page.'); cursor = result.nextCursor;
      }
      throw new Error('ElevenLabs returned too many tool pages.');
    },
    call: (name: string, args: unknown) => request('tools/call', { name, arguments: args }),
  };
}
