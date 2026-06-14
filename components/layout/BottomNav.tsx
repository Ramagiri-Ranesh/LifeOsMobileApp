import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, useLifeOSColors } from '@/lib/design';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'grid-outline',
  nutrition: 'restaurant-outline',
  gym: 'barbell-outline',
  goals: 'flag-outline',
  analytics: 'analytics-outline',
  settings: 'settings-outline',
};

const compactLabels: Record<string, string> = {
  analytics: 'Stats',
  settings: 'Setup',
};

type BottomNavProps = {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    navigate: (name: string) => void;
  };
};

export function BottomNav({ state, descriptors, navigation }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const colors = useLifeOSColors();

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          marginBottom: Math.max(spacing.sm, insets.bottom + spacing.xs),
        },
      ]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key].options;
        const label = compactLabels[route.name] ?? String(options.title ?? route.name);

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            onPress={() => navigation.navigate(route.name)}
            style={[styles.item, focused && { backgroundColor: colors.violetBg }]}>
            <Ionicons
              name={icons[route.name] ?? 'ellipse-outline'}
              color={focused ? colors.violetLight : colors.textMuted}
              size={20}
            />
            <Text
              allowFontScaling={false}
              style={[styles.label, { color: focused ? colors.violetLight : colors.textMuted }]}
              numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.base,
    margin: spacing.sm,
    padding: spacing.xs,
  },
  item: {
    alignItems: 'center',
    borderRadius: radii.inner,
    flex: 1,
    gap: 2,
    minHeight: 52,
    justifyContent: 'center',
  },
  label: {
    ...typography.labelCaps,
    fontSize: 10,
    textTransform: 'uppercase',
  },
});
