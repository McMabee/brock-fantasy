import type { RequestHandler } from 'expo-router/server';

const ACCESS_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-access' : 'bf_access';
const commands: Readonly<Record<string, readonly string[]>> = {
  admin_accept_invitation: ['p_invitation_id'],
  admin_set_account_role: ['p_user_id', 'p_enabled', 'p_reason', 'p_idempotency_key'],
  create_beta_league: ['p_name', 'p_pool_id', 'p_max_members', 'p_idempotency_key'],
  start_draft: ['p_league_id', 'p_rounds', 'p_pick_seconds', 'p_idempotency_key'],
  make_draft_pick: [
    'p_draft_id',
    'p_athlete_id',
    'p_idempotency_key',
    'p_source',
    'p_expected_version',
  ],
  set_draft_queue: ['p_draft_id', 'p_athlete_ids', 'p_idempotency_key'],
  set_draft_status: ['p_draft_id', 'p_status', 'p_idempotency_key'],
  set_period_lineup: ['p_fantasy_team_id', 'p_entries', 'p_expected_version', 'p_idempotency_key'],
  add_free_agent: ['p_fantasy_team_id', 'p_athlete_in_id', 'p_athlete_out_id', 'p_idempotency_key'],
  request_waiver: ['p_fantasy_team_id', 'p_athlete_in_id', 'p_athlete_out_id', 'p_idempotency_key'],
  generate_matchup_schedule: ['p_league_id', 'p_starts_at', 'p_cycles', 'p_idempotency_key'],
  get_beta_lineup: ['p_fantasy_team_id'],
  get_athlete_adp: ['p_athlete_id', 'p_pool_id', 'p_league_size'],
  publish_game_revision: [
    'p_game_id',
    'p_expected_version',
    'p_status',
    'p_home_score',
    'p_away_score',
    'p_stats',
    'p_reason',
    'p_source_identity',
    'p_idempotency_key',
  ],
  preview_game_revision: ['p_game_id', 'p_expected_version', 'p_stats'],
  propose_trade: [
    'p_proposing_team_id',
    'p_receiving_team_id',
    'p_offered_athlete_ids',
    'p_requested_athlete_ids',
    'p_expires_at',
    'p_idempotency_key',
  ],
  respond_to_trade: ['p_trade_id', 'p_accept', 'p_idempotency_key'],
  cancel_trade: ['p_trade_id', 'p_idempotency_key'],
  vote_trade: ['p_trade_id', 'p_idempotency_key'],
  mark_notification_read: ['p_notification_id', 'p_idempotency_key'],
  join_league: ['p_invite_code', 'p_team_name', 'p_idempotency_key'],
  post_chat_message: ['p_league_id', 'p_body', 'p_idempotency_key'],
  report_chat_message: ['p_message_id', 'p_reason'],
  mute_chat_user: ['p_league_id', 'p_muted_user_id'],
  set_lineup: ['p_fantasy_team_id', 'p_game_id', 'p_entries', 'p_idempotency_key'],
};

function cookie(request: Request, name: string): string | null {
  const row = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  try {
    return row ? decodeURIComponent(row.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store, private',
      'content-type': 'application/json; charset=utf-8',
      pragma: 'no-cache',
      vary: 'Cookie',
    },
  });
}

function validRequest(request: Request): string | null {
  const expectedOrigin = process.env.EXPO_PUBLIC_APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get('origin') !== expectedOrigin) return 'Invalid request origin.';
  const csrf = cookie(request, 'bf_csrf');
  if (!csrf || csrf !== request.headers.get('x-csrf-token')) return 'Invalid CSRF token.';
  return null;
}

export const POST: RequestHandler = async (request, params) => {
  const name = params.name;
  const allowed = typeof name === 'string' ? commands[name] : undefined;
  if (!allowed) return json({ error: 'Unknown command.' }, 404);
  const requestError = validRequest(request);
  if (requestError) return json({ error: requestError }, 403);
  const accessToken = cookie(request, ACCESS_COOKIE);
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!accessToken || !url || !key) return json({ error: 'Authentication is required.' }, 401);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return json({ error: 'Invalid request.' }, 400);
  const payload = raw as Record<string, unknown>;
  if (Object.keys(payload).some((field) => !allowed.includes(field)))
    return json({ error: 'Unexpected command input.' }, 400);
  const user = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${accessToken}` },
  });
  if (!user.ok) return json({ error: 'Your session has expired.' }, 401);
  const result = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  const response: unknown = await result.json().catch((): null => null);
  if (!result.ok) {
    const errorResponse =
      response && typeof response === 'object' && !Array.isArray(response)
        ? (response as Record<string, unknown>)
        : null;
    const message =
      typeof errorResponse?.message === 'string'
        ? errorResponse.message
        : 'The command could not be completed.';
    return json({ error: message }, result.status === 401 || result.status === 403 ? 403 : 400);
  }
  return json(response);
};
