import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const envPath = path.resolve(root, process.env.BROCK_AUTH_ENV_FILE ?? '.env');
const source = await readFile(envPath, 'utf8');
const values = new Map(
  source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return index < 1 ? [] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
    .filter((entry) => entry.length === 2),
);

const required = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_APP_ORIGIN',
  'EXPO_PUBLIC_SUPPORT_EMAIL',
];
for (const name of required) {
  if (!values.get(name)) throw new Error(`${name} is required in ${path.basename(envPath)}.`);
}
if (
  [...values].some(
    ([name, value]) => value && /^EXPO_PUBLIC_.*(?:SERVICE_ROLE|SECRET|PASSWORD|TOKEN)/u.test(name),
  )
) {
  throw new Error('A private credential must never use an EXPO_PUBLIC_ name.');
}
const publicKey = values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
let publicRole;
try {
  publicRole = JSON.parse(
    Buffer.from(publicKey.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ).role;
} catch {
  /* Publishable keys are not JWTs. */
}
if (publicKey.startsWith('sb_secret_') || publicRole === 'service_role')
  throw new Error('The public Supabase key contains a privileged server credential.');

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
    !values.get('SUPABASE_SECRET_KEY') ||
    (values.get('AUTH_RATE_LIMIT_HMAC_SECRET')?.length ?? 0) < 32
  )
    throw new Error(
      'Hosted authentication needs server-only Supabase and shared HMAC credentials in the Vercel runtime store.',
    );
  const expectedOrigin =
    environment === 'staging' ? 'https://beta.brockfantasy.ca' : 'https://brockfantasy.ca';
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
});
if (!response.ok)
  throw new Error(`Supabase Auth settings request failed with HTTP ${response.status}.`);
const settings = await response.json();
if (settings.disable_signup === true)
  throw new Error('Supabase Auth has public registration disabled.');
if (settings.mailer_autoconfirm === true) {
  throw new Error('Supabase Auth email confirmation must remain enabled for this beta.');
}

console.log(
  JSON.stringify({
    environment,
    projectHost: baseUrl.hostname,
    authReachable: true,
    publicRegistration: true,
    emailConfirmationRequired: true,
    originProtocol: origin.protocol.slice(0, -1),
  }),
);
