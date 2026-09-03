export const SHARED_WORKSPACE_ID = "cinegen-shared-v1";
export const LOCAL_WORKSPACE_ID = "cinegen-local-v1";
export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const ALLOWED_SITE_EMAILS = new Set([
  "christopherjohnogden@gmail.com",
  "taylormichaelogden@gmail.com",
]);

export class SiteHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "REQUEST_FAILED") {
    super(message);
    this.name = "SiteHttpError";
    this.status = status;
    this.code = code;
  }
}

export function workspaceIdForRequest(request: Request): string {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return LOCAL_WORKSPACE_ID;
  }

  const authenticatedUserId = request.headers.get("oai-authenticated-user-id");
  const authenticatedUserEmail = request.headers.get("oai-authenticated-user-email");
  if (!authenticatedUserId || !authenticatedUserEmail) {
    throw new SiteHttpError(
      401,
      "Sign in to open this CineGen workspace.",
      "AUTH_REQUIRED",
    );
  }

  if (!isAllowedCineGenEmail(authenticatedUserEmail)) {
    throw new SiteHttpError(
      403,
      "This account does not have access to CineGen.",
      "ACCESS_DENIED",
    );
  }

  // Approved family members intentionally work in one shared project space.
  return SHARED_WORKSPACE_ID;
}

export function isAllowedCineGenEmail(email: string): boolean {
  return ALLOWED_SITE_EMAILS.has(email.trim().toLowerCase());
}

export function assertId(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new SiteHttpError(400, `Invalid ${label}.`, "INVALID_ID");
  }
  return value;
}

export function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SiteHttpError(400, `${label} must be an object.`, "INVALID_INPUT");
  }
  return value as Record<string, unknown>;
}

export function sanitizeFileName(value: unknown): string {
  const parts = String(value || "upload.bin").split(/[\\/]/);
  const base = (parts.at(-1) || "upload.bin").normalize("NFKC");
  const safe = base
    .replace(/[^A-Za-z0-9._() -]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return safe || "upload.bin";
}

export function encodeMediaPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function decodeMediaPath(parts: string[]): string {
  if (parts.length === 0 || parts.length > 24) {
    throw new SiteHttpError(400, "Invalid media path.", "INVALID_MEDIA_PATH");
  }
  const decoded = parts.map((part) => {
    let value: string;
    try {
      value = decodeURIComponent(part);
    } catch {
      throw new SiteHttpError(400, "Invalid media path.", "INVALID_MEDIA_PATH");
    }
    if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
      throw new SiteHttpError(400, "Invalid media path.", "INVALID_MEDIA_PATH");
    }
    return value;
  });
  return decoded.join("/");
}

export function mediaPathFromReference(value: unknown): string {
  if (typeof value !== "string" || value.length > 16_384) {
    throw new SiteHttpError(400, "Invalid media reference.", "INVALID_MEDIA_PATH");
  }
  let url: URL;
  try {
    url = new URL(value, "https://cinegen.invalid");
  } catch {
    throw new SiteHttpError(400, "Invalid media reference.", "INVALID_MEDIA_PATH");
  }
  if (!url.pathname.startsWith("/media/")) {
    throw new SiteHttpError(
      400,
      "Only CineGen media references are accepted.",
      "INVALID_MEDIA_PATH",
    );
  }
  return decodeMediaPath(url.pathname.slice("/media/".length).split("/"));
}

export function success(result?: unknown, init: ResponseInit = {}): Response {
  return Response.json({ ok: true, result }, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof SiteHttpError ? error.status : 500;
  const code = error instanceof SiteHttpError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof SiteHttpError
    ? error.message
    : "CineGen could not complete that request.";
  if (!(error instanceof SiteHttpError)) console.error("[cinegen-site]", error);
  return Response.json(
    { ok: false, error: { message, code } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export const MIME_TYPES: Record<string, string> = {
  aac: "audio/aac",
  aiff: "audio/aiff",
  avif: "image/avif",
  bmp: "image/bmp",
  flac: "audio/flac",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
};

export function contentTypeForName(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_TYPES[extension] ?? "application/octet-stream";
}
