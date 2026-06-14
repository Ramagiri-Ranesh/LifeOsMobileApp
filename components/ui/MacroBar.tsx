import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useLifeOSColors } from '@/lib/design';

type Props = {
  label: string;
  current: number;
  target: number;
  color?: string;
  unit?: string;
};

export function MacroBar({ label, current, target, color, unit = 'g' }: Props) {
  const colors = useLifeOSColors();
  const accent = color ?? colors.emerald;
  const progress = target > 0 ? Math.max(0, Math.min(1, current / target)) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.value, { color: colors.textPrimary }]}>
          {current}/{target}
          {unit}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surface3 }]}>
        <View style={[styles.fill, { backgroundColor: accent, width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.body,
  },
  value: {
    ...typography.body,
  },
  track: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
