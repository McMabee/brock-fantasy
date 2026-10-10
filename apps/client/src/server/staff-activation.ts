import { apiConfig, mutationError, requestCookie } from './session';
import { limitAuthRequest } from './auth-rate-limit';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const staffCookie = () =>
  process.env.NODE_ENV === 'production' ? '__Host-bf-staff-access' : 'bf_staff_access';
const cookie = (name: string, value: string, clear = false) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 900}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store, private' });
  cookies.forEach((v) => headers.append('set-cookie', v));
  return new Response(null, { status: 303, headers });
};
async function provider(path: string, token: string | null, body?: unknown) {
  const config = apiConfig();
  if (!config) throw new Error('Unavailable');
  return fetch(`${config.url}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: config.key,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    cache: 'no-store',
  });
}
async function invited(token: string, id: string) {
  const r = await provider('rest/v1/rpc/admin_invitation_status', token, { p_invitation_id: id });
  if (!r.ok) return false;
  const result = (await r.json()) as { invitationId?: unknown; accepted?: unknown };
  return result.invitationId === id && result.accepted === false;
}
function render(id: string, content: string, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, private',
    vary: 'Cookie',
    'referrer-policy': 'strict-origin',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  cookies.forEach((v) => headers.append('set-cookie', v));
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff Invitation | Brock Fantasy</title><link rel="stylesheet" href="/beta-auth/entry.css"></head><body><header><a href="https://www.brockfantasy.ca">BROCK FANTASY</a><span>STAFF INVITATION</span></header><main data-invitation="${escape(id)}"><h1>Activate Administrator Access</h1><p>Only the verified account named in Ty's invitation can continue. An authenticator is required before administrator access is granted.</p>${content}<nav><a href="/auth">Administrator sign-in</a><a href="https://www.brockfantasy.ca">Return to Landing Page</a></nav></main></body></html>`,
    { status, headers },
  );
}
function form(id: string, csrf: string, action: string, fields: string, label: string) {
  return `<form method="post" action="/api/auth/staff?invitation=${escape(id)}"><input type="hidden" name="csrf" value="${escape(csrf)}"><input type="hidden" name="action" value="${action}">${fields}<button type="submit">${label}</button></form>`;
}
export async function staffActivation(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('invitation');
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) return new Response(null, { status: 404 });
  const csrf = requestCookie(request, 'bf_csrf') ?? crypto.randomUUID();
  const csrfCookie = `bf_csrf=${encodeURIComponent(csrf)}; Path=/; SameSite=Lax; Max-Age=900${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
  const login = (message = '', status = 200) =>
    render(
      id,
      `${message ? `<p role="alert">${escape(message)}</p>` : ''}${form(id, csrf, 'sign-in', '<label>Invited email<input name="email" type="email" maxlength="320" required autocomplete="email"></label><label>Password<input name="password" type="password" maxlength="512" required autocomplete="current-password"></label>', 'Continue with Invited Account')}`,
      status,
      [csrfCookie, cookie(staffCookie(), '', true)],
    );
  try {
    let token = requestCookie(request, staffCookie());
    let fields: URLSearchParams | null = null;
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
        return new Response(null, { status: 400 });
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 8192) return new Response(null, { status: 400 });
      fields = new URLSearchParams(raw);
      if (new Set(fields.keys()).size !== [...fields].length)
        return new Response(null, { status: 400 });
      const checkHeaders = new Headers(request.headers);
      checkHeaders.set('x-csrf-token', fields.get('csrf') ?? '');
      if (mutationError(new Request(request.url, { headers: checkHeaders })))
        return new Response(null, { status: 403 });
      const limit = await limitAuthRequest(request, 'sign-in');
      if (limit.status !== 'allowed')
        return new Response('Please try again shortly.', {
          status: limit.status === 'limited' ? 429 : 503,
          headers: {
            'retry-after': String(limit.retryAfterSeconds),
            'cache-control': 'no-store, private',
          },
        });
      if (fields.get('action') === 'sign-in') {
        const email = fields.get('email')?.trim().toLowerCase(),
          password = fields.get('password');
        if (!email || !password || email.length > 320 || password.length > 512)
          return login('Enter the invited account credentials.', 400);
        const r = await provider('auth/v1/token?grant_type=password', null, { email, password });
        const v = (await r.json().catch(() => null)) as { access_token?: unknown } | null;
        if (!r.ok || typeof v?.access_token !== 'string' || !(await invited(v.access_token, id)))
          return login('This invitation is unavailable for this account.', 403);
        return redirect(`/staff-activate?invitation=${encodeURIComponent(id)}`, [
          cookie(staffCookie(), v.access_token),
          csrfCookie,
        ]);
      }
    } else if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405 });
    if (!token || !(await invited(token, id))) return login();
    const user = await provider('auth/v1/user', token);
    if (!user.ok) return login();
    const details = (await user.json()) as {
      factors?: { id: string; factor_type: string; status: string }[];
    };
    let factor = details.factors?.find((v) => v.factor_type === 'totp' && v.status === 'verified');
    if (fields?.get('action') === 'accept') {
      const r = await provider('rest/v1/rpc/admin_accept_invitation', token, {
        p_invitation_id: id,
      });
      const value = (await r.json().catch(() => null)) as { enabled?: unknown } | null;
      if (r.ok && value?.enabled === true)
        return redirect('/auth', [cookie(staffCookie(), '', true)]);
      return render(
        id,
        '<p role="alert">Verify your authenticator before accepting this invitation.</p>',
        403,
      );
    }
    if (fields?.get('action') === 'verify') {
      const factorId = fields.get('factor'),
        code = fields.get('code');
      if (!factorId || !/^[0-9a-f-]{36}$/iu.test(factorId) || !code || !/^\d{6}$/u.test(code))
        return render(
          id,
          '<p role="alert">Enter a valid authenticator code. Reload to try again.</p>',
          400,
        );
      const challenge = await provider(`auth/v1/factors/${factorId}/challenge`, token, {});
      const ch = (await challenge.json()) as { id?: unknown };
      if (!challenge.ok || typeof ch.id !== 'string') throw new Error('Unavailable');
      const verification = await provider(`auth/v1/factors/${factorId}/verify`, token, {
        challenge_id: ch.id,
        code,
      });
      const value = (await verification.json()) as { access_token?: unknown };
      if (
        !verification.ok ||
        typeof value.access_token !== 'string' ||
        !(await invited(value.access_token, id))
      )
        return render(id, '<p role="alert">Verification failed. Reload to try again.</p>', 400);
      token = value.access_token;
      return render(id, form(id, csrf, 'accept', '', 'Accept Administrator Invitation'), 200, [
        cookie(staffCookie(), token),
      ]);
    }
    let content = '';
    if (!factor) {
      if (fields?.get('action') !== 'enroll')
        return render(id, form(id, csrf, 'enroll', '', 'Set Up Authenticator'), 200, [csrfCookie]);
      for (const pending of details.factors ?? []) {
        if (pending.factor_type !== 'totp' || pending.status !== 'unverified') continue;
        const config = apiConfig()!;
        const removed = await fetch(
          `${config.url}/auth/v1/factors/${encodeURIComponent(pending.id)}`,
          {
            method: 'DELETE',
            headers: { apikey: config.key, authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
            cache: 'no-store',
          },
        );
        if (!removed.ok) throw new Error('Unavailable');
      }
      const r = await provider('auth/v1/factors', token, {
        factor_type: 'totp',
        friendly_name: 'Brock Fantasy administrator',
      });
      const value = (await r.json()) as { id?: unknown; totp?: { secret?: unknown } };
      if (!r.ok || typeof value.id !== 'string' || typeof value.totp?.secret !== 'string')
        throw new Error('Unavailable');
      factor = { id: value.id, factor_type: 'totp', status: 'unverified' };
      content = `<p>Add a time-based account in your authenticator using this setup key:</p><p><code>${escape(value.totp.secret)}</code></p>`;
    }
    return render(
      id,
      `${content}${form(id, csrf, 'verify', `<input type="hidden" name="factor" value="${escape(factor.id)}"><label>Authenticator code<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="one-time-code"></label>`, 'Verify Authenticator')}`,
      200,
      [csrfCookie],
    );
  } catch {
    return render(
      id,
      '<p role="alert">Staff activation is temporarily unavailable. Please try again shortly.</p>',
      503,
    );
  }
}
