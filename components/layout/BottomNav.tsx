import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/lib/design';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'grid-outline',
  nutrition: 'restaurant-outline',
  gym: 'barbell-outline',
  goals: 'flag-outline',
  analytics: 'analytics-outline',
  habits: 'repeat-outline',
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

  return (
    <View style={[styles.wrap, { marginBottom: Math.max(spacing.sm, insets.bottom + spacing.xs) }]}>
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
            style={[styles.item, focused && styles.itemActive]}>
            <Ionicons
              name={icons[route.name] ?? 'ellipse-outline'}
              color={focused ? colors.violetLight : colors.textMuted}
              size={20}
            />
            <Text allowFontScaling={false} style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
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
    backgroundColor: colors.surface1,
    borderColor: colors.border,
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
  itemActive: {
    backgroundColor: colors.violetBg,
  },
  label: {
    ...typography.labelCaps,
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.violetLight,
  },
});
