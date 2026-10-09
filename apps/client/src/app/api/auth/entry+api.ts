import type { RequestHandler } from 'expo-router/server';
import { testerPage, type TesterView } from '../../../server/tester-entry';
import { requestCookie } from '../../../server/session';
import { authReturnPath } from '../../../lib/admin-navigation';
export const GET: RequestHandler = (request) => {
  const value = new URL(request.url).searchParams.get('view');
  const view: TesterView =
    value === 'activate' || value === 'recover' || value === 'reset' ? value : 'sign-in';
  const token = requestCookie(request, 'bf_csrf') ?? crypto.randomUUID();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const query = new URL(request.url).searchParams;
  const returnTo = query.get('returnTo') ?? query.get('next');
  return testerPage(
    view,
    '',
    200,
    [`bf_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=86400${secure}`],
    token,
    returnTo ? authReturnPath(returnTo) : '',
  );
};
