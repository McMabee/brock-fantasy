import type { AthleteAvailability } from '@brock-fantasy/domain';

export interface AvailabilityRow {
  id: string;
  availability_status: AthleteAvailability;
  availability_revision: number;
  availability_changed_at: string | null;
}
export type AvailabilityFilter = 'all' | AthleteAvailability;
export type AvailabilityOrder = 'default' | 'active' | 'injured';
export interface AvailabilitySnapshot {
  rows: ReadonlyMap<string, AvailabilityRow>;
  unavailable: ReadonlySet<string>;
  error: boolean;
}
export function matchesAvailability(
  id: string,
  rows: ReadonlyMap<string, AvailabilityRow>,
  filter: AvailabilityFilter,
): boolean {
  return filter === 'all' || rows.get(id)?.availability_status === filter;
}
export function compareAvailability(
  left: string,
  right: string,
  rows: ReadonlyMap<string, AvailabilityRow>,
  order: AvailabilityOrder,
): number {
  if (order === 'default') return 0;
  const priority = (id: string) => {
    const status = rows.get(id)?.availability_status;
    return status ? (status === order ? 0 : 1) : 2;
  };
  return priority(left) - priority(right);
}

// - Batch mounted consumers and ignore responses belonging to disposed sessions
export function createAvailabilityStore(load: (ids: string[]) => Promise<AvailabilityRow[]>) {
  let snapshot: AvailabilitySnapshot = { rows: new Map(), unavailable: new Set(), error: false };
  const listeners = new Set<() => void>();
  const watched = new Map<string, number>();
  let active = false;
  let disposed = false;
  let queued = false;
  let again = false;
  let pending: Promise<void> | null = null;
  const emit = (next: AvailabilitySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const schedule = () => {
    if (queued || disposed || !active) return;
    queued = true;
    void Promise.resolve().then(() => {
      queued = false;
      return refresh();
    });
  };
  const refresh = (): Promise<void> => {
    if (disposed || !active || !watched.size) return Promise.resolve();
    if (pending) {
      again = true;
      return pending;
    }
    const ids = [...watched.keys()];
    const requested = new Set(ids);
    pending = Promise.resolve()
      .then(async () => {
        try {
          const result = await load(ids);
          if (disposed) return;
          const incoming = new Map<string, AvailabilityRow>();
          for (const row of result) {
            if (!requested.has(row.id) || !['active', 'injured'].includes(row.availability_status))
              throw new Error('Invalid athlete availability');
            incoming.set(row.id, row);
          }
          // - Preserve snapshot identity when polling confirms the same values
          if (
            !snapshot.error &&
            ids.every((id) => {
              const next = incoming.get(id),
                previous = snapshot.rows.get(id);
              return next
                ? previous?.availability_status === next.availability_status &&
                    previous.availability_revision === next.availability_revision &&
                    previous.availability_changed_at === next.availability_changed_at
                : !previous && snapshot.unavailable.has(id);
            })
          )
            return;
          const rows = new Map(snapshot.rows);
          const unavailable = new Set(snapshot.unavailable);
          for (const id of ids) {
            rows.delete(id);
            unavailable.add(id);
          }
          for (const row of result) {
            rows.set(row.id, row);
            unavailable.delete(row.id);
          }
          emit({ rows, unavailable, error: false });
        } catch (error) {
          if (!disposed)
            emit(
              error && typeof error === 'object' && 'denied' in error
                ? { rows: new Map(), unavailable: new Set(ids), error: true }
                : { ...snapshot, error: true },
            );
        }
      })
      .finally(() => {
        pending = null;
        if (again) {
          again = false;
          schedule();
        }
      });
    return pending;
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    watch(ids: readonly string[]) {
      for (const id of ids) watched.set(id, (watched.get(id) ?? 0) + 1);
      schedule();
      return () => {
        for (const id of ids) {
          const count = (watched.get(id) ?? 1) - 1;
          if (count) watched.set(id, count);
          else watched.delete(id);
        }
      };
    },
    setActive(value: boolean) {
      active = value;
      if (active) schedule();
    },
    refresh,
    dispose() {
      disposed = true;
      watched.clear();
      listeners.clear();
      snapshot = { rows: new Map(), unavailable: new Set(), error: false };
    },
  };
}
