import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { calculateGoalCalorieTarget, calculateHydrationTarget, calculateMacros, calculateTDEE, type ActivityLevel, type FitnessGoal } from '@/lib/calculations';
import { colors, radii, spacing, typography } from '@/lib/design';
import { recommendedExercisesForWorkoutLabel } from '@/lib/exerciseCatalog';
import { useUserStore, type GeneratedPlan, type UserProfile } from '@/stores/useUserStore';

const defaultBullets = [
  'Hit 4 gym sessions with two push, one pull, and one legs workout.',
  'Keep protein steady at every meal and use familiar foods first.',
  'Walk 7,000 steps on rest days to support recovery and fat loss.',
  'Log weight twice this week and adjust only after seven days of data.',
];
const defaultDayPills = ['Push', 'Pull', 'Legs', 'Rest', 'Push', 'Pull', 'Rest'];

type WeekPlan = {
  workoutSplit: string;
  dayPills: string[];
  weeklyWorkouts: NonNullable<GeneratedPlan['weeklyWorkouts']>;
  firstWeekGoals: string[];
  calorieTarget: number;
  maintenanceCalories: number;
  calorieAdjustment: number;
  macros: { protein: number; carbs: number; fat: number };
  waterTargetMl: number;
};

export default function PlanRevealScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const setGeneratedPlan = useUserStore((state) => state.setGeneratedPlan);
  const activityLevel = useMemo(() => getActivityLevel(draft.gymDaysPerWeek), [draft.gymDaysPerWeek]);
  const fitnessGoal = useMemo(() => getFitnessGoal(draft.goal), [draft.goal]);
  const maintenanceCalories = useMemo(
    () => calculateTDEE(draft.currentWeight, draft.heightCm, draft.age, activityLevel, draft.gender),
    [activityLevel, draft.age, draft.currentWeight, draft.gender, draft.heightCm],
  );
  const goalCalories = useMemo(
    () => calculateGoalCalorieTarget({
      maintenanceCalories,
      currentWeightKg: draft.currentWeight,
      targetWeightKg: draft.targetWeight,
      targetDate: draft.targetDate,
      weeklyWeightChangeKg: draft.weeklyWeightChangeKg,
      goal: fitnessGoal,
    }),
    [draft.currentWeight, draft.targetDate, draft.targetWeight, draft.weeklyWeightChangeKg, fitnessGoal, maintenanceCalories],
  );
  const fallbackCalorieTarget = goalCalories.calorieTarget;
  const fallbackMacros = useMemo(
    () => calculateMacros(fallbackCalorieTarget, fitnessGoal),
    [fallbackCalorieTarget, fitnessGoal],
  );
  const fallbackWaterTargetMl = useMemo(
    () => calculateHydrationTarget(draft.currentWeight).waterTargetMl,
    [draft.currentWeight],
  );
  const fallbackPlan = useMemo(
    () =>
      buildFallbackWeekPlan({
        gymDaysPerWeek: draft.gymDaysPerWeek,
        calorieTarget: fallbackCalorieTarget,
        macros: fallbackMacros,
        waterTargetMl: fallbackWaterTargetMl,
        maintenanceCalories,
        calorieAdjustment: goalCalories.calorieAdjustment,
      }),
    [draft.gymDaysPerWeek, fallbackCalorieTarget, fallbackMacros, fallbackWaterTargetMl, goalCalories.calorieAdjustment, maintenanceCalories],
  );
  const plan = fallbackPlan;
  const aiStatus = 'Plan calculated locally. AI is available only after registration.';
  const [isSaving, setIsSaving] = useState(false);
  const checkScale = useSharedValue(0.4);
  const checkOpacity = useSharedValue(0);
  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  useEffect(() => {
    checkScale.value = withSpring(1, { damping: 10, stiffness: 130 });
    checkOpacity.value = withTiming(1, { duration: 220 });
  }, [checkOpacity, checkScale]);

  const fullProfile: UserProfile = {
    name: draft.name,
    gender: draft.gender,
    age: draft.age,
    heightCm: draft.heightCm,
    weightKg: draft.currentWeight,
    targetWeightKg: draft.targetWeight,
    targetDate: draft.targetDate || goalCalories.targetDate,
    weeklyWeightChangeKg: draft.weeklyWeightChangeKg,
    gymDaysPerWeek: draft.gymDaysPerWeek,
    split: plan.workoutSplit,
    waterTargetMl: plan.waterTargetMl,
    currency: 'INR',
    measurements: 'metric',
    goal: draft.goal,
    experienceLevel: draft.experienceLevel,
    cuisinePrefs: draft.cuisinePrefs,
    foodsEaten: draft.foodsEaten,
    foodsAvoided: draft.foodsAvoided,
    firstMealTime: draft.firstMealTime,
    lastMealTime: draft.lastMealTime,
    aiCalcCalories: draft.aiCalcCalories,
  };

  const handleFinish = () => {
    if (isSaving) return;

    setIsSaving(true);
    const generatedPlan: GeneratedPlan = {
      workoutSplit: plan.workoutSplit,
      dayPills: plan.dayPills,
      weeklyWorkouts: plan.weeklyWorkouts,
      firstWeekGoals: plan.firstWeekGoals,
      waterTargetMl: plan.waterTargetMl,
    };

    setProfile(fullProfile);
    setPlanTargets(plan.calorieTarget, plan.macros, plan.waterTargetMl);
    setGeneratedPlan(generatedPlan);
    router.push('/(onboarding)/register');
  };
  const isAIPlaceholderVisible = false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProgressDots step={4} />

        <Animated.View style={[styles.checkWrap, checkStyle]}>
          <Ionicons name="checkmark" color={colors.background} size={48} />
        </Animated.View>

        <Text style={styles.title}>Your plan is ready, {draft.name || 'you'}</Text>
        <Text style={styles.aiStatus}>{aiStatus}</Text>

        <RevealCard index={0} accentColor={colors.emerald} backgroundColor={colors.emeraldBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>Calorie target</Text>
            <Ionicons name="flame-outline" color={colors.emeraldLight} size={20} />
          </View>
          <Text style={[styles.calorieNumber, isAIPlaceholderVisible && styles.placeholderText]}>
            {isAIPlaceholderVisible ? 'AI' : plan.calorieTarget}
          </Text>
          <Text style={styles.calorieUnit}>{isAIPlaceholderVisible ? 'calculating target' : 'kcal per day'}</Text>
          {!isAIPlaceholderVisible ? (
            <Text style={styles.calorieExplanation}>
              Maintenance {plan.maintenanceCalories} kcal {plan.calorieAdjustment >= 0 ? '+' : '−'} {Math.abs(plan.calorieAdjustment)} kcal {plan.calorieAdjustment > 0 ? 'surplus' : plan.calorieAdjustment < 0 ? 'deficit' : 'adjustment'} · {Math.abs(goalCalories.plannedWeeklyChangeKg).toFixed(1)} kg/week
            </Text>
          ) : null}
          <View style={styles.macroRow}>
            <MacroPill label="Protein" value={isAIPlaceholderVisible ? 'AI' : `${plan.macros.protein}g`} />
            <MacroPill label="Carbs" value={isAIPlaceholderVisible ? 'AI' : `${plan.macros.carbs}g`} />
            <MacroPill label="Fat" value={isAIPlaceholderVisible ? 'AI' : `${plan.macros.fat}g`} />
          </View>
        </RevealCard>

        <RevealCard index={1} accentColor={colors.amber} backgroundColor={colors.amberBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>Workout split</Text>
            <Ionicons name="barbell-outline" color={colors.amberLight} size={20} />
          </View>
          <Text style={[styles.splitTitle, isAIPlaceholderVisible && styles.placeholderText]}>
            {isAIPlaceholderVisible ? 'Generating AI split...' : plan.workoutSplit}
          </Text>
          <View style={styles.dayPillRow}>
            {(isAIPlaceholderVisible ? ['AI', 'AI', 'AI', 'AI', 'AI', 'AI', 'AI'] : plan.dayPills.slice(0, 7)).map((day, index) => (
              <View key={`${day}-${index}`} style={styles.dayPill}>
                <Text style={styles.dayPillText}>{day}</Text>
              </View>
            ))}
          </View>
        </RevealCard>

        <RevealCard index={2} accentColor={colors.emerald} backgroundColor={colors.emeraldBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>Water target</Text>
            <Ionicons name="water-outline" color={colors.emeraldLight} size={20} />
          </View>
          <Text style={[styles.splitTitle, isAIPlaceholderVisible && styles.placeholderText]}>
            {isAIPlaceholderVisible ? 'AI calculating required water...' : `${plan.waterTargetMl} ml · ${plan.waterTargetMl / 250} × 250 ml glasses`}
          </Text>
        </RevealCard>

        <RevealCard index={3} accentColor={colors.violet} backgroundColor={colors.violetBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>First week goals</Text>
            <Ionicons name="sparkles-outline" color={colors.violetLight} size={20} />
          </View>
          <View style={styles.goalList}>
            {(isAIPlaceholderVisible ? ['AI is generating your first-week goals...'] : plan.firstWeekGoals.slice(0, 4)).map((goal, index) => (
              <View key={`${goal}-${index}`} style={styles.goalRow}>
                <View style={styles.goalDot} />
                <Text style={[styles.goalText, isAIPlaceholderVisible && styles.placeholderText]}>{goal}</Text>
              </View>
            ))}
          </View>
        </RevealCard>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={handleFinish}
          style={[styles.primaryButton, isSaving && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonText}>{isSaving ? 'Preparing...' : "Let's go →"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function getActivityLevel(gymDaysPerWeek: number): ActivityLevel {
  if (gymDaysPerWeek <= 1) return 'sedentary';
  if (gymDaysPerWeek <= 3) return 'light';
  if (gymDaysPerWeek <= 5) return 'moderate';
  if (gymDaysPerWeek <= 6) return 'active';
  return 'veryActive';
}

function getFitnessGoal(goal: string): FitnessGoal {
  if (goal === 'Lose body fat') return 'cut';
  if (goal === 'Build muscle') return 'bulk';
  return 'maintain';
}

function buildFallbackWeekPlan(args: {
  gymDaysPerWeek: number;
  calorieTarget: number;
  macros: { protein: number; carbs: number; fat: number };
  waterTargetMl: number;
  maintenanceCalories: number;
  calorieAdjustment: number;
}): WeekPlan {
  const gymDays = Math.max(1, Math.min(7, Math.round(args.gymDaysPerWeek)));
  const scheduleByDays: Record<number, { workoutSplit: string; dayPills: string[] }> = {
    1: {
      workoutSplit: 'Full Body: Sat',
      dayPills: ['Rest', 'Mobility', 'Rest', 'Walk', 'Rest', 'Full Body', 'Recovery'],
    },
    2: {
      workoutSplit: 'Full Body: Tue, Sat',
      dayPills: ['Rest', 'Full Body', 'Walk', 'Rest', 'Mobility', 'Full Body', 'Recovery'],
    },
    3: {
      workoutSplit: 'Full Body: Mon, Wed, Fri',
      dayPills: ['Full Body', 'Rest', 'Full Body', 'Rest', 'Full Body', 'Walk', 'Recovery'],
    },
    4: {
      workoutSplit: 'Upper/Lower: Mon, Tue, Thu, Sat',
      dayPills: ['Upper', 'Lower', 'Rest', 'Upper', 'Rest', 'Lower', 'Recovery'],
    },
    5: {
      workoutSplit: 'PPL + Upper/Lower: Mon-Fri',
      dayPills: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Recovery'],
    },
    6: {
      workoutSplit: 'PPL: Push/Pull/Legs twice weekly',
      dayPills: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs', 'Recovery'],
    },
    7: {
      workoutSplit: 'Daily training: 5 lifts + 2 recovery days',
      dayPills: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Mobility', 'Recovery'],
    },
  };
  const schedule = scheduleByDays[gymDays] ?? scheduleByDays[3];

  return {
    ...schedule,
    weeklyWorkouts: buildFallbackWeeklyWorkouts(schedule.dayPills),
    firstWeekGoals: defaultBullets,
    calorieTarget: args.calorieTarget,
    maintenanceCalories: args.maintenanceCalories,
    calorieAdjustment: args.calorieAdjustment,
    macros: args.macros,
    waterTargetMl: args.waterTargetMl,
  };
}

function isRestWorkout(label: string) {
  return /(rest|recover|recovery|mobility|walk|off)/i.test(label);
}

function fallbackExercises(label: string) {
  return recommendedExercisesForWorkoutLabel(label);
}

function buildFallbackWeeklyWorkouts(dayPills: string[]): NonNullable<GeneratedPlan['weeklyWorkouts']> {
  return dayPills.map((label, dayIndex) => {
    const exercises = fallbackExercises(label);
    return {
      dayIndex,
      label,
      templateName: isRestWorkout(label) ? `${label} Day` : `${label} Workout`,
      muscleGroups: Array.from(new Set(exercises.map((exercise) => exercise.muscleGroup))),
      isRestDay: exercises.length === 0,
      exercises,
    };
  });
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

function RevealCard({
  index,
  accentColor,
  backgroundColor,
  children,
}: {
  index: number;
  accentColor: string;
  backgroundColor: string;
  children: ReactNode;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(18);

  useEffect(() => {
    opacity.value = withDelay(index * 200, withTiming(1, { duration: 280 }));
    translateY.value = withDelay(index * 200, withTiming(0, { duration: 280 }));
  }, [index, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.revealCard, { backgroundColor, borderTopColor: accentColor }, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

function MacroPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macroPill}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    alignItems: 'center',
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
  checkWrap: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    marginTop: spacing.xs,
    width: 96,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  aiStatus: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginTop: -spacing.sm,
    textAlign: 'center',
  },
  placeholderText: {
    color: colors.textSecondary,
  },
  revealCard: {
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderTopWidth: 2,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    width: '100%',
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardKicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  calorieNumber: {
    color: colors.textPrimary,
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 44,
  },
  calorieUnit: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  calorieExplanation: {
    color: colors.emeraldLight,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  macroRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  macroPill: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: spacing.xs,
  },
  macroLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  macroValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  splitTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  dayPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  dayPill: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 34,
    minWidth: 58,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  dayPillText: {
    color: colors.amberLight,
    fontSize: 12,
    fontWeight: '900',
  },
  goalList: {
    gap: 10,
  },
  goalRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  goalDot: {
    backgroundColor: colors.violetLight,
    borderRadius: 4,
    height: 8,
    marginTop: 7,
    width: 8,
  },
  goalText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
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
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
});
