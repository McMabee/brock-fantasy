import type { RequestHandler } from 'expo-router/server';
import { json } from '@/server/session';
import { dispatchServiceEmails, sameSecret } from '@/server/service-email';

export const POST: RequestHandler = async (request) => {
  const secret = process.env.SERVICE_EMAIL_WORKER_SECRET;
  const token = request.headers.get('authorization')?.replace(/^Bearer /u, '') ?? '';
  if (!secret || secret.length < 32 || !sameSecret(token, secret))
    return json({ error: 'Worker access required' }, 403);
  try {
    return json(await dispatchServiceEmails());
  } catch {
    return json({ error: 'Service email delivery is temporarily unavailable' }, 503);
  }
};
