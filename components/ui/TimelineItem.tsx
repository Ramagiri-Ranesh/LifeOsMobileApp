import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { spacing, typography, useLifeOSColors } from '@/lib/design';

type Props = {
  time: string;
  title: string;
  subtitle?: string;
  color?: string;
  tag?: string;
  completed?: boolean;
  onToggleComplete?: () => void;
};

export function TimelineItem({ time, title, subtitle, color, tag, completed = false, onToggleComplete }: Props) {
  const colors = useLifeOSColors();
  const accent = color ?? colors.violet;

  return (
    <View style={styles.row}>
      <Text style={[styles.time, { color: colors.textMuted }]}>{time}</Text>
      <View style={styles.axis}>
        <View style={[styles.node, { backgroundColor: accent }]} />
      </View>
      <View style={[styles.content, { borderLeftColor: colors.borderLight }]}>
        <View style={styles.titleRow}>
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: colors.textPrimary }, completed && { color: colors.textSecondary }]}>{title}</Text>
            {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          </View>
          {tag ? (
            <View style={[styles.tag, { borderColor: accent }]}>
              <Text style={[styles.tagText, { color: accent }]}>{tag}</Text>
            </View>
          ) : null}
          {onToggleComplete ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={completed ? 'Mark task incomplete' : 'Mark task complete'}
              onPress={onToggleComplete}
              style={[styles.checkButton, { borderColor: colors.border }, completed && { backgroundColor: accent, borderColor: accent }]}>
              <Ionicons
                name={completed ? 'checkmark' : 'ellipse-outline'}
                size={18}
                color={completed ? colors.background : accent}
              />
            </TouchableOpacity>
          ) : null}
        </View>
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
    flex: 1,
    paddingBottom: spacing.sm,
  },
  time: {
    ...typography.labelCaps,
    paddingTop: 2,
    width: 58,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
  },
  completedTitle: {
    textDecorationLine: 'line-through',
  },
  subtitle: {
    ...typography.body,
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
  checkButton: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
});
