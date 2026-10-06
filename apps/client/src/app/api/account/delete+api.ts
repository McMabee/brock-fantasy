import type { RequestHandler } from 'expo-router/server';

import { actor, apiConfig, json, mutationError } from '@/server/session';

export const POST: RequestHandler = async (request) => {
  const requestError = mutationError(request);
  if (requestError) return json({ error: requestError }, 403);
  const current = await actor(request);
  const config = apiConfig();
  if (!current || !config) return json({ error: 'Authentication is required.' }, 401);
  const deleted = await fetch(`${config.url}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      authorization: `Bearer ${current.accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!deleted.ok) return json({ error: 'Account deletion could not be completed.' }, 400);
  return json({ ok: true });
};
