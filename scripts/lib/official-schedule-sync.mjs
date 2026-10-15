import { createHash } from 'node:crypto';
import { parseDateAndTime, parseOfficialSchedule } from './brock-data.mjs';

const normalize = (value) =>
  value
    .normalize('NFKD')
    .replace(/[^a-z0-9]/giu, '')
    .toLowerCase();
const day = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

export function planOfficialSchedule(html, source, existing) {
  const rows = parseOfficialSchedule(html, source.program, { url: source.url });
  const raw = [
    ...html.matchAll(
      /<tr\b[^>]*class="[^"]*\bsidearm-schedule-game\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/giu,
    ),
  ];
  const assigned = new Set();
  const issues = [];
  const byEvent = new Map();
  const byDay = new Map();
  const byOpponent = new Map();
  const opponent = (game) => (game.home_team_id === source.team_id ? game.away : game.home);
  const sideKey = (home, name) => `${home}:${normalize(name)}`;
  const add = (index, key, value) => {
    const group = index.get(key) ?? [];
    group.push(value);
    index.set(key, group);
  };
  // - Index existing fixtures once instead of scanning the season for every source row
  for (const game of existing) {
    if (game.official_schedule_key) add(byEvent, game.official_schedule_key, game);
    const key = sideKey(game.home_team_id === source.team_id, opponent(game));
    add(byOpponent, key, game);
    add(byDay, `${key}:${day(game.starts_at)}`, game);
  }
  const fixtures = rows.flatMap((row, index) => {
    if (/exhibition|pre[ -]?season/iu.test(row.tournament)) return [];
    const home = !/away/iu.test(row.at);
    const statusText = `${row.result} ${row.time}`;
    const status = /cancel/iu.test(statusText)
      ? 'cancelled'
      : /postpon/iu.test(statusText)
        ? 'postponed'
        : /\b[WLT],/u.test(row.result)
          ? 'final'
          : 'scheduled';
    if (!row.startsAt && ['postponed', 'cancelled'].includes(status)) {
      const date = parseDateAndTime(row.date, '12 p.m.');
      const candidates = date
        ? (byDay.get(`${sideKey(home, row.opponent)}:${day(date)}`) ?? [])
        : [];
      if (candidates.length === 1) row.startsAt = candidates[0].starts_at;
    }
    if (!row.startsAt || /^(?:tba|tbd|to be|winner)/iu.test(row.opponent)) {
      issues.push(`Unresolved date, time or opponent in ${source.program} row ${index + 1}`);
      return [];
    }
    const event = /\/boxscore\/(\d+)|boxscore\.aspx\?id=(\d+)/iu.exec(raw[index]?.[1] ?? '');
    const eventKey = event ? `gobadgers:${event[1] ?? event[2]}` : null;
    const kind = /playoff|quarter.?final|semi.?final|championship|OUA.*final|U SPORTS/iu.test(
      row.tournament,
    )
      ? 'playoff'
      : 'regular';
    return [{ row, home, eventKey, status, kind, match: null }];
  });
  // - Resolve exact anchors first so date changes cannot steal another fixture's identity
  for (const fixture of fixtures) {
    const indexed =
      fixture.eventKey && byEvent.has(fixture.eventKey)
        ? byEvent.get(fixture.eventKey)
        : (byDay.get(
            `${sideKey(fixture.home, fixture.row.opponent)}:${day(fixture.row.startsAt)}`,
          ) ?? []);
    const candidates = indexed.filter((game) => !assigned.has(game.id));
    if (candidates.length > 1) throw new Error('Ambiguous existing schedule identity');
    if (candidates[0]) {
      fixture.match = candidates[0];
      assigned.add(candidates[0].id);
    }
  }
  for (const fixture of fixtures.filter((item) => !item.match)) {
    const candidates = (byOpponent.get(sideKey(fixture.home, fixture.row.opponent)) ?? []).filter(
      (game) => !assigned.has(game.id),
    );
    if (candidates.length > 1)
      throw new Error('Ambiguous reschedule requires administrator identity review');
    if (candidates[0]) {
      fixture.match = candidates[0];
      assigned.add(candidates[0].id);
    }
  }
  for (const game of existing)
    if (
      game.official_schedule_key &&
      !assigned.has(game.id) &&
      Date.parse(game.starts_at) > Date.now() &&
      !['cancelled', 'postponed'].includes(game.status)
    )
      issues.push(`Previously synced fixture missing from source: ${game.id}`);
  return {
    games: fixtures.map(({ row, match, eventKey, home, status, kind }) => ({
      id: match?.id ?? null,
      key:
        match?.official_schedule_key ??
        eventKey ??
        'fixture:' +
          createHash('sha256')
            .update(
              `${source.competition_id}:${day(row.startsAt)}:${normalize(row.opponent)}:${home}`,
            )
            .digest('hex'),
      opponent:
        match && normalize(opponent(match)) === normalize(row.opponent)
          ? opponent(match)
          : row.opponent,
      startsAt: row.startsAt,
      home,
      neutral: /neutral/iu.test(row.at),
      status,
      kind,
    })),
    issues,
  };
}
