import type { Athlete, DraftPick, DraftState, FantasyTeam } from '@brock-fantasy/domain';
import { useCallback, useEffect, useState } from 'react';

import { demoAthletes, demoTeams } from '@/data/demo';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface DraftRow {
  id: string;
  league_id: string;
  status: DraftState['status'];
  rounds: number;
  current_overall_pick: number;
  pick_deadline: string | null;
  team_order: string[];
}

interface LeagueRow {
  id: string;
  name: string;
  competition_id: string;
}

interface TeamRow {
  id: string;
  league_id: string;
  owner_id: string | null;
  name: string;
  draft_position: number | null;
}

interface AthleteRow {
  id: string;
  competition_id: string;
  team_id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  status: Athlete['status'];
}

interface PickRow {
  id: string;
  draft_id: string;
  fantasy_team_id: string;
  athlete_id: string;
  overall_pick: number;
  round: number;
  pick_in_round: number;
  source: DraftPick['source'];
  created_at: string;
}

interface RankingRow {
  athlete_id: string;
  rank: number;
}

interface QueueRow {
  athlete_id: string;
  priority: number;
}

export interface DraftViewState {
  draft: DraftState | null;
  leagueName: string;
  teams: readonly FantasyTeam[];
  athletes: readonly Athlete[];
  picks: readonly DraftPick[];
  rankings: ReadonlyMap<string, number>;
  queuedAthleteIds: readonly string[];
  myTeamId: string | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const demoDraft: DraftState = {
  id: 'demo-draft',
  leagueId: 'demo-league',
  status: 'active',
  rounds: 4,
  currentOverallPick: 1,
  pickDeadline: new Date(Date.now() + 30_000).toISOString(),
  teamIdsInDraftOrder: demoTeams.map((team) => team.id),
  picks: [],
};

export function useDraft(draftId: string | undefined): DraftViewState {
  const { demoMode, user } = useSession();
  const local = demoMode || draftId === 'demo-draft';
  const [state, setState] = useState<Omit<DraftViewState, 'reload'>>({
    draft: local ? demoDraft : null,
    leagueName: local ? 'Badger Ice League' : '',
    teams: local ? demoTeams : [],
    athletes: local ? demoAthletes : [],
    picks: [],
    rankings: new Map(demoAthletes.map((athlete, index) => [athlete.id, index + 1])),
    queuedAthleteIds: local ? demoAthletes.slice(2, 5).map((athlete) => athlete.id) : [],
    myTeamId: local ? (demoTeams[0]?.id ?? null) : null,
    loading: !local,
    error: null,
  });

  const reload = useCallback(async () => {
    if (local || !supabase || !user || !draftId) return;
    const client = supabase;
    const draftResult = await client
      .from('drafts')
      .select('id, league_id, status, rounds, current_overall_pick, pick_deadline, team_order')
      .eq('id', draftId)
      .single();
    if (draftResult.error) {
      setState((current) => ({ ...current, loading: false, error: draftResult.error.message }));
      return;
    }
    const draftRow: DraftRow = draftResult.data;
    const leagueResult = await client
      .from('leagues')
      .select('id, name, competition_id')
      .eq('id', draftRow.league_id)
      .single();
    if (leagueResult.error) {
      setState((current) => ({ ...current, loading: false, error: leagueResult.error.message }));
      return;
    }
    const leagueRow: LeagueRow = leagueResult.data;
    const [teamResult, athleteResult, pickResult, rankingResult] = await Promise.all([
      client
        .from('fantasy_teams')
        .select('id, league_id, owner_id, name, draft_position')
        .eq('league_id', draftRow.league_id)
        .order('draft_position'),
      client
        .from('athletes')
        .select('id, competition_id, team_id, display_name, position, jersey_number, status')
        .eq('competition_id', leagueRow.competition_id)
        .eq('status', 'active'),
      client
        .from('draft_picks')
        .select(
          'id, draft_id, fantasy_team_id, athlete_id, overall_pick, round, pick_in_round, source, created_at',
        )
        .eq('draft_id', draftId)
        .order('overall_pick'),
      client
        .from('athlete_rankings')
        .select('athlete_id, rank')
        .eq('competition_id', leagueRow.competition_id)
        .order('rank'),
    ]);
    const teamRows: TeamRow[] = teamResult.data ?? [];
    const myTeam = teamRows.find((team) => team.owner_id === user.id);
    const queueResult = myTeam
      ? await client
          .from('draft_queues')
          .select('athlete_id, priority')
          .eq('draft_id', draftId)
          .eq('fantasy_team_id', myTeam.id)
          .order('priority')
      : { data: [] as QueueRow[], error: null };
    const error =
      teamResult.error ??
      athleteResult.error ??
      pickResult.error ??
      rankingResult.error ??
      queueResult.error;
    if (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
      return;
    }
    const picks = (pickResult.data as PickRow[]).map<DraftPick>((row) => ({
      id: row.id,
      draftId: row.draft_id,
      fantasyTeamId: row.fantasy_team_id,
      athleteId: row.athlete_id,
      overallPick: row.overall_pick,
      round: row.round,
      pickInRound: row.pick_in_round,
      source: row.source,
      createdAt: row.created_at,
    }));
    const teams = teamRows.map<FantasyTeam>((row) => ({
      id: row.id,
      leagueId: row.league_id,
      ownerId: row.owner_id ?? '',
      name: row.name,
      draftPosition: row.draft_position ?? 0,
    }));
    setState({
      draft: {
        id: draftRow.id,
        leagueId: draftRow.league_id,
        status: draftRow.status,
        rounds: draftRow.rounds,
        currentOverallPick: draftRow.current_overall_pick,
        ...(draftRow.pick_deadline ? { pickDeadline: draftRow.pick_deadline } : {}),
        teamIdsInDraftOrder: draftRow.team_order,
        picks,
      },
      leagueName: leagueRow.name,
      teams,
      athletes: (athleteResult.data as AthleteRow[]).map<Athlete>((row) => ({
        id: row.id,
        competitionId: row.competition_id,
        teamId: row.team_id,
        displayName: row.display_name,
        position: row.position,
        ...(row.jersey_number ? { jerseyNumber: row.jersey_number } : {}),
        status: row.status,
      })),
      picks,
      rankings: new Map(
        (rankingResult.data as RankingRow[]).map((row) => [row.athlete_id, row.rank]),
      ),
      queuedAthleteIds: (queueResult.data as QueueRow[]).map((row) => row.athlete_id),
      myTeamId: myTeam?.id ?? null,
      loading: false,
      error: null,
    });
  }, [draftId, local, user]);

  useEffect(() => {
    void reload();
    if (local || !supabase || !draftId) return;
    const client = supabase;
    const channel = client
      .channel(`draft:${draftId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drafts', filter: `id=eq.${draftId}` },
        () => void reload(),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_picks',
          filter: `draft_id=eq.${draftId}`,
        },
        () => void reload(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [draftId, local, reload]);

  return { ...state, reload };
}
