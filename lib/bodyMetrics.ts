import { calculateMacros, calculateTDEE, type ActivityLevel, type FitnessGoal } from '@/lib/calculations';
import { callAI } from '@/lib/ai';
import { supabase } from '@/lib/supabase';
import type { GeneratedPlan, UserProfile } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

export type BodyMetricLog = {
  id?: string;
  userId: string;
  date: string;
  weightKg?: number;
  waistCm?: number;
  chestCm?: number;
  armCm?: number;
  hipCm?: number;
  thighCm?: number;
  notes?: string;
};

export type BodyRecalibration = {
  calorieGoal: number;
  macros: { protein: number; carbs: number; fat: number };
  generatedPlan: GeneratedPlan;
  split: string;
  weightKg: number;
  trendSummary: string;
  source: 'ai' | 'fallback';
  note: string;
};

type LooseRow = Record<string, Json | undefined>;

const RECALIBRATION_COOLDOWN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GOALS = [
  'Log body weight every morning.',
  'Hit protein target on training days.',
  'Complete the planned split before adding volume.',
  'Review weight trend again in 14 days.',
];

function asNumber(value: Json | undefined, fallback = 0) {
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function numberOrUndefined(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function rowToBodyMetric(row: LooseRow): BodyMetricLog {
  return {
    id: asText(row.id),
    userId: asText(row.user_id),
    date: asText(row.date).slice(0, 10),
    weightKg: numberOrUndefined(asNumber(row.weight_kg)),
    waistCm: numberOrUndefined(asNumber(row.waist_cm)),
    chestCm: numberOrUndefined(asNumber(row.chest_cm)),
    armCm: numberOrUndefined(asNumber(row.arm_cm)),
    hipCm: numberOrUndefined(asNumber(row.hip_cm)),
    thighCm: numberOrUndefined(asNumber(row.thigh_cm)),
    notes: asText(row.notes),
  };
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function daysBetween(from: Date, to = new Date()) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function nextBodyRecalibrationDate(lastRecalibrationAt?: string | null) {
  if (!lastRecalibrationAt) return null;
  const date = new Date(lastRecalibrationAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + RECALIBRATION_COOLDOWN_DAYS);
  return date;
}

export function canRecalibrateBodyPlan(lastRecalibrationAt?: string | null, now = new Date()) {
  const next = nextBodyRecalibrationDate(lastRecalibrationAt);
  return !next || next.getTime() <= now.getTime();
}

export async function loadBodyMetrics(userId: string, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, days));

  const { data, error } = await supabase
    .from('body_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('date', localDateKey(since))
    .order('date', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as LooseRow[]).map(rowToBodyMetric);
}

export async function saveBodyMetric(log: BodyMetricLog) {
  const existing = await supabase
    .from('body_metrics')
    .select('*')
    .eq('user_id', log.userId)
    .eq('date', log.date)
    .limit(1);

  if (existing.error) throw existing.error;
  const existingRow = ((existing.data ?? []) as LooseRow[])[0];
  const existingLog = existingRow ? rowToBodyMetric(existingRow) : null;

  const payload = {
    user_id: log.userId,
    date: log.date,
    weight_kg: log.weightKg ?? existingLog?.weightKg ?? null,
    waist_cm: log.waistCm ?? existingLog?.waistCm ?? null,
    chest_cm: log.chestCm ?? existingLog?.chestCm ?? null,
    arm_cm: log.armCm ?? existingLog?.armCm ?? null,
    hip_cm: log.hipCm ?? existingLog?.hipCm ?? null,
    thigh_cm: log.thighCm ?? existingLog?.thighCm ?? null,
    notes: log.notes?.trim() || existingLog?.notes || null,
    updated_at: new Date().toISOString(),
  };

  const existingId = asText(existingRow?.id);
  const query = existingId
    ? supabase.from('body_metrics').update(payload).eq('id', existingId)
    : supabase.from('body_metrics').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return rowToBodyMetric((data ?? {}) as LooseRow);
}

function getActivityLevel(gymDaysPerWeek: number): ActivityLevel {
  if (gymDaysPerWeek <= 1) return 'sedentary';
  if (gymDaysPerWeek <= 3) return 'light';
  if (gymDaysPerWeek <= 5) return 'moderate';
  if (gymDaysPerWeek <= 6) return 'active';
  return 'veryActive';
}

function goalFromProfile(goal?: string): FitnessGoal {
  const normalized = goal?.toLowerCase() ?? '';
  if (normalized.includes('lose')) return 'cut';
  if (normalized.includes('build muscle') && !normalized.includes('lose fat')) return 'bulk';
  return 'maintain';
}

function targetCalories(profile: UserProfile, latestWeightKg: number) {
  const tdee = calculateTDEE(
    latestWeightKg,
    profile.heightCm,
    profile.age,
    getActivityLevel(profile.gymDaysPerWeek),
    profile.gender,
  );
  const goal = profile.goal?.toLowerCase() ?? '';
  const targetDelta = profile.targetWeightKg - latestWeightKg;

  if (goal.includes('lose')) return Math.max(1400, tdee - 400);
  if (goal.includes('build muscle') && !goal.includes('lose fat')) return tdee + 250;
  if (goal.includes('build muscle') && goal.includes('lose fat')) {
    if (targetDelta > 1) return tdee + 150;
    if (targetDelta < -1) return Math.max(1400, tdee - 250);
  }
  return tdee;
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

function buildWeeklyWorkouts(dayPills: string[]): NonNullable<GeneratedPlan['weeklyWorkouts']> {
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

function scheduleForGymDays(gymDaysPerWeek: number) {
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
  return schedules[gymDays] ?? schedules[4];
}

export function summarizeWeightTrend(logs: BodyMetricLog[], targetWeightKg: number) {
  const weights = logs
    .filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (weights.length < 2) return 'Log at least two weights to see the trend.';

  const first = weights[0];
  const latest = weights[weights.length - 1];
  const delta = Number(((latest.weightKg ?? 0) - (first.weightKg ?? 0)).toFixed(1));
  const targetDelta = Number(((latest.weightKg ?? 0) - targetWeightKg).toFixed(1));
  const direction = delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'stable';
  const targetText = Math.abs(targetDelta) < 0.2
    ? 'You are around target.'
    : `${Math.abs(targetDelta)} kg ${targetDelta > 0 ? 'above' : 'below'} target.`;

  return `Weight is ${direction} ${Math.abs(delta)} kg across ${weights.length} logs. ${targetText}`;
}

export function recalibrateBodyPlan(profile: UserProfile, logs: BodyMetricLog[]): BodyRecalibration | null {
  const latest = logs
    .filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (!latest?.weightKg) return null;

  const calorieGoal = targetCalories(profile, latest.weightKg);
  const macros = calculateMacros(calorieGoal, goalFromProfile(profile.goal));
  const schedule = scheduleForGymDays(profile.gymDaysPerWeek);
  const generatedPlan: GeneratedPlan = {
    workoutSplit: schedule.workoutSplit,
    dayPills: schedule.dayPills,
    weeklyWorkouts: buildWeeklyWorkouts(schedule.dayPills),
    firstWeekGoals: DEFAULT_GOALS,
    waterTargetMl: profile.waterTargetMl,
  };

  return {
    calorieGoal,
    macros,
    generatedPlan,
    split: schedule.workoutSplit,
    weightKg: latest.weightKg,
    trendSummary: summarizeWeightTrend(logs, profile.targetWeightKg),
    source: 'fallback',
    note: 'Fallback calculated from latest weight, profile goal, age, height, gender, and gym days.',
  };
}

function parseGeneratedBodyPlan(response: string, fallback: BodyRecalibration): BodyRecalibration | null {
  const jsonText = response.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '');
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const calorieGoal = Math.round(Number(parsed.calorieGoal || parsed.calories || fallback.calorieGoal));
    const parsedMacros = parsed.macros && typeof parsed.macros === 'object' && !Array.isArray(parsed.macros)
      ? parsed.macros as Record<string, unknown>
      : {};
    const macros = {
      protein: Math.round(Number(parsedMacros.protein || fallback.macros.protein)),
      carbs: Math.round(Number(parsedMacros.carbs || fallback.macros.carbs)),
      fat: Math.round(Number(parsedMacros.fat || fallback.macros.fat)),
    };
    const dayPills = Array.isArray(parsed.dayPills)
      ? parsed.dayPills.filter(Boolean).map(String).slice(0, 7)
      : fallback.generatedPlan.dayPills;
    const split = typeof parsed.workoutSplit === 'string' && parsed.workoutSplit.trim()
      ? parsed.workoutSplit.trim()
      : fallback.split;

    if (!Number.isFinite(calorieGoal) || calorieGoal < 1000 || dayPills.length !== 7) return null;

    return {
      ...fallback,
      calorieGoal,
      macros,
      split,
      generatedPlan: {
        ...fallback.generatedPlan,
        workoutSplit: split,
        dayPills,
        weeklyWorkouts: buildWeeklyWorkouts(dayPills),
      },
      source: 'ai',
      note: typeof parsed.note === 'string' && parsed.note.trim()
        ? parsed.note.trim()
        : 'AI generated from latest body_metrics log and profile data.',
    };
  } catch {
    return null;
  }
}

export async function generateBodyPlan(profile: UserProfile, logs: BodyMetricLog[]) {
  const fallback = recalibrateBodyPlan(profile, logs);
  if (!fallback) return null;

  const latestLog = logs
    .filter((log) => typeof log.weightKg === 'number' && log.weightKg > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const response = await callAI(
    [
      'Generate updated LifeOS nutrition and gym targets from the latest body_metrics log and profile table data.',
      'Return only JSON with keys calorieGoal, macros { protein, carbs, fat }, workoutSplit, dayPills as exactly 7 labels, and note.',
      'Use the latest weight log as the current body weight. Keep values realistic and metric.',
      'Do not include markdown.',
    ].join(' '),
    {
      profile,
      latestBodyMetric: latestLog,
      recentBodyMetrics: logs.slice(0, 14),
      fallbackPlan: fallback,
    },
    { allowOpenAI: true, allowLocalAI: true, responseFormat: 'json_object' },
  );

  return parseGeneratedBodyPlan(response, fallback) ?? fallback;
}
