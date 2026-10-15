import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildManifest } from './import-brock-beta-data.mjs';
import { buildPublishedManifest } from './lib/published-rosters.mjs';
import { rosterMetricsPlan, rosterMetricsSql } from './lib/roster-metrics.mjs';

const operatorId =
  process.env.BROCK_PUBLISH_OPERATOR_PROFILE_ID ?? '00000000-0000-4000-8000-000000000001';
const plan = rosterMetricsPlan(
  await buildManifest(),
  await buildPublishedManifest(),
  JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8')),
  operatorId,
  JSON.parse(await readFile('dev/docs/evidence/2026-10-14-roster-suppressions.json', 'utf8')),
);
const directory = path.resolve('dev/tmp/roster-metrics-publication');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'plan.json'), JSON.stringify(plan, null, 2));
await writeFile(path.join(directory, 'publication.sql'), rosterMetricsSql(plan));
console.log(
  JSON.stringify({
    status: 'preview',
    players: plan.players.length,
    suppliedAdp: plan.players.filter((item) => item.suppliedAdp !== null).length,
    heights: plan.players.filter((item) => item.height !== null).length,
    missingHeights: plan.players.filter((item) => item.height === null).map((item) => item.name),
    exclusions: plan.exclusions,
    revision: plan.revision,
    directory,
  }),
);
