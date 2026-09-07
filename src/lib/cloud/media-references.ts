type MediaRecord = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function mediaSourceHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Recover the exact original uploaded by cloud media sync, never a name-only match. */
export function resolveCloudMediaReference(source: string, assets: MediaRecord[]): string {
  if (!/^(?:https?:|blob:|local-media:|file:|\/|[A-Za-z]:\\)/.test(source)) return source;
  const matches = new Set<string>();
  for (const asset of assets) {
    const remote = text(asset.sourceUrl) || text(asset.source_url) || text(asset.url);
    let url: URL;
    try { url = new URL(remote); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') continue;
    const fingerprint = [source, text(asset.checksum), text(asset.fileSize ?? asset.file_size), text(asset.createdAt ?? asset.created_at)].join('|');
    const expected = `/media/${text(asset.id)}/original-${mediaSourceHash(fingerprint)}-`;
    try { if (decodeURIComponent(url.pathname).includes(expected)) matches.add(remote); } catch { /* Malformed URL cannot match. */ }
  }
  return matches.size === 1 ? [...matches][0] : source;
}

/** Cloud assets and workflow references must point at the same durable files. */
export function restoreCloudMediaReferences<T>(state: T): T {
  const records = (state as MediaRecord | null)?.assets;
  if (!Array.isArray(records)) return state;
  const assets = records.filter((v): v is MediaRecord => Boolean(v) && typeof v === 'object');
  const cache = new Map<string, string>();
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!cache.has(value)) cache.set(value, resolveCloudMediaReference(value, assets));
      return cache.get(value);
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return visit(state) as T;
}
