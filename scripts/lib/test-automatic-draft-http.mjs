import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export async function verifyAutomaticDraftHttp({ database, databaseContainer, executeSql }) {
  assert.match(database, /^bf_registration_[a-z0-9_]+$/u);
  const name = 'brock-auto-rest-' + randomUUID();
  const secret = randomUUID() + randomUUID();
  const inspect = JSON.parse(
    (await exec('docker', ['inspect', databaseContainer], { windowsHide: true })).stdout,
  )[0];
  const network = Object.keys(inspect.NetworkSettings.Networks)[0];
  assert.ok(network);
  const sql = (source) =>
    executeSql(
      `create or replace function pg_temp.v_id(text)returns uuid language sql immutable as $$select md5('varsity-fixture:'||$1)::uuid$$;\n` +
        source,
    );
  let started = false;
  let fixtureCreated = false;
  try {
    const tests = await readFile('supabase/tests/240-scheduled-automatic-drafts.test.sql', 'utf8');
    const fixture = tests
      .slice(0, tests.indexOf('create temp table preferred'))
      .replace('begin;', '')
      .replace('create function pg_temp.v_id', 'create or replace function pg_temp.v_id');
    await sql(
      'begin;' +
        fixture +
        'update beta_private.release_controls set automatic_drafts_enabled=true,mode_selection_required=true;commit;',
    );
    fixtureCreated = true;
    const id = async (key) => (await sql("select pg_temp.v_id('" + key + "');")).trim();
    const league = await id('league');
    const users = await Promise.all([1, 2, 5].map((n) => id('user' + n)));
    const preferred = (
      await sql(
        "select r.athlete_id from public.pool_rankings r join public.athlete_seasons s on s.athlete_id=r.athlete_id where r.pool_id=pg_temp.v_id('pool')and s.competition_id=pg_temp.v_id('mens_volleyball')order by r.rank desc limit 1;",
      )
    ).trim();
    // - Tokens are scoped to real fixture session rows in this disposable PostgREST database
    const jwt = (user) => {
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned =
        encode({ alg: 'HS256', typ: 'JWT' }) +
        '.' +
        encode({
          sub: user,
          role: 'authenticated',
          aal: 'aal1',
          session_id: user,
          exp: Math.floor(Date.now() / 1000) + 600,
        });
      return unsigned + '.' + createHmac('sha256', secret).update(unsigned).digest('base64url');
    };
    await exec(
      'docker',
      [
        'run',
        '-d',
        '--rm',
        '--name',
        name,
        '--network',
        network,
        '-p',
        '127.0.0.1::3000',
        '-e',
        'PGRST_DB_URI',
        '-e',
        'PGRST_DB_ANON_ROLE=anon',
        '-e',
        'PGRST_JWT_SECRET',
        'public.ecr.aws/supabase/postgrest:v14.5',
      ],
      {
        windowsHide: true,
        env: {
          ...process.env,
          PGRST_DB_URI: `postgresql://postgres:postgres@${databaseContainer}:5432/${database}`,
          PGRST_JWT_SECRET: secret,
        },
        timeout: 60000,
      },
    );
    started = true;
    const port = (await exec('docker', ['port', name, '3000/tcp'], { windowsHide: true })).stdout
      .trim()
      .split(':')
      .at(-1);
    const origin = 'http://127.0.0.1:' + port;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) break;
      } catch {
        /* - Await only this disposable server */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    let calls = 0;
    const rpc = async (command, payload, index = 0, status = 200) => {
      calls++;
      const response = await fetch(origin + '/rpc/' + command, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + jwt(users[index]),
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body;
    };
    const key = () => `bf2:${Date.now()}:${randomUUID()}`;
    const version = Number(
      await sql("select state_version from public.leagues where id=pg_temp.v_id('league');"),
    );
    const config = {
      p_league_id: league,
      p_mode: 'scheduled_auto',
      p_scheduled_for: new Date(Date.now() + 3600000).toISOString(),
      p_expected_version: version,
      p_idempotency_key: key(),
    };
    await rpc('configure_league_draft', config, 1, 403);
    await rpc('configure_league_draft', config);
    await rpc('configure_league_draft', config);
    const payload = { p_league_id: league, p_athlete_ids: [preferred], p_expected_version: 0 };
    const saved = await rpc('save_draft_preferences', { ...payload, p_idempotency_key: key() });
    assert.equal(saved.version, 1);
    const conflict = await rpc(
      'save_draft_preferences',
      { ...payload, p_idempotency_key: key() },
      0,
      409,
    );
    assert.equal(conflict.code, 'PT409');
    assert.deepEqual(
      (await rpc('get_league_draft_setup', { p_league_id: league }, 1)).preferences,
      [],
    );
    await rpc('get_league_draft_setup', { p_league_id: league }, 2, 403);
    await sql(
      "update public.leagues set draft_scheduled_for=clock_timestamp()-interval '1 second'where id=pg_temp.v_id('league');",
    );
    await Promise.all([
      sql('select public.process_expired_drafts(25);'),
      sql('select public.process_expired_drafts(25);'),
    ]);
    const draft = await sql(
      "select id from public.drafts where league_id=pg_temp.v_id('league')and voided_at is null;",
    );
    const before = Number(
      await sql(`select count(*)from public.draft_picks where draft_id='${draft.trim()}';`),
    );
    assert.ok(before > 0 && before <= 10);
    assert.equal(
      (
        await sql("select count(*)from public.matchups where league_id=pg_temp.v_id('league');")
      ).trim(),
      '0',
    );
    await rpc('set_draft_status', {
      p_draft_id: draft.trim(),
      p_status: 'paused',
      p_idempotency_key: key(),
    });
    await sql('select public.process_expired_drafts(25);');
    assert.equal(
      Number(await sql(`select count(*)from public.draft_picks where draft_id='${draft.trim()}';`)),
      before,
    );
    await rpc('set_draft_status', {
      p_draft_id: draft.trim(),
      p_status: 'active',
      p_idempotency_key: key(),
    });
    await rpc(
      'make_draft_pick',
      {
        p_draft_id: draft.trim(),
        p_athlete_id: preferred,
        p_idempotency_key: key(),
        p_source: 'commissioner',
        p_expected_version: null,
      },
      0,
      400,
    );
    const elapsed = [];
    for (let i = 0; i < 40; i++) {
      if (
        (await sql(`select status from public.drafts where id='${draft.trim()}';`)).trim() ===
        'complete'
      )
        break;
      const start = Date.now();
      await sql('select public.process_expired_drafts(25);');
      elapsed.push(Date.now() - start);
    }
    const final = JSON.parse(
      await sql(
        `select jsonb_build_object('status',status,'picks',(select count(*)from public.draft_picks where draft_id=d.id),'unique',(select count(distinct athlete_id)from public.draft_picks where draft_id=d.id))from public.drafts d where id='${draft.trim()}';`,
      ),
    );
    assert.deepEqual(final, { status: 'complete', picks: 40, unique: 40 });
    assert.equal(
      (
        await sql(
          "select athlete_id from public.draft_picks where fantasy_team_id=pg_temp.v_id('team1')order by overall_pick limit 1;",
        )
      ).trim(),
      preferred,
    );
    assert.equal(
      (
        await sql(
          "select count(*)from public.matchups where league_id=pg_temp.v_id('league')and period=1;",
        )
      ).trim(),
      '0',
    );
    assert.ok(
      elapsed.every((ms) => ms < 6500),
      'bounded worker ticks must stay near their five-second work budget',
    );
    console.log(
      `PASS disposable PostgREST 14.5: ${calls} real HTTP requests, private preferences, prompt 409, duplicate workers, pause/resume, 40 unique committed picks, no premature/historical matchups; maximum tick ${Math.max(...elapsed)} ms`,
    );
  } finally {
    if (started) await exec('docker', ['stop', name], { windowsHide: true });
    if (fixtureCreated)
      await sql(`do $$declare item record;more boolean;begin
      for item in select * from(values('public.leagues','t.id=pg_temp.v_id(''league'')'),('public.player_pools','t.id=pg_temp.v_id(''pool'')'),('public.competitions','t.season_label=''varsity-fixture'''),('auth.users','t.id in(select pg_temp.v_id(''user''||n)from generate_series(1,9)n)'))v(relation,condition)loop
        loop
          perform beta_private.expire_tree(item.relation::regclass,item.condition,500,clock_timestamp());
          execute format('select exists(select 1 from %s t where %s)',item.relation::regclass,item.condition)into more;
          exit when not more;
        end loop;
      end loop;
      update beta_private.release_controls set automatic_drafts_enabled=false,mode_selection_required=false;
    end$$;`);
  }
}
