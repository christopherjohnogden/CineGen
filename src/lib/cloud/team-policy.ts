export interface ProjectTeamCandidate {
  teamId: string;
  members: Record<string, unknown>;
}

export function chooseProjectCreationTeam<T extends ProjectTeamCandidate>(
  userId: string,
  preferredTeamId: string,
  teams: T[],
): T | null {
  const preferred = preferredTeamId
    ? teams.find((team) => team.teamId === preferredTeamId && Boolean(team.members[userId]))
    : undefined;
  if (preferred) return preferred;
  if (teams.length === 1 && teams[0].members[userId]) return teams[0];
  return teams.find((team) => team.teamId === `team_${userId}` && Boolean(team.members[userId])) ?? null;
}

export function canDeleteTeamProject(projectCreatorId: string, userId: string): boolean {
  return Boolean(projectCreatorId) && projectCreatorId === userId;
}
