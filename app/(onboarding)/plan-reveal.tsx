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
  weeklyWorkouts: NonNullable<GeneratedPlan['weeklyWorkouts']>;
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
    () => calculateTDEE(draft.currentWeight, draft.heightCm, draft.age, activityLevel, draft.gender),
    [activityLevel, draft.age, draft.currentWeight, draft.gender, draft.heightCm],
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
  const [isAwaitingAIPlan, setIsAwaitingAIPlan] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const generatedPlanKey = useRef<string | null>(null);
  const checkScale = useSharedValue(0.4);
  const checkOpacity = useSharedValue(0);
  const planCacheKey = useMemo(
    () =>
      JSON.stringify({
        aiPlanParserVersion: 2,
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
        setIsAwaitingAIPlan(false);
        setAiStatus(draft.aiCalcCalories ? 'AI plan restored from this session.' : 'Plan calculated without AI.');
        return;
      }

      setPlan(fallbackPlan);
      setIsAwaitingAIPlan(false);

      if (!draft.aiCalcCalories) {
        planCache.set(planCacheKey, fallbackPlan);
        setAiStatus('Plan calculated without AI.');
        return;
      }

      try {
        setIsAwaitingAIPlan(true);
        setAiStatus('Generating your AI plan...');
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
          setIsAwaitingAIPlan(false);
          planCache.set(planCacheKey, parsedPlan);
          setAiStatus('AI plan generated with OpenAI.');
        } else if (isMounted) {
          setIsAwaitingAIPlan(false);
          setAiStatus('OpenAI is unavailable, so LifeOS used the safe fallback calculation.');
        }
      } catch (error) {
        console.warn('First-week plan generation unavailable.', error);
        if (isMounted) {
          setIsAwaitingAIPlan(false);
          setAiStatus('AI plan generation failed, so LifeOS used the safe fallback calculation.');
        }
      }
    };

    generatePlan();

    return () => {
      isMounted = false;
    };
  }, [draft, fallbackPlan, planCacheKey]);

  const fullProfile: UserProfile = {
    name: draft.name,
    gender: draft.gender,
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
    if (isSaving || isAwaitingAIPlan) return;

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
  const isAIPlaceholderVisible = draft.aiCalcCalories && isAwaitingAIPlan;

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
            {isAIPlaceholderVisible ? 'AI calculating water target...' : `${plan.waterTargetMl} ml per day`}
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
          disabled={isSaving || isAwaitingAIPlan}
          onPress={handleFinish}
          style={[styles.primaryButton, (isSaving || isAwaitingAIPlan) && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonText}>{isSaving ? 'Preparing...' : isAwaitingAIPlan ? 'Generating AI plan...' : "Let's go →"}</Text>
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
    weeklyWorkouts: buildFallbackWeeklyWorkouts(schedule.dayPills),
    firstWeekGoals: defaultBullets,
    calorieTarget: args.calorieTarget,
    macros: args.macros,
    waterTargetMl: args.waterTargetMl,
  };
}

function isRestWorkout(label: string) {
  return /(rest|recover|recovery|mobility|walk|off)/i.test(label);
}

function fallbackExercises(label: string) {
  const key = label.toLowerCase();
  if (isRestWorkout(label)) return [];
  if (key.includes('push')) {
    return [
      { name: 'Bench Press', muscleGroup: 'chest', targetSets: 4, reps: 8 },
      { name: 'Incline Press', muscleGroup: 'chest', targetSets: 3, reps: 10 },
      { name: 'Shoulder Press', muscleGroup: 'shoulders', targetSets: 3, reps: 8 },
      { name: 'Triceps Pushdown', muscleGroup: 'triceps', targetSets: 3, reps: 12 },
    ];
  }
  if (key.includes('pull')) {
    return [
      { name: 'Lat Pulldown', muscleGroup: 'back', targetSets: 4, reps: 10 },
      { name: 'Row', muscleGroup: 'back', targetSets: 3, reps: 8 },
      { name: 'Face Pull', muscleGroup: 'shoulders', targetSets: 3, reps: 12 },
      { name: 'Biceps Curl', muscleGroup: 'biceps', targetSets: 3, reps: 12 },
    ];
  }
  if (key.includes('leg') || key.includes('lower')) {
    return [
      { name: 'Squat', muscleGroup: 'quads', targetSets: 4, reps: 6 },
      { name: 'Romanian Deadlift', muscleGroup: 'hamstrings', targetSets: 3, reps: 8 },
      { name: 'Leg Press', muscleGroup: 'quads', targetSets: 3, reps: 10 },
      { name: 'Calf Raise', muscleGroup: 'calves', targetSets: 4, reps: 14 },
    ];
  }
  if (key.includes('upper')) {
    return [
      { name: 'Bench Press', muscleGroup: 'chest', targetSets: 3, reps: 8 },
      { name: 'Row', muscleGroup: 'back', targetSets: 3, reps: 8 },
      { name: 'Shoulder Press', muscleGroup: 'shoulders', targetSets: 3, reps: 10 },
      { name: 'Biceps Curl', muscleGroup: 'biceps', targetSets: 2, reps: 12 },
      { name: 'Triceps Pushdown', muscleGroup: 'triceps', targetSets: 2, reps: 12 },
    ];
  }
  return [
    { name: 'Squat', muscleGroup: 'quads', targetSets: 3, reps: 6 },
    { name: 'Bench Press', muscleGroup: 'chest', targetSets: 3, reps: 8 },
    { name: 'Row', muscleGroup: 'back', targetSets: 3, reps: 8 },
    { name: 'Plank', muscleGroup: 'core', targetSets: 3, reps: 45 },
  ];
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
        'Return only JSON with keys calorieTarget, macros { protein, carbs, fat }, waterTargetMl, workoutSplit, dayPills as 7 short labels, weeklyWorkouts, and firstWeekGoals as exactly 4 concise goals.',
        'weeklyWorkouts must be an array of 7 objects: dayIndex 0-6 where 0 is Monday, label, templateName, muscleGroups, isRestDay, and exercises. Each exercise needs name, muscleGroup, targetSets, reps, and optional weightKg.',
        `Start from these calculated targets, then adjust if the profile calls for it: ${context.fallbackPlan.calorieTarget} kcal, protein ${context.fallbackPlan.macros.protein}g, carbs ${context.fallbackPlan.macros.carbs}g, fat ${context.fallbackPlan.macros.fat}g, water ${context.fallbackPlan.waterTargetMl}ml.`,
        'calorieTarget, macros, and waterTargetMl must be realistic positive integers and should reflect the user goal.',
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
      { allowOpenAI: true, allowUnauthenticatedAI: true, responseFormat: 'json_object' },
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
    const parsed = unwrapAIJson(JSON.parse(jsonText));
    if (!isRecord(parsed)) return null;

    const firstWeekGoals = parseTextList(
      firstArray(parsed, ['firstWeekGoals', 'first_week_goals', 'weeklyGoals', 'weekly_goals', 'goals', 'bullets']),
      ['goal', 'text', 'title', 'description'],
    ).slice(0, 4);
    const dayPills = parseTextList(firstArray(parsed, ['dayPills', 'day_pills', 'schedule', 'days'])).slice(0, 7);
    const validDayPills = dayPills.length === 7 && workoutDayCount(dayPills) === Math.round(gymDaysPerWeek);
    const weeklyWorkouts = parseWeeklyWorkouts(
      firstArray(parsed, ['weeklyWorkouts', 'weekly_workouts', 'workouts']),
      validDayPills ? dayPills : fallback.dayPills,
    );
    const calorieTarget = parseRequiredBoundedNumber(parsed, ['calorieTarget', 'calorie_target', 'calories', 'calorieGoal', 'calorie_goal'], {
      min: Math.max(1200, Math.round(fallback.calorieTarget * 0.65)),
      max: Math.min(5000, Math.round(fallback.calorieTarget * 1.35)),
    });
    const macros = parseRequiredMacros(firstRecord(parsed, ['macros', 'macroTargets', 'macro_targets'], parsed));
    const waterTargetMl = parseRequiredBoundedNumber(parsed, ['waterTargetMl', 'water_target_ml', 'dailyWaterMl', 'daily_water_ml', 'water'], {
      min: 1500,
      max: 6000,
      step: 50,
    });
    if (!calorieTarget || !macros || !waterTargetMl || firstWeekGoals.length === 0) return null;

    return {
      workoutSplit: validDayPills ? firstText(parsed, ['workoutSplit', 'workout_split', 'split'], fallback.workoutSplit) : fallback.workoutSplit,
      dayPills: validDayPills ? dayPills : fallback.dayPills,
      weeklyWorkouts,
      firstWeekGoals,
      calorieTarget,
      macros,
      waterTargetMl,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapAIJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return unwrapAIJson(JSON.parse(value));
    } catch {
      return value;
    }
  }

  if (isRecord(value) && typeof value.text === 'string') {
    return unwrapAIJson(value.text);
  }

  return value;
}

function firstArray(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstRecord(row: Record<string, unknown>, keys: string[], fallback: Record<string, unknown> = {}) {
  for (const key of keys) {
    const value = row[key];
    if (isRecord(value)) return value;
  }
  return fallback;
}

function firstText(row: Record<string, unknown>, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function parseTextList(value: unknown[], objectKeys: string[] = []) {
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (isRecord(item)) return firstText(item, objectKeys, '').trim();
      return '';
    })
    .filter(Boolean);
}

function parseBoundedNumber(
  row: Record<string, unknown>,
  keys: string[],
  fallback: number,
  bounds: { min: number; max: number; step?: number },
) {
  return parseRequiredBoundedNumber(row, keys, bounds) ?? fallback;
}

function parseRequiredBoundedNumber(
  row: Record<string, unknown>,
  keys: string[],
  bounds: { min: number; max: number; step?: number },
) {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[^\d.]/g, '')) : NaN;
    if (Number.isFinite(parsed) && parsed >= bounds.min && parsed <= bounds.max) {
      const rounded = Math.round(parsed);
      return bounds.step ? Math.round(rounded / bounds.step) * bounds.step : rounded;
    }
  }
  return null;
}

function parseMacros(row: Record<string, unknown>, fallback: WeekPlan['macros']) {
  return {
    protein: parseBoundedNumber(row, ['protein', 'proteinG', 'protein_g'], fallback.protein, { min: 40, max: 350 }),
    carbs: parseBoundedNumber(row, ['carbs', 'carb', 'carbsG', 'carbs_g'], fallback.carbs, { min: 40, max: 700 }),
    fat: parseBoundedNumber(row, ['fat', 'fatG', 'fat_g'], fallback.fat, { min: 20, max: 250 }),
  };
}

function parseRequiredMacros(row: Record<string, unknown>) {
  const protein = parseRequiredBoundedNumber(row, ['protein', 'proteinG', 'protein_g'], { min: 40, max: 350 });
  const carbs = parseRequiredBoundedNumber(row, ['carbs', 'carb', 'carbsG', 'carbs_g'], { min: 40, max: 700 });
  const fat = parseRequiredBoundedNumber(row, ['fat', 'fatG', 'fat_g'], { min: 20, max: 250 });

  return protein && carbs && fat ? { protein, carbs, fat } : null;
}

function parseWeeklyWorkouts(value: unknown, dayPills: string[]): NonNullable<GeneratedPlan['weeklyWorkouts']> {
  if (!Array.isArray(value)) return buildFallbackWeeklyWorkouts(dayPills);

  const parsed = value.slice(0, 7).map((item, fallbackIndex) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const label = String(row.label || dayPills[fallbackIndex] || 'Workout');
    const rawExercises = Array.isArray(row.exercises) ? row.exercises : [];
    const exercises = rawExercises
      .filter((exercise): exercise is Record<string, unknown> => Boolean(exercise) && typeof exercise === 'object' && !Array.isArray(exercise))
      .map((exercise) => ({
        name: String(exercise.name || 'Exercise'),
        muscleGroup: String(exercise.muscleGroup || exercise.muscle_group || 'chest'),
        targetSets: Math.max(1, Math.round(Number(exercise.targetSets || exercise.target_sets || 3))),
        reps: Math.max(1, Math.round(Number(exercise.reps || 8))),
        weightKg: Math.max(0, Number(exercise.weightKg || exercise.weight_kg || 0)),
      }));

    return {
      dayIndex: Math.max(0, Math.min(6, Math.round(Number(row.dayIndex ?? row.day_index ?? fallbackIndex)))),
      label,
      templateName: String(row.templateName || row.template_name || (isRestWorkout(label) ? `${label} Day` : `${label} Workout`)),
      muscleGroups: Array.isArray(row.muscleGroups)
        ? row.muscleGroups.filter(Boolean).map(String)
        : Array.from(new Set(exercises.map((exercise) => exercise.muscleGroup))),
      isRestDay: row.isRestDay === true || row.is_rest_day === true || exercises.length === 0 || isRestWorkout(label),
      exercises,
    };
  });

  return parsed.length === 7 ? parsed : buildFallbackWeeklyWorkouts(dayPills);
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
