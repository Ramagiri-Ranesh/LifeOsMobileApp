import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing, typography } from '@/lib/design';

type Props = {
  value: string | number;
  label: string;
  trend?: 'up' | 'down' | 'flat';
  accentColor?: string;
};

export function StatCard({ value, label, trend = 'flat', accentColor = colors.violet }: Props) {
  const iconName = trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove';

  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}22` }]}>
        <Ionicons name={iconName} color={accentColor} size={18} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radii.inner,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  value: {
    ...typography.stats,
    color: colors.textPrimary,
  },
  label: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
