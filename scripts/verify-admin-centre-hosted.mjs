import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// - Detect missing hosted RPCs before releasing a client that depends on them
// - Exercise public availability and denial without reading credentials or private account data
const origin = 'https://play.brockfantasy.ca';
const config = JSON.parse(await readFile('config/public-web.json', 'utf8'));
assert.equal(config.EXPO_PUBLIC_SUPABASE_URL, 'https://fdovowiihxowzatewxgv.supabase.co');
const reads = {
  admin_get_operations: {},
  admin_get_operations_summary: {},
  admin_list_leagues_filtered: {},
  admin_get_ranking_seasons: {},
  admin_get_ranking_review: {},
  admin_list_participant_requests: {},
  get_my_participant_request: { p_request_id: '11111111-1111-4111-8111-111111111111' },
};
const checks = await Promise.all(
  Object.entries(reads).map(async ([rpc, args]) => {
    const path = '/rest/v1/rpc/' + rpc;
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15000),
    };
    const direct = await fetch(config.EXPO_PUBLIC_SUPABASE_URL + path, {
      ...request,
      headers: { ...request.headers, apikey: config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    });
    const result = await direct.json();
    assert.ok(
      [401, 403].includes(direct.status) && result.code === '42501',
      `${rpc} must resolve and deny anonymous access; received ${direct.status}/${result.code ?? 'unknown'}. Check pending migrations and RPC permissions before deploying the client`,
    );
    const proxy = await fetch(
      origin + '/api/data/supabase?path=' + encodeURIComponent(path),
      request,
    );
    assert.equal(proxy.status, 401, `${rpc} proxy anonymous denial`);
    assert.match(proxy.headers.get('cache-control') ?? '', /no-store/u);
    return rpc;
  }),
);
const routes = [
  '/admin',
  '/admin/syncs',
  '/admin/alerts',
  '/admin/audit',
  '/admin/leagues',
  '/admin/rankings',
  '/admin/participants',
];
const pages = await Promise.all(
  routes.map(async (path) => {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, `${path} public shell`);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/u);
    return { path, html: await response.text() };
  }),
);
const dashboard = pages.find((page) => page.path === '/admin').html;
const dashboardAsset = dashboard.match(
  /src="(\/_expo\/static\/js\/web\/admin-[a-f0-9]{32}\.js)"/u,
)?.[1];
assert.ok(dashboardAsset, 'Dashboard references a versioned browser asset');
const assetResponse = await fetch(origin + dashboardAsset, { signal: AbortSignal.timeout(15000) });
assert.equal(assetResponse.status, 200);
assert.ok(
  (await assetResponse.text()).includes('Varsity participants'),
  'Live dashboard includes the corrected action headings',
);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      origin,
      availableRpcs: checks.length,
      anonymousDenials: checks.length * 2,
      publicShells: pages.length,
      dashboardAsset,
      signedInBrowserVerified: false,
    },
    null,
    2,
  ),
);
