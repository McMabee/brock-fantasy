// Explicit, manual research snapshots. This never updates a database or awards points.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { htmlText, parseOfficialSchedule } from './lib/brock-data.mjs';

const output = path.resolve(
  process.env.BROCK_RESEARCH_OUTPUT ?? 'tmp/brock-official-research.json',
);
const rawDirectory = path.resolve('tmp/official-research');
const programs = {
  mens_hockey: 'mens-ice-hockey',
  womens_hockey: 'womens-ice-hockey',
  mens_basketball: 'mens-basketball',
  womens_basketball: 'womens-basketball',
  mens_volleyball: 'mens-volleyball',
  womens_volleyball: 'womens-volleyball',
};
const sources = [];
const games = [];
const rosters = [];
await mkdir(rawDirectory, { recursive: true });

async function capture(url, name) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const html = await response.text();
  const rawPath = path.join(rawDirectory, `${name}.html`);
  await writeFile(rawPath, html, 'utf8');
  const source = {
    url,
    resolvedUrl: response.url,
    httpStatus: response.status,
    retrievedAt: new Date().toISOString(),
    sourceHash: createHash('sha256').update(html).digest('hex'),
    rawPath: path.relative(process.cwd(), rawPath).replaceAll('\\', '/'),
  };
  sources.push(source);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return { html, source };
}

// Sequential page reads keep this small research run gentle on the public site.
for (const [program, slug] of Object.entries(programs)) {
  for (const kind of ['schedule', 'roster', 'stats']) {
    const season = kind === 'stats' ? '2025-26' : '2026-27';
    const url = `https://gobadgers.ca/sports/${slug}/${kind}/${season}${kind === 'schedule' ? '?grid=true' : ''}`;
    try {
      const { html, source } = await capture(url, `${program}-${kind}`);
      source.kind = kind;
      source.program = program;
      if (kind === 'schedule') games.push(...parseOfficialSchedule(html, program, source));
      else if (kind === 'roster') {
        source.heading =
          [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/giu)]
            .map((match) => htmlText(match[1]))
            .find((heading) => /\d{4}-\d{2}.*Roster/u.test(heading)) ?? '';
        const playerStarts = [
          ...html.matchAll(
            /<li\b[^>]*class="sidearm-roster-player"[^>]*data-player-id="(\d+)"[^>]*data-player-url="([^"]+)"[^>]*>/gu,
          ),
        ];
        for (const [index, match] of playerStarts.entries()) {
          const body = html.slice(
            match.index,
            playerStarts[index + 1]?.index ?? html.indexOf('</section>', match.index),
          );
          const name = /aria-label="([^"]+) - View Profile"/u.exec(body)?.[1];
          const position =
            /class="sidearm-roster-player-position"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/u.exec(
              body,
            )?.[1];
          const jersey =
            /class="sidearm-roster-player-jersey-number"[^>]*>([\s\S]*?)<\/span>/u.exec(body)?.[1];
          if (name)
            rosters.push({
              program,
              name: htmlText(name),
              sourceSeasonHeading: source.heading,
              sourceSeasonVerified: source.heading.startsWith('2026-27 '),
              sourcePlayerId: match[1],
              bioUrl: new URL(match[2], source.url).href,
              position: htmlText(position ?? ''),
              jerseyNumber: htmlText(jersey ?? ''),
              sourceUrl: source.url,
              sourceHash: source.sourceHash,
            });
        }
        source.playerCount = playerStarts.length;
      } else {
        source.headings = [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/giu)]
          .map((match) => htmlText(match[1]))
          .filter(Boolean);
        source.tableHeaders = [
          ...new Set(
            [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/giu)]
              .map((match) => htmlText(match[1]))
              .filter(Boolean),
          ),
        ];
        source.boxScoreUrls = [
          ...new Set(
            [...html.matchAll(/href="([^"]*\/boxscore\/[^"?#]+)[^"]*"/gu)].map(
              (match) => new URL(match[1], source.url).href,
            ),
          ),
        ];
      }
    } catch (error) {
      const source = sources.findLast((item) => item.url === url);
      if (source) source.error = error.message;
      else sources.push({ url, kind, program, error: error.message });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  season: '2026-27',
  timezone: 'America/Toronto',
  status: 'research_only',
  reviewedBy: null,
  activationAllowed: false,
  sources,
  games,
  rosters,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify({
    output,
    sources: sources.length,
    games: games.length,
    rosterEntries: rosters.length,
    errors: sources.filter((source) => source.error).length,
  }),
);
if (sources.some((source) => source.kind === 'schedule' && source.error)) process.exitCode = 1;
