import type { RequestHandler } from 'expo-router/server';

export class AppAccessUnavailable extends Error {}

export function withAvailability(handler: RequestHandler): RequestHandler {
  return async (request, params) => {
    try {
      return await handler(request, params);
    } catch (error) {
      if (!(error instanceof AppAccessUnavailable)) throw error;
      console.warn(
        JSON.stringify({
          event: 'brock_app_access_unavailable',
          path: new URL(request.url).pathname,
        }),
      );
      return new Response(
        JSON.stringify({
          error: 'Application access is temporarily unavailable. Reconnecting…',
          code: 'service_unavailable',
        }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store, private',
            'retry-after': '2',
          },
        },
      );
    }
  };
}

export async function canUseApp(accessToken: string): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AppAccessUnavailable('Application access is unavailable.');
  try {
    const result = await fetch(`${url}/rest/v1/rpc/can_use_app`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (result.status === 401 || result.status === 403) return false;
    if (!result.ok) {
      console.warn(
        JSON.stringify({
          event: 'brock_app_access_failed',
          phase: 'eligibility',
          status: result.status,
        }),
      );
      throw new AppAccessUnavailable('Application access is unavailable.');
    }
    const value: unknown = await result.json();
    if (typeof value !== 'boolean')
      throw new AppAccessUnavailable('Application access is unavailable.');
    return value;
  } catch (error) {
    if (!(error instanceof AppAccessUnavailable))
      console.warn(
        JSON.stringify({
          event: 'brock_app_access_failed',
          phase: 'eligibility',
          reason: 'network_or_timeout',
        }),
      );
    throw new AppAccessUnavailable('Application access is unavailable.');
  }
}

export async function adminAccountEmail(email: string): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const credential = process.env.SUPABASE_SECRET_KEY;
  if (!url || !credential) throw new AppAccessUnavailable('Application access is unavailable.');
  const headers: Record<string, string> = {
    apikey: credential,
    'content-type': 'application/json',
  };
  if (!credential.startsWith('sb_secret_')) headers.authorization = `Bearer ${credential}`;
  try {
    const result = await fetch(`${url}/rest/v1/rpc/is_admin_account_email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_email: email }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!result.ok) throw new AppAccessUnavailable('Application access is unavailable.');
    const value: unknown = await result.json();
    if (typeof value !== 'boolean')
      throw new AppAccessUnavailable('Application access is unavailable.');
    return value;
  } catch {
    throw new AppAccessUnavailable('Application access is unavailable.');
  }
}
