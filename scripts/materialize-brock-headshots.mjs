import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildManifest } from './import-brock-beta-data.mjs';
import { headshotPlan, headshotSql } from './lib/headshot-materialization.mjs';

const apply = process.argv.includes('--apply');
const projectRef = process.env.BROCK_PUBLISH_PROJECT_REF;
const operatorId =
  process.env.BROCK_PUBLISH_OPERATOR_PROFILE_ID ??
  (apply ? null : '00000000-0000-4000-8000-000000000001');
if (
  apply &&
  (projectRef !== 'fdovowiihxowzatewxgv' ||
    (await readFile('supabase/.temp/project-ref', 'utf8')).trim() !== projectRef)
)
  throw new Error('Explicit project selection must match the linked Brock project.');
const plan = headshotPlan(
  await buildManifest(),
  operatorId,
  JSON.parse(await readFile('data/brock-headshots-2026-27.json', 'utf8')),
);
const { headshots, missing } = plan;
const sql = headshotSql(plan);
const directory = path.resolve(
  process.env.BROCK_HEADSHOT_RELEASE_DIR ??
    'logic/import-receipts/headshots-' + new Date().toISOString().replaceAll(':', '-'),
);
await mkdir(directory, { recursive: true });
const sqlPath = path.join(directory, 'publication.sql');
await writeFile(sqlPath, sql, { flag: 'wx', mode: 0o600 });
const receipt = {
  headshots: headshots.length,
  missing,
  permission: 'User explicitly approved Brock Athletics headshots on October 13, 2026',
  status: 'preview',
  readback: null,
};
if (apply) {
  const output = execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/supabase/dist/supabase.js'),
      'db',
      'query',
      '--linked',
      '--project-ref',
      projectRef,
      '--file',
      sqlPath,
      '-o',
      'json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  receipt.readback = JSON.parse(output).rows;
  if (receipt.readback?.[0]?.headshot_publication?.headshots !== headshots.length)
    throw new Error('Headshot readback differs.');
  receipt.status = 'verified';
}
await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  JSON.stringify({
    status: receipt.status,
    headshots: headshots.length,
    missing: missing.length,
    receipt: path.join(directory, 'receipt.json'),
  }),
);
