import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const accessSource = await readFile('apps/client/src/server/app-access.ts', 'utf8');
const js = ts.transpileModule(accessSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const access = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const source = await readFile('proxy.ts', 'utf8');
const compiled = ts
  .transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(
    /import \{ next, rewrite \} from '@vercel\/functions';/u,
    "const next=()=>new Response(null,{headers:{'x-test-next':'1'}});const rewrite=url=>new Response(null,{headers:{'x-test-rewrite':url.toString()}});",
  )
  .replace(/import \{ canUseApp \} from '[^']+';/u, 'const {canUseApp}=globalThis.__testAppAccess;')
  .replace(
    /import \{ requestCookie \} from '[^']+';/u,
    "const requestCookie=(req,name)=>{const pair=(req.headers.get('cookie')??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));return pair?pair.slice(name.length+1):null;};",
  );
globalThis.__testAppAccess = access;
const { default: proxy } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const previousEnv = { ...process.env },
  previousFetch = globalThis.fetch;
try {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  process.env.EXPO_PUBLIC_APP_ENV = 'staging';
  process.env.EXPO_PUBLIC_APP_ORIGIN = 'https://beta.brockfantasy.ca';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fixture';
  let entitled = false,
    upstreamUnavailable = false;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), headers: new Headers(init.headers) });
    if (String(input) === 'https://www.brockfantasy.ca/register')
      return new Response(
        '<form action="https://www.brockfantasy.ca/api/prelaunch/register"></form>',
        { headers: { 'content-type': 'text/html' } },
      );
    assert.equal(String(input), 'https://fixture.supabase.co/rest/v1/rpc/can_use_app');
    return upstreamUnavailable
      ? new Response('unavailable', { status: 503 })
      : Response.json(entitled);
  };
  for (const path of [
    '/dashboard',
    '/admin',
    '/api/data/supabase',
    '/_expo/static/js/web/private.js',
    '/api/index',
    '/auth.html',
    '/signup/',
    '/policies/private.html',
    '/policies/terms-of-use.html/export',
  ]) {
    const response = await proxy(new Request(`https://beta.brockfantasy.ca${path}`));
    assert.equal(response.status, 403, path);
  }
  assert.equal(
    (
      await proxy(
        new Request('https://beta.brockfantasy.ca/dashboard', { headers: { accept: 'text/html' } }),
      )
    ).headers.get('location'),
    '/auth',
  );
  const auth = await proxy(
    new Request(
      'https://beta.brockfantasy.ca/auth?returnTo=%2Fmfa%3Finvitation%3D98000000-0000-4000-8000-000000000001',
    ),
  );
  assert.match(auth.headers.get('x-test-rewrite'), /api\/auth\/entry/u);
  assert.match(auth.headers.get('x-test-rewrite'), /returnTo/u);
  assert.equal(
    (
      await proxy(new Request('https://beta.brockfantasy.ca/policies/terms-of-use.html'))
    ).headers.get('x-test-next'),
    '1',
  );
  assert.equal(
    (
      await proxy(
        new Request('https://beta.brockfantasy.ca/policies/terms-of-use.html', { method: 'POST' }),
      )
    ).status,
    403,
  );
  const signup = await proxy(
    new Request('https://beta.brockfantasy.ca/signup', {
      headers: {
        cookie: '__Host-bf-access=private-fixture',
        authorization: 'Bearer private-fixture',
      },
    }),
  );
  assert.equal(signup.status, 200);
  const sent = calls.at(-1).headers;
  assert.equal(sent.get('cookie'), null);
  assert.equal(sent.get('authorization'), null);
  assert.equal(
    (await proxy(new Request('https://beta.brockfantasy.ca/signup', { method: 'POST' }))).status,
    405,
  );
  for (const host of ['play.brockfantasy.ca', 'branch.vercel.app', 'historical.vercel.app'])
    assert.equal((await proxy(new Request(`https://${host}/auth`))).status, 403);
  const request = new Request('https://beta.brockfantasy.ca/dashboard', {
    headers: { cookie: '__Host-bf-access=fixture-token' },
  });
  assert.equal((await proxy(request)).status, 403);
  entitled = true;
  assert.equal((await proxy(request)).headers.get('x-test-next'), '1');
  entitled = false;
  assert.equal((await proxy(request)).status, 403);
  upstreamUnavailable = true;
  assert.equal((await proxy(request)).status, 503);
  console.log(
    'Beta middleware boundary: anonymous pages/assets/APIs, exact public entry, cookie isolation, alternate hosts, approval, revocation, and outages passed. Platform deployment remains untested.',
  );
} finally {
  globalThis.fetch = previousFetch;
  delete globalThis.__testAppAccess;
  for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name];
  Object.assign(process.env, previousEnv);
}
