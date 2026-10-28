import { AdminTable } from '@/components/admin-ui';
import { DraftPlayerPhoto } from '@/components/player-photo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { AdminAccess } from '@/components/admin-access';
import { AdminLeagueChat } from '@/components/admin-league-chat';
import { LeagueChoices, LeagueFact, LeagueRefresh } from '@/components/admin-league-ui';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  LoadingState,
  useUiStyles,
} from '@/components/ui';
import { VarsityBadge } from '@/components/varsity-badge';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { useSession } from '@/providers/session-provider';
import { adminLeaguePath } from '@/lib/admin-navigation';
import { positionLabel, rosterSlotLabel } from '@/lib/roster-guide';
import {
  adminDate,
  LEAGUE_SECTIONS,
  groupLeagueMatchups,
  LEAGUE_STATUS_LABELS,
  type AdminLeagueSnapshot,
  type AdminLeagueRosterEntry,
  type AdminLeagueMember,
  type AdminLeagueStanding,
  type AdminLeagueMatchup,
} from '@/lib/admin-leagues';

const sectionLabels: Readonly<Record<string, string>> = {
  overview: 'Overview',
  members: 'Members and teams',
  rosters: 'Rosters',
  standings: 'Standings',
  matchups: 'Matchups',
  chat: 'Chat',
};

export default function AdminLeagueDetail() {
  const access = useRequireAdmin();
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();
  const ui = useUiStyles();
  const id = typeof params.id === 'string' ? params.id : '';
  const { readScope } = useSession();
  const [deniedScope, setDeniedScope] = useState<object | null>(null);
  const denied = deniedScope === readScope;
  const section = LEAGUE_SECTIONS.find((value) => value === params.tab) ?? 'overview';
  const enabled = access.allowed && !denied;
  const snapshot = useAdminLeagueRead<AdminLeagueSnapshot>(
    'admin_get_league_section',
    { p_league_id: id, p_section: section },
    enabled,
    60_000,
    () => setDeniedScope(readScope),
  );
  const teams = snapshot.data?.teams;
  const teamId = teams?.find((team) => team.id === params.teamId)?.id ?? teams?.[0]?.id;
  const roster = useAdminLeagueRead<AdminLeagueRosterEntry[]>(
    'admin_get_league_roster',
    { p_league_id: id, p_team_id: teamId },
    enabled && section === 'rosters' && Boolean(teamId),
    60_000,
    () => setDeniedScope(readScope),
  );
  const teamNames = useMemo(
    () => new Map(teams?.map((team) => [team.id, team.name]) ?? []),
    [teams],
  );
  if (!enabled)
    return (
      <AdminAccess
        loading={access.loading}
        error={
          denied
            ? 'Administrator access is no longer available. Sign in and verify MFA again.'
            : access.error
        }
      />
    );
  const league = snapshot.data?.league;
  const directoryParams = { ...params, tab: undefined, teamId: undefined };
  return (
    <AppShell eyebrow="Operations centre" title={league?.name ?? 'League inspection'}>
      <View style={{ gap: 18 }}>
        <ActionButton
          label="Back to league directory"
          href={adminLeaguePath('/admin/leagues', directoryParams)}
          variant="secondary"
        />
        <LeagueChoices
          label="League section"
          choices={LEAGUE_SECTIONS.map((value) => ({ value, label: sectionLabels[value]! }))}
          selected={section}
          onSelect={(tab) => router.setParams({ tab })}
        />
        {section !== 'chat' ? (
          <LeagueRefresh
            {...snapshot}
            refresh={async () => {
              await Promise.all([
                snapshot.refresh(),
                ...(section === 'rosters' ? [roster.refresh()] : []),
              ]);
            }}
          />
        ) : snapshot.error ? (
          <Text accessibilityRole="alert" style={ui.body}>
            {snapshot.error}
          </Text>
        ) : null}
        {snapshot.loading && !snapshot.data ? (
          <LoadingState label="Loading league section" />
        ) : null}
        {league && section === 'overview' ? (
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 22 }}>
            <LeagueFact label="League ID" value={league.id} />
            <LeagueFact label="Season" value={league.season_label} />
            <LeagueFact label="Status" value={LEAGUE_STATUS_LABELS[league.status]} />
            <LeagueFact label="Commissioner" value={league.commissioner} />
            <LeagueFact label="Created" value={adminDate(league.created_at)} />
            <LeagueFact
              label="Team capacity"
              value={`${teams?.length ?? 0}/${league.max_members}`}
            />
            <LeagueFact
              label="Format"
              value={league.format === 'head_to_head' ? 'Head to head' : 'Points leaderboard'}
            />
            <LeagueFact
              label="Roster format"
              value={league.roster_format === 'varsity' ? 'Varsity' : 'Standard'}
            />
            <LeagueFact
              label="Scoring rules"
              value={`${league.ruleset_name} · Version ${league.ruleset_version}`}
            />
            <LeagueFact label="Draft status" value={league.draft_status ?? 'No draft'} />
            <LeagueFact
              label="Draft mode"
              value={
                league.draft_mode === 'scheduled_auto'
                  ? 'Scheduled automatic'
                  : league.draft_mode === 'live'
                    ? 'Live'
                    : 'Not selected'
              }
            />
            <LeagueFact label="Draft scheduled" value={adminDate(league.draft_scheduled_for)} />
            <LeagueFact
              label="Pick duration"
              value={
                league.draft_pick_seconds == null
                  ? 'Not set'
                  : `${league.draft_pick_seconds} seconds`
              }
            />
            {[
              ['Free agents', league.free_agents_enabled],
              ['Waivers', league.waivers_enabled],
              ['Trades', league.trades_enabled],
            ].map(([label, value]) => (
              <LeagueFact
                key={String(label)}
                label={String(label)}
                value={value == null ? 'Not specified' : value ? 'Enabled' : 'Disabled'}
              />
            ))}
          </Card>
        ) : null}
        {snapshot.data && section === 'members' ? (
          <View style={{ gap: 14 }}>
            {!snapshot.data.items.length ? (
              <EmptyState
                title="No members"
                body="No member accounts are available for this league."
              />
            ) : null}
            {(snapshot.data.items as AdminLeagueMember[]).map((member) => (
              <Card key={member.user_id} style={{ gap: 14 }}>
                <View
                  style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
                >
                  <Text accessibilityRole="header" style={ui.title}>
                    {member.display_name}
                  </Text>
                  <VarsityBadge visible={member.is_varsity} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
                  <LeagueFact label="Email" value={member.email} />
                  <LeagueFact label="Account ID" value={member.user_id} />
                  <LeagueFact label="Account status" value={member.account_status} />
                  <LeagueFact
                    label="League role"
                    value={member.role === 'commissioner' ? 'Commissioner' : 'Member'}
                  />
                  <LeagueFact label="Joined" value={adminDate(member.joined_at)} />
                  <LeagueFact label="Team" value={member.team_name ?? 'No team'} />
                </View>
              </Card>
            ))}
            <Card style={{ gap: 12 }}>
              <Text accessibilityRole="header" style={ui.title}>
                All teams
              </Text>
              <AdminTable
                label="All teams"
                columns={[
                  { label: 'Team Name', width: 230 },
                  { label: 'Manager', width: 220 },
                ]}
                rows={(teams ?? []).map((team) => ({
                  id: team.id,
                  cells: [team.name, team.owner_name],
                }))}
              />
            </Card>
          </View>
        ) : null}
        {snapshot.data && section === 'rosters' ? (
          <View style={{ gap: 16 }}>
            {teams?.length ? (
              <LeagueChoices
                label="Team roster"
                choices={teams.map((team) => ({ value: team.id, label: team.name }))}
                selected={teamId ?? ''}
                onSelect={(value) => router.setParams({ teamId: value })}
              />
            ) : (
              <EmptyState title="No teams" body="No teams have been registered in this league." />
            )}
            {roster.loading && !roster.data ? <LoadingState label="Loading roster" /> : null}
            {roster.error ? (
              <Text accessibilityRole="alert" style={ui.body}>
                {roster.error}
              </Text>
            ) : null}
            {roster.data?.length === 0 ? (
              <EmptyState title="Roster is empty" body="This team has no current saved athletes." />
            ) : null}
            {['starter', 'bench', 'injured_reserve'].map((status) => {
              const entries =
                roster.data?.filter((entry) =>
                  status === 'bench'
                    ? !['starter', 'injured_reserve'].includes(entry.status)
                    : entry.status === status,
                ) ?? [];
              if (!entries.length) return null;
              return (
                <Card key={status} style={{ gap: 12 }}>
                  <Text accessibilityRole="header" style={ui.title}>
                    {status === 'starter'
                      ? 'Starters'
                      : status === 'bench'
                        ? 'Bench'
                        : 'Injured reserve'}
                  </Text>
                  <AdminTable
                    label={`${status} roster`}
                    columns={[
                      { label: 'Athlete', width: 250 },
                      { label: 'Program', width: 190 },
                      { label: 'Position', width: 170 },
                      { label: 'Lineup slot', width: 200 },
                    ]}
                    rows={entries.map((entry) => ({
                      id: entry.id,
                      cells: [
                        <View
                          key="athlete"
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        >
                          <DraftPlayerPhoto
                            player={{ displayName: entry.display_name, bio: entry.bio ?? {} }}
                          />
                          <Text style={ui.body}>
                            {entry.display_name}
                            {entry.jersey_number ? ` #${entry.jersey_number}` : ''}
                          </Text>
                        </View>,
                        entry.program_name,
                        positionLabel(entry.position),
                        rosterSlotLabel(entry.slot_code, league?.roster_format === 'varsity'),
                      ],
                    }))}
                  />
                </Card>
              );
            })}
          </View>
        ) : null}
        {snapshot.data && section === 'standings' ? (
          snapshot.data.items.length ? (
            <Card>
              <AdminTable
                label="League standings"
                columns={[
                  'Rank',
                  'Team',
                  'W',
                  'L',
                  'T',
                  'Points for',
                  'Points against',
                  'Standing points',
                ].map((label, index) => ({
                  label,
                  width: index === 1 ? 230 : index === 7 ? 180 : 130,
                }))}
                rows={(snapshot.data.items as AdminLeagueStanding[]).map((row) => ({
                  id: row.fantasy_team_id,
                  cells: [
                    row.rank,
                    teamNames.get(row.fantasy_team_id) ?? 'Unavailable team',
                    row.wins,
                    row.losses,
                    row.ties,
                    row.points_for,
                    row.points_against,
                    row.standing_points,
                  ],
                }))}
              />
            </Card>
          ) : (
            <EmptyState
              title="No standings"
              body="Standings are unavailable until teams and results are recorded."
            />
          )
        ) : null}
        {snapshot.data && section === 'matchups' ? (
          <View style={{ gap: 14 }}>
            {!snapshot.data.items.length ? (
              <EmptyState
                title="No matchups"
                body="No matchup schedule has been saved for this league."
              />
            ) : null}
            {groupLeagueMatchups(snapshot.data.items as AdminLeagueMatchup[]).map(
              ([period, matchups]) => (
                <Card key={period} style={{ gap: 12 }}>
                  <Text accessibilityRole="header" style={ui.title}>
                    Period {period}
                  </Text>
                  <Text style={ui.body}>
                    {adminDate(matchups[0]?.starts_at ?? null)} –{' '}
                    {adminDate(matchups[0]?.ends_at ?? null)}
                  </Text>
                  <AdminTable
                    label={`Period ${period} matchups`}
                    columns={[
                      { label: 'Home team', width: 230 },
                      { label: 'Score', width: 150 },
                      { label: 'Away team', width: 230 },
                      { label: 'Status', width: 150 },
                      { label: 'Stage', width: 150 },
                    ]}
                    rows={matchups.map((matchup) => ({
                      id: matchup.id,
                      cells: [
                        teamNames.get(matchup.home_team_id) ?? 'Unavailable team',
                        `${matchup.home_points} – ${matchup.away_points}`,
                        teamNames.get(matchup.away_team_id) ?? 'Unavailable team',
                        matchup.status.replaceAll('_', ' '),
                        matchup.stage || '—',
                      ],
                    }))}
                  />
                </Card>
              ),
            )}
          </View>
        ) : null}
        {section === 'chat' && snapshot.data ? (
          <AdminLeagueChat
            leagueId={id}
            enabled={enabled}
            onAccessLost={() => setDeniedScope(readScope)}
          />
        ) : null}
      </View>
    </AppShell>
  );
}
