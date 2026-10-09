import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const container = process.env.LOCAL_SUPABASE_CONTAINER ?? 'supabase_db_brock-fantasy';
assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/u);
const created = new Set();
const prefix = `bf_registration_${process.pid}_${Date.now()}`;
const migrations = (await readdir('supabase/migrations')).filter((p) => p.endsWith('.sql')).sort();
const boundary = migrations.indexOf('20261009161432_application_access.sql');
assert.ok(boundary > 0);

async function docker(args, input) {
  const child = exec(
    'docker',
    ['exec', ...(input === undefined ? [] : ['-i']), container, ...args],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (input !== undefined) child.child.stdin.end(input);
  return (await child).stdout;
}
async function sql(db, input) {
  assert.ok(created.has(db), 'SQL is restricted to databases created by this process.');
  return docker(['psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-qAt'], input);
}
async function scaffold(suffix) {
  const db = `${prefix}_${suffix}`;
  await docker(['createdb', '-U', 'postgres', db]);
  created.add(db);
  // Only platform schemas, never user data, are read from the existing local database.
  const platform = await docker([
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--schema-only',
    '--schema=auth',
    '--schema=extensions',
    '--no-owner',
    '--no-privileges',
  ]);
  await sql(
    db,
    `create function public.handle_new_user() returns trigger language plpgsql as $$begin return new; end$$;`,
  );
  await sql(db, platform);
  await sql(
    db,
    `
    drop trigger if exists on_auth_user_created on auth.users;
    drop function public.handle_new_user();
    create publication supabase_realtime;
    grant usage on schema auth,extensions to anon,authenticated,service_role;
    create extension if not exists pgtap with schema extensions;
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
  `,
  );
  return db;
}
async function migrate(db, paths) {
  for (const path of paths)
    await sql(db, `begin;\n${await readFile(`supabase/migrations/${path}`, 'utf8')}\ncommit;`);
}

try {
  const db = await scaffold('suite');
  await migrate(db, migrations);
  let assertions = 0;
  for (const file of (await readdir('supabase/tests'))
    .filter((p) => p.endsWith('.test.sql'))
    .sort()) {
    const output = await sql(
      db,
      `set search_path=public,extensions;\n${await readFile(`supabase/tests/${file}`, 'utf8')}`,
    );
    assert.doesNotMatch(output, /(?:^|\n)not ok\b/u, file);
    const plan = output.match(/(?:^|\n)1\.\.(\d+)(?:\n|$)/u);
    assert.ok(plan, `Missing test plan: ${file}`);
    assertions += Number(plan[1]);
  }
  console.log(`${assertions} pgTAP assertions passed on all migrations.`);

  const concurrentEmail = 'concurrent-enrollment@example.test';
  await Promise.all(
    Array.from({ length: 10 }, () => {
      const hash = () => `decode('${randomBytes(32).toString('hex')}','hex')`;
      return sql(
        db,
        `set role prelaunch_api; select registration_private.enroll('${concurrentEmail}',null,'concurrency-test',${hash()},${hash()},${hash()},'test-only-ciphertext',false);`,
      );
    }),
  );
  const count = await sql(
    db,
    `select json_build_array(
    (select count(*) from registration_private.registrations where email='${concurrentEmail}'),
    (select count(*) from registration_private.signup_receipts),
    (select count(*) from registration_private.consent_events),
    (select count(*) from auth.users));`,
  );
  assert.deepEqual(JSON.parse(count.trim()), [1, 10, 10, 0]);
  console.log(
    'Ten concurrent enrollments persisted one registration, ten receipts/consent events, and no Auth users.',
  );

  const upgrade = await scaffold('upgrade');
  await migrate(upgrade, migrations.slice(0, boundary));
  await sql(
    upgrade,
    `
    insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
    select id,email,now(),now(),jsonb_build_object('display_name',name,'beta_age_eligible',true,
      'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,
      'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
    from (values
      ('96000000-0000-4000-8000-000000000001'::uuid,'tymabee@proton.me','Ty'),
      ('96000000-0000-4000-8000-000000000002'::uuid,'gt22me@brocku.ca','Tarik'),
      ('96000000-0000-4000-8000-000000000003'::uuid,'ethan.greatorex1245@gmail.com','Ethan'),
      ('96000000-0000-4000-8000-000000000004'::uuid,'ci22wd@brocku.ca','Nicholas')
    ) fixture(id,email,name);
    insert into public.user_roles(user_id,role) select id,'admin' from auth.users where email<>'ci22wd@brocku.ca';
    insert into beta_private.admin_role_managers(user_id) values('96000000-0000-4000-8000-000000000001');
    insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
    values('96000000-0000-4000-8000-000000000014','96000000-0000-4000-8000-000000000004','totp','verified',now(),now());
  `,
  );
  const snapshot = `select json_build_object(
    'users',(select json_agg(u order by id) from auth.users u),
    'profiles',(select json_agg(p order by id) from public.profiles p),
    'roles',(select json_agg(r order by user_id,role) from public.user_roles r where user_id<>'96000000-0000-4000-8000-000000000004'),
    'managers',(select json_agg(m order by user_id) from beta_private.admin_role_managers m));`;
  const before = JSON.parse((await sql(upgrade, snapshot)).trim());
  await migrate(upgrade, migrations.slice(boundary));
  assert.deepEqual(JSON.parse((await sql(upgrade, snapshot)).trim()), before);
  const binding = await sql(
    upgrade,
    `select count(*) from beta_private.application_access a
    join auth.users u on u.id=a.user_id where a.email=lower(u.email) and a.revoked_at is null;`,
  );
  assert.equal(Number(binding.trim()), 4);
  assert.equal(
    Number(
      (
        await sql(
          upgrade,
          `select count(*) from public.user_roles where user_id='96000000-0000-4000-8000-000000000004' and role='admin';`,
        )
      ).trim(),
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await sql(
          upgrade,
          `select count(*) from beta_private.admin_role_managers where user_id='96000000-0000-4000-8000-000000000004';`,
        )
      ).trim(),
    ),
    0,
  );
  for (let i = 1; i <= 4; i++) {
    const id = `96000000-0000-4000-8000-00000000000${i}`;
    const matrix = await sql(
      upgrade,
      `begin;
      insert into auth.sessions(id,user_id,aal) values('${id}','${id}','aal2');
      set local request.jwt.claim.sub='${id}';
      set local request.jwt.claims='{"sub":"${id}","role":"authenticated","aal":"aal2","session_id":"${id}"}';
      set local role authenticated;
      select json_build_array(public.can_use_app(),public.current_user_is_admin(),public.can_manage_admin_accounts());
      rollback;`,
    );
    assert.deepEqual(JSON.parse(matrix.trim()), [true, true, i === 1]);
  }
  console.log(
    "Upgrade preserved all four Auth IDs/profiles, Ethan/Tarik/Ty admin roles and Ty's manager record; granted Nicholas regular admin only.",
  );
} finally {
  for (const db of created) {
    assert.ok(db.startsWith(`${prefix}_`) && /^bf_registration_[a-z0-9_]+$/u.test(db));
    await docker(['dropdb', '-U', 'postgres', db]);
  }
}
