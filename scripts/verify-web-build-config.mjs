import { validatePublicAuthConfig } from '../apps/client/src/lib/public-auth-config.ts';

// Local exports keep their Expo dotenv workflow. Hosted exports must receive
// public Config variables from Vercel before Metro starts; no server secrets needed.
if (process.env.VERCEL === '1') {
  const required = [
    'EXPO_PUBLIC_APP_ENV',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_APP_ORIGIN',
    'EXPO_PUBLIC_SUPPORT_EMAIL',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(`Missing Vercel public Config variables: ${missing.join(', ')}.`);
  if (
    Object.entries(process.env).some(
      ([name, value]) =>
        value && /^EXPO_PUBLIC_.*(?:SERVICE_ROLE|SECRET|PASSWORD|TOKEN)/u.test(name),
    )
  )
    throw new Error('Private credentials must never use an EXPO_PUBLIC_ name.');
  validatePublicAuthConfig(process.env);
  if (!['staging', 'production'].includes(process.env.EXPO_PUBLIC_APP_ENV))
    throw new Error('Hosted Vercel builds require EXPO_PUBLIC_APP_ENV=staging or production.');
  if (
    process.env.VERCEL_GIT_COMMIT_REF === 'beta' &&
    (process.env.EXPO_PUBLIC_APP_ENV !== 'staging' ||
      process.env.EXPO_PUBLIC_APP_ORIGIN !== 'https://beta.brockfantasy.ca')
  )
    throw new Error(
      'The beta branch requires staging and EXPO_PUBLIC_APP_ORIGIN=https://beta.brockfantasy.ca.',
    );
  console.log(
    'Vercel public Config variables validated; server secrets are not required for export.',
  );
}
