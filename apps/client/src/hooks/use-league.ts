import type { FantasyTeam, League, MatchupResult, StandingsRow } from '@brock-fantasy/domain';
import { useCallback, useEffect, useState } from 'react';

import { demoAthletes, demoLeague, demoMatchup, demoStandings, demoTeams } from '@/data/demo';
import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface LeagueRow {
  id: string;
  competition_id: string;
  commissioner_id: string | null;
  ruleset_id: string;
  name: string;
  format: League['format'];
  status: League['status'];
  max_members: number;
  invite_code: string;
}

interface TeamRow {
  id: string;
  league_id: string;
  owner_id: string | null;
  name: string;
  draft_position: number | null;
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
  slotCode: string;
  status: 'starter' | 'bench' | 'injured_reserve';
}

export interface LeagueChatMessage {
  id: string;
  authorId: string | null;
  author: string;
  body: string;
  createdAt: string;
}

interface DraftRow {
  id: string;
}

interface RosterRow {
  id: string;
  fantasy_team_id: string;
  athlete_id: string;
  slot_code: string;
  status: LeagueRosterEntry['status'];
  athlete:
    | { display_name: string; position: string; jersey_number: string | null }
    | readonly { display_name: string; position: string; jersey_number: string | null }[];
}

interface MatchupRow {
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
  author: { display_name: string } | readonly { display_name: string }[] | null;
}

const demoRoster: readonly LeagueRosterEntry[] = demoAthletes.slice(0, 6).map((athlete, index) => ({
  id: `demo-roster-${athlete.id}`,
  fantasyTeamId: demoTeams[0]?.id ?? '',
  athleteId: athlete.id,
  displayName: athlete.displayName,
  position: athlete.position,
  jerseyNumber: athlete.jerseyNumber ?? null,
  slotCode: index < 4 ? athlete.position : 'BN',
  status: index < 4 ? 'starter' : 'bench',
}));

const demoMessages: readonly LeagueChatMessage[] = [
  {
    id: 'm1',
    authorId: 'team-green',
    author: 'Green Machine',
    body: 'That third-period goal changed everything.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'm2',
    authorId: 'team-power',
    author: 'Power Playmakers',
    body: 'Still time left. Great matchup!',
    createdAt: new Date().toISOString(),
  },
];

export function useLeague(leagueId: string | undefined): LeagueData {
  const { demoMode, user } = useSession();
  const local = demoMode || leagueId === 'demo-league';
  const [data, setData] = useState<Omit<LeagueData, 'reload'>>({
    league: local ? demoLeague : null,
    teams: local ? demoTeams : [],
    standings: local ? demoStandings : [],
    draftId: local ? 'demo-draft' : null,
    myTeamId: local ? (demoTeams[0]?.id ?? null) : null,
    roster: local ? demoRoster : [],
    matchups: local ? [demoMatchup] : [],
    messages: local ? demoMessages : [],
    loading: !local,
    error: null,
  });

  const reload = useCallback(async () => {
    if (local || !supabase || !leagueId || !user) return;
    const client = supabase;
    const [leagueResult, teamResult, standingsResult, draftResult, matchupResult, messageResult] =
      await Promise.all([
        client
          .from('leagues')
          .select(
            'id, competition_id, commissioner_id, ruleset_id, name, format, status, max_members, invite_code',
          )
          .eq('id', leagueId)
          .single(),
        client
          .from('fantasy_teams')
          .select('id, league_id, owner_id, name, draft_position')
          .eq('league_id', leagueId)
          .order('draft_position'),
        client.rpc('get_league_standings', { p_league_id: leagueId }),
        client.from('drafts').select('id').eq('league_id', leagueId).maybeSingle(),
        client
          .from('matchups')
          .select(
            'id, league_id, period, home_team_id, away_team_id, home_points, away_points, status',
          )
          .eq('league_id', leagueId)
          .order('period', { ascending: false }),
        client
          .from('chat_messages')
          .select(
            'id, author_id, body, created_at, author:profiles!chat_messages_author_id_fkey(display_name)',
          )
          .eq('league_id', leagueId)
          .order('created_at')
          .limit(100),
      ]);
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
      commissionerId: row.commissioner_id ?? '',
      rulesetId: row.ruleset_id,
      name: row.name,
      format: row.format,
      status: row.status,
      maxMembers: row.max_members,
      inviteCode: row.invite_code,
    };
    const teamRows: TeamRow[] = teamResult.data ?? [];
    const teams = teamRows.map<FantasyTeam>((team) => ({
      id: team.id,
      leagueId: team.league_id,
      ownerId: team.owner_id ?? '',
      name: team.name,
      draftPosition: team.draft_position ?? 0,
    }));
    const myTeamId = teamRows.find((team) => team.owner_id === user.id)?.id ?? null;
    const rosterResult = myTeamId
      ? await client
          .from('roster_entries')
          .select(
            'id, fantasy_team_id, athlete_id, slot_code, status, athlete:athletes!inner(display_name, position, jersey_number)',
          )
          .eq('fantasy_team_id', myTeamId)
          .is('released_at', null)
      : { data: [] as RosterRow[], error: null };
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
                slotCode: entry.slot_code,
                status: entry.status,
              },
            ]
          : [];
      }),
      matchups: (matchupResult.data as MatchupRow[]).map((matchup) => ({
        id: matchup.id,
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
          body: message.body,
          createdAt: message.created_at,
        };
      }),
      loading: false,
      error: null,
    });
  }, [leagueId, local, user]);

  useEffect(() => {
    void reload();
    if (local || !supabase || !leagueId) return;
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
  }, [leagueId, local, reload]);

  return { ...data, reload };
}

function isDraftRow(value: unknown): value is DraftRow {
  return Boolean(
    value && typeof value === 'object' && 'id' in value && typeof value.id === 'string',
  );
}
