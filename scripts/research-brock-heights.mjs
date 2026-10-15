import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { rosterPlan } from './lib/roster-materialization.mjs';
import { officialHeights } from './lib/height-materialization.mjs';

const roster = rosterPlan(await buildManifest(), '00000000-0000-4000-8000-000000000001');
const portraits = JSON.parse(await readFile('data/brock-headshots-2026-27.json', 'utf8'));
const slugs = {
  mens_hockey: 'mens-ice-hockey',
  womens_hockey: 'womens-ice-hockey',
  mens_basketball: 'mens-basketball',
  womens_basketball: 'womens-basketball',
  mens_volleyball: 'mens-volleyball',
  womens_volleyball: 'womens-volleyball',
};
const heights = [];
const missing = [];
const conflicts = [];
for (const [program, slug] of Object.entries(slugs)) {
  const url = `https://gobadgers.ca/sports/${slug}/roster/2026-27`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Official roster unavailable: ${response.status}`);
  const html = await response.text();
  const source = {
    url,
    retrievedAt: new Date().toISOString(),
    sourceHash: createHash('sha256').update(html).digest('hex'),
  };
  const official = officialHeights(html, source);
  for (const player of roster.players.filter((candidate) => candidate.program === program)) {
    const portrait = portraits.headshots.find((candidate) => candidate.id === player.id);
    const matches = official.filter(
      (item) =>
        item.sourcePlayerId === portrait?.headshot.sourcePlayerId &&
        item.sourceUrl === portrait?.headshot.sourceUrl,
    );
    const item = matches.length === 1 ? matches[0] : null;
    if (!item?.height) {
      missing.push({
        id: player.id,
        program,
        reason: matches.length > 1 ? 'ambiguous_identity' : 'current_official_height_unavailable',
      });
      continue;
    }
    const height = {
      ...item.height,
      sourceUrl: item.sourceUrl,
      sourcePlayerId: item.sourcePlayerId,
    };
    const manifest = roster.imports.find(
      (candidate) => candidate.revisionHash === player.revisionHash,
    );
    const suppliedRaw = manifest.rows
      .find((candidate) => candidate.rowNumber === player.rowNumber)
      ?.raw.Height?.trim();
    if (suppliedRaw && suppliedRaw !== height.raw)
      conflicts.push({ id: player.id, supplied: suppliedRaw, official: height.raw });
    heights.push({
      id: player.id,
      revisionHash: player.revisionHash,
      rowNumber: player.rowNumber,
      height,
    });
  }
}
// Official current-season values take precedence; differences are recorded for review.
await writeFile(
  'data/brock-heights-2026-27.json',
  JSON.stringify({ version: 1, season: roster.season, heights, missing, conflicts }, null, 2) +
    '\n',
);
console.log(
  JSON.stringify({
    verifiedHeights: heights.length,
    missing: missing.length,
    conflicts: conflicts.length,
  }),
);
