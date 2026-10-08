import type { RequestHandler } from 'expo-router/server';
import { actor, apiConfig, isAdmin, json, mutationError, readObject, text } from '@/server/session';
import { adminRpc, invitationEmailConfig, sendInvitationEmail } from '@/server/admin-invitations';

export const GET: RequestHandler = async (request) => {
  try {
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
              ? 'Only Ty Mabee can manage administrator access.'
              : 'Account lookup is unavailable.',
        },
        response.status === 403 ? 403 : 503,
      );
    const data: unknown = await response.json();
    if (!email && data !== true)
      return json({ error: 'Only Ty Mabee can manage administrator access.' }, 403);
    return json(email ? data : { canManage: true });
  } catch {
    return json({ error: 'Administrator account lookup is unavailable. Try again shortly.' }, 503);
  }
};

export const POST: RequestHandler = async (request) => {
  // Native clients authenticate with an explicit bearer token. Cookie sessions
  // always require the website's canonical Origin and CSRF token.
  const bearer = /^Bearer \S+$/u.test(request.headers.get('authorization') ?? '');
  const requestError = bearer ? null : mutationError(request);
  if (requestError) return json({ error: requestError }, 403);
  try {
    const current = await actor(request, true);
    if (!current || current.aal !== 'aal2' || !(await isAdmin(current)))
      return json({ error: 'Super administrator MFA access is required.' }, 403);
    const capability = await adminRpc(current, 'can_manage_admin_accounts', {});
    if (!capability.ok || (await capability.json()) !== true)
      return json({ error: 'Only Ty Mabee can invite administrators.' }, 403);
    const body = readObject(await request.json().catch(() => null));
    const email = text(body?.email, 320)?.trim();
    const reason = text(body?.reason, 500)?.trim();
    const requestKey = text(body?.idempotencyKey, 200);
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
      !reason ||
      reason.length < 8 ||
      !requestKey ||
      requestKey.length < 8
    )
      return json(
        { error: 'Enter a valid email and an access reason of at least eight characters.' },
        400,
      );
    const emailConfig = invitationEmailConfig();
    if (!emailConfig)
      return json(
        { error: 'Invitation email delivery is not configured. Ask Ty to configure the sender.' },
        503,
      );
    const created = await adminRpc(current, 'admin_create_invitation', {
      p_email: email,
      p_reason: reason,
      p_idempotency_key: requestKey,
    });
    const data = readObject(await created.json().catch(() => null));
    if (!created.ok)
      return json(
        {
          error:
            created.status === 403
              ? 'Super administrator access is required.'
              : (text(data?.message) ?? 'Invitation could not be created.'),
        },
        created.status === 403 ? 403 : 400,
      );
    const invitationId = text(data?.invitationId, 36);
    const recipient = text(data?.email, 320);
    if (!invitationId || !/^[0-9a-f-]{36}$/iu.test(invitationId) || !recipient)
      return json({ error: 'Invitation could not be confirmed.' }, 503);
    if (data?.alreadySent === true)
      return json({ sent: true, invitationId, expiresAt: data?.expiresAt });
    // The recipient cannot accept until the provider succeeds and the sent
    // marker is stored. Retrying uses the same provider idempotency key.
    if (!(await sendInvitationEmail(emailConfig, { invitationId, email: recipient })))
      return json(
        { error: 'Invitation email could not be sent. Retry to send the same invitation.' },
        503,
      );
    const sent = await adminRpc(current, 'admin_mark_invitation_sent', {
      p_invitation_id: invitationId,
    });
    if (!sent.ok)
      return json(
        {
          error:
            'Email was sent but the invitation could not be confirmed. Retry or send a new invitation.',
        },
        503,
      );
    return json({ sent: true, invitationId, expiresAt: data?.expiresAt });
  } catch {
    return json(
      { error: 'Invitation service is unavailable. Retry to send the same invitation.' },
      503,
    );
  }
};
