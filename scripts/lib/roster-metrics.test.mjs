import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildManifest } from '../import-brock-beta-data.mjs';
import { buildPublishedManifest } from './published-rosters.mjs';
import { rosterMetricsPlan, rosterMetricsSql } from './roster-metrics.mjs';
const current = await buildManifest();
const published = await buildPublishedManifest();
const heights = JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8'));
const suppressions = JSON.parse(
  await readFile('dev/docs/evidence/2026-10-14-roster-suppressions.json', 'utf8'),
);
const operator = '11111111-1111-4111-8111-111111111111';
const build = (value = current, exclusions = suppressions) =>
  rosterMetricsPlan(value, published, heights, operator, exclusions);
test('new supplied stats retain canonical IDs across row shifts and exclude the explicit withdrawal', () => {
  const plan = build();
  assert.equal(plan.players.length, 119);
  assert.equal(plan.exclusions.length, 1);
  assert.equal(plan.players.filter((player) => player.suppliedAdp !== null).length, 110);
  assert.equal(plan.players.find((player) => player.name === 'James Lawton').previousRow, 180);
  assert.equal(
    plan.players.find((player) => player.name === 'James Lawton').provenance.rowNumber,
    170,
  );
  assert.equal(plan.players.find((player) => player.name === 'James Lawton').suppliedAdp, 40.6);
  assert.equal(plan.players.filter((player) => player.height !== null).length, 59);
  assert.match(rosterMetricsSql(plan), /fantasy_withdrawn_at/u);
});
test('changed identity, unapproved missing athlete, duplicate row and invalid ADP fail before publication', () => {
  for (const mutate of [
    (m) => {
      m.imports.find((source) => source.kind === 'roster').rows[0].normalized.bio.hometown =
        'Different town';
    },
    (m) => {
      const source = m.imports.find((item) => item.kind === 'roster');
      source.rows.push(source.rows[0]);
    },
    (m) => {
      m.imports.find((source) => source.kind === 'roster').rows[0].normalized.suppliedAdp = {
        kind: 'number',
        value: -1,
      };
    },
  ]) {
    const copy = structuredClone(current);
    mutate(copy);
    assert.throws(() => build(copy), /identity changed|Invalid supplied ADP/u);
  }
  assert.throws(
    () => build(current, { athletes: [] }),
    /Missing athlete requires an explicit decision/u,
  );
});
