export const FIREBASE_PROJECT = 'cinegen-734ba';
export const FIREBASE_KEY = 'AIzaSyDhxfLpKNqAMJWFCiUPaQiINUk2U2Wv9gA';
const ROOT = `projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;
export type RecordValue = Record<string, any>;
export interface Identity { uid: string; email: string; refreshToken: string }

export function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('A valid project ID is required.');
  return value;
}
export async function refreshIdentity(refreshToken: string) {
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!r.ok) throw new Error('Your CineGen connection expired. Reconnect your account.');
  const data = await r.json() as RecordValue;
  if (data.project_id !== '48352992061' || !data.id_token || !data.user_id) throw new Error('Invalid CineGen identity.');
  return { token: String(data.id_token), uid: String(data.user_id), refreshToken: String(data.refresh_token) };
}
export async function verifyIdentity(idToken: string) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) throw new Error('Sign in to your CineGen cloud account again.');
  const data = await r.json() as RecordValue;
  const user = data.users?.[0];
  if (!user?.localId || !user.email || user.disabled) throw new Error('Invalid CineGen account.');
  return { uid: String(user.localId), email: String(user.email).toLowerCase() };
}
export function encode(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encode(v)])) } };
}
export function decode(value: any): any {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([k,v])=>[k,decode(v)]));
  return null;
}
export function documentData(doc: any): RecordValue { return decode({ mapValue: { fields: doc.fields ?? {} } }); }

export class CloudStore {
  constructor(readonly token: string, readonly uid: string) {}
  async request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (r.status === 404) return null;
    if (!r.ok) {
      const error = await r.json().catch(()=>null) as any;
      if (r.status === 409 || r.status === 412 || error?.error?.status === 'FAILED_PRECONDITION' || error?.error?.status === 'ABORTED') throw new Error('This project changed on another device. Read it again before editing.');
      if (r.status === 401 || r.status === 403) throw new Error('Your CineGen account cannot access this project.');
      throw new Error(`Cloud storage failed (${r.status}). No success was confirmed.`);
    }
    return r.json();
  }
  async get(path: string) { return this.request(`/${path}`); }
  async list(path: string): Promise<any[]> {
    let page = ''; const result = [];
    do {
      const data = await this.request(`/${path}?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      result.push(...(data?.documents ?? [])); page = data?.nextPageToken ?? '';
    } while (page);
    return result;
  }
  write(path: string, data: RecordValue, updateTime?: string, create = false) {
    return { update: { name: `${ROOT}/${path}`, fields: encode(data).mapValue.fields }, ...(updateTime ? { currentDocument: { updateTime } } : create ? { currentDocument: { exists: false } } : {}) };
  }
  async commit(writes: any[]) { return this.request(':commit', { writes }); }
  async projects() {
    const owned = await this.list(`users/${this.uid}/projects`);
    const access = await this.request(':runQuery', { structuredQuery: { from: [{ collectionId: 'projectAccess' }], where: { fieldFilter: { field: { fieldPath: 'memberIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: this.uid } } } } });
    const teams = await this.request(':runQuery', { structuredQuery: { from: [{ collectionId: 'teams' }], where: { fieldFilter: { field: { fieldPath: 'memberIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: this.uid } } } } });
    for (const row of teams ?? []) {
      if (!row.document) continue;
      const teamId = row.document.name.split('/').at(-1);
      const teamAccess = await this.request(':runQuery', { structuredQuery: { from: [{ collectionId: 'projectAccess' }], where: { fieldFilter: { field: { fieldPath: 'teamId' }, op: 'EQUAL', value: { stringValue: teamId } } } } });
      access.push(...(teamAccess ?? []));
    }
    const rows = new Map(owned.map(d => [documentData(d).id, documentData(d)]));
    for (const row of access ?? []) {
      if (!row.document) continue;
      const a = documentData(row.document);
      if (rows.has(a.projectId)) continue;
      const d = await this.get(`users/${safeId(a.ownerId)}/projects/${safeId(a.projectId)}`);
      if (d) rows.set(a.projectId, documentData(d));
    }
    return [...rows.values()].map(({ id, name, updatedAt, assetCount, elementCount }) => ({ id, name, updatedAt, assetCount, elementCount }));
  }
  async load(projectId: string) {
    safeId(projectId);
    // Owners can read their project before legacy access metadata has been created.
    let ownerId = this.uid;
    let doc = await this.get(`users/${ownerId}/projects/${projectId}`);
    const accessDoc = await this.get(`projectAccess/${projectId}`).catch(e => { if (doc) return null; throw e; });
    const access = accessDoc ? documentData(accessDoc) : null;
    if (!doc && access) { ownerId = safeId(access.ownerId); doc = await this.get(`users/${ownerId}/projects/${projectId}`); }
    if (!doc) throw new Error('Cloud project not found. Sign in and sync it from CineGen first.');
    const metadata = documentData(doc);
    const revision = safeId(metadata.currentRevision);
    const revisionPath = `users/${ownerId}/projects/${projectId}/revisions/${revision}`;
    const marker = await this.get(revisionPath);
    const chunks = await this.list(`${revisionPath}/chunks`);
    const parts = chunks.map(documentData).sort((a,b)=>a.index-b.index);
    if (!marker || !documentData(marker).complete || parts.length !== metadata.chunkCount || parts.some((p,i)=>p.index!==i || typeof p.data!=='string')) throw new Error('Cloud project is incomplete. Reopen it after syncing finishes.');
    const state = JSON.parse(parts.map(p=>p.data).join(''));
    if (state.project?.id !== projectId) throw new Error('Stored project identity does not match.');
    const teamPath = access?.teamId ? `teams/${safeId(access.teamId)}` : null;
    const teamDoc = teamPath ? await this.get(teamPath) : null;
    const team = teamDoc ? documentData(teamDoc) : null;
    const library = team?.elementsLibraryJson ? JSON.parse(team.elementsLibraryJson) : { version: 1, elements: state.elements ?? [], folders: state.elementFolders ?? [] };
    return { projectId, ownerId, metadata, doc, state, teamPath, teamDoc, team, library };
  }
  async save(loaded: Awaited<ReturnType<CloudStore['load']>>, state: RecordValue, library = loaded.library) {
    const revision = crypto.randomUUID().replaceAll('-', '');
    const path = `users/${loaded.ownerId}/projects/${loaded.projectId}`;
    const revisionPath = `${path}/revisions/${revision}`;
    const serialized = JSON.stringify(state); const chunks = [];
    if (new TextEncoder().encode(serialized).length > 8*1024*1024) throw new Error('Project exceeds the remote edit size limit.');
    for (let i=0;i<serialized.length;i+=180000) chunks.push(serialized.slice(i,i+180000));
    if (chunks.length > 450) throw new Error('Project is too large for one remote edit.');
    const now = new Date().toISOString();
    const writes = chunks.map((data,index)=>this.write(`${revisionPath}/chunks/${String(index).padStart(6,'0')}`, { index, data }, undefined, true));
    writes.push(this.write(revisionPath, { chunkCount: chunks.length, createdAt: now, complete: true }, undefined, true));
    writes.push(this.write(path, { ...loaded.metadata, name: state.project.name, updatedAt: now, currentRevision: revision, chunkCount: chunks.length, assetCount: state.assets?.length ?? 0, elementCount: library.elements.length }, loaded.doc.updateTime));
    if (JSON.stringify(library)!==JSON.stringify(loaded.library)) {
      if (!loaded.teamPath || !loaded.teamDoc) throw new Error('Open this project in CineGen once to initialize its shared Elements library.');
      const json = JSON.stringify(library);
      if (new TextEncoder().encode(json).length > 850000) throw new Error('Shared Elements library is too large.');
      writes.push(this.write(loaded.teamPath, { ...loaded.team, elementsLibraryJson: json, elementsLibraryRevision: (loaded.team.elementsLibraryRevision ?? 0)+1, elementsLibraryUpdatedAt: now }, loaded.teamDoc.updateTime));
    }
    await this.commit(writes);
    return revision;
  }
}
