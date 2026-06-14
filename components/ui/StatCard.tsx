import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { radii, spacing, typography, useLifeOSColors } from '@/lib/design';

type Props = {
  value: string | number;
  label: string;
  trend?: 'up' | 'down' | 'flat';
  accentColor?: string;
};

export function StatCard({ value, label, trend = 'flat', accentColor }: Props) {
  const colors = useLifeOSColors();
  const accent = accentColor ?? colors.violet;
  const iconName = trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.borderLight }]}>
      <View style={[styles.iconWrap, { backgroundColor: `${accent}22` }]}>
        <Ionicons name={iconName} color={accent} size={18} />
      </View>
      <Text style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
  },
  label: {
    ...typography.body,
  },
});
