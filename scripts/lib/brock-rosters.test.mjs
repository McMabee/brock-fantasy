import assert from 'node:assert/strict';
import test from 'node:test';
import { rosterName, rosterParticipation, suppliedRanking } from './brock-rosters.mjs';

test('double asterisks suppress fantasy participation while keeping a clean identity name', () => {
  const result = rosterParticipation('mens_volleyball', '  Fixture  Athlete**  ', null);
  assert.equal(result.name, 'Fixture Athlete');
  assert.equal(result.participationStatus, 'opted_out');
  assert.equal(result.excludedFromFantasy, true);
  assert.equal(result.participationEvidence.basis, 'source_name_double_asterisk');
  assert.equal(rosterName('Single*'), 'Single*');
  assert.equal(rosterParticipation('mens_hockey', 'Single*', null).excludedFromFantasy, false);
});

test('recorded opt-outs survive marker removal and row or jersey changes within the same program', () => {
  const ledger = {
    revision: 'fixture-withdrawal',
    athletes: [{ program: 'mens_volleyball', name: 'Fixture Athlete', jerseyNumber: '5' }],
  };
  const result = rosterParticipation('mens_volleyball', 'fixture athlete', ledger);
  assert.equal(result.excludedFromFantasy, true);
  assert.equal(result.participationEvidence.basis, 'retained_opt_out');
  assert.equal(
    rosterParticipation('womens_volleyball', 'Fixture Athlete', ledger).excludedFromFantasy,
    false,
  );
  assert.equal(
    rosterParticipation('mens_volleyball', 'Different Athlete', ledger).excludedFromFantasy,
    false,
  );
});

test('supplied ranking preserves zero and negative projections and never substitutes missing history', () => {
  const definition = { status: 'supplied_season_projections', tieBreak: 'reproducible_random' };
  for (const value of [0, -4, 218]) {
    const result = suppliedRanking(
      { suppliedSeasonProjection: { kind: 'number', value } },
      definition,
    );
    assert.equal(result.status, 'ready');
    assert.equal(result.points, value);
  }
  for (const kind of ['missing', 'not_available', 'text']) {
    const result = suppliedRanking(
      {
        suppliedSeasonProjection: { kind },
        historicalFantasyPoints: { kind: 'number', value: 999 },
      },
      definition,
    );
    assert.equal(result.status, 'unavailable');
    assert.equal(result.points, null);
  }
});

test('withdrawal overrides even a complete numeric projection', () => {
  assert.deepEqual(
    suppliedRanking(
      { excludedFromFantasy: true, suppliedSeasonProjection: { kind: 'number', value: 999 } },
      { status: 'supplied_season_projections' },
    ),
    { status: 'excluded', points: null, basis: 'athlete_opt_out' },
  );
});
