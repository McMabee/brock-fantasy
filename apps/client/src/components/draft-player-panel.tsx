import { BETA_SEASON } from '@brock-fantasy/domain';
import { useEffect, useState } from 'react';
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, uiStyles } from './ui';
import type { DraftPlayer } from '@/lib/draft-state';
import { colors } from '@/theme';

export function playerHeadshot(player: DraftPlayer): string | null {
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
  player: DraftPlayer;
  size?: number;
  eager?: boolean;
}) {
  const original = playerHeadshot(player);
  const source = original
    ? (() => {
        const url = new URL(original);
        url.searchParams.set('width', String(size * 2));
        return url.href;
      })()
    : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return source && !failed ? (
    Platform.OS === 'web' ? (
      <img
        alt={player.displayName + ' headshot'}
        src={source}
        width={size}
        height={size}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover' }}
      />
    ) : (
      <Image
        accessibilityLabel={player.displayName + ' headshot'}
        source={{ uri: source }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: 8 }}
      />
    )
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        backgroundColor: colors.canvasSoft,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '800' }}>
        {player.displayName
          .split(' ')
          .map((v) => v[0])
          .join('')
          .slice(0, 3)}
      </Text>
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
  return (
    <Modal visible={Boolean(player)} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
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
              <Text style={styles.heading}>Season projections</Text>
              {player.summaries
                .filter((s) => s.kind === 'supplied_projection' && s.season_label === BETA_SEASON)
                .map((s, i) => (
                  <Text key={i} style={uiStyles.body}>
                    {s.fantasy_points ?? 'Unavailable'} fantasy points ·{' '}
                    {s.games_played ?? 'Unavailable'} games
                  </Text>
                ))}
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
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  panel: { width: '100%', maxWidth: 560, maxHeight: '90%', gap: 14 },
  name: { fontSize: 26, fontWeight: '800', color: colors.text },
  heading: { fontSize: 16, fontWeight: '800', color: colors.text },
});
