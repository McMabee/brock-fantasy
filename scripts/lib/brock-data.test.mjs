import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizedPositions,
  parseCsv,
  parseDateAndTime,
  parseOfficialSchedule,
  torontoUtc,
  valueWithMeaning,
} from './brock-data.mjs';

test('CSV record numbers survive empty separators and quoted fields', () => {
  const rows = parseCsv('Name,Position,Note\r\n"A, B",Forward,"said ""hi"""\r\n,,\r\nC,GK,\r\n');
  assert.deepEqual(
    rows.map((row) => row.rowNumber),
    [2, 4],
  );
  assert.equal(rows[0].raw.Name, 'A, B');
  assert.equal(rows[0].raw.Note, 'said "hi"');
  assert.throws(() => parseCsv('Name\n"unterminated'), /Unclosed/u);
});

test('positions use whole aliases rather than matching letters inside words', () => {
  assert.deepEqual(normalizedPositions('hockey', 'Forward'), ['F']);
  assert.deepEqual(normalizedPositions('hockey', 'Defence'), ['D']);
  assert.deepEqual(normalizedPositions('hockey', 'GK'), ['G']);
  assert.deepEqual(normalizedPositions('hockey', 'Goaltender'), ['G']);
  assert.deepEqual(normalizedPositions('basketball', 'Guard/Forward'), ['BC', 'FC']);
  assert.deepEqual(normalizedPositions('volleyball', 'H'), ['HT']);
  assert.deepEqual(normalizedPositions('volleyball', 'unknown'), []);
});

test('supplied values distinguish unavailable, empty, zero, negative and annotation', () => {
  assert.deepEqual(valueWithMeaning('N/A'), { kind: 'not_available', raw: 'N/A' });
  assert.equal(valueWithMeaning('').kind, 'missing');
  assert.equal(valueWithMeaning('0').value, 0);
  assert.equal(valueWithMeaning('-0.6').value, -0.6);
  assert.equal(valueWithMeaning('23.5 in 1').kind, 'text');
});

test('Toronto schedule conversion handles season rollover, compact dates and noon', () => {
  assert.equal(parseDateAndTime('Oct 30', '8PM'), '2026-10-31T00:00:00.000Z');
  assert.equal(parseDateAndTime('Nov 1', '1 pm'), '2026-11-01T18:00:00.000Z');
  assert.equal(parseDateAndTime('Jan8', '6:00 PM'), '2027-01-08T23:00:00.000Z');
  assert.equal(
    parseDateAndTime('November 28, 2026 (Saturday)', 'Noon'),
    '2026-11-28T17:00:00.000Z',
  );
  assert.equal(parseDateAndTime('Feb 30', '6 pm'), null);
  assert.equal(parseDateAndTime('Feb 1', '13 pm'), null);
  assert.equal(parseDateAndTime('Feb 1', '6:99 pm'), null);
  assert.equal(parseDateAndTime('Feb 1', 'TBA'), null);
});

test('ambiguous and nonexistent Toronto DST times require explicit resolution', () => {
  assert.equal(torontoUtc(2026, 10, 1, 1, 30), null);
  assert.equal(torontoUtc(2027, 2, 14, 2, 30), null);
});

test('official schedule parser retains provenance and refuses another season', () => {
  const source = {
    url: 'https://gobadgers.ca/example',
    sourceHash: 'hash',
    retrievedAt: '2026-10-06',
  };
  const cells = [
    'November 28, 2026 (Saturday)',
    'Noon',
    'Away',
    'Windsor <span class="sidearm-schedule-game-conference-small">*</span>',
    'Windsor, Ont.',
    '',
    '',
    '',
    '',
    '',
  ];
  const html = `<caption>2026-27 Women’s Volleyball Schedule</caption><tr class="sidearm-schedule-game">${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  const [game] = parseOfficialSchedule(html, 'womens_volleyball', source);
  assert.equal(game.opponent, 'Windsor');
  assert.equal(game.startsAt, '2026-11-28T17:00:00.000Z');
  assert.equal(game.sourceHash, 'hash');
  assert.equal(game.conferenceGame, true);
  assert.throws(
    () => parseOfficialSchedule(html.replace('2026-27', '2025-26'), 'womens_volleyball', source),
    /Unexpected schedule season/u,
  );
});
