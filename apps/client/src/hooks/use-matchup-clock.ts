import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { MatchupResult } from '@brock-fantasy/domain';
import { nextMatchupBoundary } from '@/lib/matchup-selection';

export function useMatchupClock(rows: readonly MatchupResult[]): number {
  const [, tick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const now = Date.now();
      const boundary = nextMatchupBoundary(rows, now);
      // - Wake at the next calendar boundary without depending on a database status change
      // - Cap long seasonal breaks at the platform timer limit and reschedule on wake
      if (Number.isFinite(boundary))
        timer = setTimeout(refresh, Math.min(boundary - now, 2_147_483_647));
    };
    const refresh = () => {
      tick((value) => value + 1);
      schedule();
    };
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [rows]);
  return Date.now();
}
