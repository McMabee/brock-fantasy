import assert from 'node:assert/strict';
import { test } from 'node:test';
import { careerIdentity, historicalBoxScore, officialUrl } from './historical-game-logs.mjs';

test('career mapping requires one explicit official season link', () => {
  assert.equal(
    careerIdentity(
      '<h1>Same Name #5</h1>',
      'https://gobadgers.ca/sports/mens-hockey/roster/same-name/123',
    ),
    null,
  );
  const link = (id) => `<a data-params='{"type":"stats","rp_id":${id}}'>2025-26</a>`;
  assert.equal(
    careerIdentity(link(45), 'https://gobadgers.ca/sports/mens-hockey/roster/same-name/123')
      .historical_player_id,
    '45',
  );
  assert.throws(() => careerIdentity(link(45) + link(46), 'https://gobadgers.ca/x'), /Ambiguous/u);
  assert.throws(() => officialUrl('https://gobadgers.ca.evil.test/'), /Official/u);
});
test('basketball uses whole game totals without multiplying quarter statistics', () => {
  const table = (pts) =>
    `<table><caption>Brock 83</caption><tbody><tr><td><a href='/sports/mens-basketball/roster/person/45'>Player</a></td><td data-label='MIN'>21</td><td data-label='PTS'>${pts}</td><td data-label='OFF-DEF'>0-3</td></tr></tbody></table>`;
  const line = historicalBoxScore(
    `<div id='box-score'>${table(12)}</div><div id='1-box'>${table(4)}</div>`,
    'basketball',
  ).get('45');
  assert.equal(line.points, 12);
  assert.equal(line.offensive_rebounds, 0);
  assert.equal(line.defensive_rebounds, 3);
  assert.equal(line.foul_out, undefined);
});
test('duplicate responsive totals merge only when their overlapping statistics agree', () => {
  const table = (kills, extra = '') =>
    `<table><caption>Brock 3</caption><tbody><tr><td><a href='/sports/mens-basketball/roster/person/45'>Player</a></td><td data-label='Sets'>3</td><td data-label='Attack: K'>${kills}</td>${extra}</tr></tbody></table>`;
  const result = historicalBoxScore(
    table(0) + table(0, "<td data-label='DIG'>2</td>"),
    'volleyball',
  ).get('45');
  assert.equal(result.kills, 0);
  assert.equal(result.digs, 2);
  assert.equal(result.aces, undefined);
  assert.throws(() => historicalBoxScore(table(1) + table(2), 'volleyball'), /Conflicting/u);
});
