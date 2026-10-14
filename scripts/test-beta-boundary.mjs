import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const deployment = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.equal(deployment.proxy.entrypoint, 'proxy.ts');
assert.equal(deployment.functions['api/index.js'].includeFiles, 'apps/client/dist/server/**');
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const access = await import(
  `data:text/javascript;base64,${Buffer.from(compile(await readFile('apps/client/src/server/app-access.ts', 'utf8'))).toString('base64')}`
);
const compiled = compile(await readFile('proxy.ts', 'utf8'))
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
  console.log(
    'Public shells and cached assets survive database outages; private API authentication, alternate host denial, trusted eligibility and retryable 503/session preservation passed.',
  );
} finally {
  globalThis.fetch = previousFetch;
  for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name];
  Object.assign(process.env, previousEnv);
}
