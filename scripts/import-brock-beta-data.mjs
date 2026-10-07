import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  normalizedPositions,
  parseCsv,
  parseDateAndTime,
  valueWithMeaning,
} from './lib/brock-data.mjs';

const root = process.cwd();
const logicDir = path.join(root, 'logic');
const outputPath = path.resolve(
  root,
  process.env.BROCK_IMPORT_OUTPUT ?? 'dev/tmp/brock-beta-import-preview.json',
);
const publish = process.argv.includes('--publish');
const normalizerVersion = 'brock-import-2026.2';
const evidencePath = path.resolve(
  root,
  process.env.BROCK_OFFICIAL_EVIDENCE ?? 'dev/docs/evidence/2026-10-06-official-data.json',
);
let officialEvidence = null;
let officialEvidenceHash = null;

const seasonId = 'b0000000-0000-4000-8000-000000000002';

const fileKinds = new Map([
  ["Fall.Winter Brock Fantasy Information - Women's Volleyball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Men's Volleyball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Women's Basketball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Men's Basketball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Roster.csv", 'roster'],
  ['Fall.Winter Brock Fantasy Information - Goalie stats.csv', 'historical_goalie_stats'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Schedule.csv", 'schedule'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Schedule.csv", 'schedule'],
  ['Fall.Winter Brock Fantasy Information - Basketball - Schedule .csv', 'combined_schedule'],
  ['Fall.Winter Brock Fantasy Information - Volleyball - Schedule.csv', 'combined_schedule'],
  ['Fall.Winter Brock Fantasy Information - League Schedule.csv', 'fantasy_calendar'],
  ['Fall.Winter Brock Fantasy Information - Playoffs.csv', 'playoffs'],
  ['Fall.Winter Brock Fantasy Information - Roster Breakdown.csv', 'roster_rules'],
  ['Fall.Winter Brock Fantasy Information - Scoring System.csv', 'scoring_rules'],
  ['Fall.Winter Brock Fantasy Information - Draft_Waivers_Trade.csv', 'transaction_rules'],
]);

const programForFile = new Map([
  ["Fall.Winter Brock Fantasy Information - Women's Volleyball - Roster.csv", 'womens_volleyball'],
  ["Fall.Winter Brock Fantasy Information - Men's Volleyball - Roster.csv", 'mens_volleyball'],
  ["Fall.Winter Brock Fantasy Information - Women's Basketball - Roster.csv", 'womens_basketball'],
  ["Fall.Winter Brock Fantasy Information - Men's Basketball - Roster.csv", 'mens_basketball'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv", 'mens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Roster.csv", 'womens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Schedule.csv", 'mens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Schedule.csv", 'womens_hockey'],
]);

function inferSport(program) {
  if (program.includes('hockey')) return 'hockey';
  if (program.includes('basketball')) return 'basketball';
  return 'volleyball';
}

function canonicalRow(file, kind, row, issues) {
  const raw = row.raw;
  const program = programForFile.get(file);
  if (kind === 'roster' && program) {
    const sport = inferSport(program);
    const name = (raw['Full name'] ?? raw.Name ?? '').trim();
    if (/^players from last (?:year|season)$/iu.test(name))
      return { type: 'roster_section_marker', label: name };
    const field = (...keys) =>
      valueWithMeaning(keys.map((key) => raw[key]).find((value) => value !== undefined) ?? '');
    const positions = normalizedPositions(sport, raw.Position ?? '');
    if (!name || positions.length === 0)
      issues.push({
        severity: 'error',
        code: 'ROSTER_IDENTITY_OR_POSITION',
        row: row.rowNumber,
        detail: 'A roster row needs a name and normalized position.',
      });
    return {
      type: 'athlete_season_candidate',
      program,
      sport,
      name,
      positions,
      sourcePosition: raw.Position ?? '',
      jerseyNumber: raw['#']?.trim() || null,
      membershipStatus: 'review_required',
      identityStatus: 'review_required',
      historicalFantasyPoints: field('25-26 FP', '25-26 Fantasy points'),
      previousTeamPoints: field('Points from previous team', '25-26 points', '25/26 stats'),
      gamesPlayed: field('25-26 GP', 'Games Played last year'),
      suppliedSeasonProjection: field('26-27 Proj FP', '26-27 Proj'),
      suppliedProjectedGames: field('26-27 Proj GP'),
      preseasonValue: field('Preseason (3 G)', 'Preseason PPG'),
      previousTeamGames: field('games played', 'Games played'),
      sourceTeam: raw.Team?.trim() || program,
      bio: {
        eligibility: raw.Elig ?? '',
        major: raw.Major ?? raw.Program ?? '',
        hometown: raw.Hometown ?? '',
      },
    };
  }
  if (kind === 'schedule') return normalizeScheduleRow(program, raw, row.rowNumber, issues);
  if (kind === 'combined_schedule')
    return normalizeCombinedSchedule(file, raw, row.rowNumber, issues);
  return {
    type: kind,
    cells: Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, valueWithMeaning(value)]),
    ),
  };
}

function normalizeScheduleRow(program, raw, rowNumber, issues) {
  const official = reconcileSchedule([program], raw, rowNumber, issues);
  if (official) return official;
  const startsAt = parseDateAndTime(raw.Date ?? '', raw.Time ?? '');
  if (!startsAt)
    issues.push({
      severity: 'error',
      code: 'SCHEDULE_TIME',
      row: rowNumber,
      detail: 'A yearless schedule row could not be converted to an America/Toronto timestamp.',
    });
  return {
    type: 'game_candidate',
    program,
    opponent: raw.Opponent?.trim() ?? '',
    location: raw.Location?.trim() ?? '',
    startsAt,
    status: startsAt ? 'mapped' : 'mapping_required',
  };
}

function normalizeCombinedSchedule(file, raw, rowNumber, issues) {
  const sport = file.includes('Basketball') ? 'basketball' : 'volleyball';
  const division = /\(([WM])\)/iu.exec(raw.Opponent ?? '')?.[1].toUpperCase();
  const requestedPrograms = division
    ? [`${division === 'W' ? 'womens' : 'mens'}_${sport}`]
    : [`mens_${sport}`, `womens_${sport}`];
  const official = reconcileSchedule(requestedPrograms, raw, rowNumber, issues);
  if (official) return official;
  const time = raw.Time?.trim() ?? '';
  const pieces = [...time.matchAll(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*([WM])/giu)];
  const programs = pieces.length
    ? pieces.map((piece) => ({
        program: `${piece[2].toLowerCase() === 'w' ? 'womens' : 'mens'}_${sport}`,
        time: piece[1],
      }))
    : [];
  if (programs.length !== 2) {
    issues.push({
      severity: 'warning',
      code: 'COMBINED_SCHEDULE_TIME',
      row: rowNumber,
      detail: 'Men and women game times need official-schedule reconciliation before activation.',
    });
    return [
      {
        type: 'game_candidate',
        program: `mens_${sport}`,
        opponent: raw.Opponent?.trim() ?? '',
        location: raw.Location?.trim() ?? '',
        startsAt: null,
        status: 'mapping_required',
      },
      {
        type: 'game_candidate',
        program: `womens_${sport}`,
        opponent: raw.Opponent?.trim() ?? '',
        location: raw.Location?.trim() ?? '',
        startsAt: null,
        status: 'mapping_required',
      },
    ];
  }
  return programs.map(({ program, time: listedTime }) => ({
    type: 'game_candidate',
    program,
    opponent: raw.Opponent?.trim() ?? '',
    location: raw.Location?.trim() ?? '',
    startsAt: parseDateAndTime(raw.Date ?? '', listedTime),
    status: 'mapped',
  }));
}

function opponentKey(value) {
  return value
    .toLowerCase()
    .replace(/\([wm]\)/giu, '')
    .replace(/[’']/gu, '')
    .trim();
}

function reconcileSchedule(programs, raw, rowNumber, issues) {
  if (!officialEvidence) return null;
  const localDate = parseDateAndTime(raw.Date ?? '', '12 pm')?.slice(0, 10);
  const opponents = (raw.Opponent ?? '').split(/\s+(?:and|&)\s+/iu).map(opponentKey);
  const at = /^H\b/u.test(raw.Location ?? '')
    ? 'Home'
    : /^A\b/u.test(raw.Location ?? '')
      ? 'Away'
      : null;
  const resolved = [];
  for (const program of programs) {
    const matches = officialEvidence.games.filter(
      (game) =>
        game.program === program &&
        game.conferenceGame &&
        game.startsAt &&
        parseDateAndTime(game.date, '12 pm')?.slice(0, 10) === localDate &&
        opponents.includes(opponentKey(game.opponent)) &&
        (!at || game.at === at),
    );
    if (matches.length !== 1) {
      issues.push({
        severity: 'error',
        code: 'OFFICIAL_SCHEDULE_MAPPING',
        row: rowNumber,
        detail: `${program}: expected one official date/opponent/venue match, found ${matches.length}.`,
      });
      return programs.map((candidateProgram) => ({
        type: 'game_candidate',
        program: candidateProgram,
        opponent: raw.Opponent ?? '',
        location: raw.Location ?? '',
        startsAt: null,
        status: 'mapping_required',
      }));
    }
    const game = matches[0];
    const suppliedTime =
      programs.length === 1 ? parseDateAndTime(raw.Date ?? '', raw.Time ?? '') : null;
    resolved.push({
      type: 'game_candidate',
      program,
      opponent: game.opponent,
      location: game.location,
      startsAt: game.startsAt,
      localDate: game.date,
      localTime: game.time,
      status: 'official_candidate',
      reviewRequired: true,
      suppliedTimestamp: suppliedTime,
      correctionProposed: suppliedTime !== null && suppliedTime !== game.startsAt,
      mappingEvidence: {
        sourceUrl: game.sourceUrl,
        sourceHash: game.sourceHash,
        sourceRowNumber: game.sourceRowNumber,
        retrievedAt: game.retrievedAt,
        evidenceHash: officialEvidenceHash,
        reviewedBy: null,
      },
    });
  }
  return resolved;
}

export async function buildManifest() {
  try {
    const evidenceContent = await readFile(evidencePath, 'utf8');
    officialEvidence = JSON.parse(evidenceContent);
    if (
      officialEvidence.season !== '2026-27' ||
      officialEvidence.timezone !== 'America/Toronto' ||
      !Array.isArray(officialEvidence.games) ||
      !Array.isArray(officialEvidence.rosters)
    )
      throw new Error('Official evidence must contain 2026–27 Toronto schedules and rosters.');
    officialEvidenceHash = createHash('sha256').update(evidenceContent).digest('hex');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    officialEvidence = null;
    officialEvidenceHash = null;
  }
  const imports = [];
  const allIssues = [];
  for (const [file, kind] of fileKinds) {
    const content = await readFile(path.join(logicDir, file), 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    const issues = [];
    const rows = [];
    let section = 'membership_review_required';
    for (const row of parseCsv(content)) {
      const normalized = canonicalRow(file, kind, row, issues);
      if (normalized.type === 'roster_section_marker') section = 'previous_season';
      for (const [candidateIndex, item] of (Array.isArray(normalized)
        ? normalized
        : [normalized]
      ).entries()) {
        if (item.type === 'athlete_season_candidate') {
          item.sourceSection = section;
          item.draftEligible = false;
          const nameKey = (name) => name.toLowerCase().replace(/[^a-z]/gu, '');
          // Suggestions only; no permanent identity is assigned by this match.
          item.identityCandidates = (officialEvidence?.rosters ?? [])
            .filter(
              (athlete) =>
                athlete.program === item.program &&
                athlete.sourceSeasonVerified &&
                nameKey(athlete.name) === nameKey(item.name) &&
                athlete.jerseyNumber === item.jerseyNumber &&
                normalizedPositions(item.sport, athlete.position).some((position) =>
                  item.positions.includes(position),
                ),
            )
            .map((athlete) => ({
              sourcePlayerId: athlete.sourcePlayerId,
              bioUrl: athlete.bioUrl,
              sourceUrl: athlete.sourceUrl,
              sourceHash: athlete.sourceHash,
              reviewedBy: null,
            }));
        }
        rows.push({
          ...row,
          sourceRowNumber: row.rowNumber,
          rowNumber: row.rowNumber * 10 + candidateIndex,
          normalized: { ...item, sourceRowNumber: row.rowNumber },
        });
      }
    }
    imports.push({
      source: `logic/${file}`,
      sourceHash: hash,
      revisionHash: createHash('sha256')
        .update(JSON.stringify({ sourceHash: hash, normalizerVersion, officialEvidenceHash }))
        .digest('hex'),
      kind,
      rowCount: rows.length,
      status: 'preview',
      issues,
      rows,
    });
    allIssues.push(...issues.map((issue) => ({ file, ...issue })));
  }
  return {
    generatedAt: new Date().toISOString(),
    seasonId,
    season: '2026-27',
    normalizerVersion,
    officialEvidence: officialEvidenceHash
      ? {
          path: path.relative(root, evidencePath).replaceAll('\\', '/'),
          sourceHash: officialEvidenceHash,
          reviewedBy: null,
        }
      : null,
    timezone: 'America/Toronto',
    imports,
    issues: allIssues,
    activation: {
      allowed: false,
      reasons: [
        'Athlete identities, membership, source rights, and eligibility require named human approval.',
        'Official schedule candidates and corrections require named human review before activation.',
        'No reviewed rankings or approved permanent athlete mappings are present.',
      ],
    },
  };
}

async function publishManifest(manifest) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/u, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      '--publish requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the process environment.',
    );
  for (const item of manifest.imports) {
    const imported = await rest(
      url,
      key,
      'source_imports',
      {
        source: item.source,
        source_hash: item.revisionHash,
        season_id: seasonId,
        kind: item.kind,
        payload: {
          generatedAt: manifest.generatedAt,
          rowCount: item.rowCount,
          sourceHash: item.sourceHash,
          normalizerVersion,
          officialEvidenceHash,
        },
        issues: item.issues,
        status: 'preview',
      },
      'source,source_hash',
    );
    const importId = imported[0]?.id;
    if (!importId) throw new Error(`Could not create import revision for ${item.source}.`);
    const rows = item.rows.map((row) => ({
      import_id: importId,
      row_number: row.rowNumber,
      source_key: `${item.revisionHash}:${row.rowNumber}`,
      raw: row.raw,
      normalized: row.normalized,
    }));
    for (const batch of chunk(rows, 100))
      await rest(url, key, 'source_rows', batch, 'import_id,row_number');
  }
}

async function rest(url, key, table, body, conflict) {
  const endpoint = `${url}/rest/v1/${table}${conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : ''}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: conflict
        ? 'resolution=merge-duplicates,return=representation'
        : 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${table} import failed: ${await response.text()}`);
  return response.json();
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = await buildManifest();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (publish) await publishManifest(manifest);
  console.log(
    JSON.stringify({
      output: outputPath,
      imports: manifest.imports.length,
      rows: manifest.imports.reduce((total, item) => total + item.rowCount, 0),
      issues: manifest.issues.length,
      published: publish,
    }),
  );
}
