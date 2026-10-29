/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Use synthetic API fixtures so UI verification needs no private CSVs or hosted account
const userId = '11111111-1111-4111-8111-111111111111';
const leagueId = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';
const poolId = 'b0000000-0000-4000-8000-000000000003';
const programNames = {
  mens_hockey: "Men's Hockey",
  womens_hockey: "Women's Hockey",
  mens_basketball: "Men's Basketball",
  womens_basketball: "Women's Basketball",
  mens_volleyball: "Men's Volleyball",
  womens_volleyball: "Women's Volleyball",
};
const fixture = [
  ['Alpha Forward', 'mens_hockey', 'F'],
  ['Bravo Goalie', 'womens_hockey', 'G'],
  ['Charlie Guard', 'mens_basketball', 'BC'],
  ['Delta Centre', 'womens_basketball', 'FC'],
  ['Echo Hitter', 'mens_volleyball', 'HT'],
  ['Foxtrot Setter', 'mens_volleyball', 'S'],
  ['Golf Forward', 'mens_hockey', 'F'],
  ['Hotel Guard', 'mens_basketball', 'BC'],
  ['India Libero', 'mens_volleyball', 'L'],
  ['Juliet Defence', 'womens_hockey', 'D'],
  ['Zulu Free Guard', 'womens_basketball', 'BC'],
  ['Able Free Hitter', 'mens_volleyball', 'HT'],
  ['Own Program Libero', 'womens_volleyball', 'L'],
  ['Missing Projection', 'mens_hockey', 'F'],
];
const players = fixture.map(([displayName, program, position], index) => ({
  id: `athlete-${index}`,
  displayName,
  program: programNames[program],
  position,
  positions: [position],
  team: 'Brock Badgers',
  teamId: program,
  competitionId: program,
  jerseyNumber: String(index + 1),
  bio: { program, headshot: { url: 'https://gobadgers.ca/images/fixture.png' }, height: '180 cm' },
  seasonPoints: index + 7,
  seasonStats: { assists: 4, digs: 12 },
  seasonProjection: 200 - index,
  nextProjection: index === 13 ? null : index === 10 ? 999 : 100 - index,
  projectedGames: 20,
  scheduledGames: 2,
  period: { number: 1, startsAt: '2026-10-24T04:00:00Z', endsAt: '2026-11-01T04:00:00Z' },
  pending: false,
  adp: 30 - index,
  nextGame: null,
}));
const row = (player) => ({
  id: player.id,
  display_name: player.displayName,
  position: player.position,
  bio: player.bio,
  competition: { name: player.program },
  team: { name: player.team },
});
const codes = ['HK_F', 'HK_DG', 'BB_BC', 'BB_FC', 'VB_HT', 'VB_LS', 'FLEX', 'BN', 'BN', 'BN'];
const rules = Object.entries({
  HK_F: ['F', 'D', 'G'],
  HK_DG: ['F', 'D', 'G'],
  BB_BC: ['BC', 'FC'],
  BB_FC: ['BC', 'FC'],
  VB_HT: ['HT', 'L', 'S'],
  VB_LS: ['HT', 'L', 'S'],
  FLEX: ['F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S'],
  BN: ['F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S'],
}).map(([slot_code, allowed_positions]) => ({
  slot_code,
  allowed_positions,
  label: slot_code.startsWith('HK')
    ? 'Hockey - any position'
    : slot_code.startsWith('BB')
      ? 'Basketball - any position'
      : 'Any eligible position',
  slot_count: slot_code === 'BN' ? 3 : 1,
  is_starter: slot_code !== 'BN',
}));
const root = path.resolve('apps/client/dist/client');
const output = path.resolve('dev/tmp/varsity-browser');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + name);
    const types = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
    };
    const mime = types[path.extname(file)];
    if (file.startsWith(root + path.sep) && mime) {
      res.writeHead(200, { 'content-type': mime });
      res.end(await readFile(file));
      return;
    }
    await handler(req, res);
  } catch {
    res.writeHead(500);
    res.end('Local fixture server failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = {
  hostedJourneys: false,
  checks: [],
  screenshots: [],
  errors: [],
  accessibility: [],
};
const cardBounds = (locator) =>
  locator.evaluate((element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (parseFloat(style.paddingLeft) >= 18 && parseFloat(style.borderTopWidth) > 0) {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }
    }
    throw new Error('Expected a padded card');
  });
const assertNoOverflow = async (page) => {
  await page.waitForTimeout(250);
  const overflow = await page.locator('[data-bf-page]').evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    left: element.getBoundingClientRect().left,
  }));
  if (overflow.scrollWidth > overflow.width + 1 || overflow.left < 0)
    console.error(
      await page.locator('[data-bf-page]').evaluate((element) =>
        [...element.querySelectorAll('*')]
          .filter(
            (node) =>
              node.getBoundingClientRect().right > element.getBoundingClientRect().right + 1,
          )
          .slice(0, 12)
          .map((node) => ({
            tag: node.tagName,
            text: node.textContent.slice(0, 100),
            width: node.getBoundingClientRect().width,
            minWidth: getComputedStyle(node).minWidth,
          })),
      ),
    );
  assert.ok(
    overflow.scrollWidth <= overflow.width + 1 && overflow.left >= 0,
    `Page content fits the viewport: ${JSON.stringify(overflow)}`,
  );
};
let lastPage;
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'no-preference',
    });
    await context.addCookies([
      { name: 'bf_theme', value: theme, url: origin },
      { name: 'bf_consent', value: 'v1.preferences', url: origin },
      { name: 'bf_csrf', value: 'fixture-csrf', url: origin },
    ]);
    let participant = {
      id: userId,
      display_name: 'Varsity Manager',
      email: 'fixture@example.test',
      role: 'coach',
      programs: ['womens_volleyball'],
      revision: 1,
    };
    const roster = players.slice(0, 10).map((player, index) => ({
      id: `entry-${index}`,
      fantasy_team_id: teamId,
      athlete_id: player.id,
      slot_code: codes[index],
      status: codes[index] === 'BN' ? 'bench' : 'starter',
      athlete: row(player),
    }));
    const commands = [];
    let adminRole = true;
    let adminVerified = true;
    let roleUnavailable = false;
    let gameMode = 'populated';
    let scheduled = false;
    let preDraft = false;
    let pickSeconds = null;
    let leagueVersion = 1;
    let lineupVersion = 1;
    let lineupSaveMode = 'success';
    const lineupReceipts = new Map();
    const inbox = [
      {
        id: 'historical-inbox',
        kind: 'trade_proposed',
        title: 'Old trade notification',
        body: 'Historical event',
        data: { league_id: leagueId },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    await context.route('https://gobadgers.ca/images/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (process.env.BROCK_BROWSER_DEBUG) console.log(url.pathname, url.searchParams.get('path'));
      const reply = (body) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: JSON.stringify(body),
        });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: { id: userId, email: participant.email },
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/auth/csrf') return reply({});
      if (url.pathname === '/api/admin/status')
        return roleUnavailable
          ? route.fulfill({ status: 503, body: '{}' })
          : reply({
              authenticated: true,
              hasAdminRole: adminRole,
              isAdmin: adminRole && adminVerified,
              aal: adminVerified ? 'aal2' : 'aal1',
            });
      if (url.pathname.startsWith('/api/command/')) {
        const payload = route.request().postDataJSON();
        const name = url.pathname.split('/').at(-1);
        commands.push({ name, payload });
        if (name === 'set_league_pick_duration') {
          pickSeconds = payload.p_pick_seconds;
          leagueVersion++;
          return reply({
            league_id: leagueId,
            pick_seconds: pickSeconds,
            state_version: leagueVersion,
          });
        }
        if (name === 'get_schedule_review')
          return reply({
            sources: [
              { id: 'source', program: 'mens_hockey', last_synced_at: null, last_error: null },
            ],
            alerts: [],
            games: [
              {
                id: 'review-game',
                program: 'mens_hockey',
                home: 'Brock',
                away: 'Fixture opponents',
                starts_at: '2026-11-01T23:00:00Z',
                status: 'scheduled',
                schedule_kind: 'regular',
                neutral_site: false,
                home_is_brock: true,
                schedule_confirmed: false,
                schedule_override: false,
                schedule_revision: 1,
                source_url: null,
                schedule_change: {},
              },
            ],
          });
        if (name === 'stage_historical_game_logs')
          return reply({
            batch_id: 'history-batch',
            input_hash: 'history-hash',
            rows: [
              {
                athlete_id: 'athlete-10',
                athlete_name: 'Zulu Free Guard',
                identity_evidence: { historical_player_id: 'archive-player' },
                opponent: 'Archive opponents',
                played_at: '2025-11-01T23:00:00Z',
                complete: false,
                missing_stats: ['power_play_goals'],
                fantasy_points: null,
                source_url:
                  'https://gobadgers.ca/sports/mens-ice-hockey/stats/2025-26/fixture/boxscore/1',
              },
            ],
          });
        if (name === 'confirm_matchup_schedule') scheduled = true;
        if (name === 'join_league') return reply({ league_id: leagueId });
        if (name === 'admin_set_participation')
          participant = {
            ...participant,
            role: payload.p_role,
            programs: payload.p_programs,
            revision: participant.revision + 1,
          };
        if (name === 'set_period_lineup') {
          if (lineupReceipts.has(payload.p_idempotency_key))
            return reply(lineupReceipts.get(payload.p_idempotency_key));
          if (lineupSaveMode === 'conflict' || lineupSaveMode === 'roster-conflict') {
            if (lineupSaveMode === 'roster-conflict') {
              const flex = roster.find((entry) => entry.slot_code === 'FLEX');
              const reserve = roster.filter((entry) => entry.slot_code === 'BN')[1];
              [flex.slot_code, reserve.slot_code] = [reserve.slot_code, flex.slot_code];
              for (const entry of roster)
                entry.status = entry.slot_code === 'BN' ? 'bench' : 'starter';
            }
            lineupVersion++;
            lineupSaveMode = 'success';
            return route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Lineup changed; reload and retry', code: 'PT409' }),
            });
          }
          for (const value of payload.p_entries) {
            const entry = roster.find((item) => item.athlete_id === value.athlete_id);
            entry.slot_code = value.slot_code;
            entry.status = value.slot_code === 'BN' ? 'bench' : 'starter';
          }
          lineupVersion++;
          const receipt = { state_version: lineupVersion };
          lineupReceipts.set(payload.p_idempotency_key, receipt);
          if (lineupSaveMode === 'uncertain') {
            lineupSaveMode = 'success';
            return route.abort('failed');
          }
          return reply(receipt);
        }
        if (name === 'add_free_agent') {
          const target = roster.findIndex((entry) => entry.athlete_id === payload.p_athlete_out_id);
          const athlete = players.find((player) => player.id === payload.p_athlete_in_id);
          if (target >= 0 && athlete)
            roster[target] = { ...roster[target], athlete_id: athlete.id, athlete: row(athlete) };
        }
        return reply(
          name === 'propose_trade'
            ? { trade_id: `fixture-trade-${commands.length}` }
            : { revision: participant.revision },
        );
      }
      if (url.pathname === '/api/data/supabase') {
        const data = new URL(url.searchParams.get('path'), origin);
        const table = data.pathname.split('/').at(-1);
        if (table === 'competitions')
          return reply(
            Object.keys(programNames).map((program) => ({
              id: program,
              division: program.split('_')[0],
              name: programNames[program],
              season_label: '2026-27',
              is_active: true,
              ruleset_id: 'fixture',
              sports: { code: program.split('_')[1] },
            })),
          );
        if (table === 'get_upcoming_program_games') {
          if (gameMode === 'error')
            return route.fulfill({
              status: 503,
              body: JSON.stringify({ message: 'Fixture unavailable' }),
              contentType: 'application/json',
            });
          return reply(
            Object.keys(programNames).map((program) => ({
              competition_id: program,
              live:
                gameMode === 'populated' && program === 'womens_hockey'
                  ? {
                      id: 'live',
                      starts_at: '2026-11-01T05:30:00Z',
                      status: 'in_progress',
                      schedule_confirmed: true,
                      opponent: 'Live Opponents',
                      home: true,
                      neutral: false,
                    }
                  : null,
              next:
                gameMode !== 'empty' && program !== 'mens_hockey'
                  ? {
                      id: 'next-' + program,
                      starts_at: '2026-11-01T06:30:00Z',
                      status: 'scheduled',
                      schedule_confirmed: program !== 'womens_hockey',
                      opponent: 'Next Opponents',
                      home: program !== 'womens_hockey',
                      neutral: program === 'mens_volleyball',
                    }
                  : null,
            })),
          );
        }
        if (table === 'admin_get_ranking_seasons')
          return reply({ currentSeason: '2026-27', seasons: ['2026-27', '2025-26'] });
        if (table === 'admin_get_ranking_review')
          return reply({
            season: '2026-27',
            poolId,
            canPublish: true,
            preview: route.request().postDataJSON()?.p_preview === true,
            input_hash: 'ranking-hash',
            publication: { version: 1, published_at: '2026-10-19T12:00:00Z' },
            rows: [
              {
                athlete_id: 'athlete-10',
                name: 'Zulu Free Guard',
                position_group: 'BB_BC',
                position_rank: 1,
                projected_points: 190,
                display_data: {
                  position: 'BC',
                  program: 'womens_basketball',
                  division: 'womens',
                  season_label: '2026-27',
                  games_played: 20,
                  stats: { assists: 12 },
                },
              },
            ],
          });
        if (table === 'get_published_preseason_ranking_seasons')
          return reply({ currentSeason: '2026-27', seasons: ['2026-27', '2025-26'] });
        if (table === 'get_my_participation')
          return reply({
            role: participant.role,
            programs: participant.programs,
            revision: participant.revision,
            displayName: participant.display_name,
          });
        if (table === 'admin_find_participants') return reply([participant]);
        if (table === 'admin_get_participant') return reply(participant);
        if (table === 'admin_list_varsity_participants') return reply([participant]);
        if (table === 'admin_get_participant_scan')
          return reply({
            enabled: false,
            activeReferenceVersionId: null,
            history: [],
            run: null,
            newRegistrations: 0,
            matches: [],
          });
        if (table === 'preview_preseason_rankings')
          return reply({
            input_hash: 'ranking-hash',
            rows: [
              {
                athlete_id: 'athlete-10',
                name: 'Zulu Free Guard',
                position_group: 'BB_BC',
                position_rank: 1,
                projected_points: 190,
              },
            ],
          });
        if (table === 'get_player_insights') return reply(players);
        if (table === 'get_pool_adp')
          return reply(
            Object.fromEntries(
              players.map((player) => [player.id, { average: player.adp, base: null, samples: 1 }]),
            ),
          );
        if (table === 'athlete_season_summaries')
          return reply([
            {
              season_label: '2026-27',
              kind: 'supplied_projection',
              fantasy_points: 200,
              games_played: 20,
              stats: {},
            },
            {
              season_label: '2025-26',
              kind: 'historical',
              fantasy_points: 39,
              games_played: 8,
              stats: {},
            },
          ]);
        if (table === 'get_notification_snapshot')
          return reply({
            notifications: inbox,
            unreadCount: inbox.filter((row) => !row.read_at).length,
          });
        if (table === 'notifications') return reply(inbox);
        if (table === 'get_player_forecast')
          return reply({
            projectedSeasonPoints: 200,
            projectedGames: 20,
            knownSchedule: true,
            periods: [
              {
                id: 'forecast-period',
                number: 1,
                startsAt: '2026-10-24T04:00:00Z',
                endsAt: '2026-11-01T04:00:00Z',
              },
            ],
            games: [
              {
                id: 'forecast-game',
                startsAt: '2026-10-25T23:00:00Z',
                status: 'scheduled',
                opponent: 'Fixture opponents',
                pending: false,
                complete: false,
                actualPoints: null,
              },
            ],
          });
        if (table === 'get_player_trade_options')
          return reply([
            {
              league_id: leagueId,
              league_name: 'Varsity League',
              proposing_team_id: teamId,
              receiving_team_id: 'opponent-team',
              receiving_team_name: 'Other Badgers',
              athlete_name: 'Zulu Free Guard',
              offered: [{ id: 'athlete-7', name: 'Hotel Guard' }],
            },
          ]);
        if (table === 'get_published_preseason_rankings')
          return reply({
            season: route.request().postDataJSON()?.p_season || '2026-27',
            publication: { version: 1, published_at: '2026-10-19T12:00:00Z' },
            rows: [
              {
                athlete_id: 'athlete-10',
                name: 'Zulu Free Guard',
                display_data: {
                  position: 'BC',
                  program: 'womens_basketball',
                  division: 'womens',
                  season_label: '2026-27',
                  games_played: 20,
                  stats: { assists: 12 },
                },
                position: 'BC',
                program: 'womens_basketball',
                position_group: 'BB_BC',
                projected_points: 190,
                position_rank: 1,
              },
              {
                athlete_id: 'athlete-13',
                name: 'Missing Projection',
                display_data: {
                  position: 'F',
                  program: 'mens_hockey',
                  division: 'mens',
                  season_label: '2026-27',
                  stats: {},
                },
                position: 'F',
                program: 'mens_hockey',
                position_group: 'HK_F',
                projected_points: null,
                position_rank: null,
              },
            ],
          });
        if (table === 'get_historical_game_logs')
          return reply([
            {
              source_game_id: '1',
              played_at: '2025-11-01T23:00:00Z',
              opponent: 'Archive opponents',
              phase: 'regular',
              result: 'W, 3-1',
              stats: { goals: 1, assists: 0 },
              complete: false,
              fantasy_points: null,
              missing_stats: ['power_play_goals'],
              source_url:
                'https://gobadgers.ca/sports/mens-ice-hockey/stats/2025-26/fixture/boxscore/1',
              scoring_version: 'brock-2026.2',
            },
          ]);
        if (table === 'athletes')
          return reply(
            data.searchParams.has('id')
              ? { ...row(players[10]), jersey_number: '11', status: 'active' }
              : players.map((player) => ({
                  ...row(player),
                  jersey_number: player.jerseyNumber,
                  summaries: [],
                })),
          );
        if (table === 'get_matchup_preview')
          return reply({
            signature: 'fixture-schedule-signature',
            shortened: true,
            can_generate: true,
            periods: [
              { number: 1, starts_at: '2026-10-24T04:00:00Z', ends_at: '2026-11-01T04:00:00Z' },
            ],
            pairings: [{ period: 1, home_team_id: teamId, away_team_id: 'opponent-team' }],
          });
        if (table === 'matchups')
          return reply(
            scheduled
              ? [
                  {
                    id: '44444444-4444-4444-8444-444444444444',
                    league_id: leagueId,
                    period: 1,
                    home_team_id: teamId,
                    away_team_id: 'opponent-team',
                    home_points: 12,
                    away_points: 9,
                    status: 'scheduled',
                    starts_at: '2026-10-24T04:00:00Z',
                    ends_at: '2026-11-01T04:00:00Z',
                  },
                ]
              : [],
          );
        if (table === 'get_matchup_detail')
          return reply({
            teams: [
              {
                id: teamId,
                name: 'Varsity Badgers',
                contributors: [
                  { athlete_id: 'athlete-8', name: 'Former Contributor', points: 12, games: 1 },
                ],
                roster: [
                  {
                    athlete_id: 'athlete-10',
                    name: 'Current Starter',
                    slot: 'FLEX',
                    status: 'starter',
                  },
                ],
              },
              {
                id: 'opponent-team',
                name: 'Other Badgers',
                contributors: [
                  { athlete_id: 'athlete-9', name: 'Other Contributor', points: 9, games: 1 },
                ],
                roster: [],
              },
            ],
          });
        if (table === 'leagues' && data.searchParams.has('invite_code')) return reply(null);
        if (table === 'leagues') {
          const league = {
            id: leagueId,
            competition_id: null,
            pool_id: poolId,
            commissioner_id: userId,
            ruleset_id: 'fixture-rules',
            name: 'Varsity League',
            format: 'head_to_head',
            status: preDraft ? 'setup' : 'active',
            max_members: 8,
            invite_code: 'FIXTURE',
            state_version: leagueVersion,
            draft_pick_seconds: pickSeconds,
            roster_format: 'varsity',
          };
          if (data.searchParams.has('id')) return reply(league);
          const membershipOnly =
            data.searchParams.get('select')?.includes('league_members!inner(user_id)') &&
            data.searchParams.get('league_members.user_id') === `eq.${userId}`;
          return reply(
            membershipOnly
              ? [league]
              : [
                  league,
                  {
                    ...league,
                    id: 'oversight-league',
                    name: 'Oversight only league',
                  },
                ],
          );
        }
        if (table === 'fantasy_teams')
          return reply([
            {
              id: 'opponent-team',
              league_id: leagueId,
              owner_id: 'other-owner',
              name: 'Other Badgers',
              draft_position: 2,
              owner: { display_name: 'Other Manager', is_varsity: false },
            },
            {
              id: teamId,
              league_id: leagueId,
              owner_id: userId,
              name: 'Varsity Badgers',
              draft_position: 1,
              owner: {
                display_name: participant.display_name,
                is_varsity: participant.role !== 'none',
              },
            },
          ]);
        if (table === 'drafts') {
          if (preDraft) return reply(null);
          const draft = { id: 'fixture-draft', status: 'complete', league_id: leagueId };
          return reply(data.searchParams.get('league_id')?.startsWith('in.') ? [draft] : draft);
        }
        if (table === 'roster_entries') return reply(roster);
        if (table === 'pool_rankings')
          return reply(players.map((player) => ({ athlete: row(player) })));
        if (table === 'scoring_rulesets')
          return reply({
            draft_config: { pickSeconds: 120 },
            transaction_config: {
              freeAgentsEnabled: true,
              waiversEnabled: true,
              tradesEnabled: false,
            },
          });
        if (table === 'roster_slot_rules') return reply(rules);
        if (table === 'get_beta_lineup')
          return reply({
            period: { number: 1, ends_at: '2099-11-01T04:00:00Z' },
            state_version: lineupVersion,
            entries: roster.map((entry) => ({
              athlete_id: entry.athlete_id,
              display_name: entry.athlete.display_name,
              positions: players.find((player) => player.id === entry.athlete_id).positions,
              slot_code: entry.slot_code,
              status: entry.status,
              locked: false,
              locks_at: null,
              participation_conflict: false,
            })),
          });
        return reply([]);
      }
      return reply({});
    });
    const page = await context.newPage();
    lastPage = page;
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(origin + '/dashboard');
    await page.getByText('Varsity League', { exact: true }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const upcoming = page.getByRole('table', { name: 'Upcoming Brock games', exact: true });
      await upcoming.waitFor();
      await upcoming.getByText('LIVE · vs. Live Opponents', { exact: true }).waitFor();
      await upcoming.getByText('@ Next Opponents', { exact: true }).waitFor();
      const text = await upcoming.innerText();
      assert.ok(['🏒', '🏀', '🏐'].every((icon) => text.includes(icon)));
      if (width === 1440) {
        await expect
          .poll(
            async () => {
              const tableBox = await upcoming.boundingBox();
              const regionBox = await page
                .getByRole('region', { name: 'Upcoming Brock games', exact: true })
                .boundingBox();
              return Math.abs(tableBox.x + tableBox.width / 2 - regionBox.x - regionBox.width / 2);
            },
            {
              message: 'The fixture table is horizontally centered after responsive layout settles',
            },
          )
          .toBeLessThan(2);
      }
      assert.ok(
        text.includes('EDT') && text.includes('EST'),
        'Toronto formatting handles both sides of the daylight-saving change',
      );
      assert.ok(!text.includes('2026'), 'Fixture dates omit the year');
      assert.ok(text.includes('Neutral site') && text.includes('No upcoming game scheduled'));
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `upcoming-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    gameMode = 'empty';
    await page.reload();
    await page.getByRole('table', { name: 'Upcoming Brock games', exact: true }).waitFor();
    await expect(page.getByText('No upcoming game scheduled', { exact: true })).toHaveCount(6);
    gameMode = 'error';
    await page.reload();
    await page.getByText('Upcoming games could not load.', { exact: true }).waitFor();
    gameMode = 'populated';
    await page.reload();
    await page.getByRole('table', { name: 'Upcoming Brock games', exact: true }).waitFor();
    assert.equal(
      await page.getByText('Oversight only league', { exact: true }).count(),
      0,
      'An MFA administrator sees only actual memberships in Your leagues',
    );
    const signature = page.getByRole('link', {
      name: 'Built by Ty, visit developer website, opens in a new tab',
      exact: true,
    });
    await page.goto(origin + '/notifications');
    await expect(signature).toHaveAttribute('href', 'https://tymabee.ca/');
    await expect(signature).toHaveAttribute('target', '_blank');
    await expect(signature).toHaveAttribute('rel', 'noopener noreferrer');
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await signature.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.load('italic 600 19px "Ty Signature"'));
      const signatureBox = await signature.boundingBox();
      const feedbackBox = await page
        .getByRole('button', { name: 'Help and support', exact: true })
        .boundingBox();
      assert.ok(signatureBox.height >= 44);
      assert.ok(signatureBox.x + signatureBox.width <= width);
      assert.ok(
        signatureBox.x + signatureBox.width <= feedbackBox.x ||
          signatureBox.y + signatureBox.height <= feedbackBox.y ||
          signatureBox.y >= feedbackBox.y + feedbackBox.height,
        'The footer signature clears the fixed feedback control',
      );
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(output, `footer-signature-${theme}-${width}.png`) });
    }
    const fill = signature.locator('.ink-fill');
    const clipRight = () =>
      fill.evaluate((element) =>
        parseFloat(
          getComputedStyle(element)
            .clipPath.match(/inset\(([^)]+)\)/)[1]
            .split(/\s+/)[1] ?? '0',
        ),
      );
    await signature.hover();
    await expect.poll(clipRight, { timeout: 3500 }).toBe(0);
    await page.mouse.move(0, 0);
    await expect.poll(clipRight, { timeout: 3500 }).toBe(100);
    await context.route('https://tymabee.ca/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Developer destination fixture</title>',
      }),
    );
    const destination = context.waitForEvent('page');
    await signature.click();
    const destinationPage = await destination;
    await destinationPage.waitForURL('https://tymabee.ca/');
    assert.equal(await destinationPage.evaluate(() => window.opener === null), true);
    await destinationPage.close();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await signature.focus();
    assert.equal(
      await fill.evaluate((element) => getComputedStyle(element).transitionDuration),
      '0s',
    );
    await signature.evaluate((element) => element.blur());
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    report.checks.push(
      `Footer signature ${theme}: approved typography, responsive placement, hover reversal, reduced motion and isolated new-tab destination`,
    );
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
      await page.goto(`${origin}/transactions/${leagueId}`);
      const buttons = page.getByRole('button', { name: /^Insights for / });
      await buttons.first().waitFor();
      const filterBounds = await cardBounds(
        page.getByRole('textbox', { name: 'Search available athletes', exact: true }),
      );
      const athletesBounds = await cardBounds(buttons.first());
      assert.ok(
        athletesBounds.y - filterBounds.y - filterBounds.height >= 23,
        'Transaction filters and athlete results have at least 24px of separation',
      );
      const choiceFont = await page
        .getByRole('radio', { name: 'All positions', exact: true })
        .getByText('All positions', { exact: true })
        .evaluate((element) => ({
          family: getComputedStyle(element).fontFamily,
          size: parseFloat(getComputedStyle(element).fontSize),
        }));
      assert.ok(
        choiceFont.family.includes('Inter') && choiceFont.size >= 15,
        'Filter choices use readable body typography',
      );
      for (const [heading, topic] of [
        ['My claims', 'Waiver claims'],
        ['Trade history', 'Trade status'],
      ]) {
        const label = page.getByRole('heading', { name: heading, exact: true });
        const info = label
          .locator('..')
          .getByRole('button', { name: `About ${topic}`, exact: true });
        await info.scrollIntoViewIfNeeded();
        const labelBox = await label.boundingBox(),
          infoBox = await info.boundingBox();
        assert.ok(
          Math.abs(labelBox.y + labelBox.height / 2 - infoBox.y - infoBox.height / 2) < 3,
          `${heading} and its information icon share a line`,
        );
      }
      assert.equal(
        await buttons.first().getAttribute('aria-label'),
        'Insights for Zulu Free Guard',
      );
      await page.getByRole('radio', { name: 'Name', exact: true }).click();
      assert.equal(
        await buttons.first().getAttribute('aria-label'),
        'Insights for Able Free Hitter',
      );
      await page.getByRole('radio', { name: 'Next-period projection', exact: true }).click();
      assert.equal(
        await buttons.first().getAttribute('aria-label'),
        'Insights for Zulu Free Guard',
      );
      await page.getByRole('radio', { name: "Women's Volleyball", exact: true }).click();
      assert.equal(await buttons.count(), 1);
      assert.equal(
        await page.getByRole('button', { name: 'Add now', exact: true }).isDisabled(),
        true,
      );
      await page
        .getByText('Your varsity program, unavailable to your account', { exact: true })
        .waitFor();
      await page.getByRole('radio', { name: 'All programs', exact: true }).click();
      const bug = page.getByRole('button', { name: 'Help and support', exact: true });
      const beforeBug = await bug.boundingBox();
      await page.evaluate(() =>
        document.querySelectorAll('div').forEach((element) => {
          if (element.scrollHeight > element.clientHeight + 100) element.scrollTop = 500;
        }),
      );
      const afterBug = await bug.boundingBox();
      assert.equal(
        Math.round(beforeBug.y),
        Math.round(afterBug.y),
        'Feedback button stays fixed after scrolling',
      );
      assert.ok(afterBug.width >= 44, 'Help controls retain an accessible touch target');
      assert.ok(afterBug.x + afterBug.width <= width);
      await page.evaluate(() =>
        document.querySelectorAll('div').forEach((element) => {
          if (element.scrollTop) element.scrollTop = 0;
        }),
      );
      const first = buttons.first();
      assert.equal(await first.getByRole('img').count(), 1);
      const font = await first
        .locator('div')
        .filter({ hasText: 'Zulu Free Guard' })
        .last()
        .evaluate((element) => ({
          size: parseFloat(getComputedStyle(element).fontSize),
          family: getComputedStyle(element).fontFamily,
        }));
      assert.ok(
        font.size >= 16 && font.family.includes('Inter'),
        'Athlete names use the app body font at readable size',
      );
      await first.click();
      const panel = page.locator('#athlete-insights-panel');
      await page.getByText('Published season statistics', { exact: true }).waitFor();
      await page.waitForTimeout(350);
      const box = await panel.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(
        Math.abs(box.x + box.width / 2 - viewport.width / 2) < 3,
        'Insights are horizontally centered',
      );
      assert.ok(
        Math.abs(box.y + box.height / 2 - viewport.height / 2) < 3,
        'Insights are vertically centered',
      );
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'Insights fit the viewport');
      assert.equal(
        await panel.getByText('Average draft position:', { exact: false }).count(),
        0,
        'The quick-view panel omits ADP',
      );
      for (const [label, topic] of [
        [/^Season points:/, 'Fantasy points'],
        [/^Season projection:/, 'Projected fantasy points'],
        ['Next upcoming game', 'Game locks'],
      ]) {
        const labelNode = panel.getByText(label, { exact: typeof label === 'string' });
        const info = labelNode
          .locator('..')
          .getByRole('button', { name: `About ${topic}`, exact: true });
        await info.click();
        const popupId = await info.getAttribute('aria-controls');
        assert.ok(popupId);
        const definitionPanel = page.locator(`[id="${popupId}"]`);
        await definitionPanel.getByText(topic, { exact: true }).waitFor();
        assert.ok(
          await definitionPanel.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            );
          }),
          'A definition is above the athlete dialog and accepts pointer input',
        );
        const popupBox = await definitionPanel.boundingBox();
        assert.ok(
          popupBox.y >= 0 && popupBox.y + popupBox.height <= viewport.height,
          'The complete definition fits the viewport',
        );
        await definitionPanel.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(info).toBeFocused();
        await expect(info).toHaveAttribute('aria-expanded', 'false');
        await info.click();
        await page.keyboard.press('Escape');
        await expect(info).toHaveAttribute('aria-expanded', 'false');
        await expect(panel).toBeVisible();
      }
      const analysis = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      report.accessibility.push({
        page: 'insights',
        theme,
        width,
        violations: analysis.violations,
      });
      const image = `insights-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(output, image) });
      report.screenshots.push(image);
      assert.equal(
        await page.getByText('Old trade notification', { exact: true }).count(),
        0,
        'Historical notifications are not replayed on login',
      );
      await panel.getByRole('button', { name: 'Trade', exact: true }).click();
      await page.getByText('Request Zulu Free Guard from Other Badgers', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Hotel Guard', exact: true }).click();
      await page.getByRole('button', { name: 'Send trade proposal', exact: true }).click();
      await page
        .getByText(/Trade proposal sent$/u)
        .first()
        .waitFor();
      await page.getByRole('button', { name: 'Dismiss notification', exact: true }).first().click();
      const definition = page
        .getByRole('button', { name: 'About Waiver claims', exact: true })
        .first();
      await definition.focus();
      await definition.press('Enter');
      await page.getByText('Waiver claims', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByText('Waiver claims', { exact: true }).waitFor({ state: 'hidden' });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      const listImage = `transactions-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(output, listImage), fullPage: true });
      report.screenshots.push(listImage);
      console.log(`Verified transactions ${theme} ${width}`);
      report.checks.push(
        `Transactions ${theme} ${width}: filters, immediate sorting, photos, team names, program restriction, typography, centered animated statistics`,
      );
    }
    await page.getByRole('radio', { name: 'Hotel Guard, Guard / backcourt', exact: true }).click();
    await page.getByRole('button', { name: 'Add now', exact: true }).first().click();
    await page.getByText('Athlete added to your roster.', { exact: true }).first().waitFor();
    const acquisition = commands.find((command) => command.name === 'add_free_agent');
    assert.equal(acquisition.payload.p_athlete_in_id, 'athlete-10');
    assert.equal(acquisition.payload.p_athlete_out_id, 'athlete-7');
    assert.equal(
      await page.getByRole('button', { name: 'Insights for Zulu Free Guard', exact: true }).count(),
      0,
    );
    report.checks.push(
      `Acquisition ${theme}: explicit drop, atomic add request, refreshed available athletes`,
    );
    await page.goto(origin + '/players');
    await page.getByRole('button', { name: 'Preseason rankings', exact: true }).click();
    await page.getByText('Published snapshot v1', { exact: false }).waitFor();
    await page.getByRole('link', { name: 'Missing Projection', exact: true }).waitFor();
    await page
      .getByRole('textbox', { name: 'Search preseason rankings', exact: true })
      .fill('Zulu');
    assert.equal(
      await page.getByRole('link', { name: 'Missing Projection', exact: true }).count(),
      0,
    );
    await page.getByRole('textbox', { name: 'Search preseason rankings', exact: true }).fill('');
    await page.getByRole('combobox', { name: 'Position', exact: true }).selectOption('HK_F');
    assert.equal(
      await page.getByRole('heading', { name: 'Basketball', exact: true }).count(),
      0,
      'Position filters hide unrelated sport headings',
    );
    await page.getByRole('combobox', { name: 'Sport', exact: true }).selectOption('basketball');
    assert.equal(
      await page.getByRole('combobox', { name: 'Position', exact: true }).inputValue(),
      'all',
    );
    await page
      .getByRole('table', { name: 'Basketball Basketball guard preseason rankings', exact: true })
      .waitFor();
    await page
      .getByRole('combobox', { name: 'Ranking season', exact: true })
      .selectOption('2025-26');
    await page.getByRole('link', { name: 'Zulu Free Guard', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('combobox', { name: 'Ranking season', exact: true }).inputValue(),
      '2025-26',
    );
    await page.goto(origin + '/players/athlete-10');
    await page.getByText('2025–26 Brock game logs', { exact: true }).waitFor();
    await page
      .getByText('Required statistics missing: power play goals', { exact: true })
      .waitFor();
    await page.getByText('Estimated finish: 10.0 pts', { exact: true }).waitFor();
    await page
      .getByRole('combobox', { name: 'Forecast period', exact: true })
      .selectOption('forecast-period');
    const definition = page
      .getByRole('heading', { name: 'Game and period forecast', exact: true })
      .locator('..')
      .getByRole('button', { name: 'About Projected fantasy points', exact: true });
    await definition.hover();
    await definition.focus();
    assert.equal(
      await definition.getAttribute('aria-expanded'),
      'false',
      'Hover and focus do not open definitions',
    );
    await definition.press('Enter');
    assert.equal(await definition.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await definition.getAttribute('aria-expanded'), 'false');
    assert.ok(
      await definition.evaluate((element) => document.activeElement === element),
      'Escape restores the definition trigger',
    );
    const historyCard = page
      .getByText('2025-26, historical', { exact: true })
      .locator('..')
      .locator('..')
      .locator('..');
    const forecastHeader = page.getByRole('heading', {
      name: 'Game and period forecast',
      exact: true,
    });
    const historyBounds = await historyCard.boundingBox();
    const forecastBounds = await cardBounds(forecastHeader);
    assert.ok(
      forecastBounds.y - historyBounds.y - historyBounds.height >= 23,
      'Season history and the forecast have at least 24px of separation',
    );
    assert.equal(
      await forecastHeader
        .locator('..')
        .getByRole('button', { name: 'About Projected fantasy points', exact: true })
        .count(),
      1,
    );
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [label, topic] of [
        ['2026-27 PROJECTED FP', 'Projected fantasy points'],
        ['CURRENT POINTS', 'Fantasy points'],
        ['ADP', 'Average draft position'],
        ['NEXT GAME / LOCK', 'Game locks'],
      ]) {
        const heading = page.getByText(label, { exact: true });
        const info = heading
          .locator('..')
          .getByRole('button', { name: `About ${topic}`, exact: true });
        assert.equal(await info.count(), 1, 'Each definition stays beside its metric label');
        await info.scrollIntoViewIfNeeded();
        const box = await heading.boundingBox(),
          anchor = await info.boundingBox();
        assert.ok(
          Math.abs(box.y + box.height / 2 - anchor.y - anchor.height / 2) < 3,
          `${label} and its definition align vertically`,
        );
      }
      assert.doesNotMatch(
        await page.locator('body').innerText(),
        /supplied season projection|recorded pick across leagues|\u00b7/iu,
      );
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `profile-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto(origin + '/league/' + leagueId);
    const inviteAction = page.getByRole('button', { name: 'Copy invite link', exact: true });
    await inviteAction.waitFor();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const first = await inviteAction.boundingBox();
      const setup = await cardBounds(page.getByText('Automatic matchup schedule', { exact: true }));
      const view = await page
        .getByRole('link', { name: 'View matchups', exact: true })
        .boundingBox();
      assert.ok(setup.y - first.y - first.height >= 15, 'Invitation and matchup setup have a gap');
      assert.ok(view.y - setup.y - setup.height >= 15, 'Matchup actions have a gap');
      assert.ok(
        !(await page.locator('body').innerText()).includes(leagueId),
        'Internal league UUID is hidden',
      );
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `league-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(
      await page.getByRole('button', { name: 'Confirm matchup schedule', exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole('link', { name: 'View matchup schedule', exact: true }).count(),
      1,
    );
    assert.ok(!commands.some((command) => command.name === 'confirm_matchup_schedule'));
    scheduled = true;
    report.checks.push(
      `Backlog ${theme}: profile trade, inline definitions, forecast, historical missing statistics, reviewed rankings, automatic schedule status without commissioner confirmation, fixed feedback at 320–1440px`,
    );
    await page.goto(origin + '/matchups/' + leagueId);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const sections = page.getByText('Earned contributions this period', { exact: true });
      await sections.nth(1).waitFor();
      await page.getByRole('link', { name: 'Former Contributor', exact: true }).waitFor();
      await expect
        .poll(
          async () => {
            const first = await sections.nth(0).boundingBox(),
              second = await sections.nth(1).boundingBox();
            return width === 320
              ? Math.abs(first.x - second.x) < 2 && second.y > first.y
              : second.x > first.x + 100;
          },
          { message: 'Matchup rosters stack on phones and align beside each other on desktop' },
        )
        .toBe(true);
      const firstCard = await sections.nth(0).locator('..').boundingBox();
      const benchLabel = await page
        .getByText('Current saved bench, bench games do not score', { exact: true })
        .first()
        .boundingBox();
      assert.ok(
        benchLabel.y + benchLabel.height <= firstCard.y + firstCard.height - 12,
        'Wrapped roster labels remain inside their card',
      );
      await page.screenshot({
        path: path.join(output, `matchups-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    inbox.unshift({
      id: 'fresh-waiver',
      kind: 'waiver_result',
      title: 'Fresh waiver outcome',
      body: 'Your fixture claim succeeded',
      data: { league_id: leagueId },
      read_at: null,
      created_at: new Date().toISOString(),
    });
    const popup = page.getByText(/Fresh waiver outcome$/u);
    await popup.waitFor();
    await popup.hover();
    await page.waitForTimeout(6500);
    assert.ok(await popup.isVisible(), 'Hover pauses the six-second dismissal');
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).first().click();
    assert.ok(
      !commands.some((command) => command.name === 'mark_notification_read'),
      'Dismissing a popup does not mark the inbox read',
    );
    await page.waitForTimeout(5200);
    assert.equal(await popup.count(), 0, 'Polling does not replay a dismissed event');
    await page.screenshot({
      path: path.join(output, `backlog-league-${theme}.png`),
      fullPage: true,
    });
    await page.goto(origin + '/league/' + leagueId + '?tab=settings');
    const summary = page.getByText('10 rounds, 120 seconds per pick, snake order', { exact: true });
    await summary.waitFor();
    assert.equal(await page.getByText('Only visible to you', { exact: true }).count(), 0);
    assert.equal(
      await page.getByRole('textbox', { name: 'Seconds per draft pick', exact: true }).count(),
      0,
      'A completed draft cannot change its timer',
    );
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(
          async () => {
            const draftCard = await cardBounds(summary);
            const deletionCard = await cardBounds(
              page.getByText('Delete league', { exact: true }).first(),
            );
            return Math.abs(draftCard.width - deletionCard.width);
          },
          { message: 'Commissioner cards align after responsive layout settles' },
        )
        .toBeLessThan(2);
      await assertNoOverflow(page);
      await page.getByText('Delete league', { exact: true }).first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(output, `commissioner-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto(`${origin}/league/${leagueId}/teams/${teamId}`);
    const backToStandings = page.getByRole('link', {
      name: 'Back to league standings',
      exact: true,
    });
    await backToStandings.waitFor();
    const benchCard = await cardBounds(page.getByText('Juliet Defence', { exact: true }));
    const backBox = await backToStandings.boundingBox();
    assert.ok(
      backBox.y - benchCard.y - benchCard.height >= 23,
      'Return to standings clears the bench card',
    );
    preDraft = true;
    await page.goto(origin + '/league/' + leagueId + '?tab=settings');
    const timer = page.getByRole('textbox', { name: 'Seconds per draft pick', exact: true });
    await expect(timer).toHaveValue('120');
    await timer.fill('19');
    await expect(page.getByRole('button', { name: 'Save pick timer', exact: true })).toBeDisabled();
    await timer.fill('20');
    await page.waitForTimeout(5500);
    await expect(timer).toHaveValue('20');
    await page.getByRole('button', { name: 'Save pick timer', exact: true }).click();
    await page
      .getByText('Pick timer saved. Autodraft takes over when this time expires.', { exact: true })
      .waitFor();
    await page.getByText('10 rounds, 20 seconds per pick, snake order', { exact: true }).waitFor();
    await page.reload();
    await expect(timer).toHaveValue('20');
    await timer.scrollIntoViewIfNeeded();
    assert.equal(
      commands.find((command) => command.name === 'set_league_pick_duration').payload
        .p_pick_seconds,
      20,
    );
    await page.screenshot({
      path: path.join(output, `commissioner-timer-${theme}.png`),
      fullPage: true,
    });
    preDraft = false;
    await page.goto(origin + '/admin/participants');
    await page
      .getByRole('textbox', { name: 'Find participant by name or email', exact: true })
      .fill('Varsity');
    await page.getByRole('button', { name: 'Find accounts', exact: true }).click();
    await page
      .getByRole('button', { name: 'Edit participation for Varsity Manager', exact: true })
      .click();
    await page.getByRole('radio', { name: 'Varsity athlete', exact: true }).click();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const searchCard = await cardBounds(
        page.getByRole('button', { name: 'Find accounts', exact: true }),
      );
      const resultCard = await cardBounds(
        page
          .getByRole('button', { name: 'Edit participation for Varsity Manager', exact: true })
          .getByText('Varsity Manager', { exact: true }),
      );
      const editCard = await cardBounds(
        page.getByRole('radio', { name: 'Varsity athlete', exact: true }),
      );
      assert.ok(resultCard.y - searchCard.y - searchCard.height >= 19);
      assert.ok(editCard.y - resultCard.y - resultCard.height >= 19);
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `participants-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole('textbox', { name: 'Reason for participation correction', exact: true })
      .fill('Confirmed membership with the participant');
    await page.getByRole('button', { name: 'Save participation', exact: true }).click();
    await page
      .getByText('Participation saved. League formats and teammate restrictions are updated.', {
        exact: true,
      })
      .waitFor();
    const saved = commands.find((command) => command.name === 'admin_set_participation');
    assert.equal(saved.payload.p_role, 'athlete');
    assert.deepEqual(saved.payload.p_programs, ['womens_volleyball']);
    assert.equal(saved.payload.p_expected_revision, 1);
    await page.screenshot({ path: path.join(output, `participants-${theme}.png`), fullPage: true });
    const adminAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    report.accessibility.push({ page: 'participants', theme, violations: adminAxe.violations });
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + '/admin/schedules');
      const refresh = page.getByRole('button', { name: 'Refresh schedule reviews', exact: true });
      const sourceHeading = page.getByText('Official source health', { exact: true });
      await sourceHeading.waitFor();
      await page
        .getByRole('textbox', { name: 'Override opponent for review-game', exact: true })
        .waitFor();
      const refreshBox = await refresh.boundingBox(),
        sourceBox = await sourceHeading.boundingBox();
      assert.ok(sourceBox.y - refreshBox.y - refreshBox.height >= 19);
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `schedules-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
      await page.goto(origin + '/admin/rankings');
      await page.getByRole('button', { name: 'Preview preseason rankings', exact: true }).click();
      await page.getByRole('link', { name: 'Zulu Free Guard', exact: true }).waitFor();
      await page
        .getByRole('textbox', { name: 'Ranking publication review reason', exact: true })
        .waitFor();
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `rankings-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
      await page.goto(origin + '/admin/history');
      await page
        .getByRole('textbox', { name: 'Historical appearance records JSON', exact: true })
        .fill('[{}]');
      await page
        .getByRole('button', { name: 'Validate and preview historical batch', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Historical publication review reason', exact: true })
        .waitFor();
      await assertNoOverflow(page);
      await page.screenshot({
        path: path.join(output, `history-fixes-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    report.checks.push(
      `Review fixes ${theme}: membership-only dashboard, inline metric definitions, spaced league actions and admin review forms at 320 and 1440px`,
    );
    adminRole = false;
    await page.goto(origin + '/account');
    await page.getByText('Varsity Manager', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Admin panel', exact: true }).count(), 0);
    assert.equal(
      await page.getByRole('link', { name: 'Authenticator security', exact: true }).count(),
      0,
    );
    adminRole = true;
    adminVerified = false;
    await page.reload();
    await page.getByRole('link', { name: 'Authenticator security', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Admin panel', exact: true }).waitFor();
    roleUnavailable = true;
    await page.reload();
    await page.getByText('Varsity Manager', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Admin panel', exact: true }).count(), 0);
    roleUnavailable = false;
    adminVerified = true;
    await page.goto(origin + '/account');
    await page.getByText('Varsity Manager', { exact: true }).waitFor();
    assert.ok(
      (await page.getByRole('img', { name: 'Brock varsity participant', exact: true }).count()) > 0,
    );
    await page.goto(origin + '/lineup-multisport/' + leagueId);
    await page
      .getByText(
        'Varsity format, any two hockey, two basketball and two volleyball athletes, plus FLEX',
        { exact: true },
      )
      .waitFor();
    await page.getByText('🏒 Hockey 1, any position, 1/1', { exact: true }).waitFor();
    const changeFlex = async () => {
      const starter = roster.find((entry) => entry.slot_code === 'FLEX');
      const reserve = roster.find((entry) => entry.slot_code === 'BN');
      await page
        .getByRole('button', { name: `Move ${starter.athlete.display_name}`, exact: true })
        .click();
      await page
        .getByRole('button', { name: `Swap with ${reserve.athlete.display_name}`, exact: true })
        .click();
    };
    const lineupCommands = () => commands.filter((command) => command.name === 'set_period_lineup');
    await changeFlex();
    const pendingPanel = page
      .getByRole('heading', { name: 'Pending lineup changes', exact: true })
      .locator('..');
    await pendingPanel.waitFor();
    assert.equal(
      await pendingPanel.getByText(/→/u).count(),
      2,
      'One row describes each changed athlete',
    );
    await changeFlex();
    assert.equal(await pendingPanel.count(), 0, 'Reversing the same swap removes the panel');
    assert.ok(await page.getByRole('button', { name: 'Save lineup', exact: true }).isDisabled());
    await changeFlex();
    lineupSaveMode = 'conflict';
    const savesBeforeConflict = lineupCommands().length;
    await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
    await page.getByText('League updated. Your changes are retained.', { exact: false }).waitFor();
    await page.waitForTimeout(200);
    assert.equal(
      lineupCommands().length,
      savesBeforeConflict + 1,
      'Conflict refresh never automatically resubmits a lineup',
    );
    await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
    await page
      .getByText('Lineup saved. Future games use these assignments; earned points remain.', {
        exact: true,
      })
      .waitFor();
    assert.notEqual(
      lineupCommands().at(-1).payload.p_idempotency_key,
      lineupCommands().at(-2).payload.p_idempotency_key,
      'Reviewed version creates a new mutation attempt',
    );
    await changeFlex();
    lineupSaveMode = 'uncertain';
    await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
    await page.getByText('Unable to reach the Brock Fantasy server.', { exact: true }).waitFor();
    const committedVersion = lineupVersion;
    await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
    await page
      .getByText('Lineup saved. Future games use these assignments; earned points remain.', {
        exact: true,
      })
      .waitFor();
    assert.equal(
      lineupCommands().at(-1).payload.p_idempotency_key,
      lineupCommands().at(-2).payload.p_idempotency_key,
      'Uncertain outcome retries the original mutation key',
    );
    assert.equal(
      lineupVersion,
      committedVersion,
      'Retry receipt does not apply a second lineup mutation',
    );
    await changeFlex();
    lineupSaveMode = 'roster-conflict';
    await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
    await page.getByText('The saved roster changed.', { exact: false }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Save lineup', exact: true }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'Reload saved lineup', exact: true }).click();
    await page.getByText('SAVED LINEUP', { exact: true }).waitFor();
    report.checks.push(
      `Lineup recovery ${theme}: preserved pending edits, explicit conflict retry, stable uncertain-outcome key, one committed mutation, changed-roster review`,
    );
    report.checks.push(
      `Participation ${theme}: admin correction payload, account badge, varsity lineup labels`,
    );
    await page.goto(origin + '/auth?next=' + encodeURIComponent('/leagues/join?code=AB12CD34'));
    assert.ok(
      (await context.cookies()).some(
        (cookie) =>
          cookie.name === 'bf_auth_next' &&
          decodeURIComponent(cookie.value) === '/leagues/join?code=AB12CD34',
      ),
      'Owned auth entry preserves a validated invitation in an HttpOnly cookie',
    );
    await page.goto(origin + '/leagues/join?code=AB12CD34');
    const invite = page.getByRole('textbox', { name: 'League invite code', exact: true });
    await invite.waitFor();
    assert.equal(await invite.inputValue(), 'AB12CD34');
    assert.ok(
      !commands.some((command) => command.name === 'join_league'),
      'Invitation does not automatically enroll',
    );
    await page
      .getByRole('textbox', { name: 'Fantasy team name', exact: true })
      .fill('Invited Badgers');
    await page.getByRole('button', { name: 'Join league', exact: true }).click();
    await page.waitForURL('**/league/' + leagueId);
    assert.equal(
      commands.find((command) => command.name === 'join_league').payload.p_invite_code,
      'AB12CD34',
    );
    report.checks.push(
      `Invitations ${theme}: auth handoff cookie, code prefill and explicit membership confirmation`,
    );
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.ok(
    report.accessibility.every((entry) => entry.violations.length === 0),
    JSON.stringify(report.accessibility),
  );
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      checks: report.checks,
      screenshots: report.screenshots,
      errors: report.errors,
      accessibilityViolations: report.accessibility.reduce(
        (sum, entry) => sum + entry.violations.length,
        0,
      ),
    }),
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error(await lastPage.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
