import type { RequestHandler } from 'expo-router/server';
import { json } from '@/server/session';
import { serviceRpc, unsubscribeUser } from '@/server/service-email';

export const POST: RequestHandler = async (request) => {
  if (request.headers.get('origin') !== process.env.EXPO_PUBLIC_APP_ORIGIN)
    return json({ error: 'Invalid origin' }, 403);
  try {
    const body = (await request.json()) as { token?: unknown };
    const user =
      typeof body.token === 'string'
        ? unsubscribeUser(body.token, process.env.SERVICE_EMAIL_UNSUBSCRIBE_SECRET ?? '')
        : null;
    if (!user) return json({ error: 'This email-preference link is invalid' }, 400);
    await serviceRpc('suppress_draft_email', { p_user_id: user });
    return json({ saved: true });
  } catch {
    return json({ error: 'Email preferences are temporarily unavailable' }, 503);
  }
};
