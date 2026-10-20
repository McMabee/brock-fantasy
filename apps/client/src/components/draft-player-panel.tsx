import { useResponsiveDimensions as useWindowDimensions } from '@/hooks/use-responsive-dimensions';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { BETA_SEASON, playerMetrics } from '@brock-fantasy/domain';
import { useEffect, useRef } from 'react';
import { Animated, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, useUiStyles } from './ui';
import type { DraftPlayer } from '@/lib/draft-state';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { adpLabel } from '@/lib/player-adp';
import { InfoButton } from './info-button';
import { router } from 'expo-router';
import { usePlayerInsights } from '@/hooks/use-player-insights';
import { NextGame, PendingConfirmation, projectedPoints } from './player-insights';
import { DraftPlayerPhoto } from './player-photo';

export { DraftPlayerPhoto, playerHeadshot } from './player-photo';
export function DraftPlayerPanel({
  player,
  onClose,
}: {
  player: DraftPlayer | null;
  onClose: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    entrance.setValue(reducedMotion ? 1 : 0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: reducedMotion ? 0 : 250,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [player?.id, reducedMotion, entrance]);
  const metrics = player ? playerMetrics(player.bio, player.summaries, BETA_SEASON) : null;
  return (
    <Modal
      visible={Boolean(player)}
      transparent
      animationType="none"
      accessibilityLabel="Player details"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.backdrop,
          {
            alignItems: desktop ? 'flex-end' : 'stretch',
            justifyContent: desktop ? 'center' : 'flex-end',
            padding: desktop ? 16 : 0,
          },
        ]}
      >
        <Animated.View
          style={{
            width: '100%',
            maxWidth: desktop ? 480 : undefined,
            maxHeight: desktop ? '100%' : '92%',
            opacity: entrance,
            transform: desktop
              ? [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }]
              : [
                  {
                    translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
                  },
                ],
          }}
        >
          <Card style={styles.panel}>
            {player ? (
              <ScrollView contentContainerStyle={{ gap: 14 }}>
                <ActionButton label="Close player details" onPress={onClose} variant="secondary" />
                <DraftPlayerPhoto player={player} size={140} eager />
                <Text accessibilityRole="header" style={styles.name}>
                  {player.displayName}
                </Text>
                <Text style={uiStyles.body}>
                  {player.program}, {player.positions.join('/')}, #{player.jerseyNumber ?? '—'}
                </Text>
                <Text style={uiStyles.body}>Height, {metrics?.heightLabel}</Text>
                <View style={styles.metrics}>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>{BETA_SEASON} PROJECTED FP</Text>
                    <Text style={styles.metricValue}>{metrics?.projectedPoints ?? '—'}</Text>
                    <Text style={uiStyles.body}>
                      {metrics?.projectedGames ?? '—'} projected games
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>AVERAGE DRAFT POSITION</Text>
                    <Text style={styles.metricValue}>
                      {player.adp?.average?.toFixed(1) ?? metrics?.suppliedAdp?.toFixed(1) ?? '—'}
                    </Text>
                    <Text style={uiStyles.body}>{adpLabel(player.adp)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row' }}>
                  <InfoButton topic="projection" />
                  <InfoButton topic="adp" />
                </View>
                {(['eligibility', 'major', 'hometown'] as const).map((key) =>
                  typeof player.bio[key] === 'string' ? (
                    <Text key={key} style={uiStyles.body}>
                      {key === 'eligibility'
                        ? 'Year / eligibility'
                        : key === 'major'
                          ? 'Program of study'
                          : 'Hometown'}
                      : {String(player.bio[key])}
                    </Text>
                  ) : null,
                )}
                <Text style={styles.heading}>Historical statistics</Text>
                {player.summaries
                  .filter((s) => s.kind === 'historical')
                  .map((s, i) => (
                    <View key={i} style={{ gap: 6 }}>
                      <Text style={uiStyles.body}>
                        {s.season_label}: {s.fantasy_points ?? 'Unavailable'} fantasy points ,{' '}
                        {s.games_played ?? 'Unavailable'} games
                      </Text>
                      {Object.entries(s.stats).map(([key, value]) => (
                        <Text key={key} style={uiStyles.body}>
                          {key.replaceAll('_', ' ')}: {value ?? 'Unavailable'}
                        </Text>
                      ))}
                    </View>
                  ))}
                {!player.summaries.some((s) => s.kind === 'historical') ? (
                  <Text style={uiStyles.body}>Historical statistics are unavailable.</Text>
                ) : null}
                <LivePlayerInsights athleteId={player.id} />
                <ActionButton
                  label="Full player profile →"
                  onPress={() => {
                    onClose();
                    router.push(`/players/${player.id}`);
                  }}
                />
              </ScrollView>
            ) : null}
          </Card>
        </Animated.View>
      </View>
    </Modal>
  );
}

function LivePlayerInsights({ athleteId }: { athleteId: string }) {
  const insights = usePlayerInsights(undefined, athleteId);
  const ui = useUiStyles();
  const player = insights.byId.get(athleteId);
  return (
    <View style={{ gap: 10 }}>
      <Text style={ui.body}>Season points: {projectedPoints(player?.seasonPoints)}</Text>
      <Text style={ui.body}>Next-period projection: {projectedPoints(player?.nextProjection)}</Text>
      {player?.pending ? <PendingConfirmation /> : null}
      {player ? <NextGame game={player.nextGame} /> : null}
    </View>
  );
}
const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    panel: { width: '100%', maxHeight: '100%', gap: 14, padding: 24 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metric: {
      flex: 1,
      minWidth: 150,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.canvasSoft,
      gap: 8,
    },
    metricLabel: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
    },
    metricValue: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 32,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    name: { fontFamily: 'Inter', fontSize: 26, fontWeight: '800', color: colors.text },
    heading: { fontFamily: 'Inter', fontSize: 16, fontWeight: '800', color: colors.text },
  });
