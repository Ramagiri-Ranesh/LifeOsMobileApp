export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive';
export type FitnessGoal = 'cut' | 'maintain' | 'bulk';

const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

const clampScore = (value: number) => Math.max(0, Math.min(100, value));

export function calculateTDEE(weightKg: number, heightCm: number, age: number, activityLevel: ActivityLevel) {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  return Math.round(bmr * activityMultipliers[activityLevel]);
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
  habitsScore: number;
  learningScore: number;
}) {
  return Math.round(
    clampScore(scores.nutritionScore) * 0.25 +
      clampScore(scores.fitnessScore) * 0.25 +
      clampScore(scores.productivityScore) * 0.2 +
      clampScore(scores.habitsScore) * 0.2 +
      clampScore(scores.learningScore) * 0.1,
  );
}

export function calculateGoalScore(current: number, target: number) {
  if (target <= 0) return 0;
  return clampScore((current / target) * 100);
}

export function calculateStreak(completedDates: string[], today = new Date()) {
  const completed = new Set(completedDates);
  let streak = 0;
  const cursor = new Date(today);

  while (completed.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
