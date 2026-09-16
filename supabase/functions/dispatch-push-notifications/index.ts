import { AccessError, authenticatedAdmin, serviceClient } from '../_shared/clients.ts';
import { corsHeaders } from '../_shared/cors.ts';

interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

interface PushTokenRow {
  id: string;
  user_id: string;
  expo_push_token: string;
}

interface DeliveryCandidate {
  notification: NotificationRow;
  token: PushTokenRow;
}

interface DeliveryRow {
  id: string;
  notification_id: string;
  push_token_id: string;
  status: 'pending' | 'failed';
  attempts: number;
  updated_at: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST')
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

  const db = serviceClient();
  try {
    await requireOperator(request.headers.get('authorization'));
    const receipts = await collectReceipts(db);
    const notificationsResult = await db
      .from('notifications')
      .select('id, user_id, title, body, data')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at')
      .limit(100);
    if (notificationsResult.error) throw notificationsResult.error;
    const notifications = (notificationsResult.data ?? []) as NotificationRow[];
    const userIds = [...new Set(notifications.map((notification) => notification.user_id))];
    const tokenResult = userIds.length
      ? await db
          .from('push_tokens')
          .select('id, user_id, expo_push_token')
          .in('user_id', userIds)
          .eq('enabled', true)
      : { data: [] as PushTokenRow[], error: null };
    if (tokenResult.error) throw tokenResult.error;
    const tokens = (tokenResult.data ?? []) as PushTokenRow[];
    const candidates: DeliveryCandidate[] = notifications
      .flatMap((notification) =>
        tokens
          .filter((token) => token.user_id === notification.user_id)
          .map((token) => ({ notification, token })),
      )
      .slice(0, 100);

    if (candidates.length === 0) return Response.json({ ticketed: 0, receipts }, { headers });
    const deliveryInsert = await db
      .from('push_deliveries')
      .upsert(
        candidates.map(({ notification, token }) => ({
          notification_id: notification.id,
          push_token_id: token.id,
        })),
        { onConflict: 'notification_id,push_token_id', ignoreDuplicates: true },
      )
      .select('id, notification_id, push_token_id');
    if (deliveryInsert.error) throw deliveryInsert.error;
    const candidateKeys = new Set(
      candidates.map(({ notification, token }) => `${notification.id}:${token.id}`),
    );
    const retryResult = await db
      .from('push_deliveries')
      .select('id, notification_id, push_token_id, status, attempts, updated_at')
      .in(
        'notification_id',
        notifications.map((notification) => notification.id),
      )
      .in(
        'push_token_id',
        tokens.map((token) => token.id),
      )
      .in('status', ['pending', 'failed'])
      .lt('attempts', 3);
    if (retryResult.error) throw retryResult.error;
    const retryCutoff = Date.now() - 5 * 60_000;
    const retryable = ((retryResult.data ?? []) as DeliveryRow[]).filter(
      (delivery) =>
        candidateKeys.has(`${delivery.notification_id}:${delivery.push_token_id}`) &&
        (delivery.attempts === 0 || Date.parse(delivery.updated_at) <= retryCutoff),
    );
    const deliveries = retryable.flatMap((delivery) => {
      const candidate = candidates.find(
        ({ notification, token }) =>
          notification.id === delivery.notification_id && token.id === delivery.push_token_id,
      );
      return candidate ? [{ delivery, candidate }] : [];
    });
    if (deliveries.length === 0) return Response.json({ ticketed: 0, receipts }, { headers });

    await Promise.all(
      deliveries.map(({ delivery }) =>
        db
          .from('push_deliveries')
          .update({ status: 'pending', attempts: delivery.attempts + 1, error: null })
          .eq('id', delivery.id),
      ),
    );

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(
        deliveries.map(({ candidate: { notification, token } }) => ({
          to: token.expo_push_token,
          title: notification.title,
          body: notification.body,
          data: notification.data,
          sound: 'default',
        })),
      ),
    });
    if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
    const payload = (await response.json()) as { data?: ExpoTicket | ExpoTicket[] };
    const tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
    await Promise.all(
      deliveries.map(async ({ candidate, delivery }, index) => {
        const ticket = tickets[index];
        await db
          .from('push_deliveries')
          .update({
            status: ticket?.status === 'ok' ? 'ticketed' : 'failed',
            expo_ticket_id: ticket?.id ?? null,
            error: ticket?.status === 'error' ? (ticket.message ?? 'Expo rejected push') : null,
          })
          .eq('id', delivery.id);
        if (ticket?.details?.error === 'DeviceNotRegistered')
          await db.from('push_tokens').update({ enabled: false }).eq('id', candidate.token.id);
      }),
    );
    return Response.json(
      { ticketed: tickets.filter((ticket) => ticket.status === 'ok').length, receipts },
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Push dispatch failed';
    return Response.json(
      { error: message },
      { status: error instanceof AccessError ? error.status : 400, headers },
    );
  }
});

async function requireOperator(authorization: string | null) {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (serviceRoleKey && token === serviceRoleKey) return;
  await authenticatedAdmin(authorization);
}

async function collectReceipts(db: ReturnType<typeof serviceClient>) {
  const ticketed = await db
    .from('push_deliveries')
    .select('id, push_token_id, expo_ticket_id')
    .eq('status', 'ticketed')
    .not('expo_ticket_id', 'is', null)
    .lte('updated_at', new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(100);
  if (ticketed.error) throw ticketed.error;
  if (!ticketed.data?.length) return 0;
  const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ticketed.data.map((delivery) => delivery.expo_ticket_id) }),
  });
  if (!response.ok) throw new Error(`Expo receipt service returned ${response.status}`);
  const payload = (await response.json()) as {
    data?: Record<string, ExpoTicket>;
  };
  let updated = 0;
  for (const delivery of ticketed.data) {
    const receipt = payload.data?.[delivery.expo_ticket_id as string];
    if (!receipt) continue;
    await db
      .from('push_deliveries')
      .update({
        status: receipt.status === 'ok' ? 'delivered' : 'failed',
        error: receipt.status === 'error' ? (receipt.message ?? 'Push delivery failed') : null,
      })
      .eq('id', delivery.id);
    if (receipt.details?.error === 'DeviceNotRegistered')
      await db.from('push_tokens').update({ enabled: false }).eq('id', delivery.push_token_id);
    updated += 1;
  }
  return updated;
}
