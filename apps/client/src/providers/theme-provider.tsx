import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { palettes, type ThemeMode } from '@/theme';

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
  document.cookie = `bf_theme=${mode}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

function initialMode(): ThemeMode {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return 'light';
  return document.cookie.split('; ').includes('bf_theme=dark') ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  useEffect(() => applyWebTheme(mode), [mode]);

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
