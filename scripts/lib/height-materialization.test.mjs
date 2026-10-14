import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildPublishedManifest as buildManifest } from './published-rosters.mjs';
import { heightPlan, heightSql, officialHeights } from './height-materialization.mjs';

const manifest = await buildManifest();
const mapping = JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8'));
const operator = '11111111-1111-4111-8111-111111111111';
test('height enrichment retains canonical IDs, provenance and missing heights', () => {
  const plan = heightPlan(manifest, operator, mapping);
  assert.equal(plan.heights.length + plan.missing.length, 120);
  assert.ok(plan.heights.length > 0);
  assert.match(heightSql(plan), /a\.bio\|\|jsonb_build_object/u);
  assert.doesNotMatch(heightSql(plan), /insert into public\.athletes/u);
  assert.match(heightSql(plan), /state_version=state_version\+1/u);
});
test('duplicate, unmatched, wrong-season and malformed height updates are rejected', () => {
  for (const mutate of [
    (value) => value.heights.push(value.heights[0]),
    (value) => {
      value.heights[0].id = operator;
    },
    (value) => {
      value.heights[0].height.season = '2025-26';
    },
    (value) => {
      value.heights[0].height.inches = 500;
    },
    (value) => {
      value.heights[0].height.sourcePlayerId = 'unmatched';
    },
  ]) {
    const copy = structuredClone(mapping);
    mutate(copy);
    assert.throws(() => heightPlan(manifest, operator, copy), /mismatch/u);
  }
});
test('official parser excludes prior-season heights and absent current fields', () => {
  const source = {
    url: 'https://gobadgers.ca/sports/mens-basketball/roster/2026-27',
    sourceHash: 'a'.repeat(64),
    retrievedAt: '2026-10-14T15:00:00Z',
  };
  const row =
    '<li class="sidearm-roster-player" data-player-id="12" data-player-url="/sports/mens-basketball/roster/example/12"><span class="sidearm-roster-player-height">6\'2"</span></li></section>';
  assert.equal(officialHeights('<h1>2026-27 Roster</h1>' + row, source)[0].height.inches, 74);
  assert.throws(() => officialHeights('<h1>2025-26 Roster</h1>' + row, source), /season/u);
  assert.equal(
    officialHeights(
      '<h1>2026-27 Roster</h1>' + row.replace('sidearm-roster-player-height', 'historical-height'),
      source,
    )[0].height,
    null,
  );
});
