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
  it('preserves the original legal picks across all three-player eligibility combinations', () => {
    const profiles = [
      { positions: ['F'], ownerId: null },
      { positions: ['D'], ownerId: null },
      { positions: ['D', 'F'], ownerId: null },
      { positions: ['F'], ownerId: 'one' },
      { positions: ['D'], ownerId: 'two' },
      { positions: ['F', 'D'], ownerId: null, blockedTeamIds: ['one'] },
      { positions: ['F', 'D'], ownerId: null, blockedTeamIds: ['two'] },
      { positions: ['D', 'F', 'D'], ownerId: null, blockedTeamIds: ['one', 'two'] },
    ];
    const smallSlots = [
      { teamId: 'one', code: 'F', positions: ['F'] },
      { teamId: 'two', code: 'D', positions: ['D'] },
    ];
    for (const first of profiles)
      for (const second of profiles)
        for (const third of profiles) {
          const pool = [first, second, third].map((profile, index) => ({
            id: String(index),
            ...profile,
          }));
          for (const team of ['one', 'two']) {
            const reference = pool.flatMap((candidate) =>
              candidate.ownerId === null &&
              completeDraftRoster(
                pool.map((athlete) =>
                  athlete.id === candidate.id ? { ...athlete, ownerId: team } : athlete,
                ),
                smallSlots,
              )
                ? [candidate.id]
                : [],
            );
            expect(legalDraftAthletes(pool, smallSlots, team)).toEqual(reference);
          }
        }
  });
  it('retains feasibility for a large interchangeable pool and rejects a blocked owner', () => {
    const pool = Array.from({ length: 1200 }, (_, n) => ({
      id: String(n),
      positions: ['F', 'D'],
      ownerId: null,
      blockedTeamIds: n % 2 ? ['two'] : [],
    }));
    expect(legalDraftAthletes(pool, slots, 'one')).toHaveLength(1200);
    expect(legalDraftAthletes(pool, slots, 'two')).toHaveLength(600);
  });
  it('keeps duplicate-identity behavior equivalent to the original matching calls', () => {
    const pool = [
      { id: 'duplicate', positions: ['F'], ownerId: null },
      { id: 'duplicate', positions: ['D'], ownerId: null },
      ...candidates,
    ];
    const reference = pool.flatMap((candidate) =>
      candidate.ownerId === null &&
      completeDraftRoster(
        pool.map((athlete) =>
          athlete.id === candidate.id ? { ...athlete, ownerId: 'one' } : athlete,
        ),
        slots,
      )
        ? [candidate.id]
        : [],
    );
    expect(legalDraftAthletes(pool, slots, 'one')).toEqual(reference);
  });
});
