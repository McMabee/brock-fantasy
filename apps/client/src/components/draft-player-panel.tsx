import { useResponsiveDimensions as useWindowDimensions } from '@/hooks/use-responsive-dimensions';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { BETA_SEASON, playerMetrics } from '@brock-fantasy/domain';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, useUiStyles } from './ui';
import type { DraftPlayer } from '@/lib/draft-state';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { adpLabel } from '@/lib/player-adp';
import { RulesLink } from './rules-link';

export function playerHeadshot(player: Pick<DraftPlayer, 'bio'>): string | null {
  const item = player.bio.headshot;
  if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string')
    return null;
  try {
    const url = new URL(item.url);
    return url.protocol === 'https:' &&
      url.hostname === 'gobadgers.ca' &&
      url.pathname.startsWith('/images/')
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function DraftPlayerPhoto({
  player,
  size = 42,
  eager = false,
}: {
  player: Pick<DraftPlayer, 'bio' | 'displayName'>;
  size?: number;
  eager?: boolean;
}) {
  const colors = useThemeColors();
  const original = playerHeadshot(player);
  const source = original
    ? (() => {
        const url = new URL(original);
        url.searchParams.set('width', String(size * 2));
        return url.href;
      })()
    : null;
  const [failed, setFailed] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  useEffect(() => setFailed(false), [source]);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: colors.canvasSoft,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Text
        accessible={false}
        style={{
          color: colors.muted,
          fontFamily: 'Inter',
          fontSize: Math.max(12, size / 4),
          fontWeight: '700',
        }}
      >
        {player.displayName
          .split(' ')
          .map((value) => value[0])
          .join('')
          .slice(0, 2)}
      </Text>
      {source && !failed ? (
        Platform.OS === 'web' ? (
          <img
            alt={player.displayName + ' headshot'}
            src={source}
            width={size}
            height={size}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setFailed(true)}
            onLoad={() => setLoadedSource(source)}
            style={{
              position: 'absolute',
              inset: 0,
              width: size,
              height: size,
              objectFit: 'cover',
              opacity: loadedSource === source ? 1 : 0,
              transition: 'opacity 200ms ease',
            }}
          />
        ) : (
          <Image
            accessibilityLabel={player.displayName + ' headshot'}
            source={{ uri: source }}
            onError={() => setFailed(true)}
            onLoad={() => setLoadedSource(source)}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              opacity: loadedSource === source ? 1 : 0,
            }}
          />
        )
      ) : null}
    </View>
  );
}
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
    <Modal visible={Boolean(player)} transparent animationType="none" onRequestClose={onClose}>
      <View
        accessibilityViewIsModal
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
                  {player.program} · {player.positions.join('/')} · #{player.jerseyNumber ?? '—'}
                </Text>
                <Text style={uiStyles.body}>Height · {metrics?.heightLabel}</Text>
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
                    <Text style={uiStyles.body}>
                      Supplied ADP: {player.adp?.base ?? metrics?.suppliedAdp ?? '—'}
                    </Text>
                  </View>
                </View>
                <RulesLink section="stats" label="How projected points and ADP work" />
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
                        {s.season_label}: {s.fantasy_points ?? 'Unavailable'} fantasy points ·{' '}
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
              </ScrollView>
            ) : null}
          </Card>
        </Animated.View>
      </View>
    </Modal>
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
