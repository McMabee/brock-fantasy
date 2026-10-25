import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'pgsql-parser';

// - Keep production evidence in the private recovery directory
// - Make every mutation atomic and bound to the reviewed league
const exec = promisify(execFile);
const project = 'fdovowiihxowzatewxgv';
const leagueId = 'd17cd308-6d8b-4068-b5e0-701e2daa4c26';
const version = '20261025135300';
const name = 'late_league_entry_periods';
const privateRoot = 'D:/Brock Fantasy/Private';
const directory = path.join(privateRoot, 'late-league-entry-recovery-20261025');
const mode = process.argv[2];
assert.ok(
  [
    '--capture',
    '--apply-schema',
    '--apply-compatible',
    '--preview',
    '--recover',
    '--verify',
  ].includes(mode),
);
await mkdir(directory, { recursive: true });

const desired = JSON.parse(await readFile(path.join(directory, 'roster-manifest.json'), 'utf8'));
assert.ok(Array.isArray(desired));
for (const entry of desired) {
  assert.ok(
    Array.isArray(entry) && entry.length === 3 && entry.every((value) => typeof value === 'string'),
  );
  assert.ok(['HK_F', 'HK_DG', 'BB_BC', 'BB_FC', 'VB_HT', 'VB_LS', 'FLEX'].includes(entry[2]));
}
assert.equal(
  new Set(desired.map(([email, athlete]) => `${email}\u0000${athlete}`)).size,
  desired.length,
);
assert.equal(new Set(desired.map(([email]) => email)).size, 7);
assert.equal(desired.length, 49);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const desiredValues = desired
  .map(([email, athlete, slot]) => `(${quote(email)},${quote(athlete)},${quote(slot)})`)
  .join(',');
const content = await readFile(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const timestamp = (value) => {
  const parsed = Date.parse(String(value).replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:?\d{2}$)/u, '$1'));
  assert.ok(Number.isFinite(parsed), 'Expected an ISO timestamp');
  return parsed;
};

async function query(source, label) {
  await parse(source);
  const file = path.join(directory, `${label}.sql`);
  await writeFile(file, source, { mode: 0o600 });
  let response;
  try {
    response = await exec(
      process.execPath,
      [
        'node_modules/supabase/dist/supabase.js',
        'db',
        'query',
        '--linked',
        '--project-ref',
        project,
        '--file',
        file,
        '-o',
        'json',
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    await writeFile(
      path.join(directory, `${label}-error.log`),
      String(error.stderr ?? error.message),
      { mode: 0o600 },
    );
    throw new Error(
      `Production operation failed and private diagnostics were retained for ${label}`,
    );
  }
  const result = JSON.parse(response.stdout);
  await writeFile(path.join(directory, `${label}.json`), JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  assert.ok(Array.isArray(result.rows));
  return result.rows.at(-1)?.evidence;
}

async function backupGate() {
  const [backup, restore] = await Promise.all([
    readFile(path.join(privateRoot, 'last-backup-receipt.json'), 'utf8').then(JSON.parse),
    readFile(path.join(privateRoot, 'last-database-restore-offsite.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(backup.projectRef, project);
  assert.ok(Date.now() - timestamp(backup.capturedAt) < 86400000);
  assert.ok(backup.encrypted && backup.offsiteVerified && backup.restoredExportHashesVerified);
  assert.ok(backup.offsiteRestoredExportHashesVerified);
  assert.equal(restore.snapshotId, backup.offsiteSnapshotId);
  assert.ok(
    restore.databaseRestored && restore.exportsHashVerified && restore.offsiteRecoveryVerified,
  );
  assert.ok(
    restore.cleanupVerified && timestamp(restore.startedAt) >= timestamp(backup.capturedAt),
  );
}

const metadata = `select jsonb_build_object(
  'capturedAt',clock_timestamp(),
  'activeDrafts',(select count(*)from public.drafts where status='active'and voided_at is null),
  'migrationInstalled',(select exists(select 1 from supabase_migrations.schema_migrations where version=${quote(version)})),
  'league',(select jsonb_build_object(
    'id',l.id,'name',l.name,'stateVersion',l.state_version,'poolId',l.pool_id,
    'drafts',(select count(*)from public.drafts d where d.league_id=l.id and d.voided_at is null),
    'completeDrafts',(select count(*)from public.drafts d where d.league_id=l.id and d.status='complete'and d.voided_at is null),
    'draftPicks',(select count(*)from public.draft_picks d join public.drafts x on x.id=d.draft_id where x.league_id=l.id and x.voided_at is null),
    'matchups',(select count(*)from public.matchups m where m.league_id=l.id),
    'snapshots',(select count(*)from public.game_lineup_snapshots x where x.league_id=l.id),
    'snapshotPeriods',(select coalesce(jsonb_agg(distinct f.number),'[]'::jsonb)from public.game_lineup_snapshots x join public.fantasy_periods f on f.id=x.period_id where x.league_id=l.id),
    'pointEvents',(select count(*)from public.fantasy_point_events x where x.league_id=l.id),
    'lineupEntries',(select count(*)from public.lineup_entries x where x.league_id=l.id)
  )from public.leagues l where l.id=${quote(leagueId)}::uuid),
  'roster',(select coalesce(jsonb_agg(jsonb_build_object('email',u.email,'team',t.id,'athlete',a.display_name,'slot',r.slot_code,'status',r.status)order by u.email,a.display_name),'[]'::jsonb)
    from public.fantasy_teams t join auth.users u on u.id=t.owner_id join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null join public.athletes a on a.id=r.athlete_id where t.league_id=${quote(leagueId)}::uuid)
)evidence;`;

if (mode === '--capture') {
  const evidence = await query(`begin transaction read only;${metadata}commit;`, 'before');
  assert.equal(evidence.activeDrafts, 0);
  assert.equal(evidence.league.drafts, 1);
  assert.equal(evidence.league.completeDrafts, 1);
  assert.equal(evidence.league.draftPicks, 80);
  assert.equal(evidence.league.matchups, 24);
  assert.equal(evidence.league.pointEvents, 0);
  assert.deepEqual(evidence.league.snapshotPeriods, [1]);
  assert.equal(evidence.roster.length, 80);
  console.log(JSON.stringify({ league: evidence.league, rosterEntries: evidence.roster.length }));
} else if (mode === '--apply-compatible') {
  await backupGate();
  const files = [
    '20261024175608_privacy_accessibility_foundation.sql',
    '20261024180355_scheduled_automatic_drafts.sql',
    '20261024233234_bounded_retention_and_email_dispatch.sql',
    '20261025185510_league_creation_context_statement_clock.sql',
  ];
  for (const file of files) {
    const migration = await readFile(path.join('supabase/migrations', file), 'utf8');
    const migrationVersion = file.slice(0, 14);
    const migrationName = file.slice(15, -4);
    const installed = await query(
      `select jsonb_build_object('installed',exists(select 1 from supabase_migrations.schema_migrations where version=${quote(migrationVersion)}),'matches',coalesce((select statements=array[${quote(migration)}]from supabase_migrations.schema_migrations where version=${quote(migrationVersion)}),false))evidence;`,
      'compatible-installed-' + migrationVersion,
    );
    if (installed.installed) {
      assert.ok(installed.matches);
      continue;
    }
    await query(
      `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
      lock table public.drafts in share mode nowait;
      do $$begin if exists(select 1 from public.drafts where status='active'and voided_at is null)then raise exception 'Active draft blocks rollout';end if;end$$;
      create function pg_temp.compatible_fingerprint()returns jsonb language plpgsql set search_path=''as $$
      declare relation record;item jsonb;result jsonb:='{}';ignored text[];begin
        for relation in select schemaname,tablename from pg_tables where schemaname in('public','beta_private','registration_private')order by 1,2 loop
          ignored:=case relation.tablename when 'leagues'then array['draft_mode','draft_setup_state','draft_block_reason','draft_last_processed_at','draft_retry_at','draft_attempts','state_version','updated_at']when 'drafts'then array['mode']when 'player_pools'then array['state_version']when 'fantasy_seasons'then array['finalized_at']when 'release_controls'then array['fresh_command_keys_required']else '{}'::text[]end;
          execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(md5(value::text),'''' order by value::text),'''')))from(select to_jsonb(t)-%L::text[] value from %I.%I t)x',ignored,relation.schemaname,relation.tablename)into item;
          result:=result||jsonb_build_object(relation.schemaname||'.'||relation.tablename,item);
        end loop;return result;end$$;
      select set_config('compatible.before',pg_temp.compatible_fingerprint()::text,true);
      ${migration}
      do $$declare after_state jsonb:=pg_temp.compatible_fingerprint();prior record;begin
        for prior in select key,value from jsonb_each(current_setting('compatible.before')::jsonb)loop
          if after_state->prior.key is distinct from prior.value then raise exception 'Migration changed protected data in %',prior.key;end if;
        end loop;
      end$$;
      insert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(migrationVersion)},${quote(migrationName)},array[${quote(migration)}]);
      select jsonb_build_object('migration',${quote(migrationVersion)},'protectedDataUnchanged',true)evidence;commit;`,
      'compatible-applied-' + migrationVersion,
    );
    console.log('Applied compatible migration ' + migrationVersion);
  }
  const controls = await query(
    'select to_jsonb(c)evidence from beta_private.release_controls c;',
    'release-controls',
  );
  assert.ok(
    Object.entries(controls)
      .filter(([key]) => key !== 'singleton')
      .every(([, value]) => value === false),
  );
  console.log('Verified all optional release controls remain disabled');
} else if (mode === '--apply-schema') {
  await backupGate();
  const installed = await query(
    `select jsonb_build_object('installed',exists(select 1 from supabase_migrations.schema_migrations where version=${quote(version)}),'matches',coalesce((select name=${quote(name)}and statements=array[${quote(content)}]from supabase_migrations.schema_migrations where version=${quote(version)}),false))evidence;`,
    'schema-installed',
  );
  if (!installed.installed) {
    await query(
      `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
      lock table public.drafts in share mode nowait;
      do $$begin if exists(select 1 from public.drafts where status='active'and voided_at is null)then raise exception 'Active draft blocks rollout';end if;end$$;
      ${content}
      insert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(version)},${quote(name)},array[${quote(content)}]);
      select jsonb_build_object('migration',${quote(version)},'leagueEntryPeriods',(select count(*)from public.leagues where first_scoring_period_id is not null))evidence;commit;`,
      'schema-applied',
    );
  } else assert.ok(installed.matches, 'Installed migration differs from the reviewed source');
  const after = await query(`begin transaction read only;${metadata}commit;`, 'after-schema');
  assert.equal(after.activeDrafts, 0);
  assert.equal(after.league.draftPicks, 80);
  assert.equal(after.league.matchups, 24);
  assert.equal(after.league.pointEvents, 0);
  assert.deepEqual(after.league.snapshotPeriods, [1]);
  console.log(JSON.stringify({ migration: version, league: after.league }));
} else if (mode === '--recover' || mode === '--preview') {
  await backupGate();
  const before = JSON.parse(await readFile(path.join(directory, 'before.json'), 'utf8')).rows.at(
    -1,
  )?.evidence;
  assert.ok(before, 'Run --capture before recovery');
  assert.ok(Date.now() - timestamp(before.capturedAt) < 2 * 60 * 60 * 1000, 'Capture is too old');
  const recovered = await query(
    `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
    lock table public.drafts in share mode nowait;
    select beta_private.league_lock(${quote(leagueId)}::uuid);
    select set_config('recovery.before_roster',(select coalesce(jsonb_agg(jsonb_build_object('email',u.email,'athlete',a.display_name,'slot',r.slot_code,'status',r.status)order by u.email,a.display_name),'[]'::jsonb)::text from public.fantasy_teams t join auth.users u on u.id=t.owner_id join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null join public.athletes a on a.id=r.athlete_id where t.league_id=${quote(leagueId)}::uuid),true);
    create temp table desired_lineup(email text not null,athlete_name text not null,slot_code text not null,primary key(email,athlete_name))on commit drop;
    insert into desired_lineup(email,athlete_name,slot_code)values${desiredValues};
    create temp table recovery_protected on commit drop as
      select 'drafts'kind,to_jsonb(d)row from public.drafts d where league_id=${quote(leagueId)}::uuid
      union all select 'picks',to_jsonb(p)from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=${quote(leagueId)}::uuid
      union all select 'roster',to_jsonb(r)-array['slot_code','status','updated_at']from public.roster_entries r where league_id=${quote(leagueId)}::uuid
      union all select 'matchups',to_jsonb(m)from public.matchups m where league_id=${quote(leagueId)}::uuid
      union all select 'teams',to_jsonb(t)from public.fantasy_teams t where league_id=${quote(leagueId)}::uuid;
    do $$begin
      if not exists(select 1 from supabase_migrations.schema_migrations where version=${quote(version)})then raise exception 'Late-entry migration is not installed';end if;
      if exists(select 1 from public.drafts where status='active'and voided_at is null)then raise exception 'Active draft blocks recovery';end if;
      if (select state_version from public.leagues where id=${quote(leagueId)}::uuid)<>${Number(before.league.stateVersion)} then raise exception 'League changed after the reviewed capture'using errcode='PT409';end if;
      if (select count(*)from public.fantasy_point_events where league_id=${quote(leagueId)}::uuid)<>0 then raise exception 'Existing scoring state blocks recovery';end if;
      if exists(select 1 from public.game_lineup_snapshots x join public.fantasy_periods f on f.id=x.period_id where x.league_id=${quote(leagueId)}::uuid and f.number<>1)then raise exception 'Only unscored Week 1 snapshots can be replaced';end if;
      if (select count(*)from public.roster_entries where league_id=${quote(leagueId)}::uuid and released_at is null)<>80 then raise exception 'Expected 80 active roster entries';end if;
      if (select count(*)from desired_lineup d join auth.users u on u.email=d.email join public.fantasy_teams t on t.owner_id=u.id and t.league_id=${quote(leagueId)}::uuid join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null join public.athletes a on a.id=r.athlete_id and a.display_name=d.athlete_name)<>49 then raise exception 'Reviewed roster manifest no longer matches league ownership';end if;
    end$$;
    update public.roster_entries r set slot_code=d.slot_code,status='starter'::public.roster_status
    from public.fantasy_teams t,auth.users u,public.athletes a,desired_lineup d
    where r.fantasy_team_id=t.id and t.league_id=${quote(leagueId)}::uuid and r.released_at is null and u.id=t.owner_id and a.id=r.athlete_id
      and d.email=u.email and d.athlete_name=a.display_name and (r.slot_code,r.status) is distinct from (d.slot_code,'starter'::public.roster_status);
    update public.roster_entries r set slot_code='BN',status='bench'::public.roster_status
    from public.fantasy_teams t,auth.users u,public.athletes a
    where r.fantasy_team_id=t.id and t.league_id=${quote(leagueId)}::uuid and r.released_at is null and u.id=t.owner_id and a.id=r.athlete_id
      and exists(select 1 from desired_lineup d where d.email=u.email)
      and not exists(select 1 from desired_lineup d where d.email=u.email and d.athlete_name=a.display_name)
      and (r.slot_code,r.status) is distinct from ('BN','bench'::public.roster_status);
    do $$begin
      if exists(select 1 from public.fantasy_teams t join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null where t.league_id=${quote(leagueId)}::uuid group by t.id having count(*)filter(where r.status='starter')<>7 or count(*)filter(where r.status='bench')<>3)then raise exception 'Recovery did not produce seven starters and three bench players for every team';end if;
      if exists(select 1 from public.fantasy_teams t join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null and r.status='starter' where t.league_id=${quote(leagueId)}::uuid group by t.id,r.slot_code having count(*)<>1)then raise exception 'Recovery produced duplicate starter slots';end if;
      if exists(select 1 from public.roster_entries r join public.leagues l on l.id=r.league_id join public.player_pools p on p.id=l.pool_id join public.athlete_seasons a on a.athlete_id=r.athlete_id and a.season_id=p.season_id join public.roster_slot_rules rule on rule.ruleset_id=l.ruleset_id and rule.slot_code=r.slot_code where r.league_id=${quote(leagueId)}::uuid and r.released_at is null and not(a.positions&&rule.allowed_positions))then raise exception 'Recovery contains an illegal slot assignment';end if;
      if (select count(*)from desired_lineup d join auth.users u on u.email=d.email join public.fantasy_teams t on t.owner_id=u.id and t.league_id=${quote(leagueId)}::uuid join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null join public.athletes a on a.id=r.athlete_id and a.display_name=d.athlete_name where r.slot_code=d.slot_code and r.status='starter')<>49 then raise exception 'Recovered starters differ from the approved manifest';end if;
    end$$;
    update public.leagues l set first_scoring_period_id=f.id,state_version=l.state_version+1 from public.player_pools p join public.fantasy_periods f on f.season_id=p.season_id and f.number=1 and f.phase='regular' where l.id=${quote(leagueId)}::uuid and p.id=l.pool_id;
    select beta_private.ensure_matchup_schedule(${quote(leagueId)}::uuid);
    delete from public.lineup_entries e using public.games g,public.leagues l,public.player_pools p,public.fantasy_periods f where e.game_id=g.id and e.league_id=l.id and l.id=${quote(leagueId)}::uuid and p.id=l.pool_id and f.season_id=p.season_id and f.number=1 and g.starts_at>=f.starts_at and g.starts_at<f.ends_at;
    delete from public.game_lineup_snapshots x using public.fantasy_periods f where x.league_id=${quote(leagueId)}::uuid and f.id=x.period_id and f.number=1;
    insert into public.game_lineup_snapshots(league_id,fantasy_team_id,game_id,athlete_id,roster_entry_id,period_id,slot_code,status,locked_at)
    select l.id,r.fantasy_team_id,g.id,r.athlete_id,r.id,f.id,r.slot_code,r.status,g.lineup_lock_at
    from public.leagues l join public.player_pools p on p.id=l.pool_id join public.fantasy_periods f on f.season_id=p.season_id and f.number=1 and f.phase='regular'
    join public.games g on g.starts_at>=f.starts_at and g.starts_at<f.ends_at and g.lineup_lock_at<=clock_timestamp() and g.status not in('postponed','cancelled')and g.schedule_kind in('regular','playoff')
    join public.athlete_seasons membership on membership.season_id=p.season_id and membership.competition_id=g.competition_id and membership.team_id in(g.home_team_id,g.away_team_id)
    join public.roster_entries r on r.league_id=l.id and r.athlete_id=membership.athlete_id and r.released_at is null
    where l.id=${quote(leagueId)}::uuid and beta_private.can_field_athlete(r.fantasy_team_id,r.athlete_id,g.lineup_lock_at)
    on conflict do nothing;
    insert into public.lineup_entries(league_id,fantasy_team_id,game_id,athlete_id,slot_code,locked_at)
    select league_id,fantasy_team_id,game_id,athlete_id,slot_code,locked_at from public.game_lineup_snapshots where league_id=${quote(leagueId)}::uuid and status='starter' on conflict do nothing;
    do $$begin
      if exists(select 1 from recovery_protected original where not exists(
        select 1 from (
          select 'drafts'kind,to_jsonb(d)row from public.drafts d where league_id=${quote(leagueId)}::uuid
          union all select 'picks',to_jsonb(p)from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=${quote(leagueId)}::uuid
          union all select 'roster',to_jsonb(r)-array['slot_code','status','updated_at']from public.roster_entries r where league_id=${quote(leagueId)}::uuid
          union all select 'matchups',to_jsonb(m)from public.matchups m where league_id=${quote(leagueId)}::uuid
          union all select 'teams',to_jsonb(t)from public.fantasy_teams t where league_id=${quote(leagueId)}::uuid
        )current where (current.kind,current.row)=(original.kind,original.row)
      ))then raise exception 'Recovery changed protected ownership, draft history or existing matchups';end if;
      if (select count(*)from public.matchups where league_id=${quote(leagueId)}::uuid)<>28 or (select count(*)from public.matchups where league_id=${quote(leagueId)}::uuid and period=1)<>4 then raise exception 'Week 1 recovery schedule was not created';end if;
      if (select count(*)from public.game_lineup_snapshots where league_id=${quote(leagueId)}::uuid)=0 then raise exception 'Week 1 recovery snapshots were not created';end if;
    end$$;
    select beta_private.audit('league.roster_recovered','league',${quote(leagueId)},current_setting('recovery.before_roster')::jsonb,jsonb_build_object('first_scoring_period',1,'manifest_entries',49,'week_one_matchups',4),'operator-recovery-20261025');
    select jsonb_build_object('stateVersion',(select state_version from public.leagues where id=${quote(leagueId)}::uuid),'draftPicks',(select count(*)from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=${quote(leagueId)}::uuid and d.voided_at is null),'matchups',(select count(*)from public.matchups where league_id=${quote(leagueId)}::uuid),'weekOneMatchups',(select count(*)from public.matchups where league_id=${quote(leagueId)}::uuid and period=1),'snapshots',(select count(*)from public.game_lineup_snapshots where league_id=${quote(leagueId)}::uuid),'pointEvents',(select count(*)from public.fantasy_point_events where league_id=${quote(leagueId)}::uuid))evidence;${mode === '--preview' ? 'rollback' : 'commit'};`,
    mode === '--preview' ? 'preview' : 'recovered',
  );
  assert.equal(recovered.draftPicks, 80);
  assert.equal(recovered.matchups, 28);
  assert.equal(recovered.weekOneMatchups, 4);
  assert.ok(recovered.snapshots > 0);
  assert.equal(recovered.pointEvents, 0);
  console.log(JSON.stringify(recovered));
} else {
  const verified = await query(
    `begin transaction read only;select jsonb_build_object(
      'migrationMatches',coalesce((select name=${quote(name)}and statements=array[${quote(content)}]from supabase_migrations.schema_migrations where version=${quote(version)}),false),
      'activeDrafts',(select count(*)from public.drafts where status='active'and voided_at is null),
      'manifestStarters',(select count(*)from (values ${desiredValues})d(email,athlete_name,slot_code)join auth.users u on u.email=d.email join public.fantasy_teams t on t.owner_id=u.id and t.league_id=${quote(leagueId)}::uuid join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null join public.athletes a on a.id=r.athlete_id and a.display_name=d.athlete_name where r.slot_code=d.slot_code and r.status='starter'),
      'scoringPaused',(select p.scoring_paused from public.leagues l join public.player_pools p on p.id=l.pool_id where l.id=${quote(leagueId)}::uuid),
      'stableContextClock',(select position('clock_timestamp()'in pg_get_functiondef('rpc_private.get_league_creation_context()'::regprocedure))=0),
      'league',(select jsonb_build_object('firstPeriod',f.number,'draftPicks',(select count(*)from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=l.id and d.voided_at is null),'matchups',(select count(*)from public.matchups where league_id=l.id),'weekOneMatchups',(select count(*)from public.matchups where league_id=l.id and period=1),'snapshots',(select count(*)from public.game_lineup_snapshots where league_id=l.id),'pointEvents',(select count(*)from public.fantasy_point_events where league_id=l.id),'recoveryAudits',(select count(*)from public.audit_log where action='league.roster_recovered'and entity_id=l.id::text))from public.leagues l join public.fantasy_periods f on f.id=l.first_scoring_period_id where l.id=${quote(leagueId)}::uuid)
    )evidence;commit;`,
    'verified',
  );
  assert.ok(verified.migrationMatches);
  assert.equal(verified.manifestStarters, 49);
  assert.ok(verified.scoringPaused && verified.stableContextClock);
  assert.equal(verified.activeDrafts, 0);
  assert.equal(verified.league.firstPeriod, 1);
  assert.equal(verified.league.draftPicks, 80);
  assert.equal(verified.league.matchups, 28);
  assert.equal(verified.league.weekOneMatchups, 4);
  assert.ok(verified.league.snapshots > 0);
  assert.equal(verified.league.pointEvents, 0);
  assert.equal(verified.league.recoveryAudits, 1);
  console.log(JSON.stringify(verified));
}
