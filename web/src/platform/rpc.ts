const RPC_ROOT = '/api/rpc';
const UPLOAD_URL = '/api/uploads';

type JsonRecord = Record<string, unknown>;

export interface RpcRequestOptions {
  /** Optional outer deadline for short control-plane calls. Omit for long-running work. */
  timeoutMs?: number;
}

export interface UploadResult {
  url?: string;
  path?: string;
  token?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

export class BrowserBridgeError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BrowserBridgeError';
    this.status = options.status;
    this.code = options.code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeBrowserMediaReferences<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 24) return item;
    if (typeof item === 'string') {
      return item.startsWith('/media/') ? new URL(item, window.location.origin).href : item;
    }
    if (!item || typeof item !== 'object') return item;
    const existing = seen.get(item);
    if (existing) return existing;
    if (Array.isArray(item)) {
      const next: unknown[] = [];
      seen.set(item, next);
      for (const entry of item) next.push(visit(entry, depth + 1));
      return next;
    }
    const next: JsonRecord = {};
    seen.set(item, next);
    for (const [key, entry] of Object.entries(item)) next[key] = visit(entry, depth + 1);
    return next;
  };
  return visit(value, 0) as T;
}

function prepareRpcArguments<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 24) return item;
    if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
      try {
        const url = new URL(item);
        if (url.origin === window.location.origin && url.pathname.startsWith('/media/')) {
          return `${url.pathname}${url.search}`;
        }
      } catch {
        return item;
      }
      return item;
    }
    if (!item || typeof item !== 'object') return item;
    const existing = seen.get(item);
    if (existing) return existing;
    if (Array.isArray(item)) {
      const next: unknown[] = [];
      seen.set(item, next);
      for (const entry of item) next.push(visit(entry, depth + 1));
      return next;
    }
    const next: JsonRecord = {};
    seen.set(item, next);
    for (const [key, entry] of Object.entries(item)) next[key] = visit(entry, depth + 1);
    return next;
  };
  return visit(value, 0) as T;
}

function describeError(value: unknown, fallback: string): { message: string; code?: string } {
  if (typeof value === 'string' && value.trim()) {
    return { message: value };
  }

  if (isRecord(value)) {
    const message =
      (typeof value.message === 'string' && value.message) ||
      (typeof value.error === 'string' && value.error) ||
      fallback;
    const code = typeof value.code === 'string' ? value.code : undefined;
    return { message, code };
  }

  return { message: fallback };
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new BrowserBridgeError('The CineGen server returned invalid JSON.', {
        status: response.status,
        cause,
      });
    }
  }

  // Development proxies and uncaught server errors sometimes omit a JSON
  // content type. Still accept a JSON body when it is otherwise well formed.
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function unwrapEnvelope<T>(payload: unknown, response: Response, operation: string): T {
  if (!response.ok) {
    const errorValue = isRecord(payload) && 'error' in payload ? payload.error : payload;
    const error = describeError(errorValue, `${operation} failed (${response.status}).`);
    throw new BrowserBridgeError(error.message, {
      status: response.status,
      code: error.code,
    });
  }

  if (isRecord(payload) && payload.ok === false) {
    const error = describeError(payload.error, `${operation} failed.`);
    throw new BrowserBridgeError(error.message, {
      status: response.status,
      code: error.code,
    });
  }

  if (isRecord(payload) && payload.ok === true && 'result' in payload) {
    return payload.result as T;
  }

  // Accept an unwrapped response too, which keeps the bridge friendly to
  // small development handlers and 204 responses.
  return payload as T;
}

async function post<T>(
  url: string,
  init: RequestInit,
  operation: string,
  options: RpcRequestOptions = {},
): Promise<T> {
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : undefined;
  const controller = timeoutMs === undefined ? undefined : new AbortController();
  let didTimeout = false;
  const timeoutId = controller && timeoutMs !== undefined
    ? globalThis.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, timeoutMs)
    : undefined;
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      signal: controller?.signal ?? init.signal,
    });
    const payload = await readResponse(response);
    return normalizeBrowserMediaReferences(unwrapEnvelope<T>(payload, response, operation));
  } catch (cause) {
    if (cause instanceof BrowserBridgeError) throw cause;
    if (didTimeout) {
      throw new BrowserBridgeError(
        `The CineGen server took too long while running ${operation}.`,
        { code: 'RPC_TIMEOUT', cause },
      );
    }
    throw new BrowserBridgeError(
      `Could not reach the CineGen server while running ${operation}.`,
      { cause },
    );
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}

export function invokeRpc<T>(
  namespace: string,
  method: string,
  args: readonly unknown[] = [],
  options: RpcRequestOptions = {},
): Promise<T> {
  const encodedNamespace = encodeURIComponent(namespace);
  const encodedMethod = encodeURIComponent(method);
  return post<T>(
    `${RPC_ROOT}/${encodedNamespace}/${encodedMethod}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: prepareRpcArguments(args) }),
    },
    `${namespace}.${method}`,
    options,
  );
}

/** Call a trusted CineGen companion server at an explicit origin. This is used
 * only from a localhost browser page so a local UI can reach the local CLI
 * service even when the page itself is served by the hosted-site dev runtime. */
export function invokeRpcAt<T>(
  origin: string,
  namespace: string,
  method: string,
  args: readonly unknown[] = [],
  options: RpcRequestOptions = {},
): Promise<T> {
  const encodedNamespace = encodeURIComponent(namespace);
  const encodedMethod = encodeURIComponent(method);
  const root = origin.replace(/\/+$/, '');
  return post<T>(
    `${root}${RPC_ROOT}/${encodedNamespace}/${encodedMethod}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: prepareRpcArguments(args) }),
    },
    `${namespace}.${method}`,
    options,
  );
}

export async function uploadFile(
  file: Blob,
  options: {
    name: string;
    type?: string;
    apiKey?: string;
    purpose?: 'dialog' | 'elements';
    relativePath?: string;
  },
): Promise<UploadResult> {
  const body = new FormData();
  body.append('file', file, options.name);
  body.append('name', options.name);
  if (options.type) body.append('type', options.type);
  if (options.apiKey) body.append('apiKey', options.apiKey);
  if (options.purpose) body.append('purpose', options.purpose);
  if (options.relativePath) body.append('relativePath', options.relativePath);

  const result = await post<UploadResult>(
    UPLOAD_URL,
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    },
    'file upload',
  );

  if (!isRecord(result)) {
    throw new BrowserBridgeError('The CineGen server returned an invalid upload result.');
  }

  return result as UploadResult;
}

export function getUploadReference(result: UploadResult, preference: 'path' | 'url'): string {
  const candidates = preference === 'path'
    ? [result.path, result.token, result.url]
    : [result.url, result.path, result.token];
  const reference = candidates.find((value): value is string => (
    typeof value === 'string' && value.length > 0
  ));

  if (!reference) {
    throw new BrowserBridgeError('The CineGen server did not return a path for the uploaded file.');
  }

  return reference;
}
