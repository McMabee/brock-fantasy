import type { RosterEntry, RosterSlotRule, UUID } from './types';

export interface RosterValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export function validateRoster(
  entries: readonly RosterEntry[],
  slotRules: readonly RosterSlotRule[],
): RosterValidationResult {
  const errors: string[] = [];
  const activeEntries = entries.filter((entry) => entry.releasedAt === undefined);
  const athleteIds = new Set<UUID>();

  for (const entry of activeEntries) {
    if (athleteIds.has(entry.athleteId)) errors.push(`Athlete ${entry.athleteId} appears twice.`);
    athleteIds.add(entry.athleteId);

    const rule = slotRules.find((slotRule) => slotRule.slot === entry.slot);
    if (!rule) {
      errors.push(`Unknown roster slot ${entry.slot}.`);
    } else if (!rule.allowedPositions.includes(entry.athletePosition)) {
      errors.push(`${entry.athletePosition} is not eligible for ${entry.slot}.`);
    }
  }

  for (const rule of slotRules) {
    const count = activeEntries.filter((entry) => entry.slot === rule.slot).length;
    if (count > rule.count) errors.push(`${rule.label} allows ${rule.count}; received ${count}.`);
  }

  return { valid: errors.length === 0, errors };
}
