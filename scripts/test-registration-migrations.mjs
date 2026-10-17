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
  const platformDump = await docker([
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
  // Application-owned Auth triggers are recreated by the migrations below.
  const platform = platformDump.replace(/^CREATE TRIGGER confirm_account_news[^;]+;\s*$/gmu, '');
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
    -- pg_cron can only install in its configured database. This isolated test
    -- records schedules without launching background jobs or changing the host.
    create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
    $$;
  `,
  );
  return db;
}
async function migrate(db, paths) {
  for (const path of paths)
    await sql(
      db,
      `begin;\n${(await readFile(`supabase/migrations/${path}`, 'utf8')).replace(/^create extension if not exists pg_cron with schema pg_catalog;$/gmu, '')}\ncommit;`,
    );
}

try {
  const db = await scaffold('suite');
  await migrate(db, migrations);
  if (process.env.BROCK_TEST_ADVISORS === '1') {
    const result = await exec(
      process.execPath,
      [
        'node_modules/supabase/dist/supabase.js',
        'db',
        'advisors',
        '--db-url',
        `postgresql://postgres:postgres@127.0.0.1:54322/${db}`,
        '--type',
        'security',
        '--level',
        'error',
        '--fail-on',
        'error',
      ],
      { encoding: 'utf8' },
    );
    console.log(result.stdout.trim());
  }
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
  console.log(
    `${assertions} pgTAP assertions passed on all migrations (cron schedules recorded, background execution excluded).`,
  );
  if (process.env.BROCK_TEST_EXTRA_SQL) {
    const output = await sql(db, await readFile(process.env.BROCK_TEST_EXTRA_SQL, 'utf8'));
    console.log(output.trim());
  }
  if (process.env.BROCK_TEST_FLEX_UPGRADE_SQL) {
    const flex = migrations.findIndex((name) =>
      name.endsWith('_flex_game_lineups_and_schedule_review.sql'),
    );
    assert.ok(flex > 0);
    const prior = await scaffold('flex_upgrade');
    await migrate(prior, migrations.slice(0, flex));
    const fixture = await readFile(process.env.BROCK_TEST_FLEX_UPGRADE_SQL, 'utf8');
    assert.ok(fixture.includes("rollback;select 'public-beta-rehearsal-passed';"));
    await sql(
      prior,
      fixture.replace(
        "rollback;select 'public-beta-rehearsal-passed';",
        "commit;select 'retained-upgrade-fixture';",
      ),
    );
    await sql(
      prior,
      `
      create table public.fixture_before_rosters as select * from public.roster_entries;
      create table public.fixture_before_picks as select * from public.draft_picks;
      insert into public.fantasy_point_events(league_id,fantasy_team_id,athlete_id,game_id,ruleset_id,stat_key,stat_value,points,kind,source_identity)
      select r.league_id,r.fantasy_team_id,r.athlete_id,g.id,l.ruleset_id,'skater.goals',1,20,'score','preserved-upgrade-event'
      from public.roster_entries r join public.leagues l on l.id=r.league_id
      join public.athletes a on a.id=r.athlete_id join public.games g on g.competition_id=a.competition_id
      where r.slot_code='HK_F' limit 1;
    `,
    );
    await migrate(prior, migrations.slice(flex));
    await sql(
      prior,
      `do $$ begin
      if (select count(*) from public.draft_picks)<>140 or exists(
        (select * from public.fixture_before_picks except select * from public.draft_picks)
        union all (select * from public.draft_picks except select * from public.fixture_before_picks)
      ) then raise exception 'Upgrade changed draft history'; end if;
      if exists(select fantasy_team_id from public.roster_entries where released_at is null group by fantasy_team_id
        having count(*)<>10 or count(*) filter(where status='starter')<>7 or count(*) filter(where slot_code='BN')<>3
          or count(*) filter(where slot_code='FLEX')<>1) then raise exception 'Upgrade did not preserve legal ten-athlete rosters'; end if;
      if exists(select b.id from public.fixture_before_rosters b left join public.roster_entries r on r.id=b.id and r.athlete_id=b.athlete_id
        and r.fantasy_team_id=b.fantasy_team_id where r.id is null) then raise exception 'Upgrade changed roster ownership'; end if;
      if (select sum(points) from public.fantasy_point_events where source_identity='preserved-upgrade-event')<>20 then raise exception 'Upgrade changed earned points'; end if;
      if exists(select 1 from public.fantasy_teams t join public.leagues l on l.id=t.league_id
        cross join lateral (select b.athlete_id from public.fixture_before_rosters b
          join public.athletes a on a.id=b.athlete_id left join beta_private.next_period_projections(l.pool_id) q on q.athlete_id=b.athlete_id
          where b.fantasy_team_id=t.id and b.slot_code='BN' order by q.points desc nulls last,q.season_points desc nulls last,a.display_name,b.id limit 1) expected
        where not exists(select 1 from public.roster_entries r where r.fantasy_team_id=t.id and r.athlete_id=expected.athlete_id and r.slot_code='FLEX')) then raise exception 'Upgrade did not choose the highest next-period projected reserve'; end if;
    end $$;`,
    );
    console.log(
      'Upgrade preserved 140 picks, all 140 owned athletes and earned points; every team received the highest-projected reserve in FLEX',
    );
  }

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

  if (process.env.BROCK_TEST_REST === '1') {
    const { verifyLeagueRosterRest } = await import('./lib/league-roster-rest.mjs');
    await verifyLeagueRosterRest({
      database: db,
      databaseContainer: container,
      executeSql: (input) => sql(db, input),
    });
  }

  const upgrade = await scaffold('upgrade');
  await migrate(upgrade, migrations.slice(0, boundary));
  await sql(
    upgrade,
    `
    insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
    select id,email,now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,
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
  // - Account flags default to non-varsity while existing identity and role data stay intact
  before.profiles = before.profiles.map((profile) => ({ ...profile, is_varsity: false }));
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
  const { verifyParticipationConcurrency } = await import('./lib/varsity-participation-local.mjs');
  await verifyParticipationConcurrency({
    database: db,
    databaseContainer: container,
    executeSql: (input) => sql(db, input),
  });
} finally {
  for (const db of created) {
    assert.ok(db.startsWith(`${prefix}_`) && /^bf_registration_[a-z0-9_]+$/u.test(db));
    await docker(['dropdb', '-U', 'postgres', db]);
  }
}
