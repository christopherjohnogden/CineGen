export const GENERATED_MEDIA_BUCKET = 'cinegen-734ba.firebasestorage.app';
export const MAX_GENERATED_MEDIA_BYTES = 90 * 1024 * 1024;

export class GeneratedMediaDownloadError extends Error {
  constructor(status, host, detail = '') {
    super(`Generated media download failed (HTTP ${status}, host ${host}${detail ? `, ${detail}` : ''}).`);
    this.status = status;
    this.host = host;
  }
}

// The Node transfer fallback accepts only Topview's observed, signed download
// origin. It is not a general URL proxy and never forwards identity to the CDN.
export function isTopviewSignedDownload(source) {
  try {
    const url = new URL(source);
    return url.origin === 'https://du9d8548ooqnc.cloudfront.net'
      && !url.username && !url.password
      && ['Policy', 'Signature', 'Key-Pair-Id'].every(key => Boolean(url.searchParams.get(key)));
  } catch { return false; }
}

export function generatedMediaLocation(ownerId, projectId, assetId, type) {
  const name = `users/${ownerId}/projects/${projectId}/media/${assetId}/generated.${type === 'video' ? 'mp4' : 'png'}`;
  const root = `https://firebasestorage.googleapis.com/v0/b/${GENERATED_MEDIA_BUCKET}/o`;
  return { name, root, objectUrl: `${root}/${encodeURIComponent(name)}` };
}

export async function downloadGeneratedMedia(source, provider = 'topview') {
  let url = new URL(source);
  const signal = AbortSignal.timeout(60000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    // Workers enforces globally routable DNS on every hop through
    // global_fetch_strictly_public. Node callers supply the restricted fetch below.
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.hostname.includes(':') || /^[0-9.]+$/.test(url.hostname)
      || /^(localhost)$|\.(localhost|local|internal)$/.test(url.hostname)
      || (provider === 'fal' && !(url.hostname.endsWith('.fal.media') || url.hostname === 'fal.media' || url.hostname.endsWith('.fal.ai')))) {
      throw new Error('Provider returned an unsupported media location.');
    }
    const response = await fetch(url.href, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(`Generated media redirect has no destination (HTTP ${response.status}).`);
      if (redirects === 5) throw new Error('Generated media exceeded the download redirect limit.');
      url = new URL(location, url); continue;
    }
    if (!response.ok || !response.body) {
      const detail = (await response.text()).match(/<Code>([A-Za-z0-9_ -]{1,80})<\/Code>/)?.[1] ?? '';
      console.warn('media_download_denied', { status: response.status, host: url.hostname, path: url.pathname,
        queryKeys: [...url.searchParams.keys()], hasSignature: url.searchParams.has('Signature'), detail });
      throw new GeneratedMediaDownloadError(response.status, url.hostname, detail);
    }
    return response;
  }
  throw new Error('Generated media download did not finish.');
}

/** Stream to Firebase; return only its durable URL, never media bytes to callers. */
export async function persistGeneratedMedia({ source, token, ownerId, projectId, assetId, type, provider = 'fal' }, download = downloadGeneratedMedia) {
  const { name, root, objectUrl } = generatedMediaLocation(ownerId, projectId, assetId, type);
  const signal = AbortSignal.timeout(240000);
  const existing = await fetch(objectUrl, { headers: { authorization: `Firebase ${token}` }, signal });
  let metadata;
  if (existing.ok) metadata = await existing.json();
  else {
    if (existing.status !== 404) throw new Error(`Media storage is unavailable (${existing.status}).`);
    const media = await download(source, provider);
    if (Number(media.headers.get('content-length') ?? 0) > MAX_GENERATED_MEDIA_BYTES) {
      await media.body?.cancel(); throw new Error('Generated media exceeds the 90 MB cloud upload limit.');
    }
    const contentType = media.headers.get('content-type')?.split(';')[0] || `${type}/${type === 'video' ? 'mp4' : 'png'}`;
    if (!/^(image|video)\/[a-zA-Z0-9.+-]+$/.test(contentType) || !contentType.startsWith(type + '/')) {
      await media.body?.cancel(); throw new Error('Provider returned an unexpected media type.');
    }
    const boundary = crypto.randomUUID(), encoder = new TextEncoder(), reader = media.body.getReader();
    let phase = 0, bytes = 0;
    const body = new ReadableStream({ async pull(controller) {
      if (phase === 0) {
        phase = 1;
        controller.enqueue(encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name, contentType, metadata: { projectId, assetId } })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`)); return;
      }
      const chunk = await reader.read();
      if (chunk.done) { controller.enqueue(encoder.encode(`\r\n--${boundary}--`)); controller.close(); return; }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_GENERATED_MEDIA_BYTES) { await reader.cancel(); controller.error(new Error('Generated media is too large.')); return; }
      controller.enqueue(chunk.value);
    }, cancel() { return reader.cancel(); } });
    try {
      const upload = await fetch(`${root}?name=${encodeURIComponent(name)}`, { method: 'POST',
        headers: { authorization: `Firebase ${token}`, 'X-Goog-Upload-Protocol': 'multipart', 'content-type': `multipart/related; boundary=${boundary}` },
        body, duplex: 'half', signal });
      if (!upload.ok) throw new Error(`Saving generated media failed (${upload.status}).`);
      metadata = await upload.json();
    } finally { await reader.cancel().catch(() => {}); }
  }
  if (!metadata.downloadTokens) throw new Error('Media was stored but its download URL is unavailable.');
  return `${objectUrl}?alt=media&token=${encodeURIComponent(metadata.downloadTokens.split(',')[0])}`;
}
