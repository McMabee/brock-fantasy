import { useCallback, useEffect, useState } from 'react';

import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';
import { TRANSACTION_ATHLETE_SELECT } from '@/lib/transaction-athlete-query';

export interface TransactionAthlete {
  id: string;
  displayName: string;
  position: string;
  bio: Record<string, unknown>;
  program: string;
  team: string;
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
  reviewEndsAt: string | null;
  executionStatus: 'pending' | 'review' | 'locked' | 'vetoed' | 'conflicted' | 'completed';
  items: readonly TradeAsset[];
}

export interface WaiverClaim {
  id: string;
  athlete_in_id: string;
  athlete_out_id: string | null;
  status: string;
  process_after: string;
  outcome_reason: string | null;
}
interface TransactionState {
  claims: readonly WaiverClaim[];
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
  bio?: Record<string, unknown>;
  competition?: { name: string } | readonly { name: string }[];
  team?: { name: string } | readonly { name: string }[];
}

interface RosterRow {
  fantasy_team_id: string;
  athlete_id: string;
  athlete: AthleteRow | readonly AthleteRow[];
}

interface TradeRow {
  id: string;
  proposing_team_id: string;
  receiving_team_id: string;
  status: TradeView['status'];
  expires_at: string;
  review_ends_at: string | null;
  execution_status: TradeView['executionStatus'];
}

interface TradeItemRow {
  trade_id: string;
  from_team_id: string;
  to_team_id: string;
  athlete_id: string;
}

export function useTransactions({
  leagueId,
  myTeamId,
  competitionId,
  playerPoolId,
  rulesetId,
}: {
  leagueId: string | undefined;
  myTeamId: string | null;
  competitionId: string | null | undefined;
  playerPoolId?: string;
  rulesetId: string | undefined;
}) {
  const [state, setState] = useState<TransactionState>({
    claims: [],
    freeAgents: [],
    rosterAssets: [],
    trades: [],
    freeAgentsEnabled: false,
    waiversEnabled: false,
    tradesEnabled: false,
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!supabase || !leagueId || (!competitionId && !playerPoolId) || !rulesetId) {
      setState((current) => ({ ...current, loading: false }));
      return false;
    }
    const client = supabase;
    const [athleteResult, rosterResult, tradeResult, rulesetResult, claimResult] =
      await Promise.all([
        playerPoolId
          ? client
              .from('pool_rankings')
              .select(`athlete:athletes!inner(${TRANSACTION_ATHLETE_SELECT})`)
              .eq('pool_id', playerPoolId)
          : client
              .from('athletes')
              .select(TRANSACTION_ATHLETE_SELECT)
              .eq('competition_id', competitionId!)
              .eq('status', 'active')
              .order('display_name'),
        client
          .from('roster_entries')
          .select(
            `fantasy_team_id,athlete_id,athlete:athletes!inner(${TRANSACTION_ATHLETE_SELECT})`,
          )
          .eq('league_id', leagueId)
          .is('released_at', null),
        client
          .from('trades')
          .select(
            'id, proposing_team_id, receiving_team_id, status, expires_at, review_ends_at, execution_status',
          )
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false })
          .limit(50),
        client.from('scoring_rulesets').select('transaction_config').eq('id', rulesetId).single(),
        client
          .from('waiver_claims')
          .select('id,athlete_in_id,athlete_out_id,status,process_after,outcome_reason')
          .eq('league_id', leagueId)
          .eq('fantasy_team_id', myTeamId ?? '00000000-0000-0000-0000-000000000000')
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
    const error =
      athleteResult.error ??
      rosterResult.error ??
      tradeResult.error ??
      rulesetResult.error ??
      claimResult.error;
    if (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
      return false;
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
      return false;
    }
    if (!rulesetResult.data) {
      setState((current) => ({ ...current, loading: false, error: 'Ruleset not found.' }));
      return false;
    }
    const rosterRows = rosterResult.data as unknown as RosterRow[];
    const rosteredIds = new Set(rosterRows.map((entry) => entry.athlete_id));
    const config = rulesetResult.data.transaction_config as Record<string, unknown>;
    const itemRows = itemResult.data as TradeItemRow[];
    // - Group trade items once instead of rescanning every item for each trade
    const itemsByTrade = new Map<string, TradeItemRow[]>();
    for (const item of itemRows) {
      const items = itemsByTrade.get(item.trade_id) ?? [];
      items.push(item);
      itemsByTrade.set(item.trade_id, items);
    }
    setState({
      claims: claimResult.data ?? [],
      freeAgents: (playerPoolId
        ? (
            athleteResult.data as unknown as { athlete: AthleteRow | readonly AthleteRow[] }[]
          ).flatMap((row) => {
            const athlete = firstRelated(row.athlete);
            return athlete ? [athlete] : [];
          })
        : (athleteResult.data as AthleteRow[])
      )
        .filter((athlete) => !rosteredIds.has(athlete.id))
        .map((athlete) => ({
          id: athlete.id,
          displayName: athlete.display_name,
          position: athlete.position,
          bio: athlete.bio ?? {},
          program:
            firstRelated(athlete.competition)?.name ??
            (typeof athlete.bio?.program === 'string' ? athlete.bio.program : 'Brock varsity'),
          team: firstRelated(athlete.team)?.name ?? 'Brock',
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
                bio: athlete.bio ?? {},
                program:
                  firstRelated(athlete.competition)?.name ??
                  (typeof athlete.bio?.program === 'string'
                    ? athlete.bio.program
                    : 'Brock varsity'),
                team: firstRelated(athlete.team)?.name ?? 'Brock',
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
        reviewEndsAt: trade.review_ends_at,
        executionStatus: trade.execution_status,
        items: (itemsByTrade.get(trade.id) ?? []).map((item) => ({
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
    return true;
  }, [competitionId, leagueId, myTeamId, playerPoolId, rulesetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
