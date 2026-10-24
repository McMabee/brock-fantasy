import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export async function verifyMatchupConcurrency({ database, databaseContainer, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  assert.match(databaseContainer, /^supabase_db_[a-zA-Z0-9_-]+$/u);
  const source = await readFile('supabase/tests/180-backlog-leagues.test.sql', 'utf8');
  const fixture = source
    .slice(0, source.indexOf("select set_config('request.jwt.claim.sub'"))
    .replace('select no_plan();', '')
    .replaceAll('pg_temp.b_id', 'public.backlog_concurrency_id');
  await executeSql(`${fixture}commit;`);
  const actor = `select set_config('request.jwt.claim.sub',public.backlog_concurrency_id('user1')::text,true);select set_config('request.jwt.claims',jsonb_build_object('sub',public.backlog_concurrency_id('user1'),'session_id',public.backlog_concurrency_id('user1'),'role','authenticated','aal','aal1')::text,true);set local role authenticated;`;
  const signature = (
    await executeSql(
      `begin;${actor}select public.get_matchup_preview(public.backlog_concurrency_id('league'))->>'signature';rollback;`,
    )
  )
    .trim()
    .split('\n')
    .at(-1);
  assert.match(signature, /^[a-f0-9]{32}$/u);
  const confirm = (key) =>
    `select public.confirm_matchup_schedule(public.backlog_concurrency_id('league'),'${signature}','${key}');`;
  const first = spawn(
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
  let output = '',
    errorText = '',
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    first.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('held-matchup-confirmation')) readyResolve();
    });
    first.stderr.on('data', (chunk) => {
      errorText += chunk;
    });
    first.on('error', (error) => {
      readyReject(error);
      reject(error);
    });
    first.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(errorText);
        readyReject(error);
        reject(error);
      } else resolve();
    });
  });
  first.stdin.end(
    `begin;${actor}${confirm('backlog-concurrent-first')}select 'held-matchup-confirmation';select pg_sleep(0.8);commit;`,
  );
  await ready;
  const competing = executeSql(`begin;${actor}${confirm('backlog-concurrent-second')}commit;`);
  const results = await Promise.allSettled([done, competing]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'fulfilled');
  await executeSql(`begin;${actor}${confirm('backlog-concurrent-first')}commit;`);
  assert.equal(
    Number(
      (
        await executeSql(
          `select count(*) from public.matchups where league_id=public.backlog_concurrency_id('league');`,
        )
      ).trim(),
    ),
    14,
  );
  assert.equal(
    Number(
      (
        await executeSql(
          `select count(*) from public.matchups where league_id=public.backlog_concurrency_id('league') and starts_at<=now();`,
        )
      ).trim(),
    ),
    0,
  );
  console.log(
    'Concurrent compatibility confirmations create one schedule and preserve the original retry receipt',
  );
}
