import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishPreview } from './import-publication.mjs';

const projectRef = 'b'.repeat(20);
const profileId = 'b0000000-0000-4000-8000-000000000001';
const key = 'sb_secret_not_for_receipts';

function manifestFixture(count = 2, rows = 3) {
  return {
    generatedAt: '2026-10-06T16:00:00.000Z',
    seasonId: 'b0000000-0000-4000-8000-000000000002',
    season: '2026-27',
    timezone: 'America/Toronto',
    normalizerVersion: 'fixture',
    dataApprovals: { sourceHash: 'a'.repeat(64), approvalId: 'approved-fixture' },
    officialEvidence: { sourceHash: 'b'.repeat(64) },
    issues: [],
    activation: { allowed: false },
    imports: Array.from({ length: count }, (_, index) => ({
      source: `logic/source-${index}.csv`,
      sourceHash: String(index + 1).repeat(64),
      revisionHash: String(index + 3).repeat(64),
      kind: 'roster',
      status: 'preview',
      approval: {
        sourceHash: String(index + 1).repeat(64),
        approvalId: 'approved-fixture',
        approvedBy: 'Tarik',
      },
      issues: [],
      rowCount: rows,
      rows: Array.from({ length: rows }, (_, row) => ({
        rowNumber: row + 20,
        raw: { Name: `Athlete ${row}`, FP: row ? 'N/A' : '0' },
        normalized: { sourceRowNumber: row + 2, name: `Athlete ${row}`, draftEligible: false },
      })),
    })),
  };
}

function databaseFixture(manifest) {
  const database = {
    imports: [],
    rows: [],
    requests: [],
    failures: [],
    admin: true,
    dropRow: false,
  };
  database.fetch = async (url, init) => {
    const endpoint = new URL(url);
    const table = endpoint.pathname.split('/').at(-1);
    const query = endpoint.searchParams;
    database.requests.push({ table, method: init.method, headers: init.headers });
    const fail = database.failures.find(
      (item) => item.table === table && item.method === init.method && item.remaining,
    );
    if (fail) {
      fail.remaining--;
      return new Response(`private provider error ${key}`, {
        status: fail.status,
        headers: { 'retry-after': '1' },
      });
    }
    let records = [];
    if (table === 'profiles')
      records = [{ id: profileId, display_name: 'Publisher', deleted_at: null }];
    if (table === 'user_roles')
      records = database.admin ? [{ user_id: profileId, role: 'admin' }] : [];
    if (table === 'fantasy_seasons')
      records = [{ id: manifest.seasonId, label: manifest.season, timezone: manifest.timezone }];
    if (table === 'source_imports') {
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        assert.equal(init.headers.prefer, 'resolution=ignore-duplicates,return=representation');
        const found = database.imports.find(
          (item) => item.source === body.source && item.source_hash === body.source_hash,
        );
        if (!found) {
          const item = {
            ...body,
            id: randomUUID(),
            created_at: '2026-10-06T16:00:01.000Z',
            published_at: null,
          };
          database.imports.push(item);
          records = [item];
        }
      } else
        records = database.imports.filter(
          (item) =>
            `eq.${item.source}` === query.get('source') &&
            `eq.${item.source_hash}` === query.get('source_hash'),
        );
    }
    if (table === 'source_rows') {
      if (init.method === 'POST') {
        assert.equal(init.headers.prefer, 'resolution=ignore-duplicates,return=representation');
        for (const row of JSON.parse(init.body)) {
          if (
            !database.rows.some(
              (item) => item.import_id === row.import_id && item.row_number === row.row_number,
            ) &&
            !database.dropRow
          )
            database.rows.push({ ...row, entity_id: null });
        }
      } else {
        records = database.rows
          .filter((row) => `eq.${row.import_id}` === query.get('import_id'))
          .sort((a, b) => a.row_number - b.row_number);
        records = records.slice(
          Number(query.get('offset')),
          Number(query.get('offset')) + Number(query.get('limit')),
        );
      }
    }
    return new Response(JSON.stringify(records), { status: 200 });
  };
  return database;
}

async function withPublication(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'brock-publication-'));
  const manifest = manifestFixture();
  const database = databaseFixture(manifest);
  const options = {
    url: `https://${projectRef}.supabase.co`,
    key,
    projectRef,
    operatorName: 'Publisher',
    operatorProfileId: profileId,
    receiptPath: path.join(directory, 'receipt.json'),
    fetchImpl: database.fetch,
    pause: async () => {},
    release: { commit: 'fixture', workingTreeDirty: true },
  };
  try {
    await run({ directory, manifest, database, options });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('publication freezes its manifest, records attribution and reads back every import/row', async () => {
  await withPublication(async ({ manifest, database, options }) => {
    const receipt = await publishPreview(manifest, options);
    assert.equal(receipt.status, 'verified');
    assert.equal(receipt.activation, false);
    assert.equal(receipt.verifiedRows, 6);
    assert.equal(receipt.imports.length, 2);
    assert.ok(receipt.imports.every((item) => item.databaseImportId && item.status === 'verified'));
    assert.ok(
      database.imports.every((item) => item.imported_by === profileId && item.status === 'preview'),
    );
    assert.deepEqual(JSON.parse(await readFile(receipt.manifest.path, 'utf8')), manifest);
    const saved = await readFile(options.receiptPath, 'utf8');
    assert.equal(saved.includes(key), false);
    assert.deepEqual(JSON.parse(saved), receipt);
    assert.ok(database.requests.every((request) => !request.headers.authorization));
  });
});

test('a same-revision retry reuses UUIDs and preserves first publisher, creation time and rows', async () => {
  await withPublication(async ({ directory, manifest, database, options }) => {
    const first = await publishPreview(manifest, options);
    const originalRecords = structuredClone(database.imports);
    manifest.generatedAt = '2026-10-06T17:00:00.000Z';
    const second = await publishPreview(manifest, {
      ...options,
      receiptPath: path.join(directory, 'retry.json'),
    });
    assert.deepEqual(
      second.imports.map((item) => item.databaseImportId),
      first.imports.map((item) => item.databaseImportId),
    );
    assert.deepEqual(database.imports, originalRecords);
    assert.equal(database.rows.length, 6);
    assert.notEqual(first.runId, second.runId);
    await assert.rejects(publishPreview(manifest, options), { code: 'EEXIST' });
  });
});

test('partial failure retains the created UUID, sanitized failure and recovers on a separate attempt', async () => {
  await withPublication(async ({ directory, manifest, database, options }) => {
    database.failures.push({ table: 'source_rows', method: 'POST', status: 400, remaining: 1 });
    await assert.rejects(publishPreview(manifest, options), /HTTP 400/u);
    const partial = JSON.parse(await readFile(options.receiptPath, 'utf8'));
    assert.equal(partial.status, 'failed');
    assert.ok(partial.imports[0].databaseImportId);
    assert.equal(partial.imports[0].status, 'failed');
    assert.equal(partial.imports[1].status, 'pending');
    assert.equal(partial.verifiedRows, 0);
    assert.equal(JSON.stringify(partial).includes(key), false);
    const recovered = await publishPreview(manifest, {
      ...options,
      receiptPath: path.join(directory, 'recovery.json'),
    });
    assert.equal(recovered.imports[0].databaseImportId, partial.imports[0].databaseImportId);
    assert.equal(recovered.verifiedRows, 6);
  });
});

test('a published revision or conflicting existing row is rejected without overwriting history', async () => {
  await withPublication(async ({ directory, manifest, database, options }) => {
    await publishPreview(manifest, options);
    const before = structuredClone(database.rows);
    database.imports[0].status = 'published';
    database.requests.length = 0;
    await assert.rejects(
      publishPreview(manifest, { ...options, receiptPath: path.join(directory, 'published.json') }),
      /already published/u,
    );
    assert.ok(database.requests.every((request) => request.method === 'GET'));
    database.imports[0].status = 'preview';
    database.rows[0].raw.FP = '999';
    database.requests.length = 0;
    await assert.rejects(
      publishPreview(manifest, { ...options, receiptPath: path.join(directory, 'conflict.json') }),
      /Stored source rows differ/u,
    );
    assert.ok(database.requests.every((request) => request.method === 'GET'));
    assert.equal(database.rows[0].raw.FP, '999');
    assert.deepEqual(database.rows.slice(1), before.slice(1));
  });
});

test('bounded retries and paginated readback verify rows beyond one REST batch', async () => {
  await withPublication(async ({ manifest, database, options }) => {
    const large = manifestFixture(1, 205);
    database.failures.push({ table: 'source_rows', method: 'POST', status: 503, remaining: 2 });
    const receipt = await publishPreview(large, options);
    assert.equal(receipt.verifiedRows, 205);
    assert.equal(database.rows.length, 205);
    assert.equal(database.failures[0].remaining, 0);
    assert.equal(manifest.seasonId, large.seasonId);
  });
});

test('missing readback rows cannot produce a success receipt', async () => {
  await withPublication(async ({ manifest, database, options }) => {
    database.dropRow = true;
    await assert.rejects(publishPreview(manifest, options), /missing expected source rows/u);
    const receipt = JSON.parse(await readFile(options.receiptPath, 'utf8'));
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.imports[0].acknowledgedRows, 3);
    assert.equal(receipt.verifiedRows, 0);
  });
});

test('wrong destination, changed approval and non-admin publisher cannot write database records', async () => {
  await withPublication(async ({ manifest, database, options }) => {
    await assert.rejects(
      publishPreview(manifest, { ...options, projectRef: 'c'.repeat(20) }),
      /selected project/u,
    );
    assert.equal(database.requests.length, 0);
    const changed = structuredClone(manifest);
    changed.imports[0].approval.sourceHash = 'c'.repeat(64);
    await assert.rejects(publishPreview(changed, options), /approved preview/u);
    assert.equal(database.requests.length, 0);
    database.admin = false;
    await assert.rejects(publishPreview(manifest, options), /active admin profile/u);
    assert.ok(database.requests.every((request) => request.method === 'GET'));
  });
});
