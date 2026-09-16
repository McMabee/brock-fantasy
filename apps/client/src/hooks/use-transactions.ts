import { useCallback, useEffect, useState } from 'react';

import { demoAthletes, demoTeams } from '@/data/demo';
import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export interface TransactionAthlete {
  id: string;
  displayName: string;
  position: string;
}

export interface RosterAsset extends TransactionAthlete {
  fantasyTeamId: string;
}

export interface TradeAsset {
  fromTeamId: string;
  toTeamId: string;
  athleteId: string;
}

export interface TradeView {
  id: string;
  proposingTeamId: string;
  receivingTeamId: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
  expiresAt: string;
  items: readonly TradeAsset[];
}

interface TransactionState {
  freeAgents: readonly TransactionAthlete[];
  rosterAssets: readonly RosterAsset[];
  trades: readonly TradeView[];
  freeAgentsEnabled: boolean;
  waiversEnabled: boolean;
  tradesEnabled: boolean;
  loading: boolean;
  error: string | null;
}

interface AthleteRow {
  id: string;
  display_name: string;
  position: string;
}

interface RosterRow {
  fantasy_team_id: string;
  athlete_id: string;
  athlete:
    | { display_name: string; position: string }
    | readonly { display_name: string; position: string }[];
}

interface TradeRow {
  id: string;
  proposing_team_id: string;
  receiving_team_id: string;
  status: TradeView['status'];
  expires_at: string;
}

interface TradeItemRow {
  trade_id: string;
  from_team_id: string;
  to_team_id: string;
  athlete_id: string;
}

export function useTransactions({
  leagueId,
  competitionId,
  rulesetId,
}: {
  leagueId: string | undefined;
  competitionId: string | undefined;
  rulesetId: string | undefined;
}) {
  const { demoMode } = useSession();
  const local = demoMode || leagueId === 'demo-league';
  const [state, setState] = useState<TransactionState>({
    freeAgents: local ? demoAthletes.slice(6).map(toTransactionAthlete) : [],
    rosterAssets: local
      ? demoAthletes.slice(0, 6).map((athlete, index) => ({
          ...toTransactionAthlete(athlete),
          fantasyTeamId: index < 3 ? (demoTeams[0]?.id ?? '') : (demoTeams[1]?.id ?? ''),
        }))
      : [],
    trades: [],
    freeAgentsEnabled: local,
    waiversEnabled: local,
    tradesEnabled: local,
    loading: !local,
    error: null,
  });

  const reload = useCallback(async () => {
    if (local || !supabase || !leagueId || !competitionId || !rulesetId) return;
    const client = supabase;
    const [athleteResult, rosterResult, tradeResult, rulesetResult] = await Promise.all([
      client
        .from('athletes')
        .select('id, display_name, position')
        .eq('competition_id', competitionId)
        .eq('status', 'active')
        .order('display_name'),
      client
        .from('roster_entries')
        .select('fantasy_team_id, athlete_id, athlete:athletes!inner(display_name, position)')
        .eq('league_id', leagueId)
        .is('released_at', null),
      client
        .from('trades')
        .select('id, proposing_team_id, receiving_team_id, status, expires_at')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(50),
      client.from('scoring_rulesets').select('transaction_config').eq('id', rulesetId).single(),
    ]);
    const error =
      athleteResult.error ?? rosterResult.error ?? tradeResult.error ?? rulesetResult.error;
    if (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
      return;
    }
    const tradeRows: TradeRow[] = tradeResult.data ?? [];
    const itemResult = tradeRows.length
      ? await client
          .from('trade_items')
          .select('trade_id, from_team_id, to_team_id, athlete_id')
          .in(
            'trade_id',
            tradeRows.map((trade) => trade.id),
          )
      : { data: [] as TradeItemRow[], error: null };
    if (itemResult.error) {
      setState((current) => ({ ...current, loading: false, error: itemResult.error.message }));
      return;
    }
    if (!rulesetResult.data) {
      setState((current) => ({ ...current, loading: false, error: 'Ruleset not found.' }));
      return;
    }
    const rosterRows = rosterResult.data as unknown as RosterRow[];
    const rosteredIds = new Set(rosterRows.map((entry) => entry.athlete_id));
    const config = rulesetResult.data.transaction_config as Record<string, unknown>;
    const itemRows = itemResult.data as TradeItemRow[];
    setState({
      freeAgents: (athleteResult.data as AthleteRow[])
        .filter((athlete) => !rosteredIds.has(athlete.id))
        .map((athlete) => ({
          id: athlete.id,
          displayName: athlete.display_name,
          position: athlete.position,
        })),
      rosterAssets: rosterRows.flatMap((entry) => {
        const athlete = firstRelated(entry.athlete);
        return athlete
          ? [
              {
                id: entry.athlete_id,
                fantasyTeamId: entry.fantasy_team_id,
                displayName: athlete.display_name,
                position: athlete.position,
              },
            ]
          : [];
      }),
      trades: tradeRows.map((trade) => ({
        id: trade.id,
        proposingTeamId: trade.proposing_team_id,
        receivingTeamId: trade.receiving_team_id,
        status: trade.status,
        expiresAt: trade.expires_at,
        items: itemRows
          .filter((item) => item.trade_id === trade.id)
          .map((item) => ({
            fromTeamId: item.from_team_id,
            toTeamId: item.to_team_id,
            athleteId: item.athlete_id,
          })),
      })),
      freeAgentsEnabled: config.freeAgentsEnabled === true,
      waiversEnabled: config.waiversEnabled === true,
      tradesEnabled: config.tradesEnabled === true,
      loading: false,
      error: null,
    });
  }, [competitionId, leagueId, local, rulesetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

function toTransactionAthlete(athlete: { id: string; displayName: string; position: string }) {
  return { id: athlete.id, displayName: athlete.displayName, position: athlete.position };
}
