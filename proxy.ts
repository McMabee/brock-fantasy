import { next, rewrite } from '@vercel/functions';
import { canUseApp } from './apps/client/src/server/app-access';
import { requestCookie } from './apps/client/src/server/session';

const headers = { 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff' };
const entries: Record<string, string> = {
  '/auth': 'sign-in',
  '/tester-activate': 'activate',
  '/forgot-password': 'recover',
  '/reset-password': 'reset',
};
const publicActions = new Map<string, readonly string[]>([
  ['/api/auth/entry', ['GET', 'HEAD']],
  ['/api/auth/callback', ['GET', 'HEAD']],
  ['/api/auth/csrf', ['GET']],
  ['/api/auth/session', ['GET']],
  ...['sign-in', 'sign-up', 'recover', 'refresh', 'sign-out', 'update-password'].map(
    (action) => [`/api/auth/${action}`, ['POST']] as const,
  ),
]);
const policyPaths = new Set(
  [
    'terms-of-use',
    'privacy-notice',
    'support-policy',
    'gambling-policy',
    'delayed-data-notice',
    'data-rights-statement',
    'data-retention-schedule',
    'community-moderation-guidelines',
    'availability-notice',
    'athlete-abuse-harassment-policy',
    'account-deletion-notice',
  ].map((name) => `/policies/${name}.html`),
);
export default async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const local = process.env.EXPO_PUBLIC_APP_ENV === 'local' && process.env.VERCEL !== '1';
  const origin = process.env.EXPO_PUBLIC_APP_ORIGIN;
  if (
    !local &&
    (!origin || url.origin !== new URL(origin).origin || url.hostname !== 'beta.brockfantasy.ca')
  )
    return new Response('This deployment is not a public application entry.', {
      status: 403,
      headers,
    });
  const path = url.pathname;
  if (/%|\\|\/\//u.test(path)) return new Response('Not found.', { status: 404, headers });
  if (path === '/signup') {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405, headers });
    const source = process.env.PUBLIC_REGISTRATION_ORIGIN ?? 'https://www.brockfantasy.ca';
    if (!local && source !== 'https://www.brockfantasy.ca')
      return new Response('Enrollment is unavailable.', { status: 503, headers });
    try {
      const form = await fetch(`${source}/register`, {
        headers: { accept: 'text/html' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (!form.ok || !form.headers.get('content-type')?.startsWith('text/html'))
        throw new Error('unavailable');
      const output = new Headers(headers);
      output.set('content-type', 'text/html; charset=utf-8');
      output.set('referrer-policy', 'strict-origin');
      const csp = form.headers.get('content-security-policy');
      if (csp) output.set('content-security-policy', csp);
      return new Response(request.method === 'HEAD' ? null : await form.text(), {
        status: 200,
        headers: output,
      });
    } catch {
      return new Response('Development enrollment is temporarily unavailable.', {
        status: 503,
        headers,
      });
    }
  }
  if (entries[path] && ['GET', 'HEAD'].includes(request.method)) {
    url.pathname = '/api/auth/entry';
    url.searchParams.set('view', entries[path]);
    return rewrite(url);
  }
  if (
    publicActions.get(path)?.includes(request.method) ||
    (policyPaths.has(path) && ['GET', 'HEAD'].includes(request.method)) ||
    (path === '/beta-auth/entry.css' && ['GET', 'HEAD'].includes(request.method))
  )
    return next();
  const token =
    requestCookie(
      request,
      process.env.NODE_ENV === 'production' ? '__Host-bf-access' : 'bf_access',
    ) ??
    (path.startsWith('/api/')
      ? request.headers.get('authorization')?.match(/^Bearer (\S+)$/u)?.[1]
      : null);
  try {
    if (token && (await canUseApp(token)))
      return next({ headers: { 'cache-control': 'no-store, private', vary: 'Cookie' } });
  } catch {
    return new Response('Application access is temporarily unavailable.', { status: 503, headers });
  }
  if (path.startsWith('/api/'))
    return new Response(JSON.stringify({ error: 'Approved tester access is required.' }), {
      status: 403,
      headers: { ...headers, 'content-type': 'application/json' },
    });
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
    return new Response(null, { status: 303, headers: { ...headers, location: '/auth' } });
  return new Response('Approved tester access is required.', { status: 403, headers });
}
