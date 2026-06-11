import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/lib/design';

type Props = {
  time: string;
  title: string;
  subtitle?: string;
  color?: string;
  tag?: string;
};

export function TimelineItem({ time, title, subtitle, color = colors.violet, tag }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.time}>{time}</Text>
      <View style={styles.axis}>
        <View style={[styles.node, { backgroundColor: color }]} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {tag ? (
            <View style={[styles.tag, { borderColor: color }]}>
              <Text style={[styles.tagText, { color }]}>{tag}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
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
    paddingTop: 2,
    width: 58,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  title: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  tag: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  tagText: {
    ...typography.labelCaps,
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
});
