import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from '../import-brock-beta-data.mjs';
import { schedulePlan, scheduleSql } from './schedule-materialization.mjs';
test('confirmed schedules have stable identities, split program times, and exact provenance', async () => {
  const manifest = await buildManifest();
  const plan = schedulePlan(manifest, '00000000-0000-4000-8000-000000000001');
  assert.equal(plan.games.length, 129);
  assert.equal(new Set(plan.games.map((g) => g.id)).size, 129);
  assert.deepEqual(schedulePlan(manifest, plan.operatorId).games, plan.games);
  assert.equal(new Set(plan.games.map((g) => g.program)).size, 6);
  assert.ok(
    plan.games.every(
      (g) => g.homeTeamId !== g.awayTeamId && g.normalized.mappingEvidence.approvalId,
    ),
  );
  assert.ok(plan.games.some((g) => g.startsAt.startsWith('2027-01')));
  assert.match(scheduleSql(plan), /r\.raw=e\.raw and r\.normalized=e\.normalized/u);
  const changed = structuredClone(manifest);
  changed.imports.find((i) => i.kind === 'schedule').rows[0].normalized.status = 'mapping_required';
  assert.throws(() => schedulePlan(changed, plan.operatorId), /confirmed/u);
});
