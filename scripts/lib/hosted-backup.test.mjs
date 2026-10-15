import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BACKUP_PROJECT_REF,
  BACKUP_REMOTE,
  invokeBackupTool,
  runHostedBackup,
  validateBackupConfiguration,
} from './hosted-backup.mjs';

const config =
  '[brock-backups]\ntype = drive\nscope = drive.file\nclient_id = fixture-client\nclient_secret = fixture-client-secret\ntoken = {"access_token":"fixture-access","refresh_token":"fixture-refresh"}\n';
const env = {
  PATH: process.env.PATH,
  SUPABASE_ACCESS_TOKEN: 'fixture-private-project-token',
  BROCK_BACKUP_RCLONE_CONFIG_BASE64: Buffer.from(config).toString('base64'),
  RESTIC_PASSWORD: 'fixture-recovery-password',
  BROCK_BACKUP_HEARTBEAT_URL: 'https://uptime.betterstack.com/api/v1/heartbeat/fixture-private-id',
};
const snapshotId = 'a'.repeat(64);

async function harness(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'brock-backup-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = path.join(root, 'runner temp with spaces');
  await mkdir(temporaryRoot);
  await mkdir(path.join(root, 'supabase'));
  await writeFile(path.join(root, 'supabase/config.toml'), 'project_id="fixture"\n');
  const calls = [];
  let exported;
  let heartbeatCount = 0;
  const invoke = async (program, args, settings) => {
    calls.push({ program, args, settings });
    if (options.failAt?.(program, args))
      throw new Error('provider printed fixture-private-project-token');
    if (program === process.execPath) {
      assert.equal(settings.env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_ACCESS_TOKEN);
      assert.equal(settings.env.RESTIC_PASSWORD, undefined);
      assert.equal(settings.env.BROCK_BACKUP_RCLONE_CONFIG_BASE64, undefined);
      assert.equal(settings.env.BROCK_BACKUP_HEARTBEAT_URL, undefined);
      assert.equal(args[args.indexOf('--project-ref') + 1], BACKUP_PROJECT_REF);
      if (args.includes('query'))
        return JSON.stringify({
          rows: ['auth', 'public', 'storage', 'rpc_private', 'registration_private'].map(
            (nspname) => ({ nspname }),
          ),
        });
      if (args.includes('dump')) {
        const file = args[args.indexOf('--file') + 1];
        exported = path.dirname(file);
        await writeFile(file, `fixture private SQL ${path.basename(file)}`);
      }
      return '{}';
    }
    assert.equal(settings.env.SUPABASE_ACCESS_TOKEN, undefined);
    assert.equal(settings.env.BROCK_BACKUP_RCLONE_CONFIG_BASE64, undefined);
    assert.equal(settings.env.BROCK_BACKUP_HEARTBEAT_URL, undefined);
    if (program === 'rclone') {
      assert.equal(settings.env.RESTIC_PASSWORD, undefined);
      return JSON.stringify({ free: 1024 ** 3 });
    }
    assert.equal(program, 'restic');
    assert.equal(args[1], BACKUP_REMOTE);
    assert.equal(settings.env.RESTIC_PASSWORD, env.RESTIC_PASSWORD);
    assert.equal(await readFile(settings.env.RCLONE_CONFIG, 'utf8'), config);
    if (args.includes('backup'))
      return JSON.stringify({ message_type: 'summary', snapshot_id: snapshotId });
    if (args.includes('snapshots')) {
      const pruned = calls.some((call) => call.args.includes('forget'));
      return JSON.stringify(options.removeNewSnapshot && pruned ? [] : [{ id: snapshotId }]);
    }
    if (args.includes('restore')) {
      assert.ok(args.includes('--no-cache'));
      const target = args[args.indexOf('--target') + 1];
      for (const name of await readdir(exported)) {
        const data = await readFile(path.join(exported, name));
        await writeFile(
          path.join(target, name),
          options.corrupt && name === 'data.sql' ? 'damaged cloud data' : data,
        );
      }
    }
    return '{}';
  };
  const fetchImpl = async (url, request) => {
    heartbeatCount++;
    assert.equal(url, env.BROCK_BACKUP_HEARTBEAT_URL);
    assert.equal(request.redirect, 'error');
    assert.deepEqual(
      await readdir(temporaryRoot),
      [],
      'all private SQL and credentials removed before success heartbeat',
    );
    return { ok: !options.heartbeatFailure };
  };
  return { root, temporaryRoot, calls, invoke, fetchImpl, heartbeats: () => heartbeatCount };
}

test('backup configuration excludes personal remotes and broad Drive scopes', () => {
  assert.equal(validateBackupConfiguration(env).config, config);
  for (const input of [
    config + '\n[personal]\ntype=drive\n',
    config.replace('scope = drive.file', 'scope = drive'),
    config.replace('"refresh_token":"fixture-refresh"', '"expired":true'),
  ]) {
    assert.throws(() =>
      validateBackupConfiguration({
        ...env,
        BROCK_BACKUP_RCLONE_CONFIG_BASE64: Buffer.from(input).toString('base64'),
      }),
    );
  }
});

test('backup requires all secrets and a valid private Better Stack HTTPS endpoint', () => {
  for (const key of Object.keys(env).filter((key) => key !== 'PATH')) {
    assert.throws(() => validateBackupConfiguration({ ...env, [key]: '' }));
  }
  for (const heartbeat of [
    'http://uptime.betterstack.com/api/v1/heartbeat/private',
    'https://example.com/private',
    env.BROCK_BACKUP_HEARTBEAT_URL + '?token=private',
  ]) {
    assert.throws(() =>
      validateBackupConfiguration({ ...env, BROCK_BACKUP_HEARTBEAT_URL: heartbeat }),
    );
  }
});

test('verified off-site exports retain hashes and snapshot ID, isolate credentials and clean up before heartbeat', async (t) => {
  const h = await harness(t);
  const receipt = await runHostedBackup({ ...h, env });
  assert.equal(receipt.snapshotId, snapshotId);
  assert.equal(receipt.offsiteRestoredExportHashesVerified, true);
  assert.equal(receipt.cleanupVerified, true);
  assert.equal(receipt.databaseRestoreVerified, false);
  assert.equal(receipt.heartbeatDelivered, true);
  assert.equal(receipt.exports.length, 3);
  assert.equal(h.heartbeats(), 1);
  const prune = h.calls.find((call) => call.args.includes('forget'));
  assert.ok(prune.args.includes('--group-by='), 'pruning covers ephemeral paths in one group');
  assert.equal(prune.args[prune.args.indexOf('--tag') + 1], BACKUP_PROJECT_REF);
  for (const secret of [
    env.SUPABASE_ACCESS_TOKEN,
    env.RESTIC_PASSWORD,
    env.BROCK_BACKUP_RCLONE_CONFIG_BASE64,
    env.BROCK_BACKUP_HEARTBEAT_URL,
  ]) {
    assert.ok(
      !JSON.stringify(receipt).includes(secret),
      'sanitized receipt contains no private setting',
    );
  }
});

test('damaged cloud restore blocks retention and success heartbeat, while removing plaintext', async (t) => {
  const h = await harness(t, { corrupt: true });
  await assert.rejects(runHostedBackup({ ...h, env }), /restore-without-cache/u);
  assert.equal(h.heartbeats(), 0);
  assert.ok(!h.calls.some((call) => call.args.includes('forget')));
  assert.deepEqual(await readdir(h.temporaryRoot), []);
});

test('failed database export suppresses secret-bearing diagnostics and removes private files', async (t) => {
  const h = await harness(t, {
    failAt: (program, args) => program === process.execPath && args.includes('--data-only'),
  });
  await assert.rejects(runHostedBackup({ ...h, env }), (error) => {
    assert.match(error.message, /export-database/u);
    assert.ok(!error.message.includes(env.SUPABASE_ACCESS_TOKEN));
    return true;
  });
  assert.deepEqual(await readdir(h.temporaryRoot), []);
  assert.equal(h.heartbeats(), 0);
});

test('missing new snapshot after retention prevents a successful heartbeat', async (t) => {
  const h = await harness(t, { removeNewSnapshot: true });
  await assert.rejects(runHostedBackup({ ...h, env }), /prune-expired-brock-snapshots/u);
  assert.equal(h.heartbeats(), 0);
});

test('failed heartbeat reports failure without exposing its endpoint after verified backup and cleanup', async (t) => {
  const h = await harness(t, { heartbeatFailure: true });
  await assert.rejects(runHostedBackup({ ...h, env }), (error) => {
    assert.match(error.message, /deliver-success-heartbeat/u);
    assert.ok(!error.message.includes('fixture-private-id'));
    return true;
  });
  assert.deepEqual(await readdir(h.temporaryRoot), []);
});

test('the real subprocess wrapper suppresses provider stderr on failure', async () => {
  await assert.rejects(
    invokeBackupTool(
      process.execPath,
      ['-e', 'process.stderr.write(process.env.PRIVATE_FIXTURE); process.exit(1)'],
      {
        cwd: process.cwd(),
        env: { ...process.env, PRIVATE_FIXTURE: 'private-provider-diagnostic' },
      },
    ),
    (error) => {
      assert.ok(!error.message.includes('private-provider-diagnostic'));
      assert.match(error.message, /private diagnostics suppressed/u);
      return true;
    },
  );
});
