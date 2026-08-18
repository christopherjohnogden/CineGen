import {
  SiteHttpError,
  assertId,
  contentTypeForName,
  encodeMediaPath,
  mediaPathFromReference,
  requireRecord,
  sanitizeFileName,
} from "./common";

const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;

function storageKey(workspaceId: string, mediaPath: string): string {
  return `workspaces/${workspaceId}/${mediaPath}`;
}

function mediaUrl(mediaPath: string): string {
  return `/media/${encodeMediaPath(mediaPath)}`;
}

function detectAssetType(name: string): "video" | "audio" | "image" {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (["mp4", "mov", "avi", "mkv", "webm", "mxf", "m4v"].includes(extension)) {
    return "video";
  }
  if (["wav", "mp3", "aac", "flac", "ogg", "m4a", "aiff"].includes(extension)) {
    return "audio";
  }
  return "image";
}

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) throw new SiteHttpError(416, "Invalid Range header.", "INVALID_RANGE");
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      throw new SiteHttpError(416, "Invalid Range header.", "INVALID_RANGE");
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    throw new SiteHttpError(416, "Range not satisfiable.", "INVALID_RANGE");
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function uploadMedia(
  request: Request,
  bucket: R2Bucket,
  workspaceId: string,
) {
  const form = await request.formData();
  const upload = form.get("file");
  if (!(upload instanceof File)) {
    throw new SiteHttpError(400, "Multipart form must include a file.", "FILE_REQUIRED");
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    throw new SiteHttpError(
      413,
      "This hosted version currently accepts files up to 90 MB.",
      "UPLOAD_TOO_LARGE",
    );
  }
  const name = sanitizeFileName(form.get("name") || upload.name);
  const type = String(form.get("type") || upload.type || contentTypeForName(name));
  const uploadId = crypto.randomUUID();
  const path = `uploads/${uploadId}/${name}`;
  await bucket.put(storageKey(workspaceId, path), upload.stream(), {
    httpMetadata: { contentType: type },
    customMetadata: { originalName: name },
  });
  const url = mediaUrl(path);
  return { url, path: url, token: url, name, type };
}

export async function importMedia(
  value: unknown,
  bucket: R2Bucket,
  workspaceId: string,
  ensureProject: (id: string) => Promise<unknown>,
) {
  const params = requireRecord(value, "Media import parameters");
  const projectId = assertId(params.projectId, "project id");
  await ensureProject(projectId);
  if (!Array.isArray(params.filePaths) || params.filePaths.length === 0 || params.filePaths.length > 100) {
    throw new SiteHttpError(400, "Choose between 1 and 100 files.", "INVALID_INPUT");
  }

  const results = [];
  for (const reference of params.filePaths) {
    const sourcePath = mediaPathFromReference(reference);
    if (!sourcePath.startsWith("uploads/")) {
      throw new SiteHttpError(400, "Imports must use a staged upload.", "INVALID_MEDIA_PATH");
    }
    const source = await bucket.get(storageKey(workspaceId, sourcePath));
    if (!source) throw new SiteHttpError(404, "Uploaded file not found.", "MEDIA_NOT_FOUND");
    const name = sanitizeFileName(source.customMetadata?.originalName || sourcePath.split("/").at(-1));
    const assetId = crypto.randomUUID();
    const destinationPath = `projects/${projectId}/imported/${assetId}/${name}`;
    await bucket.put(storageKey(workspaceId, destinationPath), source.body, {
      httpMetadata: source.httpMetadata,
      customMetadata: { originalName: name, projectId, assetId },
    });
    const filePath = mediaUrl(destinationPath);
    const type = detectAssetType(name);
    results.push({
      assetId,
      jobId: crypto.randomUUID(),
      filePath,
      type,
      browserReady: {
        fileSize: source.size,
        contentType: source.httpMetadata?.contentType || contentTypeForName(name),
      },
    });
  }
  return results;
}

export async function serveMedia(
  request: Request,
  bucket: R2Bucket,
  workspaceId: string,
  mediaPath: string,
): Promise<Response> {
  const key = storageKey(workspaceId, mediaPath);
  const head = await bucket.head(key);
  if (!head) throw new SiteHttpError(404, "Media file not found.", "MEDIA_NOT_FOUND");

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, head.size) : null;
  const object = request.method === "HEAD"
    ? null
    : await bucket.get(key, range
      ? { range: { offset: range.start, length: range.end - range.start + 1 } }
      : undefined);
  if (request.method !== "HEAD" && !object) {
    throw new SiteHttpError(404, "Media file not found.", "MEDIA_NOT_FOUND");
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Type": head.httpMetadata?.contentType || contentTypeForName(mediaPath),
    "ETag": head.httpEtag,
    "X-Content-Type-Options": "nosniff",
  });
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${head.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
  } else {
    headers.set("Content-Length", String(head.size));
  }

  return new Response(request.method === "HEAD" ? null : object?.body, {
    status: range ? 206 : 200,
    headers,
  });
}

export async function deleteProjectMedia(
  bucket: R2Bucket,
  workspaceId: string,
  projectId: string,
) {
  const prefix = storageKey(workspaceId, `projects/${assertId(projectId, "project id")}/`);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function safeRemoteUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096) {
    throw new SiteHttpError(400, "Invalid remote media URL.", "INVALID_URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SiteHttpError(400, "Invalid remote media URL.", "INVALID_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new SiteHttpError(400, "Remote media must use HTTPS.", "INVALID_URL");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || /^\d+(?:\.\d+){3}$/.test(host)) {
    throw new SiteHttpError(400, "Private network URLs are unavailable.", "INVALID_URL");
  }
  return url;
}

export async function persistRemoteMedia(
  value: unknown,
  bucket: R2Bucket,
  workspaceId: string,
  ensureProject: (id: string) => Promise<unknown>,
) {
  const params = requireRecord(value, "Generated media parameters");
  const projectId = assertId(params.projectId, "project id");
  const assetId = assertId(params.assetId, "asset id");
  await ensureProject(projectId);
  const url = safeRemoteUrl(params.remoteUrl ?? params.url);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok || !response.body) {
    throw new SiteHttpError(502, "Could not download generated media.", "PROVIDER_ERROR");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    throw new SiteHttpError(413, "Generated media is too large.", "MEDIA_TOO_LARGE");
  }
  const rawExtension = typeof params.extension === "string"
    ? params.extension.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)
    : url.pathname.split(".").at(-1)?.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  const extension = rawExtension || (params.assetType === "video" ? "mp4" : params.assetType === "audio" ? "mp3" : "png");
  const destinationPath = `projects/${projectId}/generated/${assetId}.${extension}`;
  await bucket.put(storageKey(workspaceId, destinationPath), response.body, {
    httpMetadata: {
      contentType: response.headers.get("content-type") || contentTypeForName(destinationPath),
    },
    customMetadata: { projectId, assetId, sourceUrl: url.href },
  });
  return { path: mediaUrl(destinationPath), sourceUrl: url.href, downloaded: true };
}
