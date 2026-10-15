import test from 'node:test';
import assert from 'node:assert/strict';
import { planOfficialSchedule } from './official-schedule-sync.mjs';

const source = {
  program: 'mens_hockey',
  competition_id: 'competition',
  team_id: 'brock',
  url: 'https://gobadgers.ca/sports/mens-ice-hockey/schedule/2026-27?grid=true',
};
const row = (date, time = '7 p.m.', opponent = 'Guelph', tournament = '', result = '') =>
  `<tr class="sidearm-schedule-game"><td>${date}</td><td>${time}</td><td>Home</td><td>${opponent}</td><td>Brock</td><td></td><td></td><td>${tournament}</td><td>${result}</td><td></td></tr>`;
const page = (...rows) =>
  `<table><caption>2026-27 Men's Hockey Schedule</caption>${rows.join('')}</table>`;
const game = (id, starts_at) => ({
  id,
  starts_at,
  home_team_id: 'brock',
  away_team_id: 'guelph',
  home: 'Brock',
  away: 'Guelph',
  status: 'scheduled',
  official_schedule_key: `fixture:${id}`,
});

test('time and date changes preserve game identity with exact anchors resolved first', () => {
  const known = [game('first', '2026-10-17T23:00:00Z'), game('second', '2026-11-20T00:00:00Z')];
  const plan = planOfficialSchedule(
    page(row('October 18, 2026'), row('November 19, 2026')),
    source,
    known,
  );
  assert.equal(plan.games[0].id, 'first');
  assert.equal(plan.games[0].key, 'fixture:first');
  assert.equal(plan.games[1].id, 'second');
  assert.deepEqual(plan.issues, []);
});
test('ambiguous reschedules cannot silently merge different games', () => {
  assert.throws(
    () =>
      planOfficialSchedule(page(row('October 18, 2026')), source, [
        game('first', '2026-10-17T23:00:00Z'),
        game('second', '2026-11-20T00:00:00Z'),
      ]),
    /Ambiguous reschedule/u,
  );
});
test('exhibitions are excluded while confirmed playoff fixtures are included', () => {
  const plan = planOfficialSchedule(
    page(
      row('September 17, 2026', '7 p.m.', 'Guelph', 'Exhibition'),
      row('February 21, 2027', '7 p.m.', 'Guelph', 'OUA semifinal'),
      row('February 24, 2027', '7 p.m.', 'TBD', 'OUA final'),
    ),
    source,
    [],
  );
  assert.equal(plan.games.length, 1);
  assert.equal(plan.games[0].kind, 'playoff');
  assert.equal(plan.issues.length, 1);
});
test('postponement without a replacement time uses the known fixture and unlocks it', () => {
  const plan = planOfficialSchedule(page(row('October 17, 2026', 'Postponed')), source, [
    game('first', '2026-10-17T23:00:00Z'),
  ]);
  assert.equal(plan.games[0].status, 'postponed');
  assert.equal(plan.games[0].id, 'first');
  assert.deepEqual(plan.issues, []);
});
test('stable new identities and Toronto daylight saving conversions are repeatable', () => {
  const html = page(row('October 17, 2026'), row('November 19, 2026'));
  const plan = planOfficialSchedule(html, source, []);
  assert.deepEqual(plan, planOfficialSchedule(html, source, []));
  assert.equal(plan.games[0].startsAt, '2026-10-17T23:00:00.000Z');
  assert.equal(plan.games[1].startsAt, '2026-11-20T00:00:00.000Z');
});
test('missing fixtures are flagged instead of inventing cancellations', () => {
  const plan = planOfficialSchedule(page(row('November 19, 2026')), source, [
    game('first', '2026-10-17T23:00:00Z'),
    game('second', '2026-11-20T00:00:00Z'),
  ]);
  assert.equal(plan.games.length, 1);
  assert.equal(plan.games[0].id, 'second');
  assert.ok(plan.issues.some((issue) => issue.includes('first')));
});
