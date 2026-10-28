import { createHmac, timingSafeEqual } from 'node:crypto';

type Environment = Record<string, string | undefined>;
interface EmailJob {
  id: string;
  kind: 'contact' | 'draft' | 'account' | 'participation';
  leaseToken: string;
  attempts: number;
  userId: string | null;
  email: string | null;
  payload: {
    requestId?: string;
    expiresAt?: string;
    kind?: string;
    name?: string;
    replyEmail?: string;
    title?: string;
    message?: string;
    page?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function serviceRpc<T>(
  name: string,
  body: Record<string, unknown>,
  fetcher = fetch,
  env: Environment = process.env,
): Promise<T> {
  const root = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!root || !key) throw new Error('Service unavailable');
  const url = new URL(root);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Service unavailable');
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  if (!key.startsWith('sb_secret_')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()) as {
      role?: string;
    };
    if (claims.role !== 'service_role') throw new Error('Service unavailable');
    headers.authorization = `Bearer ${key}`;
  }
  const response = await fetcher(`${url.origin}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Service operation unavailable');
  return (await response.json()) as T;
}

export function unsubscribeToken(userId: string, secret: string): string {
  if (!uuid.test(userId) || secret.length < 32)
    throw new Error('Invalid unsubscribe configuration');
  return (
    userId +
    '.' +
    createHmac('sha256', secret)
      .update('brock-draft-email-v1:' + userId)
      .digest('base64url')
  );
}
export function unsubscribeUser(token: string, secret: string): string | null {
  const user = token.split('.')[0] ?? '';
  return uuid.test(user) && secret.length >= 32 && sameSecret(token, unsubscribeToken(user, secret))
    ? user
    : null;
}

export function verifyEmailWebhook(
  raw: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
): boolean {
  const id = headers.get('svix-id') ?? '';
  const timestamp = headers.get('svix-timestamp') ?? '';
  const signatures = headers.get('svix-signature') ?? '';
  if (
    !id ||
    !/^\d+$/u.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !secret.startsWith('whsec_')
  )
    return false;
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 16) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return signatures
    .split(' ')
    .some((signature) => signature.startsWith('v1,') && sameSecret(signature.slice(3), expected));
}

function emailConfiguration(env: Environment) {
  const key = env.RESEND_API_KEY;
  const from = env.SERVICE_EMAIL_FROM ?? env.ADMIN_INVITE_EMAIL_FROM;
  const origin = env.EXPO_PUBLIC_APP_ORIGIN;
  const unsubscribeSecret = env.SERVICE_EMAIL_UNSUBSCRIBE_SECRET;
  const recipients = (env.SUPPORT_EMAIL_TO ?? 'tymabee@proton.me,gt22me@brocku.ca')
    .split(',')
    .map((value) => value.trim());
  if (
    !key ||
    !from ||
    /[\r\n]/u.test(from) ||
    !origin ||
    !unsubscribeSecret ||
    unsubscribeSecret.length < 32 ||
    recipients.length > 2 ||
    recipients.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value))
  )
    return null;
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    return null;
  return { key, from, origin, unsubscribeSecret, recipients };
}

export async function dispatchServiceEmails(
  fetcher = fetch,
  env: Environment = process.env,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const config = emailConfiguration(env);
  if (!config) throw new Error('Service email configuration is incomplete');
  const jobs = await serviceRpc<EmailJob[]>(
    'claim_service_email_jobs',
    { p_limit: 5 },
    fetcher,
    env,
  );
  let accepted = 0;
  let failed = 0;
  const started = Date.now();
  for (const job of jobs) {
    if (Date.now() - started >= 45000) break;
    const sendable = await serviceRpc<boolean>(
      'service_email_sendable',
      { p_job_id: job.id, p_lease_token: job.leaseToken },
      fetcher,
      env,
    );
    if (!sendable) {
      await serviceRpc(
        'finish_service_email_job',
        { p_job_id: job.id, p_lease_token: job.leaseToken, p_status: 'obsolete' },
        fetcher,
        env,
      );
      continue;
    }
    const message = job.payload;
    let to: string[];
    let subject: string;
    let text: string;
    const emailHeaders: Record<string, string> = {};
    if (job.kind === 'contact') {
      to = config.recipients;
      subject = `Brock Fantasy ${message.kind ?? 'contact'}: ${message.title ?? 'Contact request'}`;
      text = `Contact request\n\nName: ${message.name || 'Not provided'}\nReply address: ${message.replyEmail || 'Not provided'}\nPage: ${message.page || 'Not provided'}\n\n${message.message ?? ''}\n\nRequest reference: ${job.id}`;
    } else if (job.kind === 'participation') {
      if (!job.email || !job.userId || !uuid.test(message.requestId ?? ''))
        throw new Error('Invalid confirmation email job');
      to = [job.email];
      subject = 'Confirm your varsity participation status';
      text = `A Brock Fantasy administrator has asked you to confirm your varsity role and programs.\n\nConfirm your status: ${config.origin}/participation/confirm/${message.requestId}\n\nSign in with the account that received this email. You can confirm or correct the suggested information, including selecting Neither. An administrator reviews your response before changing your participation status.\n\nThis request expires in seven days. This is an account service notice. For help, contact tymabee@proton.me`;
    } else if (job.kind === 'account') {
      if (!job.email || !job.userId) throw new Error('Invalid account email job');
      to = [job.email];
      subject = message.title ?? 'Brock Fantasy account notice';
      text = `${subject}\n\n${message.body ?? ''}\n\nSign in: ${config.origin}/sign-in\n\nThis account service notice is separate from optional draft or marketing emails. For privacy, accessibility or account help, contact Ty at tymabee@proton.me`;
    } else {
      if (!job.email || !job.userId) throw new Error('Invalid draft email job');
      to = [job.email];
      subject = message.title ?? 'Brock Fantasy draft update';
      const data = message.data ?? {};
      const draft =
        typeof data.draft_id === 'string' && uuid.test(data.draft_id) ? data.draft_id : null;
      const league =
        typeof data.league_id === 'string' && uuid.test(data.league_id) ? data.league_id : null;
      const link =
        draft && message.kind === 'draft_completed'
          ? `/draft-results/${draft}`
          : draft
            ? `/draft/${draft}`
            : league
              ? `/league/${league}`
              : '/dashboard';
      const optout =
        config.origin +
        '/email-preferences?token=' +
        encodeURIComponent(unsubscribeToken(job.userId, config.unsubscribeSecret));
      text = `${subject}\n\n${message.body ?? ''}\n\nOpen Brock Fantasy: ${config.origin}${link}\n\nThis is a factual league service notice, separate from marketing. Change draft email preferences: ${optout}\n\nBrock Fantasy\nPrivacy and accessibility: tymabee@proton.me`;
      emailHeaders['List-Unsubscribe'] = `<${optout}>`;
    }
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.key}`,
          'content-type': 'application/json',
          'idempotency-key': 'brock-service-email/' + job.id,
        },
        body: JSON.stringify({
          from: config.from,
          to,
          subject: subject.replace(/[\r\n]/gu, ' ').slice(0, 180),
          text,
          headers: emailHeaders,
          ...(job.kind === 'contact' && message.replyEmail ? { reply_to: message.replyEmail } : {}),
        }),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      const ok = response.ok && typeof body?.id === 'string';
      await serviceRpc(
        'finish_service_email_job',
        {
          p_job_id: job.id,
          p_lease_token: job.leaseToken,
          p_status: ok
            ? 'accepted'
            : response.status === 429 || response.status >= 500
              ? 'retry'
              : 'failed',
          p_provider_id: ok ? body.id : null,
          p_failure_code: ok ? null : `provider_http_${response.status}`,
        },
        fetcher,
        env,
      );
      if (ok) accepted++;
      else failed++;
    } catch {
      await serviceRpc(
        'finish_service_email_job',
        {
          p_job_id: job.id,
          p_lease_token: job.leaseToken,
          p_status: 'retry',
          p_failure_code: 'network_or_timeout',
        },
        fetcher,
        env,
      );
      failed++;
    }
    // - Stay within the provider rate limit without a burst of concurrent sends
    await wait(550);
  }
  return { claimed: jobs.length, accepted, failed };
}
