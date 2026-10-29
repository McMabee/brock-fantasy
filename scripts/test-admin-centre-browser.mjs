import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Browser fixtures exercise presentation and request contracts separately from database security
const root = path.resolve('apps/client/dist/client');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://local');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    const type = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[path.extname(file)];
    if (file.startsWith(root + path.sep) && type) {
      response.setHeader('content-type', type);
      response.end(await readFile(file));
    } else await handler(request, response);
  } catch {
    response.writeHead(500);
    response.end('Fixture preview failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const output = 'test-results/admin-centre';
await mkdir(output, { recursive: true });
const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const stamp = new Date().toISOString();
const report = {
  hosted: false,
  browserFixtures: true,
  checks: [],
  screenshots: [],
  accessibility: [],
  errors: [],
};
const widths = (process.env.BROCK_BROWSER_WIDTHS ?? '320,390,768,1280,1440').split(',').map(Number);
const themes = (process.env.BROCK_BROWSER_THEMES ?? 'dark,light').split(',');
try {
  for (const theme of themes)
    for (const width of widths) {
      const name = `${theme}-${width}`;
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        { name: 'bf_theme', value: theme, url: origin },
        { name: 'bf_consent', value: 'v1.preferences', url: origin },
        { name: 'bf_csrf', value: 'fixture', url: origin },
      ]);
      let actor = 'admin',
        denied = false,
        missingService = false,
        allFixturesConfirmed = false,
        request = null,
        dismissed = false,
        loseSend = true,
        losePublication = true,
        version = 1;
      const commands = [],
        unexpected = [];
      const candidate = {
        id: id(2),
        display_name: 'Fixture Participant',
        email: 'participant@example.test',
        role: 'none',
        programs: [],
        revision: 1,
      };
      const teams = [
        { id: id(30), name: 'Red Badgers', owner_id: id(1), owner_name: 'MFA Administrator' },
        { id: id(31), name: 'Blue Badgers', owner_id: id(2), owner_name: candidate.display_name },
      ];
      const leagues = [
        { id: id(10), name: 'Current open A', status: 'setup', season_label: '2026-27' },
        { id: id(11), name: 'Current completed B', status: 'complete', season_label: '2026-27' },
        { id: id(12), name: 'Past active C', status: 'active', season_label: '2025-26' },
        { id: id(13), name: 'Past archived D', status: 'archived', season_label: '2025-26' },
        { id: id(14), name: 'Current active E', status: 'active', season_label: '2026-27' },
      ].map((row) => ({
        ...row,
        created_at: stamp,
        commissioner: 'MFA Administrator',
        max_members: 4,
        member_count: 2,
      }));
      const audit = Array.from({ length: 55 }, (_, n) => ({
        id: String(1000 - n),
        created_at: stamp,
        action: 'account.participation_updated',
        category: 'account',
        actor_id: id(1),
        actor: 'MFA Administrator',
        entity_type: 'profile',
        entity_id: id(2),
        entity_name: candidate.display_name,
        summary: `Participation updated ${n + 1}`,
        before_state: { role: 'none' },
        after_state: { role: 'coach', programs: ['mens_hockey'] },
      }));
      const runs = [
        {
          id: id(50),
          created_at: stamp,
          started_at: stamp,
          finished_at: stamp,
          provider: 'Brock schedules',
          job_kind: 'schedule',
          status: 'failed',
          inserted_count: 0,
          updated_count: 3,
          ignored_count: 0,
          alert_count: 1,
          sources: [
            {
              source_id: id(60),
              program: 'womens_hockey',
              url: 'https://gobadgers.ca/sports/womens-ice-hockey/schedule/2026-27?grid=true',
              status: 'failed',
              changed: 3,
              started_at: stamp,
              finished_at: stamp,
              error_code: 'SOURCE_REVIEW_REQUIRED',
            },
          ],
        },
        {
          id: id(51),
          created_at: stamp,
          started_at: stamp,
          finished_at: stamp,
          provider: 'Player provider',
          job_kind: 'player',
          status: 'succeeded',
          inserted_count: 2,
          updated_count: 1,
          ignored_count: 0,
          alert_count: 0,
          sources: [],
        },
      ];
      const alerts = [
        {
          id: id(52),
          created_at: stamp,
          summary: 'Official schedule synchronization needs review',
          status: 'unresolved',
          job_kind: 'schedule',
          error_code: 'OFFICIAL_SCHEDULE_SYNC',
          program: 'womens_hockey',
          source_url: runs[0].sources[0].url,
          sync_run_id: id(50),
          context: { source_id: id(60) },
        },
      ];
      const schedulePrograms = [
        ['womens_hockey', "Brock Women's Hockey"],
        ['mens_hockey', "Brock Men's Hockey"],
        ['womens_basketball', "Brock Women's Basketball"],
        ['mens_basketball', "Brock Men's Basketball"],
        ['womens_volleyball', "Brock Women's Volleyball"],
        ['mens_volleyball', "Brock Men's Volleyball"],
      ].map(([program, label], n) => ({
        id: id(170 + n),
        competition_id: id(180 + n),
        program,
        label,
        last_synced_at: null,
        last_error: null,
      }));
      const schedule = Array.from({ length: 126 }, (_, n) => ({
        id: id(200 + n),
        competition_id: schedulePrograms[n % schedulePrograms.length].competition_id,
        program: schedulePrograms[n % schedulePrograms.length].label,
        home: 'Brock',
        away: n % 3 ? 'Western' : 'Guelph',
        starts_at: new Date(Date.UTC(2026, 10, 1 + Math.floor(n / 2), 17)).toISOString(),
        status: 'scheduled',
        schedule_kind: 'regular',
        neutral_site: false,
        home_is_brock: true,
        schedule_confirmed: false,
        schedule_override: n === 4,
        schedule_revision: 1,
        source_url: null,
        schedule_change: {},
      }));
      const rankingRows = ['womens', 'mens'].flatMap((division, n) =>
        ['HK_F', 'HK_DG', 'BB_BC', 'BB_FC', 'VB_HT', 'VB_LS'].map((position, index) => ({
          athlete_id: id(400 + n * 10 + index),
          name: `${division === 'womens' ? 'Alice' : 'Bob'} ${index + 1}`,
          position_group: position,
          projected_points: 100 - n * 10,
          position_rank: n + 1,
          display_data: {
            division,
            program: `${division}_${index < 2 ? 'hockey' : index < 4 ? 'basketball' : 'volleyball'}`,
            position: index < 2 ? 'F' : index < 4 ? 'BC' : 'HT',
            bio: {},
            season_label: '2026-27',
            games_played: 20,
            stats: index < 2 ? { goals: 15 } : index < 4 ? { points: 60 } : { kills: 40 },
            supporting_statistics: {
              season_label: '2025-26',
              games_played: 18,
              fantasy_points: 72,
              stats: index < 2 ? { G: 12 } : index < 4 ? { PTS: 54 } : { K: 36 },
            },
          },
        })),
      );
      const pageOf = (rows, args) => {
        const remaining = args.p_before_id
          ? rows.filter((row) =>
              args.p_section === 'audit'
                ? Number(row.id) < Number(args.p_before_id)
                : row.id < args.p_before_id,
            )
          : rows;
        const limit = args.p_limit ?? 50;
        return {
          items: remaining.slice(0, limit),
          hasMore: remaining.length > limit,
          nextCursor: remaining.length
            ? { at: stamp, id: remaining[Math.min(limit - 1, remaining.length - 1)].id }
            : null,
        };
      };
      const scan = () => ({
        enabled: true,
        confirmationEnabled: true,
        activeReferenceVersionId: id(70),
        history: [
          {
            id: id(71),
            reference_version_id: id(70),
            scoring_version: 'fixture',
            started_at: stamp,
            completed_at: stamp,
            runner_name: 'MFA Administrator',
            account_count: 1,
            result_count: 1,
          },
        ],
        run: {
          id: id(71),
          reference_version_id: id(70),
          scoring_version: 'fixture',
          started_at: stamp,
          completed_at: stamp,
          runner_name: 'MFA Administrator',
          account_count: 1,
          result_count: 1,
        },
        newRegistrations: 0,
        matches: [
          {
            id: id(72),
            user_id: candidate.id,
            reference_id: id(73),
            score: 90,
            display_name: candidate.display_name,
            email: candidate.email,
            resolved: candidate.role !== 'none',
            dismissed,
            evidence_changed: false,
            review_id: null,
            review_reason: null,
            reviewer_name: null,
            reviewed_at: null,
            confirmation_request: request,
            evidence: {
              reference: {
                name: candidate.display_name,
                emails: [],
                role: 'athlete',
                programs: ['womens_hockey'],
                sources: [],
              },
              accountName: candidate.display_name,
              accountEmail: candidate.email,
              reasons: ['Matching name'],
              scores: { name: 90 },
            },
          },
        ],
      });
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const reply = (body, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/session')
          return reply({
            user:
              actor === 'signed-out'
                ? null
                : {
                    id: actor === 'admin' ? id(1) : id(2),
                    email: actor === 'admin' ? 'admin@example.test' : candidate.email,
                    emailConfirmedAt: stamp,
                  },
            expiresAt: Date.now() + 3600000,
          });
        if (url.pathname === '/api/admin/status')
          return reply({
            authenticated: true,
            hasAdminRole: actor === 'admin',
            isAdmin: actor === 'admin',
            aal: actor === 'admin' ? 'aal2' : 'aal1',
          });
        if (url.pathname === '/api/admin/accounts') return reply({ canManage: false });
        if (url.pathname === '/api/auth/csrf') return reply({});
        if (url.pathname.startsWith('/api/command/')) {
          const command = url.pathname.split('/').at(-1),
            args = route.request().postDataJSON();
          commands.push({ command, args });
          if (command === 'get_schedule_review')
            return reply({
              games: allFixturesConfirmed
                ? schedule.map((game) => ({
                    ...game,
                    schedule_confirmed: true,
                    schedule_override: false,
                  }))
                : schedule,
              alerts: [],
              sources: schedulePrograms,
            });
          if (command === 'admin_request_participant_confirmation') {
            request ??= {
              id: id(80),
              user_id: candidate.id,
              match_id: id(72),
              display_name: candidate.display_name,
              email: candidate.email,
              suggested_role: 'athlete',
              suggested_programs: ['womens_hockey'],
              status: 'pending',
              created_at: stamp,
              updated_at: stamp,
              expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
              responded_at: null,
              reviewed_at: null,
              response_role: null,
              response_programs: null,
              explanation: null,
              review_reason: null,
              requested_by: 'MFA Administrator',
              reviewed_by: null,
              delivery_status: 'queued',
              delivery_failure: null,
            };
            if (loseSend) {
              loseSend = false;
              return reply({ error: 'Send confirmation temporarily unavailable' }, 503);
            }
            return reply({ requestId: request.id });
          }
          if (command === 'submit_participant_confirmation') {
            Object.assign(request, {
              status: 'responded',
              response_role: args.p_role,
              response_programs: args.p_programs,
              explanation: args.p_explanation,
              responded_at: stamp,
              updated_at: stamp,
            });
            return reply({ status: 'responded' });
          }
          if (command === 'admin_review_participant_confirmation') {
            Object.assign(request, {
              status: args.p_approve ? 'approved' : 'rejected',
              review_reason: args.p_reason,
              reviewed_by: 'MFA Administrator',
              reviewed_at: stamp,
            });
            if (args.p_approve) {
              candidate.role = request.response_role;
              candidate.programs = request.response_programs;
              dismissed = candidate.role === 'none';
            }
            return reply({ status: request.status });
          }
          if (command === 'admin_publish_preseason_review') {
            if (losePublication) {
              losePublication = false;
              return reply({ error: 'Publication confirmation temporarily unavailable' }, 503);
            }
            version = 2;
            return reply({ version });
          }
          unexpected.push(command);
          return reply({ error: 'Unexpected command' }, 400);
        }
        if (url.pathname === '/api/data/supabase') {
          const resource = new URL(url.searchParams.get('path'), 'http://fixture');
          const rpc = resource.pathname.split('/').at(-1),
            args = route.request().postDataJSON();
          if (rpc === 'get_notification_snapshot') return reply({ items: [], unreadCount: 0 });
          if (denied) return reply({ message: 'Administrator MFA required', code: '42501' }, 403);
          if (
            missingService &&
            [
              'admin_get_operations_summary',
              'admin_get_ranking_seasons',
              'admin_get_ranking_review',
            ].includes(rpc)
          )
            return reply(
              { message: 'Function unavailable in schema cache', code: 'PGRST202' },
              404,
            );
          if (rpc === 'admin_get_operations_summary')
            return reply({
              unresolvedErrors: 1,
              syncRows: runs,
              auditEvents: audit.slice(0, 40),
              latestSync: runs[0],
            });
          if (rpc === 'admin_get_operations') {
            let rows =
              args.p_section === 'audit' ? audit : args.p_section === 'alerts' ? alerts : runs;
            if (args.p_kind !== 'all' && args.p_section !== 'audit')
              rows = rows.filter((item) => item.job_kind === args.p_kind);
            if (args.p_status !== 'all')
              rows = rows.filter((item) => item.status === args.p_status);
            if (args.p_query)
              rows = rows.filter((item) =>
                JSON.stringify(item).toLowerCase().includes(args.p_query.toLowerCase()),
              );
            return reply(pageOf(rows, args));
          }
          if (rpc === 'admin_get_league_summary')
            return reply({
              currentSeasonId: id(90),
              currentSeasonLabel: '2026-27',
              openCount: 2,
              seasons: ['2026-27', '2025-26'],
            });
          if (rpc === 'admin_list_leagues_filtered') {
            const seasons = args.p_seasons,
              statuses = args.p_statuses;
            const items = leagues.filter(
              (row) =>
                (!seasons.length ||
                  seasons.includes(row.season_label) ||
                  (seasons.includes('current') && row.season_label === '2026-27') ||
                  (seasons.includes('previous') && row.season_label === '2025-26')) &&
                (!statuses.length ||
                  statuses.includes(row.status) ||
                  (statuses.includes('open') &&
                    ['setup', 'drafting', 'active'].includes(row.status))) &&
                (!args.p_query || row.name.toLowerCase().includes(args.p_query.toLowerCase())),
            );
            return reply({
              items,
              filteredCount: items.length,
              totalCount: leagues.length,
              hasMore: false,
              nextCursor: null,
            });
          }
          if (rpc === 'admin_get_league_section')
            return reply({
              league: {
                ...leagues[0],
                format: 'head_to_head',
                roster_format: 'standard',
                ruleset_name: 'Fixture rules',
                ruleset_version: 1,
                draft_status: null,
                draft_mode: 'manual',
                draft_scheduled_for: null,
                draft_pick_seconds: 120,
                free_agents_enabled: true,
                waivers_enabled: true,
                trades_enabled: true,
              },
              teams,
              section: args.p_section,
              items:
                args.p_section === 'members'
                  ? [
                      {
                        user_id: id(1),
                        display_name: 'MFA Administrator',
                        email: 'admin@example.test',
                        account_status: 'Active',
                        role: 'commissioner',
                        joined_at: stamp,
                        is_varsity: false,
                        team_name: teams[0].name,
                      },
                    ]
                  : args.p_section === 'standings'
                    ? [
                        {
                          fantasy_team_id: teams[0].id,
                          rank: 1,
                          wins: 1,
                          losses: 0,
                          ties: 0,
                          points_for: 180,
                          points_against: 90,
                          standing_points: 2,
                        },
                      ]
                    : args.p_section === 'matchups'
                      ? [1, 1, 2].map((period, n) => ({
                          id: id(100 + n),
                          period,
                          home_team_id: teams[0].id,
                          away_team_id: teams[1].id,
                          home_points: 90,
                          away_points: 60,
                          status: 'final',
                          starts_at: stamp,
                          ends_at: stamp,
                          stage: 'regular',
                        }))
                      : [],
            });
          if (rpc === 'admin_get_league_roster')
            return reply(
              ['starter', 'bench', 'injured_reserve'].map((status, n) => ({
                id: id(110 + n),
                athlete_id: id(120 + n),
                slot_code: status === 'starter' ? 'HK_F' : 'BN',
                status,
                display_name: `Roster Athlete ${n + 1}`,
                position: 'F',
                jersey_number: String(n + 10),
                program_name: 'Women’s hockey',
                bio: {},
              })),
            );
          if (rpc === 'admin_list_varsity_participants')
            return reply([
              {
                ...candidate,
                id: id(3),
                role: 'coach',
                programs: ['mens_hockey'],
                display_name: 'Existing Coach',
              },
            ]);
          if (rpc === 'admin_get_participant_scan') return reply(scan());
          if (rpc === 'admin_get_participant') return reply(candidate);
          if (rpc === 'admin_find_participants') return reply([candidate]);
          if (rpc === 'admin_list_participant_requests')
            return reply({
              enabled: true,
              items: request ? [request] : [],
              hasMore: false,
              nextCursor: null,
            });
          if (rpc === 'get_my_participant_request')
            return request && actor === 'candidate'
              ? reply(request)
              : reply({ message: 'Request unavailable', code: 'P0002' }, 404);
          if (rpc === 'admin_get_ranking_seasons')
            return reply({ currentSeason: '2026-27', seasons: ['2026-27', '2025-26'] });
          if (rpc === 'admin_get_ranking_review')
            return reply({
              season: args.p_season ?? '2026-27',
              poolId: id(130),
              canPublish: args.p_season !== '2025-26',
              preview: args.p_preview,
              input_hash: args.p_preview ? 'fixture-reviewed-input' : null,
              rows: args.p_season === '2025-26' ? [] : rankingRows,
              publication: args.p_season === '2025-26' ? null : { version, published_at: stamp },
            });
          unexpected.push(rpc);
          return reply({ message: 'Unexpected read' }, 400);
        }
        return reply({});
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(`${name}: ${error.message}`));
      const visibleText = (value) =>
        page.getByText(value, { exact: true }).filter({ visible: true });
      const capture = async (label) => {
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.window.innerWidth,
        );
        assert.ok(overflow <= 1, `${name} ${label}: page has ${overflow}px horizontal overflow`);
        const result = await new AxeBuilder({ page }).analyze();
        const violations = result.violations
          .filter((item) => ['critical', 'serious'].includes(item.impact))
          .map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }));
        report.accessibility.push({ name, label, violations });
        assert.deepEqual(violations, [], `${name} ${label} accessibility`);
        const file = `${output}/${name}-${label}.png`;
        await page.screenshot({ path: file, fullPage: true });
        report.screenshots.push(file);
      };
      await page.goto(origin + '/admin/schedules');
      const operationsLink = page.getByRole('link', {
        name: 'Back to Operations Centre',
        exact: true,
      });
      await expect(operationsLink).toHaveAttribute('href', '/admin');
      await operationsLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(origin + '/admin');
      await expect(page.getByRole('button', { name: /^View Participation updated/u })).toHaveCount(
        40,
      );
      await expect(page.getByText('ADMIN, MFA REQUIRED', { exact: true })).toHaveCount(0);
      const metricBounds = await Promise.all(
        [
          'Leagues registered, view league directory',
          'View Latest sync',
          'View Ingestion alerts',
          'View Failed recent runs',
        ].map((label) => page.getByRole('link', { name: label, exact: true }).boundingBox()),
      );
      const healthBounds = await page
        .getByRole('heading', { name: 'Sports data health', exact: true })
        .boundingBox();
      const statsGap =
        healthBounds.y - Math.max(...metricBounds.map((bounds) => bounds.y + bounds.height));
      assert.ok(statsGap >= 20 && statsGap <= 32, `${name}: stats/content gap is ${statsGap}px`);
      for (const title of [
        'Varsity participants',
        'Game scores and player statistics',
        'Advanced tools',
      ]) {
        const headingStyle = await page
          .getByRole('heading', { name: title, exact: true })
          .evaluate((element) => {
            const style = globalThis.getComputedStyle(element);
            return {
              fontSize: Number.parseFloat(style.fontSize),
              underline: Number.parseFloat(style.borderBottomWidth),
            };
          });
        assert.ok(
          headingStyle.fontSize >= 22 && headingStyle.underline >= 2,
          `${name}: action heading ${title}`,
        );
      }
      await capture('dashboard');
      await expect(page.locator('[role="link"]:not([href])')).toHaveCount(0);
      const latestSyncLink = page.getByRole('link', { name: 'View Latest sync', exact: true });
      await latestSyncLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/syncs\?kind=/u);
      await page.getByRole('link', { name: 'Back to Operations Centre', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(origin + '/admin');
      const auditButton = page.getByRole('button', {
        name: 'View Participation updated 1',
        exact: true,
      });
      await auditButton.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Audit event details' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Event changes' })).toBeVisible();
      await capture('audit-panel');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'View Participation updated 1', exact: true }),
      ).toBeFocused();
      await page.getByRole('link', { name: 'Show all', exact: true }).click();
      await expect(page.getByRole('button', { name: /^View Participation updated/u })).toHaveCount(
        50,
      );
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(page.getByRole('button', { name: /^View Participation updated/u })).toHaveCount(
        5,
      );
      await capture('audit-history');
      await page.goto(origin + '/admin/syncs?kind=schedule&status=failed');
      await page.getByRole('button', { name: 'View Brock schedules', exact: true }).click();
      await expect(page.getByText('Source review required', { exact: true })).toBeVisible();
      await capture('sync-panel');
      await page.keyboard.press('Escape');
      await page.goto(origin + '/admin/alerts');
      await page
        .getByRole('button', {
          name: 'View Official schedule synchronization needs review',
          exact: true,
        })
        .click();
      await expect(
        page.getByRole('link', { name: 'Open schedule reviews', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');

      await page.goto(origin + '/admin/leagues');
      await expect(visibleText('Showing 2 of 5 total leagues')).toBeVisible();
      await page.getByRole('checkbox', { name: 'Status: Open', exact: true }).click();
      await expect(visibleText('Showing 3 of 5 total leagues')).toBeVisible();
      await page.getByRole('checkbox', { name: 'Season: Current', exact: true }).click();
      await expect(visibleText('Showing 5 of 5 total leagues')).toBeVisible();
      await page.getByRole('checkbox', { name: 'Status: Setup', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Status: Completed', exact: true }).click();
      await expect(visibleText('Showing 2 of 5 total leagues')).toBeVisible();
      await capture('directory');
      const directoryUrl = page.url();
      await page.getByRole('link', { name: 'View Current open A', exact: true }).click();
      await page
        .getByRole('button', { name: 'League section: Members and teams', exact: true })
        .click();
      await expect(page.getByRole('table', { name: 'All teams', exact: true })).toContainText(
        'Manager',
      );
      await page.getByRole('button', { name: 'League section: Rosters', exact: true }).click();
      await expect(page.getByRole('table', { name: 'starter roster', exact: true })).toContainText(
        'Roster Athlete 1',
      );
      await expect(page.getByRole('table', { name: 'bench roster', exact: true })).toContainText(
        'Roster Athlete 2',
      );
      await capture('roster');
      await page.getByRole('button', { name: 'League section: Standings', exact: true }).click();
      await expect(
        page.getByRole('columnheader', { name: 'Standing points', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'League section: Matchups', exact: true }).click();
      await expect(
        page.getByRole('table', { name: 'Period 1 matchups', exact: true }).getByRole('row'),
      ).toHaveCount(3);
      await expect(
        page.getByRole('table', { name: 'Period 2 matchups', exact: true }),
      ).toBeVisible();
      await capture('matchups');
      const directoryLink = page.getByRole('link', {
        name: 'Back to league directory',
        exact: true,
      });
      await expect(directoryLink).toHaveAttribute('href', /\/admin\/leagues\?/u);
      await directoryLink.focus();
      await page.keyboard.press('Enter');
      await expect
        .poll(() =>
          JSON.stringify(
            [...new URL(page.url()).searchParams]
              .filter(([, value]) => value !== '')
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        )
        .toBe(
          JSON.stringify(
            [...new URL(directoryUrl).searchParams]
              .filter(([, value]) => value !== '')
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        );

      await page.goto(origin + '/admin/schedules');
      const filterButton = page.getByRole('button', { name: 'Filter', exact: true });
      for (const key of ['Enter', 'Space']) {
        await filterButton.focus();
        await page.keyboard.press(key);
        await expect(
          page.getByRole('dialog', { name: 'Schedule filters', exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(filterButton).toBeFocused();
      }
      await expect(visibleText('Page 1 of 6')).toBeVisible();
      for (let n = 0; n < 5; n++)
        await page.getByRole('button', { name: 'Next fixtures', exact: true }).click();
      await expect(visibleText('Page 6 of 6')).toBeVisible();
      for (let index = 0; index < schedulePrograms.length; index++) {
        await page.getByRole('button', { name: 'Filter', exact: true }).click();
        if (index > 0)
          await page
            .getByRole('checkbox', {
              name: schedulePrograms[index - 1].label.replace('Brock ', ''),
              exact: true,
            })
            .uncheck();
        await page
          .getByRole('checkbox', {
            name: schedulePrograms[index].label.replace('Brock ', ''),
            exact: true,
          })
          .check();
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(visibleText('21 matching fixtures, 126 total fixtures')).toBeVisible();
        await expect(
          page.getByRole('heading', { name: schedulePrograms[index].label, exact: true }),
        ).toHaveCount(21);
      }
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(visibleText('126 matching fixtures, 126 total fixtures')).toBeVisible();
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      await page.getByRole('checkbox', { name: "Women's Hockey", exact: true }).check();
      await page.getByRole('checkbox', { name: "Men's Hockey", exact: true }).check();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(visibleText('42 matching fixtures, 126 total fixtures')).toBeVisible();
      await page
        .getByRole('textbox', { name: 'Find schedule fixture', exact: true })
        .fill('Guelph');
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      await page.getByLabel('From date', { exact: true }).fill('2026-11-01');
      await page.getByLabel('To date', { exact: true }).fill('2026-11-02');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(visibleText('1 matching fixtures, 126 total fixtures')).toBeVisible();
      await capture('schedules');
      allFixturesConfirmed = true;
      await page.goto(origin + '/admin/schedules');
      await expect(visibleText('0 matching fixtures, 126 total fixtures')).toBeVisible();
      await expect(
        visibleText(
          'No fixtures match these filters. Turn off Needs review in Filter to include confirmed fixtures.',
        ),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Filter', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Needs review', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: "Men's Hockey", exact: true }).check();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(visibleText('21 matching fixtures, 126 total fixtures')).toBeVisible();
      await capture('schedules-confirmed');

      await page.goto(origin + '/admin/rankings');
      await expect(page.getByRole('table')).toHaveCount(6);
      await expect(page.getByRole('table').first()).toContainText('Alice 1');
      await expect(page.getByRole('table').first()).toContainText('Bob 1');
      await expect(page.getByRole('table').first()).toContainText(
        'Supporting source statistics · 2025-26',
      );
      await expect(page.getByRole('table').first()).toContainText('Games: 18 · Fantasy points: 72');
      await capture('rankings');
      await page
        .getByRole('combobox', { name: 'Ranking season', exact: true })
        .selectOption('2025-26');
      await expect(visibleText('Historical rankings are view only.')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Preview preseason rankings', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('combobox', { name: 'Ranking season', exact: true })
        .selectOption('2026-27');
      await page.getByRole('button', { name: 'Preview preseason rankings', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Ranking publication review reason', exact: true })
        .fill('Reviewed all positions and supporting inputs');
      await page.getByRole('button', { name: 'Publish reviewed snapshot', exact: true }).click();
      await page
        .getByRole('button', { name: 'Retry publication confirmation', exact: true })
        .click();
      await expect(visibleText('Preseason ranking snapshot v2 published.')).toBeVisible();
      const publications = commands.filter(
        (item) => item.command === 'admin_publish_preseason_review',
      );
      assert.equal(publications.length, 2);
      assert.deepEqual(publications[0].args, publications[1].args);

      await page.goto(origin + '/admin/participants');
      await expect(
        page.getByRole('combobox', { name: 'Role', exact: true }).filter({ visible: true }),
      ).toHaveCount(width >= 1280 ? 1 : 0);
      if (width < 1280) await page.getByRole('tab', { name: 'Scan', exact: true }).click();
      await page.getByRole('button', { name: 'Request confirmation', exact: true }).click();
      await page.getByRole('button', { name: 'Send confirmation request', exact: true }).click();
      await expect(
        page.getByText('Send confirmation temporarily unavailable', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Send confirmation request', exact: true }).click();
      await expect(
        page.getByText(
          'Confirmation email queued. Delivery status will update after the email service processes it.',
          { exact: true },
        ),
      ).toBeVisible();
      await capture('confirmation-request');
      await page.keyboard.press('Escape');
      const sends = commands.filter(
        (item) => item.command === 'admin_request_participant_confirmation',
      );
      assert.equal(sends.length, 2);
      assert.deepEqual(sends[0].args, sends[1].args);
      actor = 'candidate';
      await page.goto(origin + `/participation/confirm/${id(80)}`);
      await page
        .getByRole('combobox', { name: 'Your varsity role', exact: true })
        .selectOption('none');
      await page
        .getByRole('textbox', { name: 'Optional participation explanation', exact: true })
        .fill('I am a different person');
      await capture('recipient-confirmation');
      await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Submit for administrator review', exact: true })
        .click();
      await expect(visibleText('Response submitted')).toBeVisible();
      assert.equal(candidate.role, 'none');
      actor = 'admin';
      await page.goto(origin + '/admin/participants?view=requests');
      await page
        .getByRole('button', { name: 'Review request for Fixture Participant', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Confirmation review reason', exact: true })
        .fill('Reviewed recipient identity and approved Neither');
      await capture('confirmation-review');
      await page.getByRole('button', { name: 'Approve submitted answer', exact: true }).click();
      await expect(
        page
          .getByText('Response approved and participation saved.', { exact: true })
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      assert.equal(request.status, 'approved');
      assert.equal(dismissed, true);
      await page.keyboard.press('Escape');
      missingService = true;
      await page.goto(origin + '/admin');
      await expect(visibleText('Operations data unavailable')).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'View Ingestion alerts', exact: true }),
      ).toContainText('—');
      await expect(visibleText('No ingestion runs have been recorded.')).toHaveCount(0);
      await capture('dashboard-unavailable');
      await page.goto(origin + '/admin/rankings');
      await expect(
        visibleText(
          'Admin data is temporarily unavailable while a service update is completed. Please try again shortly.',
        ).first(),
      ).toBeVisible();
      await expect(visibleText('Historical rankings are view only.')).toHaveCount(0);
      await expect(visibleText('Rankings unavailable')).toHaveCount(0);
      await capture('rankings-unavailable');
      missingService = false;
      denied = true;
      await page.goto(origin + '/admin/audit');
      await expect(page.getByRole('button', { name: /^View Participation updated/u })).toHaveCount(
        0,
      );
      actor = 'signed-out';
      await page.goto(origin + '/privacy');
      const signInLink = page.getByRole('link', {
        name: width >= 1024 ? 'Sign in' : 'Account',
        exact: true,
      });
      await expect(signInLink).toHaveAttribute('href', '/auth');
      await signInLink.focus();
      const authDocument = page.waitForRequest(
        (request) => request.isNavigationRequest() && new URL(request.url()).pathname === '/auth',
      );
      await page.keyboard.press('Enter');
      await authDocument;
      await expect(page).toHaveURL(origin + '/auth');
      assert.deepEqual(unexpected, [], `${name}: only approved application reads and writes`);
      report.checks.push(name);
      await context.close();
      console.log(
        `${name}: dashboard, histories, tables, filters, ranking publication, confirmation send/reply/review, and accessibility passed`,
      );
    }
  assert.deepEqual(report.errors, [], 'no browser runtime errors');
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
