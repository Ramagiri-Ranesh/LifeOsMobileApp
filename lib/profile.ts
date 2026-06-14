import type { GeneratedPlan, OnboardingProfile, UserProfile } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asGender(value: Json | undefined): UserProfile['gender'] {
  return value === 'female' ? 'female' : 'male';
}

function asWeeklyWorkouts(value: Json | undefined): GeneratedPlan['weeklyWorkouts'] {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter((item): item is LooseRow => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((day) => {
      const exercises = Array.isArray(day.exercises)
        ? day.exercises
            .filter((exercise): exercise is LooseRow => Boolean(exercise) && typeof exercise === 'object' && !Array.isArray(exercise))
            .map((exercise) => ({
              name: asText(exercise.name, 'Exercise'),
              muscleGroup: asText(exercise.muscleGroup) || asText(exercise.muscle_group),
              targetSets: asNumber(exercise.targetSets) || asNumber(exercise.target_sets, 3),
              reps: asNumber(exercise.reps, 8),
              weightKg: asNumber(exercise.weightKg) || asNumber(exercise.weight_kg, 0),
            }))
        : [];

      return {
        dayIndex: asNumber(day.dayIndex) || asNumber(day.day_index, 0),
        label: asText(day.label, 'Workout'),
        templateName: asText(day.templateName) || asText(day.template_name, asText(day.label, 'Workout')),
        muscleGroups: asStringArray(day.muscleGroups).length > 0
          ? asStringArray(day.muscleGroups)
          : asStringArray(day.muscle_groups),
        isRestDay: day.isRestDay === true || day.is_rest_day === true,
        exercises,
      };
    });
}

function asMacros(value: Json | undefined, fallback: { protein: number; carbs: number; fat: number }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const row = value as LooseRow;
  return {
    protein: asNumber(row.protein, fallback.protein),
    carbs: asNumber(row.carbs, fallback.carbs),
    fat: asNumber(row.fat, fallback.fat),
  };
}

function fitnessGoalSlug(goal?: string) {
  const normalized = goal?.toLowerCase() ?? '';
  if (normalized.includes('build muscle') && normalized.includes('lose fat')) return 'build_muscle_lose_fat';
  if (normalized.includes('build muscle') || normalized.includes('bulk')) return 'build_muscle';
  if (normalized.includes('lose')) return 'lose_body_fat';
  return 'stay_fit';
}

export function buildProfilePayload(args: {
  username: string;
  draft: OnboardingProfile;
  profile: UserProfile;
  calorieGoal: number;
  macros: { protein: number; carbs: number; fat: number };
  generatedPlan: GeneratedPlan;
  aiModel?: 'openai' | 'ollama';
}) {
  const onboardingProfile = JSON.parse(JSON.stringify(args.draft)) as Json;
  const firstWeekPlan = JSON.parse(JSON.stringify(args.generatedPlan)) as Json;
  const macros = JSON.parse(JSON.stringify(args.macros)) as Json;

  return {
    username: args.username,
    name: args.profile.name,
    gender: args.profile.gender,
    age: args.profile.age,
    height_cm: args.profile.heightCm,
    weight_kg: args.profile.weightKg,
    target_weight_kg: args.profile.targetWeightKg,
    gym_days_per_week: args.profile.gymDaysPerWeek,
    split: args.profile.split,
    workout_split: args.profile.split,
    currency: args.profile.currency,
    measurements: args.profile.measurements,
    goal: args.profile.goal,
    fitness_goal: fitnessGoalSlug(args.profile.goal),
    experience_level: args.profile.experienceLevel,
    cuisine_prefs: args.profile.cuisinePrefs,
    foods_to_avoid: args.profile.foodsAvoided,
    foods_eaten: args.profile.foodsEaten,
    foods_avoided: args.profile.foodsAvoided,
    first_meal_time: args.profile.firstMealTime,
    last_meal_time: args.profile.lastMealTime,
    ai_calc_calories: args.profile.aiCalcCalories,
    ai_model: args.aiModel ?? 'openai',
    calorie_goal: args.calorieGoal,
    protein_goal_g: args.macros.protein,
    carbs_goal_g: args.macros.carbs,
    fat_goal_g: args.macros.fat,
    macros,
    daily_water_goal_ml: args.profile.waterTargetMl,
    water_target_ml: args.profile.waterTargetMl,
    first_week_plan: firstWeekPlan,
    onboarding_profile: onboardingProfile,
    onboarding_completed: true,
  };
}

export function profileFromRow(row: LooseRow): {
  profile: UserProfile;
  calorieGoal: number;
  macros: { protein: number; carbs: number; fat: number };
  generatedPlan: GeneratedPlan | null;
  onboardingCompleted: boolean;
} {
  const macros = asMacros(row.macros, { protein: 165, carbs: 240, fat: 72 });
  const planRow = row.first_week_plan && typeof row.first_week_plan === 'object' && !Array.isArray(row.first_week_plan)
    ? (row.first_week_plan as LooseRow)
    : null;
  const waterTargetMl = asNumber(row.daily_water_goal_ml) || asNumber(row.water_target_ml, 3000);
  const generatedPlan = planRow
      ? {
        workoutSplit: asText(planRow.workoutSplit) || asText(row.workout_split) || asText(row.split, 'PPL schedule'),
        dayPills: asStringArray(planRow.dayPills),
        weeklyWorkouts: asWeeklyWorkouts(planRow.weeklyWorkouts) ?? asWeeklyWorkouts(planRow.weekly_workouts),
        firstWeekGoals: asStringArray(planRow.firstWeekGoals).length > 0
          ? asStringArray(planRow.firstWeekGoals)
          : asStringArray(planRow.bullets),
        waterTargetMl: asNumber(planRow.waterTargetMl, waterTargetMl),
      }
    : null;

  return {
    profile: {
      id: asText(row.id),
      username: asText(row.username),
      name: asText(row.name, 'User'),
      gender: asGender(row.gender),
      age: asNumber(row.age, 29),
      heightCm: asNumber(row.height_cm, 175),
      weightKg: asNumber(row.weight_kg, 75),
      targetWeightKg: asNumber(row.target_weight_kg, 72),
      gymDaysPerWeek: asNumber(row.gym_days_per_week, 4),
      split: asText(row.workout_split) || asText(row.split, 'PPL schedule'),
      waterTargetMl,
      currency: 'INR',
      measurements: 'metric',
      goal: asText(row.goal),
      experienceLevel: asText(row.experience_level),
      cuisinePrefs: asStringArray(row.cuisine_prefs),
      foodsEaten: asStringArray(row.foods_eaten),
      foodsAvoided: asStringArray(row.foods_avoided),
      firstMealTime: asText(row.first_meal_time, '07:00'),
      lastMealTime: asText(row.last_meal_time, '21:00'),
      aiCalcCalories: row.ai_calc_calories === true,
      lastBodyRecalibrationAt: asText(row.last_body_recalibration_at) || null,
      bodyRecalibrationCount: asNumber(row.body_recalibration_count, 0),
    },
    calorieGoal: asNumber(row.calorie_goal, 2380),
    macros,
    generatedPlan,
    onboardingCompleted: row.onboarding_completed === true,
  };
}
