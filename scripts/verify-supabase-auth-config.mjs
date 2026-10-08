import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { validatePublicAuthConfig } from '../apps/client/src/lib/public-auth-config.ts';

const root = process.cwd();
const envPath = path.resolve(root, process.env.BROCK_AUTH_ENV_FILE ?? '.env');
const publicOnly = process.argv.includes('--public-only');
const checkRateLimit = process.argv.includes('--check-rate-limit');
if (publicOnly && checkRateLimit) throw new Error('RPC verification needs server configuration.');
let fileValues = {};
if (process.env.BROCK_AUTH_ENV_FILE || process.env.VERCEL !== '1') {
  try {
    fileValues = parseEnv(await readFile(envPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || process.env.BROCK_AUTH_ENV_FILE) throw error;
  }
}
// Vercel provides process variables; no checked-in .env or Secret visibility is needed.
const values = new Map(Object.entries({ ...fileValues, ...process.env }));

const required = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_APP_ORIGIN',
  'EXPO_PUBLIC_SUPPORT_EMAIL',
];
for (const name of required) {
  if (!values.get(name)) throw new Error(`${name} is required in the selected environment.`);
}
if (
  [...values].some(
    ([name, value]) => value && /^EXPO_PUBLIC_.*(?:SERVICE_ROLE|SECRET|PASSWORD|TOKEN)/u.test(name),
  )
) {
  throw new Error('A private credential must never use an EXPO_PUBLIC_ name.');
}
validatePublicAuthConfig(Object.fromEntries(values));

const environment = values.get('EXPO_PUBLIC_APP_ENV');
const baseUrl = new URL(values.get('EXPO_PUBLIC_SUPABASE_URL'));
const origin = new URL(values.get('EXPO_PUBLIC_APP_ORIGIN'));
if (baseUrl.protocol !== 'https:') throw new Error('EXPO_PUBLIC_SUPABASE_URL must use HTTPS.');
if (!['local', 'staging', 'production'].includes(environment)) {
  throw new Error('EXPO_PUBLIC_APP_ENV must be local, staging, or production.');
}
if (
  (environment === 'staging' || environment === 'production') &&
  (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash)
) {
  throw new Error('Staging and production require an HTTPS EXPO_PUBLIC_APP_ORIGIN without a path.');
}
if (environment === 'staging' || environment === 'production') {
  if (
    !publicOnly &&
    (!values.get('SUPABASE_SECRET_KEY') ||
      (values.get('AUTH_RATE_LIMIT_HMAC_SECRET')?.trim().length ?? 0) < 32)
  )
    throw new Error(
      'Hosted authentication needs server-only Supabase and shared HMAC credentials in the Vercel runtime store.',
    );
  const expectedOrigin =
    environment === 'staging' ? 'https://beta.brockfantasy.ca' : 'https://play.brockfantasy.ca';
  if (origin.origin !== expectedOrigin)
    throw new Error('The app origin does not match the approved environment hostname.');
  if (baseUrl.origin !== 'https://fdovowiihxowzatewxgv.supabase.co')
    throw new Error('Staging and production must use the approved shared Brock Supabase project.');
  const recipients = values
    .get('EXPO_PUBLIC_SUPPORT_EMAIL')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  if (!['tymabee@proton.me', 'gt22me@brocku.ca'].every((value) => recipients.includes(value)))
    throw new Error('The support setting must route requests to both Ty and Tarik.');
}

const response = await fetch(new URL('/auth/v1/settings', baseUrl), {
  headers: { apikey: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') },
  signal: AbortSignal.timeout(5000),
  redirect: 'error',
});
if (!response.ok)
  throw new Error(`Supabase Auth settings request failed with HTTP ${response.status}.`);
const settings = await response.json();
if (settings.disable_signup === true)
  throw new Error('Supabase Auth has public registration disabled.');
if (settings.mailer_autoconfirm === true) {
  throw new Error('Supabase Auth email confirmation must remain enabled for this beta.');
}

if (checkRateLimit) {
  const credential = values.get('SUPABASE_SECRET_KEY');
  if (!credential) throw new Error('SUPABASE_SECRET_KEY is required for RPC verification.');
  const headers = { apikey: credential, 'content-type': 'application/json' };
  if (!credential.startsWith('sb_secret_')) {
    let role;
    try {
      role = JSON.parse(
        Buffer.from(credential.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ).role;
    } catch {
      /* Only a service-role JWT is permitted below. */
    }
    if (role !== 'service_role') throw new Error('Invalid server credential type.');
    headers.authorization = `Bearer ${credential}`;
  }
  // Isolated random test bucket, no login/account/IP. It expires via normal RPC cleanup.
  const body = JSON.stringify({
    p_key: `config-probe:${randomUUID()}`,
    p_limit: 1,
    p_seconds: 86400,
  });
  for (const expected of [true, false]) {
    const result = await fetch(new URL('/rest/v1/rpc/consume_rate_limit', baseUrl), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!result.ok) throw new Error(`Rate-limit RPC failed with HTTP ${result.status}.`);
    if ((await result.json()) !== expected)
      throw new Error('Rate-limit RPC must return boolean allow then deny.');
  }
}

console.log(
  JSON.stringify({
    environment,
    projectHost: baseUrl.hostname,
    authReachable: true,
    publicRegistration: true,
    emailConfirmationRequired: true,
    originProtocol: origin.protocol.slice(0, -1),
    serverConfigurationChecked: !publicOnly && environment !== 'local',
    rateLimitRpcVerified: checkRateLimit,
  }),
);
