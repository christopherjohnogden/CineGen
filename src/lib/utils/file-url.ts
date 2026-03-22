/**
 * Convert a local file path to a local-media:// URL for use in <img>, <video>, etc.
 * Uses a custom Electron protocol so files load in both dev (http://localhost) and prod.
 * Returns the value unchanged if it's already a URL (http/https/blob/data/file/local-media).
 */
export function toFileUrl(pathOrUrl: string | undefined | null): string {
  if (!pathOrUrl) return '';
  if (/^(https?|blob|data|file|local-media):/.test(pathOrUrl)) return pathOrUrl;

  // Normalize Windows backslashes and ensure we always build a valid URL pathname.
  const normalized = pathOrUrl.replace(/\\/g, '/');
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`;

  // local-media://file/<path> — the main process handler decodes and serves the file
  return 'local-media://file' + encodeURI(pathname).replace(/#/g, '%23').replace(/\?/g, '%3F');
}
