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
if (values.get('EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')) {
  throw new Error('A service-role credential must never use an EXPO_PUBLIC_ name.');
}

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
    authReachable: true,
    publicRegistration: true,
    emailConfirmationRequired: true,
    originProtocol: origin.protocol.slice(0, -1),
  }),
);
