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
}

function factor(rows: unknown): { id: string; verified: boolean } | null {
  if (!rows || typeof rows !== 'object') return null;
  const totp = (rows as { totp?: unknown }).totp;
  if (!Array.isArray(totp) || !totp.length) return null;
  const row = totp[0] as FactorRow;
  return typeof row.id === 'string' ? { id: row.id, verified: row.status === 'verified' } : null;
}

async function adminActor(request: Request) {
  const current = await actor(request);
  return current && (await isAdmin(current)) ? current : null;
}

export const GET: RequestHandler = async (request) => {
  const current = await adminActor(request);
  const config = apiConfig();
  if (!current || !config) return json({ error: 'Administrator access is required.' }, 403);
  const factors = await fetch(`${config.url}/auth/v1/factors`, {
    headers: { apikey: config.key, authorization: `Bearer ${current.accessToken}` },
  });
  if (!factors.ok) return json({ error: 'Unable to load authenticator status.' }, 503);
  return json({ aal: current.aal, factor: factor(await factors.json()) });
};

export const POST: RequestHandler = async (request) => {
  const requestError = mutationError(request);
  if (requestError) return json({ error: requestError }, 403);
  const current = await adminActor(request);
  const config = apiConfig();
  if (!current || !config) return json({ error: 'Administrator access is required.' }, 403);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const body = readObject(parsed);
  const action = body ? text(body.action, 20) : null;
  if (action === 'enroll') {
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
        qrCode: typeof result.totp?.qr_code === 'string' ? result.totp.qr_code : null,
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
};
