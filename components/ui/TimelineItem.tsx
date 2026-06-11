import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/lib/design';

type Props = {
  time: string;
  title: string;
  subtitle?: string;
  color?: string;
};

export function TimelineItem({ time, title, subtitle, color = colors.violet }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.axis}>
        <View style={[styles.node, { backgroundColor: color }]} />
      </View>
      <View style={styles.content}>
        <Text style={styles.time}>{time}</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  axis: {
    alignItems: 'center',
    width: 16,
  },
  node: {
    borderRadius: 4,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  content: {
    borderLeftColor: colors.borderLight,
    flex: 1,
    paddingBottom: spacing.sm,
  },
  time: {
    ...typography.labelCaps,
    color: colors.textMuted,
  },
  title: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
