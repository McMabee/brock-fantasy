import type { LeagueFormat, MatchupResult, StandingsRow, UUID } from './types';

export interface TeamPoints {
  fantasyTeamId: UUID;
  points: number;
}

export interface ScheduledPairing {
  period: number;
  homeTeamId: UUID;
  awayTeamId: UUID;
}

export function generateRoundRobinSchedule(
  teamIds: readonly UUID[],
  cycles = 1,
): readonly ScheduledPairing[] {
  if (teamIds.length < 2) throw new Error('A schedule requires at least two teams.');
  if (!Number.isInteger(cycles) || cycles < 1) throw new Error('Cycles must be positive.');

  const bye = '__bye__';
  const rotation = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, bye];
  const roundsPerCycle = rotation.length - 1;
  const pairings: ScheduledPairing[] = [];

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const teams = [...rotation];
    for (let round = 0; round < roundsPerCycle; round += 1) {
      for (let index = 0; index < teams.length / 2; index += 1) {
        const left = teams[index];
        const right = teams[teams.length - 1 - index];
        if (!left || !right || left === bye || right === bye) continue;
        const reverse = (round + cycle) % 2 === 1;
        pairings.push({
          period: cycle * roundsPerCycle + round + 1,
          homeTeamId: reverse ? right : left,
          awayTeamId: reverse ? left : right,
        });
      }
      const fixed = teams[0];
      const tail = teams.slice(1);
      const last = tail.pop();
      if (!fixed || !last) throw new Error('Schedule rotation failed.');
      teams.splice(0, teams.length, fixed, last, ...tail);
    }
  }

  return pairings;
}

export function calculateStandings(
  format: LeagueFormat,
  teamIds: readonly UUID[],
  matchups: readonly MatchupResult[],
  totals: readonly TeamPoints[],
): readonly StandingsRow[] {
  const rows = new Map<UUID, Omit<StandingsRow, 'rank'>>(
    teamIds.map((fantasyTeamId) => [
      fantasyTeamId,
      {
        fantasyTeamId,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: totals.find((total) => total.fantasyTeamId === fantasyTeamId)?.points ?? 0,
        pointsAgainst: 0,
        standingPoints: 0,
      },
    ]),
  );

  for (const matchup of matchups.filter((item) => item.status === 'final')) {
    const home = rows.get(matchup.homeTeamId);
    const away = rows.get(matchup.awayTeamId);
    if (!home || !away) continue;
    home.pointsAgainst += matchup.awayPoints;
    away.pointsAgainst += matchup.homePoints;

    if (matchup.homePoints === matchup.awayPoints) {
      home.ties += 1;
      away.ties += 1;
      home.standingPoints += 1;
      away.standingPoints += 1;
    } else if (matchup.homePoints > matchup.awayPoints) {
      home.wins += 1;
      away.losses += 1;
      home.standingPoints += 2;
    } else {
      away.wins += 1;
      home.losses += 1;
      away.standingPoints += 2;
    }
  }

  const sorted = [...rows.values()].sort((left, right) => {
    if (format === 'head_to_head' && left.standingPoints !== right.standingPoints) {
      return right.standingPoints - left.standingPoints;
    }
    return (
      right.pointsFor - left.pointsFor || left.fantasyTeamId.localeCompare(right.fantasyTeamId)
    );
  });

  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}
