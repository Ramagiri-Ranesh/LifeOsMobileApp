export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive';
export type FitnessGoal = 'cut' | 'maintain' | 'bulk';
export type Gender = 'male' | 'female';

const KCAL_PER_KG = 7700;
export const IDEAL_WEEKLY_WEIGHT_CHANGE_KG = 0.5;

const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

const clampScore = (value: number) => Math.max(0, Math.min(100, value));

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateTDEE(
  weightKg: number,
  heightCm: number,
  age: number,
  activityLevel: ActivityLevel,
  gender: Gender = 'male',
) {
  const genderConstant = gender === 'female' ? -161 : 5;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + genderConstant;
  return Math.round(bmr * activityMultipliers[activityLevel]);
}

export function suggestedTargetDate(
  currentWeightKg: number,
  targetWeightKg: number,
  from = new Date(),
  weeklyWeightChangeKg = IDEAL_WEEKLY_WEIGHT_CHANGE_KG,
) {
  if (weeklyWeightChangeKg <= 0 || Math.abs(targetWeightKg - currentWeightKg) < 0.1) return '';
  const weeks = Math.max(1, Math.ceil(Math.abs(targetWeightKg - currentWeightKg) / weeklyWeightChangeKg));
  const date = new Date(from);
  date.setDate(date.getDate() + weeks * 7);
  return localDateKey(date);
}

export function normalizeWaterTargetMl(
  value: unknown,
  glasses: unknown,
  fallback: number | null = null,
  allowGlassValues = true,
) {
  const parse = (input: unknown) => {
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
      const parsed = Number(input.replace(/[^\d.]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };
  const direct = parse(value);
  if (direct >= 1500 && direct <= 6000) return Math.ceil(direct / 250) * 250;
  if (allowGlassValues && direct >= 5 && direct <= 24) return Math.round(direct) * 250;
  const glassCount = parse(glasses);
  return allowGlassValues && glassCount >= 5 && glassCount <= 24 ? Math.round(glassCount) * 250 : fallback;
}

export function calculateHydrationTarget(weightKg: number) {
  const requiredMl = Math.max(2200, Math.round(Math.max(0, weightKg) * 35));
  const glasses = Math.ceil(requiredMl / 250);
  return { requiredMl, glasses, waterTargetMl: glasses * 250 };
}

export function calculateGoalCalorieTarget(args: {
  maintenanceCalories: number;
  currentWeightKg: number;
  targetWeightKg: number;
  targetDate?: string;
  weeklyWeightChangeKg?: number;
  goal: FitnessGoal;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const targetDate = args.targetDate ? new Date(`${args.targetDate}T12:00:00`) : null;
  const days = targetDate && !Number.isNaN(targetDate.getTime())
    ? Math.max(7, Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;
  const weightDeltaKg = args.targetWeightKg - args.currentWeightKg;
  const requestedWeeklyChangeKg = days ? weightDeltaKg / (days / 7) : 0;
  const hasSelectedPace = typeof args.weeklyWeightChangeKg === 'number' && Number.isFinite(args.weeklyWeightChangeKg);
  const selectedPace = Math.max(0, Math.min(1, args.weeklyWeightChangeKg ?? 0));
  const goalDirection = args.goal === 'bulk' ? 1 : args.goal === 'cut' ? -1 : Math.sign(weightDeltaKg);
  const plannedWeeklyChangeKg = hasSelectedPace
    ? selectedPace * goalDirection
    : Math.max(-IDEAL_WEEKLY_WEIGHT_CHANGE_KG, Math.min(IDEAL_WEEKLY_WEIGHT_CHANGE_KG, requestedWeeklyChangeKg));

  let calorieAdjustment = hasSelectedPace
    ? Math.round((plannedWeeklyChangeKg * KCAL_PER_KG) / 7)
    : days && Math.abs(weightDeltaKg) >= 0.1
    ? Math.round((plannedWeeklyChangeKg * KCAL_PER_KG) / 7)
    : args.goal === 'bulk'
      ? 250
      : args.goal === 'cut'
        ? -400
        : 0;

  // A selected goal still determines direction when the entered target does not.
  if (!hasSelectedPace && args.goal === 'bulk' && calorieAdjustment <= 0) calorieAdjustment = 250;
  if (!hasSelectedPace && args.goal === 'cut' && calorieAdjustment >= 0) calorieAdjustment = -400;
  if (calorieAdjustment === 0) calorieAdjustment = 0;

  const derivedTargetDate = hasSelectedPace
    ? suggestedTargetDate(args.currentWeightKg, args.targetWeightKg, now, selectedPace)
    : args.targetDate || suggestedTargetDate(args.currentWeightKg, args.targetWeightKg, now);

  return {
    maintenanceCalories: Math.round(args.maintenanceCalories),
    calorieAdjustment,
    calorieTarget: Math.max(1200, Math.round(args.maintenanceCalories + calorieAdjustment)),
    requestedWeeklyChangeKg: Number(requestedWeeklyChangeKg.toFixed(2)),
    plannedWeeklyChangeKg: Number(plannedWeeklyChangeKg.toFixed(2)),
    targetDate: derivedTargetDate,
  };
}

export function calculateMacros(calories: number, goal: FitnessGoal) {
  const proteinRatio = goal === 'bulk' ? 0.25 : 0.3;
  const fatRatio = goal === 'cut' ? 0.25 : 0.28;
  const carbsRatio = 1 - proteinRatio - fatRatio;

  return {
    protein: Math.round((calories * proteinRatio) / 4),
    carbs: Math.round((calories * carbsRatio) / 4),
    fat: Math.round((calories * fatRatio) / 9),
  };
}

export function calculateLifeScore(scores: {
  nutritionScore: number;
  fitnessScore: number;
  productivityScore: number;
  hydrationScore: number;
  alignmentScore: number;
}) {
  return Math.round(
    clampScore(scores.nutritionScore) * 0.25 +
      clampScore(scores.fitnessScore) * 0.25 +
      clampScore(scores.productivityScore) * 0.2 +
      clampScore(scores.hydrationScore) * 0.2 +
      clampScore(scores.alignmentScore) * 0.1,
  );
}

export function calculateGoalScore(current: number, target: number) {
  if (target <= 0) return 0;
  return clampScore((current / target) * 100);
}

export function calculateStreak(
  completedDates: string[],
  today = new Date(),
  options: { restDayIndexes?: number[] } = {},
) {
  const completed = new Set(completedDates);
  const restDays = new Set(options.restDayIndexes ?? []);
  let streak = 0;
  const cursor = new Date(today);

  while (completed.has(localDateKey(cursor)) || restDays.has(cursor.getDay())) {
    if (completed.has(localDateKey(cursor))) {
      streak += 1;
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
