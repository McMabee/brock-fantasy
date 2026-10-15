import { formatFantasyPoints, playerMetrics } from '@brock-fantasy/domain';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { ActionButton, Card, LoadingState, Pill, useUiStyles } from './ui';
import { DraftPlayerPhoto } from './player-photo';
import { positionLabel } from '@/lib/roster-guide';
import { programNames } from '@/lib/player-program';
import type { InsightGame, PlayerInsight } from '@/hooks/use-player-insights';
import { useThemeColors } from '@/providers/theme-provider';

export function projectedPoints(value: number | null | undefined): string {
  return value == null ? 'Unavailable' : `${formatFantasyPoints(value)} pts`;
}
export function gameTime(value: string): string {
  return new Date(value).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
export function PendingConfirmation() {
  return <Pill label="⚠ Pending confirmation" tone="warning" />;
}
export function NextGame({ game }: { game: InsightGame | null }) {
  const ui = useUiStyles();
  return game ? (
    <View style={{ gap: 6 }}>
      <Text style={ui.body}>
        {game.neutral ? 'Neutral · vs' : game.home ? 'vs' : '@'} {game.opponent} ·{' '}
        {gameTime(game.starts_at)}
      </Text>
      {!game.schedule_confirmed ? <PendingConfirmation /> : null}
    </View>
  ) : (
    <Text style={ui.body}>No upcoming scheduled game</Text>
  );
}
export function PlayerInsightsPanel({
  athleteId,
  player,
  loading,
  error,
  onClose,
}: {
  athleteId: string | null;
  player: PlayerInsight | undefined;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const ui = useUiStyles();
  const colors = useThemeColors();
  const close = useRef<View>(null);
  const metrics = player ? playerMetrics(player.bio, [], '') : null;
  useEffect(() => {
    if (!athleteId) return;
    // - Focus the dialog entry after it mounts and retain platform keyboard behavior
    const frame = requestAnimationFrame(() => {
      (close.current as unknown as { focus?: () => void } | null)?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [athleteId]);
  return (
    <Modal
      visible={Boolean(athleteId)}
      transparent
      animationType="none"
      accessibilityLabel="Athlete insights"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: '#0009',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: 12,
        }}
      >
        <Card style={{ width: '100%', maxWidth: 480, maxHeight: '94%' }}>
          <Pressable
            ref={close}
            accessibilityRole="button"
            accessibilityLabel="Close athlete insights"
            onPress={onClose}
            style={{ padding: 12, alignSelf: 'flex-end' }}
          >
            <Text style={ui.body}>Close ✕</Text>
          </Pressable>
          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 12 }}>
            {player ? (
              <>
                <DraftPlayerPhoto player={player} size={72} />
                <Text
                  accessibilityRole="header"
                  style={[ui.body, { fontSize: 24, fontWeight: '700' }]}
                >
                  {player.displayName}
                </Text>
                <Text style={ui.body}>
                  {programNames[player.program] ?? player.program.replaceAll('_', ' ')} ·{' '}
                  {player.team}
                </Text>
                <Text style={ui.body}>{player.positions.map(positionLabel).join(' / ')}</Text>
                <Text style={ui.body}>
                  Jersey: {player.jerseyNumber ?? 'Unavailable'} · Height:{' '}
                  {metrics?.heightLabel ?? 'Unavailable'}
                </Text>
                {(['eligibility', 'major', 'hometown'] as const).map((key) =>
                  typeof player.bio[key] === 'string' ? (
                    <Text key={key} style={ui.body}>
                      {key === 'major'
                        ? 'Program of study'
                        : key === 'eligibility'
                          ? 'Year / eligibility'
                          : 'Hometown'}
                      : {String(player.bio[key])}
                    </Text>
                  ) : null,
                )}
                <Text style={ui.body}>Season points: {projectedPoints(player.seasonPoints)}</Text>
                <Text style={ui.body}>
                  Season projection: {projectedPoints(player.seasonProjection)}
                </Text>
                <Text style={ui.body}>
                  Next-period projection: {projectedPoints(player.nextProjection)}
                </Text>
                {player.period ? (
                  <Text style={ui.body}>
                    Period {player.period.number} · {gameTime(player.period.startsAt)} –{' '}
                    {gameTime(player.period.endsAt)} · {player.scheduledGames} scheduled games
                  </Text>
                ) : null}
                <Text style={ui.body}>
                  Estimate: supplied season points ÷ projected games × scheduled games in the next
                  fantasy period
                </Text>
                {player.pending ? <PendingConfirmation /> : null}
                <Text style={[ui.body, { fontWeight: '700' }]}>Next upcoming game</Text>
                <NextGame game={player.nextGame} />
                <ActionButton
                  label="Full player profile →"
                  onPress={() => {
                    onClose();
                    router.push(`/players/${player.id}`);
                  }}
                />
              </>
            ) : loading ? (
              <LoadingState label="Loading athlete insights" rows={3} />
            ) : (
              <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                {error ?? 'This athlete is unavailable.'}
              </Text>
            )}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}
