import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/lib/design';

type HeatmapDay = {
  date: string;
  value: number;
};

type Props = {
  days?: HeatmapDay[];
  color?: string;
};

export function HeatmapCalendar({ days = [], color = colors.violet }: Props) {
  const cells = Array.from({ length: 35 }, (_, index) => days[index]?.value ?? 0);

  return (
    <View style={styles.grid}>
      {cells.map((value, index) => (
        <View
          key={`${index}-${value}`}
          style={[
            styles.cell,
            {
              backgroundColor: value > 0 ? color : colors.surface3,
              opacity: value > 0 ? Math.max(0.25, Math.min(1, value / 5)) : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
