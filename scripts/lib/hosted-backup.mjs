import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_PROJECT_REF = 'fdovowiihxowzatewxgv';
export const BACKUP_REMOTE = 'rclone:brock-backups:BrockFantasyBackups';
const exportNames = ['roles.sql', 'schema.sql', 'data.sql'];
const snapshotIdPattern = /^[a-f0-9]{64}$/u;
const allowedSchemas = [
  'auth',
  'public',
  'storage',
  'beta_private',
  'app_private',
  'rpc_private',
  'registration_private',
  'supabase_migrations',
  'extensions',
];

export function validateBackupConfiguration(env) {
  for (const key of [
    'SUPABASE_ACCESS_TOKEN',
    'BROCK_BACKUP_RCLONE_CONFIG_BASE64',
    'RESTIC_PASSWORD',
    'BROCK_BACKUP_HEARTBEAT_URL',
  ]) {
    if (typeof env[key] !== 'string' || !env[key].trim())
      throw new Error(`Missing required backup setting: ${key}.`);
  }
  const encoded = env.BROCK_BACKUP_RCLONE_CONFIG_BASE64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0)
    throw new Error('Backup remote configuration must be canonical Base64.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length > 64 * 1024)
    throw new Error('Backup remote configuration is malformed or too large.');
  const config = bytes.toString('utf8').replace(/^\uFEFF/u, '');
  const sections = [...config.matchAll(/^\s*\[([^\]]+)\]\s*$/gmu)];
  if (sections.length !== 1 || sections[0][1] !== 'brock-backups')
    throw new Error('Provide only the selected brock-backups remote, without personal remotes.');
  const entries = new Map();
  for (const line of config.split(/\r?\n/u)) {
    if (/^\s*(?:$|[#;]|\[)/u.test(line)) continue;
    const match = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || entries.has(match[1]))
      throw new Error('Duplicate or malformed backup remote setting.');
    entries.set(match[1], match[2]);
  }
  if (
    entries.get('type') !== 'drive' ||
    entries.get('scope') !== 'drive.file' ||
    !entries.get('client_id') ||
    !entries.get('client_secret')
  )
    throw new Error('Use the approved Desktop client with the narrow drive.file scope.');
  let token;
  try {
    token = JSON.parse(entries.get('token'));
  } catch {
    throw new Error('Backup OAuth token configuration is incomplete.');
  }
  if (!token.refresh_token || !token.access_token)
    throw new Error('Backup OAuth configuration has no completed refreshable connection.');
  let heartbeat;
  try {
    heartbeat = new URL(env.BROCK_BACKUP_HEARTBEAT_URL);
  } catch {
    throw new Error('Invalid private backup heartbeat URL.');
  }
  if (
    heartbeat.protocol !== 'https:' ||
    heartbeat.username ||
    heartbeat.password ||
    heartbeat.search ||
    heartbeat.hash ||
    !['uptime.betterstack.com', 'incidents.betterstack.com'].includes(heartbeat.hostname) ||
    !/^\/api\/v1\/heartbeat\/[a-zA-Z0-9-]+$/u.test(heartbeat.pathname)
  )
    throw new Error('Use the private HTTPS heartbeat endpoint supplied by Better Stack.');
  return { config, heartbeat: heartbeat.href };
}

// Capture stdout/stderr and replace failures with a fixed message. Neither tool
// diagnostics nor secret-bearing arguments can enter the public Actions log.
export function invokeBackupTool(program, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      { cwd, env, windowsHide: true, timeout: 5 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(new Error('A required backup tool failed; private diagnostics suppressed.'));
        else resolve(stdout);
      },
    );
  });
}

async function restoredFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await restoredFiles(filename)));
    else if (entry.isFile()) files.push(filename);
    else throw new Error('Unexpected link or special file in the restored backup.');
  }
  return files;
}

async function removeOwnedWorkspace(temporaryRoot, scratch) {
  const relative = path.relative(path.resolve(temporaryRoot), scratch);
  if (
    path.isAbsolute(relative) ||
    relative.includes('..') ||
    !/^brock-encrypted-backup-[A-Za-z0-9]+$/u.test(relative)
  )
    throw new Error('Refusing cleanup outside the owned backup workspace.');
  try {
    await rm(scratch, { recursive: true, force: true });
  } catch {
    throw new Error('Private backup workspace cleanup failed; do not report backup success.');
  }
}

export async function runHostedBackup({
  env = process.env,
  root = process.cwd(),
  temporaryRoot,
  invoke = invokeBackupTool,
  fetchImpl = fetch,
}) {
  const validated = validateBackupConfiguration(env);
  const scratch = await mkdtemp(path.join(temporaryRoot, 'brock-encrypted-backup-'));
  await chmod(scratch, 0o700);
  const outputPath = path.join(scratch, 'exports');
  const restorePath = path.join(scratch, 'restored');
  const workingPath = path.join(scratch, 'project');
  const configPath = path.join(scratch, 'rclone.conf');
  const receipt = {
    version: 1,
    projectRef: BACKUP_PROJECT_REF,
    captureStartedAt: new Date().toISOString(),
    source: 'github-actions',
    encrypted: true,
    status: 'running',
    storageObjectsIncluded: false,
    externalConfigurationIncluded: false,
    databaseRestoreVerified: false,
    heartbeatDelivered: false,
    cleanupVerified: false,
  };
  let stage = 'prepare-private-workspace';
  // Secrets are passed only to the tools that need them, never in command arguments.
  const toolEnv = { ...env };
  for (const key of [
    'SUPABASE_ACCESS_TOKEN',
    'BROCK_BACKUP_RCLONE_CONFIG_BASE64',
    'RESTIC_PASSWORD',
    'BROCK_BACKUP_HEARTBEAT_URL',
  ])
    delete toolEnv[key];
  const cliEnv = { ...toolEnv, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN };
  const resticEnv = { ...toolEnv, RESTIC_PASSWORD: env.RESTIC_PASSWORD, RCLONE_CONFIG: configPath };
  const rcloneEnv = { ...toolEnv, RCLONE_CONFIG: configPath };
  const cli = (...args) =>
    invoke(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), ...args], {
      cwd: workingPath,
      env: cliEnv,
    });
  const restic = (...args) =>
    invoke('restic', ['--repo', BACKUP_REMOTE, ...args], { cwd: scratch, env: resticEnv });
  try {
    await mkdir(outputPath, { mode: 0o700 });
    await mkdir(restorePath, { mode: 0o700 });
    await mkdir(path.join(workingPath, 'supabase'), { recursive: true, mode: 0o700 });
    await copyFile(
      path.join(root, 'supabase/config.toml'),
      path.join(workingPath, 'supabase/config.toml'),
    );
    await writeFile(configPath, validated.config, { mode: 0o600 });
    stage = 'verify-offsite-quota';
    const quota = JSON.parse(
      await invoke('rclone', ['about', 'brock-backups:', '--json'], {
        cwd: scratch,
        env: rcloneEnv,
      }),
    );
    if (!Number.isFinite(quota.free) || quota.free < 100 * 1024 * 1024)
      throw new Error('Insufficient verified off-site storage headroom.');
    receipt.offsiteUnusedBytes = quota.free;
    // Refuse to initialize a new or incorrectly addressed repository unattended.
    stage = 'verify-existing-encrypted-repository';
    await restic('snapshots', '--json');
    stage = 'link-exact-brock-project';
    await cli(
      'link',
      '--project-ref',
      BACKUP_PROJECT_REF,
      '--agent',
      'yes',
      '--output-format',
      'json',
    );
    stage = 'read-export-schemas';
    const query = `select nspname from pg_namespace where nspname in (${allowedSchemas.map((name) => `'${name}'`).join(',')}) order by nspname;`;
    const result = JSON.parse(
      await cli(
        'db',
        'query',
        '--linked',
        '--project-ref',
        BACKUP_PROJECT_REF,
        query,
        '-o',
        'json',
      ),
    );
    const schemas = result.rows?.map((row) => row.nspname);
    if (
      !schemas ||
      !['auth', 'public', 'storage'].every((name) => schemas.includes(name)) ||
      schemas.some((name) => !allowedSchemas.includes(name))
    )
      throw new Error('The backup schema readback is incomplete.');
    receipt.schemas = schemas;
    stage = 'export-database';
    const base = ['db', 'dump', '--linked', '--project-ref', BACKUP_PROJECT_REF];
    // Serial CLI calls avoid rotation races in Supabase's ephemeral login role.
    await cli(...base, '--role-only', '--file', path.join(outputPath, 'roles.sql'));
    await cli(
      ...base,
      '--schema',
      schemas.join(','),
      '--file',
      path.join(outputPath, 'schema.sql'),
    );
    await cli(
      ...base,
      '--schema',
      schemas.join(','),
      '--data-only',
      '--use-copy',
      '--file',
      path.join(outputPath, 'data.sql'),
    );
    receipt.exports = [];
    for (const name of exportNames) {
      const filename = path.join(outputPath, name);
      const bytes = await readFile(filename);
      if (!(await stat(filename)).isFile() || !bytes.length)
        throw new Error('A required database export is empty.');
      receipt.exports.push({
        name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    receipt.captureCompletedAt = new Date().toISOString();
    await writeFile(
      path.join(outputPath, 'backup-manifest.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      { mode: 0o600 },
    );
    stage = 'encrypt-and-upload';
    const backup = await restic(
      'backup',
      outputPath,
      '--host',
      'brock-hosted-backup',
      '--tag',
      BACKUP_PROJECT_REF,
      '--group-by',
      'tags',
      '--json',
    );
    const summary = backup
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line))
      .findLast((row) => row.message_type === 'summary');
    if (!summary || !snapshotIdPattern.test(summary.snapshot_id))
      throw new Error('Backup did not return a valid snapshot ID.');
    receipt.snapshotId = summary.snapshot_id;
    stage = 'read-back-new-snapshot';
    const snapshots = JSON.parse(await restic('snapshots', '--json', '--tag', BACKUP_PROJECT_REF));
    if (!snapshots.some((snapshot) => snapshot.id === receipt.snapshotId))
      throw new Error('New snapshot was not found in off-site storage.');
    stage = 'restore-without-cache';
    await restic('--no-cache', 'restore', receipt.snapshotId, '--target', restorePath);
    const files = await restoredFiles(restorePath);
    for (const expected of [
      ...receipt.exports,
      {
        name: 'backup-manifest.json',
        sha256: createHash('sha256')
          .update(await readFile(path.join(outputPath, 'backup-manifest.json')))
          .digest('hex'),
      },
    ]) {
      const matches = files.filter((filename) => path.basename(filename) === expected.name);
      if (
        matches.length !== 1 ||
        createHash('sha256')
          .update(await readFile(matches[0]))
          .digest('hex') !== expected.sha256
      )
        throw new Error('Restored off-site export or manifest hash did not match.');
    }
    receipt.offsiteRestoredExportHashesVerified = true;
    stage = 'prune-expired-brock-snapshots';
    // One group across all paths/hosts: ephemeral run directories must not keep
    // one expired snapshot per distinct path forever. Other tags are untouched.
    await restic(
      'forget',
      '--tag',
      BACKUP_PROJECT_REF,
      '--group-by=',
      '--keep-within',
      '30d',
      '--prune',
    );
    const retained = JSON.parse(await restic('snapshots', '--json', '--tag', BACKUP_PROJECT_REF));
    if (!retained.some((snapshot) => snapshot.id === receipt.snapshotId))
      throw new Error('Retention unexpectedly removed the new snapshot.');
  } catch {
    throw new Error(`Backup failed during ${stage}; private tool diagnostics suppressed.`);
  } finally {
    await removeOwnedWorkspace(temporaryRoot, scratch);
    receipt.cleanupVerified = true;
  }
  // Success is signalled only after verified recovery, retention and private cleanup.
  stage = 'deliver-success-heartbeat';
  try {
    const response = await fetchImpl(validated.heartbeat, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Heartbeat delivery failed.');
    await response.body?.cancel();
    receipt.heartbeatDelivered = true;
  } catch {
    throw new Error(`Backup failed during ${stage}; private endpoint diagnostics suppressed.`);
  }
  receipt.completedAt = new Date().toISOString();
  receipt.status = 'verified';
  return receipt;
}
