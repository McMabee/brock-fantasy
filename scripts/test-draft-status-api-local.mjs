import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

// - Restrict fixtures and upgrade reproduction to the local Supabase stack
// - Exercise exported application routes, real Auth sessions and PostgREST without network mocks
const exec = promisify(execFile);
const container = 'supabase_db_brock-fantasy';
const config = JSON.parse(
  execFileSync(
    process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  ),
);
const provider = new URL(config.API_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(provider.hostname));
assert.equal(provider.protocol, 'http:');
delete process.env.VERCEL;
process.env.EXPO_PUBLIC_APP_ENV = 'local';
process.env.EXPO_PUBLIC_SUPABASE_URL = provider.origin;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.ANON_KEY;
process.env.SUPABASE_SECRET_KEY = config.SERVICE_ROLE_KEY;
const { default: handler } = await import('../api/index.js');
const server = createServer((request, response) => {
  Promise.resolve(handler(request, response)).catch(() => {
    response.writeHead(500).end('Local adapter failed');
  });
});
const ids = Object.fromEntries(
  [
    'sport',
    'season',
    'rules',
    'pool',
    'competition',
    'realTeam',
    'league',
    'otherLeague',
    'draft',
    'old',
    'otherDraft',
  ].map((name) => [name, randomUUID()]),
);
const teams = Array.from({ length: 4 }, () => randomUUID());
const athletes = Array.from({ length: 60 }, () => randomUUID());
const users = [];
const clients = [];
const migration = await readFile(
  'supabase/migrations/20261022141537_resolve_draft_status_rpc.sql',
  'utf8',
);
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const array = (values) => `array[${values.map((value) => q(value) + '::uuid').join(',')}]`;
const sqlArgs = [
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
];
async function sql(source) {
  const task = exec('docker', sqlArgs, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  task.child.stdin.end(source);
  return (await task).stdout.trim();
}
const state = async () =>
  JSON.parse(await sql(`select row_to_json(d) from public.drafts d where id='${ids.draft}';`));
const worker = () =>
  sql("begin;set local statement_timeout='8s';select public.process_expired_drafts(25);commit;");
async function providerRequest(path, body) {
  return fetch(`${provider.origin}/auth/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: config.SERVICE_ROLE_KEY,
      authorization: `Bearer ${config.SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}
let origin;
async function command(client, name, body) {
  const response = await fetch(`${origin}/api/command/${name}`, {
    method: 'POST',
    headers: {
      origin,
      cookie: client?.cookie ?? 'bf_csrf=anonymous',
      'x-csrf-token': client?.csrf ?? 'anonymous',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
const change = (client, status, key = randomUUID(), draft = ids.draft) =>
  command(client, 'set_draft_status', {
    p_draft_id: draft,
    p_status: status,
    p_idempotency_key: key,
  });
const pick = (key = randomUUID()) =>
  command(clients[0], 'make_draft_pick', {
    p_draft_id: ids.draft,
    p_athlete_id: athletes[1],
    p_source: 'manager',
    p_idempotency_key: key,
    p_expected_version: null,
  });
function held(source) {
  const child = spawn('docker', sqlArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '',
    errors = '',
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('draft-barrier')) readyResolve();
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.on('error', (error) => {
      readyReject(error);
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0 && output.includes('draft-barrier')) resolve();
      else {
        const error = new Error(errors || 'Draft concurrency barrier failed');
        readyReject(error);
        reject(error);
      }
    });
  });
  done.catch(() => {});
  const claims = JSON.parse(Buffer.from(clients[0].token.split('.')[1], 'base64url').toString());
  child.stdin.end(
    `begin;set local statement_timeout='8s';select set_config('request.jwt.claims',${q(JSON.stringify(claims))},true);set local role authenticated;${source}select 'draft-barrier';select pg_sleep(0.8);commit;`,
  );
  return { ready, done };
}
let restoreEndpoint = false;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.EXPO_PUBLIC_APP_ORIGIN = origin;
  for (let n = 0; n < 5; n++) {
    const email = `draft-api-${randomUUID()}@example.test`,
      password = randomUUID() + '!Aa1';
    const created = await providerRequest('/admin/users', {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: 'Draft API fixture',
        varsity_role: 'none',
        varsity_programs: [],
        beta_age_eligible: true,
        beta_eligibility_year: new Date().getFullYear(),
        beta_eligibility_policy_version: 'brock-beta-eligibility-2026-10-06.1',
      },
    });
    assert.equal(
      created.status,
      200,
      'Local fixture Auth account is created without sending email',
    );
    users.push((await created.json()).id);
    const signed = await fetch(`${origin}/api/auth/sign-in`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, eligibilityAttested: true }),
    });
    assert.equal(signed.status, 200, 'Exported sign-in route creates an eligible AAL1 session');
    const cookies = signed.headers.getSetCookie().map((value) => value.split(';')[0]);
    const value = (name) =>
      decodeURIComponent(cookies.find((row) => row.startsWith(`${name}=`)).slice(name.length + 1));
    const accessName = cookies.some((row) => row.startsWith('__Host-bf-access='))
      ? '__Host-bf-access'
      : 'bf_access';
    clients.push({ cookie: cookies.join('; '), csrf: value('bf_csrf'), token: value(accessName) });
  }
  await sql(`begin;
insert into public.fantasy_seasons(id,label,rule_version,trade_deadline)values('${ids.season}','Draft API ${ids.season}','fixture',now()+interval '1 year');
insert into public.scoring_rulesets(id,name,version,status,approved_at)values('${ids.rules}','Draft API fixture',1,'approved',now());
insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
select '${ids.rules}',slot_code,label,allowed_positions,slot_count,is_starter from public.roster_slot_rules where ruleset_id='b0000000-0000-4000-8000-000000000004';
insert into public.sports(id,code,name)values('${ids.sport}','hockey','Draft API fixture')on conflict(code)do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select '${ids.competition}',id,'mens','Draft API fixture','fixture','${ids.rules}',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name)values('${ids.realTeam}','${ids.competition}','Fixture','FIX');
insert into public.athletes(id,competition_id,team_id,display_name,position)
select id,'${ids.competition}','${ids.realTeam}','Fixture player','F' from unnest(${array(athletes)})id;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select id,'${ids.season}','${ids.competition}','${ids.realTeam}',array['F','D','G','BC','FC','HT','L','S'],true,true from unnest(${array(athletes)})id;
insert into public.player_pools(id,season_id,ruleset_id,name,is_active,rankings_approved_at)values('${ids.pool}','${ids.season}','${ids.rules}','Draft API fixture',true,now());
insert into public.pool_competitions(pool_id,competition_id)values('${ids.pool}','${ids.competition}');
insert into public.pool_rankings(pool_id,athlete_id,rank,reviewed)select '${ids.pool}',id,n,true from unnest(${array(athletes)})with ordinality a(id,n);
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
select id,'${ids.pool}','${ids.rules}','${users[0]}','Draft API fixture',id::text,4,'head_to_head','drafting' from unnest(${array([ids.league, ids.otherLeague])})id;
insert into public.league_members(league_id,user_id,role)
select '${ids.league}',id,case when n=1 then 'commissioner'::public.league_member_role else 'member'::public.league_member_role end from unnest(${array(users.slice(0, 4))})with ordinality u(id,n);
insert into public.fantasy_teams(id,league_id,owner_id,name,draft_position)
select id,'${ids.league}',(${array(users.slice(0, 4))})[n],'Draft API team '||n,n from unnest(${array(teams)})with ordinality t(id,n);
insert into public.drafts(id,league_id,status,rounds,pick_seconds,remaining_seconds,team_order,league_size,rankings_snapshot,voided_at,completed_at)
select id,'${ids.league}',case when id='${ids.old}'::uuid then 'complete'::public.draft_status else 'paused'::public.draft_status end,10,120,120,${array(teams)},4,
(select jsonb_agg(jsonb_build_object('athlete_id',athlete_id,'rank',rank)order by rank)from public.pool_rankings where pool_id='${ids.pool}'),
case when id='${ids.old}'::uuid then now() end,case when id='${ids.old}'::uuid then now() end from unnest(${array([ids.draft, ids.old])})id;
insert into public.drafts(id,league_id,status,rounds,pick_seconds,remaining_seconds)values('${ids.otherDraft}','${ids.otherLeague}','paused',10,120,120);
insert into public.draft_picks(draft_id,fantasy_team_id,athlete_id,overall_pick,round,pick_in_round,source)
values('${ids.old}','${teams[0]}','${athletes[0]}',1,1,1,'autopick');
insert into public.draft_queues(draft_id,fantasy_team_id,athlete_id,priority)
values('${ids.draft}','${teams[0]}','${athletes[0]}',1),('${ids.otherDraft}','${teams[0]}','${athletes[2]}',1);
commit;`);
  if (process.argv.includes('--prove-upgrade')) {
    restoreEndpoint = true;
    await sql(`create function public.set_draft_status(p_draft_id uuid,p_status public.draft_status,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$begin perform rpc_private.require_app_access();return rpc_private.set_draft_status($1,$2,$3);end$$;
revoke all on function public.set_draft_status(uuid,public.draft_status,text)from public,anon,authenticated,service_role;
grant execute on function public.set_draft_status(uuid,public.draft_status,text)to authenticated;notify pgrst,'reload schema';`);
    let reproduced = false;
    for (let n = 0; n < 40; n++) {
      const response = await fetch(`${provider.origin}/rest/v1/rpc/set_draft_status`, {
        method: 'POST',
        headers: {
          apikey: config.ANON_KEY,
          authorization: `Bearer ${clients[0].token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_draft_id: ids.draft,
          p_status: 'fixture-invalid-status',
          p_idempotency_key: 'draft-api-upgrade-proof',
        }),
      });
      if ((await response.json()).code === 'PGRST203') {
        reproduced = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(reproduced, 'PostgREST reproduces the original PGRST203 overload error');
    const failed = await change(clients[0], 'active');
    assert.equal(failed.status, 400);
    assert.match(failed.body.error, /Could not choose the best candidate function/u);
    assert.equal((await state()).state_version, 1, 'Ambiguous HTTP calls leave draft untouched');
    await sql(`begin;${migration}commit;`);
    restoreEndpoint = false;
    for (let n = 0; n < 40; n++) {
      const response = await change(clients[1], 'active');
      if (!response.body.error?.includes('Could not choose')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(
      'PASS: actual PostgREST and application route reproduce PGRST203 before the repair',
    );
  }
  assert.equal((await change(null, 'active')).status, 401);
  for (const index of [1, 4]) {
    const denied = await change(clients[index], 'active');
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /Commissioner access required/u);
  }
  assert.match((await change(clients[0], 'active', randomUUID(), ids.old)).body.error, /replaced/u);
  const key = randomUUID();
  const resumed = await change(clients[0], 'active', key);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const first = await state();
  assert.ok(first.starts_at);
  assert.ok(Date.parse(first.pick_deadline) - Date.now() > 115000);
  assert.deepEqual((await change(clients[0], 'active', key)).body, resumed.body);
  assert.equal((await state()).pick_deadline, first.pick_deadline);
  await sql(
    `update public.drafts set pick_deadline=clock_timestamp()+interval '37 seconds' where id='${ids.draft}';`,
  );
  assert.equal((await change(clients[0], 'paused')).status, 200);
  const frozen = await state();
  assert.equal(frozen.pick_deadline, null);
  assert.ok(frozen.remaining_seconds >= 35 && frozen.remaining_seconds <= 37);
  assert.notEqual((await pick()).status, 200);
  await worker();
  assert.equal((await state()).current_overall_pick, 1);
  assert.equal((await change(clients[0], 'active')).status, 200);
  assert.ok(Date.parse((await state()).pick_deadline) - Date.now() < 38000);
  assert.equal((await change(clients[0], 'paused')).status, 200);
  await sql(
    `begin;select beta_private.league_lock('${ids.league}');delete from public.draft_queues where draft_id='${ids.draft}';commit;`,
  );
  const snapshot = await fetch(`${origin}/api/draft/${ids.draft}/state`, {
    headers: { cookie: clients[0].cookie },
  });
  assert.equal(snapshot.status, 200);
  const view = await snapshot.json();
  assert.deepEqual(view.queue, []);
  assert.deepEqual(view.roster, []);
  assert.deepEqual(view.picks, []);
  assert.equal(
    await sql(`select count(*) from public.draft_queues where draft_id='${ids.otherDraft}';`),
    '1',
  );
  assert.equal(
    await sql(`select beta_private.pool_adp('${ids.pool}')->'${athletes[0]}'->>'samples';`),
    '0',
  );
  const archived = await fetch(`${origin}/api/draft/${ids.old}/state`, {
    headers: { cookie: clients[0].cookie },
  });
  assert.equal((await archived.json()).replaced, true);
  console.log(
    'PASS: real authenticated HTTP resume, frozen timer, retry, roles, archived draft, ADP and queue isolation',
  );
  await sql(
    `update public.drafts set status='active',pick_deadline=clock_timestamp()-interval '1 second',remaining_seconds=null where id='${ids.draft}';`,
  );
  const pauseFirst = held(
    `select public.set_draft_status('${ids.draft}','paused','draft-api-held-pause');`,
  );
  await pauseFirst.ready;
  const [blockedPick] = await Promise.all([pick(), worker(), pauseFirst.done]);
  assert.notEqual(blockedPick.status, 200);
  assert.equal((await state()).current_overall_pick, 1);
  await sql(
    `update public.drafts set status='active',pick_deadline=clock_timestamp()+interval '60 seconds',remaining_seconds=null where id='${ids.draft}';`,
  );
  const pickFirst = held(
    `select public.make_draft_pick('${ids.draft}','${athletes[1]}','draft-api-held-pick','manager',null);`,
  );
  await pickFirst.ready;
  const [pauseAfterPick] = await Promise.all([
    change(clients[0], 'paused'),
    worker(),
    pickFirst.done,
  ]);
  assert.equal(pauseAfterPick.status, 200);
  assert.equal((await state()).current_overall_pick, 2);
  const version = (await state()).state_version;
  assert.equal((await pick('draft-api-held-pick')).status, 200);
  assert.equal((await state()).state_version, version);
  await sql(
    `update public.drafts set status='active',pick_deadline=clock_timestamp()-interval '1 second',remaining_seconds=null where id='${ids.draft}';`,
  );
  const [finalPause] = await Promise.all([change(clients[0], 'paused'), worker(), worker()]);
  assert.equal(finalPause.status, 200);
  const final = await state();
  assert.equal(final.status, 'paused');
  assert.ok(final.current_overall_pick >= 2 && final.current_overall_pick <= 3);
  assert.equal(
    Number(await sql(`select count(*) from public.draft_picks where draft_id='${ids.draft}';`)),
    final.current_overall_pick - 1,
  );
  assert.equal(
    await sql(`select count(*) from public.draft_picks where draft_id='${ids.old}';`),
    '1',
  );
  console.log(
    'PASS: pause-first and pick-first lock barriers, duplicate pick retry and overlapping timeout workers',
  );
  await sql(
    `delete from beta_private.account_eligibility_attestations where user_id='${users[4]}';`,
  );
  assert.equal((await change(clients[4], 'active')).status, 401);
  const ineligible = await fetch(`${provider.origin}/rest/v1/rpc/set_draft_status`, {
    method: 'POST',
    headers: {
      apikey: config.ANON_KEY,
      authorization: `Bearer ${clients[4].token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_draft_id: ids.draft,
      p_status: 'active',
      p_idempotency_key: randomUUID(),
    }),
  });
  assert.equal(ineligible.status, 403);
  assert.equal((await ineligible.json()).code, '42501');
  assert.equal((await state()).status, 'paused');
  console.log(
    'PASS: a valid Auth session without application eligibility cannot change draft status',
  );
} finally {
  if (restoreEndpoint) await sql(`begin;${migration}commit;`);
  // - Remove only generated local fixtures and their dependent history
  await sql(`begin;
delete from public.roster_slot_history where roster_entry_id in(select id from public.roster_entries where league_id in('${ids.league}','${ids.otherLeague}'));
delete from public.leagues where id in('${ids.league}','${ids.otherLeague}');
delete from public.pool_rankings where pool_id='${ids.pool}';delete from public.pool_competitions where pool_id='${ids.pool}';delete from public.player_pools where id='${ids.pool}';
delete from public.athlete_seasons where season_id='${ids.season}';delete from public.athletes where id=any(${array(athletes)});delete from public.teams where id='${ids.realTeam}';delete from public.competitions where id='${ids.competition}';delete from public.sports where id='${ids.sport}';
delete from public.roster_slot_rules where ruleset_id='${ids.rules}';delete from public.scoring_rulesets where id='${ids.rules}';delete from public.fantasy_seasons where id='${ids.season}';commit;`);
  for (const id of users) {
    const response = await fetch(`${provider.origin}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: {
        apikey: config.SERVICE_ROLE_KEY,
        authorization: `Bearer ${config.SERVICE_ROLE_KEY}`,
      },
    });
    assert.equal(response.status, 200, 'Generated local Auth fixture is removed');
  }
  await new Promise((resolve) => server.close(resolve));
}
