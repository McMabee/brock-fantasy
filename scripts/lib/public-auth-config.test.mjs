import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { validatePublicAuthConfig } from '../../apps/client/src/lib/public-auth-config.ts';

const beta = {
  EXPO_PUBLIC_APP_ENV: 'staging',
  EXPO_PUBLIC_SUPABASE_URL: 'https://fdovowiihxowzatewxgv.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build_fixture',
  EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca',
  EXPO_PUBLIC_SUPPORT_EMAIL: 'tymabee@proton.me,gt22me@brocku.ca',
};

test('staging and production validate public config without any server secrets', () => {
  validatePublicAuthConfig(beta);
  validatePublicAuthConfig({
    ...beta,
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_APP_ORIGIN: 'https://brockfantasy.ca',
  });
  validatePublicAuthConfig({});
});

test('hosted missing-config errors identify only variable names', () => {
  for (const name of Object.keys(beta).filter((name) => name !== 'EXPO_PUBLIC_APP_ENV')) {
    assert.throws(
      () => validatePublicAuthConfig({ ...beta, [name]: '' }),
      (error) => {
        assert.ok(error.message.includes(name));
        assert.ok(error.message.includes('Vercel Config'));
        assert.ok(!error.message.includes(beta.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
        return true;
      },
    );
  }
});

test('hosted config rejects invalid environments, origins, projects and support recipients', () => {
  for (const change of [
    { EXPO_PUBLIC_APP_ENV: 'preview' },
    { EXPO_PUBLIC_APP_ORIGIN: 'http://beta.brockfantasy.ca' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca/path' },
    { EXPO_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { EXPO_PUBLIC_SUPPORT_EMAIL: 'tymabee@proton.me' },
  ])
    assert.throws(() => validatePublicAuthConfig({ ...beta, ...change }));
});

test('public config accepts legacy anon keys and rejects server keys without revealing them', () => {
  const jwt = (role) =>
    `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  validatePublicAuthConfig({ ...beta, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon') });
  for (const key of ['sb_secret_private_fixture', jwt('service_role'), 'invalid-private-fixture']) {
    assert.throws(
      () => validatePublicAuthConfig({ ...beta, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }),
      (error) => {
        assert.ok(!error.message.includes(key));
        return true;
      },
    );
  }
  assert.throws(() =>
    validatePublicAuthConfig({
      ...beta,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_unused_but_public',
    }),
  );
});

test('Vercel preflight reads process configuration without requiring an env file', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/verify-supabase-auth-config.mjs'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...beta,
        VERCEL: '1',
        BROCK_AUTH_ENV_FILE: '',
        SUPABASE_SECRET_KEY: '',
        AUTH_RATE_LIMIT_HMAC_SECRET: '',
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Hosted authentication needs server-only/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
  assert.ok(!result.stderr.includes(beta.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
});

test('Vercel build preflight requires public Config only and enforces the beta branch', () => {
  const run = (changes) =>
    spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/verify-web-build-config.mjs'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...beta,
          VERCEL: '1',
          VERCEL_GIT_COMMIT_REF: 'beta',
          SUPABASE_SECRET_KEY: '',
          AUTH_RATE_LIMIT_HMAC_SECRET: '',
          ...changes,
        },
      },
    );
  assert.equal(run({}).status, 0);
  const missing = run({ EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' });
  assert.notEqual(missing.status, 0);
  assert.match(
    missing.stderr,
    /Missing Vercel public Config variables: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
  );
  for (const change of [
    { EXPO_PUBLIC_APP_ENV: 'production' },
    { EXPO_PUBLIC_APP_ENV: 'local' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://other.example' },
    { EXPO_PUBLIC_SUPABASE_SECRET_KEY: 'private-fixture' },
  ])
    assert.notEqual(run(change).status, 0);
});
