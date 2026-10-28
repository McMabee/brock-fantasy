import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncOfficialSchedules } from './schedule-worker.mjs';

const sources = ['mens', 'womens'].flatMap((division) =>
  ['ice-hockey', 'basketball', 'volleyball'].map((sport) => ({
    id: `${division}-${sport}`,
    program: `${division}_${sport === 'ice-hockey' ? 'hockey' : sport}`,
    competition_id: `${division}-${sport}-competition`,
    team_id: 'brock',
    url: `https://gobadgers.ca/sports/${division}-${sport}/schedule/2026-27?grid=true`,
  })),
);
const html =
  '<table><caption>2026-27 Schedule</caption><tr class="sidearm-schedule-game"><td>November 19, 2026</td><td>7 p.m.</td><td>Home</td><td>Guelph</td><td>Brock</td><td></td><td></td><td></td><td></td><td></td></tr></table>';

test('schedule worker durably records mixed outcomes and always finishes the invocation', async () => {
  const calls = [];
  const result = await syncOfficialSchedules({
    rest: async (path, body) => {
      calls.push({ path, body });
      if (path.startsWith('official_schedule_sources')) return sources;
      if (path.startsWith('games?')) return [];
      if (path === 'rpc/apply_official_schedule') return { changed: body.p_error ? 0 : 2 };
      return true;
    },
    fetcher: async (url) =>
      url === sources[0].url
        ? new Response('Unavailable', { status: 503 })
        : new Response(html, { headers: { 'content-type': 'text/html' } }),
    log: () => {},
  });
  assert.equal(result.failures, 1);
  const outcomes = calls.filter((call) => call.path === 'rpc/record_schedule_sync');
  assert.equal(outcomes.length, 6);
  assert.equal(outcomes.filter((call) => call.body.p_status === 'succeeded').length, 5);
  assert.equal(outcomes[0].body.p_error_code, 'SOURCE_FETCH_FAILED');
  assert.ok(outcomes.every((call) => call.body.p_run_id === result.runId));
  assert.equal(calls[0].path, 'rpc/begin_schedule_sync');
  assert.equal(calls.at(-1).path, 'rpc/finish_schedule_sync');
});
test('invalid source inventory still finalizes a failed schedule invocation', async () => {
  const calls = [];
  await assert.rejects(
    syncOfficialSchedules({
      rest: async (path) => {
        calls.push(path);
        return path.startsWith('official_schedule_sources') ? sources.slice(0, 5) : true;
      },
      fetcher: () => {
        throw new Error('Unexpected fetch');
      },
      log: () => {},
    }),
    /six-program/u,
  );
  assert.equal(calls.at(-1), 'rpc/finish_schedule_sync');
});
