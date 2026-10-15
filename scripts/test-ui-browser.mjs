/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { rosterPlan } from './lib/roster-materialization.mjs';
import { buildManifest as buildCurrentManifest } from './import-brock-beta-data.mjs';
import { rosterMetricsPlan } from './lib/roster-metrics.mjs';
import { BETA_SLOTS } from '../packages/domain/src/beta.ts';

// Controlled browser fixtures never sign in, mutate, or query the hosted project.
const roster = rosterPlan(await buildManifest(), '11111111-1111-4111-8111-111111111111');
const heights = JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8'));
const portraits = JSON.parse(await readFile('data/brock-headshots-2026-27.json', 'utf8'));
const userId = '11111111-1111-4111-8111-111111111111';
const leagueId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const teamId = '44444444-4444-4444-8444-444444444444';
const otherTeam = '55555555-5555-4555-8555-555555555555';
// - Use an approved snapshot when roster source files are being edited
const metrics = process.env.BROCK_UI_METRIC_PLAN
  ? JSON.parse(await readFile(process.env.BROCK_UI_METRIC_PLAN, 'utf8'))
  : rosterMetricsPlan(
      await buildCurrentManifest(),
      await buildManifest(),
      heights,
      userId,
      JSON.parse(await readFile('dev/docs/evidence/2026-10-14-roster-suppressions.json', 'utf8')),
    );
const metricById = new Map(metrics.players.map((item) => [item.id, item]));
const players = roster.players
  .filter((player) => metricById.has(player.id))
  .map((player, index) => ({
    id: player.id,
    competition_id: 'c',
    team_id: 't',
    display_name: player.name,
    position: player.positions[0],
    jersey_number: player.jersey,
    status: 'active',
    bio: {
      ...player.bio,
      height: metricById.get(player.id).height,
      headshot: portraits.headshots.find((h) => h.id === player.id)?.headshot,
    },
    positions: player.positions,
    program: player.program.replaceAll('_', ' '),
    rank: index + 1,
    adp: {
      average: metricById.get(player.id).suppliedAdp,
      base: metricById.get(player.id).suppliedAdp,
      samples: 0,
    },
    summaries: [
      {
        season_label: '2026-27',
        kind: 'supplied_projection',
        fantasy_points: metricById.get(player.id).projectedPoints,
        games_played: metricById.get(player.id).projectedGames,
        supplied_adp: metricById.get(player.id).suppliedAdp,
        stats: {},
      },
      {
        season_label: '2025-26',
        kind: 'historical',
        fantasy_points: metricById.get(player.id).historicalPoints,
        games_played: metricById.get(player.id).historicalGames,
        stats: metricById.get(player.id).historicalStats,
      },
    ],
  }));
const benchPlayer = players.find(
  (player) => player.bio.program === 'mens_basketball' && player.position === 'BC',
);
const observedPlayer = players.find((player) => player.adp.base !== null);
const slotLabels = {
  HK_F: 'Hockey forward',
  HK_DG: 'Hockey defence / goalie',
  BB_BC: 'Basketball back court',
  BB_FC: 'Basketball front court',
  VB_HT: 'Volleyball hitter',
  VB_LS: 'Volleyball libero / setter',
  FLEX: 'FLEX',
  BN: 'Bench',
};
const slotRules = Object.entries(BETA_SLOTS).map(([code, positions]) => ({
  slot_code: code,
  label: slotLabels[code],
  allowed_positions: positions,
  slot_count: code === 'BN' ? 3 : 1,
  is_starter: code !== 'BN',
}));
const fullRosterPlayers = [];
for (const slot of slotRules.filter((item) => item.is_starter)) {
  const player = players.find(
    (athlete) =>
      !fullRosterPlayers.some((item) => item.athlete_id === athlete.id) &&
      athlete.positions.some((position) => slot.allowed_positions.includes(position)),
  );
  fullRosterPlayers.push({
    athlete_id: player.id,
    display_name: player.display_name,
    positions: player.positions,
    slot_code: slot.slot_code,
    status: 'starter',
    locked: slot.slot_code === 'BB_BC',
    locks_at: null,
    unlocks_at: null,
  });
}
for (const position of ['HT', 'BC', 'F']) {
  const player = players.find(
    (athlete) =>
      !fullRosterPlayers.some((item) => item.athlete_id === athlete.id) &&
      athlete.positions.includes(position),
  );
  fullRosterPlayers.push({
    athlete_id: player.id,
    display_name: player.display_name,
    positions: player.positions,
    slot_code: 'BN',
    status: 'bench',
    locked: false,
    locks_at: null,
    unlocks_at: null,
  });
}
const league = {
  id: leagueId,
  competition_id: null,
  pool_id: 'b0000000-0000-4000-8000-000000000003',
  commissioner_id: userId,
  ruleset_id: 'b0000000-0000-4000-8000-000000000004',
  name: 'Badgers Club',
  format: 'head_to_head',
  status: 'drafting',
  max_members: 4,
  invite_code: 'BADGERS',
  state_version: 1,
};
const teams = [
  { id: teamId, league_id: leagueId, owner_id: userId, name: 'Your Badgers', draft_position: 1 },
  { id: otherTeam, league_id: leagueId, owner_id: null, name: 'Campus Crew', draft_position: 2 },
];
const output = path.resolve('dev/tmp/ui-refresh');
await mkdir(output, { recursive: true });
await Promise.all(
  (await readdir(output))
    .filter((file) => file.endsWith('.png'))
    .map((file) => unlink(path.join(output, file))),
);
const staticRoot = path.resolve('apps/client/dist/client');
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://local').pathname;
    const file = path.resolve(staticRoot, '.' + decodeURIComponent(pathname));
    if (
      file.startsWith(staticRoot + path.sep) &&
      /\.(js|css|ttf|woff2|png|jpg|svg|mp3)$/u.test(file)
    ) {
      const body = await readFile(file);
      const types = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.ttf': 'font/ttf',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg',
      };
      response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
      response.end(body);
      return;
    }
    await handler(request, response);
  } catch {
    response.statusCode = 500;
    response.end('Local preview failed.');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
const accessibility = [];
let lastPage;
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'bf_theme', value: theme, url: origin },
      { name: 'bf_csrf', value: 'test-csrf', url: origin },
    ]);
    let scenario = 'populated';
    let complete = false;
    let commissioner = true;
    let connected = true;
    let expired = false;
    let pendingPick = false;
    let queue = [];
    let picks = [];
    let fullLineupEntries = fullRosterPlayers.map((entry) => ({ ...entry }));
    let pendingSchedule = true;
    const scheduleReviewFixture = () => ({
      games: pendingSchedule
        ? [
            {
              id: 'g',
              program: 'Brock Hockey',
              home: 'Brock',
              away: 'Guelph',
              starts_at: new Date(Date.now() + 3600_000).toISOString(),
              status: 'scheduled',
              schedule_confirmed: false,
              schedule_override: false,
              schedule_revision: 1,
              source_url: 'https://gobadgers.ca/',
              schedule_change: {},
            },
          ]
        : [],
      sources: [
        {
          id: 'source',
          program: 'mens_hockey',
          last_synced_at: new Date().toISOString(),
          last_error: null,
        },
      ],
      alerts: [
        {
          id: 'missing-projection',
          display_name: 'Projection fixture',
          message: 'Missing projected games',
        },
      ],
    });
    let savedLineup = null;
    const snapshot = () => ({
      revision: 'revision-' + picks.length + '-' + queue.join(','),
      poolRevision: 'pool-1',
      serverTime: new Date().toISOString(),
      unchanged: false,
      closed: complete,
      draft: {
        id: draftId,
        league_id: leagueId,
        status: complete ? 'complete' : 'active',
        rounds: 10,
        current_overall_pick: picks.length + 1,
        pick_deadline: new Date(Date.now() + (expired ? -10000 : 900000)).toISOString(),
        state_version: picks.length + 1,
        team_order: [teamId, otherTeam],
      },
      league: { id: leagueId, name: league.name, pool_id: 'b0000000-0000-4000-8000-000000000003' },
      teams,
      picks,
      roster: picks.map((p) => ({
        fantasy_team_id: p.fantasy_team_id,
        athlete_id: p.athlete_id,
        slot_code: 'FLEX',
        status: 'active',
      })),
      queue,
      myTeamId: teamId,
      slots: teams.map((t) => ({
        teamId: t.id,
        code: 'FLEX',
        label: 'Flex',
        positions: ['F', 'D', 'G', 'FC', 'BC', 'HT', 'S', 'L'],
      })),
      candidates: players.map((p) => ({ id: p.id, positions: p.positions })),
      players,
      legalAthleteIds: players
        .filter((p) => !picks.some((pick) => pick.athlete_id === p.id))
        .map((p) => p.id),
    });
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const reply = (body, status = 200, headers = {}) =>
        route.fulfill({
          status,
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: {
            id: userId,
            email: 'manager@example.test',
            emailConfirmedAt: new Date().toISOString(),
          },
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/admin/status')
        return reply({
          isAdmin: scenario.startsWith('admin-'),
          hasAdminRole: scenario.startsWith('admin-'),
          aal: 'aal2',
          authenticated: true,
        });
      if (url.pathname === '/api/auth/csrf') return reply({});
      if (url.pathname === '/api/admin/games') {
        const game = {
          id: 'admin-game',
          starts_at: new Date(Date.now() + 3600_000).toISOString(),
          status: 'scheduled',
          home_score: 0,
          away_score: 0,
          state_version: 1,
          stats_complete: false,
          manual_override: false,
          home: { name: 'Brock' },
          away: { name: 'Toronto' },
          program: 'mens_hockey',
        };
        return url.searchParams.has('gameId')
          ? reply({
              game,
              sport: 'hockey',
              stats: [],
              athletes: [
                { id: players[0].id, display_name: players[0].display_name, position: 'F' },
              ],
            })
          : reply({ games: [game] });
      }
      if (url.pathname.startsWith('/api/draft/')) {
        if (!connected) return reply({ error: 'Connection unavailable. Reconnecting…' }, 503);
        return reply(snapshot());
      }
      if (url.pathname.startsWith('/api/command/')) {
        const payload = route.request().postDataJSON();
        if (url.pathname.endsWith('rename_my_fantasy_team')) {
          teams[0].name = payload.p_name;
          return reply({ team_id: teamId, name: payload.p_name });
        }
        if (url.pathname.endsWith('set_draft_queue')) {
          queue = payload.p_athlete_ids;
          return reply({ queue });
        }
        if (url.pathname.endsWith('set_period_lineup')) {
          savedLineup = payload.p_entries;
          const assignments = new Map(savedLineup.map((item) => [item.athlete_id, item.slot_code]));
          fullLineupEntries = fullLineupEntries.map((entry) => ({
            ...entry,
            slot_code: assignments.get(entry.athlete_id),
          }));
          return reply({ state_version: 2 });
        }
        if (url.pathname.endsWith('get_schedule_review')) return reply(scheduleReviewFixture());
        if (url.pathname.endsWith('review_game_schedule')) {
          pendingSchedule = false;
          return reply({ revision: 2 });
        }
        if (url.pathname.endsWith('make_draft_pick')) {
          pendingPick = true;
          await new Promise((resolve) => setTimeout(resolve, 350));
          picks.push({
            id: 'pick-1',
            draft_id: draftId,
            fantasy_team_id: teamId,
            athlete_id: payload.p_athlete_id,
            overall_pick: 1,
            round: 1,
            pick_in_round: 1,
            source: 'manager',
            created_at: new Date().toISOString(),
          });
          pendingPick = false;
          return reply({ pick_id: 'pick-1' });
        }
        return reply({});
      }
      if (url.pathname === '/api/data/supabase') {
        const dataPath = new URL(url.searchParams.get('path'), origin);
        const table = dataPath.pathname.split('/').at(-1);
        if (table === 'get_league_standings')
          return reply(
            teams.map((team, index) => ({
              rank: index + 1,
              fantasy_team_id: team.id,
              wins: 3 - index,
              losses: index,
              ties: 1,
              points_for: 123.5 + index,
              points_against: 100,
              standing_points: 7 - index * 2,
            })),
          );
        if (scenario === 'loading' && table === 'athletes')
          await new Promise((resolve) => setTimeout(resolve, 1100));
        if (scenario === 'error' && table === 'athletes')
          return reply({ message: 'Fixture failure' }, 503);
        if (dataPath.searchParams.get('select')?.includes('supplied_adp'))
          return reply({ message: 'Missing supplied_adp column' }, 400);
        if (table === 'athletes') {
          if (scenario === 'empty') return reply([]);
          const id = dataPath.searchParams.get('id')?.replace('eq.', '');
          return reply(id ? players.find((p) => p.id === id) : players);
        }
        if (table === 'get_player_insights') {
          const payload = JSON.parse(route.request().postData() ?? '{}');
          return reply(
            players
              .filter((player) => !payload.p_athlete_id || player.id === payload.p_athlete_id)
              .map((player, index) => ({
                id: player.id,
                displayName: player.display_name,
                jerseyNumber: player.jersey_number,
                bio: player.bio,
                positions: player.positions,
                position: player.position,
                program: player.bio.program,
                team: 'Brock',
                teamId: 't',
                competitionId: 'c',
                seasonPoints: 7,
                seasonProjection:
                  player.summaries.find((item) => item.kind === 'supplied_projection')
                    ?.fantasy_points ?? null,
                nextProjection: index === 2 ? null : 100 - index,
                projectedGames: 20,
                scheduledGames: 2,
                period: {
                  number: 2,
                  startsAt: '2026-11-01T04:00:00Z',
                  endsAt: '2026-11-14T05:00:00Z',
                },
                pending: index === 0,
                adp: player.adp.average,
                nextGame: {
                  id: 'g',
                  starts_at: new Date(Date.now() + 3600_000).toISOString(),
                  status: 'scheduled',
                  schedule_confirmed: false,
                  opponent: 'Guelph',
                  home: true,
                },
              })),
          );
        }
        if (table === 'get_pool_adp')
          return scenario === 'adp-error'
            ? reply({ message: 'New ADP RPC not installed' }, 404)
            : reply(
                Object.fromEntries(
                  players.map((player) => [
                    player.id,
                    scenario === 'adp-adjusted' && player.id === observedPlayer.id
                      ? { ...player.adp, average: (player.adp.base + 10) / 2, samples: 1 }
                      : player.adp,
                  ]),
                ),
              );
        if (table === 'get_beta_lineup' && scenario === 'full-lineup')
          return reply({
            period: { number: 1, ends_at: new Date(Date.now() + 86400_000).toISOString() },
            state_version: 1,
            entries: fullLineupEntries,
          });
        if (table === 'get_beta_lineup')
          return reply({
            period: { number: 1, ends_at: new Date(Date.now() + 86400_000).toISOString() },
            state_version: 1,
            entries: [
              {
                athlete_id: players[0].id,
                display_name: players[0].display_name,
                positions: ['HT'],
                slot_code: 'VB_HT',
                status: 'starter',
                locked: false,
                locks_at: null,
                unlocks_at: null,
              },
              {
                athlete_id: benchPlayer.id,
                display_name: benchPlayer.display_name,
                positions: ['BC'],
                slot_code: 'BN',
                status: 'bench',
                locked: true,
                locks_at: null,
                unlocks_at: null,
              },
            ],
          });
        if (table === 'get_draft_results')
          return reply({
            league: { id: leagueId, name: league.name },
            picks: [
              {
                id: 'fixture-result',
                athlete_id: players[0].id,
                display_name: players[0].display_name,
                bio: players[0].bio,
                program: players[0].program,
                overall_pick: 1,
                round: 1,
                pick_in_round: 1,
                source: 'manager',
                team_name: teams[0].name,
              },
            ],
          });
        if (table === 'competitions')
          return reply([
            {
              id: 'c',
              division: 'womens',
              name: "Brock Women's Volleyball",
              season_label: '2026-27',
              is_active: true,
              ruleset_id: league.ruleset_id,
              sports: { code: 'volleyball' },
            },
          ]);
        if (table === 'games' && dataPath.searchParams.get('select')?.includes('home:teams'))
          return reply([
            {
              id: 'fixture-game-a',
              starts_at: new Date(Date.now() - 86400_000).toISOString(),
              status: 'final',
              home_team_id: 't',
              schedule_confirmed: true,
              home: { name: 'Brock' },
              away: { name: 'Guelph' },
            },
            {
              id: 'fixture-game-b',
              starts_at: new Date(Date.now() - 43200_000).toISOString(),
              status: 'final',
              home_team_id: 't',
              schedule_confirmed: true,
              home: { name: 'Brock' },
              away: { name: 'Toronto' },
            },
            {
              id: 'g',
              starts_at: new Date(Date.now() + 3600_000).toISOString(),
              status: 'scheduled',
              home_team_id: 't',
              schedule_confirmed: false,
              home: { name: 'Brock' },
              away: { name: 'Guelph' },
            },
          ]);
        if (table === 'games')
          return reply([
            {
              id: 'g',
              competition_id: 'c',
              starts_at: new Date(Date.now() + 3600_000).toISOString(),
              status: 'scheduled',
            },
          ]);
        if (table === 'scoring_rulesets')
          return reply({
            draft_config: { pickSeconds: 120 },
            transaction_config: {
              freeAgentsEnabled: true,
              waiversEnabled: true,
              tradesEnabled: true,
            },
          });
        if (table === 'roster_slot_rules') return reply(slotRules);
        if (
          table === 'roster_entries' &&
          dataPath.searchParams.get('select')?.includes('competition:competitions(')
        )
          return reply({ code: 'PGRST201', message: 'Ambiguous competition relationship' }, 300);
        if (table === 'normalized_player_game_stats')
          return reply([
            {
              game_id: 'fixture-game-a',
              stats: {},
              fantasy_points: 2,
              complete: true,
              missing_stats: [],
              updated_at: new Date().toISOString(),
              game: {
                id: 'fixture-game-a',
                starts_at: new Date(Date.now() - 86400_000).toISOString(),
                status: 'final',
              },
            },
            {
              game_id: 'fixture-game-b',
              stats: {},
              fantasy_points: 5,
              complete: true,
              missing_stats: [],
              updated_at: new Date().toISOString(),
              game: {
                id: 'fixture-game-b',
                starts_at: new Date(Date.now() - 172800_000).toISOString(),
                status: 'final',
              },
            },
          ]);
        if (table === 'fantasy_point_events')
          return reply([
            {
              game_id: 'fixture-game-a',
              points: 3,
              stat_key: 'goals',
              created_at: new Date().toISOString(),
            },
            {
              game_id: 'fixture-game-a',
              points: -1,
              stat_key: 'penalty_minutes',
              created_at: new Date().toISOString(),
            },
            {
              game_id: 'fixture-game-b',
              points: 5,
              stat_key: 'assists',
              created_at: new Date().toISOString(),
            },
          ]);
        if (table === 'pool_rankings') return reply(players.map((player) => ({ athlete: player })));
        if (
          table === 'roster_entries' &&
          dataPath.searchParams.get('fantasy_team_id') === 'eq.' + otherTeam
        )
          return reply([
            {
              id: 'opponent-entry',
              fantasy_team_id: otherTeam,
              athlete_id: players[3].id,
              slot_code: 'FLEX',
              status: 'starter',
              athlete: { ...players[3], competition: { name: 'Brock Volleyball' } },
            },
            {
              id: 'opponent-bench',
              fantasy_team_id: otherTeam,
              athlete_id: benchPlayer.id,
              slot_code: 'BN',
              status: 'bench',
              athlete: { ...benchPlayer, competition: { name: 'Brock Basketball' } },
            },
          ]);
        if (table === 'roster_entries')
          return reply([
            {
              id: 'roster-entry',
              fantasy_team_id: teamId,
              athlete_id: players[0].id,
              slot_code: 'VB_HT',
              status: 'starter',
              athlete: { ...players[0], competition: { name: "Brock Women's Volleyball" } },
            },
            {
              id: 'bench-entry',
              fantasy_team_id: teamId,
              athlete_id: benchPlayer.id,
              slot_code: 'BN',
              status: 'bench',
              athlete: { ...benchPlayer, competition: { name: "Brock Men's Basketball" } },
            },
          ]);
        if (table === 'leagues') {
          const row = { ...league, commissioner_id: commissioner ? userId : otherTeam };
          return reply(dataPath.searchParams.has('id') ? row : [row]);
        }
        if (table === 'drafts')
          return reply([
            { id: draftId, league_id: leagueId, status: complete ? 'complete' : 'active' },
          ]);
        if (table === 'fantasy_teams') return reply(teams);
        if (table === 'athlete_seasons')
          return reply([{ competition_id: 'c', team_id: 't', positions: ['HT'] }]);
        if (table === 'athlete_season_summaries')
          return reply(
            players.find((p) => dataPath.searchParams.get('athlete_id')?.endsWith(p.id))
              ?.summaries ?? [],
          );
        if (table === 'weekly_projections') return reply(null);
        return reply([], 200, { 'content-range': '0-0/0' });
      }
      // Auth forms and their real server rendering are tested without browser API fixtures.
      return route.continue();
    });
    const page = await context.newPage();
    lastPage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await page.goto(origin + '/players', { waitUntil: 'domcontentloaded' });
      await page.getByText(players[0].display_name, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.brockTheme), theme);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Overflow: players ${theme} ${width}`,
      );
      const playerRows = page
        .getByRole('link')
        .filter({ has: page.getByText('Projected FP', { exact: true }) });
      const byName = (a, b) => a.display_name.localeCompare(b.display_name, 'en-CA');
      for (const option of [
        {
          label: 'ADP',
          expected: [...players].sort(
            (a, b) => (a.adp.average ?? Infinity) - (b.adp.average ?? Infinity) || byName(a, b),
          )[0],
        },
        {
          label: 'Projected FP',
          expected: [...players].sort(
            (a, b) =>
              (b.summaries[0].fantasy_points ?? -Infinity) -
                (a.summaries[0].fantasy_points ?? -Infinity) || byName(a, b),
          )[0],
        },
        { label: 'Name', expected: [...players].sort(byName)[0] },
      ]) {
        await page.getByRole('button', { name: `Sort by ${option.label}`, exact: true }).click();
        await playerRows.first().getByText(option.expected.display_name, { exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole('button', { name: `Sort by ${option.label}`, exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
      }
      assert.ok(
        await playerRows
          .first()
          .evaluate(
            (element) => parseFloat(window.getComputedStyle(element).borderBottomWidth) > 0,
          ),
        'Player rows have separators between entries',
      );
      assert.equal(
        await playerRows
          .last()
          .evaluate((element) => parseFloat(window.getComputedStyle(element).borderBottomWidth)),
        0,
        'Last player row has no trailing separator',
      );
      await page
        .getByRole('textbox', { name: 'Search players', exact: true })
        .fill(players[0].display_name);
      await page.getByText('1 shown', { exact: true }).waitFor();
      assert.equal(
        await playerRows
          .first()
          .evaluate((element) => parseFloat(window.getComputedStyle(element).borderBottomWidth)),
        0,
        'A filtered single player has no separator',
      );
      await page.getByRole('textbox', { name: 'Search players', exact: true }).fill('');
      await page.screenshot({ path: path.join(output, `players-${theme}-${width}.png`) });
      if (width === 390 || width === 1440) {
        const themeToggle = page.getByRole('button', {
          name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
        });
        await themeToggle.focus();
        await page.keyboard.press('Tab');
        assert.ok(
          await page.evaluate(() => document.activeElement !== document.body),
          'Keyboard focus remains on an interactive control',
        );
        const analysis = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        accessibility.push({
          theme,
          width,
          violations: analysis.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        });
      }
      results.push(`players ${theme} ${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/dashboard');
    await page.getByText('Badgers Club', { exact: true }).waitFor();
    await page.getByText(/Next game ·/).waitFor();
    await page.screenshot({ path: path.join(output, `dashboard-${theme}.png`) });
    const withHeight = players.find((p) => p.bio.height);
    await page.goto(origin + '/players/' + withHeight.id);
    await page.getByText('Height ·', { exact: false }).waitFor();
    await page
      .getByText(
        withHeight.adp.base === null ? 'No recorded picks yet' : 'Supplied starting value',
        { exact: true },
      )
      .waitFor();
    await page.getByText('2.0 pts', { exact: true }).waitFor();
    const historyRow = (label) =>
      page.getByText(label, { exact: true }).locator('..').locator('..');
    assert.ok(
      await historyRow('2026-27 · supplied projection').evaluate(
        (element) => parseFloat(window.getComputedStyle(element).borderBottomWidth) > 0,
      ),
      'Historical records retain internal separators',
    );
    assert.equal(
      await historyRow('2025-26 · historical').evaluate((element) =>
        parseFloat(window.getComputedStyle(element).borderBottomWidth),
      ),
      0,
      'Last history record has no trailing separator',
    );
    await page.getByText('2026-27', { exact: true }).click();
    assert.equal(
      await historyRow('2026-27 · supplied projection').evaluate((element) =>
        parseFloat(window.getComputedStyle(element).borderBottomWidth),
      ),
      0,
      'Filtered history omits its final separator',
    );
    const forecast = await page
      .getByText(
        'Supplied season points ÷ projected games × scheduled games in the next fantasy period',
        { exact: true },
      )
      .locator('..')
      .boundingBox();
    const back = await page
      .getByRole('link', { name: 'Back to players', exact: true })
      .boundingBox();
    assert.ok(
      back.y - forecast.y - forecast.height >= 16,
      'Forecast and return button have vertical spacing',
    );
    await page.screenshot({ path: path.join(output, `player-detail-${theme}.png`) });
    const seeded = players.find((player) => player.adp.base !== null);
    await page.goto(origin + '/players/' + seeded.id);
    await page.getByText('Supplied starting value', { exact: true }).waitFor();
    assert.equal(
      await page.getByText(seeded.adp.base.toFixed(1), { exact: true }).count(),
      1,
      'Supplied ADP displays on the player profile',
    );
    scenario = 'adp-adjusted';
    await page.goto(origin + '/players/' + observedPlayer.id);
    await page.getByText(`Supplied ADP: ${observedPlayer.adp.base}`, { exact: true }).waitFor();
    await page
      .getByText(((observedPlayer.adp.base + 10) / 2).toFixed(1), { exact: true })
      .waitFor();
    await page
      .getByText('1 recorded pick across leagues · includes supplied starting value', {
        exact: true,
      })
      .waitFor();
    scenario = 'populated';
    for (const state of ['loading', 'empty', 'error']) {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        scenario = state;
        await page.goto(origin + '/players');
        await page
          .getByText(
            state === 'loading'
              ? 'Loading the current Brock rosters…'
              : state === 'empty'
                ? 'No player records yet'
                : 'Unable to load the player list. Try again.',
            { exact: true },
          )
          .waitFor();
        await page.screenshot({
          path: path.join(output, `players-${theme}-${state}-${width}.png`),
        });
      }
    }
    scenario = 'populated';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/draft/' + draftId);
    await page.getByText('Available players', { exact: true }).waitFor();
    await page.getByRole('button', { name: '+ Queue', exact: true }).first().click();
    await page.waitForFunction(() => document.body.textContent.includes('Remove from queue'));
    assert.equal(queue.length, 1);
    await page
      .getByRole('link', { name: 'View ' + players[0].display_name + ' player details' })
      .click();
    await page.getByRole('button', { name: 'Close player details' }).waitFor();
    await page.screenshot({ path: path.join(output, `draft-details-${theme}.png`) });
    await page.getByRole('button', { name: 'Close player details' }).click();
    await page.screenshot({ path: path.join(output, `draft-${theme}-1440.png`) });
    await page.getByRole('button', { name: 'Draft', exact: true }).first().click();
    assert.equal(pendingPick, true);
    assert.equal(await page.getByText(/Your pick is confirmed/).count(), 0);
    await page.getByText(/Your pick is confirmed/).waitFor();
    assert.equal(picks.length, 1);
    connected = false;
    await page
      .getByText('RECONNECTING · PICKS DISABLED', { exact: true })
      .waitFor({ timeout: 20000 });
    assert.equal(
      await page.getByRole('button', { name: 'Wait', exact: true }).first().isDisabled(),
      true,
    );
    await page.screenshot({ path: path.join(output, `draft-${theme}-reconnecting.png`) });
    connected = true;
    expired = true;
    picks = [];
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await page.getByText('Your pick timed out. Awaiting autopick…', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Draft', exact: true }).first().isDisabled(),
      true,
    );
    expired = false;
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin + '/draft/' + draftId);
      await page.getByText('Available players', { exact: true }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Overflow: draft ${theme} ${width}`,
      );
      await page.screenshot({ path: path.join(output, `draft-${theme}-${width}.png`) });
    }
    complete = true;
    await page.goto(origin + '/draft/' + draftId);
    await page.waitForURL('**/draft-results/' + draftId);
    await page.getByText('All draft picks', { exact: true }).waitFor();
    assert.equal(await page.getByText('Available players', { exact: true }).count(), 0);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      commissioner = true;
      await page.goto(origin + '/league/' + leagueId);
      await page
        .getByText('You can view draft results in the Settings tab.', { exact: true })
        .waitFor();
      assert.equal(await page.getByText('League controls', { exact: true }).count(), 0);
      assert.equal(
        await page.getByRole('link', { name: 'View draft results', exact: true }).count(),
        0,
      );
      await page.getByRole('tab', { name: 'settings', exact: true }).click();
      await page.getByText('Commissioner settings', { exact: true }).waitFor();
      const transactionLink = page.getByRole('link', {
        name: 'Free agents, waivers & trades',
        exact: true,
      });
      const transactionBounds = await transactionLink.boundingBox();
      assert.ok(
        transactionBounds.x >= 0 && transactionBounds.x + transactionBounds.width <= width,
        'Manager controls stay inside the phone width',
      );
      assert.ok(
        await transactionLink.evaluate((element) => element.scrollWidth <= element.clientWidth),
        'Manager button text fits its control',
      );
      assert.equal(
        await page.getByRole('link', { name: 'Open draft room', exact: true }).count(),
        0,
      );
      await page.getByRole('link', { name: 'View draft results', exact: true }).first().waitFor();
      await page.getByRole('textbox', { name: 'Your team name', exact: true }).fill('New Badgers');
      if (teams[0].name !== 'New Badgers') {
        await page.getByRole('button', { name: 'Save team name', exact: true }).click();
        await page.getByText('Team name saved.', { exact: true }).waitFor();
        assert.equal(teams[0].name, 'New Badgers');
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Overflow: settings ${theme} ${width}`,
      );
      await page.screenshot({ path: path.join(output, `league-settings-${theme}-${width}.png`) });
      await page.getByRole('tab', { name: 'roster', exact: true }).click();
      await page.getByRole('heading', { name: 'Volleyball hitter', exact: true }).waitFor();
      await page.getByText('Player position: Hitter / middle blocker', { exact: true }).waitFor();
      await page.getByText('🪑 Bench · 1/3', { exact: true }).waitFor();
      assert.equal(
        await page
          .getByText('Empty spot · add an eligible athlete or update your lineup', { exact: true })
          .count(),
        6,
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'Beginner roster fits the viewport',
      );
      await page
        .getByRole('link', { name: 'Roster rules & eligible positions', exact: true })
        .click();
      await page
        .getByText('Seven starters + three bench = ten athletes', { exact: true })
        .waitFor();
      assert.ok(
        page.url().includes('section=roster'),
        'Roster help opens the matching rules topic',
      );
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      await page.getByRole('tab', { name: 'roster', exact: true }).click();
      await page.screenshot({ path: path.join(output, `league-roster-${theme}-${width}.png`) });
      commissioner = false;
      await page.goto(origin + '/league/' + leagueId);
      await page.getByRole('tab', { name: 'settings', exact: true }).click();
      await page.getByText('Manager settings', { exact: true }).waitFor();
      assert.equal(await page.getByText('Commissioner settings', { exact: true }).count(), 0);
      assert.equal(
        await page.getByRole('button', { name: 'Delete league', exact: true }).count(),
        0,
      );
      await page.goto(origin + '/notifications');
      await page.getByText('No notifications', { exact: true }).waitFor();
      const filters = await page
        .getByRole('button', { name: 'All updates', exact: true })
        .boundingBox();
      const empty = await page.getByText('No notifications', { exact: true }).boundingBox();
      assert.ok(
        empty.y > filters.y + filters.height + 20,
        'Notification filters have space below them',
      );
      await page.screenshot({ path: path.join(output, `notifications-${theme}-${width}.png`) });
      if (width === 1440) {
        const privacy = await page.getByText('Privacy', { exact: true }).boundingBox();
        const instagram = await page
          .getByRole('link', { name: /Brock Fantasy Association on Instagram/ })
          .boundingBox();
        assert.ok(
          Math.abs(privacy.y + privacy.height / 2 - (instagram.y + instagram.height / 2)) < 3,
          'Footer links align',
        );
      }
    }
    scenario = 'adp-error';
    await page.goto(origin + '/players');
    await page.getByText(players[0].display_name, { exact: true }).waitFor();
    await page
      .getByText('Average draft positions are temporarily unavailable.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('Unable to load the player list. Try again.', { exact: true }).count(),
      0,
    );
    scenario = 'populated';
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
      await page.goto(origin + '/lineup-beta/' + leagueId);
      await page
        .getByRole('button', { name: `Insights for ${players[0].display_name}`, exact: true })
        .waitFor();
      assert.ok(
        await page
          .getByRole('button', { name: `Move ${benchPlayer.display_name}`, exact: true })
          .isDisabled(),
        'Locked reserves cannot be moved',
      );
      assert.ok(
        await page.getByRole('button', { name: 'Save lineup', exact: true }).isDisabled(),
        'Incomplete roster cannot save',
      );
      await page
        .getByRole('button', { name: `Move ${players[0].display_name}`, exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Move selected athlete to Bench', exact: true })
        .click();
      await page
        .getByText('Assignment updated. Save lineup to confirm.', { exact: true })
        .waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Lineup labels fit ${theme} ${width}`,
      );
      await page.screenshot({ path: path.join(output, `lineup-beginner-${theme}-${width}.png`) });
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(origin + '/rules');
      await page.getByText('How to play Brock Fantasy', { exact: true }).waitFor();
      const rulesTitle = await page
        .getByText('1. Join or create a league', { exact: true })
        .evaluate((element) => ({
          family: window.getComputedStyle(element).fontFamily,
          size: parseFloat(window.getComputedStyle(element).fontSize),
        }));
      assert.ok(
        rulesTitle.family.includes('Inter') && rulesTitle.size >= 18,
        'Rules article headings use readable app typography',
      );
      for (const topic of [
        'Getting started',
        'Roster & positions',
        'Draft',
        'Lineup & locks',
        'Scoring',
        'Waivers & trades',
        'Stats & ADP',
      ]) {
        await page.getByRole('tab', { name: topic, exact: true }).click();
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `Rules topic fits: ${topic} ${theme} ${width}`,
        );
        assert.equal(
          await page.getByRole('tab', { name: topic, exact: true }).getAttribute('aria-selected'),
          'true',
        );
      }
      await page.getByRole('tab', { name: 'Roster & positions', exact: true }).click();
      assert.equal(
        await page.getByText(/^\d spots? · (Starter|Reserve)$/).count(),
        8,
        'Rules show seven starter slots and three bench spaces',
      );
      const rosterRulesText = await page.locator('body').innerText();
      assert.equal(
        /\b(?:HK_F|HK_DG|BB_BC|BB_FC|VB_HT|VB_LS|BN)\b/u.test(rosterRulesText),
        false,
        'Rules hide internal roster codes',
      );
      await page.getByRole('heading', { name: 'Hockey forward', exact: true }).waitFor();
      assert.ok(
        rosterRulesText.includes('🏒') &&
          rosterRulesText.includes('🏀') &&
          rosterRulesText.includes('🏐'),
        'Roster spots have sport icons',
      );
      await page.screenshot({ path: path.join(output, `rules-roster-${theme}-${width}.png`) });
      await page.getByRole('tab', { name: 'Scoring', exact: true }).click();
      await page.getByText('Hockey goalies', { exact: true }).waitFor();
      await page.getByText('+20 points', { exact: true }).waitFor();
      await page.getByText('-1 point', { exact: true }).first().waitFor();
      const scoringTitleFont = await page
        .getByText('Hockey goalies', { exact: true })
        .evaluate((element) => window.getComputedStyle(element).fontFamily);
      assert.ok(
        scoringTitleFont.includes('Inter'),
        'Scoring headings use the same font as the article',
      );
      await page.screenshot({ path: path.join(output, `rules-scoring-${theme}-${width}.png`) });
      const rulesAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      assert.equal(rulesAxe.violations.length, 0, `Rules accessibility: ${theme} ${width}`);
      accessibility.push({ page: 'rules', theme, width, violations: rulesAxe.violations });
    }
    scenario = 'full-lineup';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/lineup-beta/' + leagueId);
    await page.getByText('Starting lineup', { exact: true }).waitFor();
    await page.getByText('Bench', { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(output, `lineup-full-${theme}.png`) });
    const reserve = fullRosterPlayers.find(
      (entry) => entry.slot_code === 'BN' && entry.positions.includes('HT'),
    );
    const oldStarter = fullRosterPlayers.find((entry) => entry.slot_code === 'VB_HT');
    const dragSource = page
      .getByRole('button', { name: `Insights for ${reserve.display_name}`, exact: true })
      .locator('xpath=ancestor::div[@draggable="true"][1]');
    await dragSource.scrollIntoViewIfNeeded();
    const sourceBox = await dragSource.boundingBox();
    assert.ok(sourceBox);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    // - Begin native dragging before scrolling to an offscreen destination
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 15,
      sourceBox.y + sourceBox.height / 2 + 15,
      { steps: 5 },
    );
    const dragTarget = page.getByRole('button', {
      name: `Insights for ${oldStarter.display_name}`,
      exact: true,
    });
    await dragTarget.scrollIntoViewIfNeeded();
    const targetBox = await dragTarget.boundingBox();
    assert.ok(targetBox);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 10,
    });
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2 + 2,
    );
    await page.mouse.up();
    await page.getByText('UNSAVED CHANGES', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reload saved lineup', exact: true }).click();
    await page.getByText('SAVED LINEUP', { exact: true }).waitFor();
    await page.getByRole('button', { name: `Move ${reserve.display_name}`, exact: true }).click();
    await page
      .getByRole('button', { name: 'Move selected athlete to Hitter', exact: true })
      .click();
    await page
      .getByText(
        `${reserve.display_name} and ${oldStarter.display_name} swapped. Save lineup to confirm.`,
        { exact: true },
      )
      .waitFor();
    const reserveGuard = fullRosterPlayers.find(
      (entry) => entry.slot_code === 'BN' && entry.positions.includes('BC'),
    );
    await page
      .getByRole('button', { name: `Move ${reserveGuard.display_name}`, exact: true })
      .click();
    await page.getByRole('button', { name: 'Move selected athlete to Guard', exact: true }).click();
    await page
      .getByText('Choose two unlocked athletes eligible for each other’s positions.', {
        exact: true,
      })
      .waitFor();
    await page
      .getByRole('button', { name: `Insights for ${reserve.display_name}`, exact: true })
      .click();
    await page.getByRole('button', { name: 'Close athlete insights', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Full player profile →', exact: true }).click();
    await page.waitForURL('**/players/' + reserve.athlete_id);
    await page.goBack();
    await page.getByText('UNSAVED CHANGES', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
    await page.getByText(/Lineup saved/).waitFor();
    assert.equal(
      savedLineup.find((entry) => entry.athlete_id === reserve.athlete_id).slot_code,
      'VB_HT',
    );
    assert.equal(
      savedLineup.find((entry) => entry.athlete_id === oldStarter.athlete_id).slot_code,
      'BN',
    );
    assert.equal(savedLineup.filter((entry) => entry.slot_code === 'BN').length, 3);
    assert.equal(
      savedLineup.find((entry) => entry.athlete_id === reserveGuard.athlete_id).slot_code,
      'BN',
      'Locked starter blocks the attempted swap',
    );
    results.push(
      `lineup ${theme}: desktop drag, full-bench swap, explicit save, locks and draft recovery`,
    );
    scenario = 'populated';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/transactions/' + leagueId);
    await page.getByRole('textbox', { name: 'Search available athletes', exact: true }).waitFor();
    const freePlayer = players.find(
      (player) => player.id !== players[0].id && player.id !== benchPlayer.id,
    );
    await page
      .getByRole('textbox', { name: 'Search available athletes', exact: true })
      .fill(freePlayer.display_name);
    const insightButton = page.getByRole('button', {
      name: `Insights for ${freePlayer.display_name}`,
      exact: true,
    });
    await insightButton.waitFor();
    await insightButton.click();
    await page.getByRole('button', { name: 'Full player profile →', exact: true }).waitFor();
    assert.ok(
      (await page.getByText('⚠ Pending confirmation', { exact: true }).count()) > 0,
      'Upcoming game clearly flags pending confirmation',
    );
    const panelAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    accessibility.push({
      page: 'insights-panel',
      theme,
      width: 390,
      violations: panelAxe.violations,
    });
    await page.screenshot({ path: path.join(output, `free-agent-insights-${theme}.png`) });
    await page.getByRole('button', { name: 'Close athlete insights', exact: true }).click();
    assert.equal(
      await page
        .getByRole('textbox', { name: 'Search available athletes', exact: true })
        .inputValue(),
      freePlayer.display_name,
      'Closing insights preserves filters',
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Free agency fits phones',
    );
    await page.screenshot({ path: path.join(output, `free-agency-${theme}.png`) });
    await page.goto(origin + '/league/' + leagueId + '?tab=standings');
    await page.getByRole('link', { name: 'Campus Crew', exact: true }).click();
    await page.waitForURL('**/league/' + leagueId + '/teams/' + otherTeam);
    await page.getByText('Campus Crew', { exact: true }).last().waitFor();
    await page
      .getByRole('button', { name: `Insights for ${players[3].display_name}`, exact: true })
      .waitFor();
    await page.getByText('124.5', { exact: true }).filter({ visible: true }).waitFor();
    await page.getByText('2–1–1', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: `Insights for ${benchPlayer.display_name}`, exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole('link', { name: 'Set lineup', exact: true }).count(),
      0,
      'Other team rosters are read-only',
    );
    await page.screenshot({ path: path.join(output, `opponent-roster-${theme}.png`) });
    await page.getByRole('link', { name: 'Back to league standings', exact: true }).click();
    await page.getByText('League standings', { exact: true }).filter({ visible: true }).waitFor();
    scenario = 'admin-games';
    await page.goto(origin + '/admin/games');
    const date = page.getByLabel('Filter game date', { exact: true });
    await date.waitFor();
    assert.ok((await date.boundingBox()).height >= 44, 'Date filter has a full touch target');
    await page.getByRole('button', { name: /Brock vs Toronto/ }).click();
    const addPlayer = page.getByRole('switch', {
      name: `Include ${players[0].display_name}`,
      exact: true,
    });
    await addPlayer.waitFor();
    assert.ok((await addPlayer.boundingBox()).height >= 44, 'Add player has a padded touch target');
    await page.screenshot({ path: path.join(output, `admin-games-${theme}.png`), fullPage: true });
    const adminAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    assert.equal(adminAxe.violations.length, 0, `Scorekeeper accessibility: ${theme}`);
    scenario = 'admin-schedule';
    await page.goto(origin + '/admin/schedules');
    await page.getByText('Projection fixture: Missing projected games', { exact: true }).waitFor();
    await page.getByText('⚠ Pending confirmation', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `admin-schedule-${theme}.png`) });
    await page
      .getByRole('textbox', { name: 'Review reason for g', exact: true })
      .fill('Confirmed against the official Brock schedule');
    await page.getByRole('button', { name: 'Confirm current schedule', exact: true }).click();
    await page
      .getByText('All schedules are confirmed and no overrides are pinned', { exact: true })
      .waitFor();
    await context.close();
    results.push(
      `settings/results/roster/notifications ${theme}: commissioner visibility, rename, completed-room redirect, ADP rollout tolerance`,
    );
    results.push(`draft ${theme}: queue, details, acknowledged pick, expired clock, reconnect`);
    results.push(
      `rules/roster ${theme}: every topic, contextual links, starter/bench labels, 320/390/1440px`,
    );
  }
  // Real server forms: theme readback, local fonts, responsive layout and CSP.
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([{ name: 'bf_theme', value: theme, url: origin }]);
    const page = await context.newPage();
    for (const route of ['/auth', '/forgot-password']) {
      await page.goto(origin + route);
      await page.locator('h1').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.brockTheme), theme);
      await page.screenshot({ path: path.join(output, `${route.slice(1)}-${theme}-390.png`) });
    }
    await page.goto(origin + '/rules?section=roster');
    await page.getByText('Seven starters + three bench = ten athletes', { exact: true }).waitFor();
    assert.ok(page.url().includes('/rules'), 'Rules are readable without signing in');
    await page.screenshot({ path: path.join(output, `rules-public-${theme}-390.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/auth');
    await page.screenshot({ path: path.join(output, `auth-${theme}-1440.png`) });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const bundles = await readdir('apps/client/dist/client/_expo/static/js/web');
  const sizes = await Promise.all(
    bundles
      .filter((file) => file.endsWith('.js'))
      .map(
        async (file) =>
          (await stat(path.join('apps/client/dist/client/_expo/static/js/web', file))).size,
      ),
  );
  const report = {
    results,
    errors,
    baselineJavaScriptBytes: 2240100,
    currentJavaScriptBytes: sizes.reduce((a, b) => a + b, 0),
    screenshots: (await readdir(output)).filter((file) => file.endsWith('.png')).length,
    hostedJourneys: false,
    accessibility,
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.ok(
    accessibility.every((entry) => entry.violations.length === 0),
    JSON.stringify(accessibility),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(error.stack);
  console.log(
    JSON.stringify({
      errors,
      url: lastPage?.url(),
      body:
        lastPage && !lastPage.isClosed() ? await lastPage.locator('body').innerText() : undefined,
    }),
  );
  if (lastPage && !lastPage.isClosed())
    await lastPage.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
