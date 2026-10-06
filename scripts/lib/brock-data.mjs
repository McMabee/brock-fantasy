// Pure helpers shared by the supplied-data preview and manual official-source research.
export function parseCsv(source) {
  const records = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let recordNumber = 1;
  const finish = () => {
    cells.push(value);
    records.push({ cells, rowNumber: recordNumber++ });
    cells = [];
    value = '';
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      finish();
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (value || cells.length) finish();
  const headers = records.shift()?.cells ?? [];
  return records
    .filter((record) => record.cells.some((cell) => cell.trim()))
    .map(({ cells: row, rowNumber }) => ({
      rowNumber,
      raw: Object.fromEntries(
        headers.map((header, index) => [header.trim() || `column_${index + 1}`, row[index] ?? '']),
      ),
    }));
}

export function valueWithMeaning(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'missing', raw };
  if (/^n\/?a$/iu.test(trimmed)) return { kind: 'not_available', raw };
  const numeric = Number(trimmed);
  return Number.isFinite(numeric)
    ? { kind: 'number', value: numeric, raw }
    : { kind: 'text', value: trimmed, raw };
}

const positionAliases = {
  hockey: {
    g: ['G'],
    gk: ['G'],
    goalkeeper: ['G'],
    goalie: ['G'],
    goaltender: ['G'],
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
    f: ['FC'],
    centre: ['FC'],
    center: ['FC'],
    c: ['FC'],
  },
  volleyball: {
    setter: ['S'],
    s: ['S'],
    libero: ['L'],
    l: ['L'],
    middle: ['HT'],
    middleblocker: ['HT'],
    outside: ['HT'],
    outsidehitter: ['HT'],
    opposite: ['HT'],
    hitter: ['HT'],
    h: ['HT'],
  },
};

export function normalizedPositions(sport, sourcePosition) {
  const tokens = sourcePosition
    .toLowerCase()
    .replace(/[^a-z/]/gu, '')
    .split('/');
  return [...new Set(tokens.flatMap((token) => positionAliases[sport]?.[token] ?? []))];
}

const monthNumbers = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function torontoUtc(year, month, day, hour, minute) {
  const target = Date.UTC(year, month, day, hour, minute);
  const date = new Date(target);
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day || hour > 23 || minute > 59)
    return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const represented = (timestamp) => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(timestamp))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
  };
  // Toronto's two possible offsets; zero/two matches mean a DST gap/overlap.
  const matches = [4, 5]
    .map((offset) => target + offset * 60 * 60 * 1000)
    .filter((candidate) => represented(candidate) === target);
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}

export function parseDateAndTime(date, time) {
  const dateMatch = /^([A-Za-z]+)\s*(\d{1,2})(?:,\s*(\d{4}))?(?:\s+\([^)]*\))?$/u.exec(date.trim());
  const canonicalTime = /^noon$/iu.test(time.trim()) ? '12 pm' : time.trim();
  const timeMatch = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/iu.exec(canonicalTime);
  if (!dateMatch || !timeMatch) return null;
  const month = monthNumbers[dateMatch[1].slice(0, 3).toLowerCase()];
  const sourceHour = Number(timeMatch[1]);
  if (month === undefined || sourceHour < 1 || sourceHour > 12) return null;
  const year = Number(dateMatch[3] ?? (month >= 8 ? 2026 : 2027));
  const hour = (sourceHour % 12) + (timeMatch[3].toLowerCase() === 'p' ? 12 : 0);
  return torontoUtc(year, month, Number(dateMatch[2]), hour, Number(timeMatch[2] ?? 0));
}

export function htmlText(html) {
  return html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&#(x[\da-f]+|\d+);/giu, (_, value) =>
      String.fromCodePoint(
        value[0].toLowerCase() === 'x' ? Number.parseInt(value.slice(1), 16) : Number(value),
      ),
    )
    .replace(
      /&(?:amp|nbsp|quot|apos|lt|gt|rsquo|lsquo|ndash|mdash);/gu,
      (entity) =>
        ({
          '&amp;': '&',
          '&nbsp;': ' ',
          '&quot;': '"',
          '&apos;': "'",
          '&lt;': '<',
          '&gt;': '>',
          '&rsquo;': "'",
          '&lsquo;': "'",
          '&ndash;': '–',
          '&mdash;': '—',
        })[entity],
    )
    .replace(/\s+/gu, ' ')
    .trim();
}

export function parseOfficialSchedule(html, program, source) {
  const heading = htmlText(/<caption[^>]*>([\s\S]*?)<\/caption>/iu.exec(html)?.[1] ?? '');
  if (!heading.startsWith('2026-27 ')) throw new Error(`Unexpected schedule season: ${heading}`);
  const rows = [
    ...html.matchAll(
      /<tr\b[^>]*class="[^"]*\bsidearm-schedule-game\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/giu,
    ),
  ];
  if (!rows.length) throw new Error(`No schedule rows: ${source.url}`);
  return rows.map((row, index) => {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)].map((cell) =>
      htmlText(cell[1]),
    );
    if (cells.length !== 10) throw new Error(`Unexpected schedule columns: ${cells.length}`);
    const [date, time, at, opponent, location, , , tournament, result] = cells;
    return {
      program,
      sourceRowNumber: index + 1,
      date,
      time,
      at,
      opponent: opponent.replace(/\s*\*.*$/u, '').trim(),
      location,
      tournament,
      result,
      conferenceGame: row[1].includes('sidearm-schedule-game-conference-small'),
      startsAt: parseDateAndTime(date, time),
      sourceUrl: source.url,
      sourceHash: source.sourceHash,
      retrievedAt: source.retrievedAt,
    };
  });
}
