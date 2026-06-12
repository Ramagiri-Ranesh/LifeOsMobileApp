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

import { callAI } from '@/lib/ai';
import { calculateMacros, calculateTDEE, type ActivityLevel, type FitnessGoal } from '@/lib/calculations';
import { colors, radii, spacing, typography } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { useUserStore, type UserProfile } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

const ARJUN_HEIGHT_CM = 175;
const ARJUN_AGE = 29;
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
  bullets: string[];
};

export default function PlanRevealScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const completeOnboarding = useUserStore((state) => state.completeOnboarding);
  const [plan, setPlan] = useState<WeekPlan>({
    workoutSplit: 'PPL schedule',
    dayPills: defaultDayPills,
    bullets: defaultBullets,
  });
  const [isSaving, setIsSaving] = useState(false);
  const checkScale = useSharedValue(0.4);
  const checkOpacity = useSharedValue(0);

  const activityLevel = useMemo(() => getActivityLevel(draft.gymDaysPerWeek), [draft.gymDaysPerWeek]);
  const fitnessGoal = useMemo(() => getFitnessGoal(draft.goal), [draft.goal]);
  const calorieTarget = useMemo(
    () => calculateTDEE(draft.currentWeight, ARJUN_HEIGHT_CM, ARJUN_AGE, activityLevel),
    [activityLevel, draft.currentWeight],
  );
  const macros = useMemo(() => calculateMacros(calorieTarget, fitnessGoal), [calorieTarget, fitnessGoal]);

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
      try {
        const response = await callAI(
          'Generate a first-week fitness and nutrition onboarding plan. Return only JSON with keys workoutSplit, dayPills as 7 short labels, and bullets as exactly 4 concise goals.',
          {
            onboardingProfile: draft,
            calorieTarget,
            macros,
          },
        );
        const parsedPlan = parseWeekPlan(response);
        if (isMounted && parsedPlan) {
          setPlan(parsedPlan);
        }
      } catch (error) {
        console.warn('First-week plan generation unavailable.', error);
      }
    };

    generatePlan();

    return () => {
      isMounted = false;
    };
  }, [calorieTarget, draft, macros]);

  const fullProfile: UserProfile = {
    name: 'Arjun',
    weightKg: draft.currentWeight,
    targetWeightKg: draft.targetWeight,
    gymDaysPerWeek: draft.gymDaysPerWeek,
    split: plan.workoutSplit,
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
    const savedProfile = JSON.parse(JSON.stringify(fullProfile)) as Json;
    const savedPlan = JSON.parse(JSON.stringify(plan)) as Json;
    const savedMacros = JSON.parse(JSON.stringify(macros)) as Json;
    const payload: Record<string, Json> = {
      name: fullProfile.name,
      weight_kg: fullProfile.weightKg,
      target_weight_kg: fullProfile.targetWeightKg,
      gym_days_per_week: fullProfile.gymDaysPerWeek,
      split: fullProfile.split,
      currency: fullProfile.currency,
      measurements: fullProfile.measurements,
      goal: draft.goal,
      experience_level: draft.experienceLevel,
      cuisine_prefs: draft.cuisinePrefs,
      foods_eaten: draft.foodsEaten,
      foods_avoided: draft.foodsAvoided,
      first_meal_time: draft.firstMealTime,
      last_meal_time: draft.lastMealTime,
      calorie_goal: calorieTarget,
      macros: savedMacros,
      first_week_plan: savedPlan,
      onboarding_profile: savedProfile,
    };

    setProfile(fullProfile);
    setPlanTargets(calorieTarget, macros);
    completeOnboarding();
    router.replace('/(tabs)');

    void saveProfile(payload);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProgressDots step={4} />

        <Animated.View style={[styles.checkWrap, checkStyle]}>
          <Ionicons name="checkmark" color={colors.background} size={48} />
        </Animated.View>

        <Text style={styles.title}>Your plan is ready, Arjun</Text>

        <RevealCard index={0} accentColor={colors.emerald} backgroundColor={colors.emeraldBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>Calorie target</Text>
            <Ionicons name="flame-outline" color={colors.emeraldLight} size={20} />
          </View>
          <Text style={styles.calorieNumber}>{calorieTarget}</Text>
          <Text style={styles.calorieUnit}>kcal per day</Text>
          <View style={styles.macroRow}>
            <MacroPill label="Protein" value={`${macros.protein}g`} />
            <MacroPill label="Carbs" value={`${macros.carbs}g`} />
            <MacroPill label="Fat" value={`${macros.fat}g`} />
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

        <RevealCard index={2} accentColor={colors.violet} backgroundColor={colors.violetBg}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>First week goals</Text>
            <Ionicons name="sparkles-outline" color={colors.violetLight} size={20} />
          </View>
          <View style={styles.goalList}>
            {plan.bullets.slice(0, 4).map((bullet) => (
              <View key={bullet} style={styles.goalRow}>
                <View style={styles.goalDot} />
                <Text style={styles.goalText}>{bullet}</Text>
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
          <Text style={styles.primaryButtonText}>{isSaving ? 'Saving...' : "Let's go →"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

async function saveProfile(payload: Record<string, Json>) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Skipping profile cloud save because Supabase is not configured.');
    return;
  }

  try {
    const { error } = await supabase.from('profiles').insert(payload);

    if (error) {
      console.warn('Unable to save onboarding profile to Supabase.', error);
    }
  } catch (error) {
    console.warn('Unable to save onboarding profile to Supabase.', error);
  }
}

function getActivityLevel(gymDaysPerWeek: number): ActivityLevel {
  if (gymDaysPerWeek <= 2) return 'light';
  if (gymDaysPerWeek <= 4) return 'moderate';
  if (gymDaysPerWeek <= 6) return 'active';
  return 'veryActive';
}

function getFitnessGoal(goal: string): FitnessGoal {
  if (goal === 'Lose body fat') return 'cut';
  if (goal === 'Build muscle') return 'bulk';
  return 'maintain';
}

function parseWeekPlan(response: string): WeekPlan | null {
  const jsonText = response.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '');

  try {
    const parsed = JSON.parse(jsonText) as Partial<WeekPlan>;
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets.filter(Boolean).map(String).slice(0, 4) : [];
    const dayPills = Array.isArray(parsed.dayPills)
      ? parsed.dayPills.filter(Boolean).map(String).slice(0, 7)
      : defaultDayPills;

    return {
      workoutSplit: parsed.workoutSplit ? String(parsed.workoutSplit) : 'PPL schedule',
      dayPills: dayPills.length === 7 ? dayPills : defaultDayPills,
      bullets: bullets.length === 4 ? bullets : defaultBullets,
    };
  } catch {
    const bullets = response
      .split('\n')
      .map((line) => line.replace(/^[-*0-9. ]+/, '').trim())
      .filter(Boolean)
      .slice(0, 4);

    if (bullets.length === 0) return null;

    return {
      workoutSplit: 'PPL schedule',
      dayPills: defaultDayPills,
      bullets: bullets.length === 4 ? bullets : defaultBullets,
    };
  }
}

function ProgressDots({ step }: { step: number }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4].map((dot) => (
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
