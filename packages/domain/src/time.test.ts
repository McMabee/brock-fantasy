import { expect, it } from 'vitest';
import { torontoDateFields, torontoDateTime } from './time';
it('converts Toronto civil dates across the season and DST', () => {
  expect(torontoDateTime('2026-10-24', '14:00')).toBe('2026-10-24T18:00:00.000Z');
  expect(torontoDateTime('2027-01-09', '18:00')).toBe('2027-01-09T23:00:00.000Z');
  expect(torontoDateTime('2027-03-14', '02:30')).toBeNull();
  expect(torontoDateTime('2026-11-01', '01:30')).toBeNull();
  expect(torontoDateTime('2026-11-01', '02:30')).toBe('2026-11-01T07:30:00.000Z');
  expect(torontoDateTime('2027-02-30', '12:00')).toBeNull();
  expect(torontoDateFields('2027-01-09T23:00:00Z')).toEqual({ date: '2027-01-09', time: '18:00' });
});
