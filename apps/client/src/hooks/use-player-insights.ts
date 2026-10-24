import { BETA_PLAYER_POOL_ID } from '@brock-fantasy/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createSingleFlight } from '@/lib/single-flight';
import { useScreenActive } from '@/hooks/use-active-poll';

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

const requestInsights = createSingleFlight<{
  players: readonly PlayerInsight[];
  error: boolean;
  denied: boolean;
}>();

export function usePlayerInsights(
  poolId: string | undefined = BETA_PLAYER_POOL_ID,
  athleteId?: string,
) {
  const { user, readScope } = useSession();
  const active = useScreenActive();
  const identity = useMemo(
    () => ({ poolId, athleteId, readScope }),
    [poolId, athleteId, readScope],
  );
  const latest = useRef(identity);
  latest.current = identity;
  const [state, setState] = useState<{
    identity: object;
    players: readonly PlayerInsight[];
    error: string | null;
    loading: boolean;
  }>({ identity, players: [], error: null, loading: true });
  const reload = useCallback(async () => {
    if (!supabase || !poolId || !user?.id || !active) return;
    try {
      const result = await requestInsights(
        readScope,
        JSON.stringify([poolId, athleteId ?? null]),
        async () => {
          const response = await supabase!.rpc('get_player_insights', {
            p_pool_id: poolId,
            ...(athleteId ? { p_athlete_id: athleteId } : {}),
          });
          return {
            players: (response.data ?? []) as PlayerInsight[],
            error: Boolean(response.error),
            denied: [401, 403].includes(response.status),
          };
        },
      );
      if (latest.current !== identity) return;
      setState((previous) => ({
        identity,
        players: result.error
          ? result.denied || previous.identity !== identity
            ? []
            : previous.players
          : result.players,
        error: result.error ? 'Player insights are unavailable. Please retry.' : null,
        loading: false,
      }));
    } catch {
      if (latest.current === identity)
        setState({
          identity,
          players: [],
          error: 'Player insights are unavailable. Please retry.',
          loading: false,
        });
    }
  }, [active, poolId, athleteId, identity, readScope, user?.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const players = state.identity === identity && user?.id ? state.players : [];
  const error = state.identity === identity ? state.error : null;
  const loading = Boolean(
    supabase && poolId && user?.id && (state.identity !== identity || state.loading),
  );
  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  return { players, byId, error, loading, reload };
}
