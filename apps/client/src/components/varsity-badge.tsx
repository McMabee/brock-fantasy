import { Image, View } from 'react-native';
import badger from '../../assets/varsity-badger.png';

export function VarsityBadge({
  visible,
  size = 26,
}: {
  visible: boolean | undefined;
  size?: number;
}) {
  if (!visible) return null;
  return (
    <View
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 6,
        backgroundColor: '#FFFFFF',
        padding: 2,
      }}
    >
      <Image
        source={badger}
        accessibilityLabel="Brock varsity participant"
        resizeMode="contain"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}
