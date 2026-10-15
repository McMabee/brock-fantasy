import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface ProgramGame {
  id: string;
  competition_id: string;
  starts_at: string;
  status: 'scheduled' | 'in_progress';
  schedule_confirmed: boolean;
}

export function useProgramGames(competitionIds: readonly string[]) {
  const key = competitionIds.join(',');
  const [games, setGames] = useState<Readonly<Record<string, ProgramGame>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const client = supabase;
    if (!client || !key) {
      setGames({});
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const load = async () => {
      const result = await client
        .from('games')
        .select('id, competition_id, starts_at, status, schedule_confirmed')
        .in('competition_id', key.split(','))
        .in('status', ['scheduled', 'in_progress'])
        .or(`starts_at.gte.${new Date().toISOString()},status.eq.in_progress`)
        .order('starts_at')
        .limit(500);
      if (!active) return;
      if (result.error) throw result.error;
      const next: Record<string, ProgramGame> = {};
      for (const game of (result.data ?? []) as ProgramGame[]) next[game.competition_id] ??= game;
      setGames(next);
      setError(null);
      setLoading(false);
    };
    void load().catch(() => {
      if (active) {
        setError('Game times could not load.');
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [key]);
  return { games, error, loading };
}
