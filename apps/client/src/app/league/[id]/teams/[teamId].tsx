import { formatFantasyPoints } from '@brock-fantasy/domain';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import {
  ActionButton,
  AppShell,
  Card,
  ErrorState,
  LoadingState,
  useUiStyles,
} from '@/components/ui';
import { LeagueRoster } from '@/components/league-roster';
import { useLeague } from '@/hooks/use-league';
import { useRequireUser } from '@/hooks/use-route-access';

export default function LeagueTeamScreen() {
  useRequireUser();
  const ui = useUiStyles();
  const { id, teamId } = useLocalSearchParams<{ id: string; teamId: string }>();
  const data = useLeague(id, teamId);
  const team = data.teams.find((item) => item.id === teamId);
  const standing = data.standings.find((item) => item.fantasyTeamId === teamId);
  return (
    <AppShell eyebrow={data.league?.name ?? 'League team'} title={team?.name ?? 'Team roster'}>
      {data.loading ? (
        <LoadingState label="Loading team roster" rows={4} />
      ) : data.error || !team ? (
        <ErrorState
          message={data.error ?? 'This team is not available in your league.'}
          onRetry={() => void data.reload()}
        />
      ) : (
        <View style={{ gap: 24 }}>
          <Card style={{ gap: 20 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 36 }}>
              <View style={{ gap: 8 }}>
                <Text style={ui.body}>Fantasy points</Text>
                <Text style={ui.title}>
                  {standing ? formatFantasyPoints(standing.pointsFor) : '0.0'}
                </Text>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={ui.body}>Record · W–L–T</Text>
                <Text style={ui.title}>
                  {standing ? `${standing.wins}–${standing.losses}–${standing.ties}` : '0–0–0'}
                </Text>
              </View>
            </View>
            <Text style={ui.body}>
              Saved roster · starters and reserves are visible to everyone in this league. Only the
              team owner can change their lineup.
            </Text>
          </Card>
          <LeagueRoster
            entries={data.roster}
            poolId={data.league?.playerPoolId}
            editable={false}
            teamName="Complete roster"
            leagueId={id}
            betaLeague={Boolean(data.league?.playerPoolId)}
          />
        </View>
      )}
      <ActionButton
        label="Back to league standings"
        href={`/league/${id}?tab=standings`}
        variant="secondary"
      />
    </AppShell>
  );
}
