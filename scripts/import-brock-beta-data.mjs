import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const logicDir = path.join(root, 'logic');
const outputPath = path.resolve(
  root,
  process.env.BROCK_IMPORT_OUTPUT ?? 'tmp/brock-beta-import-preview.json',
);
const publish = process.argv.includes('--publish');
const seasonId = 'b0000000-0000-4000-8000-000000000002';

const fileKinds = new Map([
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
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv", 'mens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Roster.csv", 'womens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Schedule.csv", 'mens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Schedule.csv", 'womens_hockey'],
]);

const positionAliases = {
  hockey: {
    g: ['G'],
    goalkeeper: ['G'],
    goalie: ['G'],
    defence: ['D'],
    defense: ['D'],
    d: ['D'],
    forward: ['F'],
    f: ['F'],
    centre: ['F'],
    center: ['F'],
    wing: ['F'],
  },
  basketball: {
    guard: ['BC'],
    g: ['BC'],
    forward: ['FC'],
    centre: ['FC'],
    center: ['FC'],
    c: ['FC'],
  },
  volleyball: {
    setter: ['S'],
    libero: ['L'],
    middle: ['HT'],
    middleblocker: ['HT'],
    outside: ['HT'],
    opposite: ['HT'],
    hitter: ['HT'],
  },
};

function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const headers = rows.shift() ?? [];
  return rows.map((cells, offset) => ({
    rowNumber: offset + 2,
    raw: Object.fromEntries(
      headers.map((header, index) => [header.trim() || `column_${index + 1}`, cells[index] ?? '']),
    ),
  }));
}

function valueWithMeaning(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'missing', raw };
  if (/^n\/?a$/iu.test(trimmed)) return { kind: 'not_available', raw };
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return { kind: 'number', value: numeric, raw };
  return { kind: 'text', value: trimmed, raw };
}

function inferSport(program) {
  if (program.includes('hockey')) return 'hockey';
  if (program.includes('basketball')) return 'basketball';
  return 'volleyball';
}

function normalizedPositions(sport, sourcePosition) {
  const compact = sourcePosition.toLowerCase().replace(/[^a-z/]/gu, '');
  const aliases = positionAliases[sport];
  const positions = new Set();
  for (const token of compact.split('/')) {
    for (const [alias, mapped] of Object.entries(aliases)) {
      if (token.includes(alias)) mapped.forEach((value) => positions.add(value));
    }
  }
  return [...positions];
}

function canonicalRow(file, kind, row, issues) {
  const raw = row.raw;
  const program = programForFile.get(file);
  if (kind === 'roster' && program) {
    const sport = inferSport(program);
    const name = raw['Full name']?.trim() ?? '';
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
      jerseyNumber: null,
      historicalFantasyPoints: valueWithMeaning(raw['25-26 Fantasy points'] ?? ''),
      previousTeamPoints: valueWithMeaning(raw['Points from previous team'] ?? ''),
      gamesPlayed: valueWithMeaning(raw['Games Played last year'] ?? ''),
      suppliedSeasonProjection: valueWithMeaning(raw['26-27 Proj'] ?? ''),
      sourceTeam: raw.Team?.trim() || program,
      bio: { eligibility: raw.Elig ?? '', major: raw.Major ?? '', hometown: raw.Hometown ?? '' },
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

function parseDateAndTime(date, time) {
  const match = /^(Oct|Nov|Dec|Jan|Feb)\s+(\d{1,2})$/iu.exec(date.trim());
  const timeMatch = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/iu.exec(time.trim());
  if (!match || !timeMatch) return null;
  const month = { oct: 9, nov: 10, dec: 11, jan: 0, feb: 1 }[match[1].toLowerCase()];
  const day = Number(match[2]);
  let hour = Number(timeMatch[1]) % 12;
  if (timeMatch[3].toLowerCase() === 'pm') hour += 12;
  return torontoUtc(month >= 9 ? 2026 : 2027, month, day, hour, Number(timeMatch[2] ?? 0));
}

function torontoUtc(year, month, day, hour, minute) {
  const target = Date.UTC(year, month, day, hour, minute);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    candidate += target - represented;
  }
  return new Date(candidate).toISOString();
}

function normalizeScheduleRow(program, raw, rowNumber, issues) {
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

async function buildManifest() {
  const imports = [];
  const allIssues = [];
  for (const [file, kind] of fileKinds) {
    const content = await readFile(path.join(logicDir, file), 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    const issues = [];
    const rows = [];
    for (const row of parseCsv(content)) {
      const normalized = canonicalRow(file, kind, row, issues);
      for (const [candidateIndex, item] of (Array.isArray(normalized)
        ? normalized
        : [normalized]
      ).entries()) {
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
      kind,
      rowCount: rows.length,
      status: issues.some((issue) => issue.severity === 'error') ? 'preview' : 'preview',
      issues,
      rows,
    });
    allIssues.push(...issues.map((issue) => ({ file, ...issue })));
  }
  return {
    generatedAt: new Date().toISOString(),
    seasonId,
    timezone: 'America/Toronto',
    imports,
    issues: allIssues,
    activation: {
      allowed: false,
      reasons: [
        'Official basketball and volleyball rosters are not supplied.',
        'Schedule rows marked mapping_required need official reconciliation.',
        'No reviewed rankings or verified provider mappings are present.',
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
        source_hash: item.sourceHash,
        season_id: seasonId,
        kind: item.kind,
        payload: { generatedAt: manifest.generatedAt, rowCount: item.rowCount },
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
      source_key: `${item.sourceHash}:${row.rowNumber}`,
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
