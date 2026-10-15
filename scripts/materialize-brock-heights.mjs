import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { heightPlan, heightSql } from './lib/height-materialization.mjs';

// Prepare a reviewable publication transaction. Applying it is a release operation.
const operatorId =
  process.env.BROCK_PUBLISH_OPERATOR_PROFILE_ID ?? '00000000-0000-4000-8000-000000000001';
const plan = heightPlan(
  await buildManifest(),
  operatorId,
  JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8')),
);
const directory = path.resolve('dev/tmp/height-publication');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'publication.sql'), heightSql(plan));
await writeFile(
  path.join(directory, 'preview.json'),
  JSON.stringify(
    { season: plan.season, heights: plan.heights.length, missing: plan.missing, status: 'preview' },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    heights: plan.heights.length,
    missing: plan.missing.length,
    status: 'preview',
    directory,
  }),
);
