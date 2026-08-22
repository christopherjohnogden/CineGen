import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { cloudDb } from './firebase';

export type ProjectRole = 'owner' | 'editor';

export interface ProjectMember {
  uid: string;
  email: string;
  role: ProjectRole;
  addedAt: string;
}

export interface ProjectAccess {
  projectId: string;
  ownerId: string;
  members: Record<string, ProjectRole>;
  memberIds: string[];
  memberDetails: ProjectMember[];
  createdAt: string;
  updatedAt: string;
}

function now(): string {
  return new Date().toISOString();
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function emailKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizedEmail(email));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function accessRef(projectId: string) {
  return doc(cloudDb, 'projectAccess', projectId);
}

function parseAccess(projectId: string, data: Record<string, unknown>): ProjectAccess {
  return {
    projectId,
    ownerId: String(data.ownerId ?? ''),
    members: (data.members ?? {}) as Record<string, ProjectRole>,
    memberIds: Array.isArray(data.memberIds) ? data.memberIds.map(String) : [],
    memberDetails: Array.isArray(data.memberDetails) ? data.memberDetails as ProjectMember[] : [],
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

export async function registerCloudIdentity(user: User): Promise<void> {
  const email = normalizedEmail(user.email ?? '');
  if (!email) return;
  const key = await emailKey(email);
  await setDoc(doc(cloudDb, 'emailIndex', key), {
    uid: user.uid,
    email,
    updatedAt: now(),
  }, { merge: true });
}

export async function ensureProjectAccess(
  projectId: string,
  user: User,
): Promise<ProjectAccess> {
  await registerCloudIdentity(user);
  const ref = accessRef(projectId);
  const access = await runTransaction(cloudDb, async (transaction) => {
    const current = await transaction.get(ref);
    if (current.exists()) return parseAccess(projectId, current.data());
    const timestamp = now();
    const email = normalizedEmail(user.email ?? '');
    const created: ProjectAccess = {
      projectId,
      ownerId: user.uid,
      members: { [user.uid]: 'owner' },
      memberIds: [user.uid],
      memberDetails: [{ uid: user.uid, email, role: 'owner', addedAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    transaction.set(ref, created);
    return created;
  });
  if (!access.members[user.uid]) throw new Error('You no longer have access to this shared project.');
  return access;
}

export async function getProjectCollaboration(projectId: string): Promise<ProjectAccess | null> {
  const snapshot = await getDoc(accessRef(projectId));
  return snapshot.exists() ? parseAccess(projectId, snapshot.data()) : null;
}

export async function listSharedProjectAccess(uid: string): Promise<ProjectAccess[]> {
  const snapshot = await getDocs(query(
    collection(cloudDb, 'projectAccess'),
    where('memberIds', 'array-contains', uid),
  ));
  return snapshot.docs.map((entry) => parseAccess(entry.id, entry.data()));
}

export async function inviteProjectCollaborator(
  projectId: string,
  currentUser: User,
  emailInput: string,
  role: ProjectRole,
): Promise<ProjectAccess> {
  const email = normalizedEmail(emailInput);
  if (!email) throw new Error('Enter your collaborator’s email address.');
  if (email === normalizedEmail(currentUser.email ?? '')) throw new Error('You already have access to this project.');

  const directory = await getDoc(doc(cloudDb, 'emailIndex', await emailKey(email)));
  if (!directory.exists() || normalizedEmail(String(directory.data().email ?? '')) !== email) {
    throw new Error('No CineGen account was found for that email. Ask them to sign in once, then try again.');
  }
  const targetUid = String(directory.data().uid ?? '');
  if (!targetUid) throw new Error('That CineGen account is not ready for collaboration yet.');

  const ref = accessRef(projectId);
  return runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Turn on cloud sync for this project before inviting someone.');
    const access = parseAccess(projectId, snapshot.data());
    if (access.members[currentUser.uid] !== 'owner') throw new Error('Only a project owner can invite collaborators.');
    const timestamp = now();
    access.members = { ...access.members, [targetUid]: role };
    access.memberIds = [...new Set([...access.memberIds, targetUid])];
    const existing = access.memberDetails.find((member) => member.uid === targetUid);
    access.memberDetails = existing
      ? access.memberDetails.map((member) => member.uid === targetUid ? { ...member, email, role } : member)
      : [...access.memberDetails, { uid: targetUid, email, role, addedAt: timestamp }];
    access.updatedAt = timestamp;
    transaction.set(ref, access);
    return access;
  });
}

export async function setProjectCollaboratorRole(
  projectId: string,
  currentUser: User,
  memberUid: string,
  role: ProjectRole,
): Promise<ProjectAccess> {
  const ref = accessRef(projectId);
  return runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Project access settings were not found.');
    const access = parseAccess(projectId, snapshot.data());
    if (access.members[currentUser.uid] !== 'owner') throw new Error('Only a project owner can change permissions.');
    if (memberUid === access.ownerId && role !== 'owner') throw new Error('The original project owner cannot be demoted.');
    if (!access.members[memberUid]) throw new Error('That collaborator no longer has project access.');
    access.members = { ...access.members, [memberUid]: role };
    access.memberDetails = access.memberDetails.map((member) => member.uid === memberUid ? { ...member, role } : member);
    access.updatedAt = now();
    transaction.set(ref, access);
    return access;
  });
}

export async function removeProjectCollaborator(
  projectId: string,
  currentUser: User,
  memberUid: string,
): Promise<ProjectAccess> {
  const ref = accessRef(projectId);
  return runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Project access settings were not found.');
    const access = parseAccess(projectId, snapshot.data());
    if (access.members[currentUser.uid] !== 'owner') throw new Error('Only a project owner can remove collaborators.');
    if (memberUid === access.ownerId) throw new Error('The original project owner cannot be removed.');
    const { [memberUid]: _removed, ...remainingMembers } = access.members;
    access.members = remainingMembers;
    access.memberIds = access.memberIds.filter((uid) => uid !== memberUid);
    access.memberDetails = access.memberDetails.filter((member) => member.uid !== memberUid);
    access.updatedAt = now();
    transaction.set(ref, access);
    return access;
  });
}
