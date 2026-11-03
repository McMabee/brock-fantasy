import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export async function verifyMatchupRolloverConcurrency({
  database,
  databaseContainer,
  executeSql,
}) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  assert.match(databaseContainer, /^supabase_db_[a-zA-Z0-9_-]+$/u);
  const source = await readFile('supabase/tests/310-matchup-rollover.test.sql', 'utf8');
  const fixture = source
    .slice(0, source.indexOf('select ok(not has_function_privilege'))
    .replace('select no_plan();', '')
    .replaceAll('pg_temp.r_id', 'public.rollover_concurrency_id');
  await executeSql(`${fixture}commit;`);
  const worker = spawn(
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
    errors = '',
    resolveReady,
    rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = new Promise((resolve, reject) => {
    worker.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('rollover-locks-held')) resolveReady();
    });
    worker.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    worker.on('error', (error) => {
      rejectReady(error);
      reject(error);
    });
    worker.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error(errors);
        rejectReady(error);
        reject(error);
      }
    });
  });
  // - Keep the first transaction open until a competing worker has finished
  worker.stdin.write(
    "begin; set local role service_role; select public.advance_matchup_periods(1000); select 'rollover-locks-held';\n",
  );
  try {
    await ready;
    const competing = await executeSql(
      'set role service_role; select public.advance_matchup_periods(1000);',
    );
    assert.deepEqual(JSON.parse(competing.trim()), { activated: 0, finalized: 0 });
    worker.stdin.end('commit;\n');
    await done;
    const repeated = await executeSql('select public.advance_matchup_periods(1000);');
    assert.deepEqual(JSON.parse(repeated.trim()), { activated: 0, finalized: 0 });
    console.log(
      'Concurrent rollover skips locked pairings without duplicate transitions; the following tick is idempotent',
    );
  } finally {
    if (!worker.stdin.writableEnded) worker.stdin.end('rollback;\n');
    await done;
  }
}
