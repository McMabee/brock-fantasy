import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  participantReferencePlan,
  participantReferenceSql,
  referenceFiles,
} from './lib/participant-references.mjs';

const argument = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const apply = process.argv.includes('--apply');
const mappingFile = argument('--mappings');
const suppressionFile = argument('--suppressions') ?? process.env.BROCK_ROSTER_SUPPRESSIONS;
// - Apply requires an explicit suppression file even when the reviewed list is empty
if (apply && !suppressionFile)
  throw new Error('Supply --suppressions with the retained athlete opt-out list before applying');
const mappings = mappingFile ? JSON.parse(await readFile(mappingFile, 'utf8')) : [];
const suppressions = suppressionFile
  ? JSON.parse(await readFile(suppressionFile, 'utf8'))
  : { athletes: [] };
const plan = participantReferencePlan(
  await Promise.all(
    referenceFiles.map(async ({ file }) => ({
      file,
      content: await readFile(path.join('logic', file), 'utf8'),
    })),
  ),
  {
    seasonId: argument('--season') ?? 'b0000000-0000-4000-8000-000000000002',
    mappings,
    suppressions: suppressions.athletes,
  },
);
const directory = path.resolve(
  'logic/import-receipts',
  `participant-references-${new Date().toISOString().replaceAll(':', '-')}`,
);
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, 'preview.json'),
  JSON.stringify({ ...plan, document: undefined }, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 },
);
let readback = null;
if (apply) {
  const expectedHash = argument('--expected-hash');
  if (expectedHash !== plan.contentHash)
    throw new Error('Review the preview and supply its exact --expected-hash');
  const projectRef = process.env.BROCK_PUBLISH_PROJECT_REF;
  if (
    !/^[a-z]{20}$/u.test(projectRef ?? '') ||
    (await readFile('supabase/.temp/project-ref', 'utf8')).trim() !== projectRef
  )
    throw new Error('An explicit matching linked project reference is required');
  const sql = participantReferenceSql(plan, process.env.BROCK_PUBLISH_OPERATOR_PROFILE_ID);
  const file = path.join(directory, 'publication.sql');
  await writeFile(file, sql, { flag: 'wx', mode: 0o600 });
  readback = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve('node_modules/supabase/dist/supabase.js'),
        'db',
        'query',
        '--linked',
        '--project-ref',
        projectRef,
        '--file',
        file,
        '-o',
        'json',
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
  );
  const result = readback.rows?.[0]?.publish_participant_references;
  if (
    !result?.versionId ||
    (!result.unchanged && result.references !== plan.payload.references.length)
  )
    throw new Error('Reference publication readback differs from the preview');
  await writeFile(
    path.join(directory, 'receipt.json'),
    JSON.stringify(
      { contentHash: plan.contentHash, result, appliedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    status: apply ? 'verified' : 'preview',
    references: plan.payload.references.length,
    duplicateGroups: plan.duplicates.length,
    contentHash: plan.contentHash,
    receipt: directory,
    suppressionFileProvided: Boolean(suppressionFile),
  }),
);
