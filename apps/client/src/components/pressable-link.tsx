import { Link, type Href } from 'expo-router';
import { forwardRef } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';

import { openPublicAuthEntry } from '@/lib/public-auth-navigation';

// - Keep the press-state style callback outside the router slot's style merging
const LinkSurface = forwardRef<
  View,
  Omit<PressableProps, 'style'> & { pressableStyle: PressableProps['style'] }
>(function LinkSurface({ pressableStyle, ...props }, ref) {
  return <Pressable {...props} ref={ref} style={pressableStyle} />;
});

export function PressableLink({
  href,
  style,
  onPress,
  disabled,
  ...props
}: PressableProps & { href: Href }) {
  const surface = (
    <LinkSurface
      {...props}
      accessibilityRole="link"
      disabled={disabled}
      pressableStyle={style}
      onPress={(event) => {
        onPress?.(event);
        const nativeEvent = event.nativeEvent;
        if (
          ('button' in nativeEvent && nativeEvent.button !== 0) ||
          ('metaKey' in nativeEvent && nativeEvent.metaKey) ||
          ('ctrlKey' in nativeEvent && nativeEvent.ctrlKey) ||
          ('shiftKey' in nativeEvent && nativeEvent.shiftKey) ||
          ('altKey' in nativeEvent && nativeEvent.altKey)
        )
          return;
        if (!event.defaultPrevented && openPublicAuthEntry(href)) event.preventDefault();
      }}
    />
  );
  return disabled ? (
    surface
  ) : (
    <Link href={href} asChild>
      {surface}
    </Link>
  );
}
