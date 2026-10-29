interface SavedEntry {
  athlete_id: string;
  slot_code: string;
  status: string;
}

// - Compare final assignments with the editing baseline in one pass
export function pendingLineupChanges<T extends SavedEntry>(
  baseline: readonly T[],
  assignments: Readonly<Record<string, string>>,
): { entry: T; from: string; to: string }[] {
  return baseline.flatMap((entry) => {
    const to = assignments[entry.athlete_id] ?? entry.slot_code;
    return to === entry.slot_code ? [] : [{ entry, from: entry.slot_code, to }];
  });
}

export function sameSavedLineup(
  baseline: readonly SavedEntry[],
  current: readonly SavedEntry[],
): boolean {
  if (baseline.length !== current.length) return false;
  // - Compare the editing baseline in linear time without relying on database row order
  const entries = new Map(current.map((entry) => [entry.athlete_id, entry]));
  return baseline.every((entry) => {
    const latest = entries.get(entry.athlete_id);
    return latest?.slot_code === entry.slot_code && latest.status === entry.status;
  });
}
