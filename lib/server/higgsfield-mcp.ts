import {
  SiteHttpError,
  contentTypeForName,
  mediaPathFromReference,
  requireRecord,
} from "./common";

const PROVIDER = "higgsfield";
const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const AUTHORIZE_URL = "https://mcp.higgsfield.ai/oauth2/authorize";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";
const REGISTER_URL = "https://mcp.higgsfield.ai/oauth2/register";
const TOKEN_SKEW_MS = 60_000;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

type RuntimeEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  CINEGEN_HIGGSFIELD_TOKEN_SECRET?: string;
  CINEGEN_TOPVIEW_TOKEN_SECRET?: string;
  CINEGEN_WORKSPACE_PROVIDER_SECRET?: string;
};

type ConnectionRow = {
  client_json: string | null;
  pending_ciphertext: string | null;
  token_ciphertext: string | null;
};

type OAuthClient = { client_id: string; token_endpoint_auth_method?: string };
type OAuthToken = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
};

const CREATE_CONNECTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS provider_connections (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  client_json TEXT,
  pending_ciphertext TEXT,
  token_ciphertext TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider)
)`;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await sha256(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value: unknown, secret: string): Promise<string> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(value)),
  ));
  return JSON.stringify({ version: 1, iv: bytesToBase64(iv), data: bytesToBase64(ciphertext) });
}

async function unseal<T>(value: string | null, secret: string): Promise<T | null> {
  if (!value) return null;
  try {
    const envelope = JSON.parse(value) as { iv: string; data: string };
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
      await encryptionKey(secret),
      base64ToBytes(envelope.data),
    );
    return JSON.parse(new TextDecoder().decode(clear)) as T;
  } catch {
    throw new SiteHttpError(500, "The saved Higgsfield connection could not be opened.", "HIGGSFIELD_CONNECTION_INVALID");
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 202) return null;
  const text = await response.text();
  if (!text.trim()) return null;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const messages = text.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(messages[index]); } catch { /* keep looking */ }
    }
    return { content: [{ type: "text", text }] };
  }
  try { return JSON.parse(text); } catch { return { content: [{ type: "text", text }] }; }
}

function remoteMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const row = payload as Record<string, unknown>;
  const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : null;
  return String(nested?.message ?? row.error_description ?? row.message ?? fallback);
}

function ensureSecret(env: RuntimeEnv, workspaceId: string): string {
  const secret = env.CINEGEN_HIGGSFIELD_TOKEN_SECRET?.trim()
    || env.CINEGEN_WORKSPACE_PROVIDER_SECRET?.trim()
    || env.CINEGEN_TOPVIEW_TOKEN_SECRET?.trim();
  if (secret) return secret;
  if (workspaceId === "cinegen-local-v1") {
    return "cinegen-local-development-workspace-provider-vault-v1";
  }
  throw new SiteHttpError(503, "Higgsfield web sign-in is still being configured.", "HIGGSFIELD_SETUP_REQUIRED");
}

function normalizeOrigin(value: unknown, requestOrigin: string): string {
  try {
    const origin = typeof value === "string" ? new URL(value).origin : requestOrigin;
    if (origin !== requestOrigin) throw new Error("origin mismatch");
    if (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      throw new Error("insecure origin");
    }
    return origin;
  } catch {
    throw new SiteHttpError(400, "Higgsfield sign-in must start from this CineGen page.", "INVALID_ORIGIN");
  }
}

async function loadConnection(db: D1Database, workspaceId: string): Promise<ConnectionRow | null> {
  await db.prepare(CREATE_CONNECTIONS_TABLE).run();
  return db.prepare(`
    SELECT client_json, pending_ciphertext, token_ciphertext
    FROM provider_connections
    WHERE workspace_id = ? AND provider = ?
    LIMIT 1
  `).bind(workspaceId, PROVIDER).first<ConnectionRow>();
}

async function saveConnection(
  db: D1Database,
  workspaceId: string,
  values: Partial<ConnectionRow>,
): Promise<void> {
  const current = await loadConnection(db, workspaceId);
  await db.prepare(`
    INSERT INTO provider_connections (
      workspace_id, provider, client_json, pending_ciphertext, token_ciphertext, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, provider) DO UPDATE SET
      client_json = excluded.client_json,
      pending_ciphertext = excluded.pending_ciphertext,
      token_ciphertext = excluded.token_ciphertext,
      updated_at = excluded.updated_at
  `).bind(
    workspaceId,
    PROVIDER,
    values.client_json !== undefined ? values.client_json : current?.client_json ?? null,
    values.pending_ciphertext !== undefined ? values.pending_ciphertext : current?.pending_ciphertext ?? null,
    values.token_ciphertext !== undefined ? values.token_ciphertext : current?.token_ciphertext ?? null,
    new Date().toISOString(),
  ).run();
}

async function fetchJson(url: string, init: RequestInit, fallback: string): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, init); } catch {
    throw new SiteHttpError(502, "Could not reach Higgsfield. Try again shortly.", "HIGGSFIELD_UNREACHABLE");
  }
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new SiteHttpError(502, remoteMessage(payload, fallback), "HIGGSFIELD_REMOTE_ERROR");
  }
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

async function registerClient(redirectUri: string): Promise<OAuthClient> {
  const payload = await fetchJson(REGISTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "CineGen Cloud",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }, "Higgsfield could not register CineGen for sign-in.");
  if (typeof payload.client_id !== "string" || !payload.client_id) {
    throw new SiteHttpError(502, "Higgsfield did not return a sign-in client.", "HIGGSFIELD_CLIENT_INVALID");
  }
  return { client_id: payload.client_id, token_endpoint_auth_method: String(payload.token_endpoint_auth_method ?? "none") };
}

async function exchangeToken(params: URLSearchParams): Promise<OAuthToken> {
  const payload = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }, "Higgsfield sign-in could not be completed.");
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new SiteHttpError(502, "Higgsfield did not return an access token.", "HIGGSFIELD_TOKEN_INVALID");
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    access_token: payload.access_token,
    ...(typeof payload.refresh_token === "string" ? { refresh_token: payload.refresh_token } : {}),
    token_type: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    expires_in: expiresIn,
    expires_at: Date.now() + Math.max(60, expiresIn) * 1000,
  };
}

async function accessToken(env: RuntimeEnv, workspaceId: string): Promise<string> {
  const secret = ensureSecret(env, workspaceId);
  const row = await loadConnection(env.DB, workspaceId);
  let token = await unseal<OAuthToken>(row?.token_ciphertext ?? null, secret);
  if (!token?.access_token) {
    throw new SiteHttpError(401, "Connect Higgsfield in Settings before generating.", "HIGGSFIELD_NOT_CONNECTED");
  }
  if (!token.expires_at || token.expires_at - TOKEN_SKEW_MS > Date.now()) return token.access_token;
  if (!token.refresh_token || !row?.client_json) {
    throw new SiteHttpError(401, "Higgsfield sign-in expired. Reconnect it in Settings.", "HIGGSFIELD_AUTH_EXPIRED");
  }
  const client = JSON.parse(row.client_json) as OAuthClient;
  token = await exchangeToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: client.client_id,
    resource: MCP_URL,
  }));
  await saveConnection(env.DB, workspaceId, { token_ciphertext: await seal(token, secret) });
  return token.access_token;
}

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: { required?: string[]; properties?: Record<string, Record<string, unknown>> };
};

async function mcpRequest(token: string, message: unknown, sessionId?: string): Promise<{ payload: Record<string, unknown>; sessionId?: string }> {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new SiteHttpError(response.status === 401 ? 401 : 502, remoteMessage(payload, "Higgsfield MCP request failed."), "HIGGSFIELD_MCP_ERROR");
  }
  const row = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (row.error) throw new SiteHttpError(502, remoteMessage(row, "Higgsfield MCP returned an error."), "HIGGSFIELD_MCP_ERROR");
  return { payload: row, sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}

async function mcpTools(token: string): Promise<{ tools: McpTool[]; sessionId?: string }> {
  const initialized = await mcpRequest(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "CineGen Cloud", version: "1.0.0" },
    },
  });
  await mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized" }, initialized.sessionId);
  const listed = await mcpRequest(token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, initialized.sessionId);
  const result = listed.payload.result && typeof listed.payload.result === "object"
    ? listed.payload.result as Record<string, unknown>
    : {};
  return { tools: Array.isArray(result.tools) ? result.tools as McpTool[] : [], sessionId: listed.sessionId };
}

function selectTool(tools: McpTool[], outputType: string, mode = "generate"): McpTool {
  const scored = tools.map((tool) => {
    const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
    let score = 0;
    if (text.includes(mode)) score += 12;
    if (mode === "generate" && /(generate|create|render)/.test(text)) score += 8;
    if (text.includes(outputType)) score += 8;
    if (mode !== "list" && /(list|search|status|balance|upload|delete)/.test(text)) score -= 12;
    return { tool, score };
  }).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score <= 0) {
    throw new SiteHttpError(422, `Higgsfield does not currently expose a ${outputType} ${mode} tool.`, "HIGGSFIELD_TOOL_UNAVAILABLE");
  }
  return scored[0].tool;
}

function setFirst(target: Record<string, unknown>, properties: Record<string, Record<string, unknown>>, names: string[], value: unknown) {
  if (value === undefined || value === null || value === "") return;
  const name = names.find((candidate) => candidate in properties);
  if (name) target[name] = value;
}

async function mediaReference(value: string, env: RuntimeEnv, workspaceId: string): Promise<string> {
  if (!value.startsWith("/") && !value.includes("/media/")) return value;
  const path = mediaPathFromReference(value);
  const object = await env.MEDIA.get(`workspaces/${workspaceId}/${path}`);
  if (!object) throw new SiteHttpError(404, "An Element reference image could not be found.", "MEDIA_NOT_FOUND");
  if (object.size > MAX_REFERENCE_BYTES) {
    throw new SiteHttpError(413, "An Element reference is too large for Higgsfield. Use an image under 8 MB.", "REFERENCE_TOO_LARGE");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const mime = object.httpMetadata?.contentType || contentTypeForName(path);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function toolArguments(tool: McpTool, value: unknown, env: RuntimeEnv, workspaceId: string): Promise<Record<string, unknown>> {
  const params = requireRecord(value, "Higgsfield generation parameters");
  const properties = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};
  const extra = params.params && typeof params.params === "object" && !Array.isArray(params.params)
    ? params.params as Record<string, unknown>
    : {};
  for (const [key, entry] of Object.entries(extra)) {
    if (key in properties && !/api.?key|token|secret/i.test(key)) args[key] = entry;
  }
  setFirst(args, properties, ["prompt", "text", "description"], params.prompt);
  setFirst(args, properties, ["model", "model_id", "modelId"], params.model);
  setFirst(args, properties, ["output_type", "media_type", "type"], params.outputType ?? "video");
  setFirst(args, properties, ["duration", "duration_seconds", "durationSec"], extra.duration ?? params.durationSec);
  setFirst(args, properties, ["aspect_ratio", "aspectRatio"], extra.aspect_ratio ?? params.aspectRatio);
  setFirst(args, properties, ["resolution", "quality"], extra.resolution ?? params.resolution);
  setFirst(args, properties, ["generate_audio", "audio"], extra.generate_audio);

  const rawMedias = Array.isArray(params.medias) ? params.medias : [];
  const references = await Promise.all(rawMedias.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    return typeof row.value === "string" && row.value ? [{ value: row.value, role: String(row.role ?? "image") }] : [];
  }).map(async (entry) => ({ ...entry, value: await mediaReference(entry.value, env, workspaceId) })));
  if (references.length) {
    const field = ["reference_images", "image_urls", "images", "references", "medias", "media"]
      .find((name) => name in properties);
    if (field) {
      const itemType = properties[field]?.items && typeof properties[field].items === "object"
        ? (properties[field].items as Record<string, unknown>).type
        : "string";
      args[field] = itemType === "object"
        ? references.map((entry) => ({ url: entry.value, role: entry.role }))
        : references.map((entry) => entry.value);
    } else {
      setFirst(args, properties, ["reference_image", "image_url", "start_image"], references[0].value);
    }
  }
  return args;
}

function strings(value: unknown, values: string[] = []): string[] {
  if (typeof value === "string") values.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, values));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => strings(entry, values));
  return values;
}

function parseGeneration(value: unknown): { url?: string; jobId?: string; mediaType?: "image" | "video" | "audio" | "text" | "3d"; text?: string } {
  const all = strings(value);
  const url = all.flatMap((entry) => entry.match(/https:\/\/[^\s"'<>]+/g) ?? [])
    .find((entry) => !/higgsfield\.ai\/(?:account|login|settings)/i.test(entry));
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const structured = row.structuredContent && typeof row.structuredContent === "object"
    ? row.structuredContent as Record<string, unknown>
    : {};
  const jobId = [structured.job_id, structured.jobId, structured.generation_id, structured.generationId]
    .find((entry) => typeof entry === "string") as string | undefined;
  const mediaType = url && /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(url) ? "image"
    : url && /\.(mp3|wav|m4a|ogg)(?:\?|$)/i.test(url) ? "audio"
      : url ? "video" : undefined;
  return { url, jobId, mediaType, ...(!url && all.length ? { text: all.join("\n") } : {}) };
}

async function callTool(token: string, sessionId: string | undefined, tool: McpTool, args: Record<string, unknown>) {
  const called = await mcpRequest(token, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: tool.name, arguments: args },
  }, sessionId);
  const result = called.payload.result ?? called.payload;
  return { result, sessionId: called.sessionId };
}

export function createHiggsfieldMcp(env: RuntimeEnv, workspaceId: string, requestOrigin: string) {
  return {
    async accountStatus() {
      try {
        const token = await accessToken(env, workspaceId);
        return { connected: Boolean(token) };
      } catch (error) {
        if (error instanceof SiteHttpError && ["HIGGSFIELD_NOT_CONNECTED", "HIGGSFIELD_SETUP_REQUIRED"].includes(error.code)) {
          return { connected: false, ...(error.code === "HIGGSFIELD_SETUP_REQUIRED" ? { error: error.message } : {}) };
        }
        return { connected: false, error: error instanceof Error ? error.message : "Higgsfield connection failed." };
      }
    },

    async authLogin(originValue: unknown) {
      const secret = ensureSecret(env, workspaceId);
      const origin = normalizeOrigin(originValue, requestOrigin);
      const redirectUri = `${origin}/api/higgsfield/oauth/callback`;
      const row = await loadConnection(env.DB, workspaceId);
      const client = row?.client_json ? JSON.parse(row.client_json) as OAuthClient : await registerClient(redirectUri);
      const verifier = base64Url(randomBytes(48));
      const state = base64Url(randomBytes(32));
      const challenge = base64Url(await sha256(verifier));
      await saveConnection(env.DB, workspaceId, {
        client_json: JSON.stringify(client),
        pending_ciphertext: await seal({ state, verifier, redirectUri, createdAt: Date.now() }, secret),
      });
      const authorization = new URL(AUTHORIZE_URL);
      authorization.search = new URLSearchParams({
        response_type: "code",
        response_mode: "query",
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope: "openid email offline_access",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: MCP_URL,
      }).toString();
      return { connected: false, authorizationUrl: authorization.href };
    },

    async authLogout() {
      await saveConnection(env.DB, workspaceId, { pending_ciphertext: null, token_ciphertext: null });
    },

    async generate(value: unknown) {
      const token = await accessToken(env, workspaceId);
      const params = requireRecord(value, "Higgsfield generation parameters");
      const outputType = typeof params.outputType === "string" ? params.outputType : "video";
      const { tools, sessionId } = await mcpTools(token);
      const tool = selectTool(tools, outputType);
      const args = await toolArguments(tool, params, env, workspaceId);
      const called = await callTool(token, sessionId, tool, args);
      const parsed = parseGeneration(called.result);
      if (!parsed.url) {
        throw new SiteHttpError(502, parsed.text || "Higgsfield accepted the request but did not return a finished media URL.", "HIGGSFIELD_RESULT_UNAVAILABLE");
      }
      return {
        ...parsed,
        mediaType: parsed.mediaType ?? outputType,
        model: typeof params.model === "string" ? params.model : "auto",
      };
    },

    async quickEdit(value: unknown) {
      const params = requireRecord(value, "Higgsfield edit parameters");
      return this.generate({
        prompt: params.prompt,
        model: params.model,
        outputType: params.outputType ?? "image",
        medias: typeof params.fileRef === "string" ? [{ value: params.fileRef, role: "image" }] : [],
        params,
      });
    },

    async generateList() {
      const token = await accessToken(env, workspaceId);
      const { tools, sessionId } = await mcpTools(token);
      const tool = selectTool(tools, "generation", "list");
      const called = await callTool(token, sessionId, tool, {});
      const result = called.result && typeof called.result === "object" ? called.result as Record<string, unknown> : {};
      const structured = result.structuredContent && typeof result.structuredContent === "object"
        ? result.structuredContent as Record<string, unknown>
        : result;
      const list = Object.values(structured).find(Array.isArray);
      return Array.isArray(list) ? list : [];
    },
  };
}

export async function handleHiggsfieldCallback(request: Request, env: RuntimeEnv, workspaceId: string): Promise<Response> {
  try {
    const secret = ensureSecret(env, workspaceId);
    const url = new URL(request.url);
    if (url.searchParams.get("error")) {
      throw new SiteHttpError(400, url.searchParams.get("error_description") || "Higgsfield authorization was cancelled.", "HIGGSFIELD_AUTH_CANCELLED");
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const row = await loadConnection(env.DB, workspaceId);
    const pending = await unseal<{ state: string; verifier: string; redirectUri: string; createdAt: number }>(row?.pending_ciphertext ?? null, secret);
    if (!code || !state || !pending || state !== pending.state || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      throw new SiteHttpError(400, "This Higgsfield sign-in link is invalid or expired.", "HIGGSFIELD_AUTH_INVALID");
    }
    if (!row?.client_json) throw new SiteHttpError(400, "Higgsfield client information is missing.", "HIGGSFIELD_CLIENT_INVALID");
    const client = JSON.parse(row.client_json) as OAuthClient;
    const token = await exchangeToken(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      resource: MCP_URL,
    }));
    await saveConnection(env.DB, workspaceId, {
      pending_ciphertext: null,
      token_ciphertext: await seal(token, secret),
    });
    return new Response(`<!doctype html><html><head><title>Higgsfield connected</title></head><body style="font-family:system-ui;background:#101116;color:#f4f1ea;padding:48px"><h1>Higgsfield connected</h1><p>You can close this window and return to CineGen.</p><script>setTimeout(()=>window.close(),700)</script></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Higgsfield sign-in failed.";
    return new Response(`<!doctype html><html><head><title>Higgsfield sign-in failed</title></head><body style="font-family:system-ui;background:#101116;color:#f4f1ea;padding:48px"><h1>Higgsfield sign-in failed</h1><p>${message.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char))}</p></body></html>`, {
      status: error instanceof SiteHttpError ? error.status : 500,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
