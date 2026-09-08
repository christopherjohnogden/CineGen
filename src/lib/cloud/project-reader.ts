import type { User } from 'firebase/auth';

const API = 'https://firestore.googleapis.com/v1/projects/cinegen-734ba/databases/(default)/documents';
type Document = { name: string; fields?: Record<string, any> };

function data(document: Document): Record<string, any> {
  const decode = (value: any): any => {
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
    if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, v]) => [key, decode(v)]));
    return null;
  };
  return decode({ mapValue: { fields: document.fields ?? {} } });
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid cloud project reference.');
  return value;
}

/** A bounded, read-only path independent of Firestore's streaming/write queue.
 * Uses the signed-in user's token, so the same Firestore rules still apply.
 */
export async function readCloudProject(user: User, projectId: string, signal?: AbortSignal, known?: { ownerId?: string; revision?: string }) {
  id(projectId);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('The cloud project took too long to respond. Please try again.')), 25_000);
  const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) { abort(); return; }
    controller.signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
  });
  try {
    let token = await bounded(user.getIdToken());
    async function get(path: string): Promise<any> {
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        const request = new AbortController();
        const abort = () => request.abort(controller.signal.reason);
        controller.signal.addEventListener('abort', abort, { once: true });
        const requestTimeout = setTimeout(() => request.abort(new Error('Cloud request timed out.')), 8_000);
        try {
          const response = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: request.signal, cache: 'no-store' });
          if (response.status === 404) return null;
          if (response.status === 401 && attempt === 0) { token = await bounded(user.getIdToken(true)); continue; }
          if (response.status === 401 || response.status === 403) throw Object.assign(new Error('Your account cannot open this project. Sign in with an account that has access.'), { terminal: true });
          if (!response.ok) throw Object.assign(new Error(`Cloud project could not be read (${response.status}).`), { terminal: response.status < 500 && response.status !== 429 });
          return await response.json();
        } catch (error) {
          controller.signal.throwIfAborted();
          if (attempt === 1 || (error as { terminal?: boolean }).terminal) throw error;
        } finally {
          clearTimeout(requestTimeout);
          controller.signal.removeEventListener('abort', abort);
        }
      }
    }
    // Owners can open legacy projects without creating/migrating access metadata.
    let ownerId = id(known?.ownerId ?? user.uid);
    let project = await get(`users/${ownerId}/projects/${projectId}`);
    if (!project) {
      const access = await get(`projectAccess/${projectId}`);
      if (!access) throw new Error('This cloud project was not found.');
      ownerId = id(data(access).ownerId);
      project = await get(`users/${ownerId}/projects/${projectId}`);
    }
    if (!project) throw new Error('This cloud project was not found.');
    const metadata = data(project);
    const revision = id(metadata.currentRevision);
    // Poll only the small project header when there is nothing new. Media and
    // revision chunks are fetched once the server advertises a different save.
    if (ownerId === known?.ownerId && revision === known.revision) {
      return { ownerId, revision, state: undefined };
    }
    const path = `users/${ownerId}/projects/${projectId}/revisions/${revision}`;
    const [marker, chunks] = await Promise.all([
      get(path),
      (async () => {
        const documents: Document[] = [];
        let page = '';
        do {
          const result = await get(`${path}/chunks?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
          documents.push(...(result?.documents ?? []));
          page = result?.nextPageToken ?? '';
        } while (page);
        return documents.map(data).sort((a, b) => a.index - b.index);
      })(),
    ]);
    if (!marker || !data(marker).complete || !chunks.length || chunks.length !== metadata.chunkCount
      || chunks.some((chunk, index) => chunk.index !== index || typeof chunk.data !== 'string')) {
      throw new Error('The cloud project is still saving. Try opening it again in a moment.');
    }
    const state = JSON.parse(chunks.map(chunk => chunk.data).join(''));
    if (state.project?.id !== projectId) throw new Error('The saved project identity does not match.');
    controller.signal.throwIfAborted();
    return { ownerId, revision, state };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
