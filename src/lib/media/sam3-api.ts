export interface Sam3Endpoint {
  port: number;
  running?: boolean;
  baseUrl?: string;
}

export function resolveSam3ApiUrl(endpoint: Sam3Endpoint): string {
  if (endpoint.baseUrl?.trim()) {
    return new URL(endpoint.baseUrl, window.location.origin).href.replace(/\/$/, '');
  }
  if (Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65_535) {
    return `http://localhost:${endpoint.port}`;
  }
  throw new Error('SAM 3 did not return a usable service endpoint.');
}

/** Convert browser-owned media URLs back to the server-safe /media reference. */
export function toSam3MediaReference(value: string): string {
  if (value.startsWith('local-media://file')) {
    return decodeURIComponent(value.replace(/^local-media:\/\/file/, ''));
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.origin === window.location.origin && url.pathname.startsWith('/media/')) {
        return `${url.pathname}${url.search}`;
      }
    } catch {
      return value;
    }
  }
  return value;
}

export function sam3ImageSource(value: string): { image_path: string } | { image_url: string } {
  const reference = toSam3MediaReference(value);
  return /^https?:\/\//i.test(reference)
    ? { image_url: reference }
    : { image_path: reference };
}
