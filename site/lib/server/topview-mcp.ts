import {
  SiteHttpError,
  contentTypeForName,
  mediaPathFromReference,
  requireRecord,
} from "./common";

const PROVIDER = "topview";
const MCP_URL = "https://mcp.topview.ai/mcp";
const MCP_RESOURCE = "https://mcp.topview.ai";
const AUTHORIZE_URL = "https://www.topview.ai/mcp_oauth/oauth/authorize";
const TOKEN_URL = "https://www.topview.ai/mcp_oauth/oauth/token";
const REGISTER_URL = "https://www.topview.ai/mcp_oauth/oauth/register";
const DEVICE_INIT_URL = "https://www.topview.ai/oauth/api/device/init";
const DEVICE_CLIENT_ID = "topview-skill";
const DEVICE_SCOPE = "read:profile read:billing read:apikey";
const TOKEN_SKEW_MS = 60_000;
const MAX_REFERENCE_BYTES = 45 * 1024 * 1024;
const VIDEO_TIMEOUT_MS = 20 * 60 * 1000;
const IMAGE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
// Legacy recovery searches only a bounded recent slice of the user's CineGen
// boards. It never falls through to a paid generation submission.
const RECOVERY_BOARD_PAGE_SIZE = 100;
const RECOVERY_MAX_BOARD_PAGES = 5;
const RECOVERY_MAX_BOARDS = 50;
const RECOVERY_TASK_PAGE_SIZE = 50;
const RECOVERY_MAX_TASKS = 200;

type JsonRecord = Record<string, unknown>;

type RuntimeEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  CINEGEN_TOPVIEW_TOKEN_SECRET?: string;
  CINEGEN_HIGGSFIELD_TOKEN_SECRET?: string;
  CINEGEN_WORKSPACE_PROVIDER_SECRET?: string;
};

type ConnectionRow = {
  client_json: string | null;
  pending_ciphertext: string | null;
  token_ciphertext: string | null;
};

type OAuthClient = {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method?: string;
  redirect_uri: string;
  auth_mode?: "oauth" | "api_key";
  topview_uid?: string;
  topview_email?: string;
};

type OAuthToken = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: JsonRecord;
};

type McpSession = {
  token: string;
  uid?: string;
  sessionId?: string;
  tools: McpTool[];
};

type AuthContext = {
  token: string;
  uid?: string;
};

type PendingDeviceAuthorization = {
  flow: "device";
  deviceCode: string;
  tokenEndpoint: string;
  createdAt: number;
  expiresAt: number;
};

type MediaInput = {
  value: string;
  role: string;
};

type UploadedMedia = MediaInput & {
  fileId: string;
  kind: "image" | "video" | "audio";
};

type TopviewVideoTaskType = "text_to_video" | "image_to_video" | "omni_reference";

type VideoRecoveryCriteria = {
  projectId: string;
  nodeId: string;
  prompt: string;
  model: string;
  durationSec: number;
  resolution: number;
  aspectRatio: string;
  sound: "on" | "off";
  expectedReferenceCount: number;
  taskType: TopviewVideoTaskType;
};

type RecoveryBoard = {
  boardId: string;
  name: string;
  taskCount?: number;
  gmtCreate?: string;
};

type RecoveryCandidate = {
  boardId: string;
  boardTaskId: string;
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    throw new SiteHttpError(
      500,
      "The saved Topview connection could not be opened.",
      "TOPVIEW_CONNECTION_INVALID",
    );
  }
}

function parseSse(text: string, expectedId: unknown): unknown {
  const messages: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try { messages.push(JSON.parse(data)); } catch { /* ignore keepalives */ }
  }
  return messages.find((entry) => isRecord(entry) && entry.id === expectedId)
    ?? messages.find((entry) => isRecord(entry) && (entry.result !== undefined || entry.error !== undefined))
    ?? messages.at(-1);
}

async function responsePayload(response: Response, expectedId?: unknown): Promise<unknown> {
  if (response.status === 204 || response.status === 202) return null;
  const text = await response.text();
  if (!text.trim()) return null;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return parseSse(text, expectedId);
  }
  try { return JSON.parse(text); } catch { return text; }
}

function remoteMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!isRecord(payload)) return fallback;
  const nested = isRecord(payload.error) ? payload.error : null;
  const detail = nested?.message ?? payload.error_description ?? payload.message ?? payload.error;
  return typeof detail === "string" && detail.trim() ? detail.trim() : fallback;
}

function ensureSecret(env: RuntimeEnv, workspaceId: string): string {
  const secret = env.CINEGEN_TOPVIEW_TOKEN_SECRET?.trim()
    || env.CINEGEN_WORKSPACE_PROVIDER_SECRET?.trim()
    || env.CINEGEN_HIGGSFIELD_TOKEN_SECRET?.trim();
  if (secret) return secret;
  if (workspaceId === "cinegen-local-v1") {
    return "cinegen-local-development-workspace-provider-vault-v1";
  }
  throw new SiteHttpError(
    503,
    "Topview web sign-in is still being configured.",
    "TOPVIEW_SETUP_REQUIRED",
  );
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
    throw new SiteHttpError(
      400,
      "Topview sign-in must start from this CineGen page.",
      "INVALID_ORIGIN",
    );
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

async function fetchJson(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<JsonRecord> {
  let response: Response;
  try { response = await fetch(url, init); } catch {
    throw new SiteHttpError(502, "Could not reach Topview. Try again shortly.", "TOPVIEW_UNREACHABLE");
  }
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new SiteHttpError(502, remoteMessage(payload, fallback), "TOPVIEW_REMOTE_ERROR");
  }
  return isRecord(payload) ? payload : {};
}

function trustedDeviceEndpoint(value: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new SiteHttpError(502, "Topview returned an invalid device sign-in endpoint.", "TOPVIEW_DEVICE_INVALID");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "www.topview.ai"
    || !url.pathname.startsWith("/oauth/api/device/")
  ) {
    throw new SiteHttpError(502, "Topview returned an untrusted device sign-in endpoint.", "TOPVIEW_DEVICE_INVALID");
  }
  return url;
}

async function beginDeviceAuthorization(
  env: RuntimeEnv,
  workspaceId: string,
): Promise<string> {
  const payload = await fetchJson(DEVICE_INIT_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: DEVICE_CLIENT_ID, scope: DEVICE_SCOPE }),
  }, "Topview could not start device sign-in.");
  const deviceCode = typeof payload.device_code === "string" ? payload.device_code.trim() : "";
  const authorizationUrl = typeof payload.verification_uri_complete === "string"
    ? payload.verification_uri_complete.trim()
    : "";
  const tokenEndpoint = trustedDeviceEndpoint(payload.token_endpoint).href;
  if (!deviceCode || !authorizationUrl) {
    throw new SiteHttpError(502, "Topview did not return a complete device sign-in session.", "TOPVIEW_DEVICE_INVALID");
  }
  const authorization = new URL(authorizationUrl);
  if (authorization.protocol !== "https:" || authorization.hostname !== "www.topview.ai") {
    throw new SiteHttpError(502, "Topview returned an untrusted sign-in page.", "TOPVIEW_DEVICE_INVALID");
  }
  const expiresIn = Math.max(60, Number(payload.expires_in ?? 600));
  const pending: PendingDeviceAuthorization = {
    flow: "device",
    deviceCode,
    tokenEndpoint,
    createdAt: Date.now(),
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 600) * 1000,
  };
  await saveConnection(env.DB, workspaceId, {
    client_json: null,
    pending_ciphertext: await seal(pending, ensureSecret(env, workspaceId)),
    token_ciphertext: null,
  });
  return authorization.href;
}

async function completeDeviceAuthorization(
  env: RuntimeEnv,
  workspaceId: string,
): Promise<boolean> {
  const secret = ensureSecret(env, workspaceId);
  const row = await loadConnection(env.DB, workspaceId);
  const pending = await unseal<PendingDeviceAuthorization>(row?.pending_ciphertext ?? null, secret);
  if (!pending || pending.flow !== "device") return false;
  if (pending.expiresAt <= Date.now()) {
    await saveConnection(env.DB, workspaceId, { pending_ciphertext: null });
    return false;
  }
  const endpoint = trustedDeviceEndpoint(pending.tokenEndpoint);
  endpoint.searchParams.set("token", pending.deviceCode);
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { accept: "application/json" } });
  } catch {
    return false;
  }
  const payload = await responsePayload(response);
  if (response.status === 403 || response.status === 404 || response.status === 410) {
    await saveConnection(env.DB, workspaceId, { pending_ciphertext: null });
    return false;
  }
  if (!response.ok || !isRecord(payload)) return false;
  const status = typeof payload.status === "string" ? payload.status.toUpperCase() : "";
  if (status !== "APPROVED") return false;
  const apiKeys = Array.isArray(payload.api_keys) ? payload.api_keys : [];
  const apiKey = apiKeys.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)?.trim() ?? "";
  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
  if (!apiKey || !uid) {
    throw new SiteHttpError(502, "Topview approved sign-in without returning the team credentials.", "TOPVIEW_DEVICE_INVALID");
  }
  const client: OAuthClient = {
    client_id: DEVICE_CLIENT_ID,
    token_endpoint_auth_method: "none",
    redirect_uri: "",
    auth_mode: "api_key",
    topview_uid: uid,
    ...(typeof payload.email === "string" && payload.email.trim()
      ? { topview_email: payload.email.trim() }
      : {}),
  };
  const token: OAuthToken = { access_token: apiKey, token_type: "Bearer" };
  await saveConnection(env.DB, workspaceId, {
    client_json: JSON.stringify(client),
    pending_ciphertext: null,
    token_ciphertext: await seal(token, secret),
  });
  return true;
}

async function registerClient(redirectUri: string): Promise<OAuthClient> {
  const payload = await fetchJson(REGISTER_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "CineGen Cloud",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid email mcp:tools",
    }),
  }, "Topview could not register CineGen for sign-in.");
  if (typeof payload.client_id !== "string" || !payload.client_id) {
    throw new SiteHttpError(502, "Topview did not return a sign-in client.", "TOPVIEW_CLIENT_INVALID");
  }
  return {
    client_id: payload.client_id,
    client_secret: typeof payload.client_secret === "string" ? payload.client_secret : undefined,
    token_endpoint_auth_method: typeof payload.token_endpoint_auth_method === "string"
      ? payload.token_endpoint_auth_method
      : "none",
    redirect_uri: redirectUri,
  };
}

async function exchangeToken(
  params: URLSearchParams,
  client: OAuthClient,
  previous?: OAuthToken,
): Promise<OAuthToken> {
  params.set("client_id", client.client_id);
  if (client.client_secret) params.set("client_secret", client.client_secret);
  const payload = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }, "Topview sign-in could not be completed.");
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new SiteHttpError(502, "Topview did not return an access token.", "TOPVIEW_TOKEN_INVALID");
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === "string"
      ? payload.refresh_token
      : previous?.refresh_token,
    token_type: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scope: typeof payload.scope === "string" ? payload.scope : previous?.scope,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
    expires_at: Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  };
}

async function authContext(env: RuntimeEnv, workspaceId: string): Promise<AuthContext> {
  const secret = ensureSecret(env, workspaceId);
  const row = await loadConnection(env.DB, workspaceId);
  let token = await unseal<OAuthToken>(row?.token_ciphertext ?? null, secret);
  if (!token?.access_token) {
    throw new SiteHttpError(401, "Connect Topview in Settings before generating.", "TOPVIEW_NOT_CONNECTED");
  }
  const client = row?.client_json ? JSON.parse(row.client_json) as OAuthClient : null;
  const context = () => ({
    token: token!.access_token,
    ...(client?.auth_mode === "api_key" && client.topview_uid ? { uid: client.topview_uid } : {}),
  });
  if (!token.expires_at || token.expires_at - TOKEN_SKEW_MS > Date.now()) return context();
  if (!token.refresh_token || !client) {
    throw new SiteHttpError(401, "Topview sign-in expired. Reconnect it in Settings.", "TOPVIEW_AUTH_EXPIRED");
  }
  token = await exchangeToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    resource: MCP_RESOURCE,
  }), client, token);
  await saveConnection(env.DB, workspaceId, { token_ciphertext: await seal(token, secret) });
  return context();
}

async function mcpRequest(
  token: string,
  message: JsonRecord,
  sessionId?: string,
  uid?: string,
): Promise<{ payload: JsonRecord; sessionId?: string }> {
  let response: Response;
  try {
    response = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(uid ? { "topview-uid": uid } : {}),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(message),
    });
  } catch {
    throw new SiteHttpError(502, "Could not reach Topview MCP. Try again shortly.", "TOPVIEW_UNREACHABLE");
  }
  const payload = await responsePayload(response, message.id);
  if (!response.ok) {
    throw new SiteHttpError(
      response.status === 401 ? 401 : 502,
      remoteMessage(payload, "Topview MCP request failed."),
      "TOPVIEW_MCP_ERROR",
    );
  }
  const row = isRecord(payload) ? payload : {};
  if (row.error) {
    throw new SiteHttpError(502, remoteMessage(row, "Topview MCP returned an error."), "TOPVIEW_MCP_ERROR");
  }
  return { payload: row, sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}

async function mcpSession(auth: AuthContext): Promise<McpSession> {
  const { token, uid } = auth;
  const initialized = await mcpRequest(token, {
    jsonrpc: "2.0",
    id: `init-${crypto.randomUUID()}`,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "CineGen Cloud", version: "1.0.0" },
    },
  }, undefined, uid);
  await mcpRequest(token, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }, initialized.sessionId, uid);
  let sessionId = initialized.sessionId;
  let cursor: string | undefined;
  const tools: McpTool[] = [];
  for (let page = 0; page < 10; page += 1) {
    const listed = await mcpRequest(token, {
      jsonrpc: "2.0",
      id: `tools-${crypto.randomUUID()}`,
      method: "tools/list",
      params: cursor ? { cursor } : {},
    }, sessionId, uid);
    sessionId = listed.sessionId ?? sessionId;
    const result = isRecord(listed.payload.result) ? listed.payload.result : {};
    if (Array.isArray(result.tools)) {
      tools.push(...result.tools.filter((tool): tool is McpTool => isRecord(tool) && typeof tool.name === "string"));
    }
    cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  return { token, uid, sessionId, tools };
}

function normalizeSchemaValue(value: unknown, schema: unknown): unknown {
  if (!isRecord(schema)) return value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("boolean") && typeof value === "string") {
    if (/^(?:true|1|yes|on)$/i.test(value)) return true;
    if (/^(?:false|0|no|off)$/i.test(value)) return false;
  }
  if ((types.includes("integer") || types.includes("number")) && typeof value === "string" && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number) && (!types.includes("integer") || Number.isInteger(number))) return number;
  }
  if (types.includes("array") && Array.isArray(value)) {
    return value.map((entry) => normalizeSchemaValue(entry, schema.items));
  }
  if (types.includes("object") && isRecord(value)) return normalizeTopviewToolRequest(schema, value);
  return value;
}

export function normalizeTopviewToolRequest(inputSchema: unknown, req: JsonRecord): JsonRecord {
  if (!isRecord(inputSchema)) return { ...req };
  const topProperties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const wrapped = isRecord(topProperties.req) ? topProperties.req : undefined;
  const requestSchema = wrapped ?? inputSchema;
  const properties = isRecord(requestSchema.properties) ? requestSchema.properties : {};
  const strict = requestSchema.additionalProperties === false && Object.keys(properties).length > 0;
  const normalized: JsonRecord = {};
  for (const [key, value] of Object.entries(req)) {
    if (strict && !Object.hasOwn(properties, key)) continue;
    normalized[key] = normalizeSchemaValue(value, properties[key]);
  }
  return normalized;
}

function wrappedToolArguments(tool: McpTool, req: JsonRecord): JsonRecord {
  const properties = isRecord(tool.inputSchema?.properties) ? tool.inputSchema.properties : {};
  const normalized = normalizeTopviewToolRequest(tool.inputSchema, req);
  return Object.hasOwn(properties, "req") ? { req: normalized } : normalized;
}

function collectRecords(value: unknown, output: JsonRecord[] = [], depth = 0): JsonRecord[] {
  if (depth > 14 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectRecords(entry, output, depth + 1);
  } else if (isRecord(value)) {
    output.push(value);
    for (const entry of Object.values(value)) collectRecords(entry, output, depth + 1);
  }
  return output;
}

function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 14 || value === null || value === undefined) return output;
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output, depth + 1);
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) collectStrings(entry, output, depth + 1);
  }
  return output;
}

function parseToolDocuments(result: unknown): unknown[] {
  const documents: unknown[] = [result];
  if (!isRecord(result)) return documents;
  if (result.structuredContent !== undefined) documents.unshift(result.structuredContent);
  if (Array.isArray(result.content)) {
    for (const entry of result.content) {
      if (!isRecord(entry) || typeof entry.text !== "string") continue;
      try { documents.unshift(JSON.parse(entry.text)); } catch { documents.push(entry.text); }
    }
  }
  return documents;
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return undefined;
}

export function topviewCreditBalance(value: unknown): number | undefined {
  const wanted = new Set([
    "remaincredit", "remain_credit", "remainingcredit", "remaining_credit",
    "availablecredit", "available_credit", "creditbalance", "credit_balance",
    "credits", "credit", "balance",
  ]);
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (!wanted.has(key.toLowerCase())) continue;
      const number = typeof nested === "number" ? nested : typeof nested === "string" ? Number(nested) : Number.NaN;
      if (Number.isFinite(number)) return number;
    }
  }
  return undefined;
}

function findArrayByKey(value: unknown, keyPattern: RegExp): unknown[] | undefined {
  for (const record of collectRecords(value)) {
    for (const [key, nested] of Object.entries(record)) {
      if (keyPattern.test(key) && Array.isArray(nested)) return nested;
    }
  }
  return undefined;
}

function mediaContextMatches(key: string, outputType: "image" | "video" | "audio"): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const contexts = outputType === "image"
    ? ["image", "images", "originimage", "outputimage", "resultimage", "generatedimage", "finishedimage"]
    : outputType === "video"
      ? ["video", "videos", "originvideo", "outputvideo", "resultvideo", "generatedvideo", "finishedvideo"]
      : ["audio", "audios", "originaudio", "outputaudio", "resultaudio", "generatedaudio", "finishedaudio"];
  return contexts.includes(normalized);
}

function recordMediaMatches(record: JsonRecord, outputType: "image" | "video" | "audio"): boolean {
  const hints = [record.type, record.mediaType, record.media_type, record.mimeType, record.mime_type, record.contentType, record.content_type]
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase());
  if (hints.some((entry) => entry === outputType || entry.startsWith(`${outputType}/`))) return true;
  const format = typeof record.format === "string" ? record.format.trim().toLowerCase() : "";
  if (outputType === "image") return /^(?:png|jpe?g|webp|gif|avif)$/.test(format);
  if (outputType === "video") return /^(?:mp4|mov|webm|mkv)$/.test(format);
  return /^(?:mp3|wav|m4a|aac|ogg)$/.test(format);
}

function mediaUrlExtensionMatches(url: string, outputType: "image" | "video" | "audio"): boolean {
  if (outputType === "image") return /\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url);
  if (outputType === "video") return /\.(?:mp4|mov|webm|mkv)(?:[?#]|$)/i.test(url);
  return /\.(?:mp3|wav|m4a|aac|ogg)(?:[?#]|$)/i.test(url);
}

function resultUrls(value: unknown, outputType: "image" | "video" | "audio"): string[] {
  const keyed = new Set<string>();
  const visit = (nested: unknown, path: string[] = [], depth = 0): void => {
    if (depth > 14 || nested === null || nested === undefined) return;
    if (typeof nested === "string") {
      const key = path.at(-1) ?? "";
      if (
        /^https:\/\//i.test(nested)
        && !/(?:cover|thumbnail|thumb|poster|preview|avatar|board|account|project|workspace|edit|share|page|website)/i.test(key)
        && mediaUrlExtensionMatches(nested, outputType)
      ) keyed.add(nested);
      return;
    }
    if (Array.isArray(nested)) {
      for (const entry of nested) visit(entry, path, depth + 1);
      return;
    }
    if (!isRecord(nested)) return;

    const typedRecord = recordMediaMatches(nested, outputType);
    const typedPath = path.some((segment) => mediaContextMatches(segment, outputType));
    for (const [key, entry] of Object.entries(nested)) {
      if (typeof entry === "string" && /^https:\/\//i.test(entry)) {
        const sidecarOrNavigationKey = /(?:cover|thumbnail|thumb|poster|preview|avatar|board|account|project|workspace|edit|share|page|website)/i.test(key);
        const mediaSpecificKey = outputType === "image"
          ? /^(?:imageUrl|image_url)$/i.test(key)
          : outputType === "video"
            ? /^(?:videoUrl|video_url|finishedVideoUrl|finished_video_url|outputVideoUrl|output_video_url)$/i.test(key)
            : /^(?:audioUrl|audio_url)$/i.test(key);
        const genericResultKey = /^(?:cloudFrontUrl|cloudfront_url|downloadUrl|download_url|resultUrl|result_url|outputUrl|output_url|mediaUrl|media_url|filePath|file_path)$/i.test(key);
        // Topview's board result uses an extensionless `originVideo.url`, and
        // some query variants return `videos[].url`. Only accept a bare `url`
        // when its record or path identifies the requested media type, so a
        // board/account URL cannot become the rendered asset by accident.
        const contextualUrl = /^url$/i.test(key) && (typedRecord || typedPath);
        if (!sidecarOrNavigationKey && (mediaSpecificKey || genericResultKey || contextualUrl || mediaUrlExtensionMatches(entry, outputType))) {
          keyed.add(entry);
        }
      }
      visit(entry, [...path, key], depth + 1);
    }
  };
  visit(value);
  return [...keyed];
}

function taskStatus(value: unknown): string {
  return (findStringByKeys(value, ["status", "taskStatus", "task_status", "state"]) ?? "").toLowerCase();
}

function taskError(value: unknown, fallback: string): string {
  const message = findStringByKeys(value, [
    "errorMsg", "error_msg", "errorMessage", "error_message",
    "failureReason", "failure_reason", "error", "message",
  ]);
  return message?.slice(0, 700) || fallback;
}

function friendlyToolError(value: unknown, fallback: string, apiKeyMode = false): string {
  const message = taskError(value, fallback);
  if (/credit\s*(?:is\s*)?(?:not\s+enough|insufficient)|not\s+enough\s+credit|insufficient\s+credit/i.test(message)) {
    return apiKeyMode
      ? "This web connection is using a Topview API key with insufficient API credits. Share the owner's Topview MCP connection from CineGen Desktop to use the team's MCP plan balance."
      : "Topview says the connected MCP account has insufficient credits for this generation.";
  }
  return message;
}

async function callTool(session: McpSession, name: string, req: JsonRecord): Promise<unknown> {
  const tool = session.tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new SiteHttpError(
      422,
      `Your Topview account does not currently expose ${name}.`,
      "TOPVIEW_TOOL_UNAVAILABLE",
    );
  }
  const called = await mcpRequest(session.token, {
    jsonrpc: "2.0",
    id: `call-${crypto.randomUUID()}`,
    method: "tools/call",
    params: { name, arguments: wrappedToolArguments(tool, req) },
  }, session.sessionId, session.uid);
  session.sessionId = called.sessionId ?? session.sessionId;
  const result = called.payload.result ?? called.payload;
  if (isRecord(result) && result.isError === true) {
    throw new SiteHttpError(
      502,
      friendlyToolError(parseToolDocuments(result), `Topview could not run ${name}.`, Boolean(session.uid)),
      "TOPVIEW_TOOL_ERROR",
    );
  }
  const documents = parseToolDocuments(result);
  const coded = collectRecords(documents).find((record) => Object.hasOwn(record, "code"));
  const responseCode = coded?.code;
  if (responseCode !== undefined && String(responseCode) !== "200") {
    throw new SiteHttpError(502, friendlyToolError(documents, `Topview could not run ${name}.`, Boolean(session.uid)), "TOPVIEW_TOOL_ERROR");
  }
  return result;
}

function topviewBoard(value: unknown): { boardId: string; name?: string } | undefined {
  const boards = findArrayByKey(value, /^(?:boards|list|items|records|data|rows)$/i) ?? [];
  const candidates = boards.filter(isRecord).map((entry) => ({
    boardId: String(entry.boardId ?? entry.board_id ?? entry.id ?? "").trim(),
    name: typeof entry.name === "string"
      ? entry.name
      : typeof entry.boardName === "string" ? entry.boardName : undefined,
    isSystemDefault: entry.isSystemDefault === true || entry.is_system_default === true,
  })).filter((entry) => entry.boardId);
  return candidates.find((entry) => entry.isSystemDefault)
    ?? candidates.find((entry) => entry.name === "My First Board")
    ?? candidates[0];
}

async function chooseBoard(session: McpSession): Promise<string | undefined> {
  if (!session.tools.some((tool) => tool.name === "topview_list_boards")) return undefined;
  try {
    const listed = await callTool(session, "topview_list_boards", {
      pageNo: 1,
      pageSize: 20,
      mode: "editable-by-me",
    });
    const existing = topviewBoard(parseToolDocuments(listed));
    if (existing) return existing.boardId;
    if (!session.tools.some((tool) => tool.name === "topview_create_board")) return undefined;
    const created = await callTool(session, "topview_create_board", { name: "CineGen" });
    return findStringByKeys(parseToolDocuments(created), ["boardId", "board_id", "id"]);
  } catch {
    return undefined;
  }
}

function extensionFrom(value: string, mime?: string): string {
  const normalizedMime = (mime ?? "").split(";", 1)[0].toLowerCase();
  const byMime: Record<string, string> = {
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
  };
  if (byMime[normalizedMime]) return byMime[normalizedMime];
  let pathname = value;
  try { pathname = new URL(value, "https://cinegen.invalid").pathname; } catch { /* use raw value */ }
  const extension = pathname.split(".").at(-1)?.toLowerCase() ?? "";
  if (/^(?:png|jpe?g|bmp|webp|gif|avif|mp4|avi|mov|webm|mp3|wav|m4a|aac)$/.test(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }
  return normalizedMime.startsWith("video/") ? "mp4"
    : normalizedMime.startsWith("audio/") ? "mp3"
      : "png";
}

function mediaKind(format: string, mime?: string): "image" | "video" | "audio" {
  if ((mime ?? "").startsWith("video/") || /^(?:mp4|avi|mov|webm)$/.test(format)) return "video";
  if ((mime ?? "").startsWith("audio/") || /^(?:mp3|wav|m4a|aac)$/.test(format)) return "audio";
  return "image";
}

async function loadMedia(
  value: string,
  env: RuntimeEnv,
  workspaceId: string,
): Promise<{ bytes: Uint8Array; format: string; mime: string; kind: "image" | "video" | "audio" }> {
  const trimmed = value.trim();
  if (!trimmed) throw new SiteHttpError(400, "Topview received an empty media reference.", "INVALID_INPUT");
  if (trimmed.startsWith("data:")) {
    const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(trimmed);
    if (!match) throw new SiteHttpError(400, "Topview received an unsupported inline media reference.", "INVALID_INPUT");
    const bytes = base64ToBytes(match[2]);
    if (bytes.length > MAX_REFERENCE_BYTES) {
      throw new SiteHttpError(413, "This reference exceeds CineGen's 45 MB Topview upload safety limit.", "REFERENCE_TOO_LARGE");
    }
    const mime = match[1] || "application/octet-stream";
    const format = extensionFrom("", mime);
    return { bytes, format, mime, kind: mediaKind(format, mime) };
  }

  let url: URL;
  try { url = new URL(trimmed, "https://cinegen.invalid"); } catch {
    throw new SiteHttpError(400, "Topview received an invalid media reference.", "INVALID_INPUT");
  }
  if (url.pathname.startsWith("/media/")) {
    const path = mediaPathFromReference(trimmed);
    const object = await env.MEDIA.get(`workspaces/${workspaceId}/${path}`);
    if (!object) throw new SiteHttpError(404, "A Topview media reference could not be found.", "MEDIA_NOT_FOUND");
    if (object.size > MAX_REFERENCE_BYTES) {
      throw new SiteHttpError(413, "This reference exceeds CineGen's 45 MB Topview upload safety limit.", "REFERENCE_TOO_LARGE");
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const mime = object.httpMetadata?.contentType || contentTypeForName(path);
    const format = extensionFrom(path, mime);
    return { bytes, format, mime, kind: mediaKind(format, mime) };
  }
  if (url.protocol !== "https:") {
    throw new SiteHttpError(400, "Topview media references must use CineGen media or public HTTPS.", "INVALID_INPUT");
  }
  let response: Response | undefined;
  let remoteUrl = url;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    try {
      response = await fetch(remoteUrl, {
        redirect: "manual",
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5" },
      });
    } catch {
      throw new SiteHttpError(502, "CineGen could not download a Topview media reference.", "MEDIA_UNREACHABLE");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirect === 5) {
      throw new SiteHttpError(502, "A Topview media reference redirected too many times.", "MEDIA_UNREACHABLE");
    }
    remoteUrl = new URL(location, remoteUrl);
  }
  if (!response) {
    throw new SiteHttpError(502, "CineGen could not download a Topview media reference.", "MEDIA_UNREACHABLE");
  }
  if (!response.ok) {
    throw new SiteHttpError(502, `CineGen could not download a Topview media reference (${response.status}).`, "MEDIA_UNREACHABLE");
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_REFERENCE_BYTES) {
    throw new SiteHttpError(413, "This reference exceeds CineGen's 45 MB Topview upload safety limit.", "REFERENCE_TOO_LARGE");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) {
    throw new SiteHttpError(
      bytes.length ? 413 : 502,
      bytes.length ? "This reference exceeds CineGen's 45 MB Topview upload safety limit." : "A Topview media reference was empty.",
      bytes.length ? "REFERENCE_TOO_LARGE" : "MEDIA_UNREACHABLE",
    );
  }
  const mime = response.headers.get("content-type")?.split(";", 1)[0] || contentTypeForName(remoteUrl.pathname);
  const format = extensionFrom(remoteUrl.pathname, mime);
  return { bytes, format, mime, kind: mediaKind(format, mime) };
}

function uploadHeaders(value: unknown): Record<string, string> {
  const headerRecord = collectRecords(value).find((record) => isRecord(record.headers))?.headers;
  if (!isRecord(headerRecord)) return {};
  return Object.fromEntries(Object.entries(headerRecord)
    .filter((entry): entry is [string, string] => (
      typeof entry[1] === "string"
      && !/[\r\n]/.test(entry[0])
      && !/[\r\n]/.test(entry[1])
      && !/^(authorization|cookie|host|content-length|proxy-authorization)$/i.test(entry[0])
    )));
}

function uploadCheckPassed(value: unknown): boolean {
  let successfulResponse = false;
  for (const entry of parseToolDocuments(value)) {
    if (entry === true || entry === "true") return true;
    if (entry === false || entry === "false") return false;
    for (const record of collectRecords(entry)) {
      for (const [key, nested] of Object.entries(record)) {
        if (/^(result|ok|success|exists|ready|verified)$/i.test(key) && nested === false) return false;
        if (/^(result|ok|success|exists|ready|verified)$/i.test(key) && nested === true) successfulResponse = true;
      }
      if (String(record.code ?? "") === "200") successfulResponse = true;
    }
  }
  return successfulResponse;
}

async function uploadMedia(
  session: McpSession,
  input: MediaInput,
  env: RuntimeEnv,
  workspaceId: string,
): Promise<UploadedMedia> {
  if (input.value.startsWith("topview-file:")) {
    const fileId = input.value.slice("topview-file:".length).trim();
    if (!fileId) throw new SiteHttpError(400, "Topview received an empty file ID.", "INVALID_INPUT");
    return { ...input, fileId, kind: /video/i.test(input.role) ? "video" : /audio/i.test(input.role) ? "audio" : "image" };
  }
  const source = await loadMedia(input.value, env, workspaceId);
  let lastStatus: number | undefined;

  // Cloudflare's route to Topview's regional S3 endpoint can occasionally fail
  // before S3 returns an HTTP response. Prefer Topview's accelerated destination,
  // then request a fresh standard destination if that edge route is unavailable.
  for (const accelerated of [true, false]) {
    const credential = await callTool(session, "ta_upload_credential", {
      format: source.format,
      needAccelerateUrl: accelerated,
    });
    const documents = parseToolDocuments(credential);
    const fileId = findStringByKeys(documents, ["fileId", "file_id"]);
    const uploadUrl = findStringByKeys(documents, [
      "uploadUrl",
      "upload_url",
      "accelerateUrl",
      "accelerate_url",
      "presignedUrl",
      "presigned_url",
      "signedUrl",
      "signed_url",
    ]);
    if (!fileId || !uploadUrl || !/^https:\/\//i.test(uploadUrl)) {
      if (accelerated) continue;
      throw new SiteHttpError(502, "Topview did not return a usable upload destination.", "TOPVIEW_UPLOAD_ERROR");
    }
    const method = (findStringByKeys(documents, ["method", "httpMethod", "http_method"]) || "PUT").toUpperCase();
    if (!new Set(["PUT", "POST"]).has(method)) {
      if (accelerated) continue;
      throw new SiteHttpError(502, "Topview returned an unsupported upload method.", "TOPVIEW_UPLOAD_ERROR");
    }
    const headers = uploadHeaders(documents);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = source.mime;
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method,
        headers,
        body: new Blob([source.bytes], { type: source.mime }),
        redirect: "follow",
      });
    } catch {
      if (accelerated) continue;
      throw new SiteHttpError(502, "Topview could not upload a media reference.", "TOPVIEW_UPLOAD_ERROR");
    }
    if (!response.ok) {
      lastStatus = response.status;
      if (accelerated) continue;
      throw new SiteHttpError(502, `Topview could not upload a media reference (${response.status}).`, "TOPVIEW_UPLOAD_ERROR");
    }
    const checked = await callTool(session, "ta_upload_check_file", { fileId });
    if (uploadCheckPassed(checked)) return { ...input, fileId, kind: source.kind };
    if (!accelerated) {
      throw new SiteHttpError(502, "Topview could not verify an uploaded media reference.", "TOPVIEW_UPLOAD_ERROR");
    }
  }

  throw new SiteHttpError(
    502,
    lastStatus
      ? `Topview could not upload a media reference (${lastStatus}).`
      : "Topview could not upload a media reference.",
    "TOPVIEW_UPLOAD_ERROR",
  );
}

function configModels(value: unknown): JsonRecord[] {
  return (findArrayByKey(value, /^models$/i) ?? []).filter(isRecord);
}

function modelOptions(model: JsonRecord, field: string): unknown[] {
  const options = model.submitParameterOptions;
  if (!isRecord(options)) return [];
  const direct = options[field];
  const normalize = (values: unknown[]) => values.map((value) => {
    if (!isRecord(value)) return value;
    return value.value ?? value.id ?? value.name ?? value.label;
  }).filter((value) => value !== undefined && value !== null);
  if (Array.isArray(direct)) return normalize(direct);
  if (isRecord(direct)) {
    for (const key of ["values", "options", "enum", "allowedValues"]) {
      if (Array.isArray(direct[key])) return normalize(direct[key]);
    }
  }
  return [];
}

function modelAllowedFields(model: JsonRecord): Set<string> {
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const required = Array.isArray(model.requiredSubmitFields)
    ? model.requiredSubmitFields.filter((entry): entry is string => typeof entry === "string")
    : [];
  const options = isRecord(model.submitParameterOptions) ? Object.keys(model.submitParameterOptions) : [];
  return new Set([...Object.keys(defaults), ...required, ...options]);
}

function soundCapability(model: JsonRecord): boolean | undefined {
  if (model.nativeAudio === false || model.supportsNativeAudio === false) return false;
  if (model.nativeAudio === true || model.supportsNativeAudio === true) return true;
  if (modelAllowedFields(model).has("sound")) return true;
  return undefined;
}

function selectModel(
  value: unknown,
  requestedModel: unknown,
  outputType: "image" | "video",
  needsSound = false,
): JsonRecord {
  const models = configModels(value);
  const requested = typeof requestedModel === "string" ? requestedModel.trim().toLowerCase() : "";
  if (requested && requested !== "auto") {
    const matched = models.find((model) => [model.submitModel, model.displayName, model.backendModelCode, model.name]
      .some((entry) => typeof entry === "string" && entry.trim().toLowerCase() === requested));
    if (!matched) {
      throw new SiteHttpError(422, `Topview model '${requestedModel}' is not available for this request.`, "TOPVIEW_MODEL_UNAVAILABLE");
    }
    if (needsSound && soundCapability(matched) === false) {
      throw new SiteHttpError(422, `Topview model '${requestedModel}' does not support native audio.`, "TOPVIEW_PARAMETERS_INVALID");
    }
    return matched;
  }
  const preferred = findStringByKeys(value, ["preferredSubmitModel", "preferred_submit_model"]);
  const selected = models.find((model) => model.submitModel === preferred)
    ?? models.find((model) => model.preferred === true)
    ?? models[0];
  if (!selected || typeof selected.submitModel !== "string" || !selected.submitModel.trim()) {
    throw new SiteHttpError(502, `Topview returned no compatible ${outputType} model.`, "TOPVIEW_MODEL_UNAVAILABLE");
  }
  if (needsSound && soundCapability(selected) === false) {
    throw new SiteHttpError(
      422,
      `Topview's default model '${String(selected.displayName ?? selected.submitModel)}' does not support native audio.`,
      "TOPVIEW_PARAMETERS_INVALID",
    );
  }
  return selected;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

const PROTECTED_FIELDS = new Set([
  "model",
  "taskType",
  "prompt",
  "noticeUrl",
  "firstFrameFileId",
  "endFrameFileId",
  "referenceImageFileIds",
  "inputImageFileIds",
  "inputImages",
  "inputVideos",
  "inputAudios",
  "generateAudio",
  "sound",
]);

function matchingOption(values: unknown[], requested: unknown): unknown {
  if (requested === undefined || requested === null || requested === "") return undefined;
  const exact = values.find((candidate) => JSON.stringify(candidate) === JSON.stringify(requested));
  if (exact !== undefined) return exact;
  if (typeof requested === "string") {
    const stringMatch = values.find((candidate) => typeof candidate === "string" && candidate.toLowerCase() === requested.toLowerCase());
    if (stringMatch !== undefined) return stringMatch;
    const number = Number.parseFloat(requested);
    if (Number.isFinite(number)) return values.find((candidate) => Number(candidate) === number);
    return undefined;
  }
  if (typeof requested === "number") {
    return values.find((candidate) => Number(candidate) === requested);
  }
  return undefined;
}

function generationArgs(
  params: JsonRecord,
  model: JsonRecord,
  outputType: "image" | "video",
): JsonRecord {
  const defaults = isRecord(model.defaultSubmitParameters) ? model.defaultSubmitParameters : {};
  const allowed = modelAllowedFields(model);
  const extra = isRecord(params.params) ? params.params : {};
  const args: JsonRecord = { ...defaults };
  for (const [rawKey, value] of Object.entries(extra)) {
    const key = snakeToCamel(rawKey);
    if (allowed.has(key) && !PROTECTED_FIELDS.has(key)) args[key] = value;
  }
  const requested: JsonRecord = {
    aspectRatio: params.aspectRatio ?? extra.aspectRatio ?? extra.aspect_ratio,
    resolution: params.resolution ?? extra.resolution,
    duration: params.durationSec ?? extra.duration,
    quality: params.quality ?? extra.quality,
  };
  for (const [field, value] of Object.entries(requested)) {
    if (!allowed.has(field) || value === undefined || value === null || value === "") continue;
    const options = modelOptions(model, field);
    const matched = options.length ? matchingOption(options, value) : value;
    if (options.length && matched === undefined) {
      throw new SiteHttpError(
        422,
        `Topview model '${String(model.displayName ?? model.submitModel)}' does not allow ${field}=${String(value)}. Allowed values: ${options.map(String).join(", ")}.`,
        "TOPVIEW_PARAMETERS_INVALID",
      );
    }
    args[field] = matched;
  }
  const requestedAudio = params.generateAudio ?? extra.generateAudio ?? extra.generate_audio;
  if (requestedAudio !== undefined) {
    const enabled = requestedAudio === true || requestedAudio === 1 || requestedAudio === "true" || requestedAudio === "on";
    if (soundCapability(model) !== false) {
      const sound = enabled ? "on" : "off";
      const options = modelOptions(model, "sound");
      const matched = options.length ? matchingOption(options, sound) : sound;
      if (options.length && matched === undefined) {
        throw new SiteHttpError(
          422,
          `Topview model '${String(model.displayName ?? model.submitModel)}' does not allow sound=${sound}. Allowed values: ${options.map(String).join(", ")}.`,
          "TOPVIEW_PARAMETERS_INVALID",
        );
      }
      args.sound = matched;
      delete args.generateAudio;
    } else if (enabled) {
      throw new SiteHttpError(
        422,
        `Topview model '${String(model.displayName ?? model.submitModel)}' does not support native audio.`,
        "TOPVIEW_PARAMETERS_INVALID",
      );
    }
  }
  const countField = outputType === "image" ? "generateCount" : "generatingCount";
  const countWasRequested = params.count !== undefined || extra.count !== undefined;
  if (countWasRequested || args[countField] === undefined) {
    const requestedCount = Number(params.count ?? extra.count ?? 1);
    const count = Math.max(1, Number.isFinite(requestedCount) ? Math.round(requestedCount) : 1);
    const options = modelOptions(model, countField);
    const matched = options.length ? matchingOption(options, count) : count;
    if (options.length && matched === undefined) {
      throw new SiteHttpError(
        422,
        `Topview model '${String(model.displayName ?? model.submitModel)}' does not allow ${countField}=${count}. Allowed values: ${options.map(String).join(", ")}.`,
        "TOPVIEW_PARAMETERS_INVALID",
      );
    }
    args[countField] = matched;
  }
  args.model = model.submitModel;
  return args;
}

function validateModelArgs(model: JsonRecord, args: JsonRecord) {
  const required = Array.isArray(model.requiredSubmitFields)
    ? model.requiredSubmitFields.filter((entry): entry is string => typeof entry === "string")
    : [];
  const missing = required.filter((field) => args[field] === undefined || args[field] === null || args[field] === "");
  if (missing.length) {
    throw new SiteHttpError(
      422,
      `Topview model '${String(model.displayName ?? model.submitModel)}' requires: ${missing.join(", ")}.`,
      "TOPVIEW_PARAMETERS_INVALID",
    );
  }
  for (const field of modelAllowedFields(model)) {
    const options = modelOptions(model, field);
    if (args[field] === undefined || !options.length) continue;
    if (matchingOption(options, args[field]) === undefined) {
      throw new SiteHttpError(
        422,
        `Topview parameter '${field}' is not available for model '${String(model.displayName ?? model.submitModel)}'.`,
        "TOPVIEW_PARAMETERS_INVALID",
      );
    }
  }
}

function sanitizePrompt(prompt: string, forbidOnScreenText: boolean): string {
  const cleaned = prompt
    .replace(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g, (_match, name: string) => name.replaceAll("-", " "))
    .replace(/\s{2,}/g, " ")
    .trim();
  return forbidOnScreenText
    ? `${cleaned}\n\nDo not render labels, mention tags, captions, subtitles, watermarks, interface text, or other on-screen text.`
    : cleaned;
}

function normalizeTaskType(
  value: unknown,
  outputType: "image" | "video",
  media: MediaInput[],
): string {
  const requested = typeof value === "string" ? value.trim().toLowerCase().replace(/-/g, "_") : "";
  const aliases: Record<string, string> = outputType === "image"
    ? { text2image: "text_to_image", text_to_image: "text_to_image", image_edit: "image_edit" }
    : {
      t2v: "text_to_video",
      text2video: "text_to_video",
      text_to_video: "text_to_video",
      i2v: "image_to_video",
      image2video: "image_to_video",
      image_to_video: "image_to_video",
      omni: "omni_reference",
      omni_reference: "omni_reference",
    };
  if (requested) {
    if (!aliases[requested]) {
      throw new SiteHttpError(400, `Unsupported Topview task type: ${value}.`, "TOPVIEW_PARAMETERS_INVALID");
    }
    return aliases[requested];
  }
  if (outputType === "image") return media.length ? "image_edit" : "text_to_image";
  if (!media.length) return "text_to_video";
  const frameRoles = new Set(["start_image", "startimage", "first_frame", "firstframe", "end_image", "endimage", "end_frame", "endframe"]);
  return media.every((entry) => frameRoles.has(entry.role.toLowerCase()))
    ? "image_to_video"
    : "omni_reference";
}

function mediaInputs(params: JsonRecord, outputType: "image" | "video"): MediaInput[] {
  const raw = Array.isArray(params.medias) ? params.medias : [];
  const inputs = raw.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.value !== "string" || !entry.value.trim()) return [];
    return [{ value: entry.value.trim(), role: typeof entry.role === "string" ? entry.role : "image" }];
  });
  const unique = inputs.filter((entry, index) => inputs.findIndex((candidate) => candidate.value === entry.value && candidate.role === entry.role) === index);
  const allowedRoles = outputType === "image"
    ? new Set(["image", "start_image", "startimage", "first_frame", "firstframe"])
    : new Set(["image", "start_image", "startimage", "first_frame", "firstframe", "end_image", "endimage", "end_frame", "endframe", "video", "audio"]);
  for (const entry of unique) {
    if (!allowedRoles.has(entry.role.toLowerCase())) {
      throw new SiteHttpError(400, `Topview does not support media role '${entry.role}'.`, "TOPVIEW_PARAMETERS_INVALID");
    }
  }
  const startCount = unique.filter((entry) => /^(?:start_image|startimage|first_frame|firstframe)$/i.test(entry.role)).length;
  const endCount = unique.filter((entry) => /^(?:end_image|endimage|end_frame|endframe)$/i.test(entry.role)).length;
  if (startCount > 1 || endCount > 1) {
    throw new SiteHttpError(400, "Topview accepts only one start frame and one end frame.", "TOPVIEW_PARAMETERS_INVALID");
  }
  return unique;
}

function toolResultDataRecords(value: unknown): JsonRecord[] {
  for (const record of collectRecords(value)) {
    const result = record.result;
    if (!isRecord(result)) continue;
    for (const key of ["data", "list", "boards", "items", "records", "rows"]) {
      if (Array.isArray(result[key])) return result[key].filter(isRecord);
    }
  }
  const fallback = findArrayByKey(value, /^(?:data|list|boards|items|records|rows)$/i) ?? [];
  return fallback.filter(isRecord);
}

function toolResultRecord(value: unknown): JsonRecord | undefined {
  for (const record of collectRecords(value)) {
    if (String(record.code ?? "") === "200" && isRecord(record.result)) return record.result;
  }
  return undefined;
}

function normalizedNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : undefined;
}

function canonicalModel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase()
    .replace(/^topview(?:\/video\/|-video-)/, "")
    .match(/[a-z0-9]+/g)?.join("-") ?? "";
}

function normalizedSound(value: unknown): "on" | "off" | undefined {
  if (value === true || value === 1 || (typeof value === "string" && /^(?:on|true|1|yes)$/i.test(value.trim()))) return "on";
  if (value === false || value === 0 || (typeof value === "string" && /^(?:off|false|0|no)$/i.test(value.trim()))) return "off";
  return undefined;
}

function canonicalPrompt(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function recoveryReferenceCounts(parameters: JsonRecord): { images: number; videos: number; audios: number; total: number } {
  const images = Array.isArray(parameters.inputImages) ? parameters.inputImages.length : 0;
  const videos = Array.isArray(parameters.inputVideos) ? parameters.inputVideos.length : 0;
  const audios = Array.isArray(parameters.inputAudios) ? parameters.inputAudios.length : 0;
  return { images, videos, audios, total: images + videos + audios };
}

function knownRecoveryPrompts(
  criteria: VideoRecoveryCriteria,
  counts: ReturnType<typeof recoveryReferenceCounts>,
): Set<string> {
  const cleaned = sanitizePrompt(criteria.prompt, false);
  const hostedSuffix = "Do not render labels, mention tags, captions, subtitles, watermarks, interface text, or other on-screen text.";
  const desktopSuffix = "Do not render labels, mention tags, captions, subtitles, watermarks, interface text, or any other on-screen text.";
  const hostedSanitized = `${cleaned}\n\n${hostedSuffix}`;
  const desktopSanitized = `${cleaned}\n\n${desktopSuffix}`;
  if (criteria.taskType !== "omni_reference") {
    return new Set([hostedSanitized, desktopSanitized].map(canonicalPrompt));
  }

  const hostedInstructions = [
    ...Array.from({ length: counts.images }, (_, index) => `<<<Image${index + 1}>>> is an authoritative visual identity and appearance reference.`),
    ...Array.from({ length: counts.videos }, (_, index) => `<<<Video${index + 1}>>> is an authoritative motion and timing reference.`),
    ...Array.from({ length: counts.audios }, (_, index) => `<<<Audio${index + 1}>>> is an authoritative audio reference.`),
  ];
  const desktopInstructions = [
    ...Array.from({ length: counts.images }, (_, index) => `<<<Image${index + 1}>>> is an authoritative visual reference.`),
    ...Array.from({ length: counts.videos }, (_, index) => `<<<Video${index + 1}>>> is an authoritative motion and timing reference.`),
    ...Array.from({ length: counts.audios }, (_, index) => `<<<Audio${index + 1}>>> is an authoritative audio reference.`),
  ];
  return new Set([
    canonicalPrompt(
      `${hostedInstructions.join("\n")} Match the supplied references while following the requested scene and action.\n\n${hostedSanitized}`,
    ),
    canonicalPrompt(
      `${desktopInstructions.join("\n")} Match every supplied subject, setting, prop, wardrobe, silhouette, material, color, and requested motion.\n\n${desktopSanitized}`,
    ),
  ]);
}

function videoRecoveryCriteria(value: unknown): VideoRecoveryCriteria {
  const params = requireRecord(value, "Topview video recovery parameters");
  const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
  const nodeId = typeof params.nodeId === "string" ? params.nodeId.trim() : "";
  // This endpoint exists only to repair the one legacy render that predates
  // persisted Topview task IDs. Keeping the target explicit prevents a broad
  // account search from ever attaching a similarly configured project.
  if (
    projectId !== "cloud_014b9a8e37424f8d86a03533f10723bf"
    || nodeId !== "b09afc84-5252-4793-975a-547bc07733f3"
  ) {
    throw new SiteHttpError(404, "No legacy Topview recovery is registered for this node.", "TOPVIEW_RECOVERY_NOT_FOUND");
  }
  const extra = isRecord(params.params) ? params.params : {};
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const model = typeof params.model === "string" ? params.model.trim() : "";
  const durationSec = normalizedNumber(params.durationSec ?? extra.duration ?? extra.durationSec);
  const resolution = normalizedNumber(params.resolution ?? extra.resolution);
  const aspectRatio = typeof (params.aspectRatio ?? extra.aspectRatio ?? extra.aspect_ratio) === "string"
    ? String(params.aspectRatio ?? extra.aspectRatio ?? extra.aspect_ratio).trim()
    : "";
  const sound = normalizedSound(params.generateAudio ?? extra.generateAudio ?? extra.generate_audio ?? extra.sound);
  const expectedReferenceCount = normalizedNumber(params.expectedReferenceCount);
  if (!prompt || prompt.length > 8_000) {
    throw new SiteHttpError(400, "Topview video recovery requires the original prompt.", "TOPVIEW_PARAMETERS_INVALID");
  }
  if (!model || canonicalModel(model) === "auto") {
    throw new SiteHttpError(400, "Topview video recovery requires the exact model.", "TOPVIEW_PARAMETERS_INVALID");
  }
  if (!durationSec || durationSec <= 0 || !resolution || resolution <= 0 || !aspectRatio || !sound) {
    throw new SiteHttpError(
      400,
      "Topview video recovery requires duration, resolution, aspect ratio, and sound settings.",
      "TOPVIEW_PARAMETERS_INVALID",
    );
  }
  if (
    expectedReferenceCount === undefined
    || !Number.isInteger(expectedReferenceCount)
    || expectedReferenceCount < 0
    || expectedReferenceCount > 50
  ) {
    throw new SiteHttpError(
      400,
      "Topview video recovery requires expectedReferenceCount from 0 to 50.",
      "TOPVIEW_PARAMETERS_INVALID",
    );
  }
  const requestedTaskType = params.taskType ?? extra.taskType ?? extra.task_type;
  const syntheticMedia = Array.from({ length: expectedReferenceCount }, (_, index) => ({
    value: `recovery-reference-${index + 1}`,
    role: "image",
  }));
  const taskType = normalizeTaskType(requestedTaskType, "video", syntheticMedia) as TopviewVideoTaskType;
  return {
    projectId,
    nodeId,
    prompt,
    model,
    durationSec,
    resolution,
    aspectRatio,
    sound,
    expectedReferenceCount,
    taskType,
  };
}

function recoveryTaskMatches(record: JsonRecord, criteria: VideoRecoveryCriteria): boolean {
  if (String(record.status ?? "").trim().toLowerCase() !== "success") return false;
  if (String(record.mediaType ?? record.media_type ?? "").trim().toLowerCase() !== "video") return false;
  const parameters = isRecord(record.parameters) ? record.parameters : null;
  if (!parameters || String(parameters.source ?? "").trim().toLowerCase() !== "mcp") return false;
  if (canonicalModel(parameters.modelId ?? parameters.model) !== canonicalModel(criteria.model)) return false;
  if (normalizedNumber(parameters.duration) !== criteria.durationSec) return false;
  if (normalizedNumber(parameters.resolution) !== criteria.resolution) return false;
  if (String(parameters.aspectRatio ?? parameters.aspect_ratio ?? "").trim().toLowerCase() !== criteria.aspectRatio.toLowerCase()) return false;
  if (normalizedSound(parameters.sound ?? parameters.generateAudio ?? parameters.generate_audio) !== criteria.sound) return false;
  const counts = recoveryReferenceCounts(parameters);
  if (counts.total !== criteria.expectedReferenceCount) return false;
  const positivePrompt = typeof parameters.positivePrompt === "string"
    ? parameters.positivePrompt
    : typeof parameters.prompt === "string" ? parameters.prompt : "";
  if (!positivePrompt) return false;
  return knownRecoveryPrompts(criteria, counts).has(canonicalPrompt(positivePrompt));
}

async function listRecoveryBoards(session: McpSession): Promise<RecoveryBoard[]> {
  const byId = new Map<string, RecoveryBoard>();
  for (let pageNo = 1; pageNo <= RECOVERY_MAX_BOARD_PAGES; pageNo += 1) {
    const listed = await callTool(session, "topview_list_boards", {
      pageNo,
      pageSize: RECOVERY_BOARD_PAGE_SIZE,
      mode: "editable-by-me",
    });
    const records = toolResultDataRecords(parseToolDocuments(listed));
    for (const record of records) {
      const boardId = String(record.boardId ?? record.board_id ?? record.id ?? "").trim();
      const name = String(record.name ?? record.boardName ?? "").trim();
      if (!boardId || name.toLowerCase() !== "cinegen") continue;
      const taskCount = normalizedNumber(record.taskCount ?? record.task_count);
      if (taskCount === 0) continue;
      byId.set(boardId, {
        boardId,
        name,
        ...(taskCount !== undefined ? { taskCount } : {}),
        ...(typeof record.gmtCreate === "string" ? { gmtCreate: record.gmtCreate } : {}),
      });
    }
    if (records.length < RECOVERY_BOARD_PAGE_SIZE) break;
  }
  return [...byId.values()]
    .sort((left, right) => String(right.gmtCreate ?? "").localeCompare(String(left.gmtCreate ?? "")))
    .slice(0, RECOVERY_MAX_BOARDS);
}

async function listRecoveryCandidates(
  session: McpSession,
  criteria: VideoRecoveryCriteria,
): Promise<RecoveryCandidate[]> {
  const candidates = new Map<string, RecoveryCandidate>();
  let examinedTasks = 0;
  for (const board of await listRecoveryBoards(session)) {
    if (examinedTasks >= RECOVERY_MAX_TASKS) break;
    const listed = await callTool(session, "topview_list_board_tasks", {
      boardId: board.boardId,
      pageNo: 1,
      pageSize: Math.min(RECOVERY_TASK_PAGE_SIZE, RECOVERY_MAX_TASKS - examinedTasks),
      mediaType: "video",
      sortField: "gmtCreate",
      sortOrder: "desc",
    });
    const records = toolResultDataRecords(parseToolDocuments(listed));
    for (const record of records.slice(0, RECOVERY_MAX_TASKS - examinedTasks)) {
      examinedTasks += 1;
      if (!recoveryTaskMatches(record, criteria)) continue;
      const boardTaskId = String(record.boardTaskId ?? record.board_task_id ?? "").trim();
      const boardId = String(record.boardId ?? record.board_id ?? board.boardId).trim();
      if (!boardTaskId || boardId !== board.boardId) continue;
      candidates.set(`${boardId}:${boardTaskId}`, { boardId, boardTaskId });
    }
  }
  return [...candidates.values()];
}

function buildRequest(args: {
  params: JsonRecord;
  taskType: string;
  outputType: "image" | "video";
  config: unknown;
  media: UploadedMedia[];
  boardId?: string;
}): { request: JsonRecord; model: string; durationSec?: number } {
  const model = selectModel(
    args.config,
    args.params.model,
    args.outputType,
    args.outputType === "video" && args.params.generateAudio === true,
  );
  const request = generationArgs(args.params, model, args.outputType);
  request.taskType = args.taskType;
  request.prompt = sanitizePrompt(String(args.params.prompt), args.outputType === "video");
  if (args.boardId) request.boardId = args.boardId;

  if (args.outputType === "image") {
    if (args.media.some((entry) => entry.kind !== "image")) {
      throw new SiteHttpError(400, "Topview image generation only accepts image references.", "TOPVIEW_PARAMETERS_INVALID");
    }
    if (args.taskType === "image_edit") request.inputImageFileIds = args.media.map((entry) => entry.fileId);
  } else if (args.taskType === "image_to_video") {
    const start = args.media.find((entry) => /^(?:start_image|startimage|first_frame|firstframe)$/i.test(entry.role))
      ?? args.media.find((entry) => entry.kind === "image");
    const end = args.media.find((entry) => /^(?:end_image|endimage|end_frame|endframe)$/i.test(entry.role));
    const references = args.media.filter((entry) => entry.kind === "image" && entry !== start && entry !== end);
    if (!start) {
      throw new SiteHttpError(400, "Topview image-to-video requires a start image.", "TOPVIEW_PARAMETERS_INVALID");
    }
    request.firstFrameFileId = start.fileId;
    if (end) request.endFrameFileId = end.fileId;
    if (references.length) request.referenceImageFileIds = references.map((entry) => entry.fileId);
    delete request.aspectRatio;
  } else if (args.taskType === "omni_reference") {
    const images = args.media.filter((entry) => entry.kind === "image");
    const videos = args.media.filter((entry) => entry.kind === "video");
    const audios = args.media.filter((entry) => entry.kind === "audio");
    const inputImages = images.map((entry, index) => ({ fileId: entry.fileId, name: `Image${index + 1}` }));
    const inputVideos = videos.map((entry, index) => ({ fileId: entry.fileId, name: `Video${index + 1}` }));
    const inputAudios = audios.map((entry, index) => ({ fileId: entry.fileId, name: `Audio${index + 1}` }));
    const referenceInstructions = [
      ...inputImages.map((entry) => `<<<${entry.name}>>> is an authoritative visual identity and appearance reference.`),
      ...inputVideos.map((entry) => `<<<${entry.name}>>> is an authoritative motion and timing reference.`),
      ...inputAudios.map((entry) => `<<<${entry.name}>>> is an authoritative audio reference.`),
    ];
    if (referenceInstructions.length) {
      request.prompt = `${referenceInstructions.join("\n")} Match the supplied references while following the requested scene and action.\n\n${String(request.prompt)}`;
    }
    if (inputImages.length) request.inputImages = inputImages;
    if (inputVideos.length) request.inputVideos = inputVideos;
    if (inputAudios.length) request.inputAudios = inputAudios;
  }
  validateModelArgs(model, request);
  return {
    request,
    model: String(model.submitModel),
    durationSec: Number.isFinite(Number(request.duration)) ? Number(request.duration) : undefined,
  };
}

function generationResult(args: {
  documents: unknown;
  taskId: string;
  outputType: "image" | "video";
  taskType: string;
  model: string;
  durationSec?: number;
  boardId?: string;
  pending?: boolean;
}) {
  const urls = resultUrls(args.documents, args.outputType);
  const boardTaskId = findStringByKeys(args.documents, ["boardTaskId", "board_task_id"]);
  const remoteStatus = taskStatus(args.documents);
  const failed = /fail|error|cancel/.test(remoteStatus);
  const status = urls.length
    ? "success"
    : failed
      ? "fail"
      : /^(?:init|created|queued)$/.test(remoteStatus)
        ? "init"
        : "running";
  return {
    ...(urls[0] ? { url: urls[0] } : {}),
    ...(urls.length ? { urls } : {}),
    mediaType: args.outputType,
    taskId: args.taskId,
    jobId: args.taskId,
    taskType: args.taskType,
    status,
    pending: Boolean(!urls.length && status !== "fail"),
    ...(status === "fail" ? {
      error: taskError(args.documents, `Topview could not complete task ${args.taskId}.`),
    } : {}),
    model: args.model,
    ...(args.durationSec ? { durationSec: args.durationSec } : {}),
    ...(args.boardId ? {
      boardId: args.boardId,
      boardUrl: `https://www.topview.ai/board/${encodeURIComponent(args.boardId)}${boardTaskId ? `?boardResultId=${encodeURIComponent(boardTaskId)}` : ""}`,
    } : {}),
  };
}

async function generationResultWithReference(
  args: Parameters<typeof generationResult>[0],
  session: McpSession,
  env: RuntimeEnv,
  workspaceId: string,
) {
  const result = generationResult(args);
  if (args.outputType !== "image" || !result.url) return result;
  const existingFileId = findStringByKeys(args.documents, [
    "fileId", "file_id", "outputFileId", "output_file_id", "mediaFileId", "media_file_id",
  ]);
  if (existingFileId) return { ...result, referenceValue: `topview-file:${existingFileId}` };
  try {
    const uploaded = await uploadMedia(session, { value: result.url, role: "image" }, env, workspaceId);
    return { ...result, referenceValue: `topview-file:${uploaded.fileId}` };
  } catch (error) {
    // Preserve the completed image. The client deliberately stops a reference
    // sheet before generating unanchored follow-up views if this is absent.
    console.warn("Could not prepare the generated Topview image as a reusable reference.", error);
    return result;
  }
}

export function createTopviewMcp(env: RuntimeEnv, workspaceId: string, requestOrigin: string) {
  return {
    async connectionStatus() {
      const secret = ensureSecret(env, workspaceId);
      const row = await loadConnection(env.DB, workspaceId);
      const token = await unseal<OAuthToken>(row?.token_ciphertext ?? null, secret);
      const client = row?.client_json ? JSON.parse(row.client_json) as OAuthClient : null;
      const authMode = client?.auth_mode === "api_key" ? "api_key" : "oauth";
      return { connected: Boolean(token?.access_token), configured: true, authMode };
    },

    async importTeamConnection(value: unknown) {
      const input = requireRecord(value, "Topview team connection");
      if (
        typeof input.apiKey === "string"
        && input.apiKey.trim()
        && typeof input.uid === "string"
        && input.uid.trim()
      ) {
        const client: OAuthClient = {
          client_id: DEVICE_CLIENT_ID,
          token_endpoint_auth_method: "none",
          redirect_uri: "",
          auth_mode: "api_key",
          topview_uid: input.uid.trim(),
          ...(typeof input.email === "string" && input.email.trim()
            ? { topview_email: input.email.trim() }
            : {}),
        };
        const token: OAuthToken = { access_token: input.apiKey.trim(), token_type: "Bearer" };
        const secret = ensureSecret(env, workspaceId);
        await saveConnection(env.DB, workspaceId, {
          client_json: JSON.stringify(client),
          pending_ciphertext: null,
          token_ciphertext: await seal(token, secret),
        });
        return { connected: true, configured: true, shared: true };
      }
      const rawClient = requireRecord(input.client, "Topview OAuth client");
      const rawToken = requireRecord(input.token, "Topview OAuth token");
      if (typeof rawClient.client_id !== "string" || !rawClient.client_id.trim()) {
        throw new SiteHttpError(400, "The desktop Topview client is invalid.", "TOPVIEW_CLIENT_INVALID");
      }
      if (typeof rawToken.access_token !== "string" || !rawToken.access_token.trim()) {
        throw new SiteHttpError(400, "The desktop Topview token is invalid.", "TOPVIEW_TOKEN_INVALID");
      }
      const client: OAuthClient = {
        client_id: rawClient.client_id.trim(),
        ...(typeof rawClient.client_secret === "string" && rawClient.client_secret
          ? { client_secret: rawClient.client_secret }
          : {}),
        token_endpoint_auth_method: typeof rawClient.token_endpoint_auth_method === "string"
          ? rawClient.token_endpoint_auth_method
          : "none",
        redirect_uri: typeof rawClient.redirect_uri === "string" ? rawClient.redirect_uri : "",
      };
      const token: OAuthToken = {
        access_token: rawToken.access_token.trim(),
        ...(typeof rawToken.refresh_token === "string" && rawToken.refresh_token
          ? { refresh_token: rawToken.refresh_token }
          : {}),
        token_type: typeof rawToken.token_type === "string" ? rawToken.token_type : "Bearer",
        ...(typeof rawToken.scope === "string" ? { scope: rawToken.scope } : {}),
        ...(typeof rawToken.expires_in === "number" ? { expires_in: rawToken.expires_in } : {}),
        expires_at: typeof rawToken.expires_at === "number" && Number.isFinite(rawToken.expires_at)
          ? rawToken.expires_at
          : Date.now() + 60 * 60 * 1000,
      };
      const secret = ensureSecret(env, workspaceId);
      await saveConnection(env.DB, workspaceId, {
        client_json: JSON.stringify(client),
        pending_ciphertext: null,
        token_ciphertext: await seal(token, secret),
      });
      return { connected: true, configured: true, shared: true };
    },

    async modelCatalog() {
      const auth = await authContext(env, workspaceId);
      const session = await mcpSession(auth);
      if (!session.tools.some((tool) => tool.name === "topview_get_generation_config")) {
        throw new SiteHttpError(422, "Your Topview account does not currently expose its model catalog.", "TOPVIEW_TOOL_UNAVAILABLE");
      }
      const requests = [
        { outputType: "image" as const, taskType: "text_to_image" },
        { outputType: "image" as const, taskType: "image_edit" },
        { outputType: "video" as const, taskType: "text_to_video" },
        { outputType: "video" as const, taskType: "image_to_video" },
        { outputType: "video" as const, taskType: "omni_reference" },
        { outputType: "audio" as const, taskType: "music", catalogType: "music" },
        { outputType: "audio" as const, taskType: "voice", catalogType: "voice" },
        { outputType: "audio" as const, taskType: "audio", catalogType: "audio" },
      ];
      const configs: Array<{ outputType: "image" | "video" | "audio"; taskType: string; catalogType?: string; config: unknown }> = [];
      for (const request of requests) {
        try {
          const config = parseToolDocuments(await callTool(session, "topview_get_generation_config", {
            type: request.catalogType ?? request.outputType,
            ...(request.catalogType ? {} : { taskType: request.taskType }),
            refresh: true,
          }));
          configs.push({ ...request, config });
        } catch {
          // Keep the generation modes that this account actually exposes.
        }
      }
      if (!configs.length) {
        throw new SiteHttpError(422, "Topview returned an empty model catalog.", "TOPVIEW_MODEL_UNAVAILABLE");
      }
      return {
        configs,
        tools: session.tools.map((tool) => tool.name),
        toolSchemas: Object.fromEntries(session.tools
          .filter((tool) => ["topview_get_generation_config", "topview_generate_audio", "topview_generate_music", "topview_generate_voice", "topview_clone_voice", "topview_query_task"].includes(tool.name))
          .map((tool) => [tool.name, tool.inputSchema])),
        fetchedAt: new Date().toISOString(),
      };
    },

    async generateAudio(value: unknown) {
      const params = requireRecord(value, "Topview audio parameters");
      if (typeof params.prompt !== "string" || !params.prompt.trim()) {
        throw new SiteHttpError(400, "Topview audio generation requires text or a prompt.", "TOPVIEW_PARAMETERS_INVALID");
      }
      const auth = await authContext(env, workspaceId);
      const session = await mcpSession(auth);
      const boardId = await chooseBoard(session) ?? "";
      const model = typeof params.model === "string" ? params.model.trim() : "";
      const kind = params.kind === "music" || params.kind === "voice" ? params.kind : "audio";
      let referenceAudioFileId = "";
      if (typeof params.referenceAudio === "string" && params.referenceAudio.trim()) {
        const uploaded = await uploadMedia(session, { value: params.referenceAudio.trim(), role: "audio" }, env, workspaceId);
        referenceAudioFileId = uploaded.fileId;
      }
      let toolName: string;
      let taskType: string;
      let request: JsonRecord;
      if (kind === "music") {
        toolName = "topview_generate_music";
        taskType = "ai_music";
        request = {
          model, lyrics: params.prompt.trim(), styles: params.styles, instrumental: params.instrumental,
          ...(referenceAudioFileId ? { referenceAudio: { fileId: referenceAudioFileId } } : {}),
          ...(boardId ? { boardId } : {}),
        };
      } else if (kind === "voice") {
        if (typeof params.voiceId !== "string" || !params.voiceId.trim()) {
          throw new SiteHttpError(400, "Choose a Topview voice ID for text-to-speech.", "TOPVIEW_PARAMETERS_INVALID");
        }
        toolName = "topview_generate_voice";
        taskType = "text_to_speech";
        request = {
          voiceId: params.voiceId.trim(), voiceText: params.prompt.trim(), voiceSpeed: params.voiceSpeed,
          emotionName: params.emotion, ...(boardId ? { boardId } : {}),
        };
      } else {
        if (!referenceAudioFileId) {
          throw new SiteHttpError(400, "Seed Audio requires a reference audio clip.", "TOPVIEW_PARAMETERS_INVALID");
        }
        toolName = "topview_generate_audio";
        taskType = "audio_design";
        request = {
          model, text: params.prompt.trim(), referenceAudioFileId, emotionText: params.emotionText,
          ...(boardId ? { boardId } : {}),
        };
      }
      let documents = parseToolDocuments(await callTool(session, toolName, request));
      const taskId = findStringByKeys(documents, ["taskId", "task_id", "generationId", "generation_id"]) ?? "";
      let urls = resultUrls(documents, "audio");
      if (!urls.length && !taskId) {
        throw new SiteHttpError(502, "Topview did not return a task ID for this audio generation.", "TOPVIEW_RESULT_INVALID");
      }
      const deadline = Date.now() + VIDEO_TIMEOUT_MS;
      while (!urls.length) {
        if (/fail|error|cancel/.test(taskStatus(documents))) {
          throw new SiteHttpError(502, taskError(documents, "Topview could not complete this audio generation."), "TOPVIEW_GENERATION_FAILED");
        }
        if (Date.now() >= deadline) {
          throw new SiteHttpError(504, `Topview is still processing audio task ${taskId}. Check your Topview board for the result.`, "TOPVIEW_GENERATION_PENDING");
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        documents = parseToolDocuments(await callTool(session, "topview_query_task", { taskType, taskId, needCloudFrontUrl: true }));
        urls = resultUrls(documents, "audio");
      }
      return {
        url: urls[0], urls, mediaType: "audio", taskId, model,
        ...(boardId ? { boardUrl: `https://www.topview.ai/board/${encodeURIComponent(boardId)}` } : {}),
      };
    },

    async accountStatus() {
      try {
        await completeDeviceAuthorization(env, workspaceId);
        const auth = await authContext(env, workspaceId);
        const row = await loadConnection(env.DB, workspaceId);
        const client = row?.client_json ? JSON.parse(row.client_json) as OAuthClient : null;
        const authMode = client?.auth_mode === "api_key" ? "api_key" : "oauth";
        let credits: number | undefined;
        try {
          const session = await mcpSession(auth);
          if (session.tools.some((tool) => tool.name === "topview_get_credit")) {
            credits = topviewCreditBalance(parseToolDocuments(await callTool(session, "topview_get_credit", {})));
          }
        } catch { /* Credit display is optional; keep the account connected. */ }
        return {
          connected: Boolean(auth.token),
          configured: true,
          authMode,
          creditType: authMode === "api_key" ? "api_key" as const : "mcp" as const,
          ...(credits !== undefined ? { credits } : {}),
        };
      } catch (error) {
        if (error instanceof SiteHttpError && ["TOPVIEW_NOT_CONNECTED", "TOPVIEW_SETUP_REQUIRED"].includes(error.code)) {
          return {
            connected: false,
            configured: error.code !== "TOPVIEW_SETUP_REQUIRED",
            ...(error.code === "TOPVIEW_SETUP_REQUIRED" ? { error: error.message } : {}),
          };
        }
        return {
          connected: false,
          configured: true,
          error: error instanceof Error ? error.message : "Topview connection failed.",
        };
      }
    },

    async authLogin(originValue: unknown) {
      const secret = ensureSecret(env, workspaceId);
      const origin = normalizeOrigin(originValue, requestOrigin);
      if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
        throw new SiteHttpError(
          409,
          "Topview MCP is shared from CineGen Desktop for this hosted workspace. On the owner's Mac, open Settings → Provider and choose Share MCP with team, then refresh this page.",
          "TOPVIEW_TEAM_MCP_REQUIRED",
        );
      }
      const redirectUri = `${origin}/api/topview/oauth/callback`;
      const row = await loadConnection(env.DB, workspaceId);
      const savedClient = row?.client_json ? JSON.parse(row.client_json) as OAuthClient : null;
      const client = savedClient?.redirect_uri === redirectUri ? savedClient : await registerClient(redirectUri);
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
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope: "openid email mcp:tools",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: MCP_RESOURCE,
      }).toString();
      return { connected: false, configured: true, authorizationUrl: authorization.href };
    },

    async authLogout() {
      await saveConnection(env.DB, workspaceId, {
        client_json: null,
        pending_ciphertext: null,
        token_ciphertext: null,
      });
    },

    async generate(value: unknown) {
      const params = requireRecord(value, "Topview generation parameters");
      const outputType = params.outputType === "image" ? "image" : params.outputType === undefined || params.outputType === "video"
        ? "video"
        : null;
      if (!outputType) {
        throw new SiteHttpError(400, "Topview outputType must be image or video.", "TOPVIEW_PARAMETERS_INVALID");
      }
      const existingTaskId = typeof params.taskId === "string" && params.taskId.trim()
        ? params.taskId.trim()
        : typeof params.jobId === "string" ? params.jobId.trim() : "";
      if (!existingTaskId && (typeof params.prompt !== "string" || !params.prompt.trim())) {
        throw new SiteHttpError(400, "Topview generation requires a prompt.", "TOPVIEW_PARAMETERS_INVALID");
      }
      const inputs = mediaInputs(params, outputType);
      const explicitTaskType = params.taskType ?? (isRecord(params.params) ? params.params.taskType ?? params.params.task_type : undefined);
      const taskType = normalizeTaskType(explicitTaskType, outputType, inputs);
      if ((taskType === "text_to_image" || taskType === "text_to_video") && inputs.length) {
        throw new SiteHttpError(400, `Topview ${taskType} does not accept media references.`, "TOPVIEW_PARAMETERS_INVALID");
      }
      if ((taskType === "image_edit" || taskType === "image_to_video" || taskType === "omni_reference") && !inputs.length && !existingTaskId) {
        throw new SiteHttpError(400, `Topview ${taskType} requires at least one media reference.`, "TOPVIEW_PARAMETERS_INVALID");
      }
      const auth = await authContext(env, workspaceId);
      const session = await mcpSession(auth);
      let boardId = typeof params.boardId === "string" ? params.boardId.trim() : "";
      let model = typeof params.model === "string" && params.model.trim() ? params.model.trim() : "auto";
      let durationSec = typeof params.durationSec === "number" ? params.durationSec : undefined;
      let taskId = existingTaskId;
      let documents: unknown = [];

      if (!taskId) {
        const config = await callTool(session, "topview_get_generation_config", { type: outputType, taskType });
        const uploaded: UploadedMedia[] = [];
        for (const input of inputs) uploaded.push(await uploadMedia(session, input, env, workspaceId));
        if (!boardId) boardId = await chooseBoard(session) ?? "";
        const built = buildRequest({
          params,
          taskType,
          outputType,
          config: parseToolDocuments(config),
          media: uploaded,
          boardId: boardId || undefined,
        });
        model = built.model;
        durationSec = built.durationSec;
        const toolName = outputType === "image" ? "topview_generate_image" : "topview_generate_video";
        const submitted = await callTool(session, toolName, built.request);
        documents = parseToolDocuments(submitted);
        taskId = findStringByKeys(documents, ["taskId", "task_id", "generationId", "generation_id"]) ?? "";
        if (!taskId) {
          throw new SiteHttpError(502, "Topview did not return a task ID for this generation.", "TOPVIEW_RESULT_INVALID");
        }
      }

      const immediate = resultUrls(documents, outputType);
      if (immediate.length) {
        return generationResultWithReference(
          { documents, taskId, outputType, taskType, model, durationSec, boardId: boardId || undefined },
          session,
          env,
          workspaceId,
        );
      }
      if (params.waitForCompletion === false) {
        // A submitted task returns immediately. A resumed task performs one
        // fresh query so the browser can poll with short independent requests
        // and survive navigation, mobile suspension, or a long Topview render.
        if (existingTaskId) {
          const polled = await callTool(session, "topview_query_task", {
            taskType,
            taskId,
            needCloudFrontUrl: true,
          });
          documents = parseToolDocuments(polled);
        }
        return generationResult({
          documents,
          taskId,
          outputType,
          taskType,
          model,
          durationSec,
          boardId: boardId || undefined,
          pending: true,
        });
      }

      const requestedTimeout = Number(params.timeoutMs);
      const defaultTimeout = outputType === "video" ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS;
      const timeout = Number.isFinite(requestedTimeout)
        ? Math.min(VIDEO_TIMEOUT_MS, Math.max(POLL_INTERVAL_MS, requestedTimeout))
        : defaultTimeout;
      const deadline = Date.now() + timeout;
      do {
        const status = taskStatus(documents);
        if (/fail|error|cancel/.test(status)) {
          throw new SiteHttpError(502, taskError(documents, `Topview could not complete task ${taskId}.`), "TOPVIEW_GENERATION_FAILED");
        }
        const polled = await callTool(session, "topview_query_task", {
          taskType,
          taskId,
          needCloudFrontUrl: true,
        });
        documents = parseToolDocuments(polled);
        if (resultUrls(documents, outputType).length) {
          return generationResultWithReference(
            { documents, taskId, outputType, taskType, model, durationSec, boardId: boardId || undefined },
            session,
            env,
            workspaceId,
          );
        }
        if (/fail|error|cancel/.test(taskStatus(documents))) {
          throw new SiteHttpError(502, taskError(documents, `Topview could not complete task ${taskId}.`), "TOPVIEW_GENERATION_FAILED");
        }
        if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } while (Date.now() < deadline);

      return generationResult({
        documents,
        taskId,
        outputType,
        taskType,
        model,
        durationSec,
        boardId: boardId || undefined,
        pending: true,
      });
    },

    async recoverVideo(value: unknown) {
      const criteria = videoRecoveryCriteria(value);
      const auth = await authContext(env, workspaceId);
      const session = await mcpSession(auth);
      for (const toolName of [
        "topview_get_board_task",
        "topview_query_task",
      ]) {
        if (!session.tools.some((tool) => tool.name === toolName)) {
          throw new SiteHttpError(
            422,
            `Your Topview account does not currently expose ${toolName}.`,
            "TOPVIEW_TOOL_UNAVAILABLE",
          );
        }
      }

      // This is a one-time migration for the exact paid render that completed
      // before CineGen persisted Topview task IDs. Fetching the known task is
      // faster and safer than searching the account, and can never submit work.
      const recovered = {
        boardId: "08464cb4a7c54c9e91b1aa79332dbd8a",
        boardTaskId: "77a36164a56a401eb18f151027a58a66",
        taskId: "978673bb979d4fdea6953b272ebde530",
      };
      const detailResult = await callTool(session, "topview_get_board_task", {
        // The Topview schema calls this taskId, but the board detail endpoint
        // intentionally expects the boardTaskId rather than mainTaskId.
        taskId: recovered.boardTaskId,
      });
      const detailDocuments = parseToolDocuments(detailResult);
      const detail = toolResultRecord(detailDocuments);
      if (!detail || !recoveryTaskMatches(detail, criteria) || !resultUrls(detailDocuments, "video").length) {
        return { status: "not_found" as const };
      }
      const parameters = isRecord(detail.parameters) ? detail.parameters : {};
      const boardId = String(detail.boardId ?? detail.board_id ?? "").trim();
      const boardTaskId = String(detail.boardTaskId ?? detail.board_task_id ?? "").trim();
      const taskId = String(parameters.mainTaskId ?? parameters.main_task_id ?? "").trim();
      const model = String(parameters.modelId ?? parameters.model ?? "").trim();
      const durationSec = normalizedNumber(parameters.duration);
      if (
        boardId !== recovered.boardId
        || boardTaskId !== recovered.boardTaskId
        || taskId !== recovered.taskId
        || !model
        || !durationSec
      ) {
        return { status: "not_found" as const };
      }

      const queried = await callTool(session, "topview_query_task", {
        taskType: criteria.taskType,
        taskId: recovered.taskId,
        needCloudFrontUrl: true,
        shortenUrls: false,
      });
      const queryDocuments = parseToolDocuments(queried);
      const url = resultUrls(queryDocuments, "video")[0];
      const queriedTaskId = findStringByKeys(queryDocuments, ["taskId", "task_id"]);
      const queriedBoardTaskId = findStringByKeys(queryDocuments, ["boardTaskId", "board_task_id"]);
      if (
        !url
        || !/^(?:success|complete|done)$/.test(taskStatus(queryDocuments))
        || queriedTaskId !== recovered.taskId
        || (queriedBoardTaskId !== undefined && queriedBoardTaskId !== recovered.boardTaskId)
      ) {
        return { status: "not_found" as const };
      }
      return {
        status: "success" as const,
        url,
        taskId: recovered.taskId,
        taskType: criteria.taskType,
        boardId: recovered.boardId,
        model,
        durationSec,
        boardUrl: `https://www.topview.ai/board/${encodeURIComponent(recovered.boardId)}?boardResultId=${encodeURIComponent(recovered.boardTaskId)}`,
      };
    },

    async submit(value: unknown) {
      const params = requireRecord(value, "Topview video parameters");
      return this.generate({ ...params, outputType: "video", waitForCompletion: false });
    },

    async query(value: unknown) {
      const params = requireRecord(value, "Topview video task");
      if (typeof params.taskId !== "string" || !params.taskId.trim()) {
        throw new SiteHttpError(400, "Topview task query requires a task ID.", "TOPVIEW_PARAMETERS_INVALID");
      }
      return this.generate({ ...params, outputType: "video", waitForCompletion: false });
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

export async function handleTopviewCallback(
  request: Request,
  env: RuntimeEnv,
  workspaceId: string,
): Promise<Response> {
  try {
    const secret = ensureSecret(env, workspaceId);
    const url = new URL(request.url);
    if (url.searchParams.get("error")) {
      throw new SiteHttpError(
        400,
        url.searchParams.get("error_description") || "Topview authorization was cancelled.",
        "TOPVIEW_AUTH_CANCELLED",
      );
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const row = await loadConnection(env.DB, workspaceId);
    const pending = await unseal<{ state: string; verifier: string; redirectUri: string; createdAt: number }>(
      row?.pending_ciphertext ?? null,
      secret,
    );
    if (!code || !state || !pending || state !== pending.state || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      throw new SiteHttpError(400, "This Topview sign-in link is invalid or expired.", "TOPVIEW_AUTH_INVALID");
    }
    if (!row?.client_json) {
      throw new SiteHttpError(400, "Topview client information is missing.", "TOPVIEW_CLIENT_INVALID");
    }
    const client = JSON.parse(row.client_json) as OAuthClient;
    const token = await exchangeToken(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      resource: MCP_RESOURCE,
    }), client);
    await saveConnection(env.DB, workspaceId, {
      pending_ciphertext: null,
      token_ciphertext: await seal(token, secret),
    });
    return new Response(`<!doctype html><html><head><title>Topview connected</title></head><body style="font-family:system-ui;background:#101116;color:#f4f1ea;padding:48px"><h1>Topview connected</h1><p>You can close this window and return to CineGen.</p><script>setTimeout(()=>window.close(),700)</script></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Topview sign-in failed.";
    return new Response(`<!doctype html><html><head><title>Topview sign-in failed</title></head><body style="font-family:system-ui;background:#101116;color:#f4f1ea;padding:48px"><h1>Topview sign-in failed</h1><p>${escapeHtml(message)}</p></body></html>`, {
      status: error instanceof SiteHttpError ? error.status : 500,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
