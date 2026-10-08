import assert from 'node:assert/strict';
import test from 'node:test';
import { rosterPlan, sourceUuid, programs } from './roster-materialization.mjs';

function fixture() {
  return {
    seasonId: 'b0000000-0000-4000-8000-000000000002',
    season: '2026-27',
    issues: [],
    imports: Object.keys(programs).map((program, index) => ({
      kind: 'roster',
      source: `fixture/${program}.csv`,
      sourceHash: `source-${index}`,
      revisionHash: `revision-${index}`,
      issues: [],
      approval: {
        sourceHash: `source-${index}`,
        scopes: ['athlete_identity', 'verified_positions', 'current_roster_approval'],
      },
      rows: [
        {
          rowNumber: 20,
          raw: { Name: 'Fixture Athlete' },
          normalized: {
            type: 'athlete_season_candidate',
            sourceSection: 'current_season',
            program,
            name: 'Fixture Athlete',
            positions: ['F'],
            sourcePosition: 'Forward',
            participationStatus: 'participating',
            identityStatus: 'source_owner_confirmed',
            membershipStatus: 'source_owner_confirmed',
            positionStatus: 'source_owner_confirmed',
            bio: {},
            historicalFantasyPoints: { kind: 'number', value: 0 },
            gamesPlayed: { kind: 'missing' },
            suppliedSeasonProjection: { kind: 'number', value: -4 },
            suppliedProjectedGames: { kind: 'number', value: 0 },
          },
        },
      ],
    })),
  };
}
const operator = '11111111-1111-4111-8111-111111111111';
test('raw ** marks and retained withdrawals are excluded even when normalized names are clean', () => {
  const manifest = fixture();
  manifest.imports[0].rows[0].raw.Name += '**';
  manifest.imports[1].rows[0].normalized.excludedFromFantasy = true;
  const plan = rosterPlan(manifest, operator);
  assert.equal(plan.players.length, 4);
  assert.equal(plan.excluded.length, 2);
});
test('prior-season rows and unconfirmed current identities cannot be published as current players', () => {
  const manifest = fixture();
  manifest.imports[0].rows[0].normalized.sourceSection = 'previous_season';
  assert.equal(rosterPlan(manifest, operator).players.length, 5);
  manifest.imports[1].rows[0].normalized.identityStatus = 'review_required';
  assert.throws(() => rosterPlan(manifest, operator), /confirmed current identity/);
});
test('identity comes from a source record, remains stable on retry, and never merges equal names', () => {
  const manifest = fixture();
  const first = rosterPlan(manifest, operator);
  assert.equal(new Set(first.players.map((player) => player.id)).size, 6);
  assert.deepEqual(rosterPlan(manifest, operator), first);
  manifest.imports[0].revisionHash = 'changed-revision';
  assert.notEqual(rosterPlan(manifest, operator).players[0].id, first.players[0].id);
  assert.match(sourceUuid('fixture'), /^[0-9a-f-]{36}$/u);
});
test('history/projection values retain negative, zero and missing distinctions', () => {
  const player = rosterPlan(fixture(), operator).players[0];
  assert.equal(player.historicalPoints, 0);
  assert.equal(player.historicalGames, null);
  assert.equal(player.projectedPoints, -4);
  assert.equal(player.projectedGames, 0);
});
test('incomplete approval or duplicate program releases fail before any database operation', () => {
  const manifest = fixture();
  manifest.imports[0].approval.sourceHash = 'changed-source';
  assert.throws(() => rosterPlan(manifest, operator), /approval/);
  manifest.imports[0] = manifest.imports[1];
  assert.throws(() => rosterPlan(manifest, operator), /unique and supported/);
});
