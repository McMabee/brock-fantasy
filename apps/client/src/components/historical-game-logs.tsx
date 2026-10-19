import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ActionButton, Card, LoadingState, useUiStyles } from './ui';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { gameTime, projectedPoints } from '@/lib/player-format';

interface HistoricalLog {
  source_game_id: string;
  played_at: string;
  opponent: string;
  phase: string;
  result: string;
  stats: Record<string, number>;
  complete: boolean;
  fantasy_points: number | null;
  missing_stats: string[];
  source_url: string;
  scoring_version: string;
}
export function HistoricalGameLogs({ athleteId }: { athleteId: string }) {
  const { user } = useSession(),
    ui = useUiStyles();
  const [state, setState] = useState<{
      owner: string;
      athlete: string;
      rows: HistoricalLog[];
      error: boolean;
    } | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const owner = user?.id;
    if (owner && supabase)
      void Promise.resolve(supabase.rpc('get_historical_game_logs', { p_athlete_id: athleteId }))
        .then((result) => {
          if (active)
            setState({
              owner,
              athlete: athleteId,
              rows: (result.data ?? []) as HistoricalLog[],
              error: !!result.error,
            });
        })
        .catch(() => {
          if (active) setState({ owner, athlete: athleteId, rows: [], error: true });
        });
    return () => {
      active = false;
    };
  }, [athleteId, user?.id, retry]);
  if (!user || state?.owner !== user.id || state.athlete !== athleteId)
    return <LoadingState label="Loading historical game logs" rows={1} />;
  return (
    <Card style={{ gap: 14, marginTop: 20 }}>
      <Text accessibilityRole="header" style={ui.title}>
        2025–26 Brock game logs
      </Text>
      <Text style={ui.body}>
        Regular-season and playoff appearances · FP under current rules is separate from supplied
        historical totals and never scores active fantasy teams.
      </Text>
      {state.error ? (
        <>
          <Text style={ui.body}>Historical game logs are unavailable.</Text>
          <ActionButton
            label="Retry historical logs"
            onPress={() => setRetry((value) => value + 1)}
            variant="secondary"
          />
        </>
      ) : state.rows.length ? (
        state.rows.map((row) => (
          <View key={row.source_game_id} style={{ gap: 8, paddingVertical: 12 }}>
            <Text style={ui.title}>
              {gameTime(row.played_at)} · {row.opponent}
            </Text>
            <Text style={ui.body}>
              {row.result} · {row.phase === 'playoff' ? 'Playoffs' : 'Regular season'}
            </Text>
            <Text style={ui.body}>
              {Object.entries(row.stats)
                .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`)
                .join(' · ')}
            </Text>
            <Text style={ui.body}>
              FP under current rules:{' '}
              {row.complete ? projectedPoints(row.fantasy_points) : 'Unavailable'}
            </Text>
            {!row.complete ? (
              <Text style={ui.body}>
                Required statistics missing: {row.missing_stats.join(', ').replaceAll('_', ' ')}
              </Text>
            ) : null}
            <Text style={ui.body}>Scoring version: {row.scoring_version}</Text>
            <ActionButton
              label="Official box score"
              variant="secondary"
              onPress={() => {
                if (/^https:\/\/gobadgers\.ca\/sports\//u.test(row.source_url))
                  void Linking.openURL(row.source_url);
              }}
            />
          </View>
        ))
      ) : (
        <Text style={ui.body}>
          No reviewed 2025–26 appearances have been published for this athlete.
        </Text>
      )}
    </Card>
  );
}
