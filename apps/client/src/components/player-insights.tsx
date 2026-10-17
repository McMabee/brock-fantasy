import { formatFantasyPoints, playerMetrics } from '@brock-fantasy/domain';
import { Animated, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { ActionButton, Card, LoadingState, Pill, useUiStyles } from './ui';
import { DraftPlayerPhoto } from './player-photo';
import { positionLabel } from '@/lib/roster-guide';
import { programNames } from '@/lib/player-program';
import type { InsightGame, PlayerInsight } from '@/hooks/use-player-insights';
import { useThemeColors } from '@/providers/theme-provider';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { motion } from '@/theme';

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
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!athleteId) return;
    entrance.setValue(reducedMotion ? 1 : 0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: reducedMotion ? 0 : motion.panel,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [athleteId, reducedMotion, entrance]);
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
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss athlete insights"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <Animated.View
          nativeID="athlete-insights-panel"
          style={{
            width: '100%',
            maxWidth: 640,
            maxHeight: '94%',
            opacity: entrance,
            transform: [
              { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          }}
        >
          <Card style={{ width: '100%', maxHeight: '100%', flexShrink: 1 }}>
            <Pressable
              ref={close}
              accessibilityRole="button"
              accessibilityLabel="Close athlete insights"
              onPress={onClose}
              style={{ padding: 12, alignSelf: 'flex-end' }}
            >
              <Text style={ui.body}>Close ✕</Text>
            </Pressable>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 16, paddingBottom: 12 }}
            >
              {player ? (
                <>
                  <DraftPlayerPhoto player={player} size={96} eager />
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
                  <Text style={[ui.body, { fontWeight: '700' }]}>Published season statistics</Text>
                  {Object.keys(player.seasonStats ?? {}).length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                      {Object.entries(player.seasonStats ?? {}).map(([key, value]) => (
                        <View
                          key={key}
                          style={{
                            minWidth: 120,
                            flexGrow: 1,
                            padding: 12,
                            borderRadius: 10,
                            backgroundColor: colors.canvasSoft,
                          }}
                        >
                          <Text style={ui.body}>{key.replaceAll('_', ' ')}</Text>
                          <Text style={[ui.body, { fontSize: 20, fontWeight: '700' }]}>
                            {value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={ui.body}>
                      No game statistics have been published for this season yet.
                    </Text>
                  )}
                  <Text style={ui.body}>
                    Average draft position: {player.adp?.toFixed(1) ?? 'Unavailable'}
                  </Text>
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
        </Animated.View>
      </View>
    </Modal>
  );
}
