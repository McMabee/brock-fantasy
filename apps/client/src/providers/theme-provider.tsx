import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, palettes, type ThemeMode } from '@/theme';
import { allowsPreferenceStorage, PREFERENCE_MAX_AGE } from '@/lib/cookie-preferences';

interface ThemeContextValue {
  mode: ThemeMode;
  palette: (typeof palettes)[ThemeMode];
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyWebTheme(mode: ThemeMode): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.brockTheme = mode;
  for (const [name, value] of Object.entries(palettes[mode])) {
    root.style.setProperty(
      `--bf-${name.replace(/[A-Z]/gu, (part) => `-${part.toLowerCase()}`)}`,
      value,
    );
  }
  root.style.backgroundColor = palettes[mode].canvas;
  document.body.style.backgroundColor = palettes[mode].canvas;
  if (allowsPreferenceStorage(document.cookie))
    document.cookie = `bf_theme=${mode}; Path=/; SameSite=Lax; Max-Age=${PREFERENCE_MAX_AGE}${location.protocol === 'https:' ? '; Secure' : ''}`;
  else document.cookie = 'bf_theme=; Path=/; SameSite=Lax; Max-Age=0';
}

function initialMode(): ThemeMode {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return 'dark';
  if (allowsPreferenceStorage(document.cookie)) {
    if (document.cookie.split('; ').includes('bf_theme=light')) return 'light';
    if (document.cookie.split('; ').includes('bf_theme=dark')) return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [webReady, setWebReady] = useState(false);
  useLayoutEffect(() => {
    if (Platform.OS === 'web') {
      setMode(initialMode());
      setWebReady(true);
    }
  }, []);
  const [nativeReady, setNativeReady] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void AsyncStorage.getItem('bf_theme')
      .then((saved) => {
        if (active) {
          if (saved === 'light' || saved === 'dark') setMode(saved);
          setNativeReady(true);
        }
      })
      .catch(() => {
        if (active) setNativeReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' && nativeReady)
      void AsyncStorage.setItem('bf_theme', mode).catch(() => {});
  }, [mode, nativeReady]);

  useEffect(() => {
    if (webReady) applyWebTheme(mode);
  }, [mode, webReady]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const changed = () => applyWebTheme(mode);
    window.addEventListener('bf:privacy-change', changed);
    return () => window.removeEventListener('bf:privacy-change', changed);
  }, [mode]);

  const toggleMode = useCallback(
    () => setMode((current) => (current === 'light' ? 'dark' : 'light')),
    [],
  );
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, palette: palettes[mode], setMode, toggleMode }),
    [mode, toggleMode],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = use(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider.');
  return value;
}

export function useThemeColors() {
  const { palette } = useTheme();
  return Platform.OS === 'web' ? colors : palette;
}

export function useThemedStyles<T>(factory: (palette: ReturnType<typeof useThemeColors>) => T): T {
  const palette = useThemeColors();
  return useMemo(() => factory(palette), [factory, palette]);
}
