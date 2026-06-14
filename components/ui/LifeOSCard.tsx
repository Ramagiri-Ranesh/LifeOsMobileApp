import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { radii, spacing, typography, useLifeOSColors } from '@/lib/design';

type Props = PropsWithChildren<{
  title?: string;
  accentColor?: string;
  style?: ViewStyle;
}>;

export function LifeOSCard({ title, accentColor, style, children }: Props) {
  const colors = useLifeOSColors();
  const accent = accentColor ?? colors.violet;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.borderLight,
          borderTopColor: accent,
        },
        style,
      ]}>
      {title ? <Text style={[styles.title, { color: colors.textSecondary }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: 2,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.sm,
  },
  title: {
    ...typography.labelCaps,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});
