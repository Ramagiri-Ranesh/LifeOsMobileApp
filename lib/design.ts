import { Platform, useColorScheme } from 'react-native';

import { type AppMode, useSettingsStore } from '@/stores/useSettingsStore';

export type ColorPalette = {
  background: string;
  surface1: string;
  surface2: string;
  surface3: string;
  border: string;
  borderLight: string;
  violet: string;
  violetLight: string;
  violetBg: string;
  emerald: string;
  emeraldLight: string;
  emeraldBg: string;
  amber: string;
  amberLight: string;
  amberBg: string;
  blue: string;
  blueLight: string;
  blueBg: string;
  indigo: string;
  indigoBg: string;
  rose: string;
  roseBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
};

export const darkColors: ColorPalette = {
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

export const lightColors: ColorPalette = {
  background: '#F8FAFC',
  surface1: '#FFFFFF',
  surface2: '#EEF2F7',
  surface3: '#E2E8F0',
  border: '#CBD5E1',
  borderLight: '#E2E8F0',
  violet: '#7C3AED',
  violetLight: '#6D28D9',
  violetBg: '#EDE9FE',
  emerald: '#059669',
  emeraldLight: '#047857',
  emeraldBg: '#D1FAE5',
  amber: '#D97706',
  amberLight: '#B45309',
  amberBg: '#FEF3C7',
  blue: '#2563EB',
  blueLight: '#1D4ED8',
  blueBg: '#DBEAFE',
  indigo: '#4F46E5',
  indigoBg: '#E0E7FF',
  rose: '#E11D48',
  roseBg: '#FFE4E6',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
} as const;

export const amoledColors: ColorPalette = {
  ...darkColors,
  background: '#000000',
  surface1: '#050506',
  surface2: '#0D0D12',
  surface3: '#15151D',
  border: '#20202A',
  borderLight: '#171720',
};

export const focusColors: ColorPalette = {
  ...darkColors,
  background: '#07110D',
  surface1: '#0D1A14',
  surface2: '#13231B',
  surface3: '#1A2E24',
  border: '#244236',
  borderLight: '#1B342A',
  violet: '#10B981',
  violetLight: '#6EE7B7',
  violetBg: '#09251A',
};

export const appModeOptions: { key: AppMode; label: string; detail: string }[] = [
  { key: 'system', label: 'System', detail: 'Follow device' },
  { key: 'dark', label: 'Dark', detail: 'Default LifeOS' },
  { key: 'light', label: 'Light', detail: 'Bright mode' },
  { key: 'amoled', label: 'AMOLED', detail: 'Pure black' },
  { key: 'focus', label: 'Focus', detail: 'Low-glow green' },
];

export function colorsForAppMode(mode: AppMode, systemMode: 'light' | 'dark' | null | undefined = 'dark') {
  if (mode === 'light') return lightColors;
  if (mode === 'amoled') return amoledColors;
  if (mode === 'focus') return focusColors;
  if (mode === 'system' && systemMode === 'light') return lightColors;
  return darkColors;
}

export function useLifeOSColors() {
  const appMode = useSettingsStore((state) => state.appMode);
  const systemMode = useColorScheme();
  return colorsForAppMode(appMode, systemMode === 'light' ? 'light' : 'dark');
}

export const colors = darkColors;

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
  ambient:
    Platform.OS === 'web'
      ? {
          boxShadow: '0px 8px 32px rgba(0, 0, 0, 0.5)',
        }
      : {
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
  alert: { color: colors.rose, light: colors.rose, background: colors.roseBg },
} as const;

export type Domain = keyof typeof domains;

export function domainsForColors(palette: ColorPalette): Record<Domain, { color: string; light: string; background: string }> {
  return {
    nutrition: { color: palette.emerald, light: palette.emeraldLight, background: palette.emeraldBg },
    fitness: { color: palette.amber, light: palette.amberLight, background: palette.amberBg },
    goals: { color: palette.blue, light: palette.blueLight, background: palette.blueBg },
    alert: { color: palette.rose, light: palette.rose, background: palette.roseBg },
  };
}

export const design = {
  colors,
  radii,
  spacing,
  typography,
  shadows,
  domains,
} as const;
