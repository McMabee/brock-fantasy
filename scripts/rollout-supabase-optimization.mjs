import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// - Restrict staged rollout and recovery evidence to the approved production project
// - Preserve gameplay rows and execute each migration with an atomic history entry
const exec = promisify(execFile);
const project = 'fdovowiihxowzatewxgv';
const versions = [
  '20261022171340',
  '20261022171341',
  '20261022171342',
  '20261022171344',
  '20261022171345',
];
const names = [
  'advisor_event_trigger_grants',
  'advisor_rls_policy_performance',
  'notification_snapshot',
  'set_based_player_insights',
  'draft_catalog_revisions',
];
const modes = process.argv.slice(2);
assert.ok(
  modes.length === 1 && ['--capture', '--apply', '--check-local'].includes(modes[0]),
  'Select --capture, --apply or --check-local',
);
const privateRoot = path.resolve('D:/Brock Fantasy/Private');
const directory = path.resolve(
  process.env.BROCK_OPTIMIZATION_RECOVERY_DIR ??
    path.join(privateRoot, 'supabase-optimization-20261022'),
);
assert.ok(
  directory.toLowerCase().startsWith(privateRoot.toLowerCase() + path.sep),
  'Recovery evidence must stay inside the private backup directory',
);
await mkdir(directory, { recursive: true });
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const identifier = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const migrations = await Promise.all(
  versions.map(async (version, index) => {
    const file = `${version}_${names[index]}.sql`;
    const content = await readFile(path.join('supabase/migrations', file), 'utf8');
    return {
      version,
      name: names[index],
      file,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }),
);
const fingerprint = `create function pg_temp.optimization_fingerprint()returns jsonb language plpgsql set search_path=''as $$
  declare relation record; item jsonb; result jsonb:='{}';begin
    for relation in select schemaname,tablename from pg_catalog.pg_tables where schemaname in('public','beta_private','registration_private')order by schemaname,tablename loop
      execute format('select jsonb_build_object(''rows'',count(*),''hash'',md5(coalesce(string_agg(md5(entry::text),'''' order by entry::text),'''')))
        from(select to_jsonb(t)%s entry from %I.%I t) entries',case when relation.schemaname='public'and relation.tablename='player_pools'then'-''state_version'''else''end,relation.schemaname,relation.tablename)into item;
      result:=result||jsonb_build_object(relation.schemaname||'.'||relation.tablename,item);end loop;return result;end$$;`;
async function query(source, label) {
  const file = path.join(directory, label + '.sql');
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
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    await writeFile(
      path.join(directory, label + '-diagnostics.log'),
      String(error.stderr ?? error.message),
      { mode: 0o600 },
    );
    throw new Error(`Production query failed; diagnostics retained privately for ${label}`);
  }
  const output = JSON.parse(response.stdout);
  await writeFile(path.join(directory, label + '.json'), JSON.stringify(output, null, 2) + '\n', {
    mode: 0o600,
  });
  assert.ok(Array.isArray(output.rows), 'Provider returned an error instead of query rows');
  return output.rows[0]?.evidence;
}
async function advisors(label) {
  const response = await exec(
    process.execPath,
    [
      'node_modules/supabase/dist/supabase.js',
      'db',
      'advisors',
      '--linked',
      '--project-ref',
      project,
      '--type',
      'all',
      '--level',
      'warn',
      '--fail-on',
      'none',
      '--agent',
      'no',
      '--output-format',
      'json',
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const report = response.stdout
    .split(/\r?\n/u)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .find((value) => Array.isArray(value.results));
  assert.ok(report, 'The advisor command must return a structured report');
  await writeFile(path.join(directory, label + '.json'), JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    'Production advisor counts',
    label,
    JSON.stringify(
      report.results.reduce((counts, item) => {
        counts[item.name] = (counts[item.name] ?? 0) + 1;
        return counts;
      }, {}),
    ),
  );
  return report.results;
}
const captureSQL = `begin transaction read only;
  select jsonb_build_object('capturedAt',clock_timestamp(),'project',${quote(project)},
    'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',r.rolname))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in('public','rpc_private','beta_private')and p.prokind='f'),
    'policies',(select jsonb_agg(to_jsonb(p))from pg_policies p where schemaname='public'),
    'triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid)))from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and not t.tgisinternal),
    'indexes',(select jsonb_agg(to_jsonb(i))from pg_indexes i where schemaname='public'),
    'eventTriggers',(select jsonb_agg(jsonb_build_object('name',evtname,'function',evtfoid::regprocedure::text,'enabled',evtenabled,'tags',evttags))from pg_event_trigger),
    'jobs',(select jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'schedule',schedule,'active',active,'commandHash',md5(command))order by jobid)from cron.job),
    'migrations',(select jsonb_agg(version order by version)from supabase_migrations.schema_migrations),
    'activeDrafts',(select count(*)from public.drafts where status='active'and voided_at is null),
    'statementStatsReset',(select stats_reset from extensions.pg_stat_statements_info),
    'statements',(select jsonb_agg(to_jsonb(s))from(select queryid::text queryid,calls,total_exec_time,mean_exec_time,max_exec_time from extensions.pg_stat_statements order by total_exec_time desc limit 50)s))as evidence;commit;`;
const policyTables = new Set([
  'profiles',
  'user_roles',
  'notifications',
  'push_tokens',
  'chat_messages',
  'chat_mutes',
  'chat_reports',
  'athlete_rankings',
  'athlete_seasons',
  'athletes',
  'competitions',
  'teams',
  'trade_items',
  'trades',
]);
function recoverySQL(before) {
  const tables = [
    'pool_rankings',
    'pool_competitions',
    'athlete_seasons',
    'athletes',
    'teams',
    'competitions',
    'sports',
    'fantasy_seasons',
    'athlete_season_summaries',
    'drafts',
    'draft_picks',
    'roster_slot_rules',
    'fantasy_teams',
    'leagues',
  ];
  const drop = tables.flatMap((table) =>
    ['insert', 'update', 'delete'].map(
      (event) => `drop trigger if exists draft_catalog_${event} on public.${identifier(table)};`,
    ),
  );
  drop.push('drop trigger if exists draft_pool_metadata on public.player_pools;');
  drop.push(
    'drop trigger if exists deleted_participation_catalog on beta_private.account_participation;',
  );
  const restoreFunctions = [
    'beta_private.next_period_projections(uuid)',
    'rpc_private.get_player_insights(uuid,uuid)',
    'rpc_private.get_draft_room_snapshot(uuid,text,text)',
  ].map((signature) => {
    const fn = before.functions.find((f) => f.signature === signature);
    assert.ok(fn, `Missing recovery definition for ${signature}`);
    return fn.definition.trimEnd() + ';';
  });
  const oldTrigger = before.triggers.find((t) => t.name === 'supplied_adp_revision');
  assert.ok(oldTrigger, 'Original supplied ADP trigger must exist in the recovery snapshot');
  const dropPolicies = `do $$declare p record;begin for p in select *from pg_policies where schemaname='public'and tablename=any(array[${[...policyTables].map(quote).join(',')}])loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);end loop;end$$;`;
  const policies = before.policies
    .filter((p) => policyTables.has(p.tablename))
    .map(
      (p) =>
        `create policy ${identifier(p.policyname)} on public.${identifier(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map((role) => (role === 'public' ? 'PUBLIC' : identifier(role))).join(',')}${p.qual ? ' using(' + p.qual + ')' : ''}${p.with_check ? ' with check(' + p.with_check + ')' : ''};`,
    );
  return `-- - Restore metadata only and retain hardened grants and the compatible notification RPC
-- - Record any executed recovery as a reviewed forward migration afterward
begin;set local lock_timeout='2s';set local statement_timeout='30s';
lock table public.drafts in share mode nowait;
do $$begin if exists(select 1 from public.drafts where status='active'and voided_at is null)then
  raise exception 'Active gameplay requires a forward fix';end if;end$$;
${drop.join('\n')}
${oldTrigger.definition};
${restoreFunctions.join('\n')}
${dropPolicies}
${policies.join('\n')}
notify pgrst,'reload schema';commit;\n`;
}
if (modes[0] === '--check-local') {
  const task = exec(
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
      '-qAt',
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  task.child.stdin.end(
    `begin;${fingerprint}select jsonb_typeof(pg_temp.optimization_fingerprint());rollback;`,
  );
  assert.equal((await task).stdout.trim(), 'object');
  const before = JSON.parse(await readFile(path.join(directory, 'before.json'), 'utf8'));
  const recovery = recoverySQL(before)
    .replace(/^begin;/mu, '')
    .replace(/commit;\s*$/u, '');
  await mkdir('tmp', { recursive: true });
  await writeFile(
    'tmp/optimization-recovery-check.sql',
    `begin;${fingerprint}
    select set_config('optimization.before',pg_temp.optimization_fingerprint()::text,true);
    ${recovery}
    do $$begin if pg_temp.optimization_fingerprint()<>current_setting('optimization.before')::jsonb then raise exception 'Recovery changed application rows';end if;end$$;
    rollback;select 'optimization-recovery-preserves-data';`,
  );
  console.log('Local fingerprint helper passed and isolated recovery verification SQL is ready');
} else if (modes[0] === '--capture') {
  const existing = await readFile(path.join(directory, 'before.json'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  assert.equal(
    existing,
    null,
    'Choose a fresh private recovery directory instead of replacing an earlier snapshot',
  );
  const before = await query(captureSQL, 'capture');
  assert.equal(before.activeDrafts, 0, 'Defer rollout while a real draft is active');
  before.files = migrations.map(({ version, name, file, sha256 }) => ({
    version,
    name,
    file,
    sha256,
  }));
  await writeFile(path.join(directory, 'before.json'), JSON.stringify(before, null, 2) + '\n', {
    mode: 0o600,
  });
  await writeFile(path.join(directory, 'recover-metadata.sql'), recoverySQL(before), {
    mode: 0o600,
  });
  await advisors('advisors-before');
  console.log('Captured private recovery metadata and query-statistic baseline', directory);
} else {
  const before = JSON.parse(await readFile(path.join(directory, 'before.json'), 'utf8'));
  assert.equal(before.project, project);
  assert.ok(
    Date.now() - Date.parse(before.capturedAt) < 3600000,
    'Refresh the rollout snapshot after one hour',
  );
  assert.deepEqual(
    before.files,
    migrations.map(({ version, name, file, sha256 }) => ({ version, name, file, sha256 })),
    'Migration contents changed after recovery preparation',
  );
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
  assert.ok(
    Date.now() - Date.parse(backup.capturedAt) < 86400000,
    'A verified backup within twenty-four hours is required',
  );
  assert.ok(
    restore.databaseRestored &&
      restore.exportsHashVerified &&
      restore.offsiteRecoveryVerified &&
      restore.cleanupVerified,
  );
  assert.ok(
    Date.parse(restore.startedAt) >= Date.parse(backup.capturedAt),
    'Restore evidence must follow the current backup',
  );
  const installed = await query(
    `begin transaction read only;
    select coalesce(jsonb_object_agg(version,jsonb_build_object('name',name,'statements',statements)),'{}'::jsonb)as evidence
    from supabase_migrations.schema_migrations where version=any(array[${versions.map(quote).join(',')}]);commit;`,
    'installed-stages',
  );
  for (const migration of migrations) {
    if (installed[migration.version]) {
      assert.deepEqual(
        installed[migration.version],
        { name: migration.name, statements: [migration.content] },
        'An installed stage must match the approved migration exactly',
      );
      console.log('Verified already applied production stage', migration.file);
      continue;
    }
    const source = `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
      lock table public.drafts in share mode nowait;
      do $$begin if exists(select 1 from public.drafts where status='active'and voided_at is null)then raise exception 'Active draft blocks rollout';end if;
        if exists(select 1 from pg_stat_activity where datname=current_database()and pid<>pg_backend_pid()and xact_start<clock_timestamp()-interval '10 seconds')then raise exception 'Long transaction blocks rollout';end if;end$$;
      ${fingerprint}
      select set_config('optimization.before',pg_temp.optimization_fingerprint()::text,true);
      ${migration.content}
      ${
        migration.version === '20261022171340'
          ? `savepoint automatic_rls_probe;
        create table public.optimization_automatic_rls_probe(id integer);
        do $$begin if not(select relrowsecurity from pg_class where oid='public.optimization_automatic_rls_probe'::regclass)then
          raise exception 'Automatic RLS did not protect the new table';end if;end$$;
        rollback to savepoint automatic_rls_probe;`
          : ''
      }
      do $$begin if pg_temp.optimization_fingerprint()<>current_setting('optimization.before')::jsonb then raise exception 'Migration changed protected gameplay rows';end if;end$$;
      insert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(migration.version)},${quote(migration.name)},array[${quote(migration.content)}]);
      select jsonb_build_object('version',${quote(migration.version)},'gameplayUnchanged',true,'capturedAt',clock_timestamp())as evidence;commit;`;
    const result = await query(source, 'applied-' + migration.version);
    assert.equal(result.version, migration.version);
    assert.equal(result.gameplayUnchanged, true);
    console.log('Applied and verified production stage', migration.file);
    const issues = await advisors('advisors-after-' + migration.version);
    assert.equal(
      issues.filter((item) =>
        [
          'anon_security_definer_function_executable',
          'authenticated_security_definer_function_executable',
        ].includes(item.name),
      ).length,
      0,
      'Public function grant warnings must be absent',
    );
    if (migration.version !== '20261022171340')
      assert.equal(
        issues.filter((item) =>
          ['auth_rls_initplan', 'multiple_permissive_policies'].includes(item.name),
        ).length,
        0,
        'The supplied policy warnings must be absent',
      );
  }
  const after = await query(captureSQL, 'after');
  const worker = (state) =>
    state.functions
      .filter((f) => /process_expired_drafts/.test(f.signature))
      .sort((a, b) => a.signature.localeCompare(b.signature));
  assert.deepEqual(
    worker(after),
    worker(before),
    'Draft worker definitions and privileges must remain unchanged',
  );
  assert.deepEqual(after.jobs, before.jobs, 'Worker schedules and commands must remain unchanged');
  assert.deepEqual(
    after.eventTriggers,
    before.eventTriggers,
    'Automatic RLS bindings must remain unchanged',
  );
  const eventFunction = (state) => {
    const fn = state.functions.find(
      (f) => f.signature === 'rls_auto_enable()' || f.signature === 'public.rls_auto_enable()',
    );
    return { oid: fn.oid, signature: fn.signature, definition: fn.definition, owner: fn.owner };
  };
  assert.deepEqual(
    eventFunction(after),
    eventFunction(before),
    'The event-trigger identity and definition must remain unchanged',
  );
  assert.equal(after.activeDrafts, 0);
  const verification = await query(
    `begin transaction read only;select jsonb_build_object(
    'uncachedAuthPolicies',(select count(*)from pg_policies where schemaname='public'and policyname=any(array['profiles_self_update','user_roles_self_read','notifications_self_read','notifications_self_update','push_tokens_self_read','chat_messages_member_read','chat_mutes_self_read','chat_reports_own_or_admin_read'])and(coalesce(qual,'')||coalesce(with_check,''))like'%= auth.uid()%'),
    'duplicateReadPolicies',(select count(*)from(select tablename from pg_policies where schemaname='public'and permissive='PERMISSIVE'and cmd in('SELECT','ALL')and roles&&array['authenticated','public']::name[]and tablename=any(array['athlete_rankings','athlete_seasons','athletes','competitions','profiles','teams','trade_items','trades'])group by tablename having count(*)>1)s),
    'publicClientDefiners',(select count(*)from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and(has_function_privilege('anon',p.oid,'execute')or has_function_privilege('authenticated',p.oid,'execute'))),
    'publicTablesWithoutRls',(select count(*)from pg_class where relnamespace='public'::regnamespace and relkind in('r','p')and not relrowsecurity),
    'draftStatusSignatures',(select count(*)from pg_proc where pronamespace='public'::regnamespace and proname='set_draft_status'))as evidence;commit;`,
    'verification',
  );
  assert.deepEqual(verification, {
    uncachedAuthPolicies: 0,
    duplicateReadPolicies: 0,
    publicClientDefiners: 0,
    publicTablesWithoutRls: 0,
    draftStatusSignatures: 1,
  });
  console.log('Production catalog checks passed', JSON.stringify(verification));
}
