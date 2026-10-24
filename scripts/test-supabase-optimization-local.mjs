import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

// - Restrict all fixtures, load tests and upgrade reproduction to the local stack
// - Compare historical SQL implementations and real application HTTP responses without response mocks
const exec = promisify(execFile);
const cli = 'node_modules/supabase/dist/supabase.js';
const config = JSON.parse(
  execFileSync(process.execPath, [cli, 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }),
);
const provider = new URL(config.API_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(provider.hostname));
assert.equal(provider.protocol, 'http:');
const container = 'supabase_db_brock-fantasy';
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const uuids = (values) => `array[${values.map((v) => q(v) + '::uuid').join(',')}]`;
const id = () => randomUUID();
const ids = Object.fromEntries(
  [
    'sport',
    'season',
    'rules',
    'competition',
    'team',
    'away',
    'pool',
    'otherPool',
    'period',
    'trade',
  ].map((name) => [name, id()]),
);
const leagues = Array.from({ length: 10 }, id);
const drafts = leagues.map(id);
const teams = Array.from({ length: 80 }, id);
const athletes = Array.from({ length: 1200 }, id);
const users = [];
const clients = [];
const cookie = (client) =>
  client
    ? `bf_access=${encodeURIComponent(client.token)}; __Host-bf-access=${encodeURIComponent(client.token)}`
    : '';
const suffix = id().replaceAll('-', '');
const baselineProjection = `optimization_projection_${suffix}`;
const baselineInsights = `optimization_insights_${suffix}`;
const baselineSnapshot = `optimization_snapshot_${suffix}`;
const evidence = {
  capturedAt: new Date().toISOString(),
  status: 'running',
  environment: 'local-real-auth-postgrest-application',
  results: [],
};
const sizes = (process.env.BROCK_OPTIMIZATION_SIZES ?? '120,1200').split(',').map(Number);
assert.ok(sizes.length > 0 && sizes.every((size) => [120, 1200].includes(size)));
const sql = async (source) => {
  const task = exec(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
    ],
    {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  task.child.stdin.end(source);
  return (await task).stdout.trim();
};
const claims = (client) =>
  JSON.parse(Buffer.from(client.token.split('.')[1], 'base64url').toString('utf8'));
const asUser = (client, source, role = 'authenticated') =>
  `begin; set local request.jwt.claims=${q(JSON.stringify(claims(client)))};set local role ${role};${source};rollback;`;
delete process.env.VERCEL;
process.env.EXPO_PUBLIC_APP_ENV = 'local';
process.env.EXPO_PUBLIC_SUPABASE_URL = provider.origin;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.ANON_KEY;
const { default: handler } = await import('../api/index.js');
const server = createServer((request, response) => {
  Promise.resolve(handler(request, response)).catch(() =>
    response.writeHead(500).end('Local adapter failed'),
  );
});
server.keepAliveTimeout = 60000;
let origin;
async function rpc(client, name, body = {}, direct = false) {
  const response = await fetch(
    direct
      ? `${provider.origin}/rest/v1/rpc/${name}`
      : `${origin}/api/data/supabase?path=${encodeURIComponent('/rest/v1/rpc/' + name)}`,
    {
      method: 'POST',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        ...(direct
          ? { apikey: config.ANON_KEY, authorization: `Bearer ${client?.token ?? config.ANON_KEY}` }
          : { cookie: cookie(client) }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    },
  );
  return { status: response.status, body: await response.json() };
}
async function snapshot(client, index, known) {
  const search = new URLSearchParams(
    known ? { revision: known.revision, poolRevision: known.poolRevision } : {},
  );
  const response = await fetch(`${origin}/api/draft/${drafts[index]}/state?${search}`, {
    headers: { connection: 'close', cookie: cookie(client) },
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, body: await response.json() };
}
async function seedAthletes(count, offset = 0) {
  const selected = athletes.slice(offset, count);
  if (!selected.length) return;
  await sql(`begin;
    insert into public.athletes(id,competition_id,team_id,display_name,position)
      select a,${q(ids.competition)},${q(ids.team)},'Optimization athlete '||(n+${offset}),'F' from unnest(${uuids(selected)})with ordinality f(a,n);
    insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
      select a,${q(ids.season)},${q(ids.competition)},${q(ids.team)},array['F','D','G','BC','FC','HT','L','S'],true,true from unnest(${uuids(selected)})a;
    insert into public.pool_rankings(pool_id,athlete_id,rank,reviewed)
      select ${q(ids.pool)},a,n+${offset},true from unnest(${uuids(selected)})with ordinality f(a,n);
    insert into public.athlete_season_summaries(athlete_id,season_label,source,kind,fantasy_points,games_played,supplied_adp)
      select a,${q(suffix)},'Optimization fixture','supplied_projection',100,20,n from unnest(${uuids(selected)})with ordinality f(a,n);
    insert into public.normalized_player_game_stats(game_id,athlete_id,source_identity,stats,complete,fantasy_points)
      select g.id,a,'optimization:'||g.id||':'||a,jsonb_build_object('goals',1,'assists',2,'source','fixture'),true,10
      from public.games g cross join unnest(${uuids(selected)})a where g.competition_id=${q(ids.competition)}and g.status='final';
    commit;`);
}
async function policyMatrix() {
  const queries = {
    profiles: `select jsonb_agg(id order by id)from public.profiles where id=any(${uuids(users)})`,
    athletes: `select jsonb_agg(id order by id)from public.athletes where competition_id=${q(ids.competition)}`,
    athlete_seasons: `select jsonb_agg(athlete_id order by athlete_id)from public.athlete_seasons where season_id=${q(ids.season)}`,
    competitions: `select jsonb_agg(id order by id)from public.competitions where id=${q(ids.competition)}`,
    teams: `select jsonb_agg(id order by id)from public.teams where competition_id=${q(ids.competition)}`,
    athlete_rankings: `select jsonb_agg(athlete_id order by athlete_id)from public.athlete_rankings where competition_id=${q(ids.competition)}`,
    trades: `select jsonb_agg(id order by id)from public.trades where id=${q(ids.trade)}`,
    trade_items: `select jsonb_agg(athlete_id order by athlete_id)from public.trade_items where trade_id=${q(ids.trade)}`,
    notifications: `select count(*)from public.notifications where user_id=any(${uuids(users)})`,
  };
  const branches = Object.entries(queries)
    .map(
      ([table, query]) => `if has_table_privilege(current_user,${q('public.' + table)},'select')then
    result:=result||jsonb_build_object(${q(table)},(${query}));else result:=result||jsonb_build_object(${q(table)},'permission_denied');end if;`,
    )
    .join('\n');
  const helper = `create function pg_temp.optimization_matrix()returns jsonb language plpgsql security invoker set search_path=''as $$declare result jsonb:='{}';begin ${branches}return result;end$$;`;
  const statements = clients
    .slice(0, 9)
    .flatMap((client) =>
      ['authenticated', 'anon'].map((role) =>
        asUser(client, 'select pg_temp.optimization_matrix()', role),
      ),
    );
  return sql(helper + statements.join('\n'));
}
async function baselinePolicies() {
  const originalNames = new Set([
    'profiles_self_update',
    'user_roles_self_read',
    'notifications_self_read',
    'notifications_self_update',
    'push_tokens_self_read',
    'chat_messages_member_read',
    'chat_mutes_self_read',
    'chat_reports_own_or_admin_read',
    'athlete_rankings_active_read',
    'athlete_rankings_admin_write',
    'beta_memberships_read',
    'roster_directory_memberships_read',
    'active_athletes_public_read',
    'roster_directory_athletes_read',
    'active_competitions_public_read',
    'roster_directory_competitions_read',
    'profiles_own_read',
    'profiles_shared_league_read',
    'active_teams_public_read',
    'roster_directory_teams_read',
    'beta_trade_items_league_read',
    'trade_items_participant_read',
    'beta_trades_league_read',
    'trades_participant_or_commissioner_read',
  ]);
  const statements = new Map();
  const pattern = /create policy ([a-z_]+) on public\.([a-z_]+)[^]*?;/gu;
  for (const file of (await readdir('supabase/migrations'))
    .filter((name) => name < '20261022171340')
    .sort()) {
    for (const match of (await readFile('supabase/migrations/' + file, 'utf8')).matchAll(pattern))
      if (originalNames.has(match[1]))
        statements.set(match[1], { table: match[2], source: match[0] });
  }
  assert.equal(
    statements.size,
    originalNames.size,
    'Every original flagged policy comes from a historical migration',
  );
  const managed = new Map([...statements].map(([name, { table }]) => [name, table]));
  const optimized = await readFile(
    'supabase/migrations/20261022171341_advisor_rls_policy_performance.sql',
    'utf8',
  );
  for (const match of optimized.matchAll(pattern)) managed.set(match[1], match[2]);
  const drops = [...managed]
    .map(([name, table]) => `drop policy if exists ${name} on public.${table};`)
    .join('\n');
  const originals = [...statements.values()]
    .map(({ source }) =>
      source.replace(
        /public\.(current_user_is_admin|shares_league|is_league_member|owns_fantasy_team|is_league_commissioner)\(/gu,
        'rpc_private.$1(',
      ),
    )
    .join('\n');
  await sql(`begin;${drops}${originals}commit;`);
  return optimized;
}
async function policyWarnings() {
  return JSON.parse(
    await sql(`select jsonb_build_object('initplan',(select count(*)from pg_policies where schemaname='public'
    and policyname=any(array['profiles_self_update','user_roles_self_read','notifications_self_read','notifications_self_update','push_tokens_self_read','chat_messages_member_read','chat_mutes_self_read','chat_reports_own_or_admin_read'])
    and (coalesce(qual,'')||coalesce(with_check,''))like'%= auth.uid()%'),
    'duplicates',(select count(*)from(select tablename from pg_policies where schemaname='public'and permissive='PERMISSIVE'and cmd in('SELECT','ALL')and roles&&array['authenticated','public']::name[]
      and tablename=any(array['athlete_rankings','athlete_seasons','athletes','competitions','profiles','teams','trade_items','trades'])group by tablename having count(*)>1)s))`),
  );
}
function functionFrom(source, name) {
  const match = source
    .replaceAll('\r\n', '\n')
    .match(
      new RegExp(
        `create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\([^]*?\\$\\$;`,
        'u',
      ),
    );
  assert.ok(match, 'Historical implementation is present');
  return match[0];
}
async function measuredSQL(name, args, repeats = 8) {
  return JSON.parse(
    await sql(`begin;set local request.jwt.claims=${q(JSON.stringify(claims(clients[0])))};
    do $$declare started timestamptz; durations jsonb:='[]'; ignored jsonb; begin
      for n in 1..${repeats + 1} loop started:=clock_timestamp();ignored:=${name}(${args});
        if n>1 then durations:=durations||to_jsonb(extract(epoch from(clock_timestamp()-started))*1000);end if;
      end loop;perform set_config('optimization.timings',durations::text,true);end$$;
    select current_setting('optimization.timings');rollback;`),
  );
}
async function diagnose(size) {
  const source = await readFile(
    'supabase/migrations/20261022171344_set_based_player_insights.sql',
    'utf8',
  );
  const start = source.indexOf('  with catalog as materialized');
  const end = source.indexOf('  return result;', start);
  assert.ok(start > 0 && end > start);
  const query = source
    .slice(start, end)
    .trim()
    .replace('into result', '')
    .replace(/\bp_pool_id\b/gu, q(ids.pool) + '::uuid')
    .replace(/\bp_athlete_id\b/gu, 'null::uuid');
  await mkdir('test-results/supabase-optimization', { recursive: true });
  for (const mode of ['default', 'off']) {
    const plan = JSON.parse(
      await sql(
        `begin;${mode === 'off' ? "set local jit='off';" : ''}explain(analyze,buffers,format json)${query}rollback;`,
      ),
    );
    await writeFile(
      `test-results/supabase-optimization/insights-${size}-jit-${mode}.json`,
      JSON.stringify(plan, null, 2) + '\n',
    );
    console.log(
      'Local insight plan',
      JSON.stringify({
        size,
        jit: mode,
        executionMs: plan[0]['Execution Time'],
        compilation: plan[0].JIT,
      }),
    );
  }
}
async function drain() {
  const started = Date.now();
  while (
    Number(
      await sql(
        "select count(*)from pg_stat_activity where datname=current_database()and pid<>pg_backend_pid()and state='active'and(query ilike '%get_player_insights%'or query ilike '%get_draft_room_snapshot%')",
      ),
    ) > 0
  ) {
    assert.ok(
      Date.now() - started < 60000,
      'Local benchmark queries drain before measuring the next implementation',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)
  ];
const sqlMeasurements = new Map();
async function benchmark(size, count) {
  console.log(`Measuring matched ${size}-athlete / ${count}-client workload`);
  const args = `${q(ids.pool)}::uuid,null::uuid`;
  if (!sqlMeasurements.has(size)) {
    sqlMeasurements.set(size, {
      before: await measuredSQL(`beta_private.${baselineInsights}`, args, size > 120 ? 3 : 8),
      after: await measuredSQL('public.get_player_insights', args, size > 120 ? 3 : 8),
    });
  }
  const { before, after } = sqlMeasurements.get(size);
  const oldData = await sql(
    `begin;set local request.jwt.claims=${q(JSON.stringify(claims(clients[0])))};select beta_private.${baselineInsights}(${args});rollback;`,
  );
  const result = await rpc(clients[0], 'get_player_insights', { p_pool_id: ids.pool });
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body,
    JSON.parse(oldData),
    'All insight fields preserve historical results',
  );
  const sample = {
    athletes: size,
    clients: count,
    sqlBeforeMs: percentile(before, 0.5),
    sqlAfterMs: percentile(after, 0.5),
  };
  evidence.results.push(sample);
  assert.ok(
    sample.sqlAfterMs <= sample.sqlBeforeMs * 0.5,
    `Insight SQL reduction: ${JSON.stringify(sample)}`,
  );
  for (const phase of ['before', 'after']) {
    // - Only the disposable fixture database switches implementations for matched HTTP measurements
    const current = await sql(
      "select pg_get_functiondef('rpc_private.get_player_insights(uuid,uuid)'::regprocedure)",
    );
    const currentSnapshot = await sql(
      "select pg_get_functiondef('rpc_private.get_draft_room_snapshot(uuid,text,text)'::regprocedure)",
    );
    if (phase === 'before') {
      await sql(
        legacyInsights.replace(
          `beta_private.${baselineInsights}`,
          'rpc_private.get_player_insights',
        ),
      );
      await sql(
        legacySnapshot.replace(
          `beta_private.${baselineSnapshot}`,
          'rpc_private.get_draft_room_snapshot',
        ),
      );
    }
    try {
      const samples = await Promise.all(
        clients.slice(0, count).map(async (client, index) => {
          const started = performance.now();
          try {
            const response = await rpc(client, 'get_player_insights', { p_pool_id: ids.pool });
            if (response.status !== 200)
              return {
                elapsed: performance.now() - started,
                status: response.status,
                stage: 'insights',
              };
            assert.equal(response.body.length, size);
            const snap = await snapshot(client, Math.floor(index / 8));
            if (snap.status !== 200)
              return {
                elapsed: performance.now() - started,
                status: snap.status,
                stage: 'snapshot',
              };
            const unchanged = await snapshot(client, Math.floor(index / 8), snap.body);
            if (unchanged.status !== 200)
              return {
                elapsed: performance.now() - started,
                status: unchanged.status,
                stage: 'unchanged',
              };
            assert.equal(unchanged.body.unchanged, true);
            return { elapsed: performance.now() - started, status: 200 };
          } catch {
            return { elapsed: performance.now() - started, status: 0, stage: 'transport' };
          }
        }),
      );
      sample[`${phase}HttpP95Ms`] = percentile(
        samples.map((s) => s.elapsed),
        0.95,
      );
      sample[`${phase}HttpErrors`] = samples.filter((s) => s.status !== 200).length;
      sample[`${phase}Failures`] = samples
        .filter((s) => s.status !== 200)
        .map(({ status, stage }) => ({ status, stage }));
      if (phase === 'after')
        assert.equal(sample.afterHttpErrors, 0, 'The optimized workload has no HTTP errors');
    } finally {
      if (phase === 'before') await sql(current + ';\n' + currentSnapshot + ';');
      await drain();
    }
  }
  assert.ok(
    sample.afterHttpP95Ms <= sample.beforeHttpP95Ms * 1.2,
    'No workflow p95 regression above twenty percent',
  );
  console.log('PASS matched workload', JSON.stringify(sample));
}
let legacyInsights;
let legacySnapshot;
let createdTrigger = false;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.EXPO_PUBLIC_APP_ORIGIN = origin;
  for (let offset = 0; offset < 80; offset += 8) {
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const n = offset + i,
          email = `optimization-${suffix}-${n}@example.test`,
          password = id() + '!Aa1';
        const created = await fetch(`${provider.origin}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            apikey: config.SERVICE_ROLE_KEY,
            authorization: `Bearer ${config.SERVICE_ROLE_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              display_name: 'Optimization fixture',
              varsity_role: 'none',
              varsity_programs: [],
              beta_age_eligible: true,
              beta_eligibility_year: new Date().getFullYear(),
              beta_eligibility_policy_version: 'brock-beta-eligibility-2026-10-06.1',
            },
          }),
        });
        assert.equal(created.status, 200);
        users[n] = (await created.json()).id;
        const signed = await fetch(`${provider.origin}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: config.ANON_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        assert.equal(signed.status, 200);
        clients[n] = { token: (await signed.json()).access_token };
      }),
    );
  }
  console.log('Created eighty isolated local authenticated fixture managers');
  await sql(`begin;
    insert into public.fantasy_seasons(id,label,rule_version,trade_deadline)values(${q(ids.season)},${q(suffix)},'fixture',now()+interval '365 days');
    insert into public.scoring_rulesets(id,sport,name,version,status,approved_at)values(${q(ids.rules)},'hockey','Optimization fixture',1,'approved',now());
    insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
      select ${q(ids.rules)},slot_code,label,allowed_positions,slot_count,is_starter from public.roster_slot_rules where ruleset_id='b0000000-0000-4000-8000-000000000004';
    insert into public.sports(id,code,name)values(${q(ids.sport)},'hockey','Optimization hockey')on conflict(code)do nothing;
    insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
      select ${q(ids.competition)},id,'mens','Optimization fixture',${q(suffix)},${q(ids.rules)},true from public.sports where code='hockey' limit 1;
    insert into public.teams(id,competition_id,name,short_name)values(${q(ids.team)},${q(ids.competition)},'Optimization home','OPT'),(${q(ids.away)},${q(ids.competition)},'Optimization away','OPA');
    insert into public.player_pools(id,season_id,ruleset_id,name,is_active,rankings_approved_at)
      select p,${q(ids.season)},${q(ids.rules)},'Optimization fixture '||p,true,now()from unnest(${uuids([ids.pool, ids.otherPool])})p;
    insert into public.pool_competitions(pool_id,competition_id)values(${q(ids.pool)},${q(ids.competition)});
    insert into public.fantasy_periods(id,season_id,number,starts_at,ends_at,phase)values(${q(ids.period)},${q(ids.season)},1,now()+interval '2 days',now()+interval '9 days','regular');
    insert into public.games(competition_id,home_team_id,away_team_id,starts_at,status,schedule_kind,schedule_confirmed)
      select ${q(ids.competition)},${q(ids.team)},${q(ids.away)},now()+make_interval(days=>3+n),'scheduled','regular',n%2=0 from generate_series(0,3)n;
    insert into public.games(competition_id,home_team_id,away_team_id,starts_at,status,schedule_kind,schedule_confirmed)
      select ${q(ids.competition)},${q(ids.team)},${q(ids.away)},now()-make_interval(days=>3+n),'final','regular',true from generate_series(0,1)n;
    insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
      select l,${q(ids.pool)},${q(ids.rules)},(${uuids(users)})[((n-1)*8)+1],'Optimization fixture',l::text,8,'head_to_head','drafting'from unnest(${uuids(leagues)})with ordinality f(l,n);
    insert into public.league_members(league_id,user_id,role)
      select (${uuids(leagues)})[((n-1)/8)::integer+1],u,case when (n-1)%8=0 then 'commissioner'::public.league_member_role else 'member'::public.league_member_role end from unnest(${uuids(users)})with ordinality f(u,n);
    insert into public.fantasy_teams(id,league_id,owner_id,name,draft_position)
      select t,(${uuids(leagues)})[((n-1)/8)::integer+1],(${uuids(users)})[n],'Optimization team '||n,(n-1)%8+1 from unnest(${uuids(teams)})with ordinality f(t,n);
    insert into public.drafts(id,league_id,status,rounds,pick_seconds,remaining_seconds,team_order,league_size)
      select d,(${uuids(leagues)})[n],'paused',10,120,120,(${uuids(teams)})[((n-1)*8)+1:n*8],8 from unnest(${uuids(drafts)})with ordinality f(d,n);
    insert into public.notifications(user_id,kind,title,body,data)
      select u,'optimization','Optimization fixture','Fixture body','{}'from unnest(${uuids(users)})u cross join generate_series(1,105);
    commit;`);
  await seedAthletes(120);
  await sql(`insert into public.athlete_rankings(competition_id,athlete_id,rank)select ${q(ids.competition)},a,n from unnest(${uuids(athletes.slice(0, 120))})with ordinality f(a,n);
    insert into public.trades(id,league_id,proposing_team_id,receiving_team_id,proposed_by,expires_at)values(${q(ids.trade)},${q(leagues[0])},${q(teams[0])},${q(teams[1])},${q(users[0])},now()+interval '1 day');
    insert into public.trade_items(trade_id,from_team_id,to_team_id,athlete_id)values(${q(ids.trade)},${q(teams[0])},${q(teams[1])},${q(athletes[0])});`);
  const projection = functionFrom(
    await readFile(
      'supabase/migrations/20261015025016_flex_game_lineups_and_schedule_review.sql',
      'utf8',
    ),
    'beta_private.next_period_projections',
  ).replace('beta_private.next_period_projections', `beta_private.${baselineProjection}`);
  legacyInsights = functionFrom(
    await readFile(
      'supabase/migrations/20261017162725_varsity_participants_and_league_rosters.sql',
      'utf8',
    ),
    'rpc_private.get_player_insights',
  )
    .replace('rpc_private.get_player_insights', `beta_private.${baselineInsights}`)
    .replaceAll('beta_private.next_period_projections', `beta_private.${baselineProjection}`);
  const oldSnapshot = functionFrom(
    await readFile('supabase/migrations/20261020183927_draft_resume_guards.sql', 'utf8'),
    'rpc_private.get_draft_room_snapshot',
  ).replace('rpc_private.get_draft_room_snapshot', `beta_private.${baselineSnapshot}`);
  legacySnapshot = oldSnapshot;
  await sql(
    `${projection}${legacyInsights}${oldSnapshot}revoke all on function beta_private.${baselineProjection}(uuid),beta_private.${baselineInsights}(uuid,uuid),beta_private.${baselineSnapshot}(uuid,text,text)from public,anon,authenticated,service_role;`,
  );
  if (process.argv.includes('--prove-upgrade')) {
    if ((await sql("select to_regprocedure('public.rls_auto_enable()') is null")) === 't') {
      createdTrigger = true;
      await sql(`create function public.rls_auto_enable()returns event_trigger language plpgsql security definer set search_path=pg_catalog as $$
        declare cmd record;begin for cmd in select * from pg_event_trigger_ddl_commands()where schema_name='public'and object_type in('table','partitioned table')loop
          execute format('alter table %s enable row level security',cmd.objid::regclass);end loop;end$$;
        create event trigger optimization_ensure_rls on ddl_command_end when tag in('CREATE TABLE','CREATE TABLE AS','SELECT INTO')execute function public.rls_auto_enable();
        grant execute on function public.rls_auto_enable()to anon,authenticated,service_role;`);
    }
    const oid = await sql("select 'public.rls_auto_enable()'::regprocedure::oid");
    await exec(process.execPath, [cli, 'db', 'push', '--local', '--skip-vault', '--yes'], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    await sql(
      `begin;${await readFile('supabase/migrations/20261022171345_draft_catalog_revisions.sql', 'utf8')}commit;`,
    );
    await sql(
      `begin;${await readFile('supabase/migrations/20261022171344_set_based_player_insights.sql', 'utf8')}commit;`,
    );
    const optimizedPolicies = await baselinePolicies();
    assert.deepEqual(await policyWarnings(), { initplan: 8, duplicates: 8 });
    const matrix = await policyMatrix();
    await sql(`begin;${optimizedPolicies}commit;`);
    assert.deepEqual(await policyWarnings(), { initplan: 0, duplicates: 0 });
    await sql(
      `begin;${await readFile('supabase/migrations/20261022171340_advisor_event_trigger_grants.sql', 'utf8')}commit;`,
    );
    assert.equal(await sql("select 'public.rls_auto_enable()'::regprocedure::oid"), oid);
    assert.equal(
      await sql(
        "select has_function_privilege('anon','public.rls_auto_enable()','execute')or has_function_privilege('authenticated','public.rls_auto_enable()','execute')",
      ),
      'f',
    );
    assert.equal(
      await sql(
        `begin;create table public.optimization_rls_probe_${suffix}(id integer);select relrowsecurity from pg_class where oid='public.optimization_rls_probe_${suffix}'::regclass;rollback;`,
      ),
      't',
    );
    assert.equal(
      await policyMatrix(),
      matrix,
      'Policy rewrite preserves actual-role visible rows before and after upgrade',
    );
    evidence.policyUpgrade = {
      warningsBefore: 16,
      warningsAfter: 0,
      callerRoleCombinations: 18,
      unchangedReadMatrixHash: createHash('sha256').update(matrix).digest('hex'),
    };
    console.log('PASS before/after policy matrix for eighteen caller/role combinations');
  }
  const inbox = await rpc(clients[0], 'get_notification_snapshot', { p_limit: 1 });
  const expectedUnread = Number(
    await sql(
      `select count(*)from public.notifications where user_id=${q(users[0])}and read_at is null`,
    ),
  );
  assert.ok(expectedUnread >= 105);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.notifications.length, 1);
  assert.equal(inbox.body.unreadCount, expectedUnread);
  assert.equal((await rpc(null, 'get_notification_snapshot', {}, true)).status, 401);
  assert.equal((await snapshot(clients[8], 0)).status, 403);
  const known = (await snapshot(clients[0], 0)).body;
  assert.equal((await snapshot(clients[0], 0, known)).body.unchanged, true);
  await sql(
    `update public.athletes set display_name='Optimization changed player' where id=${q(athletes[0])};`,
  );
  const changed = await snapshot(clients[0], 0, known);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.unchanged, false);
  assert.equal(
    changed.body.players.find((a) => a.id === athletes[0]).display_name,
    'Optimization changed player',
  );
  const unauthorized = await sql(
    `begin;set local request.jwt.claims=${q(JSON.stringify(claims(clients[1])))};delete from auth.sessions where id=${q(claims(clients[1]).session_id)};select public.can_use_app();rollback;`,
  );
  assert.equal(unauthorized, 'f');
  const sourcePredicates = {
    sports: `id=(select sport_id from public.competitions where id=${q(ids.competition)})`,
    pool_rankings: `pool_id=${q(ids.pool)}and athlete_id=${q(athletes[0])}`,
    pool_competitions: `pool_id=${q(ids.pool)}`,
    athlete_seasons: `athlete_id=${q(athletes[119])}and season_id=${q(ids.season)}`,
    athletes: `id=${q(athletes[119])}`,
    teams: `id=${q(ids.away)}`,
    competitions: `id=${q(ids.competition)}`,
    fantasy_seasons: `id=${q(ids.season)}`,
    athlete_season_summaries: `athlete_id=${q(athletes[119])}`,
    roster_slot_rules: `ruleset_id=${q(ids.rules)}and slot_code='BN'`,
    fantasy_teams: `id=${q(teams[0])}`,
    leagues: `id=${q(leagues[0])}`,
    drafts: `id=${q(drafts[0])}`,
    draft_picks: `draft_id=${q(drafts[0])}`,
  };
  const setupComplete = `update public.drafts set status='complete'where id=${q(drafts[0])};
    insert into public.draft_picks(draft_id,fantasy_team_id,athlete_id,overall_pick,round,pick_in_round,source)
      values(${q(drafts[0])},${q(teams[0])},${q(athletes[118])},1,1,1,'manager');`;
  async function invalidates(label, mutation, setup = '', pool = ids.pool) {
    const result =
      await sql(`begin;${setup}create temp table optimization_before as select state_version from public.player_pools where id=${q(pool)};
      ${mutation};select state_version>(select state_version from optimization_before)from public.player_pools where id=${q(pool)};rollback;`);
    assert.equal(result, 't', label);
  }
  const updates = {
    sports: "name=name||' changed'",
    pool_rankings: 'reviewed=not reviewed',
    pool_competitions: `competition_id=competition_id`,
    athlete_seasons: "positions=array['F','D']",
    athletes: "bio='{}'::jsonb",
    teams: "name=name||' changed'",
    competitions: "name=name||' changed'",
    fantasy_seasons: "label=label||' changed'",
    athlete_season_summaries: 'fantasy_points=200',
    roster_slot_rules: "label=label||' changed'",
    fantasy_teams: "name=name||' changed'",
    leagues: `pool_id=${q(ids.otherPool)}`,
    drafts: "status='paused'",
    draft_picks: 'overall_pick=2',
  };
  for (const [table, predicate] of Object.entries(sourcePredicates)) {
    const setup = ['drafts', 'draft_picks'].includes(table) ? setupComplete : '';
    await invalidates(
      `${table} UPDATE invalidates its previous pool`,
      `update public.${table} set ${updates[table]} where ${predicate}`,
      setup,
    );
    if (!['sports', 'fantasy_seasons', 'competitions'].includes(table)) {
      const deletionSetup =
        table === 'fantasy_teams' || table === 'leagues'
          ? `delete from public.trades where id=${q(ids.trade)};${table === 'leagues' ? setupComplete : ''}`
          : table === 'teams'
            ? `delete from public.games where competition_id=${q(ids.competition)};`
            : table === 'athletes'
              ? `delete from public.athlete_season_summaries where athlete_id=${q(athletes[119])};delete from public.athlete_seasons where athlete_id=${q(athletes[119])};delete from public.pool_rankings where athlete_id=${q(athletes[119])};`
              : setup;
      await invalidates(
        `${table} DELETE invalidates its previous pool`,
        `delete from public.${table} where ${predicate}`,
        deletionSetup,
      );
    }
  }
  await invalidates(
    'Membership insertion invalidates the destination pool',
    `insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)values(${q(athletes[119])},${q(ids.season)},${q(ids.competition)},${q(ids.team)},array['F'],true,true)`,
    `delete from public.athlete_seasons where athlete_id=${q(athletes[119])};`,
  );
  await invalidates(
    'Ranking insertion invalidates the destination pool',
    `insert into public.pool_rankings(pool_id,athlete_id,rank,reviewed)values(${q(ids.pool)},${q(athletes[119])},120,true)`,
    `delete from public.pool_rankings where pool_id=${q(ids.pool)}and athlete_id=${q(athletes[119])};`,
  );
  await invalidates(
    'Pool membership insertion invalidates the destination pool',
    `insert into public.pool_competitions(pool_id,competition_id)values(${q(ids.otherPool)},${q(ids.competition)})`,
    '',
    ids.otherPool,
  );
  await invalidates(
    'Summary insertion invalidates ADP and displayed metrics',
    `insert into public.athlete_season_summaries(athlete_id,season_label,source,kind,supplied_adp)values(${q(athletes[0])},${q(suffix)},'Additional fixture','supplied_projection',20)`,
  );
  await invalidates(
    'Completed pick insertion invalidates global ADP',
    `insert into public.draft_picks(draft_id,fantasy_team_id,athlete_id,overall_pick,round,pick_in_round,source)values(${q(drafts[0])},${q(teams[0])},${q(athletes[117])},2,1,2,'autopick')`,
    setupComplete,
  );
  await invalidates(
    'Pool metadata invalidates the opaque revision',
    `update public.player_pools set name=name||' changed'where id=${q(ids.pool)}`,
  );
  const originalAdp = await sql(
    "select pg_get_functiondef('beta_private.pool_adp(uuid,integer)'::regprocedure)",
  );
  await invalidates(
    'Archival invalidates completed observations',
    `update public.drafts set voided_at=now()where id=${q(drafts[0])}`,
    setupComplete,
  );
  const directKnown = (await snapshot(clients[0], 0)).body;
  await sql(`update public.drafts set remaining_seconds=110 where id=${q(drafts[0])}`);
  const directChanged = await snapshot(clients[0], 0, directKnown);
  assert.equal(directChanged.body.unchanged, false);
  assert.equal(directChanged.body.draft.remaining_seconds, 110);
  await sql(`update public.drafts set remaining_seconds=120 where id=${q(drafts[0])}`);
  const participation = JSON.parse(
    await sql(`begin;set local request.jwt.claims=${q(JSON.stringify(claims(clients[0])))};
    update public.teams set is_brock=true where id=${q(ids.team)};
    update beta_private.account_participation set role='athlete',programs=array['mens_hockey'],revision=revision+1 where user_id=${q(users[0])};
    create temp table optimization_participation as select public.get_draft_room_snapshot(${q(drafts[0])})body;
    delete from beta_private.account_participation where user_id=${q(users[0])};
    select jsonb_build_object('wasBlocked',(select body->'candidates'->0->'blockedTeamIds'?${q(teams[0])}from optimization_participation),
      'changed',not(public.get_draft_room_snapshot(${q(drafts[0])},(select body->>'revision'from optimization_participation),(select body->>'poolRevision'from optimization_participation))->>'unchanged')::boolean,
      'canAcquire',beta_private.can_acquire_athlete(${q(teams[0])},${q(athletes[0])}));rollback;`),
  );
  assert.deepEqual(participation, { wasBlocked: true, changed: true, canAcquire: true });
  assert.equal(
    await sql(`begin;set local request.jwt.claims=${q(JSON.stringify(claims(clients[0])))};
    update public.teams set is_brock=true where id=${q(ids.team)};
    update beta_private.account_participation set role='athlete',programs=array['mens_hockey'],revision=revision+1 where user_id=${q(users[0])};
    update beta_private.account_participation set role='coach',programs=array['mens_hockey'],revision=revision+1 where user_id=${q(users[1])};
    with snapshot as materialized(select public.get_draft_room_snapshot(${q(drafts[0])})data)
    select bool_and((candidate->'blockedTeamIds'?ft.id::text)=not beta_private.can_acquire_athlete(ft.id,(candidate->>'id')::uuid))
    from snapshot cross join lateral jsonb_array_elements(data->'candidates')candidate
    cross join public.fantasy_teams ft where ft.league_id=${q(leagues[0])};rollback;`),
    't',
    'Set-based snapshot restrictions match the authoritative acquisition rule for every athlete and team',
  );
  try {
    const steady = (await snapshot(clients[0], 0)).body;
    await sql(
      "create or replace function beta_private.pool_adp(p_pool_id uuid,p_league_size integer default null)returns jsonb language plpgsql stable security definer set search_path=''as $$begin raise exception 'Unchanged snapshots must not calculate ADP';end$$;",
    );
    assert.equal((await snapshot(clients[0], 0, steady)).body.unchanged, true);
  } finally {
    await sql(originalAdp);
  }
  console.log(
    'PASS catalog invalidation, automatic RLS, unread totals, isolation, revocation and unchanged ADP fast path',
  );
  for (const size of sizes) {
    if (size === 1200) await seedAthletes(1200, 120);
    if (process.argv.includes('--correctness-only')) evidence.benchmarkSkipped = true;
    else if (process.argv.includes('--diagnose')) await diagnose(size);
    else {
      await benchmark(size, 8);
      await benchmark(size, 80);
    }
  }
  for (const [index, mutation, label] of [
    [
      77,
      `delete from auth.sessions where id=${q(claims(clients[77]).session_id)}`,
      'revoked session',
    ],
    [
      78,
      `delete from beta_private.account_eligibility_attestations where user_id=${q(users[78])}`,
      'missing eligibility',
    ],
    [
      79,
      `update public.profiles set deleted_at=clock_timestamp()where id=${q(users[79])}`,
      'deleted account',
    ],
  ]) {
    await sql(mutation);
    for (const name of ['get_notification_snapshot', 'get_player_insights']) {
      const args = name === 'get_player_insights' ? { p_pool_id: ids.pool } : {};
      for (const direct of [false, true]) {
        const denied = await rpc(clients[index], name, args, direct);
        assert.ok(
          [401, 403].includes(denied.status),
          `${label} denies ${name} through ${direct ? 'PostgREST' : 'the application route'}`,
        );
      }
    }
    assert.ok(
      [401, 403].includes((await snapshot(clients[index], 9)).status),
      `${label} cannot reuse a draft snapshot`,
    );
  }
  console.log('PASS revoked sessions, missing eligibility and deleted accounts through real HTTP');
  evidence.status = process.argv.includes('--diagnose') ? 'diagnosed' : 'passed';
} finally {
  // - Restore canonical local implementations even when a baseline measurement fails
  await drain();
  await sql(`begin;${await readFile('supabase/migrations/20261022171344_set_based_player_insights.sql', 'utf8')}
    ${await readFile('supabase/migrations/20261022171345_draft_catalog_revisions.sql', 'utf8')}commit;`);
  await sql(`begin;delete from public.trade_items where trade_id=${q(ids.trade)};delete from public.trades where id=${q(ids.trade)};
    delete from public.leagues where id=any(${uuids(leagues)});
    delete from public.pool_rankings where pool_id=any(${uuids([ids.pool, ids.otherPool])});delete from public.pool_competitions where pool_id=any(${uuids([ids.pool, ids.otherPool])});
    delete from public.player_pools where id=any(${uuids([ids.pool, ids.otherPool])});
    delete from public.athlete_season_summaries where athlete_id=any(${uuids(athletes)});
    delete from public.athlete_seasons where season_id=${q(ids.season)};delete from public.athletes where id=any(${uuids(athletes)});
    delete from public.games where competition_id=${q(ids.competition)};delete from public.teams where competition_id=${q(ids.competition)};
    delete from public.competitions where id=${q(ids.competition)};delete from public.sports where id=${q(ids.sport)};delete from public.roster_slot_rules where ruleset_id=${q(ids.rules)};
    delete from public.scoring_rulesets where id=${q(ids.rules)};delete from public.fantasy_periods where season_id=${q(ids.season)};delete from public.fantasy_seasons where id=${q(ids.season)};
    drop function if exists beta_private.${baselineInsights}(uuid,uuid);drop function if exists beta_private.${baselineProjection}(uuid);drop function if exists beta_private.${baselineSnapshot}(uuid,text,text);commit;`);
  if (createdTrigger)
    await sql('drop event trigger optimization_ensure_rls;drop function public.rls_auto_enable();');
  for (const user of users.filter(Boolean)) {
    const response = await fetch(`${provider.origin}/auth/v1/admin/users/${user}`, {
      method: 'DELETE',
      headers: {
        apikey: config.SERVICE_ROLE_KEY,
        authorization: `Bearer ${config.SERVICE_ROLE_KEY}`,
      },
    });
    assert.equal(response.status, 200);
  }
  await new Promise((resolve) => server.close(resolve));
  await mkdir('test-results/supabase-optimization', { recursive: true });
  if (evidence.status === 'running') evidence.status = 'failed';
  await writeFile(
    `test-results/supabase-optimization/${process.argv.includes('--correctness-only') ? 'api-correctness' : 'api-benchmark'}.json`,
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
