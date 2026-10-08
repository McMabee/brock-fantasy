import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildManifest } from './import-brock-beta-data.mjs';
import { rosterPlan, rosterSql } from './lib/roster-materialization.mjs';

const projectRef = process.env.BROCK_PUBLISH_PROJECT_REF;
const operatorId = process.env.BROCK_PUBLISH_OPERATOR_PROFILE_ID;
const apply = process.argv.includes('--apply');
if (apply && !/^[a-z]{20}$/u.test(projectRef ?? ''))
  throw new Error('An explicit hosted project reference is required for --apply.');
if (apply && (await readFile('supabase/.temp/project-ref', 'utf8')).trim() !== projectRef)
  throw new Error('The selected project differs from the linked project.');
const plan = rosterPlan(await buildManifest(), operatorId);
const directory = path.resolve(
  process.env.BROCK_ROSTER_RELEASE_DIR ??
    `logic/import-receipts/roster-directory-${new Date().toISOString().replaceAll(':', '-')}`,
);
await mkdir(directory, { recursive: true });
const sql = rosterSql(plan);
const sqlPath = path.join(directory, 'publication.sql');
await writeFile(path.join(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
await writeFile(sqlPath, sql, { flag: 'wx', mode: 0o600 });
const receipt = {
  projectRef: projectRef ?? null,
  season: plan.season,
  operatorId,
  players: plan.players.length,
  excluded: plan.excluded.length,
  programs: Object.fromEntries(
    plan.programs.map((program) => [
      program.program,
      plan.players.filter((player) => player.program === program.program).length,
    ]),
  ),
  sqlHash: createHash('sha256').update(sql).digest('hex'),
  imports: plan.imports.map(({ source, sourceHash, revisionHash }) => ({
    source,
    sourceHash,
    revisionHash,
  })),
  startedAt: new Date().toISOString(),
  status: 'preview',
  draftActivated: false,
};
const receiptPath = path.join(directory, 'receipt.json');
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
if (apply) {
  // The CLI manages credentials; they never enter arguments or source artifacts.
  const executable = path.resolve('node_modules/supabase/dist/supabase.js');
  try {
    const output = execFileSync(
      process.execPath,
      [
        executable,
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
    const counts = receipt.readback?.[0]?.roster_publication;
    if (
      counts?.players !== plan.players.length ||
      counts?.draftEligible !== 0 ||
      counts?.programs !== 6
    )
      throw new Error('Roster count readback differs from the release plan.');
    receipt.status = 'verified';
  } catch {
    receipt.status = 'failed';
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    throw new Error(
      'Roster publication failed. Review the protected SQL and database state before retrying.',
    );
  }
  receipt.finishedAt = new Date().toISOString();
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}
console.log(
  JSON.stringify({
    status: receipt.status,
    players: receipt.players,
    excluded: receipt.excluded,
    programs: receipt.programs,
    draftActivated: false,
    receipt: receiptPath,
  }),
);
