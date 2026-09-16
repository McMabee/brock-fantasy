import { describe, expect, it } from 'vitest';

import { buildSnapshotIdentity, normalizeSnapshot, providerStatSnapshotSchema } from './provider';
import type { ProviderStatSnapshot } from './types';

const snapshot = providerStatSnapshotSchema.parse({
  provider: 'fixture',
  providerGameId: 'game-1',
  capturedAt: '2026-09-15T12:00:00Z',
  gameStatus: 'final',
  players: [
    {
      providerAthleteId: 'known',
      athleteName: 'Known Athlete',
      teamProviderId: 'brock',
      stats: { goals: 1 },
    },
    {
      providerAthleteId: 'unknown',
      athleteName: 'Unknown Athlete',
      teamProviderId: 'brock',
      stats: { goals: 2 },
    },
  ],
  raw: { b: 2, a: 1 },
}) as ProviderStatSnapshot;

describe('provider pipeline', () => {
  it('creates stable identities when object key order changes', () => {
    const reordered = { ...snapshot, raw: { a: 1, b: 2 } };
    expect(buildSnapshotIdentity(snapshot)).toBe(buildSnapshotIdentity(reordered));
  });

  it('isolates unmapped athletes rather than scoring them', () => {
    const result = normalizeSnapshot(snapshot, 'internal-game', new Map([['known', 'athlete-1']]));
    expect(result.stats).toEqual([
      {
        gameId: 'internal-game',
        athleteId: 'athlete-1',
        sourceIdentity: buildSnapshotIdentity(snapshot),
        stats: { goals: 1 },
      },
    ]);
    expect(result.unknownProviderAthleteIds).toEqual(['unknown']);
  });
});
