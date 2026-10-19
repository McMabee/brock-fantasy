import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { normalizedPositions, parseDateAndTime } from './brock-data.mjs';

export const historicalPrograms = {
  mens_hockey: ['mens-ice-hockey', 'hockey'],
  womens_hockey: ['womens-ice-hockey', 'hockey'],
  mens_basketball: ['mens-basketball', 'basketball'],
  womens_basketball: ['womens-basketball', 'basketball'],
  mens_volleyball: ['mens-volleyball', 'volleyball'],
  womens_volleyball: ['womens-volleyball', 'volleyball'],
};
export const sourceHash = (html) => createHash('sha256').update(html).digest('hex');
const clean = (value) => value.replace(/\s+/gu, ' ').trim();
export function officialUrl(value) {
  const url = new URL(value, 'https://gobadgers.ca');
  if (url.origin !== 'https://gobadgers.ca' || url.username || url.password)
    throw new Error('Official Brock source required');
  return url.href;
}
export function careerIdentity(html, currentProfileUrl) {
  officialUrl(currentProfileUrl);
  const $ = load(html),
    ids = new Set();
  $('a[data-params]').each((_, element) => {
    if (clean($(element).text()) !== '2025-26') return;
    const params = JSON.parse($(element).attr('data-params'));
    if (params.type === 'stats' && /^\d+$/u.test(String(params.rp_id)))
      ids.add(String(params.rp_id));
  });
  if (ids.size > 1) throw new Error('Ambiguous official career identity');
  return ids.size
    ? {
        basis: 'official_career_link',
        current_profile_url: currentProfileUrl,
        historical_player_id: [...ids][0],
        career_source_hash: sourceHash(html),
      }
    : null;
}
export function historicalPositions(html, sport) {
  const $ = load(html);
  const positions = new Set();
  $('[class*="position"]').each((_, element) =>
    normalizedPositions(sport, clean($(element).text())).forEach((value) => positions.add(value)),
  );
  return [...positions].sort();
}
export function historicalSchedule(html, program) {
  const $ = load(html),
    [slug] = historicalPrograms[program] ?? [];
  if (!slug || !clean($('caption').first().text()).startsWith('2025-26 '))
    throw new Error('Unexpected historical program or season');
  const rows = [];
  $('tr.sidearm-schedule-game').each((_, element) => {
    const cells = $(element)
      .children('td')
      .map((__, cell) => clean($(cell).text()))
      .get();
    if (cells.length !== 10) throw new Error('Unexpected historical schedule columns');
    const [date, time, , opponent, , , , tournament, result] = cells;
    const href = $(element).find('a[href*="/boxscore/"]').first().attr('href');
    if (!href) return;
    const source_url = officialUrl(href);
    if (!source_url.includes(`/sports/${slug}/stats/2025-26/`))
      throw new Error('Box score does not match its program and season');
    const label = `${tournament} ${opponent}`;
    if (/exhibition|pre.?season|steel blade|tournament|classic|invitational/iu.test(label)) return;
    const playoff =
      /playoff|quarter.?final|semi.?final|championship|bronze|gold|final four|wilson cup|mccaw|queen.s cup/iu.test(
        label,
      );
    const conference = $(element).find('[class*="conference"]').length > 0;
    // - Hold unfamiliar nonconference events for review instead of assigning a competitive phase
    if (!playoff && !conference) return;
    const year = /\b202[56]\b/u.test(date)
      ? date
      : `${date.replace(/\s*\([^)]*\)$/u, '')}, ${/^(Sep|Oct|Nov|Dec)/iu.test(date) ? 2025 : 2026}`;
    const played_at = parseDateAndTime(year, time);
    if (!played_at || !/\b[WL]\b/u.test(result)) return;
    rows.push({
      program,
      season_label: '2025-26',
      source_game_id: /\/boxscore\/(\d+)/u.exec(source_url)[1],
      source_url,
      played_at,
      opponent: opponent.replace(/\s*\*.*$/u, '').trim(),
      result,
      phase: playoff ? 'playoff' : 'regular',
    });
  });
  return rows;
}
const volleyballLabels = {
  'Attack: K': 'kills',
  'Attack: E': 'attack_errors',
  'Assist: A': 'assists',
  'Assist: E': 'setting_errors',
  'Serve: SA': 'aces',
  'Serve: SE': 'service_errors',
  'Block: BS': 'solo_blocks',
  'Block: BA': 'assisted_blocks',
  'Block: BE': 'blocking_errors',
  DIG: 'digs',
  BHE: 'ball_handling_errors',
  'Recept: RE': 'reception_errors',
  Sets: 'sets_played',
};
const basketballLabels = {
  PTS: 'points',
  A: 'assists',
  BLK: 'blocks',
  STL: 'steals',
  TO: 'turnovers',
  PF: 'fouls',
  MIN: 'minutes',
};
export function historicalBoxScore(html, sport) {
  const $ = load(html),
    rows = new Map();
  $('table').each((_, table) => {
    const caption = clean($(table).find('caption').first().text());
    if (!/^Brock\b/iu.test(caption)) return;
    if (sport === 'basketball' && $(table).closest('#box-score').length === 0) return;
    const goalies = /goalkeeping/iu.test(caption);
    const participants = $(table)
      .find('tbody tr')
      .filter((__, row) => $(row).find('a[href*="/roster/"]').length > 0);
    let goalieCount = 0;
    if (goalies)
      participants.each((__, row) => {
        if (Number.parseInt($(row).find('[data-label="Min"]').text(), 10) > 0) goalieCount++;
      });
    participants.each((__, row) => {
      const link = $(row).find('a[href*="/roster/"]').first().attr('href');
      const playerId = /\/(\d+)(?:[?#]|$)/u.exec(link)?.[1];
      if (!playerId) return;
      const stats = {};
      $(row)
        .find('td[data-label]')
        .each((___, cell) => {
          const label = $(cell).attr('data-label'),
            value = clean($(cell).text());
          const numeric = /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) : null;
          if (sport === 'basketball') {
            if (basketballLabels[label] && numeric !== null)
              stats[basketballLabels[label]] = numeric;
            const rebounds = /^(\d+)\s*-\s*(\d+)$/u.exec(value);
            if (label === 'OFF-DEF' && rebounds) {
              stats.offensive_rebounds = Number(rebounds[1]);
              stats.defensive_rebounds = Number(rebounds[2]);
            }
          } else if (sport === 'volleyball' && volleyballLabels[label] && numeric !== null)
            stats[volleyballLabels[label]] = numeric;
          else if (sport === 'hockey') {
            if (!goalies && numeric !== null && ['Goals', 'Assists', 'BLK'].includes(label))
              stats[{ Goals: 'goals', Assists: 'assists', BLK: 'blocks' }[label]] = numeric;
            if (!goalies && label === 'Pen' && /^\d+-\d+$/u.test(value))
              stats.penalty_minutes = Number(value.split('-')[1]);
            if (goalies && label === 'GA' && numeric !== null) stats.goals_allowed = numeric;
            if (goalies && /^Saves.*Tot/iu.test(label) && numeric !== null) stats.saves = numeric;
            if (goalies && label === 'Dec' && /^[WL]$/u.test(value)) {
              stats.wins = Number(value === 'W');
              stats.losses = Number(value === 'L');
            }
          }
        });
      if (goalies) stats.full_game_solo = Number(goalieCount === 1);
      // - Ignore listed reserves without a recorded appearance
      if (sport === 'basketball' && !Object.hasOwn(stats, 'minutes')) return;
      if (sport === 'volleyball' && !(stats.sets_played > 0)) return;
      const prior = rows.get(playerId) ?? {};
      for (const [key, value] of Object.entries(stats)) {
        if (Object.hasOwn(prior, key) && prior[key] !== value)
          throw new Error(
            `Conflicting whole-game statistic for official roster ID ${playerId}: ${key}`,
          );
        prior[key] = value;
      }
      rows.set(playerId, prior);
    });
  });
  return rows;
}
