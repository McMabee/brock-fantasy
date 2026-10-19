import type { RequestHandler } from 'expo-router/server';
import { testerPage, type TesterView } from '../../../server/tester-entry';
import { requestCookie } from '../../../server/session';
import { authReturnPath } from '../../../lib/admin-navigation';
import { invitationReturnPath, invitationCookie } from '../../../server/auth-invitation';
export const GET: RequestHandler = (request) => {
  const value = new URL(request.url).searchParams.get('view');
  const view: TesterView =
    value === 'activate' || value === 'recover' || value === 'reset' ? value : 'sign-in';
  const token = requestCookie(request, 'bf_csrf') ?? crypto.randomUUID();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const returnTo = invitationReturnPath(request);
  const savedInvitation = invitationCookie(returnTo);
  return testerPage(
    view,
    '',
    200,
    [
      `bf_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=86400${secure}`,
      ...(savedInvitation ? [savedInvitation] : []),
    ],
    token,
    returnTo ? authReturnPath(returnTo) : '',
    requestCookie(request, 'bf_theme') === 'light' ? 'light' : 'dark',
  );
};
