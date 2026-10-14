import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildManifest } from '../import-brock-beta-data.mjs';
import { headshotPlan } from './headshot-materialization.mjs';
test('headshots bind approved permanent athlete, program/season and official source identity', async () => {
  const manifest = await buildManifest(),
    mapping = JSON.parse(await readFile('data/brock-headshots-2026-27.json', 'utf8'));
  const operator = '00000000-0000-4000-8000-000000000001';
  assert.equal(headshotPlan(manifest, operator, mapping).headshots.length, 119);
  for (const mutate of [
    (m) => (m.headshots[0].headshot.sourcePlayerId = 'other-player'),
    (m) => (m.headshots[0].id = '00000000-0000-4000-8000-000000000999'),
    (m) => (m.headshots[0].headshot.url = 'https://evil.example/image'),
    (m) => (m.season = '2025-26'),
    (m) => m.headshots.push(m.headshots[0]),
  ]) {
    const changed = structuredClone(mapping);
    mutate(changed);
    assert.throws(() => headshotPlan(manifest, operator, changed));
  }
});
