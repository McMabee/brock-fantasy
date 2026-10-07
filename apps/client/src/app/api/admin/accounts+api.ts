import type { RequestHandler } from 'expo-router/server';
import { actor, apiConfig, isAdmin, json } from '@/server/session';

export const GET: RequestHandler = async (request) => {
  const current = await actor(request);
  const config = apiConfig();
  if (!current || current.aal !== 'aal2' || !(await isAdmin(current)) || !config)
    return json({ error: 'Administrator MFA access is required.' }, 403);
  const email = new URL(request.url).searchParams.get('email')?.trim();
  if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)))
    return json({ error: 'Enter a valid account email.' }, 400);
  const response = await fetch(
    `${config.url}/rest/v1/rpc/${email ? 'admin_find_account' : 'can_manage_admin_accounts'}`,
    {
      method: 'POST',
      headers: {
        apikey: config.key,
        authorization: `Bearer ${current.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(email ? { p_email: email } : {}),
    },
  );
  if (!response.ok)
    return json(
      {
        error:
          response.status === 403
            ? 'Operator access is required.'
            : 'Account lookup is unavailable.',
      },
      response.status === 403 ? 403 : 503,
    );
  const data: unknown = await response.json();
  if (!email && data !== true) return json({ error: 'Operator access is required.' }, 403);
  return json(email ? data : { canManage: true });
};
