import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

export const schoolColors = {
  navy: '#1C2D5D',
  red: '#F20014',
  white: '#FFFFFF',
  grey: '#C8C9CB',
  black: '#000000',
} as const;

export const lightColors = {
  canvas: schoolColors.white,
  canvasSoft: '#F3F3F4',
  panel: schoolColors.white,
  panelStrong: '#E9ECF3',
  border: schoolColors.grey,
  brand: schoolColors.navy,
  brandStrong: '#132044',
  accent: schoolColors.red,
  text: schoolColors.black,
  muted: '#51545B',
  danger: '#B0000F',
  info: schoolColors.navy,
  white: schoolColors.white,
  black: schoolColors.black,
  onBrand: schoolColors.white,
  brandMark: schoolColors.red,
  topbar: schoolColors.navy,
  topbarBorder: schoolColors.red,
  topbarText: schoolColors.white,
  topbarMuted: schoolColors.grey,
  orbPrimary: schoolColors.grey,
  orbSecondary: schoolColors.red,
  selected: '#E9ECF3',
  positiveSurface: '#DDE6DF',
  warningSurface: '#F4E5CF',
  infoSurface: '#DDE3F0',
  dangerSurface: '#F6DFE1',
  dangerBorder: '#C45A63',
  dangerText: '#7D111A',
} as const;

export const darkColors = {
  canvas: schoolColors.black,
  canvasSoft: '#0D1322',
  panel: '#111A30',
  panelStrong: schoolColors.navy,
  border: '#4B587D',
  brand: schoolColors.red,
  brandStrong: '#C90011',
  accent: schoolColors.grey,
  text: schoolColors.white,
  muted: schoolColors.grey,
  danger: '#FF5B68',
  info: '#AEBCE0',
  white: schoolColors.white,
  black: schoolColors.black,
  onBrand: schoolColors.white,
  brandMark: schoolColors.red,
  topbar: schoolColors.black,
  topbarBorder: schoolColors.navy,
  topbarText: schoolColors.white,
  topbarMuted: schoolColors.grey,
  orbPrimary: schoolColors.navy,
  orbSecondary: schoolColors.red,
  selected: '#202E51',
  positiveSurface: '#173B2A',
  warningSurface: '#4A381F',
  infoSurface: '#1C2D5D',
  dangerSurface: '#421A22',
  dangerBorder: '#8F3D49',
  dangerText: '#FFB8BF',
} as const;

export type ThemeMode = 'light' | 'dark';
export type ThemeColors = {
  [Key in keyof typeof darkColors]: string;
};

type AppThemeContextValue = {
  colors: ThemeColors;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const THEME_STORAGE_KEY = 'brock-fantasy.theme-mode';
const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setStoredMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    void AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((storedMode) => {
        if (storedMode === 'light' || storedMode === 'dark') setStoredMode(storedMode);
      })
      .catch(() => undefined);
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setStoredMode(nextMode);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode).catch(() => undefined);
  }, []);

  const toggleMode = useCallback(() => {
    setStoredMode((currentMode) => {
      const nextMode = currentMode === 'dark' ? 'light' : 'dark';
      void AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode).catch(() => undefined);
      return nextMode;
    });
  }, []);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      colors: mode === 'dark' ? darkColors : lightColors,
      mode,
      isDark: mode === 'dark',
      setMode,
      toggleMode,
    }),
    [mode, setMode, toggleMode],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(AppThemeContext);
  if (!value) throw new Error('useAppTheme must be used within AppThemeProvider.');
  return value;
}

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  createStyles: (colors: ThemeColors) => T,
) {
  const { colors } = useAppTheme();
  return useMemo(() => createStyles(colors), [colors, createStyles]);
}

export const radii = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

export function createShadow(colors: ThemeColors): ViewStyle {
  return {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 5,
  };
}

export function createHeading(colors: ThemeColors): TextStyle {
  return {
    color: colors.text,
    fontWeight: '800',
    letterSpacing: -0.8,
  };
}
