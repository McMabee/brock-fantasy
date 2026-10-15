import { readFile } from 'node:fs/promises';
import { buildManifest } from '../import-brock-beta-data.mjs';
import { sourceApproval } from './brock-approvals.mjs';

// Protected publication evidence preserves canonical IDs for enrichment and
// fixtures; it never approves changed CSVs. Raw evidence stays outside Git.
export async function buildPublishedManifest() {
  const current = await buildManifest();
  const plan = JSON.parse(
    await readFile(
      process.env.BROCK_PUBLISHED_ROSTER_PLAN ??
        'logic/import-receipts/roster-directory-2026-10-08T16-28-11.564Z/plan.json',
      'utf8',
    ),
  );
  const approvals = JSON.parse(
    await readFile('dev/docs/evidence/2026-10-08-data-approvals.json', 'utf8'),
  );
  const imports = plan.imports.map((source) => {
    const approval = sourceApproval(
      approvals,
      source.source,
      source.sourceHash,
      approvals.officialEvidenceHash,
      'roster',
    );
    if (!approval) throw new Error('Published roster receipt has no matching source approval.');
    return { ...source, kind: 'roster', approval, issues: [], rowCount: source.rows.length };
  });
  return {
    ...current,
    imports: [...current.imports.filter((item) => item.kind !== 'roster'), ...imports],
  };
}
