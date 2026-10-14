import { next, rewrite } from '@vercel/functions';
import { requestCookie } from './apps/client/src/server/session';

const headers = { 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff' };
const entries: Record<string, string> = {
  '/signup': 'activate',
  '/auth': 'sign-in',
  '/forgot-password': 'recover',
  '/reset-password': 'reset',
};
const publicActions = new Map<string, readonly string[]>([
  ['/api/auth/entry', ['GET', 'HEAD']],
  ['/api/auth/callback', ['GET', 'HEAD']],
  ['/api/auth/csrf', ['GET']],
  ['/api/auth/session', ['GET']],
  ['/api/auth/staff', ['GET', 'HEAD', 'POST']],
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
export default function proxy(request: Request): Response {
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
  const assetPath = path.startsWith('/_expo/static/')
    ? path.replace(/%5b/giu, '[').replace(/%5d/giu, ']')
    : path;
  // Expo filenames include a content hash. They contain no account data and
  // can be reused across visits without consulting Supabase or re-downloading.
  if (
    ['GET', 'HEAD'].includes(request.method) &&
    !/%|\\|\/\//u.test(assetPath) &&
    /^\/_expo\/static\/.*-[a-f0-9]{32}\.(?:js|css)$/u.test(assetPath)
  )
    return next({ headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
  if (/%|\\|\/\//u.test(path)) return new Response('Not found.', { status: 404, headers });
  if (['GET', 'HEAD'].includes(request.method) && path === '/draft-audio/On_The_Clock.mp3')
    return next({ headers: { 'cache-control': 'public, max-age=86400' } });
  if ((path === '/mfa' && url.searchParams.has('invitation')) || path === '/staff-activate') {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405, headers });
    url.pathname = '/api/auth/staff';
    return rewrite(url);
  }
  if (path === '/signup' && !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 405, headers });
  if (path === '/tester-activate')
    return new Response(null, { status: 303, headers: { ...headers, location: '/signup' } });
  if (entries[path] && ['GET', 'HEAD'].includes(request.method)) {
    url.pathname = '/api/auth/entry';
    url.searchParams.set('view', entries[path]);
    return rewrite(url);
  }
  if (
    publicActions.get(path)?.includes(request.method) ||
    (policyPaths.has(path) && ['GET', 'HEAD'].includes(request.method)) ||
    (['/beta-auth/entry.css', '/beta-auth/complete-signup.js'].includes(path) &&
      ['GET', 'HEAD'].includes(request.method))
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
  // The shell and assets contain no private records. API handlers validate live
  // session, eligibility and resource authorization. Database outages must not
  // replace the entire draft room with an error page.
  if (path.startsWith('/api/') && !token)
    return new Response(JSON.stringify({ error: 'Authentication is required.' }), {
      status: 401,
      headers: { ...headers, 'content-type': 'application/json' },
    });
  return next({ headers: { 'cache-control': 'no-store, private', vary: 'Cookie' } });
}
