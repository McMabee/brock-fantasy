import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const users = Array.from({ length: 4 }, () => randomUUID());
const season = randomUUID(),
  rules = randomUUID(),
  pool = randomUUID(),
  sport = randomUUID(),
  competition = randomUUID(),
  realTeam = randomUUID();
const athletes = Array.from({ length: 60 }, () => randomUUID());
const args = [
  'exec',
  '-i',
  'supabase_db_brock-fantasy',
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-q',
  '-t',
  '-A',
];
const run = (sql) =>
  execFileSync('docker', args, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const concurrent = (sql) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [],
      errors = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(Buffer.concat(out).toString('utf8'))
        : reject(
            new Error('Local concurrent command failed: ' + Buffer.concat(errors).toString('utf8')),
          ),
    );
    child.stdin.end(sql);
  });
const ids = (list) => list.map((id) => "'" + id + "'::uuid").join(',');
const actor = (user) =>
  `select set_config('request.jwt.claim.sub','${user}',true);select set_config('request.jwt.claims','${JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal1', session_id: user })}',true);`;
const setup = `begin;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)select id,id::text||'@example.test',now(),now(),jsonb_build_object('display_name','Concurrent local fixture','beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')from unnest(array[${ids(users)}])id;
insert into auth.sessions(id,user_id,aal)select id,id,'aal1' from unnest(array[${ids(users)}])id;
insert into public.fantasy_seasons(id,label,rule_version,trade_deadline)values('${season}','Concurrent local ${season}','fixture',now()+interval '1 year');
insert into public.scoring_rulesets(id,name,version,status,approved_at)values('${rules}','Concurrent local fixture',1,'approved',now());
insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
select '${rules}',slot_code,label,allowed_positions,slot_count,is_starter from public.roster_slot_rules where ruleset_id='b0000000-0000-4000-8000-000000000001';
insert into public.sports(id,code,name)values('${sport}','hockey','Local race fixture')on conflict(code)do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)select '${competition}',id,'mens','Concurrent fixture','fixture','${rules}',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name)values('${realTeam}','${competition}','Fixture','FIX');
insert into public.athletes(id,competition_id,team_id,display_name,position)select id,'${competition}','${realTeam}','Fixture player','F' from unnest(array[${ids(athletes)}])id;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,draft_eligible)select id,'${season}','${competition}','${realTeam}',array['F','D','G','BC','FC','HT','L','S'],true from unnest(array[${ids(athletes)}])id;
insert into public.player_pools(id,season_id,ruleset_id,name,is_active,rankings_approved_at)values('${pool}','${season}','${rules}','Concurrent local fixture',true,now());
insert into public.pool_competitions(pool_id,competition_id)values('${pool}','${competition}');
insert into public.pool_rankings(pool_id,athlete_id,rank,reviewed)select '${pool}',id,row_number()over(),true from unnest(array[${ids(athletes)}])id;
${actor(users[0])}
select set_config('fixture.league',(public.create_beta_league('Concurrent commands fixture','${pool}',4,'fixture-race-create','Creator team')->>'league_id'),true);
${users
  .slice(1)
  .map(
    (user) =>
      actor(user) +
      `select public.join_league((select invite_code from public.leagues where id=current_setting('fixture.league')::uuid),'Race team','fixture-race-join-${user}');`,
  )
  .join('\n')}
${actor(users[0])}
select set_config('fixture.draft',(public.start_draft(current_setting('fixture.league')::uuid,10,120,'fixture-race-start')->>'draft_id'),true);
select jsonb_build_object('draft',d.id,'league',d.league_id,'owner',t.owner_id,'team',t.id,'version',d.state_version) as race_fixture from public.drafts d join public.fantasy_teams t on t.id=d.team_order[1]where d.id=current_setting('fixture.draft')::uuid;
commit;`;
let staged = false;
try {
  const output = run(setup);
  staged = true;
  const fixture = JSON.parse(
    output.split('\n').find((line) => line.startsWith('{') && line.includes('"draft":')),
  );
  const prefix = `begin;set local statement_timeout='10s';${actor(fixture.owner)}set local role authenticated;`;
  const pick =
    prefix +
    `select public.make_draft_pick('${fixture.draft}','${athletes[0]}','fixture-concurrent-pick','manager',${fixture.version});commit;`;
  const queue =
    prefix +
    `select public.set_draft_queue('${fixture.draft}',array[${ids([athletes[0], athletes[2], athletes[1]])}],'fixture-concurrent-queue');commit;`;
  await Promise.all([concurrent(pick), concurrent(pick), concurrent(queue)]);
  const result = JSON.parse(
    run(
      `select jsonb_build_object('picks',(select count(*) from public.draft_picks where draft_id='${fixture.draft}'),'queue',(select jsonb_agg(athlete_id order by priority) from public.draft_queues where draft_id='${fixture.draft}' and fantasy_team_id='${fixture.team}'),'version',(select state_version from public.drafts where id='${fixture.draft}'));`,
    ).trim(),
  );
  assert.equal(result.picks, 1);
  assert.equal(result.version, fixture.version + 1);
  assert.deepEqual(result.queue, [athletes[2], athletes[1]]);
  console.log(
    'Independent authenticated connections passed simultaneous pick, duplicate pick and queue save: one pick, one version change, preserved queue order, no drafted athlete resurrected.',
  );
} finally {
  if (staged) {
    run(`begin;
delete from public.roster_slot_history where roster_entry_id in(select r.id from public.roster_entries r join public.leagues l on l.id=r.league_id where l.pool_id='${pool}');
delete from public.leagues where pool_id='${pool}';
delete from public.pool_rankings where pool_id='${pool}';delete from public.pool_competitions where pool_id='${pool}';delete from public.player_pools where id='${pool}';
delete from public.athlete_seasons where season_id='${season}';delete from public.athletes where id in(${ids(athletes)});delete from public.teams where id='${realTeam}';delete from public.competitions where id='${competition}';delete from public.sports where id='${sport}';
delete from public.roster_slot_rules where ruleset_id='${rules}';delete from public.scoring_rulesets where id='${rules}';delete from public.fantasy_seasons where id='${season}';
delete from public.idempotency_keys where user_id in(${ids(users)});delete from public.audit_log where actor_id in(${ids(users)});delete from auth.users where id in(${ids(users)});commit;`);
    console.log('Named local concurrency fixtures removed; no hosted connection was used.');
  }
}
