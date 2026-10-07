import type { RequestHandler } from 'expo-router/server';
import { ELIGIBILITY_POLICY_VERSION, registrationYearAt } from '@brock-fantasy/domain';
import { limitAuthRequest } from '../../../server/auth-rate-limit';

const ACCESS_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-access' : 'bf_access';
const REFRESH_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-refresh' : 'bf_refresh';
const CSRF_COOKIE = 'bf_csrf';
const encoder = new TextEncoder();

type AuthAction =
  | 'csrf'
  | 'session'
  | 'sign-in'
  | 'sign-up'
  | 'recover'
  | 'refresh'
  | 'sign-out'
  | 'update-password';

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

function config() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase web authentication is not configured.');
  return { url: url.replace(/\/$/u, ''), key };
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  const pair = header
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice(name.length + 1));
  } catch {
    return null;
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly?: boolean; maxAge?: number; clear?: boolean } = {},
): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const httpOnly = options.httpOnly === false ? '' : '; HttpOnly';
  const maxAge = options.clear
    ? '; Max-Age=0'
    : options.maxAge
      ? `; Max-Age=${options.maxAge}`
      : '';
  return `${name}=${encodeURIComponent(options.clear ? '' : value)}; Path=/; SameSite=Lax${secure}${httpOnly}${maxAge}`;
}

function response(body: Record<string, unknown>, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    'cache-control': 'no-store, private',
    'content-type': 'application/json; charset=utf-8',
    pragma: 'no-cache',
    vary: 'Cookie',
  });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(body), { status, headers });
}

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function configuredOrigin(): string | null {
  const configured = process.env.EXPO_PUBLIC_APP_ORIGIN;
  if (!configured) return null;
  try {
    const value = new URL(configured);
    return value.protocol === 'http:' || value.protocol === 'https:' ? value.origin : null;
  } catch {
    return null;
  }
}

function requireSameOrigin(request: Request, requireCsrf: boolean): string | null {
  const origin = request.headers.get('origin');
  const expected = configuredOrigin() ?? requestOrigin(request);
  if (!origin || origin !== expected) return 'Invalid request origin.';
  if (requireCsrf) {
    const supplied = request.headers.get('x-csrf-token');
    const expectedToken = cookie(request, CSRF_COOKIE);
    if (!supplied || !expectedToken || supplied !== expectedToken) return 'Invalid CSRF token.';
  }
  return null;
}

function csrfCookie(): string {
  return serializeCookie(CSRF_COOKIE, crypto.randomUUID(), {
    httpOnly: false,
    maxAge: 60 * 60 * 24,
  });
}

function clearSessionCookies(): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, '', { clear: true }),
    serializeCookie(REFRESH_COOKIE, '', { clear: true }),
    serializeCookie(CSRF_COOKIE, '', { httpOnly: false, clear: true }),
  ];
}

function sessionCookies(tokens: AuthTokens): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, tokens.access_token, {
      maxAge: Math.max(60, Math.min(tokens.expires_in ?? 3_600, 3_600)),
    }),
    serializeCookie(REFRESH_COOKIE, tokens.refresh_token, { maxAge: 60 * 60 * 24 * 30 }),
    csrfCookie(),
  ];
}

async function digest(value: string): Promise<string> {
  const hashed = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(hashed)))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

async function json(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function string(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = config();
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  return fetch(`${url}/auth/v1${path}`, { ...init, headers });
}

async function currentUser(
  accessToken: string,
): Promise<{ id: string; email: string | null; emailConfirmedAt: string | null } | null> {
  const result = await authFetch('/user', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!result.ok) return null;
  const user = (await result.json()) as {
    id?: unknown;
    email?: unknown;
    email_confirmed_at?: unknown;
  };
  return typeof user.id === 'string'
    ? {
        id: user.id,
        email: typeof user.email === 'string' ? user.email : null,
        emailConfirmedAt:
          typeof user.email_confirmed_at === 'string' ? user.email_confirmed_at : null,
      }
    : null;
}

function authError(status: number): Response {
  if (status === 429)
    return response({ error: 'Too many requests. Please wait and try again.' }, 429);
  return response({ error: 'Authentication could not be completed.' }, status >= 500 ? 503 : 401);
}

export const GET: RequestHandler = async (request, params) => {
  const action = params.action as AuthAction;
  if (action === 'csrf') return response({ ok: true }, 200, [csrfCookie()]);
  if (action !== 'session') return response({ error: 'Not found.' }, 404);
  const accessToken = cookie(request, ACCESS_COOKIE);
  if (!accessToken) return response({ user: null });
  const user = await currentUser(accessToken);
  return user ? response({ user }) : response({ user: null }, 200, clearSessionCookies());
};

export const POST: RequestHandler = async (request, params) => {
  const action = params.action as AuthAction;
  if (
    !['sign-in', 'sign-up', 'recover', 'refresh', 'sign-out', 'update-password'].includes(action)
  ) {
    return response({ error: 'Not found.' }, 404);
  }
  const needsCsrf = !['sign-in', 'sign-up', 'recover'].includes(action);
  const originError = requireSameOrigin(request, needsCsrf);
  if (originError) return response({ error: originError }, 403);
  if (action === 'sign-out') {
    const accessToken = cookie(request, ACCESS_COOKIE);
    let globalSignoutConfirmed = false;
    if (accessToken) {
      try {
        const signedOut = await authFetch('/logout', {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(3000),
        });
        globalSignoutConfirmed = signedOut.ok;
      } catch {
        // Local logout remains available during provider/limiter outages.
      }
    }
    return response({ ok: true, globalSignoutConfirmed }, 200, clearSessionCookies());
  }
  const rate = await limitAuthRequest(request, action);
  if (rate.status !== 'allowed') {
    const result = response(
      {
        error:
          rate.status === 'limited'
            ? 'Too many requests. Please try again shortly.'
            : 'Authentication is temporarily unavailable. Please try again shortly.',
      },
      rate.status === 'limited' ? 429 : 503,
    );
    result.headers.set('retry-after', String(rate.retryAfterSeconds));
    return result;
  }
  if (action === 'refresh') {
    const refreshToken = cookie(request, REFRESH_COOKIE);
    if (!refreshToken) return authError(401);
    const refreshed = await authFetch('/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!refreshed.ok) return authError(refreshed.status);
    const tokens = (await refreshed.json()) as AuthTokens;
    const user = await currentUser(tokens.access_token);
    return user ? response({ user }, 200, sessionCookies(tokens)) : authError(401);
  }

  const body = await json(request);
  if (!body) return response({ error: 'Invalid request.' }, 400);

  if (action === 'sign-in') {
    const email = string(body.email, 320)?.trim().toLowerCase();
    const password = string(body.password, 512);
    if (!email || !password) return response({ error: 'Email and password are required.' }, 400);
    const signedIn = await authFetch('/token?grant_type=password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!signedIn.ok) return authError(signedIn.status);
    const tokens = (await signedIn.json()) as AuthTokens;
    const user = await currentUser(tokens.access_token);
    if (!user?.emailConfirmedAt)
      return response(
        { error: 'Verify your email before signing in.' },
        403,
        clearSessionCookies(),
      );
    return response({ user }, 200, sessionCookies(tokens));
  }

  const requestUrl = requestOrigin(request);
  if (action === 'sign-up' || action === 'recover') {
    const email = string(body.email, 320)?.trim().toLowerCase();
    if (!email) return response({ error: 'A valid email is required.' }, 400);
    const verifier =
      crypto.randomUUID().replace(/-/gu, '') + crypto.randomUUID().replace(/-/gu, '');
    const challenge = await digest(verifier);
    const verifierCookie = serializeCookie('bf_pkce', verifier, { maxAge: 60 * 15 });
    const flowCookie = serializeCookie('bf_auth_flow', action, { maxAge: 60 * 15 });
    const redirectTo = `${requestUrl}/api/auth/callback`;
    if (action === 'recover') {
      const recovered = await authFetch(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code_challenge: challenge, code_challenge_method: 's256' }),
      });
      return recovered.ok
        ? response({ ok: true }, 200, [verifierCookie, flowCookie, csrfCookie()])
        : authError(recovered.status);
    }
    const password = string(body.password, 512);
    const displayName = string(body.displayName, 80)?.trim();
    if (!password || password.length < 8 || !displayName)
      return response({ error: 'Display name and an 8+ character password are required.' }, 400);
    if (body.eligibilityAttested !== true)
      return response({ error: 'Confirm that you are 18 or turn 18 this calendar year.' }, 400);
    const signedUp = await authFetch(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        data: {
          display_name: displayName,
          beta_age_eligible: true,
          beta_eligibility_year: registrationYearAt(),
          beta_eligibility_policy_version: ELIGIBILITY_POLICY_VERSION,
        },
        code_challenge: challenge,
        code_challenge_method: 's256',
      }),
    });
    return signedUp.ok
      ? response({ ok: true }, 200, [verifierCookie, flowCookie, csrfCookie()])
      : authError(signedUp.status);
  }

  const accessToken = cookie(request, ACCESS_COOKIE);
  if (!accessToken) return authError(401);
  const password = string(body.password, 512);
  if (!password || password.length < 8)
    return response({ error: 'Use an 8+ character password.' }, 400);
  const updated = await authFetch('/user', {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return updated.ok ? response({ ok: true }, 200) : authError(updated.status);
};
