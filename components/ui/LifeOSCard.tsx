import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing, typography } from '@/lib/design';

type Props = PropsWithChildren<{
  title?: string;
  accentColor?: string;
  style?: ViewStyle;
}>;

export function LifeOSCard({ title, accentColor = colors.violet, style, children }: Props) {
  return (
    <View style={[styles.card, { borderTopColor: accentColor }, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderTopWidth: 2,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.sm,
  },
  title: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});
