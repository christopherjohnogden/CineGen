import { SiteHttpError, requireRecord } from "./common";

export const TEAM_PROVIDER_SENTINEL = "__CINEGEN_TEAM_PROVIDER__";

export const WORKSPACE_PROVIDER_IDS = [
  "fal",
  "openai",
  "kie",
  "runpod",
  "huggingface",
] as const;

export type WorkspaceProviderId = typeof WORKSPACE_PROVIDER_IDS[number];

type RuntimeEnv = {
  DB: D1Database;
  CINEGEN_WORKSPACE_PROVIDER_SECRET?: string;
  CINEGEN_TOPVIEW_TOKEN_SECRET?: string;
  CINEGEN_HIGGSFIELD_TOKEN_SECRET?: string;
};

type VaultRow = {
  provider: string;
  token_ciphertext: string | null;
  updated_at: string;
};

const PROVIDER_PREFIX = "workspace-secret:";
const CREATE_CONNECTIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS provider_connections (
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    client_json TEXT,
    pending_ciphertext TEXT,
    token_ciphertext TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, provider)
  )
`;

function providerId(value: unknown): WorkspaceProviderId {
  if (typeof value !== "string" || !WORKSPACE_PROVIDER_IDS.includes(value as WorkspaceProviderId)) {
    throw new SiteHttpError(400, "Choose a supported team provider.", "INVALID_PROVIDER");
  }
  return value as WorkspaceProviderId;
}

function storageProvider(provider: WorkspaceProviderId): string {
  return `${PROVIDER_PREFIX}${provider}`;
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

function vaultSecret(env: RuntimeEnv, workspaceId: string): string {
  const configured = env.CINEGEN_WORKSPACE_PROVIDER_SECRET?.trim()
    || env.CINEGEN_TOPVIEW_TOKEN_SECRET?.trim()
    || env.CINEGEN_HIGGSFIELD_TOKEN_SECRET?.trim();
  if (configured) return configured;
  if (workspaceId === "cinegen-local-v1") return "cinegen-local-development-workspace-provider-vault-v1";
  throw new SiteHttpError(
    503,
    "Team provider storage is still being configured for this CineGen site.",
    "PROVIDER_VAULT_SETUP_REQUIRED",
  );
}

async function encryptionKey(env: RuntimeEnv, workspaceId: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(vaultSecret(env, workspaceId)));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(
  env: RuntimeEnv,
  workspaceId: string,
  provider: WorkspaceProviderId,
  secret: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${workspaceId}:${provider}`);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    await encryptionKey(env, workspaceId),
    new TextEncoder().encode(secret),
  );
  return JSON.stringify({ version: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) });
}

async function unseal(
  env: RuntimeEnv,
  workspaceId: string,
  provider: WorkspaceProviderId,
  ciphertext: string,
): Promise<string> {
  try {
    const payload = JSON.parse(ciphertext) as { version?: unknown; iv?: unknown; data?: unknown };
    if (payload.version !== 1 || typeof payload.iv !== "string" || typeof payload.data !== "string") throw new Error("invalid vault value");
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(payload.iv),
        additionalData: new TextEncoder().encode(`${workspaceId}:${provider}`),
      },
      await encryptionKey(env, workspaceId),
      base64ToBytes(payload.data),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new SiteHttpError(503, "The shared provider connection could not be opened.", "PROVIDER_VAULT_ERROR");
  }
}

export function createWorkspaceProviderVault(env: RuntimeEnv, workspaceId: string) {
  const ensureTable = () => env.DB.prepare(CREATE_CONNECTIONS_TABLE).run();

  const rows = async (): Promise<VaultRow[]> => {
    await ensureTable();
    const result = await env.DB.prepare(`
      SELECT provider, token_ciphertext, updated_at
      FROM provider_connections
      WHERE workspace_id = ? AND provider LIKE ?
      ORDER BY provider
    `).bind(workspaceId, `${PROVIDER_PREFIX}%`).all<VaultRow>();
    return result.results ?? [];
  };

  const status = async () => {
    const connected = new Map((await rows()).map((row) => [
      row.provider.slice(PROVIDER_PREFIX.length),
      row,
    ]));
    return {
      supported: true,
      scope: "workspace" as const,
      providers: WORKSPACE_PROVIDER_IDS.map((id) => ({
        id,
        connected: Boolean(connected.get(id)?.token_ciphertext),
        updatedAt: connected.get(id)?.updated_at,
      })),
    };
  };

  const get = async (provider: WorkspaceProviderId): Promise<string | undefined> => {
    await ensureTable();
    const row = await env.DB.prepare(`
      SELECT token_ciphertext
      FROM provider_connections
      WHERE workspace_id = ? AND provider = ?
      LIMIT 1
    `).bind(workspaceId, storageProvider(provider)).first<{ token_ciphertext: string | null }>();
    if (!row?.token_ciphertext) return undefined;
    return unseal(env, workspaceId, provider, row.token_ciphertext);
  };

  return {
    status,
    get,
    async save(value: unknown) {
      const params = requireRecord(value, "Team provider connection");
      const provider = providerId(params.provider);
      const secret = typeof params.secret === "string" ? params.secret.trim() : "";
      if (!secret || secret.length > 4_096) {
        throw new SiteHttpError(400, "Enter a valid provider credential.", "INVALID_PROVIDER_SECRET");
      }
      await ensureTable();
      const now = new Date().toISOString();
      await env.DB.prepare(`
        INSERT INTO provider_connections (
          workspace_id, provider, client_json, pending_ciphertext, token_ciphertext, updated_at
        ) VALUES (?, ?, NULL, NULL, ?, ?)
        ON CONFLICT(workspace_id, provider) DO UPDATE SET
          client_json = NULL,
          pending_ciphertext = NULL,
          token_ciphertext = excluded.token_ciphertext,
          updated_at = excluded.updated_at
      `).bind(workspaceId, storageProvider(provider), await seal(env, workspaceId, provider, secret), now).run();
      return status();
    },
    async remove(value: unknown) {
      const params = requireRecord(value, "Team provider connection");
      const provider = providerId(params.provider);
      await ensureTable();
      await env.DB.prepare(`
        DELETE FROM provider_connections WHERE workspace_id = ? AND provider = ?
      `).bind(workspaceId, storageProvider(provider)).run();
      return status();
    },
    async resolve(provider: WorkspaceProviderId, supplied: unknown): Promise<string> {
      const shared = await get(provider);
      if (shared) return shared;
      const local = typeof supplied === "string" ? supplied.trim() : "";
      return local === TEAM_PROVIDER_SENTINEL ? "" : local;
    },
  };
}
