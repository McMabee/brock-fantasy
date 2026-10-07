import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { replaceGoogleBackupRemote } from './lib/google-backup-config.mjs';

// Local operator setup only. OAuth credentials/config never belong in the repo.
const args = process.argv.slice(2);
const reauthorize = args.includes('--reauthorize');
const privateRoot = path.resolve(
  args.find((arg) => !arg.startsWith('--')) ?? 'D:/Brock Fantasy/Private',
);
const clientPath = path.join(privateRoot, 'google-drive-client.json');
const configPath = path.join(privateRoot, 'rclone.conf');
const replacementPath = path.join(
  privateRoot,
  `rclone-replacement-${randomBytes(12).toString('hex')}.tmp`,
);
const scope = 'https://www.googleapis.com/auth/drive.file';
const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(32).toString('base64url');
let server;
let timer;

function equalState(value) {
  const actual = Buffer.from(value ?? '');
  const expected = Buffer.from(state);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

try {
  if (args.some((arg) => arg.startsWith('--') && arg !== '--reauthorize'))
    throw new Error('This setup helper supports only the --reauthorize option.');
  if (process.platform !== 'win32')
    throw new Error('This setup helper opens the Windows system browser.');
  const client = JSON.parse(await readFile(clientPath, 'utf8')).installed;
  if (
    !client?.client_id?.endsWith('.apps.googleusercontent.com') ||
    !client.client_secret ||
    /[\r\n]/u.test(client.client_id + client.client_secret)
  ) {
    throw new Error(
      'Save a valid downloaded Desktop app OAuth client JSON in the private backup folder.',
    );
  }
  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const existingSections = [...existing.matchAll(/^\s*\[brock-backups\]\s*$/gmu)];
  if (existingSections.length > 1)
    throw new Error('The brock-backups configuration has duplicate sections; review it privately.');
  if (existingSections.length && !reauthorize) {
    throw new Error(
      'The brock-backups remote already exists; review it before replacing authentication.',
    );
  }
  let finish;
  let fail;
  const callback = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (
      request.method !== 'GET' ||
      url.pathname !== '/' ||
      !equalState(url.searchParams.get('state'))
    ) {
      response.writeHead(400).end('Invalid backup authentication callback.');
      return;
    }
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      response.writeHead(400).end('Google access was not granted. Return to the setup window.');
      fail(new Error('Google consent did not grant backup access.'));
      return;
    }
    response.end('Consent received. Return to the setup window to confirm completion.');
    finish(url.searchParams.get('code'));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // Windows chooses an available port, avoiding the reserved rclone port.
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirect = `http://127.0.0.1:${server.address().port}/`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  }).forEach(([key, value]) => auth.searchParams.set(key, value));
  const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', auth.toString()], {
    stdio: 'ignore',
    windowsHide: true,
  });
  opener.on('error', () => fail(new Error('The system browser could not be opened.')));
  process.stdout.write(
    'Google consent opened in your browser. No token or URL needs to be shared.\n',
  );
  timer = setTimeout(
    () => fail(new Error('Google consent timed out; run the setup helper again.')),
    15 * 60 * 1000,
  );
  const code = await callback;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Google token exchange failed (HTTP ${response.status}); no response body is logged.`,
    );
  const token = await response.json();
  if (
    !token.access_token ||
    !token.refresh_token ||
    !token.scope?.split(' ').includes(scope) ||
    !(token.expires_in > 0)
  ) {
    throw new Error('Google did not supply the offline Drive-file access required for backups.');
  }
  const storedToken = {
    access_token: token.access_token,
    token_type: token.token_type,
    refresh_token: token.refresh_token,
    expiry: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  };
  const section = [
    '[brock-backups]',
    'type = drive',
    `client_id = ${client.client_id}`,
    `client_secret = ${client.client_secret}`,
    'scope = drive.file',
    `token = ${JSON.stringify(storedToken)}`,
    '',
  ].join('\n');
  // Keep working authentication until the new consent succeeds. Replace only
  // this remote, preserving other remotes and avoiding partial config writes.
  const latest = await readFile(configPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (latest !== existing)
    throw new Error(
      'The brock-backups configuration changed during consent; retry with backup jobs stopped.',
    );
  const replacement = replaceGoogleBackupRemote(existing, section, reauthorize);
  await writeFile(replacementPath, replacement, { mode: 0o600, flag: 'wx' });
  await rename(replacementPath, configPath);
  process.stdout.write(
    'Google Drive backup connection completed. Credentials are in the private folder.\n',
  );
} catch (error) {
  // No arbitrary provider output, URLs, callback codes or credential data.
  const safe =
    error.message.startsWith('Google') ||
    error.message.startsWith('Save a valid') ||
    error.message.startsWith('The brock-backups') ||
    error.message.startsWith('This setup') ||
    error.message.startsWith('The system browser');
  process.stderr.write(
    `${safe ? error.message : 'Backup connection failed; check the private client file and folder permissions.'}\n`,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  server?.closeAllConnections();
  server?.close();
  await rm(replacementPath, { force: true });
}
