import type { RequestHandler } from 'expo-router/server';

import {
  actor,
  apiConfig,
  isAdmin,
  json,
  mutationError,
  readObject,
  sessionCookies,
  text,
  type AuthTokens,
} from '@/server/session';

interface FactorRow {
  id?: unknown;
  status?: unknown;
  factor_type?: unknown;
}

function factors(rows: unknown): FactorRow[] {
  if (!rows || typeof rows !== 'object') return [];
  const entries = (rows as { factors?: unknown }).factors;
  return Array.isArray(entries)
    ? (entries as unknown[]).filter((value): value is FactorRow => {
        const row = readObject(value);
        return Boolean(row && row.factor_type === 'totp' && typeof row.id === 'string');
      })
    : [];
}

async function userFactors(accessToken: string): Promise<FactorRow[] | null> {
  const config = apiConfig();
  if (!config) return null;
  // Supabase's listFactors API reads factors from the authenticated user.
  // GET /auth/v1/factors is not a supported Auth endpoint.
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.key, authorization: `Bearer ${accessToken}` },
  });
  return response.ok ? factors(await response.json()) : null;
}

export const GET: RequestHandler = async (request) => {
  try {
    const current = await actor(request);
    if (!current) return json({ error: 'Sign in to manage your authenticator.' }, 401);
    const entries = await userFactors(current.accessToken);
    if (!entries) return json({ error: 'Unable to load authenticator status.' }, 503);
    const verified = entries.find((row) => row.status === 'verified');
    return json({
      aal: current.aal,
      hasAdminRole: await isAdmin(current),
      factor: verified ? { id: verified.id, verified: true } : null,
      enrollmentPending: entries.some((row) => row.status === 'unverified'),
    });
  } catch {
    return json({ error: 'Unable to load authenticator status. Try again shortly.' }, 503);
  }
};

export const POST: RequestHandler = async (request) => {
  const requestError = mutationError(request);
  if (requestError) return json({ error: requestError }, 403);
  try {
    const current = await actor(request);
    const config = apiConfig();
    if (!current || !config) return json({ error: 'Sign in to manage your authenticator.' }, 401);
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    const body = readObject(parsed);
    const action = body ? text(body.action, 20) : null;
    if (action === 'enroll') {
      const entries = await userFactors(current.accessToken);
      if (!entries) return json({ error: 'Unable to load authenticator status.' }, 503);
      if (entries.some((row) => row.status === 'verified'))
        return json({ error: 'An authenticator is already enrolled. Refresh and verify it.' }, 409);
      // Restart only incomplete factors belonging to this user. Verified factors
      // are never removed by enrollment, and the browser explicitly starts setup.
      for (const pending of entries.filter((row) => row.status === 'unverified')) {
        const removed = await fetch(
          `${config.url}/auth/v1/factors/${encodeURIComponent(String(pending.id))}`,
          {
            method: 'DELETE',
            headers: { apikey: config.key, authorization: `Bearer ${current.accessToken}` },
          },
        );
        if (!removed.ok)
          return json({ error: 'Incomplete authenticator setup could not be restarted.' }, 503);
      }
      const response = await fetch(`${config.url}/auth/v1/factors`, {
        method: 'POST',
        headers: {
          apikey: config.key,
          authorization: `Bearer ${current.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Brock Fantasy administrator' }),
      });
      const result = (await response.json().catch(() => null)) as {
        id?: unknown;
        totp?: { qr_code?: unknown; secret?: unknown };
      } | null;
      if (!response.ok || !result || typeof result.id !== 'string') {
        return json({ error: 'Authenticator enrollment could not be started.' }, 400);
      }
      return json({
        factor: {
          id: result.id,
          verified: false,
          qrCode:
            typeof result.totp?.qr_code === 'string'
              ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.totp.qr_code)}`
              : null,
          secret: typeof result.totp?.secret === 'string' ? result.totp.secret : null,
        },
      });
    }
    if (action !== 'verify') return json({ error: 'Unknown MFA action.' }, 404);
    const factorId = text(body?.factorId, 100);
    const code = text(body?.code, 6);
    if (!factorId || !/^[0-9a-f-]{36}$/iu.test(factorId) || !code || !/^\d{6}$/u.test(code)) {
      return json({ error: 'Enter a valid authenticator code.' }, 400);
    }
    const challenge = await fetch(
      `${config.url}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`,
      {
        method: 'POST',
        headers: {
          apikey: config.key,
          authorization: `Bearer ${current.accessToken}`,
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );
    const challengeValue = (await challenge.json().catch(() => null)) as { id?: unknown } | null;
    if (!challenge.ok || !challengeValue || typeof challengeValue.id !== 'string') {
      return json({ error: 'Authenticator challenge could not be created.' }, 400);
    }
    const verification = await fetch(
      `${config.url}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
      {
        method: 'POST',
        headers: {
          apikey: config.key,
          authorization: `Bearer ${current.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ challenge_id: challengeValue.id, code }),
      },
    );
    const tokens = (await verification.json().catch(() => null)) as AuthTokens | null;
    if (!verification.ok || !tokens?.access_token || !tokens.refresh_token) {
      return json({ error: 'Authenticator verification failed.' }, 400);
    }
    return json({ ok: true, aal: 'aal2' }, 200, sessionCookies(tokens));
  } catch {
    return json({ error: 'Authenticator service is unavailable. Try again shortly.' }, 503);
  }
};
