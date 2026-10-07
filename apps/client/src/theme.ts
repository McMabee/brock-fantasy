import type { TextStyle, ViewStyle } from 'react-native';
import { Platform } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export const palettes = {
  light: {
    canvas: '#FFFFFF',
    canvasSoft: '#FFFFFF',
    panel: '#FFFFFF',
    panelStrong: '#1C2D5D',
    border: '#C8C9CB',
    brand: '#1C2D5D',
    brandStrong: '#F20014',
    accent: '#F20014',
    text: '#1C2D5D',
    muted: '#1C2D5D',
    link: '#355A9A',
    danger: '#F20014',
    info: '#1C2D5D',
    white: '#FFFFFF',
    black: '#000000',
    navy: '#1C2D5D',
    red: '#F20014',
    gray: '#C8C9CB',
    topbar: '#FFFFFF',
  },
  dark: {
    canvas: '#000000',
    canvasSoft: '#1C2D5D',
    panel: '#1C2D5D',
    panelStrong: '#F20014',
    border: '#C8C9CB',
    brand: '#F20014',
    brandStrong: '#F20014',
    accent: '#F20014',
    text: '#FFFFFF',
    muted: '#C8C9CB',
    link: '#C8D6FF',
    danger: '#F20014',
    info: '#FFFFFF',
    white: '#FFFFFF',
    black: '#000000',
    navy: '#1C2D5D',
    red: '#F20014',
    gray: '#C8C9CB',
    topbar: '#000000',
  },
} as const;

type ColorToken = keyof (typeof palettes)['light'];

const token = (name: ColorToken): string =>
  Platform.OS === 'web'
    ? `var(--bf-${name.replace(/[A-Z]/gu, (value) => `-${value.toLowerCase()}`)}, ${palettes.light[name]})`
    : palettes.light[name];

// React Native Web resolves CSS custom properties at paint time. That keeps existing
// StyleSheet declarations responsive to the theme toggle without browser token storage.
export const colors = Object.fromEntries(
  (Object.keys(palettes.light) as ColorToken[]).map((name) => [name, token(name)]),
) as { readonly [Name in ColorToken]: string };

export const radii = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

export const shadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.08,
  shadowRadius: 18,
  elevation: 5,
};

export const heading: TextStyle = {
  color: colors.text,
  fontWeight: '800',
  letterSpacing: -0.8,
};
