import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useResponsiveDimensions() {
  const dimensions = useWindowDimensions();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // Match the exported HTML for the hydration render, then use live dimensions.
  return Platform.OS === 'web' && !hydrated
    ? { width: 0, height: 844, scale: 1, fontScale: 1 }
    : dimensions;
}
