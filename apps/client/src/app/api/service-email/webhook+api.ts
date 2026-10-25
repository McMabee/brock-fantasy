import type { RequestHandler } from 'expo-router/server';
import { json } from '@/server/session';
import { serviceRpc, verifyEmailWebhook } from '@/server/service-email';

export const POST: RequestHandler = async (request) => {
  const raw = await request.text();
  if (
    raw.length > 65_536 ||
    !verifyEmailWebhook(raw, request.headers, process.env.RESEND_WEBHOOK_SECRET ?? '')
  )
    return json({ error: 'Invalid webhook' }, 403);
  try {
    const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
    const kind = event.type?.replace(/^email\./u, '');
    if (
      !kind ||
      !['delivered', 'bounced', 'complained'].includes(kind) ||
      typeof event.data?.email_id !== 'string'
    )
      return json({ ignored: true });
    await serviceRpc('record_service_email_event', {
      p_provider_id: event.data.email_id,
      p_event: kind,
    });
    return json({ accepted: true });
  } catch {
    return json({ error: 'Delivery event unavailable' }, 503);
  }
};
