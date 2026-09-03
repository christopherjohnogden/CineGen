import { describe, expect, it } from 'vitest';
import { canDeleteTeamProject, chooseProjectCreationTeam } from '@/lib/cloud/team-policy';

describe('team project policy', () => {
  const ownerTeam = {
    teamId: 'team_owner',
    members: { owner: 'owner', teammate: 'editor' },
  };
  const teammatePersonalTeam = {
    teamId: 'team_teammate',
    members: { teammate: 'owner' },
  };

  it('creates in the explicitly preferred shared team', () => {
    expect(chooseProjectCreationTeam(
      'teammate',
      ownerTeam.teamId,
      [teammatePersonalTeam, ownerTeam],
    )).toBe(ownerTeam);
  });

  it('uses a sole shared team for a newly invited teammate', () => {
    expect(chooseProjectCreationTeam('teammate', '', [ownerTeam])).toBe(ownerTeam);
  });

  it('falls back to the member’s personal team when no preference is set', () => {
    expect(chooseProjectCreationTeam(
      'teammate',
      '',
      [ownerTeam, teammatePersonalTeam],
    )).toBe(teammatePersonalTeam);
  });

  it('allows only the project creator to delete the project', () => {
    expect(canDeleteTeamProject('owner', 'owner')).toBe(true);
    expect(canDeleteTeamProject('owner', 'teammate')).toBe(false);
    expect(canDeleteTeamProject('teammate', 'owner')).toBe(false);
  });
});
