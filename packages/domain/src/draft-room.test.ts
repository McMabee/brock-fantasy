import { describe, expect, it } from 'vitest';
import {
  completeDraftRoster,
  formatDraftClock,
  legalDraftAthletes,
  previewDraftQueue,
} from './draft-room';

describe('draft completion and previews', () => {
  const slots = [
    { teamId: 'one', code: 'F', positions: ['F'] },
    { teamId: 'one', code: 'BN', positions: ['F', 'D'] },
    { teamId: 'two', code: 'D', positions: ['D'] },
    { teamId: 'two', code: 'BN', positions: ['F', 'D'] },
  ];
  const candidates = [
    { id: 'a', positions: ['F'], ownerId: null },
    { id: 'b', positions: ['F'], ownerId: null },
    { id: 'c', positions: ['D'], ownerId: null },
    { id: 'd', positions: ['F'], ownerId: null },
  ];
  it('reserves scarce athletes for every team rather than only the viewer', () => {
    expect(legalDraftAthletes(candidates, slots, 'one')).not.toContain('c');
    expect(completeDraftRoster(candidates, slots)?.size).toBe(4);
  });
  it('retains a mandatory pick that sorts after enough unowned alternatives', () => {
    expect(
      completeDraftRoster(
        candidates.map((c) => (c.id === 'd' ? { ...c, ownerId: 'one' } : c)),
        slots,
      )?.has('d'),
    ).toBe(true);
  });
  it('rejects an overfilled owner', () => {
    expect(
      completeDraftRoster(
        candidates.map((c) => ({ ...c, ownerId: 'one' })),
        slots,
      ),
    ).toBeNull();
  });
  it('moves a flexible preview without touching confirmed roster entries', () => {
    const previews = previewDraftQueue(
      ['x', 'y'],
      [
        { id: 'x', positions: ['F', 'D'], ownerId: null },
        { id: 'y', positions: ['F'], ownerId: null },
      ],
      [
        { teamId: 'one', code: 'F', positions: ['F'] },
        { teamId: 'one', code: 'D', positions: ['D'] },
      ],
    );
    expect([...previews.values()].sort()).toEqual(['x', 'y']);
  });
  it('formats minutes and guards invalid clocks', () => {
    expect([120, 100, 60, 9, -1, NaN].map(formatDraftClock)).toEqual([
      '2:00',
      '1:40',
      '1:00',
      '0:09',
      '0:00',
      '0:00',
    ]);
  });
});
