export interface DraftCandidate {
  id: string;
  positions: readonly string[];
  ownerId: string | null;
}
export interface DraftSlot {
  teamId: string;
  code: string;
  positions: readonly string[];
}

/** Mandatory owned athletes are matched first. Each BFS visits each slot once. */
export function completeDraftRoster(
  candidates: readonly DraftCandidate[],
  slots: readonly DraftSlot[],
): ReadonlyMap<string, number> | null {
  if (candidates.length < slots.length || !slots.length) return null;
  const ordered = [...candidates].sort(
    (a, b) => Number(a.ownerId === null) - Number(b.ownerId === null) || a.id.localeCompare(b.id),
  );
  const edges = ordered.map((athlete) =>
    slots.flatMap((slot, index) =>
      (!athlete.ownerId || athlete.ownerId === slot.teamId) &&
      athlete.positions.some((position) => slot.positions.includes(position))
        ? [index]
        : [],
    ),
  );
  const athleteSlots = new Map<number, number>();
  const slotOwners = new Map<number, number>();
  for (let root = 0; root < ordered.length; root++) {
    if (slotOwners.size === slots.length && ordered[root]!.ownerId === null) break;
    const queue = [root];
    const seenAthletes = new Set(queue);
    const parents = new Map<number, number>();
    let freeSlot: number | undefined;
    for (let head = 0; head < queue.length && freeSlot === undefined; head++) {
      const athlete = queue[head]!;
      for (const slot of edges[athlete]!) {
        if (parents.has(slot)) continue;
        parents.set(slot, athlete);
        const previous = slotOwners.get(slot);
        if (previous === undefined) {
          freeSlot = slot;
          break;
        }
        if (!seenAthletes.has(previous)) {
          seenAthletes.add(previous);
          queue.push(previous);
        }
      }
    }
    if (freeSlot === undefined) {
      if (ordered[root]!.ownerId) return null;
      continue;
    }
    while (freeSlot !== undefined) {
      const athlete = parents.get(freeSlot)!;
      const previousSlot = athleteSlots.get(athlete);
      athleteSlots.set(athlete, freeSlot);
      slotOwners.set(freeSlot, athlete);
      freeSlot = previousSlot;
    }
  }
  if (slotOwners.size !== slots.length) return null;
  return new Map([...athleteSlots].map(([index, slot]) => [ordered[index]!.id, slot]));
}

export function legalDraftAthletes(
  candidates: readonly DraftCandidate[],
  slots: readonly DraftSlot[],
  teamId: string,
): readonly string[] {
  return candidates.flatMap((candidate) =>
    candidate.ownerId === null &&
    completeDraftRoster(
      candidates.map((athlete) =>
        athlete.id === candidate.id ? { ...athlete, ownerId: teamId } : athlete,
      ),
      slots,
    )
      ? [candidate.id]
      : [],
  );
}

export function formatDraftClock(seconds: number): string {
  const safe = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  return String(Math.floor(safe / 60)) + ':' + String(safe % 60).padStart(2, '0');
}

export function previewDraftQueue(
  queuedIds: readonly string[],
  candidates: readonly DraftCandidate[],
  emptySlots: readonly DraftSlot[],
): ReadonlyMap<number, string> {
  const selected = new Map<number, string>();
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const place = (id: string, seen: Set<number>): boolean => {
    const candidate = candidateById.get(id);
    if (!candidate || candidate.ownerId) return false;
    for (let slot = 0; slot < emptySlots.length; slot++) {
      if (
        seen.has(slot) ||
        !candidate.positions.some((p) => emptySlots[slot]!.positions.includes(p))
      )
        continue;
      seen.add(slot);
      const previous = selected.get(slot);
      if (!previous || place(previous, seen)) {
        selected.set(slot, id);
        return true;
      }
    }
    return false;
  };
  for (const id of new Set(queuedIds)) place(id, new Set());
  return selected;
}
