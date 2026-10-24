import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSecureServer, request as secureRequest } from 'node:https';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// - Restrict real Auth and HTTP regression fixtures to the local PostgREST 14 stack
const exec = promisify(execFile);
const config = JSON.parse(
  execFileSync(
    process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  ),
);
const provider = new URL(config.API_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(provider.hostname));
assert.equal(provider.protocol, 'http:');
delete process.env.VERCEL;
process.env.EXPO_PUBLIC_APP_ENV = 'local';
process.env.EXPO_PUBLIC_SUPABASE_URL = provider.origin;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.ANON_KEY;
process.env.SUPABASE_SECRET_KEY = config.SERVICE_ROLE_KEY;
const { default: handler } = await import('../api/index.js');
const clientRoot = path.resolve('apps/client/dist/client');
let certificate, certificateDirectory;
if (process.argv.includes('--browser')) {
  // - Use HTTPS for the actual production cookie contract without weakening session security
  certificateDirectory = await mkdtemp(path.join(tmpdir(), 'brock-recovery-tls-'));
  execFileSync(
    process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(certificateDirectory, 'key.pem'),
      '-out',
      path.join(certificateDirectory, 'cert.pem'),
      '-subj',
      '/CN=localhost',
      '-days',
      '1',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  certificate = {
    key: await readFile(path.join(certificateDirectory, 'key.pem')),
    cert: await readFile(path.join(certificateDirectory, 'cert.pem')),
  };
}
const serve = async (request, response) => {
  try {
    const file = path.resolve(clientRoot, '.' + new URL(request.url, 'http://local').pathname);
    const type = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[path.extname(file)];
    if (file.startsWith(clientRoot + path.sep) && type) {
      response.setHeader('content-type', type);
      response.end(await readFile(file));
    } else await handler(request, response);
  } catch {
    response.writeHead(500).end();
  }
};
const server = certificate ? createSecureServer(certificate, serve) : createServer(serve);
async function appRequest(url, options) {
  if (!certificate) return fetch(url, options);
  return new Promise((resolve, reject) => {
    const request = secureRequest(url, { ...options, ca: certificate.cert }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2)
          headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
      });
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
const suffix = randomUUID();
const users = [];
const clients = [];
const restOnly = process.argv.includes('--rest-only');
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const localId = (name) => `md5(${q(suffix)}||${q(name)})::uuid`;
const helper =
  () => `create or replace function pg_temp.m_id(text)returns uuid language sql immutable as $$
select case when $1~'^user[1-4]$' then (${q(JSON.stringify(users))}::jsonb->>(substring($1,5)::integer-1))::uuid else md5(${q(suffix)}||$1)::uuid end;$$;`;
async function sql(source) {
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
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  task.child.stdin.end(helper() + source);
  return (await task).stdout.trim();
}
async function admin(path, body, method = 'POST') {
  return fetch(provider.origin + '/auth/v1' + path, {
    method,
    headers: {
      apikey: config.SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + config.SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
}
async function rpc(name, payload, index = 0) {
  return fetch(provider.origin + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: config.ANON_KEY,
      authorization: 'Bearer ' + clients[index].token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000),
  });
}
let fixtureCreated = false;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `${certificate ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
  process.env.EXPO_PUBLIC_APP_ORIGIN = origin;
  for (let n = 0; n < 4; n++) {
    const email = `matchup-${randomUUID()}@example.test`,
      password = randomUUID() + '!Aa1';
    const created = await admin('/admin/users', {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: 'Matchup recovery fixture',
        varsity_role: 'none',
        varsity_programs: [],
        beta_age_eligible: true,
        beta_eligibility_year: new Date().getFullYear(),
        beta_eligibility_policy_version: 'brock-beta-eligibility-2026-10-06.1',
      },
    });
    assert.equal(created.status, 200);
    users.push((await created.json()).id);
    if (restOnly) {
      const signed = await admin('/token?grant_type=password', { email, password });
      assert.equal(signed.status, 200);
      clients.push({ token: (await signed.json()).access_token });
      continue;
    }
    const signed = await appRequest(origin + '/api/auth/sign-in', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, eligibilityAttested: true }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(signed.status, 200);
    const cookies = signed.headers.getSetCookie().map((value) => value.split(';')[0]);
    const value = (name) =>
      decodeURIComponent(cookies.find((row) => row.startsWith(name + '=')).slice(name.length + 1));
    clients.push({
      cookie: cookies.join('; '),
      csrf: value('bf_csrf'),
      token: value(
        cookies.some((row) => row.startsWith('__Host-bf-access='))
          ? '__Host-bf-access'
          : 'bf_access',
      ),
    });
  }
  const original = await readFile('supabase/tests/180-backlog-leagues.test.sql', 'utf8');
  const fixture = original
    .slice(
      original.indexOf('insert into public.sports'),
      original.indexOf("select set_config('request.jwt.claim.sub'"),
    )
    .replaceAll('pg_temp.b_id', 'pg_temp.m_id')
    .replaceAll('b0000000-0000-4000-8000-000000000002', await sql(`select ${localId('season')};`))
    .replaceAll('b0000000-0000-4000-8000-000000000003', await sql(`select ${localId('pool')};`))
    .replaceAll("'BACKLOG170'", q(suffix));
  await sql(`begin;
    insert into public.fantasy_seasons(id,label,rule_version,trade_deadline) values(pg_temp.m_id('season'),${q('Recovery ' + suffix)},'fixture',now()+interval '1 year');
    insert into public.player_pools(id,season_id,ruleset_id,name,is_active) values(pg_temp.m_id('pool'),pg_temp.m_id('season'),'b0000000-0000-4000-8000-000000000004','Recovery fixture',true);
    insert into public.fantasy_periods(id,season_id,number,phase,starts_at,ends_at)
    select pg_temp.m_id('period'||n),pg_temp.m_id('season'),n,'regular',now()+make_interval(days=>n*7),now()+make_interval(days=>n*7+6) from generate_series(1,8)n;
    ${fixture}commit;`);
  fixtureCreated = true;
  await sql(`begin;
    insert into public.athletes(id,competition_id,team_id,display_name,position)
    select pg_temp.m_id('reserve'||n),pg_temp.m_id('competition'),pg_temp.m_id('program'),'Recovery reserve '||n,'F'from generate_series(1,9)n;
    insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
    select pg_temp.m_id('reserve'||n),pg_temp.m_id('season'),pg_temp.m_id('competition'),pg_temp.m_id('program'),array['F','D','G','BC','FC','HT','L','S'],true,true from generate_series(1,9)n;
    insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
    select pg_temp.m_id('league'),pg_temp.m_id('team1'),pg_temp.m_id('reserve'||n),code,(case when code='BN'then'bench'else'starter'end)::public.roster_status,'draft'
    from unnest(array['HK_DG','BB_BC','BB_FC','VB_HT','VB_LS','FLEX','BN','BN','BN'])with ordinality x(code,n);commit;`);
  const team = await sql("select pg_temp.m_id('team1');");
  const league = await sql("select pg_temp.m_id('league');");
  const read = await rpc('get_beta_lineup', { p_fantasy_team_id: team });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).entries.length, 10);
  const before = await sql(
    `select jsonb_build_object('rosters',(select jsonb_agg(to_jsonb(r) order by id)from public.roster_entries r where league_id=${q(league)}),'version',(select state_version from public.leagues where id=${q(league)}));`,
  );
  for (let n = 0; n < 12; n++) {
    const started = Date.now();
    const response = await rpc('set_period_lineup', {
      p_fantasy_team_id: team,
      p_entries: [],
      p_expected_version: -1,
      p_idempotency_key: 'stale-' + suffix + n,
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'PT409');
    assert.ok(
      Date.now() - started < 3000,
      'One stale request returns promptly without a retry loop',
    );
  }
  if (!restOnly) {
    const web = await appRequest(origin + '/api/command/set_period_lineup', {
      method: 'POST',
      headers: {
        origin,
        cookie: clients[0].cookie,
        'x-csrf-token': clients[0].csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_fantasy_team_id: team,
        p_entries: [],
        p_expected_version: -1,
        p_idempotency_key: 'web-stale-' + suffix,
      }),
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(web.status, 409);
    assert.equal((await web.json()).code, 'PT409');
  }
  const foreign = await rpc(
    'set_period_lineup',
    {
      p_fantasy_team_id: team,
      p_entries: [],
      p_expected_version: -1,
      p_idempotency_key: 'foreign-' + suffix,
    },
    1,
  );
  assert.equal(foreign.status, 400);
  assert.equal((await foreign.json()).message, 'Team owner access required');
  const after = await sql(
    `select jsonb_build_object('rosters',(select jsonb_agg(to_jsonb(r) order by id)from public.roster_entries r where league_id=${q(league)}),'version',(select state_version from public.leagues where id=${q(league)}));`,
  );
  assert.equal(after, before, 'Rejected saves preserve the roster and concurrency version');
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addCookies(
        clients[0].cookie.split('; ').map((row) => {
          const equal = row.indexOf('=');
          const name = row.slice(0, equal);
          return {
            name,
            value: row.slice(equal + 1),
            url: origin,
            secure: name.startsWith('__Host-') || name.startsWith('__Secure-'),
          };
        }),
      );
      const page = await context.newPage();
      await page.goto(origin + '/lineup-multisport/' + league);
      await page.getByRole('button', { name: 'Move Backlog athlete 1', exact: true }).click();
      await page.getByRole('button', { name: 'Swap with Recovery reserve 7', exact: true }).click();
      await page.getByRole('button', { name: 'Save lineup', exact: true }).click();
      await page
        .getByText('Lineup saved. Future games use these assignments; earned points remain.', {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await sql(
          "select slot_code from public.roster_entries where fantasy_team_id=pg_temp.m_id('team1')and athlete_id=pg_temp.m_id('athlete1')and released_at is null;",
        ),
        'BN',
      );
      console.log(
        'PASS browser through exported API and real Auth/PostgREST to a persisted legal starter/bench swap',
      );
    } finally {
      await browser.close();
    }
  }
  console.log(
    'PASS real Auth sessions, PostgREST 14.5 HTTP409/code propagation, bounded stale requests, unchanged rosters and foreign-owner denial' +
      (restOnly ? '' : ', exported application HTTP409/code propagation'),
  );
} finally {
  if (fixtureCreated)
    await sql(`begin;
    delete from public.audit_log where entity_type='fantasy_team'and entity_id=pg_temp.m_id('team1')::text;
    delete from public.roster_slot_history where roster_entry_id in(select id from public.roster_entries where league_id=pg_temp.m_id('league'));
    delete from public.leagues where id=pg_temp.m_id('league');
    delete from public.athlete_seasons where competition_id=pg_temp.m_id('competition');
    delete from public.athletes where competition_id=pg_temp.m_id('competition');
    delete from public.teams where competition_id=pg_temp.m_id('competition');
    delete from public.competitions where id=pg_temp.m_id('competition');
    delete from public.player_pools where id=pg_temp.m_id('pool');
    delete from public.fantasy_periods where season_id=pg_temp.m_id('season');
    delete from public.fantasy_seasons where id=pg_temp.m_id('season');commit;`);
  for (const user of users)
    assert.equal((await admin('/admin/users/' + user, undefined, 'DELETE')).status, 200);
  await new Promise((resolve) => server.close(resolve));
  if (certificateDirectory) {
    await unlink(path.join(certificateDirectory, 'key.pem'));
    await unlink(path.join(certificateDirectory, 'cert.pem'));
    await rmdir(certificateDirectory);
  }
}
