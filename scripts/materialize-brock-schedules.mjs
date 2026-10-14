import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { schedulePlan, scheduleSql } from './lib/schedule-materialization.mjs';

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
const plan = schedulePlan(await buildManifest(), operatorId);
const directory = path.resolve(
  process.env.BROCK_SCHEDULE_RELEASE_DIR ??
    'logic/import-receipts/schedules-' + new Date().toISOString().replaceAll(':', '-'),
);
await mkdir(directory, { recursive: true });
const sql = scheduleSql(plan);
const sqlPath = path.join(directory, 'publication.sql');
await writeFile(sqlPath, sql, { flag: 'wx', mode: 0o600 });
await writeFile(path.join(directory, 'plan.json'), JSON.stringify(plan, null, 2), {
  flag: 'wx',
  mode: 0o600,
});
const receipt = {
  projectRef,
  operatorId,
  games: plan.games.length,
  sqlHash: createHash('sha256').update(sql).digest('hex'),
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
  if (receipt.readback?.[0]?.schedule_publication?.games !== 129)
    throw new Error('Schedule readback does not match the approved plan.');
  receipt.status = 'verified';
}
await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  JSON.stringify({
    status: receipt.status,
    games: receipt.games,
    receipt: path.join(directory, 'receipt.json'),
  }),
);
