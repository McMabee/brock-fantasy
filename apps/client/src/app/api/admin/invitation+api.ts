import type { RequestHandler } from 'expo-router/server';
import { actor, json } from '@/server/session';
import { adminRpc } from '@/server/admin-invitations';

export const GET: RequestHandler = async (request) => {
  try {
    const current = await actor(request);
    if (!current) return json({ error: 'Sign in with the invited email to continue.' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f-]{36}$/iu.test(id))
      return json({ error: 'Invalid invitation link.' }, 400);
    const result = await adminRpc(current, 'admin_invitation_status', { p_invitation_id: id });
    if (!result.ok)
      return json(
        {
          error:
            'This invitation is unavailable for this account. Sign in with the invited email or ask Ty for a new invitation.',
        },
        result.status === 403 ? 403 : 503,
      );
    return json(await result.json());
  } catch {
    return json({ error: 'Unable to check this invitation. Try again shortly.' }, 503);
  }
};
