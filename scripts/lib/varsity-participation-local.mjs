import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function verifyParticipationConcurrency({ database, databaseContainer, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  assert.match(databaseContainer, /^supabase_db_[a-zA-Z0-9_-]+$/u);
  const [member, admin, firstLeague, secondLeague] = Array.from({ length: 4 }, () => randomUUID());
  await executeSql(`
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select id,email,now(),now(),jsonb_build_object('display_name','Concurrency fixture','varsity_role','none','varsity_programs','[]'::jsonb,
 'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from (values('${member}'::uuid,'${member}@example.test'),('${admin}'::uuid,'${admin}@example.test'))f(id,email);
insert into auth.sessions(id,user_id,aal) values('${admin}','${admin}','aal2');
insert into public.user_roles(user_id,role) values('${admin}','admin');
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format)
select id,'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004','${admin}','Varsity concurrency',id::text,4,'head_to_head'
from unnest(array['${firstLeague}'::uuid,'${secondLeague}'::uuid])id;
`);
  const actor = `select set_config('request.jwt.claim.sub','${admin}',true);select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal2","session_id":"${admin}"}',true);set local role authenticated;`;
  const update = (revision, key) =>
    `${actor} select public.admin_set_participation('${member}','coach',array['womens_volleyball'],${revision},'Confirmed concurrent coach','${key}');`;
  function heldTransaction(sql) {
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
        if (stdout.includes('held-participation')) readyResolve();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        readyReject(error);
        reject(error);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          const error = new Error(stderr);
          readyReject(error);
          reject(error);
        } else if (!stdout.includes('held-participation')) {
          const error = new Error('Concurrency barrier was not reached');
          readyReject(error);
          reject(error);
        } else resolve();
      });
    });
    // - Hold the first transaction only long enough for the competing write to begin
    child.stdin.end(`begin;${sql} select 'held-participation';select pg_sleep(0.8);commit;`);
    return { ready, done };
  }
  const correction = heldTransaction(update(1, 'varsity-concurrent-correction'));
  await correction.ready;
  await Promise.all([
    correction.done,
    executeSql(
      `insert into public.league_members(league_id,user_id) values('${firstLeague}','${member}');`,
    ),
  ]);
  assert.equal(
    (
      await executeSql(`select roster_format from public.leagues where id='${firstLeague}';`)
    ).trim(),
    'varsity',
  );
  await executeSql(
    `update beta_private.account_participation set role='none',programs='{}',revision=revision+1 where user_id='${member}';`,
  );
  const membership = heldTransaction(
    `insert into public.league_members(league_id,user_id) values('${secondLeague}','${member}');`,
  );
  await membership.ready;
  await Promise.all([
    membership.done,
    executeSql(`begin;${update(3, 'varsity-concurrent-membership')}commit;`),
  ]);
  assert.equal(
    (
      await executeSql(`select roster_format from public.leagues where id='${secondLeague}';`)
    ).trim(),
    'varsity',
  );
  console.log(
    'Concurrent participation corrections and league joins preserve the varsity format in both commit orders',
  );
}
