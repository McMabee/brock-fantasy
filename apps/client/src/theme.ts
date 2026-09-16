import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  canvas: '#06130E',
  canvasSoft: '#0B2018',
  panel: '#102A20',
  panelStrong: '#17372B',
  border: '#28513F',
  brand: '#D7FF46',
  brandStrong: '#B9ED15',
  accent: '#FFB35C',
  text: '#F3F8F5',
  muted: '#9CB7AA',
  danger: '#FF7A7A',
  info: '#7DCCFF',
  white: '#FFFFFF',
} as const;

export const radii = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

export const shadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.2,
  shadowRadius: 18,
  elevation: 5,
};

export const heading: TextStyle = {
  color: colors.text,
  fontWeight: '800',
  letterSpacing: -0.8,
};
