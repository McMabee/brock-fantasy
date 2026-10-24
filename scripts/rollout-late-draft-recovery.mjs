import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

// - Apply the reviewed function-only migration with private evidence and a verified restore gate
const exec = promisify(execFile);
const project = 'fdovowiihxowzatewxgv';
const directory = 'D:/Brock Fantasy/Private/late-draft-recovery-20261024';
const version = '20261024170758';
const name = 'allow_late_league_drafts';
const mode = process.argv[2];
assert.ok(['--apply', '--verify'].includes(mode));
await mkdir(directory, { recursive: true });
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const content = await readFile(`supabase/migrations/${version}_${name}.sql`, 'utf8');
async function query(source, label) {
  const file = `${directory}/${label}.sql`;
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
    await writeFile(`${directory}/${label}-error.log`, String(error.stderr ?? error.message), {
      mode: 0o600,
    });
    throw new Error('Database operation failed; evidence retained privately: ' + label);
  }
  const result = JSON.parse(output.stdout);
  await writeFile(`${directory}/${label}.json`, JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  return result.rows.at(-1)?.evidence;
}
const metadata = `select jsonb_build_object('checkedAt',clock_timestamp(),
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner,'securityDefiner',p.prosecdef,'config',p.proconfig))from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','rpc_private','beta_private')and p.prokind='f'),
  'unsafeConflicts',(select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','rpc_private','beta_private','registration_private')and p.prosrc like '%40001%'),
  'activeDrafts',(select count(*)from public.drafts where status='active'and voided_at is null),
  'league',(select jsonb_build_object('name',l.name,'status',l.status,'teams',(select count(*)from public.fantasy_teams where league_id=l.id),'legalRosters',beta_private.draft_completion(l.id)is not null,'drafts',(select count(*)from public.drafts where league_id=l.id),'matchups',(select count(*)from public.matchups where league_id=l.id))from public.leagues l where l.id='d17cd308-6d8b-4068-b5e0-701e2daa4c26')
)evidence;`;
const installed = await query(
  `select jsonb_build_object('installed',exists(select 1 from supabase_migrations.schema_migrations where version=${q(version)}),'matches',coalesce((select name=${q(name)}and statements=array[${q(content)}]from supabase_migrations.schema_migrations where version=${q(version)}),false))evidence;`,
  'installed',
);
if (mode === '--apply' && !installed.installed) {
  const root = 'D:/Brock Fantasy/Private';
  const backup = JSON.parse(await readFile(`${root}/last-backup-receipt.json`, 'utf8'));
  const restore = JSON.parse(await readFile(`${root}/last-database-restore-offsite.json`, 'utf8'));
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
  const before = await query('begin transaction read only;' + metadata + 'commit;', 'before');
  assert.equal(before.activeDrafts, 0);
  const fingerprint = `create function pg_temp.late_draft_fingerprint()returns jsonb language plpgsql set search_path=''as $$
  declare r record;item jsonb;result jsonb:='{}';begin
  for r in select schemaname,tablename from pg_tables where schemaname in('public','beta_private','registration_private')order by 1,2 loop
  execute format('select jsonb_build_object(''rows'',count(*),''hash'',md5(coalesce(string_agg(md5(entry::text),'''' order by entry::text),'''')))from(select to_jsonb(t)entry from %I.%I t)x',r.schemaname,r.tablename)into item;
  result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,item);end loop;return result;end$$;`;
  await query(
    `begin isolation level repeatable read;set local lock_timeout='2s';set local statement_timeout='30s';
    lock table public.drafts in share mode nowait;
    do $$begin if exists(select 1 from public.drafts where status='active'and voided_at is null)then raise exception 'Active draft blocks rollout';end if;end$$;
    ${fingerprint}
    select set_config('late_draft.before',pg_temp.late_draft_fingerprint()::text,true);
    ${content}
    do $$begin if pg_temp.late_draft_fingerprint()<>current_setting('late_draft.before')::jsonb then raise exception 'Function migration changed gameplay rows';end if;end$$;
    insert into supabase_migrations.schema_migrations(version,name,statements)values(${q(version)},${q(name)},array[${q(content)}]);
    ${metadata}commit;`,
    'applied',
  );
} else {
  assert.ok(
    installed.installed && installed.matches,
    'Installed migration must match the reviewed file',
  );
}
const before = JSON.parse(await readFile(`${directory}/before.json`, 'utf8')).rows.at(-1).evidence;
const after = await query('begin transaction read only;' + metadata + 'commit;', 'after');
const changed = [];
for (const original of before.functions) {
  const current = after.functions.find((item) => item.signature === original.signature);
  assert.ok(current);
  assert.deepEqual(
    { ...current, definition: original.definition },
    original,
    'Function identity and authorization metadata must remain unchanged',
  );
  if (current.definition !== original.definition) changed.push(current.signature);
}
assert.deepEqual(
  changed.sort(),
  [
    'rpc_private.schedule_league_draft(uuid,timestamp with time zone,bigint,text)',
    'rpc_private.start_draft(uuid,integer,integer,text)',
  ].sort(),
);
assert.equal(after.unsafeConflicts, 0);
const check = await query(
  `select jsonb_build_object('draftWindowOpen',beta_private.has_draft_window(l.pool_id,l.max_members,clock_timestamp()),
  'helperPrivate',not exists(select 1 from unnest(array['anon','authenticated','service_role'])r where has_function_privilege(r,'beta_private.has_draft_window(uuid,integer,timestamptz)','execute')),
  'undraftedMatchups',(select count(*)from public.matchups m where not exists(select 1 from public.drafts d where d.league_id=m.league_id and d.status='complete'and d.voided_at is null)))evidence from public.leagues l where l.id='d17cd308-6d8b-4068-b5e0-701e2daa4c26';`,
  'verification',
);
assert.ok(check.draftWindowOpen && check.helperPrivate);
assert.equal(check.undraftedMatchups, 0);
console.log(
  JSON.stringify({
    version,
    changed,
    ...check,
    league: after.league,
    unsafeConflicts: after.unsafeConflicts,
  }),
);
