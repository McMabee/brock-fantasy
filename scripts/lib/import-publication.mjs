import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = /^[0-9a-f]{64}$/u;
const batchSize = 100;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validate(manifest, options) {
  requireValue(options.key, 'A server-only Supabase write credential is required.');
  const destination = new URL(options.url);
  const localRehearsal =
    options.allowLocal === true &&
    options.projectRef === 'local' &&
    destination.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(destination.hostname);
  requireValue(
    (localRehearsal ||
      (/^[a-z]{20}$/u.test(options.projectRef ?? '') &&
        destination.protocol === 'https:' &&
        destination.hostname === `${options.projectRef}.supabase.co` &&
        !destination.port)) &&
      !destination.username &&
      !destination.password &&
      !destination.search &&
      !destination.hash &&
      ['/', ''].includes(destination.pathname),
    'The HTTPS Supabase URL must match the explicitly selected project reference.',
  );
  requireValue(
    uuid.test(options.operatorProfileId ?? ''),
    'A publishing operator profile UUID is required.',
  );
  requireValue(options.operatorName?.trim(), 'A publishing operator name is required.');
  requireValue(options.receiptPath, 'A protected receipt file path is required.');
  requireValue(uuid.test(manifest.seasonId ?? ''), 'The manifest season UUID is invalid.');
  requireValue(manifest.imports?.length > 0, 'The manifest must contain source files.');
  requireValue(manifest.issues?.length === 0, 'Resolve all parser/mapping issues before upload.');
  requireValue(
    manifest.activation?.allowed === false,
    'This command uploads inactive preview sources only.',
  );
  requireValue(
    hash.test(manifest.dataApprovals?.sourceHash ?? ''),
    'The manifest needs a retained approval hash.',
  );
  requireValue(
    hash.test(manifest.officialEvidence?.sourceHash ?? ''),
    'The manifest needs a retained mapping-evidence hash.',
  );
  const sources = new Set();
  for (const item of manifest.imports) {
    requireValue(!sources.has(item.source), 'A source appears more than once in the manifest.');
    sources.add(item.source);
    requireValue(
      item.status === 'preview' &&
        item.approval &&
        item.issues?.length === 0 &&
        hash.test(item.sourceHash) &&
        hash.test(item.revisionHash) &&
        item.approval.sourceHash === item.sourceHash &&
        item.approval.approvalId === manifest.dataApprovals.approvalId,
      'Every source needs a clean approved preview revision.',
    );
    requireValue(
      item.rowCount === item.rows.length,
      'The manifest row count does not match its records.',
    );
    const numbers = item.rows.map((row) => row.rowNumber);
    requireValue(
      numbers.every((number) => Number.isInteger(number) && number > 0) &&
        new Set(numbers).size === numbers.length,
      'Source record numbers must be positive and unique.',
    );
  }
  return destination.origin;
}

function importPayload(manifest, item) {
  return {
    generatedAt: manifest.generatedAt,
    rowCount: item.rowCount,
    sourceHash: item.sourceHash,
    normalizerVersion: manifest.normalizerVersion,
    officialEvidenceHash: manifest.officialEvidence.sourceHash,
    dataApprovalsHash: manifest.dataApprovals.sourceHash,
    approval: item.approval,
  };
}

function checkImport(record, manifest, item) {
  requireValue(record && uuid.test(record.id), 'The database did not return a valid import UUID.');
  requireValue(
    record.source === item.source &&
      record.source_hash === item.revisionHash &&
      record.season_id === manifest.seasonId &&
      record.kind === item.kind &&
      record.status === 'preview' &&
      !record.published_at &&
      uuid.test(record.imported_by ?? '') &&
      isDeepStrictEqual(record.issues, []),
    'Existing import metadata is inconsistent or already published; review it before retrying.',
  );
  const expected = importPayload(manifest, item);
  for (const [field, value] of Object.entries(expected)) {
    if (field !== 'generatedAt')
      requireValue(
        isDeepStrictEqual(record.payload?.[field], value),
        `Stored import metadata differs: ${field}.`,
      );
  }
}

function checkRows(records, item, importId, complete) {
  const expected = new Map(item.rows.map((row) => [row.rowNumber, row]));
  const seen = new Set();
  for (const stored of records) {
    const row = expected.get(stored.row_number);
    requireValue(
      row &&
        !seen.has(stored.row_number) &&
        stored.import_id === importId &&
        stored.source_key === `${item.revisionHash}:${row.rowNumber}` &&
        !stored.entity_id &&
        isDeepStrictEqual(stored.raw, row.raw) &&
        isDeepStrictEqual(stored.normalized, row.normalized),
      'Stored source rows differ, duplicate a record or already have canonical mappings; stop and review.',
    );
    seen.add(stored.row_number);
  }
  if (complete)
    requireValue(records.length === item.rowCount, 'Readback is missing expected source rows.');
}

// Keep raw snapshots and human attribution out of ordinary console output. Each
// attempt has its own receipt; retries preserve the first database publisher.
export async function publishPreview(manifest, options) {
  const url = validate(manifest, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date().toISOString());
  const runId = randomUUID();
  const receiptPath = path.resolve(options.receiptPath);
  const manifestPath = `${receiptPath}.manifest.json`;
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const receipt = {
    formatVersion: 1,
    runId,
    status: 'running',
    projectRef: options.projectRef,
    environment: options.projectRef === 'local' ? 'disposable-local-rehearsal' : 'hosted',
    destination: url,
    operator: {
      name: options.operatorName.trim(),
      profileId: options.operatorProfileId,
      attribution:
        'server-credential upload; declared operator checked against active admin profile',
    },
    release: options.release ?? null,
    startedAt: now(),
    finishedAt: null,
    manifest: {
      path: manifestPath,
      sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    },
    sourceCount: manifest.imports.length,
    expectedRows: manifest.imports.reduce((sum, item) => sum + item.rowCount, 0),
    verifiedRows: 0,
    activation: false,
    imports: manifest.imports.map((item) => ({
      source: item.source,
      originalHash: item.sourceHash,
      revisionHash: item.revisionHash,
      approvalHash: manifest.dataApprovals.sourceHash,
      approvalId: item.approval.approvalId,
      evidenceHash: manifest.officialEvidence.sourceHash,
      expectedRows: item.rowCount,
      acknowledgedRows: 0,
      verifiedRows: 0,
      databaseImportId: null,
      status: 'pending',
    })),
  };
  await mkdir(path.dirname(receiptPath), { recursive: true });
  // Exclusive creation prevents overwriting earlier evidence. Test writability
  // and freeze the manifest before making any database request.
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });

  async function save() {
    const temporary = `${receiptPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, receiptPath);
  }

  async function request(table, parameters, body) {
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    for (const [name, value] of Object.entries(parameters)) endpoint.searchParams.set(name, value);
    const headers = { apikey: options.key };
    // Modern secret API keys are not JWTs. Legacy service-role keys are.
    if (options.key.startsWith('eyJ')) headers.authorization = `Bearer ${options.key}`;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.prefer = 'resolution=ignore-duplicates,return=representation';
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: body === undefined ? 'GET' : 'POST',
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        if (attempt === 2)
          throw new Error(`${table}: request failed after bounded network retries.`);
        await pause(250 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await pause(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 5000)
              : 250 * 2 ** attempt,
          );
          continue;
        }
        // Never copy a provider response body (possibly secrets/raw data) into evidence.
        throw new Error(`${table}: database request failed (HTTP ${response.status}).`);
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`${table}: invalid database response.`);
      }
      requireValue(Array.isArray(data), `${table}: expected a database record array.`);
      return data;
    }
  }

  async function readImport(item) {
    const records = await request('source_imports', {
      select: '*',
      source: `eq.${item.source}`,
      source_hash: `eq.${item.revisionHash}`,
    });
    requireValue(
      records.length <= 1,
      'More than one import revision matched the unique source key.',
    );
    return records[0];
  }

  async function readRows(importId) {
    const rows = [];
    for (let offset = 0; ; offset += batchSize) {
      const page = await request('source_rows', {
        select: 'import_id,row_number,source_key,raw,normalized,entity_id',
        import_id: `eq.${importId}`,
        order: 'row_number.asc',
        limit: String(batchSize),
        offset: String(offset),
      });
      rows.push(...page);
      if (page.length < batchSize) return rows;
    }
  }

  let current;
  try {
    await writeFile(manifestPath, manifestBytes, { flag: 'wx', mode: 0o600 });
    const profiles = await request('profiles', {
      select: 'id,display_name,deleted_at',
      id: `eq.${options.operatorProfileId}`,
    });
    const roles = await request('user_roles', {
      select: 'user_id,role',
      user_id: `eq.${options.operatorProfileId}`,
      role: 'eq.admin',
    });
    requireValue(
      profiles.length === 1 && !profiles[0].deleted_at && roles.length === 1,
      'The publisher must have an active admin profile in the selected project.',
    );
    receipt.operator.databaseDisplayName = profiles[0].display_name;
    const seasons = await request('fantasy_seasons', {
      select: 'id,label,timezone',
      id: `eq.${manifest.seasonId}`,
    });
    requireValue(
      seasons.length === 1 &&
        seasons[0].label === manifest.season &&
        seasons[0].timezone === manifest.timezone,
      'The destination lacks the expected season/timezone; review migrations first.',
    );
    await save();

    for (const [index, item] of manifest.imports.entries()) {
      current = receipt.imports[index];
      current.status = 'uploading';
      await save();
      let imported = await readImport(item);
      if (!imported) {
        await request(
          'source_imports',
          { on_conflict: 'source,source_hash' },
          {
            source: item.source,
            source_hash: item.revisionHash,
            season_id: manifest.seasonId,
            kind: item.kind,
            payload: importPayload(manifest, item),
            issues: [],
            status: 'preview',
            imported_by: options.operatorProfileId,
          },
        );
        imported = await readImport(item);
      }
      if (imported && uuid.test(imported.id)) {
        current.databaseImportId = imported.id;
        current.databaseImportedBy = imported.imported_by;
        current.databaseCreatedAt = imported.created_at;
        await save();
      }
      checkImport(imported, manifest, item);
      checkRows(await readRows(imported.id), item, imported.id, false);
      const rows = item.rows.map((row) => ({
        import_id: imported.id,
        row_number: row.rowNumber,
        source_key: `${item.revisionHash}:${row.rowNumber}`,
        raw: row.raw,
        normalized: row.normalized,
      }));
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        await request(
          'source_rows',
          { on_conflict: 'import_id,row_number' },
          rows.slice(offset, offset + batchSize),
        );
        current.acknowledgedRows = Math.min(offset + batchSize, rows.length);
        await save();
      }
      checkImport(await readImport(item), manifest, item);
      const verified = await readRows(imported.id);
      checkRows(verified, item, imported.id, true);
      current.verifiedRows = verified.length;
      current.status = 'verified';
      current.verifiedAt = now();
      receipt.verifiedRows += verified.length;
      await save();
    }
    receipt.status = 'verified';
    receipt.finishedAt = now();
    await save();
    return receipt;
  } catch (error) {
    receipt.status = 'failed';
    receipt.finishedAt = now();
    if (current && current.status !== 'verified') current.status = 'failed';
    // All request errors are generated locally; do not persist arbitrary thrown messages.
    receipt.failure = {
      source: current?.source ?? null,
      stage: current ? 'upload/readback' : 'preflight',
      message:
        'Publication did not fully reconcile; retained IDs/progress require review or retry.',
    };
    await save();
    throw error;
  }
}
