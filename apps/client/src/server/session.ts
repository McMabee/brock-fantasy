import { canUseApp } from './app-access';

const ACCESS_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-access' : 'bf_access';
const REFRESH_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bf-refresh' : 'bf_refresh';
const CSRF_COOKIE = 'bf_csrf';

export interface WebActor {
  accessToken: string;
  userId: string;
  aal: 'aal1' | 'aal2';
}
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export function apiConfig(): { url: string; key: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function requestCookie(request: Request, name: string): string | null {
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

function tokenClaims(accessToken: string): Record<string, unknown> {
  try {
    const segment = accessToken.split('.')[1];
    return segment
      ? (JSON.parse(atob(segment.replace(/-/gu, '+').replace(/_/gu, '/'))) as Record<
          string,
          unknown
        >)
      : {};
  } catch {
    return {};
  }
}

export function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    'cache-control': 'no-store, private',
    'content-type': 'application/json; charset=utf-8',
    pragma: 'no-cache',
    vary: 'Cookie',
  });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(body), { status, headers });
}

export function mutationError(request: Request): string | null {
  const configured = process.env.EXPO_PUBLIC_APP_ORIGIN;
  let expectedOrigin = new URL(request.url).origin;
  if (configured) {
    try {
      const value = new URL(configured);
      if (value.protocol !== 'http:' && value.protocol !== 'https:')
        return 'Invalid server origin.';
      expectedOrigin = value.origin;
    } catch {
      return 'Invalid server origin.';
    }
  }
  if (request.headers.get('origin') !== expectedOrigin) return 'Invalid request origin.';
  const csrf = requestCookie(request, CSRF_COOKIE);
  return !csrf || csrf !== request.headers.get('x-csrf-token') ? 'Invalid CSRF token.' : null;
}

export async function actor(request: Request, allowBearer = false): Promise<WebActor | null> {
  const bearer = allowBearer
    ? request.headers.get('authorization')?.match(/^Bearer (\S+)$/u)?.[1]
    : null;
  const accessToken = bearer ?? requestCookie(request, ACCESS_COOKIE);
  const config = apiConfig();
  if (!accessToken || !config) return null;
  const result = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.key, authorization: `Bearer ${accessToken}` },
  });
  if (!result.ok) return null;
  const user = (await result.json()) as { id?: unknown };
  if (typeof user.id !== 'string' || !(await canUseApp(accessToken))) return null;
  return {
    accessToken,
    userId: user.id,
    aal: tokenClaims(accessToken).aal === 'aal2' ? 'aal2' : 'aal1',
  };
}

export async function isAdmin(actorValue: WebActor): Promise<boolean> {
  const config = apiConfig();
  if (!config) return false;
  const role = await fetch(
    `${config.url}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(actorValue.userId)}&role=eq.admin&select=role`,
    { headers: { apikey: config.key, authorization: `Bearer ${actorValue.accessToken}` } },
  );
  return role.ok && ((await role.json()) as unknown[]).length > 0;
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

export function sessionCookies(tokens: AuthTokens): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, tokens.access_token, {
      maxAge: Math.max(60, Math.min(tokens.expires_in ?? 3_600, 3_600)),
    }),
    serializeCookie(REFRESH_COOKIE, tokens.refresh_token, { maxAge: 60 * 60 * 24 * 30 }),
    serializeCookie(CSRF_COOKIE, crypto.randomUUID(), { httpOnly: false, maxAge: 60 * 60 * 24 }),
  ];
}

export function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function text(value: unknown, maximum = 500): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}
