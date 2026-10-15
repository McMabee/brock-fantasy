import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const deployment = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.equal(deployment.proxy.entrypoint, 'proxy.ts');
assert.equal(deployment.functions['api/index.js'].includeFiles, 'apps/client/dist/server/**');
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const accessUrl = moduleUrl(
  compile(await readFile('apps/client/src/server/app-access.ts', 'utf8')),
);
const access = await import(accessUrl);
const sessionUrl = moduleUrl(
  compile(await readFile('apps/client/src/server/session.ts', 'utf8')).replace(
    "from './app-access'",
    `from '${accessUrl}'`,
  ),
);
const compiled = compile(await readFile('proxy.ts', 'utf8'))
  .replace(
    "'./config/public-deployment.cjs'",
    JSON.stringify(pathToFileURL(resolve('config/public-deployment.cjs')).href),
  )
  .replace(
    /import \{ next, rewrite \} from '@vercel\/functions';/u,
    "const next=(options)=>new Response(null,{headers:{...options?.headers,'x-test-next':'1'}});const rewrite=url=>new Response(null,{headers:{'x-test-rewrite':url.toString()}});",
  )
  .replace(
    /import \{ requestCookie \} from '[^']+';/u,
    "const requestCookie=(req,name)=>{const pair=(req.headers.get('cookie')??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));return pair?pair.slice(name.length+1):null;};",
  );
const { default: proxy } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const previousEnv = { ...process.env },
  previousFetch = globalThis.fetch;
try {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    VERCEL: '1',
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca',
    EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  });
  const dataApi = await import(
    moduleUrl(
      compile(await readFile('apps/client/src/app/api/data/supabase+api.ts', 'utf8'))
        .replace("from '@/server/session'", `from '${sessionUrl}'`)
        .replace("from '@/server/app-access'", `from '${accessUrl}'`),
    )
  );
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('upstream offline');
  };
  for (const path of [
    '/dashboard',
    '/admin',
    '/draft/00000000-0000-4000-8000-000000000001',
    '/_expo/static/js/web/private.js',
  ]) {
    const response = await proxy(new Request('https://beta.brockfantasy.ca' + path));
    assert.equal(response.headers.get('x-test-next'), '1', path);
  }
  for (const path of [
    '/api/data/supabase',
    '/api/command/make_draft_pick',
    '/api/draft/00000000-0000-4000-8000-000000000001/state',
    '/api/admin/games',
  ]) {
    const response = await proxy(new Request('https://beta.brockfantasy.ca' + path));
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    const authorized = await proxy(
      new Request('https://beta.brockfantasy.ca' + path, {
        headers: { cookie: '__Host-bf-access=fixture' },
      }),
    );
    assert.equal(
      authorized.headers.get('x-test-next'),
      '1',
      'handler must enforce live authorization',
    );
  }
  assert.equal(
    calls,
    0,
    'middleware never calls the database for shells or authenticated API dispatch',
  );
  const asset = await proxy(
    new Request(
      'https://beta.brockfantasy.ca/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js',
    ),
  );
  assert.match(asset.headers.get('cache-control'), /immutable/u);
  const routeAsset = await proxy(
    new Request(
      'https://beta.brockfantasy.ca/_expo/static/js/web/%5Bid%5D-0123456789abcdef0123456789abcdef.js',
    ),
  );
  assert.match(
    routeAsset.headers.get('cache-control'),
    /immutable/u,
    'encoded route filenames remain loadable',
  );
  assert.equal(
    (
      await proxy(
        new Request(
          'https://beta.brockfantasy.ca/_expo/static/js/web/%2fserver-0123456789abcdef0123456789abcdef.js',
        ),
      )
    ).status,
    404,
  );
  for (const host of ['play.brockfantasy.ca', 'branch.vercel.app', 'historical.vercel.app'])
    assert.equal((await proxy(new Request(`https://${host}/auth`))).status, 403);
  Object.assign(process.env, {
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca',
  });
  assert.equal(
    (await proxy(new Request('https://play.brockfantasy.ca/'))).headers.get('x-test-next'),
    '1',
  );
  assert.equal(
    (await proxy(new Request('https://play.brockfantasy.ca/api/data/supabase'))).status,
    401,
  );
  for (const host of ['beta.brockfantasy.ca', 'brockfantasy.ca', 'branch.vercel.app'])
    assert.equal((await proxy(new Request(`https://${host}/auth`))).status, 403);
  Object.assign(process.env, {
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca',
  });
  const signIn = await proxy(
    new Request('https://beta.brockfantasy.ca/auth?returnTo=%2Fdashboard'),
  );
  assert.match(signIn.headers.get('x-test-rewrite'), /api\/auth\/entry/u);
  assert.equal(
    (await proxy(new Request('https://beta.brockfantasy.ca/signup', { method: 'POST' }))).status,
    405,
  );
  assert.equal(
    (await proxy(new Request('https://beta.brockfantasy.ca/tester-activate'))).headers.get(
      'location',
    ),
    '/signup',
  );
  const unavailable = access.withAvailability(async () => {
    await access.canUseApp('fixture');
    return Response.json({ ok: true });
  });
  const response = await unavailable(new Request('https://beta.brockfantasy.ca/api/data/supabase'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '2');
  assert.equal(response.headers.get('set-cookie'), null);
  globalThis.fetch = async () => Response.json(false);
  assert.equal(
    await access.canUseApp('fixture'),
    false,
    'confirmed denial must never become access',
  );
  globalThis.fetch = async () => Response.json(true);
  assert.equal(await access.canUseApp('fixture'), true);
  const upstreamRequests = [];
  let sessionValid = true;
  let eligible = true;
  globalThis.fetch = async (url, options) => {
    upstreamRequests.push({ url, options });
    if (url.endsWith('/auth/v1/user'))
      return Response.json({ id: 'fixture-user' }, { status: sessionValid ? 200 : 401 });
    if (url.endsWith('/rpc/can_use_app')) return Response.json(eligible);
    if (url.endsWith('/rpc/get_player_insights'))
      return Response.json([{ id: 'fixture-athlete', nextProjection: 25 }]);
    throw new Error('Unexpected boundary-test upstream');
  };
  const dataRequest = (path, authenticated = true) =>
    new Request('https://beta.brockfantasy.ca/api/data/supabase?path=' + encodeURIComponent(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { cookie: '__Host-bf-access=fixture' } : {}),
      },
      body: JSON.stringify({ p_pool_id: 'fixture-pool' }),
    });
  assert.equal(
    (await dataApi.POST(dataRequest('/rest/v1/rpc/get_player_insights', false))).status,
    401,
    'insights proxy rejects anonymous requests before contacting Supabase',
  );
  assert.equal(upstreamRequests.length, 0);
  const insights = await dataApi.POST(dataRequest('/rest/v1/rpc/get_player_insights'));
  assert.equal(insights.status, 200, 'the actual browser data handler permits player insights');
  assert.deepEqual(await insights.json(), [{ id: 'fixture-athlete', nextProjection: 25 }]);
  assert.equal(insights.headers.get('cache-control'), 'no-store, private');
  const forwarded = upstreamRequests.find((entry) =>
    entry.url.endsWith('/rpc/get_player_insights'),
  );
  assert.equal(forwarded.options.headers.get('authorization'), 'Bearer fixture');
  assert.equal(forwarded.options.headers.get('apikey'), 'sb_publishable_fixture');
  assert.deepEqual(JSON.parse(forwarded.options.body), { p_pool_id: 'fixture-pool' });
  for (const path of ['/rest/v1/rpc/apply_official_schedule', '/rest/v1/games']) {
    assert.equal((await dataApi.POST(dataRequest(path))).status, 403);
    assert.ok(!upstreamRequests.some((entry) => entry.url.endsWith(path)));
  }
  sessionValid = false;
  assert.equal((await dataApi.POST(dataRequest('/rest/v1/rpc/get_player_insights'))).status, 401);
  sessionValid = true;
  eligible = false;
  assert.equal((await dataApi.POST(dataRequest('/rest/v1/rpc/get_player_insights'))).status, 401);
  for (const name of Object.keys(process.env))
    if (name.startsWith('EXPO_PUBLIC_')) delete process.env[name];
  process.env.VERCEL_GIT_COMMIT_REF = 'main';
  process.env.VERCEL_ENV = 'production';
  assert.equal(proxy(new Request('https://play.brockfantasy.ca/auth')).status, 200);
  assert.equal(proxy(new Request('https://beta.brockfantasy.ca/auth')).status, 403);
  assert.equal(proxy(new Request('https://play.brockfantasy.ca/api/admin/games')).status, 401);
  process.env.VERCEL_GIT_COMMIT_REF = 'beta';
  assert.equal(proxy(new Request('https://beta.brockfantasy.ca/auth')).status, 200);
  assert.equal(proxy(new Request('https://play.brockfantasy.ca/auth')).status, 403);
  console.log(
    'Public shells, cached assets, live private API authorization, participant-token insight forwarding, mutation denial, alternate host denial and retryable 503/session preservation passed.',
  );
} finally {
  globalThis.fetch = previousFetch;
  for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name];
  Object.assign(process.env, previousEnv);
}
