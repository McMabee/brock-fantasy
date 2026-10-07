import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? 'D:/Brock Fantasy');
const source = process.argv[3] ?? 'Local';
if (!['Local', 'Offsite'].includes(source)) throw new Error('Unknown backup source.');
const recoveryPasswordSource = process.argv[4] ?? 'workstation-dpapi';
if (!['workstation-dpapi', 'operator-password-manager'].includes(recoveryPasswordSource))
  throw new Error('Unknown recovery password source.');
const offsite = source === 'Offsite';
const workRoot = path.join(root, 'Private', 'work');
const runId = randomUUID();
const scratch = path.join(workRoot, `db-restore-${runId}`);
const container = `brock-backup-restore-${runId}`;
const image = 'public.ecr.aws/supabase/postgres:17.6.1.167';
const started = Date.now();
let createdContainer = false;
const evidence = {
  runId,
  startedAt: new Date().toISOString(),
  source: offsite ? 'google-drive-encrypted-restic-snapshot' : 'local-encrypted-restic-snapshot',
  recoveryPasswordSource,
  independentRecoveryPasswordVerified: false,
  environment: 'disposable-container-network-none-no-host-ports',
  image,
  status: 'running',
  exportsHashVerified: false,
  databaseRestored: false,
  applicationJourneysVerified: false,
  offsiteRecoveryVerified: false,
  cleanupVerified: false,
};

function run(program, args, input, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    const output = []; // Never log SQL or arbitrary provider diagnostics.
    child.stdout.on('data', (chunk) => output.push(chunk));
    const diagnostics = [];
    child.stderr.on('data', (chunk) => diagnostics.push(chunk));
    child.on('error', () => reject(new Error('Required local restore tool could not start.')));
    child.stdin.on('error', () => {});
    child.on('close', async (code) => {
      if (code === 0) return resolve(Buffer.concat(output).toString('utf8'));
      await writeFile(
        path.join(root, 'Private', 'restore-diagnostics.log'),
        Buffer.concat(diagnostics),
        { mode: 0o600 },
      );
      reject(
        new Error(`Restore tool failed with exit code ${code}; sensitive diagnostics suppressed.`),
      );
    });
    child.stdin.end(input);
  });
}
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...(await files(location)));
    else if (item.isFile()) result.push(location);
    else throw new Error('Unexpected link or special file in restore scratch directory.');
  }
  return result;
}
async function sql(query) {
  return run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-A',
      '-t',
    ],
    query,
  );
}

async function cleanupRestore() {
  if (createdContainer) {
    const owned = (
      await run('docker', [
        'inspect',
        '--format',
        '{{ index .Config.Labels "brock.backup.restore" }}',
        container,
      ])
    ).trim();
    if (owned !== runId)
      throw new Error('Refusing to remove a container without the owned restore-run label.');
    await run('docker', ['rm', '--force', '--volumes', container]);
  }
  // Check the final absolute target before recursive cleanup on Windows.
  const relative = path.relative(workRoot, scratch);
  if (relative !== `db-restore-${runId}` || path.isAbsolute(relative) || relative.includes('..'))
    throw new Error('Refusing cleanup outside the owned private restore scratch directory.');
  await rm(scratch, { recursive: true, force: true });
  evidence.cleanupVerified = true;
}
try {
  if (!process.env.RESTIC_PASSWORD)
    throw new Error('Use the protected PowerShell wrapper to supply the recovery password.');
  const receipt = JSON.parse(
    (await readFile(path.join(root, 'Private', 'last-backup-receipt.json'), 'utf8')).replace(
      /^\uFEFF/u,
      '',
    ),
  );
  if (receipt.projectRef !== 'fdovowiihxowzatewxgv' || !/^[a-f0-9]{64}$/u.test(receipt.snapshotId))
    throw new Error('The backup receipt does not identify an expected Brock snapshot.');
  if (offsite && (!receipt.offsiteVerified || !/^[a-f0-9]{64}$/u.test(receipt.offsiteSnapshotId)))
    throw new Error('The receipt does not identify a verified off-site snapshot.');
  evidence.snapshotId = offsite ? receipt.offsiteSnapshotId : receipt.snapshotId;
  await mkdir(scratch, { recursive: false });
  await run(path.join(root, 'Tools', 'restic.exe'), [
    '--repo',
    offsite
      ? 'rclone:brock-backups:BrockFantasyBackups'
      : path.join(root, 'Backups', 'restic-local'),
    '--no-cache',
    'restore',
    evidence.snapshotId,
    '--target',
    scratch,
  ]);
  const restored = await files(scratch);
  const exports = new Map();
  for (const expected of receipt.exports) {
    const matches = restored.filter((file) => path.basename(file) === expected.name);
    if (matches.length !== 1) throw new Error('Restored export file is missing or duplicated.');
    const bytes = await readFile(matches[0]);
    if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256)
      throw new Error('Restored export hash is inconsistent.');
    exports.set(expected.name, bytes);
  }
  evidence.exportsHashVerified = true;
  await run(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      container,
      '--label',
      `brock.backup.restore=${runId}`,
      '--network',
      'none',
      '--env',
      'POSTGRES_PASSWORD',
      image,
    ],
    undefined,
    { POSTGRES_PASSWORD: randomBytes(32).toString('base64url') },
  );
  createdContainer = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    // Init scripts briefly expose a Unix socket before restarting Postgres.
    // TCP readiness identifies the final server, not that temporary process.
    try {
      await run('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!ready) throw new Error('The isolated restore database did not become ready.');
  evidence.stage = 'prepare-isolated-schemas';
  // Managed hosted roles are excluded from CLI role dumps. An isolated image
  // needs these platform owner names before restoring grants/ownership.
  await sql(`do $$ declare r text; begin foreach r in array array[
    'supabase_realtime_admin','supabase_storage_admin','supabase_auth_admin',
    'supabase_functions_admin','supabase_read_only_user'] loop
    if not exists(select 1 from pg_roles where rolname=r) then execute format('create role %I nologin',r); end if;
  end loop; end $$;`);
  await sql(
    'drop schema if exists auth,storage,public,beta_private,supabase_migrations cascade; create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists citext with schema extensions;',
  );
  evidence.stage = 'restore-roles';
  await sql(exports.get('roles.sql'));
  evidence.stage = 'restore-schema';
  await sql(exports.get('schema.sql'));
  evidence.stage = 'restore-data';
  await sql(exports.get('data.sql'));
  evidence.stage = 'integrity-readback';
  const actual = JSON.parse(
    (
      await sql(`select json_build_object(
    'imports',(select count(*) from public.source_imports),
    'sourceRows',(select count(*) from public.source_rows),
    'migrationCount',(select count(*) from supabase_migrations.schema_migrations),
    'publisherRoles',(select count(*) from public.user_roles where user_id='09a3f9f4-ff8a-4c4d-92c7-ceaf19e13b8e' and role='admin'),
    'authUsers',(select count(*) from auth.users),
    'publicTables',(select count(*) from pg_tables where schemaname='public'),
    'rlsDisabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity));`)
    ).trim(),
  );
  // Legacy receipts identify the previously verified 17-migration snapshot.
  // New receipts retain export-time counts rather than assuming a fixed schema.
  const expected = receipt.databaseIntegrity ?? {
    imports: 16,
    sourceRows: 337,
    migrationCount: 17,
    publisherRoles: 1,
    authUsers: 1,
    publicTables: 58,
    rlsDisabled: 0,
  };
  if (
    Object.keys(actual).some(
      (key) => !Number.isSafeInteger(expected[key]) || actual[key] !== expected[key],
    )
  )
    throw new Error(
      'Restored database integrity readback differs from the expected post-import state.',
    );
  evidence.integrity = actual;
  if (actual.migrationCount >= 18) {
    const managerRestored =
      (
        await sql(
          "select exists(select 1 from beta_private.admin_role_managers where user_id='09a3f9f4-ff8a-4c4d-92c7-ceaf19e13b8e');",
        )
      ).trim() === 't';
    if (!managerRestored)
      throw new Error('Named operator role-management capability was not restored.');
    evidence.operatorRoleManagementRestored = true;
  }
  evidence.databaseRestored = true;
  evidence.offsiteRecoveryVerified = offsite;
  evidence.independentRecoveryPasswordVerified =
    recoveryPasswordSource === 'operator-password-manager';
  evidence.status = 'verified';
} catch {
  evidence.status = 'failed';
  evidence.failure =
    'Isolated database restore or integrity readback failed; no private SQL or provider diagnostics retained in public evidence.';
  process.exitCode = 1;
} finally {
  await cleanupRestore();
  evidence.finishedAt = new Date().toISOString();
  evidence.elapsedSeconds = (Date.now() - started) / 1000;
  evidence.limitations = [
    'Database integrity only: no website/Auth API/draft/scoring journeys or deleted-record replay were tested.',
    evidence.independentRecoveryPasswordVerified
      ? 'Operator supplied the password-manager recovery key; this drill still used the current workstation, not a separate recovery environment.'
      : 'Independently retrieved password-manager recovery key not verified in this drill.',
    offsite
      ? 'Google off-site repository restored without local cache.'
      : 'Local encrypted repository only: Google off-site recovery not tested in this drill.',
    'Storage objects and external provider/job configuration are outside this logical database export.',
  ];
  await writeFile(
    path.join(
      root,
      'Private',
      offsite ? 'last-database-restore-offsite.json' : 'last-database-restore.json',
    ),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}
