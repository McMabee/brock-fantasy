import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { formatFantasyPoints } from '@brock-fantasy/domain';
import { ActionButton, AppShell, Card, LoadingState, useUiStyles } from '@/components/ui';
import { useLeague } from '@/hooks/use-league';
import { useRequireUser } from '@/hooks/use-route-access';
import { useResponsiveDimensions } from '@/hooks/use-responsive-dimensions';
import { supabase } from '@/lib/supabase';
import { selectMyMatchup } from '@/lib/matchup-selection';
import { gameTime } from '@/lib/player-format';
import { rosterSlotLabel } from '@/lib/roster-guide';

interface Detail {
  teams: {
    id: string;
    name: string;
    roster: { athlete_id: string; name: string; slot: string; status: string }[];
    contributors: { athlete_id: string; name: string; points: number; games: number }[];
  }[];
}
export default function MatchupsScreen() {
  useRequireUser();
  const { leagueId, matchupId } = useLocalSearchParams<{ leagueId: string; matchupId?: string }>();
  const data = useLeague(leagueId);
  const [selected, setSelected] = useState(matchupId ?? '');
  const [state, setState] = useState<{ id: string; detail: Detail | null; error: string | null }>({
    id: '',
    detail: null,
    error: null,
  });
  const current =
    data.matchups.find((row) => row.id === selected) ??
    selectMyMatchup(data.matchups, data.myTeamId);
  const { width } = useResponsiveDimensions();
  const ui = useUiStyles();
  useEffect(() => {
    let active = true;
    if (current && supabase)
      void supabase
        .rpc('get_matchup_detail', { p_league_id: leagueId, p_matchup_id: current.id })
        .then((result) => {
          if (active)
            setState({
              id: current.id,
              detail: result.error ? null : (result.data as Detail),
              error: result.error?.message ?? null,
            });
        });
    return () => {
      active = false;
    };
  }, [
    current?.id,
    current?.homePoints,
    current?.awayPoints,
    current?.status,
    leagueId,
    data.league?.stateVersion,
  ]);
  const names = new Map(data.teams.map((team) => [team.id, team.name]));
  return (
    <AppShell title="Matchups">
      <ActionButton label="Back to league" href={`/league/${leagueId}`} variant="secondary" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 16 }}>
        {[...data.matchups]
          .sort((a, b) => a.period - b.period)
          .map((row) => (
            <ActionButton
              key={row.id}
              label={`Period ${row.period}: ${names.get(row.homeTeamId)} vs ${names.get(row.awayTeamId)}`}
              variant={current?.id === row.id ? 'primary' : 'secondary'}
              onPress={() => setSelected(row.id)}
            />
          ))}
      </View>
      {!current ? (
        <Text style={ui.body}>No matchups have been scheduled.</Text>
      ) : (
        <>
          <Card>
            <Text accessibilityRole="header" style={ui.title}>
              Period {current.period} · {current.status}
            </Text>
            {current.startsAt && current.endsAt ? (
              <Text style={ui.body}>
                {gameTime(current.startsAt)} – {gameTime(current.endsAt)}
              </Text>
            ) : null}
            <Text style={ui.body}>
              {names.get(current.homeTeamId)} {formatFantasyPoints(current.homePoints)} —{' '}
              {formatFantasyPoints(current.awayPoints)} {names.get(current.awayTeamId)}
            </Text>
          </Card>
          {state.id !== current.id ? (
            <LoadingState label="Loading matchup" />
          ) : state.error ? (
            <Text accessibilityRole="alert" style={ui.body}>
              {state.error}
            </Text>
          ) : (
            <View
              style={{ flexDirection: width >= 900 ? 'row' : 'column', gap: 16, marginTop: 16 }}
            >
              {state.detail?.teams.map((team) => (
                <Card
                  key={team.id}
                  style={{ ...(width >= 900 ? { flex: 1, minWidth: 0 } : {}), gap: 12 }}
                >
                  <Text style={ui.title}>{team.name}</Text>
                  <Text style={ui.label}>Earned contributions this period</Text>
                  {team.contributors.length ? (
                    team.contributors.map((row) => (
                      <View key={row.athlete_id}>
                        <ActionButton
                          label={row.name}
                          href={{
                            pathname: '/players/[id]',
                            params: { id: row.athlete_id, leagueId },
                          }}
                          variant="ghost"
                        />
                        <Text style={ui.body}>
                          {formatFantasyPoints(row.points)} pts · {row.games} scoring games
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={ui.body}>No published scoring contributions yet.</Text>
                  )}
                  <Text style={ui.body}>
                    Earned points follow game-start lineups and ownership history, including
                    athletes later traded or dropped.
                  </Text>
                  {['starter', 'bench'].map((status) => (
                    <View key={status} style={{ gap: 8 }}>
                      <Text style={ui.label}>
                        Current saved{' '}
                        {status === 'starter' ? 'starters' : 'bench · bench games do not score'}
                      </Text>
                      {team.roster
                        .filter((row) => row.status === status)
                        .map((row) => (
                          <View key={row.athlete_id}>
                            <ActionButton
                              label={row.name}
                              href={{
                                pathname: '/players/[id]',
                                params: { id: row.athlete_id, leagueId },
                              }}
                              variant="ghost"
                            />
                            <Text style={ui.body}>
                              {rosterSlotLabel(row.slot, data.league?.rosterFormat === 'varsity')}
                            </Text>
                          </View>
                        ))}
                    </View>
                  ))}
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </AppShell>
  );
}
