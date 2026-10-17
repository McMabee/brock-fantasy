import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { rosterPlan, rosterSql, sourceUuid } from './lib/roster-materialization.mjs';
import { schedulePlan, scheduleSql } from './lib/schedule-materialization.mjs';
import { headshotPlan, headshotSql } from './lib/headshot-materialization.mjs';
import { completeDraftRoster, legalDraftAthletes } from '../packages/domain/src/draft-room.ts';
const operator = randomUUID(),
  users = Array.from({ length: 10 }, () => randomUUID());
const manifest = await buildManifest(),
  roster = rosterPlan(manifest, operator),
  schedule = schedulePlan(manifest, operator);
const q = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const unwrapped = (sql) => sql.replace(/^begin;\r?\n/u, '').replace(/\ncommit;/gu, '');
const psql = (sql) =>
  execFileSync(
    'docker',
    [
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
    ],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 12 * 1024 * 1024 },
  );
let sql = `begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
select id,id::text||'@example.test',now(),jsonb_build_object('display_name','Public beta fixture','varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,
'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'),now(),now()
from unnest(array[${[operator, ...users].map((id) => "'" + id + "'::uuid").join(',')}]) id;
insert into auth.sessions(id,user_id,aal) select id,id,'aal1' from auth.users where id in (${[operator, ...users].map((id) => "'" + id + "'").join(',')});
insert into public.user_roles(user_id,role) values('${operator}','admin');
create function pg_temp.fixture_actor(u uuid) returns void language plpgsql as $$ begin
perform set_config('request.jwt.claim.sub',u::text,true);
perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','aal','aal1','session_id',u)::text,true);
end $$;
`;
for (const item of manifest.imports) {
  const id = sourceUuid('public-beta-fixture:' + item.revisionHash);
  sql += `insert into public.source_imports(id,source,source_hash,season_id,kind,payload,imported_by)
 values('${id}','${item.source.replaceAll("'", "''")}','${item.revisionHash}','${roster.seasonId}','${item.kind}',${q({ sourceHash: item.sourceHash, approval: { approvalId: item.approval.approvalId } })},'${operator}');
 insert into public.source_rows(import_id,row_number,source_key,raw,normalized) select '${id}',(r->>'rowNumber')::int,'${item.revisionHash}:'||(r->>'rowNumber'),r->'raw',r->'normalized' from jsonb_array_elements(${q(item.rows)})r;
 `;
}
sql += unwrapped(rosterSql(roster));
const photoSql = unwrapped(
  headshotSql(
    headshotPlan(
      manifest,
      operator,
      JSON.parse(await readFile('data/brock-headshots-2026-27.json', 'utf8')),
    ),
  ),
);
sql += photoSql + '\ndrop table approved_headshots;\n' + photoSql;
sql += `do $$ begin
 if (select count(*) from public.athletes where bio ? 'headshot')<>119 then raise exception 'Headshot count mismatch';end if;
 if (select count(*) from public.audit_log where action='headshots.materialized')<>1 then raise exception 'Headshot retry duplicated audit';end if;
end $$;\n`;
sql += unwrapped(scheduleSql(schedule));
sql += 'drop table schedule_plan,expected_games;\n' + unwrapped(scheduleSql(schedule));
sql += `do $$ begin
 if (select count(*) from public.games)<>129 or (select count(*) from public.competitions where is_active)<>6 then raise exception 'Schedule count or participant visibility mismatch'; end if;
 if (select count(*) from public.audit_log where action='schedules.materialized')<>1 then raise exception 'Duplicate schedule audit'; end if;
end $$;
update public.athlete_seasons set draft_eligible=true where season_id='${roster.seasonId}';
insert into public.pool_competitions(pool_id,competition_id)
select 'b0000000-0000-4000-8000-000000000003',id from public.competitions;
insert into public.pool_rankings(pool_id,athlete_id,rank,reviewed) select 'b0000000-0000-4000-8000-000000000003',id,row_number() over(order by display_name),true from public.athletes;
update public.player_pools set is_active=true,rankings_approved_at=now() where id='b0000000-0000-4000-8000-000000000003';
`;
for (const size of [4, 10]) {
  const draftKey = 'test.draft_' + size;
  sql += `select pg_temp.fixture_actor('${users[0]}');
select set_config('${draftKey}.league',(public.create_beta_league('Public ${size} manager rehearsal','b0000000-0000-4000-8000-000000000003',${size},'fixture-create-${size}','Creator team')->>'league_id'),true);
`;
  for (const user of users.slice(1, size))
    sql += `select pg_temp.fixture_actor('${user}');
select public.join_league((select invite_code from public.leagues where id=current_setting('${draftKey}.league')::uuid),'Manager team','fixture-join-${size}-${user}');\n`;
  sql += `select pg_temp.fixture_actor('${users[0]}');
select public.schedule_league_draft(current_setting('${draftKey}.league')::uuid,clock_timestamp()+interval '45 minutes',(select state_version from public.leagues where id=current_setting('${draftKey}.league')::uuid),'fixture-schedule-${size}');
select public.process_in_app_reminders();
select public.process_in_app_reminders();
do $$ begin
 if (select count(*) from public.notifications where kind='draft_reminder' and data->>'league_id'=current_setting('${draftKey}.league'))<>${size} then raise exception 'Draft reminder duplication'; end if;
end $$;
select public.schedule_league_draft(current_setting('${draftKey}.league')::uuid,null,(select state_version from public.leagues where id=current_setting('${draftKey}.league')::uuid),'fixture-clear-${size}');
select set_config('${draftKey}.id',(public.start_draft(current_setting('${draftKey}.league')::uuid,10,120,'fixture-start-${size}')->>'draft_id'),true);
do $$ declare snap jsonb; d public.drafts%rowtype; owner uuid; team uuid; athlete uuid; attempt jsonb; repeated jsonb; t0 timestamptz; duration numeric; longest numeric:=0; candidate record; begin
 snap:=public.get_draft_room_snapshot(current_setting('${draftKey}.id')::uuid,null,null);
 raise notice 'Snapshot metadata % bytes',octet_length(snap::text);
 if jsonb_array_length(snap->'players')<>120 then raise exception 'Missing player metadata'; end if;
 if not (public.get_draft_room_snapshot(current_setting('${draftKey}.id')::uuid,snap->>'revision',snap->>'poolRevision')->>'unchanged')::boolean then raise exception 'Unchanged poll includes data'; end if;
 raise notice 'Snapshot unchanged % bytes',octet_length(public.get_draft_room_snapshot(current_setting('${draftKey}.id')::uuid,snap->>'revision',snap->>'poolRevision')::text);
 for n in 1..${size * 10} loop
   select * into d from public.drafts where id=current_setting('${draftKey}.id')::uuid;
   team:=d.team_order[case when ((n-1)/${size}+1)%2=0 then ${size}-((n-1)%${size}) else ((n-1)%${size})+1 end];
   select owner_id into owner from public.fantasy_teams where id=team;
   perform pg_temp.fixture_actor(owner);
   if n<=${size * 10 - 10} then
     athlete:=null;
     for candidate in select a.id from public.athletes a join public.pool_rankings rank on rank.athlete_id=a.id
       where not exists(select 1 from public.draft_picks where draft_id=d.id and athlete_id=a.id)
       order by rank.rank loop
       if beta_private.draft_completion(d.league_id,candidate.id,team) is not null then athlete:=candidate.id;exit;end if;
     end loop;
     if athlete is null then raise exception 'No legal manager selection at %',n; end if;
     perform public.set_draft_queue(d.id,array[athlete],'fixture-queue-add-${size}-'||n);
     perform public.set_draft_queue(d.id,'{}','fixture-queue-remove-${size}-'||n);
     attempt:=public.make_draft_pick(d.id,athlete,'fixture-pick-${size}-'||n,'manager',d.state_version);
     repeated:=public.make_draft_pick(d.id,athlete,'fixture-pick-${size}-'||n,'manager',d.state_version);
     if attempt<>repeated then raise exception 'Duplicate pick response changed'; end if;
     perform public.set_draft_queue(d.id,array[athlete],'fixture-queue-stale-${size}-'||n);
     if exists(select 1 from public.draft_queues where draft_id=d.id and athlete_id=athlete) then raise exception 'Stale queue resurrected drafted athlete'; end if;
   else
     update public.drafts set pick_deadline=clock_timestamp()-interval '1 second' where id=d.id;
     t0:=clock_timestamp();attempt:=public.process_expired_drafts(25);duration:=extract(epoch from clock_timestamp()-t0);longest:=greatest(longest,duration);
     if (attempt->>'processed')::int<>1 then raise exception 'Autopick failed at %',n; end if;
     if duration>=15 then raise exception 'Autopick exceeded interval: % seconds',duration; end if;
   end if;
 end loop;
 if (select status from public.drafts where id=d.id)<>'complete' then raise exception 'Draft did not complete'; end if;
 if (select count(*) from public.draft_picks where draft_id=d.id)<>${size * 10} then raise exception 'Pick count mismatch'; end if;
 if exists(select 1 from public.fantasy_teams t where t.league_id=d.league_id and (select count(*) from public.roster_entries where fantasy_team_id=t.id and released_at is null)<>10) then raise exception 'Illegal roster size'; end if;
 if beta_private.draft_completion(d.league_id) is null then raise exception 'Completed rosters not legal'; end if;
 perform set_config('${draftKey}.slowest',longest::text,true);
end $$;
select jsonb_build_object('managers',${size},'slowestLateAutopickSeconds',current_setting('${draftKey}.slowest')::numeric) as draft_performance;
`;
}
// Matching parity across scarce positions, flexible players, mandatory owners and infeasible states.
sql += `do $$ declare athlete uuid; program uuid; brock uuid; game uuid; cancelled uuid; count_before integer;
 preview_league uuid; preview_draft uuid; invite text; member uuid; trade uuid; team_one uuid; team_two uuid; begin
 perform pg_temp.fixture_actor('${operator}');
 preview_league:=(public.create_beta_league('Queued-only reminder fixture','b0000000-0000-4000-8000-000000000003',4,'fixture-preview-only-create','Queue-only team')->>'league_id')::uuid;
 select invite_code into invite from public.leagues where id=preview_league;
 foreach member in array array['${users[0]}'::uuid,'${users[1]}','${users[2]}']loop
   perform pg_temp.fixture_actor(member);perform public.join_league(invite,'Preview member','preview-join-'||member);end loop;
 perform pg_temp.fixture_actor('${operator}');
 preview_draft:=(public.start_draft(preview_league,10,120,'fixture-preview-only-start')->>'draft_id')::uuid;
 select r.athlete_id into athlete from public.roster_entries r join public.fantasy_teams t on t.id=r.fantasy_team_id
 where t.owner_id='${users[0]}' and r.status='bench' limit 1;
 select competition_id,team_id into program,brock from public.athlete_seasons where athlete_id=athlete;
 perform public.set_draft_queue(preview_draft,array[athlete],'fixture-preview-only-queue');
 select id into game from public.games where competition_id=program limit 1;
 select id into cancelled from public.games where competition_id=program and id<>game limit 1;
 update public.games set status='scheduled',starts_at=clock_timestamp()+interval '45 minutes' where id=game;
 update public.games set status='cancelled',starts_at=clock_timestamp()+interval '30 minutes' where id=cancelled;
 perform public.process_in_app_reminders();perform public.process_in_app_reminders();
 if (select count(*) from public.notifications where kind='game_reminder' and user_id='${users[0]}' and data->>'game_id'=game::text)<>1 then raise exception 'Bench game reminders missing or duplicated';end if;
 if exists(select 1 from public.notifications where kind='game_reminder' and data->>'game_id'=cancelled::text)then raise exception 'Cancelled game reminder';end if;
 if exists(select 1 from public.notifications where kind='game_reminder' and user_id='${operator}')then raise exception 'Queue preview generated game reminder';end if;
 if exists(select 1 from public.notifications where kind='game_reminder' and data->>'game_id'=game::text and not (data ? 'league_id'))then raise exception 'Reminder action has no league';end if;
 update public.games set starts_at=clock_timestamp()+interval '2 hours' where id=game;
 select count(*) into count_before from public.notifications where kind='game_reminder';
 perform public.process_in_app_reminders();
 if (select count(*) from public.notifications where kind='game_reminder')<>count_before then raise exception 'Obsolete rescheduled reminder';end if;
 if exists(select 1 from public.notifications where kind='game_reminder' and data->>'game_id'=game::text and data->>'obsolete' is distinct from 'true')then raise exception 'Old reminder still current';end if;
 select id into team_one from public.fantasy_teams where league_id=current_setting('test.draft_4.league')::uuid and owner_id='${users[0]}';
 select id into team_two from public.fantasy_teams where league_id=current_setting('test.draft_4.league')::uuid and owner_id='${users[1]}';
 insert into public.trades(league_id,proposing_team_id,receiving_team_id,expires_at)
 values(current_setting('test.draft_4.league')::uuid,team_one,team_two,clock_timestamp()+interval '1 day')returning id into trade;
 update public.trades set status='accepted' where id=trade;
 update public.trades set execution_status='completed' where id=trade;
 update public.trades set execution_status='completed' where id=trade;
 if (select count(*) from public.notifications where data->>'trade_id'=trade::text)<>6 then raise exception 'Trade lifecycle notifications missing or duplicated';end if;
end $$;\n`;
let seed = 17;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
for (let i = 0; i < 80; i++) {
  const slots = Array.from({ length: 6 }, (_, s) => ({
    teamId: s < 3 ? 'one' : 'two',
    code: String(s),
    positions: s % 3 === 0 ? ['F'] : s % 3 === 1 ? ['D'] : ['F', 'D', 'S'],
  }));
  const candidates = Array.from({ length: 8 }, (_, a) => ({
    id: 'player' + a,
    positions: rand() < 0.25 ? ['F', 'D'] : [['F', 'D', 'S'][Math.floor(rand() * 3)]],
    ownerId: rand() < 0.5 ? null : rand() < 0.5 ? 'one' : 'two',
  }));
  const result = completeDraftRoster(candidates, slots);
  const sqlCandidates = candidates.map(({ id, positions, ownerId }) => ({
    id,
    positions,
    owner: ownerId,
  }));
  const sqlSlots = slots.map(({ teamId, code, positions }) => ({ team: teamId, code, positions }));
  sql += `do $$ begin if (beta_private.complete_draft_graph(${q(sqlCandidates)},${q(sqlSlots)}) is not null)<>${result !== null} then raise exception 'Matching parity failed case ${i}'; end if;end $$;\n`;
}
sql += `do $$ declare team uuid; owner uuid; league uuid; starter uuid; reserve uuid; version bigint; assignments jsonb; result jsonb; begin
  for team,owner,league in select t.id,t.owner_id,t.league_id from public.fantasy_teams t loop
    if not exists(select 1 from public.roster_entries where fantasy_team_id=team and slot_code='FLEX') then continue; end if;
    perform pg_temp.fixture_actor(owner);
    select athlete_id into starter from public.roster_entries where fantasy_team_id=team and slot_code='FLEX' and released_at is null;
    select athlete_id into reserve from public.roster_entries where fantasy_team_id=team and slot_code='BN' and released_at is null order by athlete_id limit 1;
    select state_version into version from public.leagues where id=league;
    select jsonb_agg(jsonb_build_object('athlete_id',athlete_id,'slot_code',case when athlete_id=starter then 'BN' when athlete_id=reserve then 'FLEX' else slot_code end))
      into assignments from public.roster_entries where fantasy_team_id=team and released_at is null;
    result:=public.set_period_lineup(team,assignments,version,'full-lineup-'||team);
    if result<>public.set_period_lineup(team,assignments,version,'full-lineup-'||team) then raise exception 'Full lineup retry changed response'; end if;
    if not exists(select 1 from public.roster_entries where fantasy_team_id=team and athlete_id=reserve and slot_code='FLEX') then raise exception 'Full lineup swap did not persist'; end if;
    begin
      perform public.set_period_lineup(team,assignments,version,'stale-lineup-'||team);
      raise exception 'Stale lineup unexpectedly succeeded';
    exception when serialization_failure then null; end;
  end loop;
end $$;
do $$ declare league uuid; first_team uuid; second_team uuid; first_athlete uuid; second_athlete uuid;
  old_entry uuid; trade uuid; locked_athlete uuid; locked_slot text; comp uuid; brock uuid; opponent uuid;
  live_game uuid; delayed_game uuid; before_trade timestamptz; result jsonb;
begin
  league:=current_setting('test.draft_4.league')::uuid;
  if not exists(select 1 from public.roster_entries where league_id=league and slot_code='FLEX') then return; end if;
  select id into first_team from public.fantasy_teams where league_id=league order by draft_position limit 1;
  select id into second_team from public.fantasy_teams where league_id=league and id<>first_team order by draft_position limit 1;
  select id,athlete_id into old_entry,first_athlete from public.roster_entries where fantasy_team_id=first_team and released_at is null and slot_code='HK_F';
  select athlete_id into second_athlete from public.roster_entries where fantasy_team_id=second_team and released_at is null and slot_code='HK_F';
  select r.athlete_id,r.slot_code,a.competition_id,a.team_id into locked_athlete,locked_slot,comp,brock
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id where r.fantasy_team_id=first_team and r.released_at is null and r.slot_code='BB_BC';
  select id into opponent from public.teams where competition_id=comp and id<>brock order by id limit 1;
  insert into public.games(competition_id,home_team_id,away_team_id,starts_at,status)
    values(comp,brock,opponent,clock_timestamp()-interval '1 minute','in_progress') returning id into live_game;
  if not beta_private.is_locked(league,locked_athlete) then raise exception 'Unrelated trade fixture must be locked'; end if;
  before_trade:=clock_timestamp();
  insert into public.trades(league_id,proposing_team_id,receiving_team_id,status,expires_at,review_ends_at,execution_status)
    values(league,first_team,second_team,'accepted',clock_timestamp()+interval '1 day',clock_timestamp()-interval '1 minute','review') returning id into trade;
  insert into public.trade_items(trade_id,from_team_id,to_team_id,athlete_id) values
    (trade,first_team,second_team,first_athlete),(trade,second_team,first_team,second_athlete);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  result:=public.process_due_trades(league);
  if (result->>'completed')::int<>1 then raise exception 'Trade blocked by an unrelated active game: %',result; end if;
  if not exists(select 1 from public.roster_entries where id=old_entry and fantasy_team_id=first_team and released_at is not null)
    or not exists(select 1 from public.roster_entries where athlete_id=first_athlete and fantasy_team_id=second_team and released_at is null and acquired_at>before_trade) then raise exception 'Trade did not preserve ownership intervals'; end if;
  if not exists(select 1 from public.roster_entries where athlete_id=locked_athlete and fantasy_team_id=first_team and released_at is null and slot_code=locked_slot) then raise exception 'Trade moved an unrelated locked athlete'; end if;
  if exists(select fantasy_team_id from public.roster_entries where fantasy_team_id in(first_team,second_team) and released_at is null
    group by fantasy_team_id having count(*)<>10 or count(*) filter(where status='starter')<>7 or count(*) filter(where slot_code='BN')<>3) then raise exception 'Trade broke FLEX roster capacities'; end if;
  update public.games set status='final' where id=live_game;
  update public.fantasy_periods set starts_at=before_trade-interval '1 hour' where number=1;
  select competition_id,team_id into comp,brock from public.athletes where id=first_athlete;
  select id into opponent from public.teams where competition_id=comp and id<>brock order by id limit 1;
  insert into public.games(competition_id,home_team_id,away_team_id,starts_at,status)
    values(comp,brock,opponent,before_trade,'final') returning id into delayed_game;
  perform beta_private.snapshot_locks(league);
  if not exists(select 1 from public.game_lineup_snapshots where game_id=delayed_game and athlete_id=first_athlete and fantasy_team_id=first_team)
    or exists(select 1 from public.game_lineup_snapshots where game_id=delayed_game and athlete_id=first_athlete and fantasy_team_id=second_team) then raise exception 'Late fixture credited post-trade owner'; end if;
end $$;
rollback;select 'public-beta-rehearsal-passed';`;
await mkdir('dev/tmp/public-beta-rehearsal', { recursive: true });
await writeFile('dev/tmp/public-beta-rehearsal/rehearsal.sql', sql);
if (process.env.BROCK_PUBLIC_BETA_EMIT_ONLY === '1') {
  console.log('Generated rollback-only public beta rehearsal for an isolated migration runner');
  process.exit(0);
}
const begin = performance.now();
let output;
try {
  output = psql(sql);
} catch (error) {
  console.error(error.stderr?.toString().slice(-4500));
  throw new Error('Public beta local rehearsal failed; transaction rolled back.');
}
assert.match(output, /public-beta-rehearsal-passed/u);
const lockChild = spawn(
  'docker',
  [
    'exec',
    '-i',
    'supabase_db_brock-fantasy',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-q',
    '-t',
    '-A',
  ],
  {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  },
);
const lockDone = new Promise((resolve, reject) => {
  lockChild.on('error', () => reject(new Error('Worker lock fixture could not start')));
  lockChild.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('Worker lock fixture failed')),
  );
});
lockChild.stdin.end(
  "begin;set application_name='brock-worker-overlap-fixture';select pg_advisory_xact_lock(hashtextextended('brock-draft-worker',0));select pg_sleep(3);rollback;",
);
let holding = false;
for (let tries = 0; tries < 20; tries++) {
  holding =
    psql(
      "select exists(select 1 from pg_stat_activity where application_name='brock-worker-overlap-fixture' and wait_event='PgSleep');",
    ).trim() === 't';
  if (holding) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(holding, true, 'independent worker fixture acquired its lock');
assert.equal(
  JSON.parse(psql('select public.process_expired_drafts(25);').trim()).busy,
  true,
  'overlapping worker exits without processing',
);
await lockDone;
const draftMetrics = output
  .split('\n')
  .filter((line) => line.startsWith('{"managers"'))
  .map((line) => JSON.parse(line));
const slots = Array.from({ length: 10 }, (_, t) =>
  Array.from({ length: 10 }, (_, s) => ({
    teamId: 'team' + t,
    code: String(s),
    positions:
      s === 0
        ? ['F']
        : s === 1
          ? ['D', 'G']
          : s === 2
            ? ['BC']
            : s === 3
              ? ['FC']
              : s === 4
                ? ['HT']
                : s === 5
                  ? ['L', 'S']
                  : ['F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S'],
  })),
).flat();
const candidates = roster.players.map((p) => ({ id: p.id, positions: p.positions, ownerId: null }));
const timing = performance.now();
assert.ok(legalDraftAthletes(candidates, slots, 'team0').length);
console.log(
  JSON.stringify({
    result: 'passed',
    schedules: 129,
    programs: 6,
    matchingParityCases: 80,
    completeDrafts: [4, 10],
    lateAutopicks: 20,
    workerOverlap: 'independent connections passed',
    draftMetrics,
    legalIds120Athletes100SlotsMs: Math.round(performance.now() - timing),
    transactionMs: Math.round(performance.now() - begin),
    fixtureWrites: 'rolled back',
  }),
);
