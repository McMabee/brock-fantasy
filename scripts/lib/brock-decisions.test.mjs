import assert from 'node:assert/strict';
import test from 'node:test';
import { historicalGoalieDefinition, playedSeconds, rosterDefinition } from './brock-decisions.mjs';

// CI exercises the import contract without depending on private approval records.
// Exact reviewed-source checks are retained in dev/tests for local execution.
const decisions = {
  decisionId: 'synthetic-decision',
  confirmedBy: 'Fixture reviewer',
  annotations: {
    staffNotes: 'ignore_in_calculations_preserve_raw',
    previousTeamValues: 'ignore_in_calculations_preserve_raw',
  },
  rankings: { points: null, placeholder: 'Pending' },
  rosterSources: [
    {
      source: 'fixture/roster.csv',
      sourceHash: 'fixture-roster-hash',
      currentMembershipOverrides: [
        { sourceRowNumber: 2, name: 'Fixture athlete', membership: 'current_season' },
      ],
      unavailableHistories: [
        { sourceRowNumber: 3, name: 'Fixture rookie A', reason: 'first_varsity_year' },
        { sourceRowNumber: 4, name: 'Fixture rookie B', reason: 'first_varsity_year' },
      ],
    },
  ],
  goalieLog: {
    sourceHash: 'fixture-goalie-hash',
    athlete: 'Fixture goalie',
    program: 'womens_hockey',
    rosterSource: 'fixture/roster.csv',
    rosterSourceRowNumber: 5,
    historicalSnapshot: { gamesPlayed: 8, fantasyPoints: 88 },
  },
};
const evidence = {
  sourceHash: 'fixture-goalie-hash',
  rows: [
    { date: '2026-10-10', decision: 'W', mins: '60:00:00', ga: '0', saves: '30' },
    { date: '2026-10-11', decision: 'L', mins: '65:37:00', ga: '3', saves: '27', shootout: true },
    { date: '2026-10-12', decision: '', mins: '21:44', ga: '2', saves: '20' },
  ].map((fixture, index) => ({
    sourceRowNumber: index + 2,
    exactGoalieLineMatches: 1,
    inferredAthlete: 'Fixture goalie',
    supplied: {
      Mins: fixture.mins,
      GA: fixture.ga,
      Saves: fixture.saves,
      Result: fixture.decision === 'W' ? 'W' : 'L',
      Score: 'fixture result',
    },
    normalizedPlayedSeconds: playedSeconds(fixture.mins),
    officialGoalieRows: [
      ['1', 'Fixture goalie', fixture.decision, fixture.mins, fixture.ga, fixture.saves],
    ],
    officialScheduleText: fixture.shootout ? 'Fixture game (SO)' : 'Fixture game',
    officialDecision: fixture.decision,
    date: fixture.date,
    phase: 'regular_season',
    boxscoreUrl: `https://example.com/fixture/${index + 1}`,
    sourceHash: `fixture-game-${index + 1}`,
  })),
};

test('goalie durations are elapsed minutes/seconds, with only the approved export suffix', () => {
  assert.equal(playedSeconds('60:00:00'), 3600);
  assert.equal(playedSeconds('65:37:00'), 3937);
  assert.equal(playedSeconds('21:44'), 1304);
  assert.equal(playedSeconds('8:30'), 510);
  for (const value of ['60:60:00', '65:37:01', '8:3', '-1:00', 'TBA', ''])
    assert.equal(playedSeconds(value), null);
});

test('membership overrides need the exact source revision, row and confirmed name', () => {
  const source = decisions.rosterSources.find((item) => item.currentMembershipOverrides.length);
  const athlete = source.currentMembershipOverrides[0];
  assert.equal(
    rosterDefinition(
      decisions,
      source.source,
      source.sourceHash,
      athlete.sourceRowNumber,
      athlete.name,
    ).membership,
    'current_season',
  );
  assert.equal(
    rosterDefinition(decisions, source.source, 'changed', athlete.sourceRowNumber, athlete.name),
    null,
  );
  assert.equal(
    rosterDefinition(
      decisions,
      source.source,
      source.sourceHash,
      athlete.sourceRowNumber + 1,
      athlete.name,
    ).membership,
    null,
  );
  assert.equal(
    rosterDefinition(
      decisions,
      source.source,
      source.sourceHash,
      athlete.sourceRowNumber,
      'Another athlete',
    ).membership,
    null,
  );
});

test('unavailable histories retain individual first-varsity-year definitions', () => {
  const entries = decisions.rosterSources.flatMap((source) =>
    source.unavailableHistories.map((athlete) => ({ source, athlete })),
  );
  assert.equal(entries.length, 2);
  for (const { source, athlete } of entries) {
    const definition = rosterDefinition(
      decisions,
      source.source,
      source.sourceHash,
      athlete.sourceRowNumber,
      athlete.name,
    );
    assert.equal(definition.historicalReason, 'first_varsity_year');
    assert.equal(definition.rankingInput.points, null);
    assert.equal(definition.rankingInput.placeholder, 'Pending');
    assert.equal(definition.ignorePreviousTeamValues, true);
  }
});

test('goalie attribution preserves exact individual evidence and the separate historical snapshot', () => {
  const issues = [];
  const lines = evidence.rows.map((row) =>
    historicalGoalieDefinition(
      decisions,
      evidence.sourceHash,
      evidence,
      { rowNumber: row.sourceRowNumber, raw: row.supplied },
      issues,
    ),
  );
  assert.equal(issues.length, 0);
  assert.equal(lines.length, 3);
  assert.ok(
    lines.every(
      (line) =>
        line.program === 'womens_hockey' && line.athleteSourceReference.name === 'Fixture goalie',
    ),
  );
  assert.ok(
    lines.every(
      (line) =>
        line.historicalSnapshot.gamesPlayed === 8 &&
        line.historicalSnapshot.fantasyPoints === 88 &&
        !line.awardsCurrentFantasyPoints,
    ),
  );
  const shootouts = lines.filter((line) => line.creditContext.shootout);
  assert.equal(shootouts.length, 1);
  assert.ok(shootouts.every((line) => line.stats.shutouts === 1));
  assert.ok(shootouts.some((line) => line.stats.losses === 1 && line.stats.goals_allowed > 0));
  const noDecision = lines.find((line) => line.playedAt === '2026-10-12');
  assert.equal(noDecision.teamResult, 'L');
  assert.equal(noDecision.stats.losses, 0);
  assert.equal(noDecision.stats.wins, 0);
  const points = lines
    .filter((line) => line.phase === 'regular_season')
    .reduce((sum, line) => sum + line.calculatedPoints, 0);
  assert.equal(Math.round(points * 1000) / 1000, 60.8);
});

test('changed goalie cells fail attribution instead of inheriting a reviewed athlete', () => {
  const row = evidence.rows[0];
  const issues = [];
  assert.equal(
    historicalGoalieDefinition(
      decisions,
      evidence.sourceHash,
      evidence,
      { rowNumber: row.sourceRowNumber, raw: { ...row.supplied, Saves: '999' } },
      issues,
    ),
    null,
  );
  assert.equal(issues[0].code, 'GOALIE_EVIDENCE_MISMATCH');
  assert.equal(
    historicalGoalieDefinition(
      decisions,
      'changed',
      evidence,
      { rowNumber: row.sourceRowNumber, raw: row.supplied },
      [],
    ),
    null,
  );
});

test('shared shootout appearances never receive SO; empty-net intervals do not disqualify a sole goalie', () => {
  const row = evidence.rows.find((item) => /\(SO\)/u.test(item.officialScheduleText));
  const shared = structuredClone(evidence);
  shared.rows
    .find((item) => item.sourceRowNumber === row.sourceRowNumber)
    .officialGoalieRows.push(['30', 'Other goalie', '', '1:00', '0', '0']);
  const line = historicalGoalieDefinition(
    decisions,
    evidence.sourceHash,
    shared,
    { rowNumber: row.sourceRowNumber, raw: row.supplied },
    [],
  );
  assert.equal(line.stats.shutouts, 0);
  assert.equal(line.stats.full_game_solo, 0);
  assert.equal(line.stats.shootout, 1);
  const solo = historicalGoalieDefinition(
    decisions,
    evidence.sourceHash,
    evidence,
    { rowNumber: row.sourceRowNumber, raw: row.supplied },
    [],
  );
  assert.equal(solo.stats.shutouts, 1);
  assert.equal(solo.sourceMinutes, '65:37:00');
});
