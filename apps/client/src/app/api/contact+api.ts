import type { RequestHandler } from 'expo-router/server';
import {
  boundedContactBody,
  contactPayload,
  validContactReference,
} from '@/server/contact-validation';
import { limitAuthRequest } from '@/server/auth-rate-limit';
import { json } from '@/server/session';
import { serviceRpc } from '@/server/service-email';

export const POST: RequestHandler = async (request) => {
  if (request.headers.get('origin') !== process.env.EXPO_PUBLIC_APP_ORIGIN)
    return json({ error: 'Invalid request origin' }, 403);
  const input = contactPayload(await boundedContactBody(request));
  if (!input)
    return json(
      {
        error:
          'Check the message and reply address. Keep the complete report under 5,000 characters and 8 KB.',
      },
      400,
    );
  const rate = await limitAuthRequest(request, 'contact');
  if (rate.status !== 'allowed')
    return json(
      {
        error:
          rate.status === 'limited'
            ? 'Please wait a minute before sending another request'
            : 'Contact delivery is temporarily unavailable',
      },
      rate.status === 'limited' ? 429 : 503,
    );
  try {
    const result = await serviceRpc<{ id: string; status: string }>('queue_contact_message', {
      p_request_id: input.requestId,
      p_payload: input.payload,
    });
    return json(
      { requestId: input.requestId, status: result.status },
      result.status === 'queued' || result.status === 'leased' ? 202 : 200,
    );
  } catch {
    return json(
      {
        error:
          'Contact delivery is temporarily unavailable. Your message has not been confirmed; retry with the same request.',
      },
      503,
    );
  }
};
export const GET: RequestHandler = async (request) => {
  const reference = new URL(request.url).searchParams.get('requestId');
  if (!validContactReference(reference)) return json({ error: 'Invalid request reference' }, 400);
  const rate = await limitAuthRequest(request, 'contact-status');
  if (rate.status !== 'allowed')
    return json(
      { error: 'Status is temporarily unavailable' },
      rate.status === 'limited' ? 429 : 503,
    );
  try {
    return json(await serviceRpc('contact_message_status', { p_request_id: reference }));
  } catch {
    return json({ error: 'Status is temporarily unavailable' }, 503);
  }
};
