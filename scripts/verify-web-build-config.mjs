import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validatePublicAuthConfig } from '../apps/client/src/lib/public-auth-config.ts';
import { resolvePublicDeploymentConfig } from '../config/public-deployment.cjs';
import { verifyPublishedSportsRpcs } from './lib/published-sports-rpcs.mjs';

// - Resolve hosted public defaults before Expo starts
// - Preserve explicit overrides so invalid or privileged values still fail validation
if (process.env.VERCEL === '1') {
  Object.assign(process.env, resolvePublicDeploymentConfig(process.env));
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
  if (
    process.env.VERCEL_GIT_COMMIT_REF === 'main' &&
    process.env.EXPO_PUBLIC_APP_ENV !== 'production'
  )
    throw new Error('The main branch requires EXPO_PUBLIC_APP_ENV=production.');
  console.log(
    'Vercel public Config variables validated; server secrets are not required for export.',
  );
}

if (process.argv.includes('--build')) {
  if (process.env.VERCEL === '1') {
    await verifyPublishedSportsRpcs(process.env);
    console.log('Published sports RPCs are deployed and retain authenticated-only access.');
  }
  // - Launch Expo from this process so validated defaults reach the child environment
  const clientRequire = createRequire(new URL('../apps/client/package.json', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      clientRequire.resolve('expo/bin/cli'),
      'export',
      '--platform',
      'web',
      ...(process.argv.includes('--clear') ? ['--clear'] : []),
    ],
    { stdio: 'inherit', cwd: fileURLToPath(new URL('../apps/client', import.meta.url)) },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
