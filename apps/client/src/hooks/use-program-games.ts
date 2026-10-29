import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useActivePoll, useScreenActive } from './use-active-poll';
import { useSession } from '@/providers/session-provider';

export interface ProgramGame {
  id: string;
  starts_at: string;
  status: 'scheduled' | 'in_progress';
  schedule_confirmed: boolean;
  opponent: string;
  home: boolean;
  neutral: boolean;
}
export interface ProgramGames {
  competition_id: string;
  live: ProgramGame | null;
  next: ProgramGame | null;
}

export function useProgramGames(competitionIds: readonly string[]) {
  const { user, readScope } = useSession();
  const key = [...competitionIds].sort().join(',');
  const identity = useMemo(() => ({ key, readScope }), [key, readScope]);
  const latest = useRef<object>(identity);
  latest.current = identity;
  const pending = useRef<object | null>(null);
  const active = useScreenActive();
  const [state, setState] = useState<{
    identity: object;
    games: Record<string, ProgramGames>;
    error: string | null;
  } | null>(null);
  const reload = useCallback(async () => {
    if (!supabase || !user || !key || pending.current === identity) return;
    pending.current = identity;
    try {
      const result = await supabase.rpc('get_upcoming_program_games', {
        p_competition_ids: key.split(','),
      });
      if (latest.current !== identity) return;
      if (result.error) throw result.error;
      const games = Object.fromEntries(
        ((result.data ?? []) as ProgramGames[]).map((row) => [row.competition_id, row]),
      );
      setState({ identity, games, error: null });
    } catch {
      if (latest.current === identity)
        setState({ identity, games: {}, error: 'Upcoming games could not load.' });
    } finally {
      if (pending.current === identity) pending.current = null;
    }
  }, [identity, key, user?.id]);
  useEffect(() => {
    latest.current = identity;
    void reload();
    return () => {
      if (latest.current === identity) latest.current = {};
    };
  }, [reload, identity]);
  useActivePoll(reload, active, 30_000);
  const current = state?.identity === identity ? state : null;
  return {
    games: current?.games ?? {},
    error: current?.error ?? null,
    loading: !!key && !!user && !current,
    reload,
  };
}
