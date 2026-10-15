import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { publishPreview } from './lib/import-publication.mjs';

// This command never reads hosted credentials and never resets an existing DB.
// All writes belong to a fresh UUID-prefixed synthetic fixture and are removed.
const command =
  process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json']]
    : ['pnpm', ['exec', 'supabase', 'status', '-o', 'json']];
const local = JSON.parse(
  execFileSync(command[0], command[1], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
);
const destination = new URL(local.API_URL);
assert.equal(destination.protocol, 'http:');
assert.ok(
  ['127.0.0.1', 'localhost'].includes(destination.hostname),
  'Rehearsal must target loopback only.',
);
const runId = randomUUID();
const seasonId = randomUUID();
const prefix = `local-publication-${runId}/`;
const label = `local-publication-${runId}`;
const directory = path.resolve('logic', 'import-receipts', label);
await mkdir(directory, { recursive: true });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const counts = [25, 22, 20, 22, 31, 27, 23, 24, 23, 42, 40, 10, 10, 4, 10, 4];
const manifest = {
  generatedAt: new Date().toISOString(),
  seasonId,
  season: label,
  timezone: 'America/Toronto',
  normalizerVersion: 'synthetic-local-publication-rehearsal-v1',
  dataApprovals: {
    sourceHash: sha256('local fixture approval'),
    approvalId: 'synthetic-local-only',
  },
  officialEvidence: { sourceHash: sha256('local fixture mapping') },
  issues: [],
  activation: { allowed: false },
  imports: counts.map((rowCount, index) => {
    const sourceHash = sha256(`${runId}:${index}:source`);
    return {
      source: `${prefix}source-${index}.csv`,
      sourceHash,
      revisionHash: sha256(`${sourceHash}:revision`),
      kind: 'roster',
      status: 'preview',
      issues: [],
      rowCount,
      approval: { sourceHash, approvalId: 'synthetic-local-only', approvedBy: 'Synthetic fixture' },
      rows: Array.from({ length: rowCount }, (_, row) => ({
        rowNumber: (row + 2) * 10,
        raw: {
          Name: `Synthetic Athlete ${index}-${row}`,
          GP: row === 0 ? '' : '0',
          FP: row === 0 ? 'N/A' : '0',
        },
        normalized: {
          type: 'fixture',
          sourceRowNumber: row + 2,
          draftEligible: false,
          value: row === 0 ? null : 0,
        },
      })),
    };
  }),
};
const headers = {
  apikey: local.SERVICE_ROLE_KEY,
  authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
};
async function api(route, method = 'GET', body) {
  const response = await fetch(`${destination.origin}${route}`, {
    method,
    headers: { ...headers, prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Local fixture API failed (${method}, HTTP ${response.status}).`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const filter = (parameters) => new URLSearchParams(parameters).toString();
let userId;
let seasonCreated = false;
let result;
try {
  const user = await api('/auth/v1/admin/users', 'POST', {
    email: `${label}@example.test`,
    password: `LocalOnly-${randomUUID()}!`,
    email_confirm: true,
    user_metadata: {
      display_name: 'Synthetic Publication Admin',
      beta_age_eligible: true,
      beta_eligibility_year: Number(
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric' }).format(
          new Date(),
        ),
      ),
      beta_eligibility_policy_version: 'brock-beta-eligibility-2026-10-06.1',
    },
  });
  userId = user.id;
  await api('/rest/v1/user_roles', 'POST', { user_id: userId, role: 'admin' });
  await api('/rest/v1/fantasy_seasons', 'POST', {
    id: seasonId,
    label,
    timezone: manifest.timezone,
    rule_version: 'synthetic-local-only',
    trade_deadline: '2027-01-31T23:59:59Z',
  });
  seasonCreated = true;
  const options = {
    url: destination.origin,
    key: local.SERVICE_ROLE_KEY,
    projectRef: 'local',
    allowLocal: true,
    operatorName: 'Synthetic Publication Admin',
    operatorProfileId: userId,
    receiptPath: path.join(directory, '01-interrupted.json'),
    pause: async () => {},
  };
  let failures = 0;
  await assert.rejects(
    publishPreview(manifest, {
      ...options,
      fetchImpl: async (url, request) => {
        if (String(url).includes('/source_rows?') && request.method === 'POST' && failures < 3) {
          failures++;
          return new Response('Induced local fixture failure', { status: 503 });
        }
        return fetch(url, request);
      },
    }),
    /HTTP 503/u,
  );
  const partial = JSON.parse(await readFile(options.receiptPath, 'utf8'));
  assert.equal(partial.status, 'failed');
  assert.ok(partial.imports[0].databaseImportId);

  const recovered = await publishPreview(manifest, {
    ...options,
    receiptPath: path.join(directory, '02-recovered.json'),
  });
  assert.equal(recovered.imports.length, 16);
  assert.equal(recovered.verifiedRows, 337);
  assert.equal(recovered.imports[0].databaseImportId, partial.imports[0].databaseImportId);
  const retry = await publishPreview(manifest, {
    ...options,
    receiptPath: path.join(directory, '03-retry.json'),
  });
  assert.deepEqual(
    retry.imports.map((item) => item.databaseImportId),
    recovered.imports.map((item) => item.databaseImportId),
  );

  const changed = structuredClone(manifest);
  changed.imports[0].revisionHash = sha256('synthetic changed normalizer revision');
  const revision = await publishPreview(changed, {
    ...options,
    receiptPath: path.join(directory, '04-new-revision.json'),
  });
  assert.notEqual(revision.imports[0].databaseImportId, recovered.imports[0].databaseImportId);
  assert.deepEqual(
    revision.imports.slice(1).map((item) => item.databaseImportId),
    recovered.imports.slice(1).map((item) => item.databaseImportId),
  );

  await api(
    `/rest/v1/source_imports?${filter({ id: `eq.${recovered.imports[0].databaseImportId}`, season_id: `eq.${seasonId}` })}`,
    'PATCH',
    { status: 'published' },
  );
  await assert.rejects(
    publishPreview(manifest, {
      ...options,
      receiptPath: path.join(directory, '05-published-rejected.json'),
    }),
    /already published/u,
  );
  result = {
    recordedAt: new Date().toISOString(),
    environment: 'disposable-local-rehearsal',
    hostedPublication: false,
    syntheticFixturesOnly: true,
    runId,
    sourceCount: 16,
    verifiedRows: 337,
    partialFailureRetainedId: true,
    retryReusedIds: true,
    changedRevisionCreatedSeparateId: true,
    publishedRevisionRejected: true,
    canonicalPoolActivated: false,
    receiptDirectory: path.relative(process.cwd(), directory).replaceAll('\\', '/'),
    importIds: recovered.imports.map((item) => item.databaseImportId),
  };
} finally {
  // Check source prefix and season ownership before removing only this fixture.
  const rows = await api(
    `/rest/v1/source_imports?${filter({ select: 'id,source,season_id', season_id: `eq.${seasonId}` })}`,
  );
  for (const item of rows) {
    assert.ok(item.source.startsWith(prefix));
    assert.equal(item.season_id, seasonId);
    await api(`/rest/v1/source_rows?${filter({ import_id: `eq.${item.id}` })}`, 'DELETE');
    await api(
      `/rest/v1/source_imports?${filter({ id: `eq.${item.id}`, season_id: `eq.${seasonId}` })}`,
      'DELETE',
    );
  }
  if (seasonCreated)
    await api(
      `/rest/v1/fantasy_seasons?${filter({ id: `eq.${seasonId}`, label: `eq.${label}` })}`,
      'DELETE',
    );
  if (userId) await api(`/auth/v1/admin/users/${userId}`, 'DELETE');
  if (result) {
    result.fixturesRemoved = true;
    const evidencePath = path.join(
      'dev',
      'docs',
      'evidence',
      `${new Date().toISOString().slice(0, 10)}-publication-rehearsal.json`,
    );
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      JSON.stringify({
        evidencePath,
        sourceCount: 16,
        verifiedRows: 337,
        hostedPublication: false,
        fixturesRemoved: true,
      }),
    );
  }
}
