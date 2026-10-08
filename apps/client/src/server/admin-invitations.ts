import { apiConfig, type WebActor } from '@/server/session';

export async function adminRpc(current: WebActor, name: string, body: Record<string, unknown>) {
  const config = apiConfig();
  if (!config) throw new Error('Supabase is unavailable.');
  return fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      authorization: `Bearer ${current.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export function invitationEmailConfig() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_INVITE_EMAIL_FROM;
  const origin = process.env.EXPO_PUBLIC_APP_ORIGIN;
  if (!key || !from || !origin || /[\r\n]/u.test(from)) return null;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
      return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return { key, from, origin: url.origin };
  } catch {
    return null;
  }
}

export async function sendInvitationEmail(
  config: NonNullable<ReturnType<typeof invitationEmailConfig>>,
  invitation: { invitationId: string; email: string },
): Promise<boolean> {
  const link = new URL('/mfa', config.origin);
  link.searchParams.set('invitation', invitation.invitationId);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.key}`,
      'content-type': 'application/json',
      'idempotency-key': `brock-admin-invitation/${invitation.invitationId}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [invitation.email],
      subject: 'Ty Mabee invited you to administer Brock Fantasy',
      text: `Ty Mabee has invited you to become a Brock Fantasy administrator.\n\nOpen this link and sign in with ${invitation.email}:\n${link.toString()}\n\nSet up your authenticator, or verify your existing authenticator with its six-digit code. Your admin access activates after verification. You will have access to the admin panel and all standard admin tools. Only Ty can invite other administrators.\n\nThis invitation expires seven days after it was created. If you were not expecting it, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return response.ok && typeof data?.id === 'string';
}
