import { useEffect, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { useThemeColors } from '@/providers/theme-provider';
import type { DraftPlayer } from '@/lib/draft-state';

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
