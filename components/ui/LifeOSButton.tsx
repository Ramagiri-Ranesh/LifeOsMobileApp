import type { PropsWithChildren } from 'react';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { radii, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';

type Props = PropsWithChildren<
  PressableProps & {
    variant?: 'primary' | 'secondary';
  }
>;

export function LifeOSButton({ children, variant = 'primary', style, ...props }: Props) {
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        typeof style === 'function' ? style({ pressed, hovered: false }) : style,
      ]}
      {...props}>
      <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>{children}</Text>
    </Pressable>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.inner,
    paddingHorizontal: spacing.sm,
  },
  primary: {
    backgroundColor: colors.violet,
  },
  secondary: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.78,
  },
  text: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  secondaryText: {
    color: colors.violetLight,
  },
  });
}
