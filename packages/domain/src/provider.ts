import { z } from 'zod';

import type {
  NormalizedPlayerGameStat,
  ProviderGameSnapshot,
  ProviderStatSnapshot,
  SyncResult,
  UUID,
} from './types';

export interface SportsDataProvider {
  syncCompetition(competitionId: UUID): Promise<SyncResult>;
  syncRoster(teamId: UUID): Promise<SyncResult>;
  syncSchedule(seasonId: UUID): Promise<SyncResult>;
  fetchGame(gameProviderId: string): Promise<ProviderGameSnapshot>;
  fetchGameStats(gameProviderId: string): Promise<ProviderStatSnapshot>;
}

export const providerStatSnapshotSchema = z.object({
  provider: z.string().min(1),
  providerGameId: z.string().min(1),
  revision: z.string().min(1).optional(),
  capturedAt: z.iso.datetime({ offset: true }),
  gameStatus: z.enum(['scheduled', 'in_progress', 'final', 'postponed', 'cancelled']),
  players: z.array(
    z.object({
      providerAthleteId: z.string().min(1),
      athleteName: z.string().min(1),
      teamProviderId: z.string().min(1),
      position: z.string().optional(),
      stats: z.record(z.string(), z.number().finite()),
    }),
  ),
  raw: z.unknown(),
});

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildSnapshotIdentity(snapshot: ProviderStatSnapshot): string {
  const revision = snapshot.revision ?? fnv1a(stableStringify(snapshot.raw));
  return `${snapshot.provider}:${snapshot.providerGameId}:${revision}`;
}

export interface NormalizationResult {
  stats: readonly NormalizedPlayerGameStat[];
  unknownProviderAthleteIds: readonly string[];
}

export function normalizeSnapshot(
  snapshot: ProviderStatSnapshot,
  gameId: UUID,
  athleteMapping: ReadonlyMap<string, UUID>,
): NormalizationResult {
  const sourceIdentity = buildSnapshotIdentity(snapshot);
  const stats: NormalizedPlayerGameStat[] = [];
  const unknownProviderAthleteIds: string[] = [];

  for (const player of snapshot.players) {
    const athleteId = athleteMapping.get(player.providerAthleteId);
    if (!athleteId) {
      unknownProviderAthleteIds.push(player.providerAthleteId);
      continue;
    }
    stats.push({ gameId, athleteId, sourceIdentity, stats: player.stats });
  }

  return { stats, unknownProviderAthleteIds };
}
