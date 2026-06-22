import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/lib/design';
import { useUserStore } from '@/stores/useUserStore';

const cuisines = ['South Indian', 'Hyderabadi', 'North Indian', 'Telugu'];
const foods = [
  { name: 'Eggs', icon: 'egg-outline' },
  { name: 'Banana', icon: 'nutrition-outline' },
  { name: 'Milk', icon: 'cafe-outline' },
  { name: 'Rice', icon: 'restaurant-outline' },
  { name: 'Dal', icon: 'leaf-outline' },
  { name: 'Chapathi', icon: 'ellipse-outline' },
  { name: 'Peanuts', icon: 'radio-button-on-outline' },
  { name: 'Chana', icon: 'apps-outline' },
  { name: 'Chicken', icon: 'fast-food-outline' },
] as const;
export default function DietProfileScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const updateOnboardingProfile = useUserStore((state) => state.updateOnboardingProfile);
  const [cuisinePrefs, setCuisinePrefs] = useState(draft.cuisinePrefs);
  const [foodsEaten, setFoodsEaten] = useState(draft.foodsEaten);
  const [foodsAvoided, setFoodsAvoided] = useState(draft.foodsAvoided);
  const [dislikedFoodDraft, setDislikedFoodDraft] = useState('');
  const [firstMealTime, setFirstMealTime] = useState(draft.firstMealTime);
  const [lastMealTime, setLastMealTime] = useState(draft.lastMealTime);
  const [aiCalcCalories, setAiCalcCalories] = useState(draft.aiCalcCalories);

  const toggleArrayValue = (value: string, selectedValues: string[], setSelectedValues: (values: string[]) => void) => {
    setSelectedValues(
      selectedValues.includes(value)
        ? selectedValues.filter((selectedValue) => selectedValue !== value)
        : [...selectedValues, value],
    );
  };

  const addDislikedFood = () => {
    const nextFood = dislikedFoodDraft.trim();
    if (!nextFood) return;
    if (!foodsAvoided.some((food) => food.toLowerCase() === nextFood.toLowerCase())) {
      setFoodsAvoided([...foodsAvoided, nextFood]);
    }
    setDislikedFoodDraft('');
  };

  const removeDislikedFood = (food: string) => {
    setFoodsAvoided(foodsAvoided.filter((item) => item !== food));
  };

  const handleNext = () => {
    updateOnboardingProfile({
      cuisinePrefs,
      foodsEaten,
      foodsAvoided,
      firstMealTime,
      lastMealTime,
      aiCalcCalories,
    });
    router.push('/(onboarding)/plan-reveal');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProgressDots step={3} />
        <Text style={styles.kicker}>Step 3 of 5</Text>
        <Text style={styles.title}>Shape your diet profile</Text>
        <Text style={styles.subtitle}>Pick the foods LifeOS should build around, and the ones it should skip.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cuisine preferences</Text>
          <View style={styles.wrapRow}>
            {cuisines.map((item) => {
              const selected = cuisinePrefs.includes(item);
              return (
                <SelectableChip
                  key={item}
                  label={item}
                  selected={selected}
                  selectedColor={colors.emerald}
                  onPress={() => toggleArrayValue(item, cuisinePrefs, setCuisinePrefs)}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Foods eaten</Text>
          <View style={styles.foodGrid}>
            {foods.map((item) => {
              const selected = foodsEaten.includes(item.name);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={item.name}
                  onPress={() => toggleArrayValue(item.name, foodsEaten, setFoodsEaten)}
                  style={({ pressed }) => [
                    styles.foodTile,
                    selected && styles.foodTileSelected,
                    pressed && styles.pressed,
                  ]}>
                  <View style={[styles.foodIcon, selected && styles.foodIconSelected]}>
                    <Ionicons
                      name={item.icon}
                      color={selected ? colors.background : colors.textSecondary}
                      size={18}
                    />
                  </View>
                  <Text style={[styles.foodText, selected && styles.foodTextSelected]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {selected ? <Ionicons name="checkmark" color={colors.emeraldLight} size={14} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Foods you do not like</Text>
          <View style={styles.addRow}>
            <TextInput
              autoCapitalize="words"
              onChangeText={setDislikedFoodDraft}
              onSubmitEditing={addDislikedFood}
              placeholder="Add disliked food"
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              style={styles.addInput}
              value={dislikedFoodDraft}
            />
            <Pressable accessibilityRole="button" onPress={addDislikedFood} style={styles.addButton}>
              <Ionicons name="add" color={colors.background} size={20} />
            </Pressable>
          </View>
          <View style={styles.wrapRow}>
            {foodsAvoided.map((item) => (
              <SelectableChip
                key={item}
                label={item}
                selected
                selectedColor={colors.rose}
                onPress={() => removeDislikedFood(item)}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Meal timing</Text>
          <View style={styles.timingStack}>
            <TimeInputRow label="First meal" value={firstMealTime} onChangeText={setFirstMealTime} />
            <TimeInputRow label="Last meal" value={lastMealTime} onChangeText={setLastMealTime} />
          </View>
        </View>

        <View style={styles.toggleCard}>
          <View>
            <Text style={styles.toggleTitle}>Calculate my starting targets</Text>
            <Text style={styles.toggleSubtitle}>Uses local formulas during registration; no AI request is sent.</Text>
          </View>
          <Switch
            ios_backgroundColor={colors.surface2}
            onValueChange={setAiCalcCalories}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.surface2, true: colors.emerald }}
            value={aiCalcCalories}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={handleNext} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Reveal my plan</Text>
          <Ionicons name="sparkles-outline" color={colors.textPrimary} size={18} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

type SelectableChipProps = {
  label: string;
  selected: boolean;
  selectedColor: string;
  onPress: () => void;
};

function SelectableChip({ label, selected, selectedColor, onPress }: SelectableChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: selectedColor, borderColor: selectedColor },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" color={colors.background} size={14} /> : null}
    </Pressable>
  );
}

function TimeInputRow({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.timeRow}>
      <View style={styles.timeIcon}>
        <Ionicons name="time-outline" color={colors.amber} size={18} />
      </View>
      <Text style={styles.timeLabel}>{label}</Text>
      <TextInput
        onChangeText={onChangeText}
        placeholder="07:00"
        placeholderTextColor={colors.textMuted}
        style={styles.timeInput}
        value={value}
      />
    </View>
  );
}

function ProgressDots({ step }: { step: number }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4, 5].map((dot) => (
        <View key={dot} style={[styles.dot, dot <= step && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: 112,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  dot: {
    backgroundColor: colors.surface2,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dotActive: {
    backgroundColor: colors.emerald,
    width: 22,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.emeraldLight,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  section: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  addInput: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.rose,
    borderRadius: radii.inner,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextSelected: {
    color: colors.background,
  },
  foodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  foodTile: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    minHeight: 98,
    padding: spacing.xs,
    width: '31.9%',
  },
  foodTileSelected: {
    backgroundColor: colors.emeraldBg,
    borderColor: colors.emerald,
  },
  foodIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginBottom: 7,
    width: 36,
  },
  foodIconSelected: {
    backgroundColor: colors.emerald,
  },
  foodText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 3,
    maxWidth: '100%',
  },
  foodTextSelected: {
    color: colors.textPrimary,
  },
  timingStack: {
    gap: spacing.xs,
  },
  timeRow: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  timeIcon: {
    alignItems: 'center',
    backgroundColor: colors.amberBg,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginRight: 12,
    width: 36,
  },
  timeLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  timeInput: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    minWidth: 92,
    paddingVertical: 8,
    textAlign: 'right',
  },
  toggleCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    minHeight: 72,
    paddingHorizontal: spacing.sm,
  },
  toggleTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  toggleSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
    maxWidth: 230,
  },
  footer: {
    backgroundColor: colors.background,
    bottom: 0,
    left: 0,
    padding: spacing.gutter,
    position: 'absolute',
    right: 0,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radii.inner,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
