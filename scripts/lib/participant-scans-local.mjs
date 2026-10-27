import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { erasureReplaySql } from './erasure-replay.mjs';
import {
  participantReferencePlan,
  participantReferenceSql,
  referenceFiles,
} from './participant-references.mjs';

export async function verifyParticipantScansLocal({ database, databaseContainer, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  assert.match(databaseContainer, /^supabase_db_[a-zA-Z0-9_-]+$/u);
  const admin = randomUUID(),
    version = randomUUID();
  const actor = `select set_config('request.jwt.claim.sub','${admin}',true); select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal2","session_id":"${admin}"}',true); set local role authenticated;`;
  await executeSql(`
    insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
    select id,email,now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,
      'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
    from (select '${admin}'::uuid id,'scan-performance-admin@example.test' email,'Benchmark Admin' name
      union all select md5('scan-benchmark-account:'||i)::uuid,'member'||i||'@example.test',substr(md5('given:'||i),1,9)||' '||substr(md5('family:'||i),1,9) from generate_series(1,9999)i)q;
    insert into public.user_roles(user_id,role) values('${admin}','admin');
    insert into auth.sessions(id,user_id,aal) values('${admin}','${admin}','aal2');
    insert into beta_private.participant_reference_versions(id,content_hash,season_id,sources,imported_by,active)
      values('${version}','benchmark','b0000000-0000-4000-8000-000000000002','[]','${admin}',true);
    insert into beta_private.participant_references(version_id,id,name,role,programs,sources,evidence_hash,normalized_name,sorted_name,usernames,inferred_usernames)
      select '${version}',md5('benchmark-ref:'||i)::uuid,name,'coach',array['mens_hockey'],'[]',md5(name),beta_private.participant_name(name),beta_private.participant_tokens(name),'{}','{}'
      from (select i,substr(md5('given:'||i),1,9)||' '||substr(md5('family:'||i),1,9) name from generate_series(1,2000)i)q;
    update beta_private.participant_scan_settings set enabled=true;
    analyze public.profiles; analyze auth.users; analyze beta_private.account_participation; analyze beta_private.participant_references;
  `);
  console.log(
    'Created 10,000 synthetic accounts and 2,000 synthetic references in the disposable database',
  );
  await mkdir('dev/tmp/participant-scans-local', { recursive: true });
  const source = await readFile(
    'supabase/migrations/20261027162933_shared_participant_scans.sql',
    'utf8',
  );
  const query = source
    .slice(source.indexOf('with accounts as materialized'), source.indexOf(', inserted as ('))
    .replaceAll(
      'settings.weights',
      `('{"email":100,"name":90,"email_username":80,"inferred_username":60,"minimum":35}'::jsonb)`,
    )
    .replace(/\bv\b/gu, `'${version}'`);
  const fullPlan = await executeSql(
    `explain (format json) ${query} select count(*) from scored where score>=35;`,
  );
  await writeFile('dev/tmp/participant-scans-local/full-query-plan.json', fullPlan);
  const benchmark = await executeSql(`begin;${actor}
    select public.admin_run_participant_scan('benchmark-first-scan');
    reset role;
    select jsonb_build_object('milliseconds',extract(epoch from completed_at-started_at)*1000,'accounts',account_count,'results',result_count)
      from beta_private.participant_scan_runs order by completed_at desc limit 1;
    commit;`);
  const metrics = JSON.parse(benchmark.split('\n').find((line) => line.includes('milliseconds')));
  assert.equal(metrics.accounts, 10000);
  assert.ok(metrics.results >= 2000);
  const queryPlan =
    await executeSql(`explain (analyze,buffers,format json) select id from beta_private.participant_references
    where version_id='${version}' and normalized_name operator(extensions.%) beta_private.participant_name('d72ba349d 122c1dc1d');`);
  assert.match(queryPlan, /participant_reference_names/u);
  await mkdir('dev/tmp/participant-scans-local', { recursive: true });
  await writeFile(
    'dev/tmp/participant-scans-local/benchmark.json',
    JSON.stringify(metrics, null, 2) + '\n',
  );
  await writeFile('dev/tmp/participant-scans-local/query-plan.json', queryPlan);
  console.log(
    `Scan benchmark: ${metrics.milliseconds} ms, ${metrics.accounts} accounts, ${metrics.results} candidates`,
  );
  assert.ok(
    metrics.milliseconds < 5000,
    '10,000-account / 2,000-reference scan completes under five seconds',
  );

  // - Hold the shared transaction lock across separate connections to exercise real contention
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      databaseContainer,
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
    ],
    { windowsHide: true },
  );
  let stdout = '',
    stderr = '';
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('scan-lock-held')) readyResolve();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      readyReject(error);
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error(stderr);
        readyReject(error);
        reject(error);
      }
    });
  });
  child.stdin.end(
    `begin;select pg_advisory_xact_lock(hashtextextended('participant-scan-publication',0));select 'scan-lock-held';select pg_sleep(1);commit;`,
  );
  await ready;
  await assert.rejects(
    executeSql(
      `begin;${actor}select public.admin_run_participant_scan('concurrent-scan-key');commit;`,
    ),
    /already running/u,
  );
  await done;
  assert.equal(
    (await executeSql('select count(*) from beta_private.participant_scan_runs;')).trim(),
    '1',
  );

  const preview = participantReferencePlan(
    referenceFiles.map(({ file, role }) => ({
      file,
      content:
        role === 'coach'
          ? "Name,Email,Title\nRémy O'Brien*,remy@example.test,Coach\n"
          : 'Name,Position\nSample Athlete,F\n',
    })),
    { seasonId: 'b0000000-0000-4000-8000-000000000002' },
  );
  const publication = participantReferenceSql(preview, admin).replace(/commit;\s*$/u, 'rollback;');
  const readback = await executeSql(publication);
  assert.ok(readback.includes('"references": 12'));
  console.log(
    'PASS importer SQL publishes the exact JavaScript preview hash with Unicode and apostrophe names',
  );

  const target = (
    await executeSql(
      'select user_id from beta_private.participant_scan_matches order by score desc limit 1;',
    )
  ).trim();
  const replay = erasureReplaySql({
    capturedAt: new Date().toISOString(),
    entries: [{ kind: 'account', id: target }],
  });
  await executeSql(`begin;${replay}${replay}
    do $$begin if exists(select 1 from beta_private.participant_scan_matches where user_id='${target}') then raise exception 'Restored scan contains erased account evidence';end if;end$$;rollback;`);
  console.log(
    'PASS contending scans fail without publishing partial results and deletion replay clears restored scan evidence',
  );
}
