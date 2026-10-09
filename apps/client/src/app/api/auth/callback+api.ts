import type { RequestHandler } from 'expo-router/server';
import { canUseApp } from '../../../server/app-access';

const ACCESS_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-access' : 'bf_access';
const REFRESH_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-refresh' : 'bf_refresh';

function cookie(request: Request, name: string): string | null {
  const match = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  try {
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

function sessionCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; HttpOnly${secure}; Max-Age=${maxAge}`;
}

function clearPkce(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `bf_pkce=; Path=/; SameSite=Lax; HttpOnly${secure}; Max-Age=0`;
}

function clearFlow(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `bf_auth_flow=; Path=/; SameSite=Lax; HttpOnly${secure}; Max-Age=0`;
}

function redirect(location: URL, cookies: readonly string[] = []): Response {
  const headers = new Headers({
    'cache-control': 'no-store, private',
    location: location.toString(),
  });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 302, headers });
}

export const GET: RequestHandler = async (request) => {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const verifier = cookie(request, 'bf_pkce');
  const flow = cookie(request, 'bf_auth_flow');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!code || !verifier || !url || !key)
    return redirect(new URL('/auth?recovery=invalid', requestUrl), [clearPkce(), clearFlow()]);
  const exchange = await fetch(`${url.replace(/\/$/u, '')}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!exchange.ok)
    return redirect(new URL('/auth?recovery=invalid', requestUrl), [clearPkce(), clearFlow()]);
  const tokens = (await exchange.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string')
    return redirect(new URL('/auth?recovery=invalid', requestUrl), [clearPkce(), clearFlow()]);
  try {
    if (!(await canUseApp(tokens.access_token)))
      return redirect(new URL('/auth?access=denied', requestUrl), [
        clearPkce(),
        clearFlow(),
        sessionCookie(ACCESS_COOKIE, '', 0),
        sessionCookie(REFRESH_COOKIE, '', 0),
      ]);
  } catch {
    return new Response('Application access is temporarily unavailable.', {
      status: 503,
      headers: { 'cache-control': 'no-store, private' },
    });
  }
  return redirect(new URL(flow === 'recover' ? '/reset-password' : '/dashboard', requestUrl), [
    sessionCookie(
      ACCESS_COOKIE,
      tokens.access_token,
      typeof tokens.expires_in === 'number' ? tokens.expires_in : 3_600,
    ),
    sessionCookie(REFRESH_COOKIE, tokens.refresh_token, 60 * 60 * 24 * 30),
    clearPkce(),
    clearFlow(),
  ]);
};
