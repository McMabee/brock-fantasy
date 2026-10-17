import { BETA_PLAYER_POOL_ID } from '@brock-fantasy/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export interface InsightGame {
  id: string;
  starts_at: string;
  status: string;
  schedule_confirmed: boolean;
  opponent: string;
  home: boolean;
  neutral?: boolean;
}
export interface PlayerInsight {
  id: string;
  displayName: string;
  jerseyNumber: string | null;
  bio: Record<string, unknown>;
  position: string;
  positions: readonly string[];
  program: string;
  programCode?: string;
  team: string;
  teamId: string;
  competitionId: string;
  seasonPoints: number;
  seasonStats?: Readonly<Record<string, number>>;
  seasonProjection: number | null;
  nextProjection: number | null;
  projectedGames: number | null;
  scheduledGames: number;
  period: { number: number; startsAt: string; endsAt: string } | null;
  pending: boolean;
  adp: number | null;
  nextGame: InsightGame | null;
}

export function usePlayerInsights(
  poolId: string | undefined = BETA_PLAYER_POOL_ID,
  athleteId?: string,
) {
  const { user } = useSession();
  const [players, setPlayers] = useState<readonly PlayerInsight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!supabase || !poolId || !user?.id) return;
    const result = await supabase.rpc('get_player_insights', {
      p_pool_id: poolId,
      ...(athleteId ? { p_athlete_id: athleteId } : {}),
    });
    if (result.error) setError('Player insights are unavailable. Please retry.');
    else {
      setPlayers((result.data ?? []) as PlayerInsight[]);
      setError(null);
    }
    setLoading(false);
  }, [poolId, athleteId, user?.id]);
  useEffect(() => {
    let cancelled = false;
    setPlayers([]);
    setLoading(true);
    if (!supabase || !poolId || !user?.id) {
      setLoading(false);
      return;
    }
    void supabase
      .rpc('get_player_insights', {
        p_pool_id: poolId,
        ...(athleteId ? { p_athlete_id: athleteId } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        setError(result.error ? 'Player insights are unavailable. Please retry.' : null);
        if (!result.error) setPlayers((result.data ?? []) as PlayerInsight[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [poolId, athleteId, user?.id]);
  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  return { players, byId, error, loading, reload };
}
