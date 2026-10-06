import type { RequestHandler } from 'expo-router/server';

const accessCookie = process.env.NODE_ENV === 'production' ? '__Host-bf-access' : 'bf_access';

function cookie(request: Request, name: string): string | null {
  const item = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  try {
    return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

function result(body: Record<string, unknown>, status = 200): Response {
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

function message(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === 'string' ? error : null;
}

export const POST: RequestHandler = async (request) => {
  const expectedOrigin = process.env.EXPO_PUBLIC_APP_ORIGIN || new URL(request.url).origin;
  const csrf = cookie(request, 'bf_csrf');
  const token = cookie(request, accessCookie);
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (
    request.headers.get('origin') !== expectedOrigin ||
    !csrf ||
    csrf !== request.headers.get('x-csrf-token')
  )
    return result({ error: 'Invalid request origin or CSRF token.' }, 403);
  if (!token || !url || !key) return result({ error: 'Authentication is required.' }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return result({ error: 'Invalid import payload.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return result({ error: 'Invalid import payload.' }, 400);
  const upstream = await fetch(`${url}/functions/v1/ingest-sports-data`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await upstream.json().catch((): unknown => ({}));
  const upstreamError = message(payload);
  return result(
    upstream.ok ? { data: payload } : { error: upstreamError ?? 'Import rejected.' },
    upstream.status,
  );
};
