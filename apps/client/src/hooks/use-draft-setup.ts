import { useCallback, useMemo, useRef, useState } from 'react';
import type { DraftMode } from '@brock-fantasy/domain';
import { useActivePoll, useAppActive } from '@/hooks/use-active-poll';
import { useSession } from '@/providers/session-provider';
import { betaCommand } from '@/lib/web-api';

export interface DraftPreparation {
  mode: DraftMode | null;
  status: 'unselected' | 'ready' | 'armed' | 'running' | 'blocked' | 'complete';
  blockReason: string | null;
  scheduledFor: string | null;
  leagueVersion: number;
  serverTime: string;
  automaticEnabled: boolean;
  myTeamId: string | null;
  preferenceVersion: number;
  preferences: string[];
  editable: boolean;
  teams: { id: string; name: string; prepared: boolean }[];
  players: {
    id: string;
    displayName: string;
    positions: string[];
    program: string;
    rank: number;
    bio: Record<string, unknown>;
    eligibleForMe: boolean;
  }[];
}

export function useDraftSetup(leagueId: string | undefined) {
  const { user, readScope } = useSession();
  const identity = useMemo(
    () => ({ leagueId, readScope, userId: user?.id }),
    [leagueId, readScope, user?.id],
  );
  const latest = useRef(identity);
  latest.current = identity;
  const [state, setState] = useState<{
    identity: typeof identity;
    data: DraftPreparation | null;
    error: string | null;
    denied: boolean;
  }>({ identity, data: null, error: null, denied: false });
  const pending = useRef<{ identity: typeof identity; task: Promise<void> } | null>(null);
  const failure = useRef(0);
  const active = useAppActive();
  const reload = useCallback(
    async (fresh = false) => {
      if (!leagueId || !user?.id) return;
      if (pending.current?.identity === identity) {
        await pending.current.task;
        if (!fresh || latest.current !== identity) return;
      }
      const scope = identity;
      const task = (async () => {
        const result = await betaCommand<DraftPreparation>('get_league_draft_setup', {
          p_league_id: leagueId,
        });
        if (latest.current !== scope) return;
        const denied = result.status === 403 || result.code === '42501';
        if (result.error) {
          failure.current++;
          setState((old) => ({
            identity: scope,
            data: denied ? null : old.identity === scope ? old.data : null,
            error: result.error,
            denied,
          }));
        } else {
          failure.current = 0;
          setState({ identity: scope, data: result.data, error: null, denied: false });
        }
      })();
      pending.current = { identity, task };
      try {
        await task;
      } finally {
        if (pending.current?.task === task) pending.current = null;
      }
    },
    [identity, leagueId, user?.id],
  );
  const denied = state.identity === identity && state.denied;
  const delay = useCallback(() => Math.min(60_000, 15_000 * 2 ** Math.min(failure.current, 2)), []);
  useActivePoll(reload, active && Boolean(user?.id && leagueId) && !denied, delay);
  return {
    data: state.identity === identity ? state.data : null,
    error: state.identity === identity ? state.error : null,
    reload,
  };
}
