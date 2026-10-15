import type { TextStyle, ViewStyle } from 'react-native';
import { Platform } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export const palettes = {
  light: {
    canvas: '#FFFFFF',
    canvasSoft: '#F5F6F9',
    panel: '#FFFFFF',
    panelStrong: '#1C2D5D',
    border: '#D8DBE3',
    brand: '#1C2D5D',
    brandStrong: '#F20014',
    accent: '#F20014',
    text: '#1C2D5D',
    muted: '#53607B',
    link: '#355A9A',
    danger: '#AF0010',
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
    canvasSoft: '#0C1224',
    panel: '#101A33',
    panelStrong: '#1C2D5D',
    border: '#33405B',
    brand: '#F20014',
    brandStrong: '#F20014',
    accent: '#F20014',
    text: '#FFFFFF',
    muted: '#C8C9CB',
    link: '#C8D6FF',
    danger: '#FF6977',
    info: '#FFFFFF',
    white: '#FFFFFF',
    black: '#000000',
    navy: '#1C2D5D',
    red: '#F20014',
    gray: '#C8C9CB',
    topbar: '#0C1224',
  },
} as const;

type ColorToken = keyof (typeof palettes)['light'];

const token = (name: ColorToken): string =>
  Platform.OS === 'web'
    ? `var(--bf-${name.replace(/[A-Z]/gu, (value) => `-${value.toLowerCase()}`)}, ${palettes.dark[name]})`
    : palettes.dark[name];

// React Native Web resolves CSS custom properties at paint time. That keeps existing
// StyleSheet declarations responsive to the theme toggle without browser token storage.
export const colors = Object.fromEntries(
  (Object.keys(palettes.light) as ColorToken[]).map((name) => [name, token(name)]),
) as { readonly [Name in ColorToken]: string };

export const radii = { sm: 12, md: 16, lg: 16, pill: 999 } as const;
export const fonts = { body: 'Inter', display: 'BarlowCondensed' } as const;
export const motion = { feedback: 150, content: 200, panel: 250 } as const;

export const shadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 18,
  elevation: 5,
};

export const heading: TextStyle = {
  color: colors.text,
  fontFamily: fonts.display,
  fontWeight: '700',
  letterSpacing: 0.2,
};
