import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import {
  contactPayload,
  boundedContactBody,
} from '../../apps/client/src/server/contact-validation.ts';
import {
  dispatchServiceEmails,
  verifyEmailWebhook,
  unsubscribeToken,
  unsubscribeUser,
} from '../../apps/client/src/server/service-email.ts';
import { erasureReplaySql, validateErasureManifest } from './erasure-replay.mjs';
const user = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const lease = '33333333-3333-4333-8333-333333333333';
const input = {
  requestId: user,
  kind: 'contact',
  replyEmail: 'reply@example.test',
  message: 'Requested support',
  page: 'https://play.brockfantasy.ca/account?token=secret#private',
};

test('service emails use available account routes and the server-resolved recipient', async () => {
  for (const kind of ['participation', 'account']) {
    let delivery;
    const env = {
      EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SECRET_KEY: 'sb_secret_fixture',
      RESEND_API_KEY: 'fixture',
      SERVICE_EMAIL_FROM: 'Brock Fantasy <service@brockfantasy.ca>',
      EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca',
      SERVICE_EMAIL_UNSUBSCRIBE_SECRET: 'a'.repeat(40),
    };
    const result = await dispatchServiceEmails(
      async (url, options) => {
        if (url.endsWith('/claim_service_email_jobs'))
          return Response.json([
            {
              id: jobId,
              kind,
              leaseToken: lease,
              attempts: 1,
              userId: user,
              email: 'recipient@example.test',
              payload: { requestId: user, email: 'untrusted@example.test' },
            },
          ]);
        if (url.endsWith('/service_email_sendable') || url.endsWith('/finish_service_email_job'))
          return Response.json(true);
        assert.equal(url, 'https://api.resend.com/emails');
        delivery = { body: JSON.parse(options.body), headers: options.headers };
        return Response.json({ id: 'confirmation-provider' });
      },
      env,
      async () => {},
    );
    assert.equal(result.accepted, 1);
    assert.deepEqual(delivery.body.to, ['recipient@example.test']);
    const route = kind === 'participation' ? `/participation/confirm/${user}` : '/auth';
    assert.ok(delivery.body.text.includes(`https://play.brockfantasy.ca${route}`));
    if (kind === 'participation')
      assert.ok(delivery.body.text.includes('administrator reviews your response'));
    assert.equal(delivery.headers['idempotency-key'], `brock-service-email/${jobId}`);
  }
});

test('contact validation minimizes page data and rejects unrequested fields and header injection', async () => {
  assert.equal(contactPayload(input).payload.page, 'https://play.brockfantasy.ca/account');
  assert.equal(contactPayload({ ...input, bcc: 'outsider@example.test' }), null);
  assert.equal(
    contactPayload({ ...input, replyEmail: 'reply@example.test\r\nBcc: another@example.test' }),
    null,
  );
  assert.equal(contactPayload({ ...input, page: 'https://outsider.example/path' }), null);
  assert.equal(contactPayload({ ...input, kind: 'bug', replyEmail: '' }).payload.replyEmail, '');
  assert.equal(
    await boundedContactBody(
      new Request('https://local.test', { method: 'POST', body: 'x'.repeat(8193) }),
    ),
    null,
  );
});

test('unsubscribe capabilities are limited to one identity and authenticated by the server secret', () => {
  const secret = 'a'.repeat(40);
  const token = unsubscribeToken(user, secret);
  assert.equal(unsubscribeUser(token, secret), user);
  assert.equal(unsubscribeUser(token, 'b'.repeat(40)), null);
  assert.equal(unsubscribeUser(token.replace(user, jobId), secret), null);
});

test('email webhooks reject tampering and replay outside the five-minute window', () => {
  const raw = '{"type":"email.delivered","data":{"email_id":"safe"}}';
  const now = Date.now();
  const key = Buffer.alloc(32, 5);
  const timestamp = String(Math.floor(now / 1000));
  const sig = createHmac('sha256', key)
    .update('evt.' + timestamp + '.' + raw)
    .digest('base64');
  const headers = new Headers({
    'svix-id': 'evt',
    'svix-timestamp': timestamp,
    'svix-signature': 'v1,' + sig,
  });
  assert.equal(verifyEmailWebhook(raw, headers, 'whsec_' + key.toString('base64'), now), true);
  assert.equal(
    verifyEmailWebhook(raw + ' ', headers, 'whsec_' + key.toString('base64'), now),
    false,
  );
  assert.equal(
    verifyEmailWebhook(raw, headers, 'whsec_' + key.toString('base64'), now + 301000),
    false,
  );
});

test('uncertain provider sends preserve a stable idempotency key and report retry rather than delivery', async () => {
  const calls = [];
  const job = {
    id: jobId,
    kind: 'contact',
    leaseToken: lease,
    attempts: 1,
    userId: null,
    email: null,
    payload: { ...input, title: 'Support request' },
  };
  const env = {
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SECRET_KEY: 'sb_secret_fixture',
    RESEND_API_KEY: 'fixture',
    SERVICE_EMAIL_FROM: 'Brock <service@brockfantasy.ca>',
    EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca',
    SERVICE_EMAIL_UNSUBSCRIBE_SECRET: 'a'.repeat(40),
  };
  let fail = true;
  const fetcher = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.endsWith('/claim_service_email_jobs')) return Response.json([job]);
    if (url.endsWith('/service_email_sendable')) return Response.json(true);
    if (url.endsWith('/finish_service_email_job')) return Response.json(true);
    if (url === 'https://api.resend.com/emails') {
      if (fail) throw new Error('Outcome unknown');
      return Response.json({ id: 'provider-id' });
    }
    throw new Error('Unexpected request');
  };
  assert.deepEqual(await dispatchServiceEmails(fetcher, env, async () => {}), {
    claimed: 1,
    accepted: 0,
    failed: 1,
  });
  fail = false;
  assert.deepEqual(await dispatchServiceEmails(fetcher, env, async () => {}), {
    claimed: 1,
    accepted: 1,
    failed: 0,
  });
  const sends = calls.filter((x) => x.url === 'https://api.resend.com/emails');
  assert.equal(sends[0].headers['idempotency-key'], sends[1].headers['idempotency-key']);
  assert.equal(sends[0].body.html, undefined);
  assert.equal(
    calls.filter((x) => x.url.endsWith('/finish_service_email_job'))[0].body.p_status,
    'retry',
  );
  assert.equal(
    calls.filter((x) => x.url.endsWith('/finish_service_email_job'))[1].body.p_status,
    'accepted',
  );
});

test('obsolete drafts cannot send even if they were already leased', async () => {
  let sent = false;
  let outcome;
  const env = {
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SECRET_KEY: 'sb_secret_fixture',
    RESEND_API_KEY: 'fixture',
    SERVICE_EMAIL_FROM: 'service@brockfantasy.ca',
    EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca',
    SERVICE_EMAIL_UNSUBSCRIBE_SECRET: 'a'.repeat(40),
  };
  await dispatchServiceEmails(
    async (url, options) => {
      if (url.endsWith('/claim_service_email_jobs'))
        return Response.json([
          {
            id: jobId,
            kind: 'draft',
            leaseToken: lease,
            payload: {},
            userId: user,
            email: 'manager@example.test',
          },
        ]);
      if (url.endsWith('/service_email_sendable')) return Response.json(false);
      if (url.endsWith('/finish_service_email_job')) {
        outcome = JSON.parse(options.body).p_status;
        return Response.json(true);
      }
      sent = true;
      throw new Error('Unexpected send');
    },
    env,
    async () => {},
  );
  assert.equal(sent, false);
  assert.equal(outcome, 'obsolete');
});

test('restore manifests require recent capture, known roots and canonical identifiers', () => {
  const manifest = {
    capturedAt: new Date().toISOString(),
    entries: [{ kind: 'account', id: user, untrusted: "');drop table public.profiles;--" }],
  };
  const sql = erasureReplaySql(manifest);
  assert.doesNotMatch(sql, /drop table/);
  assert.match(sql, /auth\.users/);
  assert.throws(() => validateErasureManifest({ ...manifest, capturedAt: '2000-01-01T00:00:00Z' }));
  assert.throws(() =>
    validateErasureManifest({ ...manifest, entries: [{ kind: 'custom', id: user }] }),
  );
  assert.throws(() =>
    validateErasureManifest({ ...manifest, entries: [{ kind: 'account', id: "');select 1;--" }] }),
  );
});
