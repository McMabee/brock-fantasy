import type { DraftState, League } from '@brock-fantasy/domain';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface LeagueRow {
  id: string;
  competition_id: string | null;
  pool_id: string | null;
  commissioner_id: string | null;
  ruleset_id: string;
  name: string;
  format: League['format'];
  status: League['status'];
  max_members: number;
  invite_code: string;
  state_version: number;
}

interface MyLeague extends League {
  draft: { id: string; status: DraftState['status'] } | null;
}
export function useMyLeagues() {
  const { user } = useSession();
  const userId = user?.id;
  const [state, setState] = useState<{
    owner: string | undefined;
    data: readonly MyLeague[];
    loading: boolean;
    error: string | null;
  }>({ owner: userId, data: [], loading: true, error: null });
  const [revision, setRevision] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!supabase || !userId) {
        setState({ owner: userId, data: [], loading: false, error: null });
        return;
      }
      let active = true;
      const client = supabase;
      setState((current) => ({
        owner: userId,
        data: current.owner === userId ? current.data : [],
        loading: true,
        error: null,
      }));
      const load = async () => {
        const { data, error } = await client
          .from('leagues')
          .select(
            'id, competition_id, pool_id, commissioner_id, ruleset_id, name, format, status, max_members, invite_code, state_version, league_members!inner(user_id)',
          )
          // - Keep personal membership separate from an MFA administrator's oversight access
          .eq('league_members.user_id', userId)
          .order('created_at', { ascending: false });
        if (!active) return;
        if (error) throw error;
        const rows = (data ?? []) as LeagueRow[];
        const drafts = rows.length
          ? await client
              .from('drafts')
              .select('id, league_id, status')
              .in(
                'league_id',
                rows.map((row) => row.id),
              )
              .is('voided_at', null)
          : { data: [], error: null };
        if (!active) return;
        if (drafts.error) throw drafts.error;
        const draftByLeague = new Map(
          (drafts.data ?? []).map(
            (draft: { id: string; league_id: string; status: DraftState['status'] }) => [
              draft.league_id,
              draft,
            ],
          ),
        );
        setState({
          owner: userId,
          loading: false,
          error: null,
          data: rows.map((row) => ({
            id: row.id,
            competitionId: row.competition_id,
            ...(row.pool_id ? { playerPoolId: row.pool_id } : {}),
            commissionerId: row.commissioner_id ?? '',
            rulesetId: row.ruleset_id,
            name: row.name,
            format: row.format,
            status: row.status,
            maxMembers: row.max_members,
            inviteCode: row.invite_code,
            stateVersion: row.state_version,
            draft: draftByLeague.get(row.id) ?? null,
          })),
        });
      };
      void load().catch(() => {
        if (active)
          setState((current) => ({
            ...current,
            loading: false,
            error: 'Unable to load your leagues. Please try again.',
          }));
      });
      return () => {
        active = false;
      };
    }, [userId, revision]),
  );

  return {
    ...state,
    data: state.owner === userId ? state.data : [],
    loading: state.owner !== userId || state.loading,
    reload: () => setRevision((value) => value + 1),
  };
}
