import { AppAccessUnavailable } from './app-access';

export function associationOrigin(): string {
  const origin = process.env.PUBLIC_REGISTRATION_ORIGIN ?? 'https://www.brockfantasy.ca';
  const local = process.env.EXPO_PUBLIC_APP_ENV === 'local' && process.env.VERCEL !== '1';
  if (!local && origin !== 'https://www.brockfantasy.ca')
    throw new AppAccessUnavailable('Account confirmation is unavailable.');
  return new URL(origin).origin;
}
export async function signupHandoff(userId: string, email: string): Promise<string> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '');
  const credential = process.env.SUPABASE_SECRET_KEY;
  if (!url || !credential) throw new AppAccessUnavailable('Account confirmation is unavailable.');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const ticket = btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket)),
  );
  const headers: Record<string, string> = {
    apikey: credential,
    'content-type': 'application/json',
  };
  if (!credential.startsWith('sb_secret_')) headers.authorization = `Bearer ${credential}`;
  const result = await fetch(`${url}/rest/v1/rpc/issue_account_signup_handoff`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_user_id: userId,
      p_email: email,
      p_hash: Array.from(hash, (v) => v.toString(16).padStart(2, '0')).join(''),
    }),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    cache: 'no-store',
  }).catch(() => null);
  if (!result?.ok) throw new AppAccessUnavailable('Account confirmation is unavailable.');
  return ticket;
}
export function handoffPage(ticket: string, cookies: readonly string[] = []): Response {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(ticket))
    throw new AppAccessUnavailable('Account confirmation is unavailable.');
  const origin = associationOrigin();
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, private',
    'referrer-policy': 'strict-origin',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; style-src 'self'; script-src 'self'; form-action ${origin}; base-uri 'none'; frame-ancestors 'none'`,
  });
  cookies.forEach((cookie) => headers.append('set-cookie', cookie));
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account Registered | Brock Fantasy</title><link rel="stylesheet" href="/beta-auth/entry.css"><script src="/beta-auth/complete-signup.js" defer></script></head><body><header><a href="${origin}">BROCK FANTASY</a><span>PRIVATE BETA</span></header><main><h1>Thanks for Signing Up!</h1><p>Continue to your confirmation and optional email preferences.</p><form id="complete-signup" method="post" action="${origin}/api/prelaunch/complete-signup"><input type="hidden" name="receipt" value="${ticket}"><button type="submit">Continue</button></form></main></body></html>`,
    { headers },
  );
}
