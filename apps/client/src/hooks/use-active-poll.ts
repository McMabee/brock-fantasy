import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Platform } from 'react-native';
import { startActivePoll } from '@/lib/active-poll';

function appIsActive(): boolean {
  return Platform.OS === 'web'
    ? typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        document.hasFocus()
    : AppState.currentState === null || AppState.currentState === 'active';
}
function subscribe(listener: () => void): () => void {
  if (Platform.OS !== 'web') {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  }
  document.addEventListener('visibilitychange', listener);
  window.addEventListener('focus', listener);
  window.addEventListener('blur', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener);
    window.removeEventListener('focus', listener);
    window.removeEventListener('blur', listener);
  };
}
const serverIsActive = () => false;
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, appIsActive, serverIsActive);
}
export function useScreenActive(): boolean {
  const active = useAppActive();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return active && focused;
}
export function useActivePoll(
  run: () => Promise<unknown>,
  enabled: boolean,
  delay: number | (() => number),
  shouldContinue?: () => boolean,
): void {
  useEffect(() => {
    if (enabled) return startActivePoll(run, delay, shouldContinue);
  }, [delay, enabled, run, shouldContinue]);
}
