import { describe, expect, it } from 'vitest';
import { parseParticipation } from './participation';
import { completeDraftRoster, legalDraftAthletes } from './draft-room';

describe('varsity participation', () => {
  it('requires an explicit role and valid, unique program selections', () => {
    expect(parseParticipation(undefined, [])).toBeNull();
    expect(parseParticipation('none', [])).toEqual({ role: 'none', programs: [] });
    expect(parseParticipation('coach', [])).toBeNull();
    expect(parseParticipation('athlete', ['womens_volleyball'])).toEqual({
      role: 'athlete',
      programs: ['womens_volleyball'],
    });
    expect(parseParticipation('coach', ['womens_volleyball', 'womens_volleyball'])).toBeNull();
    expect(parseParticipation('athlete', ['not-a-program'])).toBeNull();
    expect(parseParticipation('none', ['mens_hockey'])).toBeNull();
  });
  it('finds a complete draft allocation with manager-specific teammate exclusions', () => {
    const slots = [
      { teamId: 'varsity', code: 'VB', positions: ['HT', 'L', 'S'] },
      { teamId: 'other', code: 'VB', positions: ['HT', 'L', 'S'] },
    ];
    const candidates = [
      { id: 'teammate', positions: ['L'], ownerId: null, blockedTeamIds: ['varsity'] },
      { id: 'other-program', positions: ['S'], ownerId: null },
    ];
    expect(completeDraftRoster(candidates, slots)?.size).toBe(2);
    expect(legalDraftAthletes(candidates, slots, 'varsity')).toEqual(['other-program']);
    expect(
      completeDraftRoster([{ ...candidates[0]!, ownerId: 'varsity' }, candidates[1]!], slots),
    ).toBeNull();
  });
});
