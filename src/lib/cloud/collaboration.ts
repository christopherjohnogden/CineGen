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

export type TeamRole = 'owner' | 'editor';
export type ProjectRole = TeamRole;

export interface TeamMember {
  uid: string;
  email: string;
  role: TeamRole;
  addedAt: string;
}

export interface TeamAccess {
  teamId: string;
  name: string;
  ownerId: string;
  members: Record<string, TeamRole>;
  memberIds: string[];
  memberDetails: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAccess {
  projectId: string;
  ownerId: string;
  teamId: string;
  teamName: string;
  members: Record<string, TeamRole>;
  memberIds: string[];
  memberDetails: TeamMember[];
  createdAt: string;
  updatedAt: string;
  legacy?: boolean;
}

interface StoredProjectAccess {
  projectId: string;
  ownerId: string;
  teamId: string;
  members: Record<string, TeamRole>;
  memberIds: string[];
  memberDetails: TeamMember[];
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

function teamRef(teamId: string) {
  return doc(cloudDb, 'teams', teamId);
}

function personalTeamId(uid: string): string {
  return `team_${uid}`;
}

function parseMembers(value: unknown): Record<string, TeamRole> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, TeamRole] => entry[1] === 'owner' || entry[1] === 'editor'),
  );
}

function parseMemberDetails(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const member = entry as Record<string, unknown>;
    const role = member.role === 'owner' ? 'owner' : member.role === 'editor' ? 'editor' : null;
    if (!role || typeof member.uid !== 'string') return [];
    return [{
      uid: member.uid,
      email: normalizedEmail(String(member.email ?? '')),
      role,
      addedAt: String(member.addedAt ?? ''),
    }];
  });
}

function parseStoredAccess(projectId: string, data: Record<string, unknown>): StoredProjectAccess {
  return {
    projectId,
    ownerId: String(data.ownerId ?? ''),
    teamId: String(data.teamId ?? ''),
    members: parseMembers(data.members),
    memberIds: Array.isArray(data.memberIds) ? data.memberIds.map(String) : [],
    memberDetails: parseMemberDetails(data.memberDetails),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

function parseTeam(teamId: string, data: Record<string, unknown>): TeamAccess {
  const members = parseMembers(data.members);
  return {
    teamId,
    name: String(data.name ?? 'CineGen Team'),
    ownerId: String(data.ownerId ?? ''),
    members,
    memberIds: Array.isArray(data.memberIds) ? data.memberIds.map(String) : Object.keys(members),
    memberDetails: parseMemberDetails(data.memberDetails),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

function projectWithTeam(access: StoredProjectAccess, team: TeamAccess): ProjectAccess {
  return {
    projectId: access.projectId,
    ownerId: access.ownerId,
    teamId: team.teamId,
    teamName: team.name,
    members: team.members,
    memberIds: team.memberIds,
    memberDetails: team.memberDetails,
    createdAt: access.createdAt,
    updatedAt: access.updatedAt,
  };
}

function legacyProject(access: StoredProjectAccess): ProjectAccess {
  return {
    ...access,
    teamName: 'Legacy project team',
    legacy: true,
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

export async function ensurePersonalTeam(user: User): Promise<TeamAccess> {
  await registerCloudIdentity(user);
  const id = personalTeamId(user.uid);
  const ref = teamRef(id);
  return runTransaction(cloudDb, async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists()) return parseTeam(id, existing.data());

    const timestamp = now();
    const email = normalizedEmail(user.email ?? '');
    const team: TeamAccess = {
      teamId: id,
      name: 'CineGen Team',
      ownerId: user.uid,
      members: { [user.uid]: 'owner' },
      memberIds: [user.uid],
      memberDetails: [{ uid: user.uid, email, role: 'owner', addedAt: timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    transaction.set(ref, team);
    return team;
  });
}

async function resolveAccess(access: StoredProjectAccess): Promise<ProjectAccess> {
  if (!access.teamId) return legacyProject(access);
  const snapshot = await getDoc(teamRef(access.teamId));
  if (!snapshot.exists()) throw new Error('The team for this project could not be found.');
  return projectWithTeam(access, parseTeam(access.teamId, snapshot.data()));
}

async function migrateLegacyProject(access: StoredProjectAccess, user: User): Promise<ProjectAccess> {
  if (access.ownerId !== user.uid) return legacyProject(access);
  const personalTeam = await ensurePersonalTeam(user);
  const projectRef = accessRef(access.projectId);
  const ref = teamRef(personalTeam.teamId);

  return runTransaction(cloudDb, async (transaction) => {
    const [projectSnapshot, teamSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(ref),
    ]);
    if (!projectSnapshot.exists() || !teamSnapshot.exists()) throw new Error('Project team migration could not be completed.');

    const currentAccess = parseStoredAccess(access.projectId, projectSnapshot.data());
    const team = parseTeam(personalTeam.teamId, teamSnapshot.data());
    if (currentAccess.teamId) return projectWithTeam(currentAccess, team);

    const timestamp = now();
    for (const member of currentAccess.memberDetails) {
      if (!member.uid) continue;
      const existingRole = team.members[member.uid];
      if (existingRole) {
        if (existingRole === 'editor' && member.role === 'owner') {
          team.members[member.uid] = 'owner';
          team.memberDetails = team.memberDetails.map((entry) => entry.uid === member.uid ? { ...entry, role: 'owner' } : entry);
        }
        continue;
      }
      team.members[member.uid] = member.role;
      team.memberIds.push(member.uid);
      team.memberDetails.push(member);
    }
    team.memberIds = [...new Set(team.memberIds)];
    team.updatedAt = timestamp;

    const migrated = {
      ...currentAccess,
      teamId: team.teamId,
      migratedAt: timestamp,
      updatedAt: timestamp,
    };
    transaction.set(ref, team);
    transaction.set(projectRef, migrated);
    return projectWithTeam(migrated, team);
  });
}

export async function ensureProjectAccess(projectId: string, user: User): Promise<ProjectAccess> {
  await registerCloudIdentity(user);
  const ref = accessRef(projectId);
  const current = await getDoc(ref);

  if (!current.exists()) {
    const team = await ensurePersonalTeam(user);
    const timestamp = now();
    const created: StoredProjectAccess = {
      projectId,
      ownerId: user.uid,
      teamId: team.teamId,
      members: {},
      memberIds: [],
      memberDetails: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await setDoc(ref, created);
    return projectWithTeam(created, team);
  }

  const stored = parseStoredAccess(projectId, current.data());
  const access = stored.teamId ? await resolveAccess(stored) : await migrateLegacyProject(stored, user);
  if (!access.members[user.uid]) throw new Error('You no longer have access to this team project.');
  return access;
}

export async function getProjectCollaboration(projectId: string): Promise<ProjectAccess | null> {
  const snapshot = await getDoc(accessRef(projectId));
  if (!snapshot.exists()) return null;
  return resolveAccess(parseStoredAccess(projectId, snapshot.data()));
}

export async function listTeams(uid: string): Promise<TeamAccess[]> {
  const snapshot = await getDocs(query(
    collection(cloudDb, 'teams'),
    where('memberIds', 'array-contains', uid),
  ));
  return snapshot.docs.map((entry) => parseTeam(entry.id, entry.data()));
}

export async function listSharedProjectAccess(uid: string): Promise<ProjectAccess[]> {
  const teams = await listTeams(uid);
  const teamProjects = await Promise.all(teams.map(async (team) => {
    const snapshot = await getDocs(query(
      collection(cloudDb, 'projectAccess'),
      where('teamId', '==', team.teamId),
    ));
    return snapshot.docs.map((entry) => projectWithTeam(parseStoredAccess(entry.id, entry.data()), team));
  }));

  // Keep pre-team project invitations visible until the original owner opens
  // the project and migrates it into their team.
  const legacySnapshot = await getDocs(query(
    collection(cloudDb, 'projectAccess'),
    where('memberIds', 'array-contains', uid),
  ));
  const legacy = legacySnapshot.docs
    .map((entry) => parseStoredAccess(entry.id, entry.data()))
    .filter((access) => !access.teamId)
    .map(legacyProject);

  const byProject = new Map<string, ProjectAccess>();
  for (const access of [...teamProjects.flat(), ...legacy]) byProject.set(access.projectId, access);
  return [...byProject.values()];
}

async function targetIdentity(emailInput: string): Promise<{ uid: string; email: string }> {
  const email = normalizedEmail(emailInput);
  if (!email) throw new Error('Enter your teammate’s email address.');
  const directory = await getDoc(doc(cloudDb, 'emailIndex', await emailKey(email)));
  if (!directory.exists() || normalizedEmail(String(directory.data().email ?? '')) !== email) {
    throw new Error('No CineGen account was found for that email. Ask them to sign in once, then try again.');
  }
  const uid = String(directory.data().uid ?? '');
  if (!uid) throw new Error('That CineGen account is not ready for team access yet.');
  return { uid, email };
}

export async function inviteTeamMember(
  projectId: string,
  currentUser: User,
  emailInput: string,
  role: TeamRole,
): Promise<ProjectAccess> {
  const access = await ensureProjectAccess(projectId, currentUser);
  if (!access.teamId) throw new Error('Open this project as its owner to finish the team migration first.');
  const target = await targetIdentity(emailInput);
  if (target.uid === currentUser.uid) throw new Error('You are already on this team.');

  const ref = teamRef(access.teamId);
  const team = await runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Team settings were not found.');
    const current = parseTeam(access.teamId, snapshot.data());
    if (current.members[currentUser.uid] !== 'owner') throw new Error('Only a team owner can invite people.');
    const timestamp = now();
    current.members = { ...current.members, [target.uid]: role };
    current.memberIds = [...new Set([...current.memberIds, target.uid])];
    const existing = current.memberDetails.some((member) => member.uid === target.uid);
    current.memberDetails = existing
      ? current.memberDetails.map((member) => member.uid === target.uid ? { ...member, email: target.email, role } : member)
      : [...current.memberDetails, { uid: target.uid, email: target.email, role, addedAt: timestamp }];
    current.updatedAt = timestamp;
    transaction.set(ref, current);
    return current;
  });
  return projectWithTeam({ ...access, teamId: team.teamId }, team);
}

export async function setTeamMemberRole(
  projectId: string,
  currentUser: User,
  memberUid: string,
  role: TeamRole,
): Promise<ProjectAccess> {
  const access = await ensureProjectAccess(projectId, currentUser);
  const ref = teamRef(access.teamId);
  const team = await runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Team settings were not found.');
    const current = parseTeam(access.teamId, snapshot.data());
    if (current.members[currentUser.uid] !== 'owner') throw new Error('Only a team owner can change permissions.');
    if (memberUid === current.ownerId && role !== 'owner') throw new Error('The original team owner cannot be demoted.');
    if (!current.members[memberUid]) throw new Error('That person is no longer on this team.');
    current.members = { ...current.members, [memberUid]: role };
    current.memberDetails = current.memberDetails.map((member) => member.uid === memberUid ? { ...member, role } : member);
    current.updatedAt = now();
    transaction.set(ref, current);
    return current;
  });
  return projectWithTeam({ ...access, teamId: team.teamId }, team);
}

export async function removeTeamMember(
  projectId: string,
  currentUser: User,
  memberUid: string,
): Promise<ProjectAccess> {
  const access = await ensureProjectAccess(projectId, currentUser);
  const ref = teamRef(access.teamId);
  const team = await runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Team settings were not found.');
    const current = parseTeam(access.teamId, snapshot.data());
    if (current.members[currentUser.uid] !== 'owner') throw new Error('Only a team owner can remove people.');
    if (memberUid === current.ownerId) throw new Error('The original team owner cannot be removed.');
    const { [memberUid]: _removed, ...remainingMembers } = current.members;
    current.members = remainingMembers;
    current.memberIds = current.memberIds.filter((uid) => uid !== memberUid);
    current.memberDetails = current.memberDetails.filter((member) => member.uid !== memberUid);
    current.updatedAt = now();
    transaction.set(ref, current);
    return current;
  });
  return projectWithTeam({ ...access, teamId: team.teamId }, team);
}

export async function renameTeam(
  projectId: string,
  currentUser: User,
  nameInput: string,
): Promise<ProjectAccess> {
  const name = nameInput.trim();
  if (!name) throw new Error('Enter a team name.');
  if (name.length > 60) throw new Error('Keep the team name under 60 characters.');
  const access = await ensureProjectAccess(projectId, currentUser);
  const ref = teamRef(access.teamId);
  const team = await runTransaction(cloudDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Team settings were not found.');
    const current = parseTeam(access.teamId, snapshot.data());
    if (current.members[currentUser.uid] !== 'owner') throw new Error('Only a team owner can rename the team.');
    current.name = name;
    current.updatedAt = now();
    transaction.set(ref, current);
    return current;
  });
  return projectWithTeam({ ...access, teamId: team.teamId }, team);
}

// Compatibility aliases for older callers while saved project data migrates.
export const inviteProjectCollaborator = inviteTeamMember;
export const setProjectCollaboratorRole = setTeamMemberRole;
export const removeProjectCollaborator = removeTeamMember;
