import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/lib/design';
import { suggestedTargetDate } from '@/lib/calculations';
import { useUserStore } from '@/stores/useUserStore';

const goals = ['Build muscle & lose fat', 'Lose body fat', 'Build muscle', 'Stay fit'];
const levels = ['Beginner', 'Intermediate', 'Advanced'];

export default function FitnessProfileScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const updateOnboardingProfile = useUserStore((state) => state.updateOnboardingProfile);
  const [goal, setGoal] = useState(draft.goal);
  const [experienceLevel, setExperienceLevel] = useState(draft.experienceLevel);
  const [gymDaysPerWeek, setGymDaysPerWeek] = useState(draft.gymDaysPerWeek);
  const [currentWeight, setCurrentWeight] = useState(String(draft.currentWeight));
  const [targetWeight, setTargetWeight] = useState(String(draft.targetWeight));
  const [weeklyWeightChangeKg, setWeeklyWeightChangeKg] = useState(draft.weeklyWeightChangeKg ?? 0.5);
  const [paceTrackWidth, setPaceTrackWidth] = useState(1);
  const parsedCurrentWeight = Number(currentWeight) || draft.currentWeight;
  const parsedTargetWeight = Number(targetWeight) || draft.targetWeight;
  const targetDate = suggestedTargetDate(parsedCurrentWeight, parsedTargetWeight, new Date(), weeklyWeightChangeKg);
  const paceDirection = goal === 'Build muscle'
    ? 'gain'
    : goal === 'Lose body fat'
      ? 'loss'
      : parsedTargetWeight > parsedCurrentWeight
        ? 'gain'
        : parsedTargetWeight < parsedCurrentWeight
          ? 'loss'
          : 'change';

  const setPaceFromPress = (event: GestureResponderEvent) => {
    const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / paceTrackWidth));
    setWeeklyWeightChangeKg(Number(ratio.toFixed(1)));
  };

  const handleNext = () => {
    updateOnboardingProfile({
      goal,
      experienceLevel,
      gymDaysPerWeek,
      currentWeight: parsedCurrentWeight,
      targetWeight: parsedTargetWeight,
      weeklyWeightChangeKg,
      targetDate,
    });
    router.push('/(onboarding)/diet-profile');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProgressDots step={2} />
        <Text style={styles.kicker}>Step 2 of 5</Text>
        <Text style={styles.title}>Tune your fitness profile</Text>
        <Text style={styles.subtitle}>A few basics help LifeOS shape your training and calorie targets.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Primary goal</Text>
          <View style={styles.goalStack}>
            {goals.map((item) => {
              const selected = item === goal;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={item}
                  onPress={() => setGoal(item)}
                  style={({ pressed }) => [
                    styles.goalCard,
                    selected && styles.goalCardSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.goalText, selected && styles.goalTextSelected]}>{item}</Text>
                  {selected ? <Ionicons name="checkmark-circle" color={colors.violetLight} size={22} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Experience</Text>
          <View style={styles.chipRow}>
            {levels.map((item) => {
              const selected = item === experienceLevel;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={item}
                  onPress={() => setExperienceLevel(item)}
                  style={({ pressed }) => [
                    styles.levelChip,
                    selected && styles.levelChipSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.levelChipText, selected && styles.levelChipTextSelected]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gym days per week</Text>
          <View style={styles.stepperCard}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setGymDaysPerWeek((value) => Math.max(1, value - 1))}
              style={styles.stepperButton}>
              <Ionicons name="chevron-back" color={colors.textPrimary} size={22} />
            </Pressable>
            <Text style={styles.stepperNumber}>{gymDaysPerWeek}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setGymDaysPerWeek((value) => Math.min(7, value + 1))}
              style={styles.stepperButton}>
              <Ionicons name="chevron-forward" color={colors.textPrimary} size={22} />
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weight target</Text>
          <View style={styles.inputRow}>
            <View style={styles.inputShell}>
              <Text style={styles.inputLabel}>Current kg</Text>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={setCurrentWeight}
                placeholder="75"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={currentWeight}
              />
            </View>
            <View style={styles.inputShell}>
              <Text style={styles.inputLabel}>Target kg</Text>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={setTargetWeight}
                placeholder="72"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={targetWeight}
              />
            </View>
          </View>
          <View style={styles.paceCard}>
            <View style={styles.paceHeader}>
              <View>
                <Text style={styles.inputLabel}>Planned weight change</Text>
                <Text style={styles.paceHint}>Choose 0 to 1 kg per week</Text>
              </View>
              <Text style={styles.paceValue}>
                {weeklyWeightChangeKg > 0 ? `${weeklyWeightChangeKg.toFixed(1)} kg ${paceDirection}/week` : 'Maintenance'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`Planned weight change ${weeklyWeightChangeKg.toFixed(1)} kilograms per week`}
              accessibilityRole="adjustable"
              onLayout={(event) => setPaceTrackWidth(Math.max(1, event.nativeEvent.layout.width))}
              onPress={setPaceFromPress}
              style={styles.paceTouchArea}>
              <View style={styles.paceTrack}>
                <View style={[styles.paceFill, { width: `${weeklyWeightChangeKg * 100}%` }]} />
                <View style={[styles.paceThumb, { left: `${weeklyWeightChangeKg * 100}%` }]} />
              </View>
              <View style={styles.paceLabels}>
                <Text style={styles.paceLabel}>0</Text>
                <Text style={styles.paceLabel}>0.5</Text>
                <Text style={styles.paceLabel}>1 kg</Text>
              </View>
            </Pressable>
            <View style={styles.paceAdjustRow}>
              <Pressable
                accessibilityLabel="Decrease weekly pace"
                accessibilityRole="button"
                onPress={() => setWeeklyWeightChangeKg((value) => Number(Math.max(0, value - 0.1).toFixed(1)))}
                style={styles.paceAdjustButton}>
                <Ionicons name="remove" color={colors.textPrimary} size={18} />
              </Pressable>
              <Text style={styles.targetDateText}>
                {targetDate ? `Estimated target date · ${targetDate}` : 'Maintenance pace · no target date'}
              </Text>
              <Pressable
                accessibilityLabel="Increase weekly pace"
                accessibilityRole="button"
                onPress={() => setWeeklyWeightChangeKg((value) => Number(Math.min(1, value + 0.1).toFixed(1)))}
                style={styles.paceAdjustButton}>
                <Ionicons name="add" color={colors.textPrimary} size={18} />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={handleNext} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Continue</Text>
          <Ionicons name="arrow-forward" color={colors.textPrimary} size={18} />
        </Pressable>
      </View>
    </SafeAreaView>
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
    backgroundColor: colors.violet,
    width: 22,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.violetLight,
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
  goalStack: {
    gap: spacing.xs,
  },
  goalCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  goalCardSelected: {
    backgroundColor: colors.violetBg,
    borderColor: colors.violet,
  },
  goalText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  goalTextSelected: {
    color: colors.textPrimary,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  levelChip: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  levelChipSelected: {
    backgroundColor: colors.amber,
    borderColor: colors.amber,
  },
  levelChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  levelChipTextSelected: {
    color: colors.background,
  },
  stepperCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    height: 62,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  stepperButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  stepperNumber: {
    color: colors.amber,
    fontSize: 26,
    fontWeight: '800',
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  inputShell: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  paceCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  paceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paceHint: {
    color: colors.textMuted,
    fontSize: 11,
  },
  paceValue: {
    color: colors.violetLight,
    fontSize: 15,
    fontWeight: '800',
  },
  paceTouchArea: {
    paddingBottom: 2,
    paddingTop: spacing.sm,
  },
  paceTrack: {
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 8,
    position: 'relative',
  },
  paceFill: {
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    height: 8,
  },
  paceThumb: {
    backgroundColor: colors.violetLight,
    borderColor: colors.textPrimary,
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    marginLeft: -9,
    position: 'absolute',
    top: -5,
    width: 18,
  },
  paceLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  paceLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  paceAdjustRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  paceAdjustButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  targetDateText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  input: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    minHeight: 36,
    padding: 0,
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
    backgroundColor: colors.violet,
    borderRadius: radii.inner,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
