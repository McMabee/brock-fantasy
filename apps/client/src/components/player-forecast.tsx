import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  BETA_PLAYER_POOL_ID,
  gameProjection,
  periodForecast,
  type PlayerForecastSource,
} from '@brock-fantasy/domain';
import { ActionButton, Card, LoadingState, useUiStyles } from './ui';
import { gameTime, projectedPoints } from '@/lib/player-format';
import { InfoButton } from './info-button';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export function PlayerForecastPanel({
  athleteId,
  compact = false,
}: {
  athleteId: string;
  compact?: boolean;
}) {
  const { user } = useSession();
  const [state, setState] = useState<{
    owner: string;
    athlete: string;
    data: PlayerForecastSource | null;
    error: boolean;
  } | null>(null);
  const [selected, setSelected] = useState('');
  const [retry, setRetry] = useState(0);
  const ui = useUiStyles();
  useEffect(() => {
    let active = true;
    if (supabase && user)
      void supabase
        .rpc('get_player_forecast', { p_pool_id: BETA_PLAYER_POOL_ID, p_athlete_id: athleteId })
        .then((result) => {
          if (active)
            setState({
              owner: user.id,
              athlete: athleteId,
              data: result.error ? null : (result.data as PlayerForecastSource),
              error: !!result.error,
            });
        });
    return () => {
      active = false;
    };
  }, [athleteId, user?.id, retry]);
  if (!user || state?.owner !== user.id || state.athlete !== athleteId)
    return <LoadingState label="Loading player forecast" rows={1} />;
  if (state.error || !state.data)
    return (
      <View>
        <Text style={ui.body}>Forecast details are unavailable.</Text>
        <ActionButton
          label="Retry forecast"
          onPress={() => setRetry((value) => value + 1)}
          variant="secondary"
        />
      </View>
    );
  const source = state.data;
  const now = Date.now();
  const period =
    source.periods.find((row) => row.id === selected) ??
    source.periods.find((row) =>
      compact ? Date.parse(row.startsAt) > now : Date.parse(row.endsAt) > now,
    ) ??
    source.periods.at(-1);
  const baseline = gameProjection(source.projectedSeasonPoints, source.projectedGames);
  const result = period ? periodForecast(source, period, now) : null;
  if (compact)
    return (
      <View style={{ gap: 8 }}>
        <Text style={ui.body}>
          Next-game projection:{' '}
          {projectedPoints(
            source.games.some(
              (game) => Date.parse(game.startsAt) > now && game.status === 'scheduled',
            )
              ? baseline
              : null,
          )}
        </Text>
        <Text style={ui.body}>
          Next period{period ? ` · ${period.number}` : ''}: {projectedPoints(result?.total)}
        </Text>
        {result?.schedulePending ? (
          <Text style={ui.body}>⚠ Pending schedule confirmation</Text>
        ) : null}
      </View>
    );
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Game and period forecast
      </Text>
      <InfoButton topic="projection" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {source.periods.map((row) => (
          <ActionButton
            key={row.id}
            label={`Period ${row.number}`}
            variant={period?.id === row.id ? 'primary' : 'secondary'}
            onPress={() => setSelected(row.id)}
          />
        ))}
      </View>
      {period && result ? (
        <>
          <Text style={ui.body}>
            {gameTime(period.startsAt)} – {gameTime(period.endsAt)}
          </Text>
          <Text style={ui.body}>Published points: {projectedPoints(result.earned)}</Text>
          <Text style={ui.body}>
            Upcoming: {projectedPoints(result.upcoming)} · {result.upcomingGames} games
          </Text>
          <Text style={ui.body}>
            Pending game estimates: {projectedPoints(result.pending)} · {result.pendingGames} games
          </Text>
          <Text style={ui.title}>Estimated finish: {projectedPoints(result.total)}</Text>
          <Text style={ui.body}>
            Each game: season projected points ÷ projected games. Started games retain a labeled
            estimate until complete published statistics replace it.
          </Text>
          {result.schedulePending ? (
            <Text style={ui.body}>⚠ Pending schedule confirmation</Text>
          ) : null}
          {source.games
            .filter(
              (game) =>
                Date.parse(game.startsAt) >= Date.parse(period.startsAt) &&
                Date.parse(game.startsAt) < Date.parse(period.endsAt),
            )
            .map((game) => (
              <View key={game.id} style={{ paddingVertical: 10, gap: 4 }}>
                <Text style={ui.body}>
                  {gameTime(game.startsAt)} · {game.opponent} · {game.status}
                </Text>
                <Text style={ui.body}>
                  {['cancelled', 'postponed'].includes(game.status)
                    ? 'Excluded from forecast'
                    : game.complete && game.actualPoints != null
                      ? `Published: ${projectedPoints(game.actualPoints)}`
                      : `${Date.parse(game.startsAt) > now ? 'Projected' : 'Pending estimate'}: ${projectedPoints(baseline)}`}
                </Text>
                {game.pending ? <Text style={ui.body}>⚠ Pending confirmation</Text> : null}
              </View>
            ))}
        </>
      ) : (
        <Text style={ui.body}>No fantasy periods are available.</Text>
      )}
    </Card>
  );
}
