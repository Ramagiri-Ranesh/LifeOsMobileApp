import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createAuthUserForUsername, isUsernameAvailable, normalizeUsername, validateUsername } from '@/lib/auth';
import { calculateGoalCalorieTarget, calculateHydrationTarget, calculateMacros, calculateTDEE, type ActivityLevel, type FitnessGoal } from '@/lib/calculations';
import { buildProfilePayload } from '@/lib/profile';
import { colors, radii, spacing, typography } from '@/lib/design';
import { saveAccountSettings } from '@/lib/settingsService';
import { supabase } from '@/lib/supabase';
import { syncWaterLog } from '@/lib/waterLog';
import { useGymStore } from '@/stores/useGymStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useUserStore, type GeneratedPlan, type OnboardingProfile, type UserProfile } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;
const MIN_PASSWORD_LENGTH = 8;

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function RegisterScreen() {
  const router = useRouter();
  const draft = useUserStore((state) => state.onboardingProfile);
  const profile = useUserStore((state) => state.profile);
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const macros = useUserStore((state) => state.macros);
  const generatedPlan = useUserStore((state) => state.generatedPlan);
  const aiModel = useSettingsStore((state) => state.aiModel);
  const markSettingsSynced = useSettingsStore((state) => state.markSettingsSynced);
  const markSettingsError = useSettingsStore((state) => state.markSettingsError);
  const setProfile = useUserStore((state) => state.setProfile);
  const setPlanTargets = useUserStore((state) => state.setPlanTargets);
  const setGeneratedPlan = useUserStore((state) => state.setGeneratedPlan);
  const setSession = useUserStore((state) => state.setSession);
  const completeOnboarding = useUserStore((state) => state.completeOnboarding);
  const setWaterMl = useNutritionStore((state) => state.setWaterMl);
  const setCurrentSplit = useGymStore((state) => state.setCurrentSplit);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const showMessage = (title: string, message: string) => {
    setStatusMessage(message);
    Alert.alert(title, message);
  };

  const handleRegister = async () => {
    setStatusMessage(null);
    const normalizedUsername = normalizeUsername(username);
    const recovered = recoverRegistrationPlan({
      draft,
      profile,
      calorieGoal,
      macros,
      generatedPlan,
    });

    if (!recovered.profile.name.trim()) {
      showMessage('Profile missing', 'Please add your basic profile before creating the account.');
      router.replace('/(onboarding)/basic-profile');
      return;
    }

    if (!validateUsername(normalizedUsername)) {
      showMessage('Check username', 'Use 3-32 lowercase letters, numbers, dots, underscores, or hyphens.');
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      showMessage('Check password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSaving(true);
    setStatusMessage('Creating your account...');
    try {
      const available = await isUsernameAvailable(normalizedUsername);
      if (!available) {
        showMessage(
          'Username taken',
          'Choose another username or login. If this was an old LifeOS account, login will migrate it after the migration function is deployed.',
        );
        return;
      }

      const createdAuthUser = await createAuthUserForUsername(normalizedUsername, password);
      if (!createdAuthUser.email || !createdAuthUser.userId) {
        throw new Error(createdAuthUser.message ?? 'Unable to create the LifeOS auth user.');
      }

      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email: createdAuthUser.email,
        password,
      });

      if (signInError) throw signInError;

      const authUserId = authData.user?.id ?? createdAuthUser.userId;
      if (!authUserId || !authData.session) {
        showMessage('Registration paused', 'Auth user was created, but LifeOS could not start a login session. Try logging in with the same username and password.');
        return;
      }

      const payload = buildProfilePayload({
        username: normalizedUsername,
        draft,
        profile: recovered.profile,
        calorieGoal: recovered.calorieGoal,
        macros: recovered.macros,
        generatedPlan: recovered.generatedPlan,
        aiModel,
      });
      const { data, error } = await supabase
        .from('profiles')
        .insert({ ...payload, id: authUserId })
        .select('*')
        .single();
      if (error) throw error;

      const savedId = String((data as LooseRow).id ?? '');
      const settingsSync = await saveAccountSettings(savedId);
      if (settingsSync.ok) {
        markSettingsSynced(settingsSync.syncedAt);
      } else {
        markSettingsError(settingsSync.error);
      }

      const savedProfile = { ...recovered.profile, id: savedId, authUserId, username: normalizedUsername };
      setSession({ userId: savedId, username: normalizedUsername });
      setProfile(savedProfile);
      setPlanTargets(recovered.calorieGoal, recovered.macros, recovered.generatedPlan.waterTargetMl);
      setGeneratedPlan(recovered.generatedPlan);
      completeOnboarding();
      setWaterMl(0);
      setCurrentSplit(recovered.generatedPlan.workoutSplit);

      const { error: waterError } = await syncWaterLog({
        user_id: savedId,
        date: todayKey(),
        target_ml: recovered.generatedPlan.waterTargetMl,
        amount_ml: 0,
        glasses: 0,
      });
      if (waterError) console.warn('Unable to initialize water log', waterError.message);

      router.replace('/(tabs)');
    } catch (error) {
      console.warn('Unable to register user', error);
      const message = error instanceof Error && error.message
        ? error.message
        : 'Account creation failed. Check the Supabase Auth and RLS migrations, then try again.';
      showMessage('Registration failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="transparent" barStyle="light-content" translucent />
      <View style={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="person-add-outline" color={colors.violetLight} size={34} />
        </View>
        <Text style={styles.kicker}>Step 5 of 5</Text>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>This saves your onboarding once, then brings you straight to the dashboard next time.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setUsername(value);
              if (statusMessage) setStatusMessage(null);
            }}
            placeholder="username"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={username}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            onChangeText={(value) => {
              setPassword(value);
              if (statusMessage) setStatusMessage(null);
            }}
            onSubmitEditing={handleRegister}
            placeholder="password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {statusMessage ? <Text style={styles.statusText}>{statusMessage}</Text> : null}
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={handleRegister}
          style={[styles.primaryButton, saving && styles.disabledButton]}>
          <Text style={styles.primaryButtonText}>{saving ? 'Creating...' : 'Register and open dashboard'}</Text>
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

function fallbackDayPills(gymDaysPerWeek: number) {
  const gymDays = Math.max(1, Math.min(7, Math.round(gymDaysPerWeek)));
  const schedules: Record<number, { workoutSplit: string; dayPills: string[] }> = {
    1: { workoutSplit: 'Full Body: Sat', dayPills: ['Rest', 'Mobility', 'Rest', 'Walk', 'Rest', 'Full Body', 'Recovery'] },
    2: { workoutSplit: 'Full Body: Tue, Sat', dayPills: ['Rest', 'Full Body', 'Walk', 'Rest', 'Mobility', 'Full Body', 'Recovery'] },
    3: { workoutSplit: 'Full Body: Mon, Wed, Fri', dayPills: ['Full Body', 'Rest', 'Full Body', 'Rest', 'Full Body', 'Walk', 'Recovery'] },
    4: { workoutSplit: 'Upper/Lower: Mon, Tue, Thu, Sat', dayPills: ['Upper', 'Lower', 'Rest', 'Upper', 'Rest', 'Lower', 'Recovery'] },
    5: { workoutSplit: 'PPL + Upper/Lower: Mon-Fri', dayPills: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Recovery'] },
    6: { workoutSplit: 'PPL: Push/Pull/Legs twice weekly', dayPills: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs', 'Recovery'] },
    7: { workoutSplit: 'Daily training: 5 lifts + 2 recovery days', dayPills: ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Mobility', 'Recovery'] },
  };

  return schedules[gymDays] ?? schedules[3];
}

function recoverRegistrationPlan(args: {
  draft: OnboardingProfile;
  profile: UserProfile | null;
  calorieGoal: number;
  macros: { protein: number; carbs: number; fat: number };
  generatedPlan: GeneratedPlan | null;
}) {
  if (args.profile && args.generatedPlan) {
    return {
      profile: args.profile,
      calorieGoal: args.calorieGoal,
      macros: args.macros,
      generatedPlan: args.generatedPlan,
    };
  }

  const activityLevel = getActivityLevel(args.draft.gymDaysPerWeek);
  const fitnessGoal = getFitnessGoal(args.draft.goal);
  const maintenanceCalories = calculateTDEE(
    args.draft.currentWeight,
    args.draft.heightCm,
    args.draft.age,
    activityLevel,
    args.draft.gender,
  );
  const calorieGoal = calculateGoalCalorieTarget({
    maintenanceCalories,
    currentWeightKg: args.draft.currentWeight,
    targetWeightKg: args.draft.targetWeight,
    targetDate: args.draft.targetDate,
    weeklyWeightChangeKg: args.draft.weeklyWeightChangeKg,
    goal: fitnessGoal,
  }).calorieTarget;
  const macros = calculateMacros(calorieGoal, fitnessGoal);
  const waterTargetMl = calculateHydrationTarget(args.draft.currentWeight).waterTargetMl;
  const schedule = args.generatedPlan ?? fallbackDayPills(args.draft.gymDaysPerWeek);
  const generatedPlan: GeneratedPlan = args.generatedPlan ?? {
    workoutSplit: schedule.workoutSplit,
    dayPills: schedule.dayPills,
    firstWeekGoals: [
      'Complete the planned gym sessions and keep one recovery day protected.',
      'Hit protein at every meal using familiar foods first.',
      'Drink water steadily through the day instead of catching up at night.',
      'Log meals and workouts for seven days before changing targets.',
    ],
    waterTargetMl,
  };
  const profile: UserProfile = args.profile ?? {
    name: args.draft.name,
    gender: args.draft.gender,
    age: args.draft.age,
    heightCm: args.draft.heightCm,
    weightKg: args.draft.currentWeight,
    targetWeightKg: args.draft.targetWeight,
    targetDate: args.draft.targetDate,
    weeklyWeightChangeKg: args.draft.weeklyWeightChangeKg,
    gymDaysPerWeek: args.draft.gymDaysPerWeek,
    split: generatedPlan.workoutSplit,
    waterTargetMl: generatedPlan.waterTargetMl,
    currency: 'INR',
    measurements: 'metric',
    goal: args.draft.goal,
    experienceLevel: args.draft.experienceLevel,
    cuisinePrefs: args.draft.cuisinePrefs,
    foodsEaten: args.draft.foodsEaten,
    foodsAvoided: args.draft.foodsAvoided,
    firstMealTime: args.draft.firstMealTime,
    lastMealTime: args.draft.lastMealTime,
    aiCalcCalories: args.draft.aiCalcCalories,
  };

  return {
    profile,
    calorieGoal,
    macros,
    generatedPlan,
  };
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xl,
  },
  icon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.violetBg,
    borderColor: colors.border,
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 64,
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
  form: {
    marginTop: spacing.xl,
  },
  label: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  statusText: {
    color: colors.amberLight,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: spacing.sm,
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
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
});
