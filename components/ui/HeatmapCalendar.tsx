import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { radii, spacing, useLifeOSColors, type ColorPalette } from '@/lib/design';

type HeatmapDay = {
  date: string;
  value: number;
};

type Props = {
  days?: HeatmapDay[];
  color?: string;
  weeks?: number;
  maxValue?: number;
  today?: string;
};

function intensityColor(value: number, maxValue: number, color: string) {
  if (value <= 0) return '#1A1A1A';
  const intensity = maxValue > 0 ? Math.min(1, value / maxValue) : 1;
  const alpha = intensity < 0.34 ? '55' : intensity < 0.67 ? '99' : 'FF';
  return color.length === 7 ? `${color}${alpha}` : color;
}

export function HeatmapCalendar({ days = [], color, weeks = 5, maxValue = 7, today }: Props) {
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const activeColor = color ?? colors.violet;
  const cells = Array.from({ length: weeks * 7 }, (_, index) => days[index] ?? { date: `${index}`, value: 0 });

  return (
    <View style={[styles.grid, { width: weeks * 16 - spacing.base }]}>
      {cells.map((day, index) => (
        <View
          key={`${day.date}-${index}`}
          style={[
            styles.cell,
            { backgroundColor: intensityColor(day.value, maxValue, activeColor) },
            today === day.date && styles.todayCell,
          ]}
        />
      ))}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.base,
    width: 116,
  },
  cell: {
    borderRadius: radii.inner / 3,
    height: 12,
    width: 12,
  },
  todayCell: {
    borderColor: colors.textPrimary,
    borderWidth: 1,
  },
  });
}
