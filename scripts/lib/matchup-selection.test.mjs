import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchupHeading,
  nextMatchupBoundary,
  selectMyMatchup,
} from '../../apps/client/src/lib/matchup-selection.ts';

const row = (period, status, startsAt, endsAt) => ({
  id: `week-${period}`,
  leagueId: 'league',
  homeTeamId: 'mine',
  awayTeamId: 'other',
  homePoints: 12,
  awayPoints: 8,
  period,
  status,
  startsAt,
  endsAt,
});
const first = row(1, 'active', '2026-10-24T00:00:00-04:00', '2026-11-01T00:00:00-04:00');
const second = row(2, 'scheduled', first.endsAt, '2026-11-14T00:00:00-05:00');
const third = row(3, 'scheduled', second.endsAt, '2026-11-22T00:00:00-05:00');
const choose = (rows, at) => selectMyMatchup(rows, 'mine', Date.parse(at));

test('calendar selects week two despite expired active or final week one', () => {
  for (const status of ['active', 'final', 'scheduled']) {
    const rows = [{ ...first, status }, second, third];
    assert.strictEqual(choose(rows, '2026-11-03T12:00:00Z'), second);
    assert.equal(second.status, 'scheduled');
    assert.equal(second.homePoints, 12);
  }
});

test('week one remains current until its exclusive end boundary', () => {
  assert.strictEqual(choose([second, first], '2026-11-01T03:59:59.999Z'), first);
  assert.strictEqual(choose([first, second], '2026-11-01T04:00:00Z'), second);
});

test('current calendar period wins for every stored operational status', () => {
  for (const status of ['scheduled', 'active', 'final']) {
    const current = { ...second, status };
    assert.strictEqual(choose([first, current], '2026-11-03T12:00:00Z'), current);
  }
});

test('multiple stale active periods cannot override subsequent weeks', () => {
  const rows = [first, { ...second, status: 'active' }, third];
  assert.strictEqual(choose(rows, third.startsAt), third);
});

test('upcoming fallback retains scheduled status and has an upcoming heading', () => {
  const now = '2026-10-23T12:00:00Z';
  const upcoming = { ...first, status: 'scheduled' };
  assert.strictEqual(choose([second, upcoming], now), upcoming);
  assert.equal(matchupHeading(upcoming, Date.parse(now)), 'Upcoming matchup');
  assert.equal(choose([{ ...upcoming, status: 'active' }], now), undefined);
});

test('calendar gaps prefer the next schedule then the most recently ended period', () => {
  const previous = { ...first, endsAt: '2026-10-30T00:00:00-04:00' };
  const now = '2026-10-31T12:00:00Z';
  assert.strictEqual(choose([previous, second], now), second);
  assert.strictEqual(choose([previous], now), previous);
  assert.equal(matchupHeading(previous, Date.parse(now)), 'Latest matchup');
  assert.equal(choose([], now), undefined);
});

test('fallbacks use timestamps across seasons rather than resetting period numbers', () => {
  const lastSeason = row(8, 'final', '2025-12-01T00:00:00-05:00', '2025-12-08T00:00:00-05:00');
  assert.strictEqual(choose([first, lastSeason], '2027-01-01T00:00:00Z'), first);
  const future = row(1, 'scheduled', '2027-11-07T00:00:00-04:00', '2027-11-14T00:00:00-05:00');
  assert.strictEqual(choose([first, second, third, future], future.startsAt), future);
});

test('Toronto repeated fall hour and skipped spring hour compare absolute instants', () => {
  for (const at of ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00'])
    assert.strictEqual(choose([first, second], at), second);
  const spring = row(9, 'scheduled', '2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00');
  for (const at of ['2027-03-14T01:59:59-05:00', '2027-03-14T03:00:00-04:00'])
    assert.strictEqual(choose([spring], at), spring);
  assert.equal(matchupHeading(spring, Date.parse(spring.endsAt)), 'Latest matchup');
});

test('selection preserves history and filters other teams without mutating inputs', () => {
  const rows = Object.freeze([
    Object.freeze({ ...first, status: 'final' }),
    Object.freeze(second),
    Object.freeze({ ...third, homeTeamId: 'stranger', awayTeamId: 'someone' }),
  ]);
  assert.strictEqual(choose(rows, '2026-11-03T12:00:00Z'), second);
  assert.strictEqual(
    rows.find((matchup) => matchup.id === first.id),
    rows[0],
  );
  assert.equal(selectMyMatchup(rows, null), undefined);
  assert.equal(selectMyMatchup(rows, 'missing'), undefined);
});

test('malformed or partial calendar records cannot override a valid current matchup', () => {
  const invalid = [
    { ...first, startsAt: 'invalid' },
    { ...first, endsAt: undefined },
    { ...first, startsAt: first.endsAt },
    { ...first, startsAt: second.endsAt },
  ];
  assert.strictEqual(choose([...invalid, second], second.startsAt), second);
  assert.equal(choose(invalid, second.startsAt), undefined);
});

test('boundary wakeup crosses period ends and seasonal breaks without database changes', () => {
  assert.equal(
    nextMatchupBoundary([first, second], Date.parse(first.startsAt)),
    Date.parse(first.endsAt),
  );
  assert.equal(
    nextMatchupBoundary([first, second], Date.parse(first.endsAt)),
    Date.parse(second.endsAt),
  );
  assert.equal(nextMatchupBoundary([first], Date.parse(first.endsAt)), Infinity);
});
