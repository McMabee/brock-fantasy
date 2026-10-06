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

function payload(accessToken: string): Record<string, unknown> {
  try {
    const part = accessToken.split('.')[1];
    return part
      ? (JSON.parse(atob(part.replace(/-/gu, '+').replace(/_/gu, '/'))) as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function response(body: Record<string, unknown>, status = 200): Response {
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

export const GET: RequestHandler = async (request) => {
  const token = cookie(request, accessCookie);
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key)
    return response({ authenticated: false, hasAdminRole: false, isAdmin: false, aal: 'aal1' });
  const userResult = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${token}` },
  });
  if (!userResult.ok)
    return response({ authenticated: false, hasAdminRole: false, isAdmin: false, aal: 'aal1' });
  const user = (await userResult.json()) as { id?: unknown };
  const claims = payload(token);
  const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
  if (typeof user.id !== 'string')
    return response({ authenticated: false, hasAdminRole: false, isAdmin: false, aal });
  const roles = await fetch(
    `${url}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(user.id)}&role=eq.admin&select=role`,
    { headers: { apikey: key, authorization: `Bearer ${token}` } },
  );
  const records = roles.ok ? ((await roles.json()) as unknown[]) : [];
  const hasAdminRole = records.length > 0;
  return response({
    authenticated: true,
    hasAdminRole,
    isAdmin: hasAdminRole && aal === 'aal2',
    aal,
  });
};
