import { createHash } from 'node:crypto';

export const hashBytes = (value) => createHash('sha256').update(value).digest('hex');

export function playedSeconds(raw) {
  const match = /^(\d+):([0-5]\d)(?::00)?$/u.exec(raw.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function rosterDefinition(decisions, source, sourceHash, rowNumber, name) {
  const entry = decisions?.rosterSources?.find(
    (item) => item.source === source && item.sourceHash === sourceHash,
  );
  if (!entry) return null;
  const exact = (item) => item.sourceRowNumber === rowNumber && item.name === name;
  return {
    decisionId: decisions.decisionId,
    confirmedBy: decisions.confirmedBy,
    membership: entry.currentMembershipOverrides.find(exact)?.membership ?? null,
    historicalReason: entry.unavailableHistories.find(exact)?.reason ?? null,
    ignoreStaffAnnotations:
      decisions.annotations.staffNotes === 'ignore_in_calculations_preserve_raw',
    ignorePreviousTeamValues:
      decisions.annotations.previousTeamValues === 'ignore_in_calculations_preserve_raw',
    rankingInput: decisions.rankings,
  };
}

export function historicalGoalieDefinition(decisions, sourceHash, evidence, row, issues) {
  const definition = decisions?.goalieLog;
  if (!definition || definition.sourceHash !== sourceHash) return null;
  const match = evidence?.rows?.find((item) => item.sourceRowNumber === row.rowNumber);
  if (
    !match ||
    match.exactGoalieLineMatches !== 1 ||
    match.inferredAthlete !== definition.athlete ||
    Object.keys(row.raw).some((key) => row.raw[key] !== match.supplied[key]) ||
    Object.keys(match.supplied).some((key) => row.raw[key] !== match.supplied[key]) ||
    playedSeconds(row.raw.Mins) !== match.normalizedPlayedSeconds
  ) {
    issues.push({
      severity: 'error',
      code: 'GOALIE_EVIDENCE_MISMATCH',
      row: row.rowNumber,
      detail: 'Current goalie cells must exactly match the retained individual game evidence.',
    });
    return null;
  }
  const goalieRows = match.officialGoalieRows.filter((cells) => playedSeconds(cells[3] ?? '') > 0);
  const soleGoalie = goalieRows.length === 1;
  const shootout = /\(SO\)/u.test(match.officialScheduleText);
  const goalsAllowed = Number(row.raw.GA);
  const saves = Number(row.raw.Saves);
  const wins = match.officialDecision === 'W' ? 1 : 0;
  const losses = match.officialDecision === 'L' ? 1 : 0;
  // Operator confirms empty-net intervals are permitted: the only goalie used
  // qualifies even when individual time is below the full elapsed game time.
  const fullSoloGame = soleGoalie;
  // Full-game solo participation overrides every shutout scenario, including SO.
  const shutouts = fullSoloGame && (shootout || goalsAllowed === 0) ? 1 : 0;
  return {
    type: 'historical_goalie_stat_candidate',
    program: definition.program,
    athleteSourceReference: {
      source: definition.rosterSource,
      sourceRowNumber: definition.rosterSourceRowNumber,
      name: definition.athlete,
    },
    playedAt: match.date,
    phase: match.phase,
    playedSeconds: match.normalizedPlayedSeconds,
    sourceMinutes: row.raw.Mins,
    teamResult: row.raw.Result,
    teamScore: row.raw.Score,
    individualDecision: match.officialDecision || 'no_decision',
    stats: {
      wins,
      losses,
      goals_allowed: goalsAllowed,
      saves,
      shutouts,
      full_game_solo: fullSoloGame ? 1 : 0,
      shootout: shootout ? 1 : 0,
    },
    creditContext: {
      shootout,
      shootoutParticipant: shootout && soleGoalie ? true : null,
      soloCompleteGame: fullSoloGame,
      shutoutBasis: shutouts ? (shootout ? 'solo_shootout_bonus' : 'solo_zero_goals') : 'none',
    },
    calculatedPoints:
      Math.round((wins * 10 - goalsAllowed * 2 + saves * 0.4 + shutouts * 15) * 1000) / 1000,
    calculatedPointsPurpose: 'game_fixture_only_not_a_replacement_for_supplied_history',
    historicalSnapshot: definition.historicalSnapshot,
    decisionId: decisions.decisionId,
    officialEvidence: { sourceUrl: match.boxscoreUrl, sourceHash: match.sourceHash },
    draftEligible: false,
    awardsCurrentFantasyPoints: false,
  };
}
