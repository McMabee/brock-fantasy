import type { RequestHandler } from 'expo-router/server';

import { actor, apiConfig, json } from '@/server/session';

const tables = new Set([
  'athlete_rankings',
  'athlete_season_summaries',
  'athlete_seasons',
  'athletes',
  'audit_log',
  'chat_messages',
  'competitions',
  'draft_picks',
  'draft_queues',
  'drafts',
  'fantasy_teams',
  'games',
  'leagues',
  'lineup_entries',
  'matchups',
  'normalized_player_game_stats',
  'notifications',
  'pool_rankings',
  'roster_entries',
  'roster_slot_rules',
  'scoring_rulesets',
  'fantasy_point_events',
  'sync_errors',
  'sync_runs',
  'trade_items',
  'trades',
  'weekly_projections',
]);
const readRpc = new Set(['get_athlete_adp', 'get_beta_lineup', 'get_league_standings']);

function forwardedHeaders(request: Request, key: string, token: string): Headers {
  const headers = new Headers({ apikey: key, authorization: `Bearer ${token}` });
  for (const name of [
    'accept',
    'accept-profile',
    'content-type',
    'prefer',
    'range',
    'range-unit',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

const handle: RequestHandler = async (request) => {
  const current = await actor(request);
  const config = apiConfig();
  if (!current || !config) return json({ error: 'Authentication is required.' }, 401);
  const raw = new URL(request.url).searchParams.get('path');
  if (!raw || !raw.startsWith('/rest/v1/')) return json({ error: 'Invalid data path.' }, 400);
  const path = new URL(raw, 'http://same-origin.invalid');
  const parts = path.pathname.split('/').filter(Boolean);
  const resource = parts[2];
  const rpcName = resource === 'rpc' ? parts[3] : null;
  const isReadTable = Boolean(resource && tables.has(resource));
  const isReadRpc = Boolean(rpcName && readRpc.has(rpcName));
  const method = request.method.toUpperCase();
  if ((!isReadTable || !['GET', 'HEAD'].includes(method)) && (!isReadRpc || method !== 'POST')) {
    return json({ error: 'Data operation is not allowlisted.' }, 403);
  }
  const upstream = await fetch(`${config.url}${path.pathname}${path.search}`, {
    method,
    headers: forwardedHeaders(request, config.key, current.accessToken),
    ...(method === 'POST' ? { body: await request.text() } : {}),
  });
  const headers = new Headers({
    'cache-control': 'no-store, private',
    pragma: 'no-cache',
    vary: 'Cookie',
    'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
  });
  const count = upstream.headers.get('content-range');
  if (count) headers.set('content-range', count);
  return new Response(method === 'HEAD' ? null : await upstream.text(), {
    status: upstream.status,
    headers,
  });
};

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
