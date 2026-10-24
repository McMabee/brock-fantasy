import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// - Restrict release and private recovery evidence to the approved production project
const exec = promisify(execFile);
const project = 'fdovowiihxowzatewxgv';
const directory = 'D:/Brock Fantasy/Private/matchup-recovery-20261024';
const privateRoot = path.dirname(directory);
await mkdir(directory, { recursive: true });
const mode = process.argv[2];
assert.ok(
  [
    '--capture',
    '--conflicts',
    '--schedule',
    '--repair-preview',
    '--repair',
    '--verify',
    '--observe',
  ].includes(mode),
);
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
async function query(source, label) {
  const file = path.join(directory, label + '.sql');
  await writeFile(file, source, { mode: 0o600 });
  let output;
  try {
    output = await exec(
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
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    await writeFile(
      path.join(directory, label + '-error.log'),
      String(error.stderr ?? error.message),
      { mode: 0o600 },
    );
    throw new Error('Production operation failed; sanitized output retained privately: ' + label);
  }
  const result = JSON.parse(output.stdout);
  await writeFile(path.join(directory, label + '.json'), JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  assert.ok(Array.isArray(result.rows));
  return result.rows.at(-1)?.evidence;
}
const metadata = `select jsonb_build_object('checkedAt',clock_timestamp(),'project',${q(project)},
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner,'securityDefiner',p.prosecdef,'config',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','rpc_private','beta_private') and p.prokind='f'),
  'unsafeConflicts',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','rpc_private','beta_private','registration_private') and p.prosrc like '%40001%'),
  'activeDrafts',(select count(*) from public.drafts where status='active' and voided_at is null),
  'databaseStats',(select jsonb_build_object('commits',xact_commit,'rollbacks',xact_rollback,'statsReset',stats_reset)from pg_stat_database where datname=current_database()),
  'loopCandidates',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from(select pid,backend_start,usename,application_name,state,query_start from pg_stat_activity where usename='authenticator' and application_name like 'PostgREST 14.%' and state='active' and query like '%set_period_lineup%')a),
  'leagues',(select jsonb_agg(to_jsonb(a)) from(select l.id,l.name,d.completed_at,count(m.id) matchups,count(m.id)filter(where m.period=1) week1 from public.leagues l join public.drafts d on d.league_id=l.id and d.voided_at is null and d.status='complete' left join public.matchups m on m.league_id=l.id where l.pool_id is not null group by l.id,d.completed_at)a),
  'jobs',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'command',command)order by jobname)from cron.job)
)evidence;`;
const fingerprint = `create function pg_temp.recovery_fingerprint()returns jsonb language plpgsql set search_path='' as $$
declare r record; item jsonb; result jsonb:='{}';begin
for r in select schemaname,tablename from pg_tables where schemaname in('public','beta_private','registration_private') order by 1,2 loop
execute format('select jsonb_build_object(''rows'',count(*),''hash'',md5(coalesce(string_agg(md5(entry::text),'''' order by entry::text),'''')))from(select to_jsonb(t)entry from %I.%I t)x',r.schemaname,r.tablename)into item;
result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,item);end loop;return result;end$$;`;
async function backupGate() {
  const backup = JSON.parse(
    await readFile(path.join(privateRoot, 'last-backup-receipt.json'), 'utf8'),
  );
  const restore = JSON.parse(
    await readFile(path.join(privateRoot, 'last-database-restore-offsite.json'), 'utf8'),
  );
  assert.equal(backup.projectRef, project);
  assert.ok(
    backup.encrypted &&
      backup.offsiteVerified &&
      backup.restoredExportHashesVerified &&
      backup.offsiteRestoredExportHashesVerified,
  );
  assert.ok(Date.now() - Date.parse(backup.capturedAt) < 86400000);
  assert.ok(
    restore.databaseRestored &&
      restore.exportsHashVerified &&
      restore.offsiteRecoveryVerified &&
      restore.cleanupVerified,
  );
  assert.ok(Date.parse(restore.startedAt) >= Date.parse(backup.capturedAt));
}
if (mode === '--capture') {
  const evidence = await query('begin transaction read only;' + metadata + 'commit;', 'before');
  console.log(
    JSON.stringify({
      activeDrafts: evidence.activeDrafts,
      unsafeConflicts: evidence.unsafeConflicts,
      loopCandidates: evidence.loopCandidates,
      leagues: evidence.leagues,
    }),
  );
} else if (mode === '--conflicts' || mode === '--schedule') {
  await backupGate();
  const version = mode === '--conflicts' ? '20261024144817' : '20261024144819';
  const name =
    mode === '--conflicts' ? 'nonretryable_application_conflicts' : 'automatic_matchup_schedules';
  const content = await readFile(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  const installed = await query(
    `select jsonb_build_object('installed',exists(select 1 from supabase_migrations.schema_migrations where version=${q(version)}),'matches',coalesce((select name=${q(name)} and statements=array[${q(content)}] from supabase_migrations.schema_migrations where version=${q(version)}),false))evidence;`,
    'installed-' + version,
  );
  if (installed.installed) {
    assert.ok(installed.matches, 'Installed migration must match the reviewed file');
    console.log('Verified already installed migration', version);
  } else {
    await query(
      `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
      lock table public.drafts in share mode nowait;
      do $$begin if exists(select 1 from public.drafts where status='active'and voided_at is null)then raise exception 'Active draft blocks rollout';end if;end$$;
      ${fingerprint}
      select set_config('recovery.before',pg_temp.recovery_fingerprint()::text,true);
      ${content}
      do $$begin if pg_temp.recovery_fingerprint()<>current_setting('recovery.before')::jsonb then raise exception 'Migration changed protected gameplay rows';end if;end$$;
      insert into supabase_migrations.schema_migrations(version,name,statements)values(${q(version)},${q(name)},array[${q(content)}]);
      ${metadata}commit;`,
      'applied-' + version,
    );
    console.log('Applied migration with unchanged gameplay rows', version);
  }
  const after = await query(
    'begin transaction read only;' + metadata + 'commit;',
    'after-' + version,
  );
  assert.equal(after.unsafeConflicts, 0);
  const original = JSON.parse(await readFile(path.join(directory, 'before.json'), 'utf8')).rows.at(
    -1,
  ).evidence;
  assert.deepEqual(after.jobs, original.jobs, 'Worker commands and schedules remain unchanged');
  for (const old of original.functions) {
    const current = after.functions.find((item) => item.signature === old.signature);
    assert.ok(current);
    assert.deepEqual(
      { ...current, definition: old.definition },
      old,
      'Existing function identities and authorization metadata remain unchanged',
    );
  }
  if (mode === '--conflicts') {
    const before = JSON.parse(await readFile(path.join(directory, 'before.json'), 'utf8')).rows.at(
      -1,
    ).evidence;
    let changed = 0;
    for (const old of before.functions) {
      const current = after.functions.find((item) => item.signature === old.signature);
      assert.ok(current);
      assert.deepEqual(
        { ...current, definition: old.definition },
        old,
        'Function identity and authorization metadata remain unchanged',
      );
      assert.equal(current.definition, old.definition.replaceAll("'40001'", "'PT409'"));
      if (current.definition !== old.definition) changed++;
    }
    assert.equal(changed, 12);
    // - Terminate only pre-release candidates whose exact backend identity and RPC still match
    for (const candidate of before.loopCandidates) {
      const stopped = await query(
        `select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'terminated',pg_terminate_backend(pid))),'[]')evidence from pg_stat_activity
        where pid=${Number(candidate.pid)} and backend_start=${q(candidate.backend_start)}::timestamptz and usename='authenticator'
        and application_name=${q(candidate.application_name)} and state='active' and query like '%set_period_lineup%';`,
        'stopped-' + candidate.pid,
      );
      console.log('Exact looping-backend cleanup', JSON.stringify(stopped));
    }
  }
  console.log(
    JSON.stringify({ unsafeConflicts: after.unsafeConflicts, activeDrafts: after.activeDrafts }),
  );
} else if (mode === '--repair-preview' || mode === '--repair') {
  if (mode === '--repair') await backupGate();
  const preview = await query(
    `begin transaction read only;select coalesce(jsonb_agg(jsonb_build_object('league',l.id,'name',l.name,'plan',beta_private.matchup_plan(l.id))),'[]')evidence from public.leagues l
    where l.pool_id is not null and l.format='head_to_head' and exists(select 1 from public.drafts d where d.league_id=l.id and d.status='complete' and d.voided_at is null);commit;`,
    'repair-preview',
  );
  console.log(
    'Repair candidates',
    JSON.stringify(
      preview.map((item) => ({
        name: item.name,
        pairings: item.plan.pairings.length,
        periods: item.plan.periods.length,
      })),
    ),
  );
  if (mode === '--repair') {
    for (const item of preview) {
      const repaired = await query(
        `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
        ${fingerprint}
        select beta_private.league_lock(${q(item.league)}::uuid);
        do $$begin if beta_private.matchup_plan(${q(item.league)}::uuid)->>'signature'<>${q(item.plan.signature)}then raise exception 'Repair preview changed'using errcode='PT409';end if;end$$;
        select set_config('recovery.protected',pg_temp.recovery_fingerprint()::text,true);
        select set_config('recovery.matchups',coalesce((select jsonb_agg(to_jsonb(m))from public.matchups m where league_id=${q(item.league)}::uuid),'[]')::text,true);
        select set_config('recovery.league',(select(to_jsonb(l)-array['state_version','updated_at'])::text from public.leagues l where id=${q(item.league)}::uuid),true);
        select set_config('recovery.result',beta_private.ensure_matchup_schedule(${q(item.league)}::uuid)::text,true);
        do $$begin
          if (pg_temp.recovery_fingerprint()-array['public.matchups','public.leagues','public.audit_log'])<>(current_setting('recovery.protected')::jsonb-array['public.matchups','public.leagues','public.audit_log'])then raise exception 'Repair changed protected gameplay data';end if;
          if (select to_jsonb(l)-array['state_version','updated_at'] from public.leagues l where id=${q(item.league)}::uuid)<>current_setting('recovery.league')::jsonb then raise exception 'Repair changed league configuration';end if;
          if exists(select 1 from jsonb_array_elements(current_setting('recovery.matchups')::jsonb)old where not exists(select 1 from public.matchups m where to_jsonb(m)=old))then raise exception 'Repair changed an existing matchup';end if;
        end$$;
        select current_setting('recovery.result')::jsonb||jsonb_build_object('protectedDataUnchanged',true)evidence;commit;`,
        'repaired-' + item.league,
      );
      console.log(item.name, JSON.stringify(repaired));
    }
  }
} else if (mode === '--observe') {
  // - Retain bounded health samples without modifying production state or resetting statistics
  const interval = 15 * 60 * 1000;
  const deadline = Date.now() + 24 * 60 * 60 * 1000;
  let samples = 0;
  let unavailable = 0;
  while (Date.now() < deadline) {
    try {
      const health = await query(
        `begin transaction read only;select jsonb_build_object('checkedAt',clock_timestamp(),
      'unsafeConflicts',(select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','rpc_private','beta_private','registration_private')and p.prosrc like '%40001%'),
      'rollbacks',(select xact_rollback from pg_stat_database where datname=current_database()),
      'workerFailures',(select count(*)from cron.job_run_details where start_time>clock_timestamp()-interval '15 minutes'and status='failed'))evidence;commit;`,
        'observation-' + Date.now(),
      );
      console.log(
        JSON.stringify({
          ...health,
          status: health.unsafeConflicts || health.workerFailures ? 'needs_attention' : 'healthy',
        }),
      );
      samples++;
    } catch (error) {
      unavailable++;
      console.error(
        JSON.stringify({
          checkedAt: new Date().toISOString(),
          status: 'unavailable',
          message: error.message,
        }),
      );
    }
    const remaining = deadline - Date.now();
    if (remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
  }
  await writeFile(
    path.join(directory, 'observation-summary.json'),
    JSON.stringify({ finishedAt: new Date().toISOString(), samples, unavailable }, null, 2) + '\n',
  );
} else {
  const after = await query(
    'begin transaction read only;' + metadata + 'commit;',
    'verified-' + Date.now(),
  );
  assert.equal(after.unsafeConflicts, 0);
  console.log(
    JSON.stringify({
      checkedAt: after.checkedAt,
      unsafeConflicts: after.unsafeConflicts,
      activeDrafts: after.activeDrafts,
      loopCandidates: after.loopCandidates,
      databaseStats: after.databaseStats,
      leagues: after.leagues,
    }),
  );
}
