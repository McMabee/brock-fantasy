import { describe, expect, it } from 'vitest';

import { buildSnakeOrder, currentDraftTeamId, selectAutopick } from './draft';
import type { Athlete, DraftState } from './types';

describe('snake draft', () => {
  it('reverses team order on alternating rounds', () => {
    expect(buildSnakeOrder(['a', 'b', 'c'], 3)).toEqual([
      'a',
      'b',
      'c',
      'c',
      'b',
      'a',
      'a',
      'b',
      'c',
    ]);
  });

  it('finds the server-authoritative team on the clock', () => {
    const state: DraftState = {
      id: 'draft',
      leagueId: 'league',
      status: 'active',
      rounds: 2,
      currentOverallPick: 4,
      teamIdsInDraftOrder: ['a', 'b', 'c'],
      picks: [],
    };
    expect(currentDraftTeamId(state)).toBe('c');
  });
});

describe('autopick', () => {
  const athletes: Athlete[] = [
    {
      id: 'queued-unavailable',
      competitionId: 'competition',
      teamId: 'team',
      displayName: 'Unavailable',
      position: 'F',
      status: 'unavailable',
    },
    {
      id: 'ranked-legal',
      competitionId: 'competition',
      teamId: 'team',
      displayName: 'Legal pick',
      position: 'F',
      status: 'active',
    },
  ];

  it('uses queued then ranked legal athletes deterministically', () => {
    expect(
      selectAutopick({
        queuedAthleteIds: ['queued-unavailable'],
        rankedAthleteIds: ['ranked-legal'],
        athletes,
        alreadyDraftedAthleteIds: new Set(),
        isLegal: () => true,
      })?.id,
    ).toBe('ranked-legal');
  });
});
