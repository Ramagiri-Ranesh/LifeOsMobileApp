import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { callAI } from '@/lib/ai';
import { calculateMacros, calculateTDEE, type ActivityLevel, type FitnessGoal } from '@/lib/calculations';
import { colors, radii, spacing, typography } from '@/lib/design';
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
  firstWeekGoals: string[];
  calorieTarget: number;
  macros: { protein: number; carbs: number; fat: number };
  waterTargetMl: number;
};

const planCache = new Map<string, WeekPlan>();
const planRequests = new Map<string, Promise<WeekPlan | null>>();

export default function PlanRevealScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const setGeneratedPlan = useUserStore((state) => state.setGeneratedPlan);
  const activityLevel = useMemo(() => getActivityLevel(draft.gymDaysPerWeek), [draft.gymDaysPerWeek]);
  const fitnessGoal = useMemo(() => getFitnessGoal(draft.goal), [draft.goal]);
  const fallbackCalorieTarget = useMemo(
    () => calculateTDEE(draft.currentWeight, draft.heightCm, draft.age, activityLevel),
    [activityLevel, draft.age, draft.currentWeight, draft.heightCm],
  );
  const fallbackMacros = useMemo(
    () => calculateMacros(fallbackCalorieTarget, fitnessGoal),
    [fallbackCalorieTarget, fitnessGoal],
  );
  const fallbackWaterTargetMl = useMemo(
    () => Math.round(Math.max(2200, draft.currentWeight * 35) / 250) * 250,
    [draft.currentWeight],
  );
  const fallbackPlan = useMemo(
    () =>
      buildFallbackWeekPlan({
        gymDaysPerWeek: draft.gymDaysPerWeek,
        calorieTarget: fallbackCalorieTarget,
        macros: fallbackMacros,
        waterTargetMl: fallbackWaterTargetMl,
      }),
    [draft.gymDaysPerWeek, fallbackCalorieTarget, fallbackMacros, fallbackWaterTargetMl],
  );
  const [plan, setPlan] = useState<WeekPlan>(fallbackPlan);
  const [aiStatus, setAiStatus] = useState('Calculating with AI...');
  const [isSaving, setIsSaving] = useState(false);
  const generatedPlanKey = useRef<string | null>(null);
  const checkScale = useSharedValue(0.4);
  const checkOpacity = useSharedValue(0);
  const planCacheKey = useMemo(
    () =>
      JSON.stringify({
        draft,
        fallbackPlan,
      }),
    [draft, fallbackPlan],
  );

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  useEffect(() => {
    checkScale.value = withSpring(1, { damping: 10, stiffness: 130 });
    checkOpacity.value = withTiming(1, { duration: 220 });
  }, [checkOpacity, checkScale]);

  useEffect(() => {
    let isMounted = true;

    const generatePlan = async () => {
      if (generatedPlanKey.current === planCacheKey) return;
      generatedPlanKey.current = planCacheKey;

      const cachedPlan = planCache.get(planCacheKey);
      if (cachedPlan) {
        setPlan(cachedPlan);
        setAiStatus(draft.aiCalcCalories ? 'AI plan restored from this session.' : 'Plan calculated without AI.');
        return;
      }

      setPlan(fallbackPlan);

      if (!draft.aiCalcCalories) {
        planCache.set(planCacheKey, fallbackPlan);
        setAiStatus('Plan calculated without AI.');
        return;
      }

      try {
        const pendingPlan =
          planRequests.get(planCacheKey) ??
          requestGeneratedPlan(planCacheKey, {
            draft,
            fallbackPlan,
          });
        planRequests.set(planCacheKey, pendingPlan);
        const parsedPlan = await pendingPlan;
        if (isMounted && parsedPlan) {
          setPlan(parsedPlan);
          planCache.set(planCacheKey, parsedPlan);
          setAiStatus('AI plan generated with OpenAI.');
        } else if (isMounted) {
          setAiStatus('OpenAI is unavailable, so LifeOS used the safe fallback calculation.');
        }
      } catch (error) {
        console.warn('First-week plan generation unavailable.', error);
        if (isMounted) setAiStatus('AI plan generation failed, so LifeOS used the safe fallback calculation.');
      }
    };

    generatePlan();

    return () => {
      isMounted = false;
    };
  }, [draft, fallbackPlan, planCacheKey]);

  const fullProfile: UserProfile = {
    name: draft.name,
    age: draft.age,
    heightCm: draft.heightCm,
    weightKg: draft.currentWeight,
    targetWeightKg: draft.targetWeight,
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
      firstWeekGoals: plan.firstWeekGoals,
      waterTargetMl: plan.waterTargetMl,
    };

    setProfile(fullProfile);
    setPlanTargets(plan.calorieTarget, plan.macros, plan.waterTargetMl);
    setGeneratedPlan(generatedPlan);
    router.push('/(onboarding)/register');
  };

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
          <Text style={styles.calorieNumber}>{plan.calorieTarget}</Text>
          <Text style={styles.calorieUnit}>kcal per day</Text>
          <View style={styles.macroRow}>
            <MacroPill label="Protein" value={`${plan.macros.protein}g`} />
            <MacroPill label="Carbs" value={`${plan.macros.carbs}g`} />
            <MacroPill label="Fat" value={`${plan.macros.fat}g`} />
          </View>
        </RevealCard>

        <RevealCard index={1} accentColor={colors.amber} backgroundColor={colors.amberBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>Workout split</Text>
            <Ionicons name="barbell-outline" color={colors.amberLight} size={20} />
          </View>
          <Text style={styles.splitTitle}>{plan.workoutSplit}</Text>
          <View style={styles.dayPillRow}>
            {plan.dayPills.slice(0, 7).map((day, index) => (
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
          <Text style={styles.splitTitle}>{plan.waterTargetMl} ml per day</Text>
        </RevealCard>

        <RevealCard index={3} accentColor={colors.violet} backgroundColor={colors.violetBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>First week goals</Text>
            <Ionicons name="sparkles-outline" color={colors.violetLight} size={20} />
          </View>
          <View style={styles.goalList}>
            {plan.firstWeekGoals.slice(0, 4).map((goal) => (
              <View key={goal} style={styles.goalRow}>
                <View style={styles.goalDot} />
                <Text style={styles.goalText}>{goal}</Text>
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
    firstWeekGoals: defaultBullets,
    calorieTarget: args.calorieTarget,
    macros: args.macros,
    waterTargetMl: args.waterTargetMl,
  };
}

function workoutDayCount(dayPills: string[]) {
  return dayPills.filter((day) => !/(rest|recover|mobility|walk|off)/i.test(day)).length;
}

async function requestGeneratedPlan(
  cacheKey: string,
  context: {
    draft: ReturnType<typeof useUserStore.getState>['onboardingProfile'];
    fallbackPlan: WeekPlan;
  },
) {
  try {
    const response = await callAI(
      [
        'Generate a first-week fitness and nutrition onboarding plan.',
        'Return only JSON with keys calorieTarget, macros { protein, carbs, fat }, waterTargetMl, workoutSplit, dayPills as 7 short labels, and firstWeekGoals as exactly 4 concise goals.',
        `Use these exact calculated nutrition targets: ${context.fallbackPlan.calorieTarget} kcal, protein ${context.fallbackPlan.macros.protein}g, carbs ${context.fallbackPlan.macros.carbs}g, fat ${context.fallbackPlan.macros.fat}g, water ${context.fallbackPlan.waterTargetMl}ml.`,
        `The workout plan must contain exactly ${context.draft.gymDaysPerWeek} gym days in 7 dayPills. Use rest, walk, mobility, or recovery labels for non-gym days.`,
        'Respect disliked foods and meal timing. Use metric units.',
      ].join(' '),
      {
        profile: null,
        calorieGoal: context.fallbackPlan.calorieTarget,
        macros: context.fallbackPlan.macros,
        currentWorkoutSplit: context.fallbackPlan.workoutSplit,
        onboardingProfile: context.draft,
        calculatedPlan: context.fallbackPlan,
      },
      { allowOpenAI: true, responseFormat: 'json_object' },
    );

    if (!response.trim()) return null;

    const parsedPlan = parseWeekPlan(response, context.fallbackPlan, context.draft.gymDaysPerWeek);
    if (parsedPlan) planCache.set(cacheKey, parsedPlan);
    return parsedPlan;
  } finally {
    planRequests.delete(cacheKey);
  }
}

function parseWeekPlan(
  response: string,
  fallback: WeekPlan,
  gymDaysPerWeek: number,
): WeekPlan | null {
  const jsonText = response.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '');

  try {
    const parsed = JSON.parse(jsonText) as Partial<WeekPlan>;
    const firstWeekGoalsSource = Array.isArray(parsed.firstWeekGoals)
      ? parsed.firstWeekGoals
      : Array.isArray((parsed as { bullets?: unknown }).bullets)
        ? (parsed as { bullets: unknown[] }).bullets
        : [];
    const firstWeekGoals = firstWeekGoalsSource.filter(Boolean).map(String).slice(0, 4);
    const dayPills = Array.isArray(parsed.dayPills)
      ? parsed.dayPills.filter(Boolean).map(String).slice(0, 7)
      : defaultDayPills;
    const validDayPills = dayPills.length === 7 && workoutDayCount(dayPills) === Math.round(gymDaysPerWeek);

    return {
      workoutSplit: validDayPills && parsed.workoutSplit ? String(parsed.workoutSplit) : fallback.workoutSplit,
      dayPills: validDayPills ? dayPills : fallback.dayPills,
      firstWeekGoals: firstWeekGoals.length === 4 ? firstWeekGoals : defaultBullets,
      calorieTarget: fallback.calorieTarget,
      macros: fallback.macros,
      waterTargetMl: fallback.waterTargetMl,
    };
  } catch {
    const firstWeekGoals = response
      .split('\n')
      .map((line) => line.replace(/^[-*0-9. ]+/, '').trim())
      .filter(Boolean)
      .slice(0, 4);

    if (firstWeekGoals.length === 0) return null;

    return {
      workoutSplit: fallback.workoutSplit,
      dayPills: fallback.dayPills,
      firstWeekGoals: firstWeekGoals.length === 4 ? firstWeekGoals : defaultBullets,
      calorieTarget: fallback.calorieTarget,
      macros: fallback.macros,
      waterTargetMl: fallback.waterTargetMl,
    };
  }
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
