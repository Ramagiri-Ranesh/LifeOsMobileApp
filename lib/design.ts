export const colors = {
  background: '#08080F',
  surface1: '#111119',
  surface2: '#1A1A26',
  surface3: '#1C1C28',
  border: '#252535',
  borderLight: '#1C1C2C',
  violet: '#7C3AED',
  violetLight: '#A78BFA',
  violetBg: '#1A1030',
  emerald: '#10B981',
  emeraldLight: '#34D399',
  emeraldBg: '#0A2018',
  amber: '#F59E0B',
  amberLight: '#FCD34D',
  amberBg: '#1F1500',
  blue: '#3B82F6',
  blueLight: '#93C5FD',
  blueBg: '#0C1A30',
  indigo: '#6366F1',
  indigoBg: '#111030',
  rose: '#F43F5E',
  roseBg: '#1F0A10',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#4B5563',
} as const;

export const radii = {
  card: 20,
  inner: 12,
  pill: 50,
} as const;

export const spacing = {
  base: 4,
  xs: 8,
  sm: 16,
  md: 24,
  lg: 40,
  xl: 64,
  gutter: 20,
  marginMobile: 16,
  marginDesktop: 48,
} as const;

export const typography = {
  fontFamily: 'Inter',
  stats: { fontSize: 44, fontWeight: '700' as const, lineHeight: 52 },
  h1: { fontSize: 22, fontWeight: '700' as const, lineHeight: 30 },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 22 },
  labelCaps: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
} as const;

export const shadows = {
  ambient: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const;

export const domains = {
  nutrition: { color: colors.emerald, light: colors.emeraldLight, background: colors.emeraldBg },
  fitness: { color: colors.amber, light: colors.amberLight, background: colors.amberBg },
  goals: { color: colors.blue, light: colors.blueLight, background: colors.blueBg },
  habits: { color: colors.violet, light: colors.violetLight, background: colors.violetBg },
  learning: { color: colors.indigo, light: colors.indigo, background: colors.indigoBg },
  alert: { color: colors.rose, light: colors.rose, background: colors.roseBg },
} as const;

export type Domain = keyof typeof domains;

export const design = {
  colors,
  radii,
  spacing,
  typography,
  shadows,
  domains,
} as const;
