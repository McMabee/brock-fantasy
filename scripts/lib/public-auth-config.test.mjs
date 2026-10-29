import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolvePublicDeploymentConfig } from '../../config/public-deployment.cjs';
import { validatePublicAuthConfig } from '../../apps/client/src/lib/public-auth-config.ts';

const beta = {
  EXPO_PUBLIC_APP_ENV: 'staging',
  EXPO_PUBLIC_SUPABASE_URL: 'https://fdovowiihxowzatewxgv.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build_fixture',
  EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca',
  EXPO_PUBLIC_SUPPORT_EMAIL: 'bfa.support64@gmail.com',
};

test('staging and production validate public config without any server secrets', () => {
  validatePublicAuthConfig(beta);
  validatePublicAuthConfig({ ...beta, EXPO_PUBLIC_SUPPORT_EMAIL: 'bfa.support64@gmail.com' });
  validatePublicAuthConfig({
    ...beta,
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca',
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

test('preview build and browser validators accept explicit review origins and backend modes', () => {
  const preview = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: 'feat/ui-policy-refresh',
    BROCK_PREVIEW_BACKEND: 'live',
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_APP_ORIGIN: 'https://app-review.example.test',
    PUBLIC_REGISTRATION_ORIGIN: 'https://site-review.example.test',
    EXPO_PUBLIC_SUPABASE_URL: beta.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: beta.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  const config = resolvePublicDeploymentConfig(preview);
  validatePublicAuthConfig(config);
  validatePublicAuthConfig({
    ...config,
    EXPO_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
  });
  for (const change of [
    { EXPO_PUBLIC_DEPLOYMENT_TARGET: '' },
    { EXPO_PUBLIC_APP_ENV: 'production' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://user:password@app-review.example.test' },
    { EXPO_PUBLIC_SUPABASE_URL: 'https://database.invalid' },
    { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private-canary' },
  ])
    assert.throws(() => validatePublicAuthConfig({ ...config, ...change }));
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/verify-web-build-config.mjs'],
    { encoding: 'utf8', env: { ...process.env, ...preview, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' } },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('hosted config rejects invalid environments, origins, projects and support recipients', () => {
  for (const change of [
    { EXPO_PUBLIC_APP_ENV: 'preview' },
    { EXPO_PUBLIC_APP_ORIGIN: 'http://beta.brockfantasy.ca' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://beta.brockfantasy.ca/path' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://play.brockfantasy.ca' },
    { EXPO_PUBLIC_APP_ENV: 'production' },
    { EXPO_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { EXPO_PUBLIC_SUPPORT_EMAIL: 'gt22me@brocku.ca' },
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

test('Vercel build preflight supplies missing public defaults and enforces the beta branch', () => {
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
  assert.equal(missing.status, 0, missing.stderr);
  for (const change of [
    { EXPO_PUBLIC_APP_ENV: 'production' },
    { EXPO_PUBLIC_APP_ENV: 'local' },
    { EXPO_PUBLIC_APP_ORIGIN: 'https://other.example' },
    { EXPO_PUBLIC_SUPABASE_SECRET_KEY: 'private-fixture' },
  ])
    assert.notEqual(run(change).status, 0);
});

test('clean main and beta deployments resolve validated public defaults without private inputs', () => {
  for (const [branch, environment, origin] of [
    ['main', 'production', 'https://play.brockfantasy.ca'],
    ['beta', 'staging', 'https://beta.brockfantasy.ca'],
  ]) {
    const env = { VERCEL: '1', VERCEL_GIT_COMMIT_REF: branch, VERCEL_ENV: 'production' };
    const config = resolvePublicDeploymentConfig(env);
    validatePublicAuthConfig(config);
    assert.equal(config.EXPO_PUBLIC_APP_ENV, environment);
    assert.equal(config.EXPO_PUBLIC_APP_ORIGIN, origin);
    assert.deepEqual(Object.keys(config).sort(), Object.keys(beta).sort());
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/verify-web-build-config.mjs'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...Object.fromEntries(Object.keys(beta).map((name) => [name, ''])),
          EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
          SUPABASE_SECRET_KEY: '',
          AUTH_RATE_LIMIT_HMAC_SECRET: '',
          ...env,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  const invalidMain = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/verify-web-build-config.mjs'],
    {
      encoding: 'utf8',
      env: { ...process.env, ...beta, VERCEL: '1', VERCEL_GIT_COMMIT_REF: 'main' },
    },
  );
  assert.notEqual(invalidMain.status, 0);
  assert.match(invalidMain.stderr, /main branch requires EXPO_PUBLIC_APP_ENV=production/u);
});

test('deployment defaults preserve overrides, local configuration and private credential boundaries', () => {
  const env = {
    ...beta,
    VERCEL: '1',
    SUPABASE_SECRET_KEY: 'server-only-fixture',
    AUTH_RATE_LIMIT_HMAC_SECRET: 'server-only-hmac-fixture',
  };
  assert.deepEqual(resolvePublicDeploymentConfig(env), beta);
  assert.deepEqual(resolvePublicDeploymentConfig({ ...env, VERCEL: '' }), {});
  const legacy = 'fixture.' + Buffer.from('{"role":"anon"}').toString('base64url') + '.signature';
  const config = resolvePublicDeploymentConfig({
    VERCEL: '1',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: legacy,
  });
  assert.equal(config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, legacy);
  validatePublicAuthConfig(config);
  for (const key of ['sb_secret_never_mask_this', 'invalid-key'])
    assert.throws(() =>
      validatePublicAuthConfig(
        resolvePublicDeploymentConfig({ VERCEL: '1', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }),
      ),
    );
});

test('Vercel API cold starts apply public defaults before loading Expo without changing server secrets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const Module = require('node:module');
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === 'expo-server/adapter/vercel') return {
    createRequestHandler() {
      const { resolvePublicDeploymentConfig } = require('./config/public-deployment.cjs');
      const expected = resolvePublicDeploymentConfig({ VERCEL: '1', VERCEL_GIT_COMMIT_REF: 'main' });
      require('node:assert/strict').deepEqual(
        Object.fromEntries(Object.keys(expected).map(name => [name, process.env[name]])), expected
      );
      require('node:assert/strict').equal(process.env.SUPABASE_SECRET_KEY, 'server-canary');
      return () => {};
    }
  };
  return load.call(this, name, ...args);
};
require('./api/index.js');`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...Object.fromEntries(Object.keys(beta).map((name) => [name, ''])),
        EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
        VERCEL: '1',
        VERCEL_GIT_COMMIT_REF: 'main',
        SUPABASE_SECRET_KEY: 'server-canary',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
