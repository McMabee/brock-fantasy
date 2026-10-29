import { spawnSync } from 'node:child_process';

// - Build browser fixtures with explicit public test configuration and a fresh Metro cache
const result = spawnSync(
  process.execPath,
  ['scripts/verify-web-build-config.mjs', '--build', '--clear'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VERCEL: '',
      VERCEL_ENV: '',
      EXPO_PUBLIC_APP_ENV: 'local',
      EXPO_PUBLIC_APP_ORIGIN: 'http://localhost:8081',
      EXPO_PUBLIC_SUPABASE_URL: 'https://browser-fixture.invalid',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
