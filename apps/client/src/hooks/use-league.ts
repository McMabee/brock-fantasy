import type {
  DraftState,
  FantasyTeam,
  League,
  MatchupResult,
  StandingsRow,
} from '@brock-fantasy/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { firstRelated } from '@/lib/relations';
import { LEAGUE_ROSTER_SELECT } from '@/lib/league-roster-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { useActivePoll, useScreenActive } from '@/hooks/use-active-poll';

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
  draft_scheduled_for: string | null;
  draft_schedule_version: number;
  draft_pick_seconds: number | null;
  roster_format: 'standard' | 'varsity';
}

interface TeamRow {
  id: string;
  league_id: string;
  owner_id: string | null;
  name: string;
  draft_position: number | null;
  owner:
    | { display_name: string; is_varsity: boolean }
    | readonly { display_name: string; is_varsity: boolean }[]
    | null;
}

interface StandingRow {
  rank: number;
  fantasy_team_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  standing_points: number;
}

interface LeagueData {
  league: League | null;
  teams: readonly FantasyTeam[];
  standings: readonly StandingsRow[];
  draftId: string | null;
  draftStatus: DraftState['status'] | null;
  myTeamId: string | null;
  roster: readonly LeagueRosterEntry[];
  matchups: readonly MatchupResult[];
  messages: readonly LeagueChatMessage[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export interface LeagueRosterEntry {
  id: string;
  fantasyTeamId: string;
  athleteId: string;
  displayName: string;
  position: string;
  jerseyNumber: string | null;
  bio: Record<string, unknown>;
  programName: string;
  slotCode: string;
  status: 'starter' | 'bench' | 'injured_reserve';
}

export interface LeagueChatMessage {
  id: string;
  authorId: string | null;
  author: string;
  authorIsVarsity?: boolean;
  body: string;
  createdAt: string;
}

interface DraftRow {
  id: string;
  status: DraftState['status'];
}

interface RosterRow {
  id: string;
  fantasy_team_id: string;
  athlete_id: string;
  slot_code: string;
  status: LeagueRosterEntry['status'];
  athlete:
    | {
        display_name: string;
        position: string;
        jersey_number: string | null;
        bio: Record<string, unknown>;
        competition: { name: string } | readonly { name: string }[];
      }
    | readonly {
        display_name: string;
        position: string;
        jersey_number: string | null;
        bio: Record<string, unknown>;
        competition: { name: string } | readonly { name: string }[];
      }[];
}

interface MatchupRow {
  starts_at: string;
  ends_at: string;
  id: string;
  league_id: string;
  period: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
  status: MatchupResult['status'];
}

interface MessageRow {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author:
    | { display_name: string; is_varsity: boolean }
    | readonly { display_name: string; is_varsity: boolean }[]
    | null;
}

export function useLeague(leagueId: string | undefined, rosterTeamId?: string): LeagueData {
  const { user, readScope } = useSession();
  const active = useScreenActive();
  const [data, setData] = useState<Omit<LeagueData, 'reload'>>({
    league: null,
    teams: [],
    standings: [],
    draftId: null,
    draftStatus: null,
    myTeamId: null,
    roster: [],
    matchups: [],
    messages: [],
    loading: true,
    error: null,
  });

  const pending = useRef<Promise<void> | null>(null);
  const identity = useMemo(
    () => ({ readScope, leagueId, rosterTeamId }),
    [readScope, leagueId, rosterTeamId],
  );
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const stateIdentity = useRef(identity);
  useEffect(() => {
    stateIdentity.current = identity;
    pending.current = null;
    setData((current) => ({
      ...current,
      league: null,
      teams: [],
      standings: [],
      draftId: null,
      draftStatus: null,
      myTeamId: null,
      roster: [],
      matchups: [],
      messages: [],
      loading: Boolean(user?.id),
      error: null,
    }));
  }, [identity, user?.id]);
  const load = useCallback(async () => {
    const requestIdentity = identity;
    if (!supabase || !leagueId || !user) {
      setData((current) => ({ ...current, loading: false }));
      return;
    }
    const client = supabase;
    const [leagueResult, teamResult, standingsResult, draftResult, matchupResult, messageResult] =
      await Promise.all([
        client
          .from('leagues')
          .select(
            'id, competition_id, pool_id, commissioner_id, ruleset_id, name, format, status, max_members, invite_code, state_version, draft_scheduled_for, draft_schedule_version, draft_pick_seconds, roster_format',
          )
          .eq('id', leagueId)
          .single(),
        client
          .from('fantasy_teams')
          .select(
            'id, league_id, owner_id, name, draft_position, owner:profiles!fantasy_teams_owner_id_fkey(display_name,is_varsity)',
          )
          .eq('league_id', leagueId)
          .order('draft_position'),
        client.rpc('get_league_standings', { p_league_id: leagueId }),
        // - Exclude archived drafts so a reset still resolves to one current draft
        client
          .from('drafts')
          .select('id, status')
          .eq('league_id', leagueId)
          .is('voided_at', null)
          .maybeSingle(),
        client
          .from('matchups')
          .select(
            'id, league_id, period, home_team_id, away_team_id, home_points, away_points, status, starts_at, ends_at',
          )
          .eq('league_id', leagueId)
          .order('period', { ascending: false }),
        client
          .from('chat_messages')
          .select(
            'id, author_id, body, created_at, author:profiles!chat_messages_author_id_fkey(display_name,is_varsity)',
          )
          .eq('league_id', leagueId)
          .order('created_at')
          .limit(100),
      ]);
    if (requestIdentity !== latestIdentity.current) return;
    const error =
      leagueResult.error ??
      teamResult.error ??
      standingsResult.error ??
      draftResult.error ??
      matchupResult.error ??
      messageResult.error;
    if (error) {
      setData((current) => ({ ...current, loading: false, error: error.message }));
      return;
    }
    if (!leagueResult.data) {
      setData((current) => ({ ...current, loading: false, error: 'League not found.' }));
      return;
    }
    const row: LeagueRow = leagueResult.data;
    const league: League = {
      id: row.id,
      competitionId: row.competition_id,
      ...(row.pool_id ? { playerPoolId: row.pool_id } : {}),
      commissionerId: row.commissioner_id ?? '',
      rulesetId: row.ruleset_id,
      name: row.name,
      format: row.format,
      rosterFormat: row.roster_format,
      status: row.status,
      maxMembers: row.max_members,
      inviteCode: row.invite_code,
      stateVersion: row.state_version,
      ...(row.draft_scheduled_for ? { draftScheduledFor: row.draft_scheduled_for } : {}),
      draftScheduleVersion: row.draft_schedule_version,
      ...(row.draft_pick_seconds != null ? { draftPickSeconds: row.draft_pick_seconds } : {}),
    };
    const teamRows: TeamRow[] = teamResult.data ?? [];
    const teams = teamRows.map<FantasyTeam>((team) => ({
      id: team.id,
      leagueId: team.league_id,
      ownerId: team.owner_id ?? '',
      name: team.name,
      draftPosition: team.draft_position ?? 0,
      ownerIsVarsity: firstRelated(team.owner)?.is_varsity ?? false,
      ownerName: firstRelated(team.owner)?.display_name ?? 'League member',
    }));
    const myTeamId = teamRows.find((team) => team.owner_id === user.id)?.id ?? null;
    const viewedTeamId =
      rosterTeamId && teamRows.some((team) => team.id === rosterTeamId) ? rosterTeamId : myTeamId;
    const rosterResult = viewedTeamId
      ? await client
          .from('roster_entries')
          .select(LEAGUE_ROSTER_SELECT)
          .eq('fantasy_team_id', viewedTeamId)
          .is('released_at', null)
      : { data: [] as RosterRow[], error: null };
    if (requestIdentity !== latestIdentity.current) return;
    if (rosterResult.error) {
      setData((current) => ({ ...current, loading: false, error: rosterResult.error.message }));
      return;
    }
    const standings = (standingsResult.data as StandingRow[]).map<StandingsRow>((standing) => ({
      rank: standing.rank,
      fantasyTeamId: standing.fantasy_team_id,
      wins: standing.wins,
      losses: standing.losses,
      ties: standing.ties,
      pointsFor: standing.points_for,
      pointsAgainst: standing.points_against,
      standingPoints: standing.standing_points,
    }));
    const draftRow = isDraftRow(draftResult.data) ? draftResult.data : null;
    setData({
      league,
      teams,
      standings,
      draftId: draftRow?.id ?? null,
      draftStatus: draftRow?.status ?? null,
      myTeamId,
      roster: (rosterResult.data as unknown as RosterRow[]).flatMap((entry) => {
        const athlete = firstRelated(entry.athlete);
        return athlete
          ? [
              {
                id: entry.id,
                fantasyTeamId: entry.fantasy_team_id,
                athleteId: entry.athlete_id,
                displayName: athlete.display_name,
                position: athlete.position,
                jerseyNumber: athlete.jersey_number,
                bio: athlete.bio,
                programName: firstRelated(athlete.competition)?.name ?? 'Brock athlete',
                slotCode: entry.slot_code,
                status: entry.status,
              },
            ]
          : [];
      }),
      matchups: (matchupResult.data as MatchupRow[]).map((matchup) => ({
        id: matchup.id,
        ...(matchup.starts_at ? { startsAt: matchup.starts_at, endsAt: matchup.ends_at } : {}),
        leagueId: matchup.league_id,
        period: matchup.period,
        homeTeamId: matchup.home_team_id,
        awayTeamId: matchup.away_team_id,
        homePoints: matchup.home_points,
        awayPoints: matchup.away_points,
        status: matchup.status,
      })),
      messages: (messageResult.data as unknown as MessageRow[]).map((message) => {
        const author = message.author ? firstRelated(message.author) : undefined;
        return {
          id: message.id,
          authorId: message.author_id,
          author: author?.display_name ?? 'Deleted manager',
          authorIsVarsity: author?.is_varsity ?? false,
          body: message.body,
          createdAt: message.created_at,
        };
      }),
      loading: false,
      error: null,
    });
  }, [identity, leagueId, user, rosterTeamId]);

  const reload = useCallback(() => {
    if (pending.current) return pending.current;
    const request = load().catch(() => {
      if (latestIdentity.current === identity)
        setData((current) => ({ ...current, loading: false, error: 'League is reconnecting…' }));
    });
    pending.current = request;
    void request.finally(() => {
      if (pending.current === request) pending.current = null;
    });
    return request;
  }, [identity, load]);
  useActivePoll(reload, active && Boolean(user?.id && leagueId) && Platform.OS === 'web', 5000);
  useEffect(() => {
    if (!active || !supabase || !leagueId || !user?.id || Platform.OS === 'web') return;
    void reload();
    const client = supabase;
    const channel = client
      .channel(`league:${leagueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matchups', filter: `league_id=eq.${leagueId}` },
        () => void reload(),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `league_id=eq.${leagueId}`,
        },
        () => void reload(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'roster_entries',
          filter: `league_id=eq.${leagueId}`,
        },
        () => void reload(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [active, leagueId, reload, user?.id]);

  return {
    ...(stateIdentity.current === identity
      ? data
      : {
          league: null,
          teams: [],
          standings: [],
          draftId: null,
          draftStatus: null,
          myTeamId: null,
          roster: [],
          matchups: [],
          messages: [],
          loading: Boolean(user?.id),
          error: null,
        }),
    reload,
  };
}

function isDraftRow(value: unknown): value is DraftRow {
  return Boolean(
    value && typeof value === 'object' && 'id' in value && typeof value.id === 'string',
  );
}
