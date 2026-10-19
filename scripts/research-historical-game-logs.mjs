import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  careerIdentity,
  historicalBoxScore,
  historicalPositions,
  historicalPrograms,
  historicalSchedule,
  officialUrl,
  sourceHash,
} from './lib/historical-game-logs.mjs';

const catalogPath = process.argv[process.argv.indexOf('--catalog') + 1];
if (!process.argv.includes('--catalog') || !catalogPath)
  throw new Error('Provide --catalog with the current visible athlete catalog JSON');
const catalogJson = JSON.parse(await readFile(catalogPath, 'utf8'));
const catalog = Array.isArray(catalogJson) ? catalogJson : catalogJson.rows;
if (!Array.isArray(catalog)) throw new Error('Catalog must contain a rows array');
const directory = path.resolve('dev/tmp/historical-2025-26');
await mkdir(path.join(directory, 'sources'), { recursive: true });
const gaps = [],
  records = [],
  identity = new Map(),
  coverage = {};
async function fetchSource(raw) {
  const url = officialUrl(raw),
    file = path.join(directory, 'sources', `${sourceHash(url)}.html`);
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let target = url,
    result;
  for (let redirects = 0; redirects < 5; redirects++) {
    result = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (![301, 302, 303, 307, 308].includes(result.status)) break;
    target = officialUrl(new URL(result.headers.get('location'), target).href);
  }
  if (!result.ok) throw new Error(`Official source returned ${result.status}`);
  const html = await result.text();
  await writeFile(file, html);
  return html;
}
async function bounded(items, work) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++];
        await work(item);
      }
    }),
  );
}
await bounded(catalog, async (athlete) => {
  try {
    if (!historicalPrograms[athlete.program] || !athlete.current_profile_url)
      throw new Error('Verified current profile is missing');
    const html = await fetchSource(athlete.current_profile_url),
      evidence = careerIdentity(html, athlete.current_profile_url);
    if (!evidence) {
      gaps.push({
        athlete_id: athlete.id,
        program: athlete.program,
        reason: 'No official 2025-26 career link',
      });
      return;
    }
    const profile = await fetchSource(
      `https://gobadgers.ca/roster.aspx?rp_id=${evidence.historical_player_id}`,
    );
    const positions = historicalPositions(profile, historicalPrograms[athlete.program][1]);
    if (!positions.length) throw new Error('Historical position is not verified');
    const key = `${athlete.program}:${evidence.historical_player_id}`;
    if (identity.has(key)) throw new Error('Duplicate canonical mapping for historical roster ID');
    identity.set(key, {
      athlete_id: athlete.id,
      positions,
      identity_evidence: { ...evidence, position_source_hash: sourceHash(profile) },
    });
  } catch (error) {
    gaps.push({ athlete_id: athlete.id, program: athlete.program, reason: error.message });
  }
});
for (const [program, [slug, sport]] of Object.entries(historicalPrograms)) {
  const schedule = await fetchSource(
    `https://gobadgers.ca/sports/${slug}/schedule/2025-26?grid=true`,
  );
  const games = historicalSchedule(schedule, program);
  coverage[program] = { games: games.length, appearances: 0 };
  await bounded(games, async (game) => {
    try {
      const html = await fetchSource(game.source_url),
        stats = historicalBoxScore(html, sport);
      if (!stats.size) throw new Error('No recognized Brock whole-game statistics');
      for (const [providerId, line] of stats) {
        const athlete = identity.get(`${program}:${providerId}`);
        if (!athlete) continue;
        if (sport === 'hockey' && athlete.positions.includes('G'))
          line.shootout = Number(/\bSO\b/iu.test(game.result));
        records.push({
          ...game,
          ...athlete,
          stats: line,
          source_hash: sourceHash(html),
          schedule_source_hash: sourceHash(schedule),
        });
        coverage[program].appearances++;
      }
    } catch (error) {
      gaps.push({ source_url: game.source_url, reason: error.message });
    }
  });
}
records.sort(
  (a, b) =>
    a.program.localeCompare(b.program) ||
    a.played_at.localeCompare(b.played_at) ||
    a.athlete_id.localeCompare(b.athlete_id),
);
const report = {
  status: 'unreviewed',
  retrieved_at: new Date().toISOString(),
  catalog_count: catalog.length,
  verified_career_mappings: identity.size,
  coverage,
  gaps,
  appearance_count: records.length,
};
await writeFile(path.join(directory, 'records.json'), `${JSON.stringify(records, null, 2)}\n`);
await writeFile(path.join(directory, 'review.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
