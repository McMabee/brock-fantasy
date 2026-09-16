import { describe, expect, it } from 'vitest';

import { validateRoster } from './roster';
import type { RosterEntry, RosterSlotRule } from './types';

const slotRules: RosterSlotRule[] = [
  { slot: 'forward', label: 'Forward', allowedPositions: ['F'], count: 2, isStarter: true },
  { slot: 'goalie', label: 'Goalie', allowedPositions: ['G'], count: 1, isStarter: true },
  { slot: 'bench', label: 'Bench', allowedPositions: ['F', 'D', 'G'], count: 2, isStarter: false },
];

const entry = (overrides: Partial<RosterEntry>): RosterEntry => ({
  fantasyTeamId: 'fantasy-team',
  athleteId: 'athlete',
  athletePosition: 'F',
  slot: 'forward',
  status: 'starter',
  acquiredAt: '2026-09-15T00:00:00Z',
  ...overrides,
});

describe('validateRoster', () => {
  it('accepts eligible athletes within slot limits', () => {
    expect(
      validateRoster([entry({ athleteId: 'one' }), entry({ athleteId: 'two' })], slotRules).valid,
    ).toBe(true);
  });

  it('rejects duplicates, ineligible positions, and overfilled slots', () => {
    const result = validateRoster(
      [
        entry({ athleteId: 'one' }),
        entry({ athleteId: 'one' }),
        entry({ athleteId: 'three', athletePosition: 'G' }),
      ],
      slotRules,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});
